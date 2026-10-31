// Phase 4: the Postgres branches of the application SQL, exercised offline. The real Postgres store runs on a recording
// fake driver (no database, no network); every statement the app issues must have as many `$n` placeholders as
// parameters, no leftover `?`, run on the right connection (transaction vs pool), and take its advisory locks inside
// a transaction. This cannot prove the SQL is valid on a server (the live T1-T10 run does); it catches the mistakes a
// SQLite-only test cannot: placeholder drift, missing locks, writes inside a snapshot, locks outside a transaction.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const dir = path.resolve('test-results', 'phase4-pg-sql', String(Date.now()));
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
mkdirSync(dir, { recursive: true });
process.env.RMC2_DATA_DIR = path.join(dir, 'app-data'); // must stay untouched: the SQLite adapter is never opened
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_|DB$|DATABASE)/.test(key) || key === 'VERCEL') delete process.env[key];
process.env.RMC2_SEED_DEMO = '1';
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const pg = await imp('store-postgres.ts');

const log = [];
let handler = () => [];
const rows = (list = [], count = list.length) => Object.assign(list, { count });
const record = id => ({ id, revision: 1, status: 'New inquiry', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', fields: { company: 'Acme Corp', contactName: 'Pat Lee' }, source: { filename: 'f.xlsx', storage: 's', sheet: '', cells: [], fields: { company: 'Acme Corp', contactName: 'Pat Lee' }, sourceHash: 'h1' }, submissions: [], handledBy: [], history: [], chat: [], detailRequests: [], emailOverrides: [], email: {}, notes: '', returnNote: '', returnFlags: [] });
const record1 = (query, params, where) => { log.push({ query, params: params ?? [], where }); return handler(query, params ?? [], where); };
const fake = {
  unsafe: async (query, params) => { const r = record1(query, params, 'pool'); return r ?? rows(); },
  begin: async (modeOrRun, maybeRun) => {
    const run = typeof modeOrRun === 'function' ? modeOrRun : maybeRun;
    const tag = typeof modeOrRun === 'string' ? 'snapshot' : 'tx';
    log.push({ query: 'BEGIN', params: [], where: tag });
    return run({ unsafe: async (query, params) => { const r = record1(query, params, tag); return r ?? rows(); } });
  },
  end: async () => {},
};
globalThis.rmc2Store = pg.createPostgresStore('postgres://u:p@127.0.0.1:1/x', { sql: fake, sleep: async () => {}, random: () => 0 });
const database = await imp('database.ts'), accounts = await imp('accounts.ts'), activity = await imp('activity.ts'), index = await imp('inquiry-index.ts');
const { db } = database;
assert.equal(db.dialect, 'postgres');

let passed = 0;
const check = async (name, fn) => { log.length = 0; handler = () => rows(); await fn(); passed++; console.log('PASS ' + name); };
const sqlOf = pattern => log.filter(entry => pattern.test(entry.query));
const placeholders = query => { const found = [...query.matchAll(/\$(\d+)/g)].map(match => Number(match[1])); return found.length ? Math.max(...found) : 0; };
const assertWellFormed = () => {
  for (const entry of log) {
    if (entry.query === 'BEGIN') continue;
    assert.ok(!/\?/.test(entry.query.replace(/'[^']*'/g, '')), 'unconverted ? in: ' + entry.query.slice(0, 160));
    assert.equal(placeholders(entry.query), entry.params.length, `placeholders vs params in: ${entry.query.slice(0, 200)}`);
    if (/pg_advisory_xact_lock|pg_try_advisory_xact_lock/.test(entry.query)) assert.notEqual(entry.where, 'pool', 'advisory lock outside a transaction');
  }
};

await check('login rate limit: one atomic upsert with matching placeholders, 429 when blocked', async () => {
  handler = () => rows([{ blocked_until: 0 }]);
  await accounts.checkRate('login:x');
  assertWellFormed();
  assert.equal(log.length, 1);
  assert.match(log[0].query, /^INSERT INTO auth_attempts .*\sON CONFLICT\(key\) DO UPDATE SET\s.*\sRETURNING blocked_until$/s);
  assert.equal(log[0].where, 'pool', 'autocommit: the attempt is counted even if the request later fails');
  handler = () => rows([{ blocked_until: Date.now() + 60000 }]);
  await assert.rejects(accounts.checkRate('login:x'), e => e.status === 429);
});
await check('activity read is a pure SELECT (DISTINCT ON owner) with quoted camelCase aliases and no writes', async () => {
  handler = () => rows();
  assert.deepEqual(await activity.activeInquiryActivity(), []);
  assertWellFormed();
  const [read] = log;
  assert.match(read.query, /DISTINCT ON \(inquiry_id\)/);
  assert.match(read.query, /AS "inquiryId".*AS "userId".*AS "startedAt".*AS "seenAt"/s);
  assert.match(read.query, /\(u\.data->>'role'\) IN/);
  assert.ok(!/INSERT|UPDATE|DELETE/.test(read.query));
});
await check('activity prune runs in a transaction behind tryLock and is skipped when another request holds it', async () => {
  handler = query => /pg_try_advisory_xact_lock/.test(query) ? rows([{ ok: true }]) : rows();
  await db.transaction(() => activity.pruneActivity());
  assertWellFormed();
  assert.equal(sqlOf(/^DELETE FROM inquiry_activity/).length, 3);
  log.length = 0;
  handler = query => /pg_try_advisory_xact_lock/.test(query) ? rows([{ ok: false }]) : rows();
  await db.transaction(() => activity.pruneActivity());
  assert.equal(sqlOf(/^DELETE/).length, 0, 'a second pruner does nothing');
});
await check('starting to handle an inquiry takes lease:<id> first, inside the transaction', async () => {
  handler = query => /FROM inquiries WHERE id=/.test(query) ? rows([{ data: JSON.stringify(record('INQ-1')) }]) : /pg_try_advisory/.test(query) ? rows([{ ok: true }]) : rows();
  await activity.updateInquiryActivity('INQ-1', { id: 'u', role: 'Admin', active: true }, 's', { tab: '11111111-1111-4111-8111-111111111111', action: 'leave' });
  assertWellFormed();
  const lock = log.find(entry => /pg_advisory_xact_lock/.test(entry.query));
  assert.deepEqual(lock.params, ['lease:INQ-1']);
  assert.equal(lock.where, 'tx');
  assert.equal(log.findIndex(entry => entry === lock) < log.findIndex(entry => /^SELECT data FROM inquiries/.test(entry.query)), true, 'lock before the first read');
});
await check('synchronizeInquiryIndex: idx-sync lock, DELETE ... RETURNING claim, upsert + ON CONFLICT DO NOTHING keys, no savepoint', async () => {
  handler = query => /FROM inquiry_index_pending LIMIT 1/.test(query) ? rows([{ id: 'INQ-1' }])
    : /^DELETE FROM inquiry_index_pending RETURNING id/.test(query) ? rows([{ id: 'INQ-1' }, { id: 'INQ-2' }])
    : /^SELECT data FROM inquiries WHERE id=/.test(query) ? rows([{ data: JSON.stringify(record('INQ-1')) }]) : rows();
  await index.synchronizeInquiryIndex();
  assertWellFormed();
  assert.deepEqual(log.find(entry => /pg_advisory_xact_lock/.test(entry.query)).params, ['idx-sync']);
  const order = log.map(entry => entry.query.slice(0, 22));
  assert.ok(order.findIndex(q => q.startsWith('SELECT pg_advisory')) < order.findIndex(q => q.startsWith('DELETE FROM inquiry_in')));
  assert.equal(sqlOf(/^INSERT INTO inquiry_summaries \(id,data,summary\)/).length, 2);
  assert.ok(sqlOf(/^INSERT INTO inquiry_keys/).every(entry => /ON CONFLICT DO NOTHING$/.test(entry.query)));
  assert.ok(!log.some(entry => /SAVEPOINT|SKIP LOCKED/i.test(entry.query)));
});
await check('registry locks: identity keys sorted and taken before the matching read; global fallback honoured', async () => {
  handler = query => /^SELECT data FROM inquiries WHERE id=/.test(query) ? rows([{ data: JSON.stringify(record('INQ-1')) }]) : rows();
  await db.transaction(() => index.lockedInquiry('INQ-1', current => ({ source: current.source, fields: { ...current.fields, company: 'Beta Inc' } })));
  assertWellFormed();
  const locks = sqlOf(/pg_advisory_xact_lock/).map(entry => entry.params[0]);
  assert.deepEqual(locks, [...locks].sort());
  assert.deepEqual(locks, ['ck:company:acme corporation', 'ck:company:beta incorporated', 'ck:file:h1', 'ck:person:pat lee']);
  assert.equal(sqlOf(/^SELECT data FROM inquiries/).length, 2, 'read before and after the lock');
  log.length = 0;
  process.env.RMC2_PG_GLOBAL_REGISTRY_LOCK = '1';
  await db.transaction(() => index.lockedInquiry('INQ-1'));
  delete process.env.RMC2_PG_GLOBAL_REGISTRY_LOCK;
  assert.deepEqual(sqlOf(/pg_advisory_xact_lock/).map(entry => entry.params[0]), ['ck:global']);
});
await check('ensureReady: schema check fails closed on a mismatch and does not cache the failure', async () => {
  handler = query => /schema_version/.test(query) ? rows([{ value: '99' }]) : rows();
  await assert.rejects(database.ensureReady(), /schema is not at the version/);
  assert.ok(!log.some(entry => /^(INSERT|CREATE|UPDATE|DELETE)/.test(entry.query)), 'nothing is written when the version is wrong');
  handler = query => /schema_version/.test(query) ? rows([{ value: database.EXPECTED_SCHEMA_VERSION }]) : rows();
  await database.ensureReady(); // a fresh check, not a cached rejection
});
await check('seed (empty users): seed lock inside a transaction, column lists, then the projection reindex when the version differs', async () => {
  // ensureReady above already memoised success; use a fresh process-level slot
  delete globalThis.rmc2Ready;
  log.length = 0;
  let seeded = false;
  handler = query => /schema_version/.test(query) ? rows([{ value: database.EXPECTED_SCHEMA_VERSION }])
    : /projection_version'$/.test(query) ? rows([{ value: '0' }])
    : /^SELECT id FROM users LIMIT 1/.test(query) ? rows(seeded ? [{ id: 'x' }] : [])
    : /^INSERT INTO users/.test(query) ? (seeded = true, rows([], 1)) : rows();
  await database.ensureReady();
  assertWellFormed();
  const seedLock = log.find(entry => /pg_advisory_xact_lock/.test(entry.query) && entry.params[0] === 'seed');
  assert.ok(seedLock && seedLock.where === 'tx');
  assert.equal(sqlOf(/^INSERT INTO users\(id,data,password\)/).length, 6);
  assert.equal(sqlOf(/^INSERT INTO inquiries\(id,revision,data\)/).length, 4);
  assert.equal(sqlOf(/^INSERT INTO notifications\(id,data\)/).length, 4);
  assert.ok(sqlOf(/^INSERT INTO inquiries/).every(entry => entry.where === 'tx'));
  assert.deepEqual(sqlOf(/^INSERT INTO app_meta/).map(entry => entry.params), [[database.PROJECTION_VERSION]]);
  assert.ok(sqlOf(/^INSERT INTO inquiry_index_pending/).length === 1);
  assert.ok(log.some(entry => /pg_advisory_xact_lock/.test(entry.query) && entry.params[0] === 'idx-sync'));
});
await check('seed is skipped when users exist or demo seeding is off; the second instance finds users under the lock', async () => {
  delete globalThis.rmc2Ready; log.length = 0;
  handler = query => /schema_version/.test(query) ? rows([{ value: '1' }]) : /projection_version/.test(query) ? rows([{ value: database.PROJECTION_VERSION }]) : /FROM users LIMIT 1/.test(query) ? rows([{ id: 'cryssa' }]) : rows();
  await database.ensureReady();
  assert.equal(sqlOf(/^INSERT/).length, 0);
  delete globalThis.rmc2Ready; log.length = 0; process.env.RMC2_SEED_DEMO = '0';
  const warn = console.warn; const warned = []; console.warn = (...args) => warned.push(args.join(' '));
  handler = query => /schema_version/.test(query) ? rows([{ value: '1' }]) : /projection_version/.test(query) ? rows([{ value: database.PROJECTION_VERSION }]) : rows();
  try { await database.ensureReady(); } finally { console.warn = warn; process.env.RMC2_SEED_DEMO = '1'; }
  assert.equal(sqlOf(/^INSERT/).length, 0); assert.match(warned.join(), /demo seed disabled/);
  delete globalThis.rmc2Ready; log.length = 0; let reads = 0;
  handler = query => /schema_version/.test(query) ? rows([{ value: '1' }]) : /projection_version/.test(query) ? rows([{ value: database.PROJECTION_VERSION }]) : /FROM users LIMIT 1/.test(query) ? rows(++reads > 1 ? [{ id: 'racer' }] : []) : rows();
  await database.ensureReady();
  assert.equal(sqlOf(/^INSERT/).length, 0, 'another instance seeded between the check and the lock');
});
await check('lockInquiryRows takes FOR UPDATE in sorted id order; jsonParam strips NUL for jsonb', async () => {
  await db.transaction(() => database.lockInquiryRows(['INQ-9', 'INQ-2', 'INQ-9']));
  assertWellFormed();
  const select = log.find(entry => /FOR UPDATE$/.test(entry.query));
  assert.equal(select.query, 'SELECT id FROM inquiries WHERE id IN ($1,$2) ORDER BY id FOR UPDATE');
  assert.deepEqual(select.params, ['INQ-2', 'INQ-9']);
  assert.equal(database.jsonParam({ a: 'x\u0000y' }), '{"a":"xy"}');
});

console.log('\n' + passed + ' Postgres call-site checks passed (fake driver, no database; .data and the SQLite adapter untouched)');
