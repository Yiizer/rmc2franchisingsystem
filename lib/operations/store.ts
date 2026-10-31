import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Async data-access adapter (phase 2 of the Postgres migration).
//
// Callers only see get/all/run/exec/transaction. The SQLite implementation below
// wraps one synchronous DatabaseSync connection, so it must make awaiting callers
// behave as if statements still ran one after another:
//  * transaction() takes an async mutex (one transaction at a time, BEGIN IMMEDIATE).
//    That global write lock is what makes duplicate-client/registration checks race-free.
//  * The active transaction travels in AsyncLocalStorage: statements and nested
//    transaction() calls made from inside it run on the owner's lock without deadlocking.
//  * Statements outside a transaction take the mutex for the one statement, in FIFO order
//    (they never see uncommitted rows, and a queue of transactions cannot starve them).
//  * A statement issued from a transaction's async context after it rolled back (e.g. a
//    sibling still running after Promise.all rejected) throws instead of autocommitting.
// store-postgres.ts is the Postgres implementation of the same interface (phase 4); database.ts picks one.

export type SqlParam = string | number | bigint | null | Uint8Array;
export type RunResult = { changes: number; lastInsertRowid: number | bigint };
export type Dialect = 'sqlite' | 'postgres';
export type TransactionOptions = {
  /** Extra attempts after a retryable failure (Postgres only: deadlock, serialization, early connection failure). Clamped to 0-2. */
  retries?: number;
};
export interface Store {
  readonly dialect: Dialect;
  get<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  run(sql: string, ...params: SqlParam[]): Promise<RunResult>;
  /** Schema/DDL and multi-statement scripts only. Never takes parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(run: () => Promise<T> | T, opts?: TransactionOptions): Promise<T>;
  /** One consistent read-only view for multi-read endpoints (Postgres: read-only REPEATABLE READ; SQLite: just run()). */
  snapshot<T>(run: () => Promise<T> | T): Promise<T>;
  /** Transaction-scoped advisory locks, taken in sorted order (Postgres). Must be called inside transaction(). No-op on SQLite. */
  lock(...keys: string[]): Promise<void>;
  /** Non-blocking variant of lock(): true when acquired. Must be called inside transaction(). Always true on SQLite. */
  tryLock(key: string): Promise<boolean>;
  /** True while the caller is inside transaction()/snapshot() (so lock() is allowed). */
  inTransaction(): boolean;
  /** Closes the connection (tests and shutdown). */
  close(): void | Promise<void>;
}

type Scope = { active: boolean; aborted?: boolean };

class Mutex {
  private held = false;
  private queue: (() => void)[] = [];
  acquire(): Promise<void> {
    if (!this.held) { this.held = true; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) { next(); return; } // hand-off: the lock stays held
    this.held = false;
  }
}

const STATEMENT_CACHE_LIMIT = 300;

export function createSqliteStore(open: () => DatabaseSync): Store {
  let database: DatabaseSync | undefined;
  const lock = new Mutex();
  const scopes = new AsyncLocalStorage<Scope>();
  const statements = new Map<string, StatementSync>();
  const raw = () => database ?? (database = open());
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= STATEMENT_CACHE_LIMIT) statements.clear();
      statement = raw().prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const inTransaction = () => scopes.getStore()?.active === true;
  const statement = async <T>(execute: () => T): Promise<T> => {
    const scope = scopes.getStore();
    if (scope?.aborted) throw new Error('Statement issued after its transaction was rolled back');
    if (scope?.active) return execute();
    await lock.acquire();
    try { return execute(); } finally { lock.release(); }
  };
  const store: Store = {
    dialect: 'sqlite',
    get: <T>(sql: string, ...params: SqlParam[]) => statement(() => prepare(sql).get(...params) as T | undefined),
    all: <T>(sql: string, ...params: SqlParam[]) => statement(() => prepare(sql).all(...params) as T[]),
    run: (sql, ...params) => statement(() => {
      const result = prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
    }),
    exec: sql => statement(() => { raw().exec(sql); }),
    async transaction<T>(run: () => Promise<T> | T): Promise<T> {
      if (inTransaction()) return run(); // nested: join the outer transaction
      await lock.acquire();
      const scope: Scope = { active: true };
      try {
        try { raw().exec('BEGIN IMMEDIATE'); } catch (error) { scope.active = false; throw error; }
        try {
          const result = await scopes.run(scope, run);
          raw().exec('COMMIT');
          return result;
        } catch (error) {
          scope.aborted = true;
          try { raw().exec('ROLLBACK'); } catch { /* nothing left to roll back */ }
          throw error;
        }
      } finally {
        scope.active = false;
        lock.release();
      }
    },
    // SQLite's one global write lock already serialises everything: snapshots and locks have nothing to add.
    snapshot: async <T>(run: () => Promise<T> | T) => run(),
    lock: async () => {},
    inTransaction,
    tryLock: async () => true,
    close() { statements.clear(); database?.close(); database = undefined; },
  };
  return store;
}
