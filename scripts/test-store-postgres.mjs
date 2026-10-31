// Phase 4 adapter tests for the Postgres Store (lib/operations/store-postgres.ts) and the SQL dialect helpers.
//  * Unit part: no database, no network. A fake driver stands in for postgres.js, so transaction scoping, retries,
//    locks and snapshots are checked without a server.
//  * Live part: runs only when RMC2_DATABASE_URL is in the environment. It uses TEMP tables and advisory locks only
//    and writes nothing to the rmc2 schema. The URL is never printed.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const dir = path.resolve('test-results', 'store-postgres', String(Date.now()));
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
mkdirSync(dir, { recursive: true });
const liveUrl = process.env.RMC2_DATABASE_URL; // captured before the sandboxing below
const liveSsl = process.env.RMC2_DATABASE_SSL;
// database.ts opens a store at import: keep it on a throwaway SQLite dir and out of any real database.
process.env.RMC2_DATA_DIR = path.join(dir, 'app-data');
for (const key of ['RMC2_DB', 'RMC2_DATABASE_URL', 'RMC2_DATABASE_SSL', 'VERCEL']) delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const pg = await imp('store-postgres.ts');
const dialect = await imp('sql-dialect.ts');
const database = await imp('database.ts');
const { AppError } = await imp('errors.ts');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- placeholder conversion
await check('toPositional numbers placeholders in order', () => {
  assert.equal(pg.toPositional('SELECT * FROM t WHERE a=? AND b=? LIMIT ?'), 'SELECT * FROM t WHERE a=$1 AND b=$2 LIMIT $3');
  assert.equal(pg.toPositional('SELECT 1'), 'SELECT 1');
  assert.equal(pg.toPositional('SELECT ?::text, ?::int'), 'SELECT $1::text, $2::int');
});
await check('toPositional leaves ? inside string literals, identifiers and comments alone', () => {
  assert.equal(pg.toPositional("SELECT 'what?' , ? , 'it''s ? ok', ?"), "SELECT 'what?' , $1 , 'it''s ? ok', $2");
  assert.equal(pg.toPositional('SELECT "col?" FROM t WHERE x=?'), 'SELECT "col?" FROM t WHERE x=$1');
  assert.equal(pg.toPositional('SELECT 1 -- really?\n WHERE x=?'), 'SELECT 1 -- really?\n WHERE x=$1');
  assert.equal(pg.toPositional('SELECT /* a ? /* nested ? */ still ? */ ?'), 'SELECT /* a ? /* nested ? */ still ? */ $1');
});
await check('toPositional handles E-strings, dollar quoting, $ in literals and existing $n', () => {
  assert.equal(pg.toPositional("SELECT E'it\\'s ?' , ?"), "SELECT E'it\\'s ?' , $1");
  assert.equal(pg.toPositional("SELECT 'cost $5 ?', ?"), "SELECT 'cost $5 ?', $1");
  assert.equal(pg.toPositional('SELECT $$a ? b$$, ?'), 'SELECT $$a ? b$$, $1');
  assert.equal(pg.toPositional('SELECT $tag$x ? $$ y$tag$, ?'), 'SELECT $tag$x ? $$ y$tag$, $1');
  assert.equal(pg.toPositional('SELECT col$name, ? FROM t'), 'SELECT col$name, $1 FROM t');
  assert.equal(pg.toPositional('SELECT $1, ?'), 'SELECT $1, $1', 'an existing $n is not renumbered (callers use ? only)');
  assert.equal(pg.toPositional("SELECT 'unterminated ?"), "SELECT 'unterminated ?");
});
await check('toPositional is cached per SQL string and stable', () => {
  const sql = 'SELECT ?, ? /* cache */';
  assert.equal(pg.toPositional(sql), pg.toPositional(sql));
  assert.equal(pg.toPositional(sql), 'SELECT $1, $2 /* cache */');
});

// ---------------------------------------------------------------- error mapping
await check('mapPgError: lock timeout and cancel -> 503 colleague message', () => {
  for (const code of ['55P03', '57014']) {
    const mapped = pg.mapPgError(Object.assign(new Error('internal detail host=db.example'), { code }));
    assert.ok(mapped instanceof AppError);
    assert.equal(mapped.status, 503);
    assert.equal(mapped.message, 'Another colleague is working on this client, try again');
  }
});
await check('mapPgError: unique violation -> 409 without constraint details', () => {
  const mapped = pg.mapPgError(Object.assign(new Error('duplicate key value violates unique constraint "x" Key (a)=(secret)'), { code: '23505', detail: 'Key (a)=(secret)' }));
  assert.equal(mapped.status, 409);
  assert.ok(!/secret|constraint/.test(mapped.message));
});
await check('mapPgError: connection, pool, auth and paused-project failures -> 503 "Database busy. Try again." with no details', () => {
  const originalError = console.error; const logged = []; console.error = (...args) => logged.push(args.join(' '));
  try {
    for (const error of [
      Object.assign(new Error('write CONNECTION_CLOSED db.secret-host.example:6543'), { code: 'CONNECTION_CLOSED' }),
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6543'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('Waited more than 15 seconds'), { code: 'QUEUE_TIMEOUT' }),
      Object.assign(new Error('password authentication failed for user "rmc2_app"'), { code: '28P01' }),
      Object.assign(new Error('Tenant or user not found'), { code: 'XX000' }),
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    ]) {
      const mapped = pg.mapPgError(error);
      assert.ok(mapped instanceof AppError, error.code);
      assert.equal(mapped.status, 503);
      assert.equal(mapped.message, 'Database busy. Try again.');
    }
  } finally { console.error = originalError; }
  assert.ok(logged.every(line => !/secret-host|10\.0\.0\.9|rmc2_app|postgres:\/\//.test(line)), 'logs carry codes only');
});
await check('mapPgError passes through unrelated errors and existing AppErrors', () => {
  const plain = new Error('syntax error'); plain.code = '42601';
  assert.equal(pg.mapPgError(plain), plain);
  const app = new AppError('nope', 403);
  assert.equal(pg.mapPgError(app), app);
  assert.equal(pg.mapPgError('x'), 'x');
});

// ---------------------------------------------------------------- client options
await check('buildClientOptions: required driver options', () => {
  const o = pg.buildClientOptions('postgres://u:p@aws-0-ap.pooler.supabase.com:6543/postgres', {});
  assert.deepEqual({ prepare: o.prepare, ssl: o.ssl, max: o.max, idle_timeout: o.idle_timeout, max_lifetime: o.max_lifetime, connect_timeout: o.connect_timeout, fetch_types: o.fetch_types },
    { prepare: false, ssl: 'require', max: 3, idle_timeout: 10, max_lifetime: 1800, connect_timeout: 10, fetch_types: false });
  assert.equal(o.types.int8.parse('9007199254740991'), 9007199254740991);
  assert.equal(typeof o.types.int8.parse('12'), 'number');
  assert.equal(o.types.json.parse('{"a":1}'), '{"a":1}', 'json/jsonb stay raw text');
  assert.deepEqual(o.types.json.from, [114, 3802]);
  assert.equal(o.types.json.serialize('{"a":1}'), '{"a":1}', 'pre-stringified JSON is not double-encoded');
  assert.equal(o.types.json.serialize({ a: 1 }), '{"a":1}');
});
await check('buildClientOptions: TLS cannot be disabled except for localhost', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(pg.buildClientOptions(`postgres://u:p@${host}:5432/x`, { RMC2_DATABASE_SSL: 'disable' }).ssl, false, host);
    assert.equal(pg.buildClientOptions(`postgres://u:p@${host}:5432/x`, {}).ssl, 'require', 'still required unless asked');
  }
  assert.throws(() => pg.buildClientOptions('postgres://u:p@db.example.com:6543/x', { RMC2_DATABASE_SSL: 'disable' }), /only allowed for a localhost/);
  assert.throws(() => pg.buildClientOptions('postgres://u:p@localhost.evil.example:6543/x', { RMC2_DATABASE_SSL: 'disable' }), /only allowed for a localhost/);
  assert.throws(() => pg.buildClientOptions('http://example.com', {}), /postgres:\/\//);
});
await check('buildClientOptions errors never echo the connection string', () => {
  for (const url of ['postgres://user:hunter2@db.example.com/x', 'mysql://user:hunter2@db.example.com/x']) {
    try { pg.buildClientOptions(url, { RMC2_DATABASE_SSL: 'disable' }); assert.fail('should throw'); }
    catch (error) { assert.ok(!/hunter2|db\.example\.com/.test(String(error.message))); }
  }
});

// ---------------------------------------------------------------- factory
await check('selectDatabase: default sqlite; postgres needs a URL; Vercel requires postgres; unknown values rejected', () => {
  assert.deepEqual(database.selectDatabase({}), { kind: 'sqlite' });
  assert.deepEqual(database.selectDatabase({ RMC2_DB: ' SQLite ' }), { kind: 'sqlite' });
  assert.deepEqual(database.selectDatabase({ RMC2_DB: 'postgres', RMC2_DATABASE_URL: 'postgres://u:p@h/x' }), { kind: 'postgres', url: 'postgres://u:p@h/x' });
  assert.throws(() => database.selectDatabase({ RMC2_DB: 'postgres' }), /RMC2_DATABASE_URL/);
  assert.throws(() => database.selectDatabase({ RMC2_DB: 'postgres', RMC2_DATABASE_URL: '  ' }), /RMC2_DATABASE_URL/);
  assert.throws(() => database.selectDatabase({ VERCEL: '1' }), /required on Vercel/);
  assert.throws(() => database.selectDatabase({ VERCEL: '1', RMC2_DB: 'sqlite' }), /required on Vercel/);
  assert.deepEqual(database.selectDatabase({ VERCEL: '1', RMC2_DB: 'postgres', RMC2_DATABASE_URL: 'postgres://u:p@h/x' }).kind, 'postgres');
  assert.throws(() => database.selectDatabase({ RMC2_DB: 'mysql' }), /sqlite" or "postgres/);
  try { database.selectDatabase({ RMC2_DB: 'postgres', RMC2_DATABASE_URL: '' }); } catch (error) { assert.ok(!/postgres:\/\//.test(error.message)); }
});
await check('the SQLite store reports its dialect and no-op locks', async () => {
  assert.equal(database.db.dialect, 'sqlite');
  assert.equal(await database.db.tryLock('k'), true);
  await database.db.lock('a', 'b');
  assert.equal(await database.db.snapshot(() => 5), 5);
  await database.db.transaction(async () => { await database.db.lock('x'); });
  assert.equal(await database.ensureReady(), undefined);
});

// ---------------------------------------------------------------- dialect helpers
await check('sql-dialect helpers emit the right fragments for each dialect', () => {
  const d = dialect;
  assert.equal(d.jsonText('sqlite', 'data', 'status'), "json_extract(data,'$.status')");
  assert.equal(d.jsonText('postgres', 'i.data', 'status'), "(i.data->>'status')");
  assert.equal(d.jsonText({ dialect: 'postgres' }, 'data', 'status'), "(data->>'status')", 'accepts a store');
  assert.equal(d.jsonBool('sqlite', 'data', 'active'), "(COALESCE(json_extract(data,'$.active'),0)=1)");
  assert.equal(d.jsonBool('postgres', 'data', 'active'), "COALESCE((data->>'active')::boolean,false)");
  assert.equal(d.jsonRaw('sqlite', 'data', 'fields'), "json_extract(data,'$.fields')");
  assert.equal(d.jsonRaw('postgres', 'data', 'fields'), "(data->'fields')::text");
  assert.equal(d.jsonMerge('sqlite', 'data', ['status', { key: 'n', kind: 'number' }, { key: 'ok', kind: 'bool' }, { key: 'o', kind: 'json' }]),
    "json_set(data,'$.status',?,'$.n',?,'$.ok',json(CASE WHEN ? THEN 'true' ELSE 'false' END),'$.o',json(?))");
  assert.equal(d.jsonMerge('postgres', 'data', ['status', { key: 'n', kind: 'number' }, { key: 'ok', kind: 'bool' }, { key: 'o', kind: 'json' }]),
    "data || jsonb_build_object('status',?::text,'n',?::numeric,'ok',?::boolean,'o',?::jsonb)");
  assert.equal(d.jsonAppend('sqlite', 'data', 'readBy'), "json_insert(data,'$.readBy[#]',?)");
  assert.equal(d.jsonAppend('postgres', 'data', 'readBy'), "jsonb_set(data,'{readBy}',COALESCE(data->'readBy','[]'::jsonb)||jsonb_build_array(?::text))");
  assert.equal(d.jsonArrayHas('sqlite', 'data', 'readBy'), "EXISTS (SELECT 1 FROM json_each(data,'$.readBy') WHERE value=?)");
  assert.equal(d.jsonArrayHas('postgres', 'data', 'readBy'), "jsonb_exists(data->'readBy',?::text)");
  assert.equal(d.rowOrder('sqlite'), 'rowid');
  assert.equal(d.rowOrder('postgres'), 'seq');
  assert.equal(d.rowOrder('postgres', 'e'), 'e.seq');
  assert.equal(d.forUpdate('sqlite'), '');
  assert.equal(d.forUpdate('postgres'), ' FOR UPDATE');
});
await check('sql-dialect helpers reject unsafe identifiers and every `?` survives placeholder conversion', () => {
  assert.throws(() => dialect.jsonText('postgres', 'data', "x'); DROP TABLE t;--"), /Unsafe JSON key/);
  assert.throws(() => dialect.jsonText('sqlite', 'data; DROP', 'x'), /Unsafe SQL column/);
  assert.throws(() => dialect.jsonMerge('sqlite', 'data', []), /at least one/);
  const merged = dialect.jsonMerge('postgres', 'data', ['a', { key: 'b', kind: 'bool' }]);
  assert.equal(pg.toPositional(`UPDATE t SET data=${merged} WHERE id=?`), "UPDATE t SET data=data || jsonb_build_object('a',$1::text,'b',$2::boolean) WHERE id=$3");
});

// ---------------------------------------------------------------- store behaviour on a fake driver
function fakeDriver({ onStatement, onBegin } = {}) {
  const log = { statements: [], begins: [], ended: 0 };
  const respond = async (where, query, params, options) => {
    log.statements.push({ where, query, params, options });
    if (onStatement) return onStatement({ where, query, params, options, log });
    return Object.assign([], { count: 0 });
  };
  const sql = {
    unsafe: (query, params, options) => respond('pool', query, params, options),
    begin: async (modeOrRun, maybeRun) => {
      const run = typeof modeOrRun === 'function' ? modeOrRun : maybeRun;
      log.begins.push(typeof modeOrRun === 'string' ? modeOrRun : '');
      if (onBegin) await onBegin(log);
      const tx = { unsafe: (query, params, options) => respond('tx' + log.begins.length, query, params, options) };
      return run(tx);
    },
    end: async () => { log.ended++; },
  };
  return { sql, log };
}
const makeStore = (driver, extra = {}) => pg.createPostgresStore('postgres://u:p@h/x', { sql: driver.sql, sleep: async () => {}, random: () => 0, ...extra });
const err = (code, message = 'x') => Object.assign(new Error(message), { code });

await check('get/all/run: placeholders converted, extended protocol, changes from count, rows copied', async () => {
  const driver = fakeDriver({ onStatement: ({ query }) => Object.assign(query.startsWith('SELECT') ? [{ a: 1 }, { a: 2 }] : [], { count: query.startsWith('SELECT') ? 2 : 3 }) });
  const store = makeStore(driver);
  assert.equal(store.dialect, 'postgres');
  assert.deepEqual(await store.get('SELECT a FROM t WHERE x=?', 'v'), { a: 1 });
  assert.deepEqual(await store.all('SELECT a FROM t'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(await store.run('UPDATE t SET a=? WHERE b=?', 1, 'k'), { changes: 3, lastInsertRowid: 0 });
  const first = driver.log.statements[0];
  assert.equal(first.query, 'SELECT a FROM t WHERE x=$1');
  assert.deepEqual(first.params, ['v']);
  assert.equal(first.options.simple, false, 'never the multi-statement simple protocol');
  await store.exec('CREATE TABLE a(x int); CREATE TABLE b(y int)');
  const exec = driver.log.statements.at(-1);
  assert.equal(exec.query, 'CREATE TABLE a(x int); CREATE TABLE b(y int)', 'exec text is not converted');
  assert.equal(exec.params, undefined);
  await store.close();
  assert.equal(driver.log.ended, 1);
});
await check('statement driver errors are mapped (23505 -> 409, lock timeout -> 503)', async () => {
  let code = '23505';
  const store = makeStore(fakeDriver({ onStatement: () => { throw err(code, 'duplicate key (a)=(secret)'); } }));
  await assert.rejects(store.run('INSERT INTO t(a) VALUES (?)', 'x'), e => e.status === 409 && !/secret/.test(e.message));
  code = '55P03';
  await assert.rejects(store.get('SELECT 1'), e => e.status === 503 && /Another colleague/.test(e.message));
});
await check('transaction: statements run on the tx handle; nested calls join; result is returned', async () => {
  const driver = fakeDriver();
  const store = makeStore(driver);
  const result = await store.transaction(async () => {
    await store.run('INSERT INTO t(a) VALUES (?)', 1);
    return store.transaction(async () => { await store.run('INSERT INTO t(a) VALUES (?)', 2); return 'joined'; });
  });
  assert.equal(result, 'joined');
  assert.equal(driver.log.begins.length, 1, 'nested transaction did not open a second one');
  assert.deepEqual(driver.log.statements.map(s => s.where), ['tx1', 'tx1']);
  await store.get('SELECT 1');
  assert.equal(driver.log.statements.at(-1).where, 'pool', 'outside a transaction statements go to the pool');
  assert.equal(await store.transaction(() => 7), 7, 'a synchronous callback works');
});
await check('a failing transaction rethrows its error, is not retried, and a Promise.all sibling cannot keep writing', async () => {
  const driver = fakeDriver();
  const store = makeStore(driver);
  let sibling;
  await assert.rejects(store.transaction(async () => {
    sibling = (async () => { await sleep(20); await store.run('INSERT INTO t(a) VALUES (?)', 'leaked'); })();
    await Promise.all([Promise.reject(new Error('first')), sibling]);
  }), /first/);
  await assert.rejects(sibling, /rolled back/);
  assert.equal(driver.log.begins.length, 1);
  assert.equal(driver.log.statements.length, 0, 'the leaked statement never reached the driver');
  const app = new AppError('stale', 409);
  await assert.rejects(store.transaction(async () => { throw app; }), e => e === app);
});
await check('retry: 40001 and 40P01 are retried up to 3 tries with the callback re-run, then reported as 503 busy', async () => {
  for (const code of ['40001', '40P01']) {
    const driver = fakeDriver();
    const store = makeStore(driver);
    let runs = 0;
    const result = await store.transaction(async () => { runs++; await store.get('SELECT 1'); if (runs < 3) throw err(code); return 'ok'; });
    assert.equal(result, 'ok'); assert.equal(runs, 3); assert.equal(driver.log.begins.length, 3);
  }
  const store = makeStore(fakeDriver({ onStatement: () => { throw err('40001'); } }));
  let runs = 0;
  await assert.rejects(store.transaction(async () => { runs++; await store.get('SELECT 1'); }), e => e.status === 503 && e.message === 'Database busy. Try again.');
  assert.equal(runs, 3, 'max 3 tries');
  runs = 0;
  await assert.rejects(store.transaction(async () => { runs++; await store.get('SELECT 1'); }, { retries: 0 }), e => e.status === 503);
  assert.equal(runs, 1, 'retries: 0 means a single try');
  runs = 0;
  await assert.rejects(store.transaction(async () => { runs++; await store.get('SELECT 1'); }, { retries: 99 }), e => e.status === 503);
  assert.equal(runs, 3, 'retries is clamped to 2');
});
await check('retry: a connection failure before the first statement is retried; after one completed it is not', async () => {
  let failBegins = 2;
  const driver = fakeDriver({ onBegin: () => { if (failBegins-- > 0) throw err('CONNECTION_CLOSED', 'write CONNECTION_CLOSED host:6543'); } });
  const store = makeStore(driver);
  assert.equal(await store.transaction(async () => { await store.get('SELECT 1'); return 'ok'; }), 'ok');
  assert.equal(driver.log.begins.length, 3);

  let calls = 0;
  const midway = makeStore(fakeDriver({ onStatement: () => { calls++; if (calls === 2) throw err('CONNECTION_CLOSED'); return Object.assign([], { count: 0 }); } }));
  let runs = 0;
  await assert.rejects(midway.transaction(async () => { runs++; await midway.get('SELECT 1'); await midway.get('SELECT 2'); }), e => e.status === 503 && e.message === 'Database busy. Try again.');
  assert.equal(runs, 1, 'no retry once a statement completed');

  const down = makeStore(fakeDriver({ onBegin: () => { throw err('ECONNREFUSED', 'connect ECONNREFUSED 10.1.2.3:6543'); } }));
  await assert.rejects(down.transaction(async () => 1), e => e.status === 503 && !/10\.1\.2\.3/.test(e.message));
});
await check('retry: never after the callback finished (COMMIT failure)', async () => {
  const driver = fakeDriver();
  const store = makeStore({ ...driver, sql: { ...driver.sql, begin: async (run) => { await driver.sql.begin(run); throw err('40001', 'could not serialize at commit'); } } });
  let runs = 0;
  await assert.rejects(store.transaction(async () => { runs++; return 1; }), e => e.status === 503);
  assert.equal(runs, 1);
});
await check('snapshot opens a read-only REPEATABLE READ transaction; inside a transaction it joins', async () => {
  const driver = fakeDriver();
  const store = makeStore(driver);
  assert.equal(await store.snapshot(async () => { await store.get('SELECT 1'); return 'v'; }), 'v');
  assert.deepEqual(driver.log.begins, ['isolation level repeatable read read only']);
  await store.transaction(async () => { await store.snapshot(async () => { await store.get('SELECT 2'); }); });
  assert.equal(driver.log.begins.length, 2, 'only the outer transaction began');
  await store.snapshot(async () => { await store.transaction(async () => { await store.get('SELECT 3'); }); });
  assert.equal(driver.log.begins.length, 3, 'a transaction inside a snapshot joins the snapshot');
});
await check('lock: sorted, de-duplicated, one advisory statement per key, inside a transaction only', async () => {
  const driver = fakeDriver({ onStatement: ({ query }) => Object.assign(query.includes('try') ? [{ ok: true }] : [{ locked: '' }], { count: 1 }) });
  const store = makeStore(driver);
  await assert.rejects(store.lock('a'), /inside transaction/);
  await assert.rejects(store.tryLock('a'), /inside transaction/);
  await store.transaction(async () => { await store.lock('ck:name:b', 'lease:1', 'ck:name:a', 'ck:name:b'); });
  const locks = driver.log.statements.filter(s => s.query.includes('pg_advisory_xact_lock'));
  assert.deepEqual(locks.map(s => s.params[0]), ['ck:name:a', 'ck:name:b', 'lease:1']);
  assert.equal(locks[0].query, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0)) AS locked');
  assert.ok(locks.every(s => s.where === 'tx1'));
  assert.equal(await store.transaction(() => store.tryLock('act-prune')), true);
  await assert.rejects(store.transaction(() => store.lock('')), /non-empty/);
  await store.transaction(async () => { await store.lock(); });
});
await check('tryLock reports false when the lock is held elsewhere', async () => {
  const store = makeStore(fakeDriver({ onStatement: () => Object.assign([{ ok: false }], { count: 1 }) }));
  assert.equal(await store.transaction(() => store.tryLock('x')), false);
});

// ---------------------------------------------------------------- pool exhaustion bound (postgres.js has no queue timeout)
await check('client options: pinned driver needs no queue_timeout, silences notices', () => {
  const o = pg.buildClientOptions('postgres://u:p@h.example.com:6543/x', {});
  assert.ok(!('queue_timeout' in o));
  assert.equal(typeof o.onnotice, 'function');
});
await check('a pool statement that never gets a connection fails as 503 "Database busy" and is cancelled out of the queue', async () => {
  let cancelled = 0;
  const hung = { unsafe: () => ({ then: () => {}, cancel: () => { cancelled++; }, state: undefined }), begin: async () => {}, end: async () => {} };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql: hung, waitMs: 30 });
  const t = Date.now();
  await assert.rejects(store.get('SELECT 1'), e => e.status === 503 && e.message === 'Database busy. Try again.');
  assert.ok(Date.now() - t < 1000);
  assert.equal(cancelled, 1, 'a still-queued statement is removed from the driver queue');
  await assert.rejects(store.exec('SELECT 1'), e => e.status === 503);
});
await check('a statement already running is abandoned, not cancelled, and a late result is ignored', async () => {
  let cancelled = 0, finish;
  const slow = { unsafe: () => ({ then: (ok) => { finish = () => ok(Object.assign([{ a: 1 }], { count: 1 })); }, cancel: () => { cancelled++; }, state: {} }), begin: async () => {}, end: async () => {} };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql: slow, waitMs: 30 });
  await assert.rejects(store.get('SELECT 1'), e => e.status === 503);
  assert.equal(cancelled, 0);
  finish(); // the late result arrives: nothing throws, nothing is retried
});
await check('a transaction that cannot get a connection in time is abandoned: 503, no retry, callback never runs, empty transaction rolls back when the driver gets to it', async () => {
  let release, began = 0, rolledBack = 0, ran = 0, bodyThrew = null;
  const gate = new Promise(resolve => { release = resolve; });
  const sql = {
    unsafe: async () => Object.assign([], { count: 0 }),
    begin: async (run) => { began++; await gate; try { return await run({ unsafe: async () => Object.assign([], { count: 0 }) }); } catch (error) { rolledBack++; bodyThrew = error; throw error; } },
    end: async () => {},
  };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql, waitMs: 40, sleep: async () => {} });
  await assert.rejects(store.transaction(async () => { ran++; }), e => e.status === 503 && e.message === 'Database busy. Try again.');
  assert.equal(began, 1, 'a wait timeout is not retried');
  release(); await sleep(20);
  assert.equal(ran, 0, 'the abandoned callback never runs');
  assert.equal(rolledBack, 1, 'the driver rolled the empty transaction back');
  assert.equal(bodyThrew.code, 'RMC2_DB_WAIT_TIMEOUT');
});
await check('the wait bound stops once the transaction body has started (a slow body is not cut off by it)', async () => {
  const sql = { unsafe: async () => Object.assign([], { count: 0 }), begin: async (run) => run({ unsafe: async () => Object.assign([], { count: 0 }) }), end: async () => {} };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql, waitMs: 30 });
  assert.equal(await store.transaction(async () => { await sleep(90); return 'done'; }), 'done');
});

await check('gate: the driver never sees more concurrent statements/transactions than the pool size (it pipelines the overflow and the pooler hangs)', async () => {
  let inFlight = 0, peak = 0;
  const enter = async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(5); inFlight--; return Object.assign([{ one: 1 }], { count: 1 }); };
  const sql = { unsafe: enter, begin: async (a, b) => { const run = typeof a === 'function' ? a : b; inFlight++; peak = Math.max(peak, inFlight); try { return await run({ unsafe: async () => { await sleep(2); return Object.assign([{ one: 1 }], { count: 1 }); } }); } finally { inFlight--; } }, end: async () => {} };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql });
  await Promise.all([
    ...Array.from({ length: 20 }, () => store.get('SELECT 1')),
    ...Array.from({ length: 10 }, () => store.transaction(async () => { await store.get('SELECT 1'); await store.get('SELECT 2'); })),
    ...Array.from({ length: 5 }, () => store.snapshot(() => store.get('SELECT 3'))),
    ...Array.from({ length: 5 }, () => store.exec('SELECT 4')),
  ]);
  assert.ok(peak <= 3, 'peak concurrency ' + peak);
  assert.ok(peak >= 2, 'but it is still parallel (' + peak + ')');
  assert.equal(inFlight, 0);
});
await check('gate: work queued behind a stuck connection fails as 503 after the wait bound, and later work still runs', async () => {
  let release;
  const stuck = new Promise(resolve => { release = resolve; });
  const sql = { unsafe: async (q) => { if (q === 'HOLD') await stuck; return Object.assign([{ one: 1 }], { count: 1 }); }, begin: async (run) => run({ unsafe: async () => Object.assign([], { count: 0 }) }), end: async () => {} };
  const store = pg.createPostgresStore('postgres://u:p@h/x', { sql, connections: 1, waitMs: 40 });
  const holder = store.get('HOLD').catch(error => error); // abandoned by the wait bound too, but its connection stays reserved
  await assert.rejects(store.get('SELECT 1'), e => e.status === 503 && e.message === 'Database busy. Try again.');
  await assert.rejects(store.transaction(async () => 1), e => e.status === 503);
  assert.equal((await holder).status, 503);
  await assert.rejects(store.get('SELECT 1'), e => e.status === 503, 'the slot of an abandoned statement is not handed on while it still runs');
  release(); await sleep(20);
  assert.equal((await store.get('SELECT 1')).one, 1, 'once the stuck statement settles the slot is free again');
});

// ---------------------------------------------------------------- live (only with RMC2_DATABASE_URL)
if (!liveUrl) {
  console.log('\nSKIP live Postgres checks: RMC2_DATABASE_URL is not set');
} else {
  process.env.RMC2_DATABASE_SSL = liveSsl ?? '';
  if (!liveSsl) delete process.env.RMC2_DATABASE_SSL;
  const open = () => pg.createPostgresStore(liveUrl);
  const stores = [];
  const live = () => { const s = open(); stores.push(s); return s; };
  const key = name => `selftest:${Date.now()}:${Math.random().toString(36).slice(2)}:${name}`;
  try {
    await check('live: connects, placeholders and types (int8 -> Number, jsonb -> raw text)', async () => {
      const store = live();
      const row = await store.get('SELECT ?::int AS n, count(*) AS c, ?::jsonb AS j, \'what?\' AS q', 5, '{"a":[1,2]}');
      assert.equal(row.n, 5);
      assert.equal(row.c, 1); assert.equal(typeof row.c, 'number');
      assert.equal(typeof row.j, 'string'); assert.deepEqual(JSON.parse(row.j), { a: [1, 2] });
      assert.equal(row.q, 'what?');
    });
    await check('live: transaction commit/rollback, changes, 23505 -> 409, nested join (TEMP table)', async () => {
      const store = live();
      await store.transaction(async () => {
        await store.exec('CREATE TEMP TABLE t_selftest (id int PRIMARY KEY, note text) ON COMMIT DROP');
        const r = await store.run('INSERT INTO t_selftest (id,note) VALUES (?,?),(?,?)', 1, 'a', 2, 'b');
        assert.equal(r.changes, 2);
        assert.equal((await store.run('UPDATE t_selftest SET note=? WHERE id=?', 'z', 2)).changes, 1);
        assert.equal((await store.run('UPDATE t_selftest SET note=? WHERE id=?', 'z', 99)).changes, 0);
        await store.transaction(async () => { assert.equal((await store.get('SELECT count(*) AS c FROM t_selftest')).c, 2); });
        await assert.rejects(store.run('INSERT INTO t_selftest (id,note) VALUES (?,?)', 1, 'dup'), e => e.status === 409);
      }).catch(e => { if (e.status !== 409 && !/aborted|25P02/.test(String(e.message))) throw e; });
      // the rejected statement aborted the transaction; nothing leaked and the store still works
      assert.equal((await store.get('SELECT 1 AS one')).one, 1);
      await assert.rejects(store.transaction(async () => { await store.exec('CREATE TEMP TABLE t_rollback (x int) ON COMMIT DROP'); throw new Error('boom'); }), /boom/);
    });
    await check('live: snapshot is read-only', async () => {
      const store = live();
      await assert.rejects(store.snapshot(async () => { await store.exec('CREATE TEMP TABLE t_ro (x int)'); }), e => /read-only/i.test(String(e.message)) || e.code === '25006');
      assert.equal((await store.snapshot(() => store.get('SHOW transaction_isolation'))).transaction_isolation, 'repeatable read');
    });
    await check('live: advisory locks exclude across transactions; tryLock is non-blocking; lock timeout -> 503', async () => {
      const a = live(), b = live();
      const k = key('mutex');
      let release; const gate = new Promise(r => { release = r; });
      let held; const heldPromise = new Promise(r => { held = r; });
      const holder = a.transaction(async () => { await a.lock(k); held(); await gate; });
      await heldPromise;
      assert.equal(await b.transaction(() => b.tryLock(k)), false);
      await assert.rejects(b.transaction(async () => { await b.exec("SET LOCAL lock_timeout = '300ms'"); await b.lock(k); }, { retries: 0 }),
        e => e.status === 503 && /Another colleague/.test(e.message));
      release(); await holder;
      assert.equal(await b.transaction(() => b.tryLock(k)), true);
    });
    await check('live: a deadlock is detected and the victim is retried to completion', async () => {
      const a = live(), b = live();
      const k1 = key('d1'), k2 = key('d2');
      let started = 0; const bothStarted = new Promise(resolve => { globalThis.__bothStarted = resolve; });
      const worker = (store, first, second) => store.transaction(async () => {
        // raw statements so the two transactions really take the locks in opposite order
        await store.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', first);
        if (++started === 2) globalThis.__bothStarted();
        await Promise.race([bothStarted, sleep(2000)]);
        await store.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', second);
        return 'done';
      });
      const results = await Promise.all([worker(a, k1, k2), worker(b, k2, k1)]);
      assert.deepEqual(results, ['done', 'done']);
      delete globalThis.__bothStarted;
    });
    await check('live: more work than connections never hangs (12 parallel statements, 6 parallel transactions on max 3)', async () => {
      const store = live();
      const t0 = Date.now();
      await store.get('SELECT 1'); // warm the pool: overflow on a WARM pool is what hangs the raw driver
      const statements = await Promise.all(Array.from({ length: 12 }, (_, i) => store.get('SELECT pg_sleep(0.1), ?::int AS n', i)));
      assert.deepEqual(statements.map(r => r.n), Array.from({ length: 12 }, (_, i) => i));
      const transactions = await Promise.all(Array.from({ length: 6 }, (_, i) => store.transaction(async () => {
        await store.get('SELECT pg_sleep(0.1)');
        return (await store.get('SELECT ?::int AS n', i)).n;
      })));
      assert.deepEqual(transactions, [0, 1, 2, 3, 4, 5]);
      const snapshots = await Promise.all(Array.from({ length: 6 }, () => store.snapshot(() => store.get('SELECT 1 AS one'))));
      assert.ok(snapshots.every(r => r.one === 1));
      const mixed = await Promise.all([
        ...Array.from({ length: 30 }, () => store.get('SELECT 1 AS one')),
        ...Array.from({ length: 8 }, () => store.transaction(async () => (await store.get('SELECT 2 AS one')).one)),
        ...Array.from({ length: 4 }, () => store.exec('SELECT 3')),
      ]);
      assert.equal(mixed.length, 42);
      for (let round = 0; round < 3; round++) await Promise.all(Array.from({ length: 25 }, () => store.get('SELECT 1 AS one')));
      assert.ok(Date.now() - t0 < 20000, 'finished well inside the 15 s wait bound');
    });
    await check('live: SQL errors outside the mapped set pass through; an aborted store still serves the next statement', async () => {
      const store = live();
      await assert.rejects(store.get('SELECT * FROM definitely_missing_table_xyz'), e => e.code === '42P01');
      assert.equal((await store.get('SELECT 1 AS one')).one, 1);
    });
  } finally {
    for (const s of stores) await s.close().catch(() => {});
  }
}

console.log('\n' + passed + ' Postgres adapter checks passed' + (liveUrl ? ' (including live)' : ' (unit only; live part skipped)'));
