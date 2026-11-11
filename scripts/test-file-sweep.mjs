// Unused stored files (REMAINING_WORK §2 data hygiene): scan, wait 24 hours, delete only what is still unused.
// SQLite, throwaway data dir, local file store.   node scripts/test-file-sweep.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('file-sweep');
const sweep = await t.load('file-sweep'), store = await t.load('file-store'), db = t.db;
const admin = t.user('admin'), head = t.user('emerson'), employee = t.user('cryssa');
const put = key => store.files().put(key, Buffer.from('x'), { contentType: 'application/octet-stream', mode: 'replace' });
const has = key => store.files().get(key).then(() => true, () => false);
const before = new Set(await store.files().list(''));

// Name rules on their own.
assert.deepEqual(sweep.nameTokens('sources/' + 'a'.repeat(64) + '.docx'), ['a'.repeat(64)]);
assert.equal(sweep.isReferenced('generated/ABC.pdf', 'x generated/abc.pdf y'), true, 'exact name, any case');
assert.equal(sweep.isReferenced('outbox/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.eml', '"id":"0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"'), true, 'id inside the name');
assert.equal(sweep.isReferenced('attachments/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f1.pdf', 'nothing here'), false);
t.pass('A file is in use when its full name, or an id or hash inside its name, appears in the database');

// Files that are in use in different ways, and true leftovers.
const id = () => randomUUID();
const exact = 'attachments/' + id() + '.pdf', hash = 'f'.repeat(16) + '0123456789abcdef', bySource = 'sources/' + hash + '.docx';
const otherColumn = id(), byColumn = 'outbox/' + otherColumn + '.eml';
const orphanA = 'attachments/' + id() + '.xlsx', orphanB = 'generated/' + id() + '.pdf', lateUse = 'bor/' + id() + '.pdf';
// Never looked at: their own clean-up (transfer/, health/), and on this computer the rest of the data directory.
const ignored = ['transfer/up/' + id() + '/file.pdf', 'health/' + id() + '.txt', 'backups/' + id() + '.sqlite', 'historical-sources/' + id() + '.xlsx', 'runtime/' + id() + '.json', 'loose-' + id() + '.txt'];
for (const key of [exact, bySource, byColumn, orphanA, orphanB, lateUse, ...ignored]) await put(key);
const inquiry = (await db.all('SELECT id,data FROM inquiries LIMIT 1'))[0];
const data = JSON.parse(inquiry.data); data.notes = 'see ' + exact + ' and template hash ' + hash;
await db.run('UPDATE inquiries SET data=? WHERE id=?', JSON.stringify(data), inquiry.id);
await db.run('INSERT INTO security_events (id,at,actor_id,action) VALUES (?,?,?,?)', id(), new Date().toISOString(), 'admin', 'mail ' + otherColumn); // a column that is not "data"

for (const who of [head, employee]) assert.equal(await t.status(sweep.scanFiles(who)), 403);
assert.equal(await t.status(sweep.sweepStatus(head)), 403);
t.pass('Only the IT Admin can scan, see or delete stored files (Head and Employee 403)');

const now = Date.now(), hour = 3600000;
const first = await sweep.scanFiles(admin, now);
const unusedNow = (await db.get("SELECT data FROM settings WHERE key='file-sweep'").then(r => JSON.parse(r.data))).candidates.map(c => c.key);
assert.ok(before.has('rmc2.sqlite'), 'the local store root holds the database');
assert.deepEqual([...unusedNow].sort(), [orphanA, orphanB, lateUse].sort(), 'exactly the three leftovers');
for (const key of [...before]) assert.equal(unusedNow.includes(key), false, key + ' (database file) must never be listed');
assert.equal(first.ready, 0, 'nothing can be deleted on the first scan');
assert.ok(first.readyAt && Date.parse(first.readyAt) === now + 24 * hour);
t.pass('A scan lists only leftovers in the app\'s record folders: names, ids and hashes in any column keep a file; the SQLite database, backups/, historical-sources/, runtime/, loose files, transfer/ and health/ are never listed; nothing is ready yet');

// The sweep's own list is stored in settings: a second scan must not treat that list as a reference.
const second = await sweep.scanFiles(admin, now + hour);
assert.equal(second.unused, first.unused, 'the stored candidate list does not count as a reference');
assert.equal(await t.status(sweep.deleteUnusedFiles(admin, now + 23 * hour)), 409);
assert.ok(await has(orphanA));
t.pass('Scanning again keeps the first-seen time; deleting before 24 hours is refused (409) and removes nothing');

// After 24 hours: a record starts using one leftover. Only the files still unused are deleted.
data.notes += ' evidence ' + lateUse; await db.run('UPDATE inquiries SET data=? WHERE id=?', JSON.stringify(data), inquiry.id);
const result = await sweep.deleteUnusedFiles(admin, now + 25 * hour);
assert.equal(await has(orphanA), false); assert.equal(await has(orphanB), false);
for (const key of [lateUse, exact, bySource, byColumn, ...ignored, ...before]) assert.equal(await has(key), true, key + ' must survive');
assert.equal(result.deleted, 2);
assert.equal(result.unused, 0);
const event = await db.get("SELECT action FROM security_events WHERE actor_id='admin' AND action LIKE 'Deleted %' ORDER BY at DESC LIMIT 1");
assert.equal(event.action, 'Deleted ' + result.deleted + ' unused stored files');
t.pass('After 24 hours, delete removes only files still unused: one a record started using in the meantime is kept; the deletion is logged');

const status = await sweep.sweepStatus(admin);
assert.equal(status.lastDelete.deleted, result.deleted);
assert.equal(await t.status(sweep.deleteUnusedFiles(admin, now + 26 * hour)), 409, 'nothing left to delete');
t.pass('Status shows the last deletion; a second delete with nothing old enough is refused');
console.log(t.checks.length + ' checks passed');
