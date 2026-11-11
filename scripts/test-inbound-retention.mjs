// Inbound email retention (PO 2026-11-11): skipped 30 days, never handled 60 days, imported 90 days. The app's copy and its
// stored attachments are cleared; a small row keeps the Message-ID so the email is never stored twice.
// SQLite, throwaway data dir, no mailbox.   node scripts/test-inbound-retention.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('inbound-retention');
const inbound = await t.load('inbound'), store = await t.load('file-store'), db = t.db;
const day = 86400000, now = Date.now(), ago = days => new Date(now - days * day).toISOString();
const put = async ({ id, state, receivedAt, storedAt, handledAt, inquiryId }) => {
  const key = `inbound/${id}/0-form.pdf`;
  await store.files().put(key, Buffer.from('%PDF-1.4 test'), { contentType: 'application/pdf', mode: 'replace' });
  const record = { id, messageId: '<' + id + '@retention.test>', receivedAt, storedAt, handledAt, inquiryId, from: 'agent@example.com', fromName: 'Agent', replyTo: '', subject: 'Form ' + id, snippet: 'Please see the form.', attachments: [{ name: 'form.pdf', type: 'pdf', size: 13, key }], auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', aligned: true }, state };
  await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?)', id, record.messageId, receivedAt, state, JSON.stringify(record));
  return key;
};
const exists = async key => store.files().get(key).then(() => true, () => false);
const row = async id => { const r = await db.get('SELECT state,data FROM inbound_messages WHERE id=?', id); return { state: r.state, data: JSON.parse(r.data) }; };

// Each limit, one day either side. Skipped and imported emails count from when they were handled.
const cases = {
  skippedOld: { state: 'dismissed', receivedAt: ago(40), storedAt: ago(40), handledAt: ago(31) },
  skippedRecent: { state: 'dismissed', receivedAt: ago(40), storedAt: ago(40), handledAt: ago(29) },
  newOld: { state: 'new', receivedAt: ago(61), storedAt: ago(61) },
  newRecent: { state: 'new', receivedAt: ago(59), storedAt: ago(59) },
  importedOld: { state: 'imported', receivedAt: ago(100), storedAt: ago(100), handledAt: ago(91), inquiryId: 'INQ-2026-00001' },
  importedRecent: { state: 'imported', receivedAt: ago(100), storedAt: ago(100), handledAt: ago(89), inquiryId: 'INQ-2026-00002' },
  // A sender backdated the Date header by a year, but the app stored the email yesterday: it must stay.
  backdated: { state: 'new', receivedAt: ago(365), storedAt: ago(1) },
  // Older rows have no storedAt: the dates they do have decide.
  legacyOld: { state: 'new', receivedAt: ago(70) },
  // An email being imported right now is never touched, however old.
  importing: { state: 'importing', receivedAt: ago(200), storedAt: ago(200) },
};
const keys = {};
for (const [id, c] of Object.entries(cases)) keys[id] = await put({ id, ...c });

const cleared = await inbound.pruneInbound(now);
assert.equal(cleared, 4, 'four emails are past their limit');
const expectCleared = ['skippedOld', 'newOld', 'importedOld', 'legacyOld'];
for (const id of Object.keys(cases)) {
  const r = await row(id), gone = expectCleared.includes(id);
  assert.equal(r.state === 'cleared', gone, id + ' state ' + r.state);
  assert.equal(await exists(keys[id]), !gone, id + ' attachment');
}
t.pass('Cleared exactly at the limits: skipped after 30 days, never handled after 60, imported after 90 (each one day either side); attachments deleted with them');

const kept = (await row('importedOld')).data;
assert.deepEqual(Object.keys(kept).sort(), ['clearedAt', 'clearedFrom', 'id', 'inquiryId', 'messageId', 'receivedAt', 'state']);
assert.equal(kept.clearedFrom, 'imported'); assert.equal(kept.inquiryId, 'INQ-2026-00001');
const text = JSON.stringify(kept);
for (const secret of ['agent@example.com', 'Form importedOld', 'Please see the form', 'form.pdf']) assert.equal(text.includes(secret), false, 'kept row must not contain ' + secret);
await assert.rejects(db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?)', 'again', kept.messageId, ago(0), 'new', '{}'), /UNIQUE/i);
t.pass('A cleared email keeps only its id, Message-ID, dates and inquiry link (no sender, subject, text or file name), so the same email can never be stored again');

assert.equal((await row('backdated')).state, 'new'); assert.equal((await row('importing')).state, 'importing');
t.pass('A backdated Date header does not clear an email the app stored yesterday; an email being imported is left alone');

const listed = await inbound.listInbound(t.user('emerson'));
assert.deepEqual(listed.messages.map(m => m.id).sort(), ['backdated', 'importedRecent', 'importing', 'newRecent', 'skippedRecent']);
t.pass('Requests no longer lists cleared emails');

assert.equal(await inbound.pruneInbound(now), 0, 'a second run finds nothing new');
t.pass('Running again changes nothing');
console.log(t.checks.length + ' checks passed');
