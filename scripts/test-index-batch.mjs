// REMAINING_WORK §2 code-review minor "batched reindex": synchronizeInquiryIndex now works in set-based batches of 200.
// Proves the index it builds is identical to syncing one inquiry at a time, across batch boundaries, and that deleted
// inquiries lose their summary and keys. SQLite, throwaway data dir.   node scripts/test-index-batch.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('index-batch');
const index = await t.load('inquiry-index'), db = t.db;
const seed = (await db.all('SELECT id,data FROM inquiries')).map(r => JSON.parse(r.data)).filter(r => r.fields?.company);
assert.ok(seed.length > 0, 'the seed has inquiries');
// 450 more inquiries (3 batches), each its own client, some sharing a company to create shared keys.
for (let i = 0; i < 450; i++) {
  const base = seed[i % seed.length], id = 'INQ-BATCH-' + String(i).padStart(4, '0');
  const record = { ...base, id, source: { ...base.source, kind: 'upload', filename: 'Batch-' + i + '.xlsx', storage: 'uploads/batch-' + i + '.xlsx' }, fields: { ...base.fields, company: i % 7 === 0 ? 'Shared Batch Co' : 'Batch Client ' + i, contactEmail: 'batch' + i + '@clients.example.test' } };
  await db.run('INSERT INTO inquiries (id,revision,data) VALUES (?,?,?)', id, 1, JSON.stringify(record));
}
const snapshot = async () => ({
  summaries: (await db.all('SELECT id,data,summary FROM inquiry_summaries ORDER BY id')).map(r => [r.id, String(r.data), String(r.summary)]),
  keys: (await db.all('SELECT inquiry_id,kind,value FROM inquiry_keys ORDER BY inquiry_id,kind,value')).map(r => [r.inquiry_id, r.kind, r.value]),
});
const all = (await db.all('SELECT id FROM inquiries ORDER BY id')).map(r => r.id);

// One at a time (each sync sees a single pending id).
await db.run('DELETE FROM inquiry_summaries'); await db.run('DELETE FROM inquiry_keys'); await db.run('DELETE FROM inquiry_index_pending');
for (const id of all) { await db.run('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING', id); await index.synchronizeInquiryIndex(); }
const single = await snapshot();
assert.equal(single.summaries.length, all.length); assert.ok(single.keys.length > 450, 'client keys were built');
t.pass('One-at-a-time sync indexes all ' + all.length + ' inquiries (' + single.keys.length + ' keys)');

// Everything at once (3 batches).
await db.run('DELETE FROM inquiry_summaries'); await db.run('DELETE FROM inquiry_keys');
for (const id of all) await db.run('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING', id);
await index.synchronizeInquiryIndex();
assert.deepEqual(await snapshot(), single, 'batched index differs from one-at-a-time');
assert.equal((await db.all('SELECT id FROM inquiry_index_pending')).length, 0, 'pending queue is empty');
t.pass('Batched sync (' + Math.ceil(all.length / 200) + ' batches) gives the identical summaries and keys');

// Deleted inquiries in a batch lose their summary and keys; the rest stay.
const removed = all.filter(id => id.startsWith('INQ-BATCH-')).slice(195, 210);
for (const id of removed) { await db.run('DELETE FROM inquiries WHERE id=?', id); await db.run('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING', id); }
await db.run('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING', all[0]);
await index.synchronizeInquiryIndex();
const after = await snapshot();
assert.equal(after.summaries.length, all.length - removed.length);
assert.ok(!after.keys.some(([id]) => removed.includes(id)), 'keys left for deleted inquiries');
t.pass('Deleted inquiries drop out of the index; ' + removed.length + ' removed across a batch edge');

// Duplicate matching still works off the batched index.
const shared = (await db.all("SELECT data FROM inquiries WHERE id='INQ-BATCH-0007'"))[0];
const matches = await index.matchingInquiries(JSON.parse(shared.data));
assert.ok(matches.length >= 2 && matches.every(m => m.fields?.company), 'shared-company matches found: ' + matches.length);
t.pass('Client matching finds the ' + matches.length + ' records that share client details');
console.log(t.checks.length + ' checks passed');
