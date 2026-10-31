import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { AppError } from './errors';
import type { RunResult, SqlParam, Store, TransactionOptions } from './store';

// Postgres implementation of the Store interface (phase 4), on the postgres.js driver (porsager `postgres`), PINNED to 3.4.7:
// v4.0.0 hangs forever when more queries than `max` queue against Supabase's transaction pooler (port 6543).
// v3.4.7 has the same trap on a warmed pool: when every connection is busy it PIPELINES the overflow query onto a busy connection,
// and Supavisor never answers it (a fresh pool queues instead, so a simple probe passes). So this store never lets the driver see more
// concurrent pool statements/transactions than it has connections: a small gate (size = max) queues the rest here, in order.
//
// The app is written against `?` placeholders and the shared get/all/run/exec/transaction surface; this file
// adapts that to Postgres without changing callers:
//  * `?` becomes `$n` (string literals, quoted identifiers, comments and dollar-quoted bodies are skipped);
//    the result is cached per SQL string. The Postgres `?` JSON operators are therefore off limits (use jsonb_exists).
//  * run().changes comes from the driver's `count`. There is no lastInsertRowid (always 0): use RETURNING.
//  * int8 comes back as a JS Number; json/jsonb come back as the raw JSON text, so `JSON.parse(row.data)` keeps working.
//  * transaction() is sql.begin with the same AsyncLocalStorage scope as SQLite: nested calls join the outer
//    transaction, and a statement from a sibling still running after the rollback throws.
//  * The outermost transaction is retried (max 3 tries) on deadlock/serialization failures and on a connection
//    failure before any statement completed. It is never retried once the callback finished (COMMIT was sent).
//  * Connection strings and driver messages never reach callers or logs: failures become AppError with fixed text.
//  * Pool exhaustion cannot hang a request: postgres.js has no queue timeout, so waiting for one of the 3 connections is bounded
//    here (15 s, DB_WAIT_MS), both in the gate and, as a second line, in the driver. A pool statement that is still queued is cancelled and removed from the driver's queue; a running one is
//    only abandoned (the server's statement_timeout ends it). A transaction that has not got a connection in time is abandoned: when
//    the driver finally runs its callback wrapper, that throws at once, so the empty transaction rolls back and the connection is
//    released cleanly. The caller gets 503 "Database busy. Try again." and never retries it. Once a transaction body has started,
//    its statements are bounded by the role's statement_timeout / idle_in_transaction_session_timeout, not by this timer.
// Pooler note: Supabase's transaction pooler (port 6543) has no prepared statements and no session state, hence
// prepare:false, and advisory locks are always the transaction-scoped kind.

type Rows = Array<Record<string, unknown>> & { count?: number | bigint };
type PgQuery = PromiseLike<Rows> & { cancel?: () => unknown; state?: unknown };
interface PgSql {
  unsafe(query: string, params?: unknown[], options?: { simple?: boolean; prepare?: boolean }): PgQuery;
  begin<T>(mode: string, run: (tx: PgSql) => Promise<T>): Promise<T>;
  begin<T>(run: (tx: PgSql) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}
export type PostgresStoreDeps = {
  /** Test seam: a stand-in for the driver. Defaults to a real postgres.js client built from the URL. */
  sql?: PgSql;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** How long a statement/transaction may wait for a pooled connection. Default 15 s. */
  waitMs?: number;
  /** Concurrent pool statements/transactions let through to the driver. Default: the pool size (3). */
  connections?: number;
};
const DB_WAIT_MS = 15000;
const WAIT_TIMEOUT = 'RMC2_DB_WAIT_TIMEOUT';

// ---------------------------------------------------------------- placeholder conversion
const IDENT = /[A-Za-z0-9_$\u0080-￿]/;
const CACHE_LIMIT = 1000;
const converted = new Map<string, string>();

/** Replaces each `?` outside literals, quoted identifiers, comments and dollar-quoted bodies with `$1`, `$2`, ... */
export function toPositional(sql: string): string {
  const cached = converted.get(sql);
  if (cached !== undefined) return cached;
  let out = '', count = 0, i = 0;
  const length = sql.length;
  while (i < length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      // E'...' strings treat backslash as an escape; plain strings and identifiers only double the quote.
      const backslash = ch === "'" && /[eE]/.test(sql[i - 1] ?? '') && !IDENT.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < length) {
        if (backslash && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue; } j++; break; }
        j++;
      }
      j = Math.min(j, length);
      out += sql.slice(i, j); i = j; continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const j = end === -1 ? length : end;
      out += sql.slice(i, j); i = j; continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1, j = i + 2;
      while (j < length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      out += sql.slice(i, j); i = j; continue;
    }
    if (ch === '$' && !IDENT.test(sql[i - 1] ?? '')) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 66));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const j = close === -1 ? length : close + tag[0].length;
        out += sql.slice(i, j); i = j; continue;
      }
    }
    if (ch === '?') { out += '$' + (++count); i++; continue; }
    out += ch; i++;
  }
  if (converted.size >= CACHE_LIMIT) converted.clear();
  converted.set(sql, out);
  return out;
}

// ---------------------------------------------------------------- errors
const BUSY = 'Database busy. Try again.';
const CONTENDED = 'Another colleague is working on this client, try again';
const CONNECTION_CODES = new Set([
  'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'QUEUE_TIMEOUT',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  '53300', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
]);
// Failures that mean "cannot use the database" but will not fix themselves on a retry (bad password, TLS, wrong database).
const UNAVAILABLE_CODES = new Set([WAIT_TIMEOUT, '28000', '28P01', '3D000', 'SSL_NOT_SUPPORTED', 'TLS_HANDSHAKE_FAILED', 'CHANNEL_BINDING_REQUIRED', 'AUTH_TYPE_NOT_IMPLEMENTED']);

const codeOf = (error: unknown): string => {
  const e = error as { pgCode?: unknown; code?: unknown } | null;
  const code = e && typeof e === 'object' ? (e.pgCode ?? e.code) : undefined;
  return typeof code === 'string' ? code : '';
};
const isPaused = (error: unknown) => codeOf(error) === 'XX000' && /tenant or user not found/i.test(String((error as { message?: unknown })?.message ?? ''));
export const isConnectionFailure = (error: unknown) => CONNECTION_CODES.has(codeOf(error)) || isPaused(error);
export const isRetryableCode = (code: string) => code === '40001' || code === '40P01';

let lastLogged = 0;
function logOnce(code: string) {
  // The code only: driver messages can carry host names or other connection details.
  const now = Date.now();
  if (now - lastLogged < 10_000) return;
  lastLogged = now;
  console.error('[rmc2] database problem, code', code || 'unknown');
}
function tagged(message: string, status: number, code: string): AppError {
  const error = new AppError(message, status);
  Object.defineProperty(error, 'pgCode', { value: code, enumerable: false });
  return error;
}

/** Maps driver/server errors to AppError with fixed, non-leaky text. Other errors pass through unchanged. */
export function mapPgError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const code = codeOf(error);
  if (code === '55P03' || code === '57014') return tagged(CONTENDED, 503, code);
  if (code === '23505') return tagged('This record already exists. Reload to see the latest changes.', 409, code);
  if (isRetryableCode(code)) return tagged(BUSY, 503, code);
  if (isConnectionFailure(error) || UNAVAILABLE_CODES.has(code)) { logOnce(code); return tagged(BUSY, 503, code || 'XX000'); }
  return error;
}

// ---------------------------------------------------------------- client options
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { /* fall through */ }
  return /@([^/:?#]+|\[[^\]]+\])/.exec(url)?.[1]?.toLowerCase() ?? '';
}
// Raw JSON text out (callers JSON.parse), int8 as Number, strings pass through on the way in.
const rawJson = { to: 114, from: [114, 3802], serialize: (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value), parse: (text: string) => text };
const int8AsNumber = { to: 20, from: [20], serialize: (value: unknown) => String(value), parse: (text: string) => Number(text) };

/** postgres.js options for the app connection. Pure, so tests can check it without a database. */
export function buildClientOptions(url: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error('RMC2_DATABASE_URL must be a postgres:// URL');
  const local = LOCAL_HOSTS.has(hostOf(url));
  const wantsPlain = (env.RMC2_DATABASE_SSL ?? '').toLowerCase() === 'disable';
  if (wantsPlain && !local) throw new Error('RMC2_DATABASE_SSL=disable is only allowed for a localhost database');
  return {
    prepare: false,
    ssl: wantsPlain ? (false as const) : ('require' as const),
    max: 3,
    idle_timeout: 10,
    max_lifetime: 1800,
    connect_timeout: 10,
    fetch_types: false,
    onnotice: () => {}, // v3 logs notices to the console unless given a handler
    types: { json: rawJson, int8: int8AsNumber },
  };
}

// ---------------------------------------------------------------- concurrency gate
type Gate = { acquire(ms: number, onTimeout: () => Error): Promise<() => void> };
/** FIFO counting semaphore. The release is deferred one macrotask so the driver has seen the connection go idle before the next query is issued. */
function createGate(size: number): Gate {
  let free = size;
  const waiters: Array<() => void> = [];
  const release = () => { const next = waiters.shift(); if (next) next(); else free++; };
  const handle = () => { let done = false; return () => { if (!done) { done = true; setImmediate(release); } }; };
  return {
    acquire(ms, onTimeout) {
      if (free > 0) { free--; return Promise.resolve(handle()); }
      return new Promise((resolve, reject) => {
        const waiter = () => { clearTimeout(timer); resolve(handle()); };
        const timer = setTimeout(() => { const at = waiters.indexOf(waiter); if (at >= 0) waiters.splice(at, 1); reject(onTimeout()); }, ms);
        waiters.push(waiter);
      });
    },
  };
}

// ---------------------------------------------------------------- store
type PgScope = { tx: PgSql; active: boolean; aborted: boolean; completed: number };
const MAX_RETRIES = 2; // 3 tries in total
const SNAPSHOT_MODE = 'isolation level repeatable read read only';
const ROLLED_BACK = 'Statement issued after its transaction was rolled back';

export function createPostgresStore(url: string, deps: PostgresStoreDeps = {}): Store {
  const sql: PgSql = deps.sql ?? (postgres(url, buildClientOptions(url) as never) as unknown as PgSql);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const waitMs = deps.waitMs ?? DB_WAIT_MS;
  const gate = createGate(deps.connections ?? 3);
  const scopes = new AsyncLocalStorage<PgScope>();
  const waitError = () => Object.assign(new Error('Timed out waiting for a database connection'), { code: WAIT_TIMEOUT });
  /** Bounds a pool statement. Still queued in the driver: cancel it (removed from the queue, rejected 57014). Running: abandon it. */
  // The gate slot is returned only when the statement really settles, never when the caller gives up: an abandoned statement still
  // occupies its connection, and handing the slot on early would let the driver see an overflow query (and pipeline it).
  const bounded = async (query: PgQuery, release: () => void): Promise<Rows> => {
    const running = Promise.resolve(query); // starts the (lazy) driver query
    running.then(release, release);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!query.state) { try { void Promise.resolve(query.cancel?.()).catch(() => {}); } catch { /* best effort */ } }
        reject(waitError());
      }, waitMs);
    });
    try { return await Promise.race([running, expired]); } finally { clearTimeout(timer); }
  };

  const statement = async (text: string, params: readonly SqlParam[]): Promise<Rows> => {
    const scope = scopes.getStore();
    if (scope?.aborted) throw new Error(ROLLED_BACK);
    const target = scope?.active ? scope.tx : sql;
    try {
      let rows: Rows;
      if (scope?.active) rows = await target.unsafe(toPositional(text), [...params], { simple: false });
      else {
        const release = await gate.acquire(waitMs, waitError);
        rows = await bounded(target.unsafe(toPositional(text), [...params], { simple: false }), release);
      }
      if (scope?.active) scope.completed++;
      return rows;
    } catch (error) { throw mapPgError(error); }
  };
  const requireTransaction = (what: string) => {
    const scope = scopes.getStore();
    if (scope?.aborted) throw new Error(ROLLED_BACK);
    if (!scope?.active) throw new Error(`store.${what}() must be called inside transaction()`);
  };

  async function scoped<T>(mode: string | undefined, work: () => Promise<T> | T, retries: number): Promise<T> {
    const outer = scopes.getStore();
    if (outer?.aborted) throw new Error(ROLLED_BACK);
    if (outer?.active) return work(); // nested: join the outer transaction
    const tries = 1 + Math.max(0, Math.min(MAX_RETRIES, Math.trunc(retries) || 0));
    for (let attempt = 1; ; attempt++) {
      const scope: PgScope = { tx: sql, active: false, aborted: false, completed: 0 };
      let finished = false, entered = false, abandoned = false, timer: ReturnType<typeof setTimeout> | undefined;
      const body = async (tx: PgSql): Promise<T> => {
        if (abandoned) throw waitError(); // the caller already got its 503: just roll the empty transaction back and free the connection
        entered = true; clearTimeout(timer);
        scope.tx = tx; scope.active = true;
        try { const result = await scopes.run(scope, work); finished = true; return result; }
        catch (error) { scope.aborted = true; throw error; }
        finally { scope.active = false; }
      };
      try {
        const release = await gate.acquire(waitMs, waitError);
        const begun = mode ? sql.begin(mode, body) : sql.begin(body);
        begun.then(release, release); // the slot is returned when the driver is really done with the connection, even if the caller gave up
        const noConnection = new Promise<never>((_, reject) => { timer = setTimeout(() => { if (!entered) { abandoned = true; reject(waitError()); } }, waitMs); });
        try { return await Promise.race([begun, noConnection]); } finally { clearTimeout(timer); }
      } catch (error) {
        scope.aborted = true;
        // Never after the callback finished: COMMIT may or may not have happened.
        const retryable = !finished && (isRetryableCode(codeOf(error)) || (isConnectionFailure(error) && scope.completed === 0));
        if (retryable && attempt < tries) { await sleep(20 + Math.floor(random() * 81)); continue; }
        throw mapPgError(error);
      }
    }
  }

  const advisoryKey = (key: string) => {
    if (typeof key !== 'string' || !key) throw new Error('Advisory lock keys must be non-empty strings');
    return key;
  };

  const store: Store = {
    dialect: 'postgres',
    async get<T>(text: string, ...params: SqlParam[]) { return (await statement(text, params))[0] as T | undefined; },
    async all<T>(text: string, ...params: SqlParam[]) { return Array.from(await statement(text, params)) as T[]; },
    async run(text, ...params): Promise<RunResult> {
      const rows = await statement(text, params);
      const changes = Number(rows.count ?? 0);
      return { changes: Number.isFinite(changes) ? changes : 0, lastInsertRowid: 0 };
    },
    async exec(text) {
      const scope = scopes.getStore();
      if (scope?.aborted) throw new Error(ROLLED_BACK);
      try { // simple protocol: no parameters, may hold several statements
        if (scope?.active) await scope.tx.unsafe(text);
        else { const release = await gate.acquire(waitMs, waitError); await bounded(sql.unsafe(text), release); }
      } catch (error) { throw mapPgError(error); }
      if (scope?.active) scope.completed++;
    },
    transaction: <T>(run: () => Promise<T> | T, opts?: TransactionOptions) => scoped(undefined, run, opts?.retries ?? MAX_RETRIES),
    snapshot: <T>(run: () => Promise<T> | T) => scoped(SNAPSHOT_MODE, run, MAX_RETRIES),
    async lock(...keys) {
      requireTransaction('lock');
      // Sorted and de-duplicated so every caller takes the same locks in the same order (no lock-order deadlocks).
      for (const key of [...new Set(keys.map(advisoryKey))].sort())
        await statement('SELECT pg_advisory_xact_lock(hashtextextended(?,0)) AS locked', [key]);
    },
    async tryLock(key) {
      requireTransaction('tryLock');
      const row = await statement('SELECT pg_try_advisory_xact_lock(hashtextextended(?,0)) AS ok', [advisoryKey(key)]);
      return row[0]?.ok === true;
    },
    inTransaction: () => scopes.getStore()?.active === true,
    async close() { await sql.end({ timeout: 5 }); },
  };
  return store;
}
