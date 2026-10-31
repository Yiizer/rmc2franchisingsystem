// Phase 2 data-layer tests: the async store (mutex + AsyncLocalStorage transactions) and the
// duplicate-client guarantee under real parallel requests. Throwaway data dir, no network, no server.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { register } from 'tsx/esm/api';

const dir = path.resolve('test-results', 'async-db', String(Date.now()));
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
mkdirSync(dir, { recursive: true });
process.env.RMC2_DATA_DIR = path.join(dir, 'app-data');
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_)/.test(key)) delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const { createSqliteStore } = await imp('store.ts');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const open = name => createSqliteStore(() => {
  const database = new DatabaseSync(path.join(dir, name + '.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE counter (id TEXT PRIMARY KEY, n INTEGER NOT NULL); CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL); INSERT INTO counter VALUES (\'c\',0);');
  return database;
});

// ---------------------------------------------------------------- store
await check('50 parallel read-then-write transactions never lose an update', async () => {
  const store = open('lost-updates');
  await Promise.all(Array.from({ length: 50 }, (_, i) => store.transaction(async () => {
    const row = await store.get('SELECT n FROM counter WHERE id=?', 'c');
    await sleep(i % 3); // awaiting between read and write is what would interleave without the mutex
    await store.run('UPDATE counter SET n=? WHERE id=?', row.n + 1, 'c');
  })));
  assert.equal((await store.get('SELECT n FROM counter WHERE id=?', 'c')).n, 50);
  store.close();
});

await check('nested transaction() joins the outer one; an outer failure rolls the inner work back', async () => {
  const store = open('nested');
  const result = await store.transaction(async () => {
    await store.run('INSERT INTO log(note) VALUES (?)', 'outer');
    return store.transaction(async () => { await store.run('INSERT INTO log(note) VALUES (?)', 'inner'); return 'joined'; });
  });
  assert.equal(result, 'joined');
  assert.deepEqual((await store.all('SELECT note FROM log ORDER BY id')).map(r => r.note), ['outer', 'inner']);
  await assert.rejects(store.transaction(async () => {
    await store.run('INSERT INTO log(note) VALUES (?)', 'gone-outer');
    await store.transaction(async () => { await store.run('INSERT INTO log(note) VALUES (?)', 'gone-inner'); });
    throw new Error('boom');
  }), /boom/);
  assert.deepEqual((await store.all('SELECT note FROM log ORDER BY id')).map(r => r.note), ['outer', 'inner']);
  store.close();
});

await check('a failing transaction rolls back, releases the lock and the next one succeeds', async () => {
  const store = open('rollback');
  await assert.rejects(store.transaction(async () => { await store.run('UPDATE counter SET n=99 WHERE id=?', 'c'); throw new Error('nope'); }), /nope/);
  assert.equal((await store.get('SELECT n FROM counter WHERE id=?', 'c')).n, 0);
  await store.transaction(async () => { await store.run('UPDATE counter SET n=5 WHERE id=?', 'c'); });
  assert.equal((await store.get('SELECT n FROM counter WHERE id=?', 'c')).n, 5);
  // a synchronous callback and a throwing synchronous callback behave the same
  assert.equal(await store.transaction(() => 7), 7);
  await assert.rejects(store.transaction(() => { throw new Error('sync'); }), /sync/);
  assert.equal(await store.transaction(() => 8), 8);
  store.close();
});

await check('writes outside a transaction wait for an open transaction; reads never see uncommitted rows', async () => {
  const store = open('outside');
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const inside = store.transaction(async () => {
    await store.run('INSERT INTO log(note) VALUES (?)', 'uncommitted');
    order.push('tx-wrote');
    await gate;
    order.push('tx-commit');
  });
  await sleep(10);
  const write = store.run('INSERT INTO log(note) VALUES (?)', 'outside-write').then(() => order.push('outside-write-done'));
  const read = store.all('SELECT note FROM log ORDER BY id').then(rows => { order.push('outside-read-done'); return rows.map(r => r.note); });
  await sleep(30);
  assert.deepEqual(order, ['tx-wrote'], 'outside statements are parked while the transaction is open');
  release();
  await Promise.all([inside, write, read]);
  assert.deepEqual(order.slice(0, 2), ['tx-wrote', 'tx-commit']);
  assert.ok(order.indexOf('outside-write-done') > order.indexOf('tx-commit'));
  assert.deepEqual((await store.all('SELECT note FROM log ORDER BY id')).map(r => r.note), ['uncommitted', 'outside-write']);
  // a rolled-back row is never visible to a parked reader
  let release2;
  const gate2 = new Promise(resolve => { release2 = resolve; });
  const failing = store.transaction(async () => { await store.run('INSERT INTO log(note) VALUES (?)', 'rolled-back'); await gate2; throw new Error('abort'); }).catch(() => {});
  await sleep(10);
  const seen = store.all('SELECT note FROM log').then(rows => rows.map(r => r.note));
  release2();
  await failing;
  assert.ok(!(await seen).includes('rolled-back'));
  store.close();
});

await check('statements from a finished transaction continuation are not treated as inside it', async () => {
  const store = open('scope');
  let leaked;
  await store.transaction(async () => { leaked = () => store.run('INSERT INTO log(note) VALUES (?)', 'late'); });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const holder = store.transaction(async () => { await gate; });
  await sleep(5);
  let done = false;
  const late = leaked().then(() => { done = true; });
  await sleep(30);
  assert.equal(done, false, 'a leaked callback must queue behind the next transaction');
  release();
  await Promise.all([holder, late]);
  assert.equal(done, true);
  store.close();
});

await check('a Promise.all sibling still running after its transaction rolled back cannot autocommit', async () => {
  const store = open('aborted');
  let sibling;
  await assert.rejects(store.transaction(async () => {
    sibling = (async () => { await sleep(20); await store.run('INSERT INTO log(note) VALUES (?)', 'leaked'); })();
    await Promise.all([Promise.reject(new Error('first')), sibling]);
  }), /first/);
  await assert.rejects(sibling, /rolled back/);
  assert.equal((await store.get('SELECT COUNT(*) n FROM log')).n, 0);
  store.close();
});

await check('reads outside a transaction queue fairly instead of waiting for the lock to go idle', async () => {
  const store = open('fair');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = store.transaction(async () => { await gate; });
  await sleep(5);
  const reader = store.get('SELECT n FROM counter WHERE id=?', 'c');
  const second = store.transaction(async () => { await store.run('UPDATE counter SET n=7 WHERE id=?', 'c'); await sleep(20); });
  release();
  const [, seen] = await Promise.all([first, reader, second]);
  assert.equal(seen.n, 0, 'the reader queued before the second transaction must run before it');
  store.close();
});

await check('mixed parallel load (transactions, outside writes, reads) completes without deadlock', async () => {
  const store = open('mixed');
  const work = [];
  for (let i = 0; i < 40; i++) {
    work.push(store.transaction(async () => { const r = await store.get('SELECT n FROM counter WHERE id=?', 'c'); await store.run('UPDATE counter SET n=? WHERE id=?', r.n + 1, 'c'); }));
    work.push(store.run('INSERT INTO log(note) VALUES (?)', 'w' + i));
    work.push(store.all('SELECT * FROM log'));
  }
  await Promise.race([Promise.all(work), sleep(10000).then(() => { throw new Error('deadlock'); })]);
  assert.equal((await store.get('SELECT n FROM counter WHERE id=?', 'c')).n, 40);
  assert.equal((await store.get('SELECT COUNT(*) n FROM log')).n, 40);
  store.close();
});

// ---------------------------------------------------------------- application: duplicate registration
const database = await imp('database.ts'), svc = await imp('service.ts'), forms = await imp('forms.ts');
const employee = (await database.allUsers()).find(user => user.id === 'cryssa');
const importForm = async (company, agent) => {
  const fields = { company, sector: 'Private', agentName: agent, agentEmail: agent.toLowerCase().replace(/\s+/g, '.') + '@example.test', agentPhone: '09171234567', contactName: 'Contact of ' + company, addressee: 'Contact of ' + company, contactEmail: 'contact@example.test', division: 'Division 1' };
  const bytes = await forms.sampleForm(fields);
  return svc.intake(employee, new File([bytes], company.replace(/\W+/g, '-') + '-' + agent.replace(/\W+/g, '-') + '.xlsx'), fields.agentEmail);
};

await check('two agents importing the same client at the same moment: exactly one clear, one held', async () => {
  const [a, b] = await Promise.all([importForm('Parallel Holdings Corp', 'Agent Alpha'), importForm('Parallel Holdings Corp', 'Agent Beta')]);
  const states = [a, b].map(r => r.clientReview.state).sort();
  assert.deepEqual(states, ['clear', 'duplicate'], JSON.stringify(states));
  const held = [a, b].find(r => r.clientReview.state === 'duplicate'), clear = [a, b].find(r => r.clientReview.state === 'clear');
  assert.equal(held.clientReview.matches[0].inquiryId, clear.id);
  assert.notEqual(a.id, b.id, 'parallel imports get distinct inquiry numbers');
});

await check('eight parallel imports of one client: one clear, the rest held; unrelated clients stay clear', async () => {
  const batch = await Promise.all([
    ...Array.from({ length: 8 }, (_, i) => importForm('Octet Trading Inc', 'Agent ' + 'ABCDEFGH'[i])),
    importForm('Unrelated Mills Ltd', 'Agent Solo'),
  ]);
  const octet = batch.slice(0, 8), solo = batch[8];
  assert.equal(octet.filter(r => r.clientReview.state === 'clear').length, 1);
  assert.equal(octet.filter(r => r.clientReview.state === 'duplicate').length, 7);
  assert.equal(solo.clientReview.state, 'clear');
  assert.equal(new Set(batch.map(r => r.id)).size, 9);
});

await check('parallel saves of one inquiry: revision check yields one winner and 409s, no lost update', async () => {
  const record = await importForm('Revision Race Corp', 'Agent Gamma');
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => database.transaction(async () => {
    const current = await database.inquiry(record.id);
    if (current.revision !== record.revision) throw new database.AppError('stale', 409);
    await new Promise(resolve => setTimeout(resolve, 2));
    current.revision++;
    await database.persist(current, record.revision);
  })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  assert.equal((await database.inquiry(record.id)).revision, record.revision + 1);
  await assert.rejects(database.persist({ ...record, revision: record.revision + 5 }, record.revision), e => e.status === 409);
});

console.log('\n' + passed + ' async data-layer checks passed (SQLite, throwaway data dir, no network)');
