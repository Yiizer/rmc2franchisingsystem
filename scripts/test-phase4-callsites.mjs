// Phase 4 call-site tests on SQLite (throwaway data dir, no network, no server): the portable pieces that replaced
// SQLite-only SQL (inquiry counter, atomic login rate limit, pure activity read + prune) and a static guard that keeps
// SQLite-only constructs out of the application SQL. The Postgres behaviour of the same code is covered by the live
// checks in test-store-postgres.mjs / the T1-T10 run.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const dir = path.resolve('test-results', 'phase4-callsites', String(Date.now()));
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
mkdirSync(dir, { recursive: true });
process.env.RMC2_DATA_DIR = path.join(dir, 'app-data');
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_|DB$|DATABASE)/.test(key) || key === 'VERCEL') delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const database = await imp('database.ts'), accounts = await imp('accounts.ts'), activity = await imp('activity.ts'), index = await imp('inquiry-index.ts'), forms = await imp('forms.ts'), svc = await imp('service.ts');
const { db } = database;

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const status = async (fn, code) => { try { await fn(); } catch (e) { assert.equal(e.status, code, e.message); return e; } assert.fail('expected ' + code); };

// ---------------------------------------------------------------- static guard
await check('application SQL stays inside the portable subset (no SQLite-only constructs outside the dialect helpers)', () => {
  const skip = new Set(['sql-dialect.ts', 'workspace-schema.ts', 'store.ts', 'store-postgres.ts']);
  const forbidden = [
    [/json_extract|json_set|json_insert|json_each|json_array_length/, 'JSON functions go through sql-dialect'],
    [/\browid\b/, 'rowid -> rowOrder()'],
    [/INSERT OR (IGNORE|REPLACE)/i, 'use ON CONFLICT'],
    [/\bSAVEPOINT\b/i, 'no savepoints'],
    [/INSERT INTO \w+ VALUES/i, 'column list on every INSERT'],
    [/\bdatetime\(|\bLIKE\b|\bGLOB\b/i, 'no datetime()/LIKE/GLOB'],
  ];
  for (const file of readdirSync('lib/operations').filter(name => name.endsWith('.ts') && !skip.has(name))) {
    let text = readFileSync(path.join('lib/operations', file), 'utf8');
    if (file === 'database.ts') text = text.slice(text.indexOf('export type DatabaseSelection')); // openDatabase() is the SQLite adapter's DDL
    for (const [pattern, why] of forbidden) {
      const hit = text.split('\n').find(line => pattern.test(line) && !/^\s*(\/\/|\*)/.test(line) && !/z\.string\(\)\.datetime/.test(line));
      assert.ok(!hit, `${file}: ${why}: ${hit?.trim().slice(0, 120)}`);
    }
  }
  const route = readFileSync('app/api/operations/[[...path]]/route.ts', 'utf8');
  for (const [pattern, why] of forbidden) assert.ok(!pattern.test(route), 'route.ts: ' + why);
});

// ---------------------------------------------------------------- inquiry counter
const employee = (await database.allUsers()).find(user => user.id === 'cryssa');
const importForm = async (company, agent) => {
  const fields = { company, sector: 'Private', agentName: agent, agentEmail: agent.toLowerCase().replace(/\s+/g, '.') + '@example.test', agentPhone: '09171234567', contactName: 'Contact of ' + company, addressee: 'Contact of ' + company, contactEmail: 'contact@example.test', division: 'Division 1' };
  const bytes = await forms.sampleForm(fields);
  return svc.intake(employee, new File([bytes], company.replace(/\W+/g, '-') + '.xlsx'), fields.agentEmail);
};
await check('inquiry numbers come from the counter row: sequential, distinct under parallel imports, rolled back with a failed transaction', async () => {
  assert.equal((await db.get("SELECT n FROM counters WHERE name='inquiry'")).n, 129);
  const first = await importForm('Counter Alpha Corp', 'Agent One');
  assert.match(first.id, /^INQ-\d{4}-00130$/);
  const batch = await Promise.all(Array.from({ length: 6 }, (_, i) => importForm('Counter Batch ' + i + ' Inc', 'Agent B' + i)));
  const numbers = batch.map(record => Number(record.id.split('-').at(-1))).sort((a, b) => a - b);
  assert.deepEqual(numbers, [131, 132, 133, 134, 135, 136]);
  const before = (await db.get("SELECT n FROM counters WHERE name='inquiry'")).n;
  await assert.rejects(database.transaction(async () => {
    await db.get("UPDATE counters SET n=n+1 WHERE name='inquiry' RETURNING n");
    throw new Error('boom');
  }), /boom/);
  assert.equal((await db.get("SELECT n FROM counters WHERE name='inquiry'")).n, before, 'a rolled-back transaction gives its number back');
});

// ---------------------------------------------------------------- atomic login rate limit
await check('rate limit: the 9th attempt in a window is blocked before any password check; success clears the counter', async () => {
  const key = 'login:test-a';
  for (let i = 0; i < 8; i++) await accounts.checkRate(key);
  const blocked = await status(() => accounts.checkRate(key), 429);
  assert.match(blocked.message, /Too many attempts/);
  await status(() => accounts.checkRate(key), 429); // stays blocked
  await db.run('DELETE FROM auth_attempts WHERE key=?', key); // what a successful sign-in does
  await accounts.checkRate(key);
  assert.equal((await db.get('SELECT failures FROM auth_attempts WHERE key=?', key)).failures, 1);
});
await check('rate limit: 100 parallel attempts let exactly 8 through', async () => {
  const key = 'login:test-parallel';
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => accounts.checkRate(key)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 8);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429));
});
await check('rate limit: the window restarts after 15 minutes, a lapsed block is lifted, other keys are independent', async () => {
  const key = 'login:test-window';
  for (let i = 0; i < 9; i++) await accounts.checkRate(key).catch(() => {});
  await status(() => accounts.checkRate(key), 429);
  const past = Date.now() - 16 * 60000;
  await db.run('UPDATE auth_attempts SET window_start=?,blocked_until=? WHERE key=?', past, past + 15 * 60000, key);
  await accounts.checkRate(key);
  const row = await db.get('SELECT failures,blocked_until FROM auth_attempts WHERE key=?', key);
  assert.equal(row.failures, 1); assert.equal(row.blocked_until, 0);
  await accounts.checkRate('login:test-other');
  assert.equal((await db.get('SELECT failures FROM auth_attempts WHERE key=?', 'login:test-other')).failures, 1);
});
await check('authenticate: wrong passwords are counted, the 9th attempt is blocked even with the right password, a good sign-in resets', async () => {
  const login = (password, email = 'emerson@rmc2.local') => accounts.authenticate({ email, password });
  for (let i = 0; i < 8; i++) await status(() => login('wrong-password-' + i), 401);
  await status(() => login(database.LOCAL_PASSWORD), 429);
  await db.run('DELETE FROM auth_attempts');
  const user = await login(database.LOCAL_PASSWORD);
  assert.equal(user.id, 'emerson');
  assert.equal(await db.get('SELECT 1 FROM auth_attempts WHERE key LIKE ?', 'login:%'), undefined, 'success deletes the row');
});

// ---------------------------------------------------------------- activity: pure read + prune
const leaseTarget = await importForm('Lease Holdings Corp', 'Agent Lease');
const sessionOf = async (user, token) => { await db.run('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)', token, user.id, new Date(Date.now() + 3600000).toISOString()); return token; };
const jefferson = (await database.allUsers()).find(user => user.id === 'jefferson');
const tabA = '11111111-1111-4111-8111-111111111111', tabB = '22222222-2222-4222-8222-222222222222';
await check('activeInquiryActivity is a pure read: it ignores expired leases and dead sessions without deleting them', async () => {
  const sessionA = await sessionOf(employee, 'sess-a');
  await db.run('INSERT INTO inquiry_activity (session,tab,inquiry_id,user_id,started_at,seen_at) VALUES (?,?,?,?,?,?)', sessionA, tabA, leaseTarget.id, employee.id, new Date().toISOString(), new Date().toISOString());
  await db.run('INSERT INTO inquiry_activity (session,tab,inquiry_id,user_id,started_at,seen_at) VALUES (?,?,?,?,?,?)', 'sess-dead', tabB, leaseTarget.id, jefferson.id, new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  await db.run('INSERT INTO inquiry_activity (session,tab,inquiry_id,user_id,started_at,seen_at) VALUES (?,?,?,?,?,?)', sessionA, 'old-tab', leaseTarget.id, employee.id, new Date(Date.now() - 600000).toISOString(), new Date(Date.now() - 300000).toISOString());
  const rowsBefore = (await db.get('SELECT COUNT(*) n FROM inquiry_activity')).n;
  const read = await activity.activeInquiryActivity();
  assert.deepEqual(read.map(row => [row.inquiryId, row.userId]), [[leaseTarget.id, employee.id]], 'one owner; the dead session and the stale tab are ignored');
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_activity')).n, rowsBefore, 'reading deleted nothing');
  await database.transaction(() => activity.pruneActivity());
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_activity')).n, 1, 'prune removes exactly what the read ignores');
  assert.deepEqual(await activity.activeInquiryActivity(), read);
});
await check('the earliest lease owns the inquiry; the later user is reported as a colleague, start is refused with 423', async () => {
  const sessionJ = await sessionOf(jefferson, 'sess-j');
  const owners = await activity.activeInquiryActivity();
  assert.equal(owners.find(row => row.inquiryId === leaseTarget.id).userId, employee.id);
  const e = await status(() => activity.updateInquiryActivity(leaseTarget.id, jefferson, sessionJ, { tab: tabB, action: 'start' }), 423);
  assert.match(e.message, /is handling this inquiry/);
  const mine = await activity.updateInquiryActivity(leaseTarget.id, employee, 'sess-a', { tab: tabA, action: 'heartbeat' });
  assert.equal(mine.handling, true);
  const left = await activity.updateInquiryActivity(leaseTarget.id, employee, 'sess-a', { tab: tabA, action: 'leave' });
  assert.equal(left.handling, false); assert.deepEqual(left.activity, []);
  const started = await activity.updateInquiryActivity(leaseTarget.id, jefferson, sessionJ, { tab: tabB, action: 'start' });
  assert.equal(started.handling, true);
  await activity.updateInquiryActivity(leaseTarget.id, jefferson, sessionJ, { tab: tabB, action: 'leave' });
});
await check('the throttled poll prune runs in a transaction and never throws', async () => {
  await activity.pruneActivityThrottled();
  await activity.pruneActivityThrottled();
});

// ---------------------------------------------------------------- index + registry locks
await check('registryLockKeys: sorted, de-duplicated, union for edits, global fallback, none for sample forms', async () => {
  const a = { fields: { company: 'Zeta Corp', contactName: 'Pat Lee' }, source: { fields: { company: 'Zeta Corp', contactName: 'Pat Lee' }, sourceHash: 'abc' } };
  const b = { fields: { company: 'Alpha Co', contactName: 'Pat Lee' }, source: a.source };
  const keys = index.registryLockKeys(a, b);
  assert.deepEqual(keys, [...new Set(keys)].sort());
  assert.ok(keys.includes('ck:company:zeta corporation') && keys.includes('ck:company:alpha company') && keys.includes('ck:person:pat lee') && keys.includes('ck:file:abc'));
  assert.equal(keys.length, 4);
  process.env.RMC2_PG_GLOBAL_REGISTRY_LOCK = '1';
  assert.deepEqual(index.registryLockKeys(a, b), ['ck:global']);
  delete process.env.RMC2_PG_GLOBAL_REGISTRY_LOCK;
  const sample = { fields: { company: 'X' }, source: { filename: 'Sample franchise form.xlsx', storage: '', fields: { company: 'X' }, cells: [], sheet: 'Sheet1' } };
  assert.deepEqual(index.registryLockKeys(sample), []);
});
await check('synchronizeInquiryIndex claims its work: concurrent runs project every inquiry exactly once, nothing stays pending', async () => {
  await db.run('INSERT INTO inquiry_index_pending (id) SELECT id FROM inquiries WHERE true ON CONFLICT DO NOTHING');
  const queued = (await db.get('SELECT COUNT(*) n FROM inquiry_index_pending')).n;
  assert.ok(queued > 3);
  await Promise.all([index.synchronizeInquiryIndex(), index.synchronizeInquiryIndex(), index.synchronizeInquiryIndex()]);
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_index_pending')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_summaries')).n, (await db.get('SELECT COUNT(*) n FROM inquiries')).n);
  const record = await database.inquiry(leaseTarget.id);
  assert.ok(Array.isArray(await index.matchingInquiries(record)));
});
await check('enqueueFullReindex re-queues everything and a sync rebuilds the index', async () => {
  await database.enqueueFullReindex();
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_index_pending')).n, (await db.get('SELECT COUNT(*) n FROM inquiries')).n);
  await index.synchronizeInquiryIndex();
  assert.equal((await db.get('SELECT COUNT(*) n FROM inquiry_index_pending')).n, 0);
});
await check('lockedInquiry, lock and snapshot are harmless on SQLite', async () => {
  const record = await database.transaction(() => index.lockedInquiry(leaseTarget.id, current => ({ source: current.source, fields: { ...current.fields, company: 'Renamed Co' } })));
  assert.equal(record.id, leaseTarget.id);
  assert.equal(await db.snapshot(() => db.get('SELECT 1 AS one')).then(row => row.one), 1);
  await database.lockInquiryRows([leaseTarget.id, 'x']);
  assert.equal(db.inTransaction(), false);
  await database.transaction(async () => assert.equal(db.inTransaction(), true));
});
await check('jsonParam strips NUL only for Postgres; the SQLite text is written unchanged', () => {
  const value = { a: 'x\u0000y' };
  assert.equal(database.jsonParam(value), JSON.stringify(value));
});

// ---------------------------------------------------------------- readiness
await check('ensureReady is a no-op on SQLite; databaseLabel names the engine', async () => {
  await database.ensureReady();
  assert.match(database.databaseLabel(), /^SQLite/);
});

console.log('\n' + passed + ' phase-4 call-site checks passed (SQLite, throwaway data dir, no network)');
