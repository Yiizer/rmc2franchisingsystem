// Parity suite (split out of scripts/test-async-db.mjs): the dialect-neutral application checks.
// Runs on whichever database the harness selects (RMC2_DB=sqlite|postgres). Company names carry a per-run token so
// a shared Postgres database can be used repeatedly.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
register();
const imp = file => import(pathToFileURL(path.join(root, 'lib', 'operations', file)).href);
const database = await imp('database.ts'), svc = await imp('service.ts'), forms = await imp('forms.ts');
await database.ensureReady();
const token = randomBytes(3).toString('hex').replace(/\d/g, c => 'ghijklmnop'[c]);
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const employee = (await database.allUsers()).find(user => user.id === 'cryssa');
const importForm = async (company, agent) => {
  const fields = { company: company + ' ' + token, sector: 'Private', agentName: agent, agentEmail: agent.toLowerCase().replace(/\s+/g, '.') + '@example.test', agentPhone: '09171234567', contactName: 'Contact of ' + company, addressee: 'Contact of ' + company, contactEmail: 'contact@example.test', division: 'Division 1' };
  const bytes = await forms.sampleForm(fields);
  return svc.intake(employee, new File([bytes], company.replace(/\W+/g, '-') + '-' + agent.replace(/\W+/g, '-') + '.xlsx'), fields.agentEmail);
};
// A contended import may be refused with the safe 503 on Postgres from a remote machine; retry like a user would.
const importRetry = async (company, agent) => { for (let i = 0; i < 6; i++) { try { return await importForm(company, agent); } catch (error) { if (error.status !== 503) throw error; } } throw new Error('still contended'); };

await check('two agents importing the same client at the same moment: exactly one clear, one held', async () => {
  const [a, b] = await Promise.all([importRetry('Parallel Holdings Corp', 'Agent Alpha'), importRetry('Parallel Holdings Corp', 'Agent Beta')]);
  const states = [a, b].map(r => r.clientReview.state).sort();
  assert.deepEqual(states, ['clear', 'duplicate'], JSON.stringify(states));
  const held = [a, b].find(r => r.clientReview.state === 'duplicate'), clear = [a, b].find(r => r.clientReview.state === 'clear');
  assert.equal(held.clientReview.matches[0].inquiryId, clear.id);
  assert.notEqual(a.id, b.id, 'parallel imports get distinct inquiry numbers');
});
await check('five parallel imports of one client: one clear, the rest held; unrelated clients stay clear', async () => {
  const batch = await Promise.all([...Array.from({ length: 5 }, (_, i) => importRetry('Octet Trading Inc', 'Agent ' + 'ABCDE'[i])), importRetry('Unrelated Mills Ltd', 'Agent Solo')]);
  const octet = batch.slice(0, 5), solo = batch[5];
  assert.equal(octet.filter(r => r.clientReview.state === 'clear').length, 1);
  assert.equal(octet.filter(r => r.clientReview.state === 'duplicate').length, 4);
  assert.equal(solo.clientReview.state, 'clear');
  assert.equal(new Set(batch.map(r => r.id)).size, 6);
});
await check('parallel saves of one inquiry: revision check yields one winner and 409s, no lost update', async () => {
  const record = await importRetry('Revision Race Corp', 'Agent Gamma');
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
await check('inquiry numbers are strictly increasing and unique across a burst of unrelated imports', async () => {
  const records = await Promise.all(Array.from({ length: 4 }, (_, i) => importRetry('Burst Client ' + i, 'Agent Burst ' + i)));
  const numbers = records.map(r => Number(r.id.split('-').at(-1)));
  assert.equal(new Set(numbers).size, 4);
  assert.ok(Math.max(...numbers) - Math.min(...numbers) >= 3);
});
await check('a record round-trips: what is saved is what is read (types, nested arrays, unicode, quotes)', async () => {
  const record = await importRetry('Roundtrip Ünïcode "Quoted" O\'Neil & Co', 'Agent Rt');
  const saved = await database.inquiry(record.id);
  assert.equal(saved.fields.company, 'Roundtrip Ünïcode "Quoted" O\'Neil & Co ' + token);
  assert.equal(typeof saved.revision, 'number'); assert.ok(Array.isArray(saved.history)); assert.ok(Array.isArray(saved.submissions));
  const plain = await database.inquiry(record.id); plain.notes = 'line1\nline2\ttab \\ backslash 😀'; const rev = plain.revision; plain.revision++;
  await database.persist(plain, rev);
  assert.equal((await database.inquiry(record.id)).notes, 'line1\nline2\ttab \\ backslash 😀');
});
console.log('\n' + passed + ' application checks passed on ' + database.db.dialect);
await database.db.close?.();
process.exit(0);
