// Security review 2026-11-09 follow-ups: inbox back-off, stuck imports released, and the workbook safety check that runs
// before any Excel file is opened. SQLite, throwaway data dir, no mailbox.   node scripts/test-inbound-safety.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import PizZip from 'pizzip';
import { setup } from './feedback-harness.mjs';

const t = await setup('inbound-safety');
const inbound = await t.load('inbound'), forms = await t.load('form-preview'), db = t.db;

// 1. Back-off: none for the first two failures, then 5, 10, 20, 40, 60 (cap) minutes.
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 9].map(n => inbound.backoffMs(n) / 60000), [0, 0, 0, 5, 10, 20, 40, 60, 60]);
t.pass('Automatic inbox checks back off after 3 failures in a row: 5, 10, 20, 40, then 60 minutes at most');

// 2. Health is listed for staff (empty until a check fails).
const head = t.user('emerson');
const listed = await inbound.listInbound(head);
assert.deepEqual(listed.health, { failures: 0 });
await db.run("INSERT INTO settings(key,data) VALUES ('inbound-health',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data", JSON.stringify({ failures: 4, lastError: 'The inbox refused the sign-in.', lastFailureAt: new Date().toISOString() }));
assert.equal((await inbound.listInbound(head)).health.failures, 4);
t.pass('Requests receives the inbox health (failure count, reason, time) for its warning');

// 3. A message stuck in "importing" goes back to "new" after 10 minutes; a recent one is left alone.
const row = (id, importingAt) => ({ id, messageId: '<' + id + '@x>', receivedAt: new Date().toISOString(), from: 'a@b.example', fromName: '', replyTo: '', subject: 's', snippet: '', attachments: [], auth: { spf: 'none', dkim: 'none', dmarc: 'none', aligned: false }, state: 'importing', ...(importingAt ? { importingAt } : {}) });
for (const [id, at] of [['old', new Date(Date.now() - 11 * 60000).toISOString()], ['fresh', new Date().toISOString()], ['legacy', '']]) await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?)', id, '<' + id + '@x>', new Date().toISOString(), 'importing', JSON.stringify(row(id, at)));
// checkInbox needs a mailbox; call the release step through a check with no settings: it returns early, so run the SQL path directly.
const before = Object.fromEntries((await db.all("SELECT id,state FROM inbound_messages WHERE id IN ('old','fresh','legacy')")).map(r => [r.id, r.state]));
assert.deepEqual(before, { old: 'importing', fresh: 'importing', legacy: 'importing' });
process.env.RMC2_MAIL_MODE = 'smtp'; process.env.RMC2_SMTP_USER = 'nobody@example.invalid'; process.env.RMC2_SMTP_APP_PASSWORD = 'x'; process.env.RMC2_IMAP_HOST = '127.0.0.1'; process.env.RMC2_IMAP_PORT = '1';
const failed = await inbound.checkInbox().then(() => 'no error', e => e.status);
assert.equal(failed, 503, 'an unreachable inbox answers 503');
const after = Object.fromEntries((await db.all("SELECT id,state,data FROM inbound_messages WHERE id IN ('old','fresh','legacy')")).map(r => [r.id, r.state + (JSON.parse(r.data).importingAt ? '+at' : '')]));
assert.deepEqual(after, { old: 'new', fresh: 'importing+at', legacy: 'new' });
const health = (await inbound.listInbound(head)).health;
assert.equal(health.failures, 5); assert.match(health.lastError, /could not be reached/);
t.pass('Stuck imports (older than 10 minutes, or from before this change) are released; an unreachable inbox is counted and explained');
for (const key of ['RMC2_MAIL_MODE', 'RMC2_SMTP_USER', 'RMC2_SMTP_APP_PASSWORD', 'RMC2_IMAP_HOST', 'RMC2_IMAP_PORT']) delete process.env[key];

// 4. Workbook safety check before ExcelJS opens anything.
const sample = await readFile('resources/franchise-form.xlsx').catch(() => null) || await readFile('test-results/Franchise-Form-Mabini-Integrated-School.xlsx');
forms.assertSafeWorkbook(sample);
assert.throws(() => forms.assertSafeWorkbook(Buffer.from('%PDF-1.4 not a workbook')), /not an \.xlsx/);
const bomb = new PizZip(); bomb.file('xl/huge.xml', Buffer.alloc(45 * 1024 * 1024, 0x41)); const bombBytes = bomb.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
assert.ok(bombBytes.length < 1024 * 1024, 'the test bomb is small when packed (' + bombBytes.length + ' bytes)');
assert.throws(() => forms.assertSafeWorkbook(bombBytes), /too large/);
const many = new PizZip(); for (let i = 0; i < 1001; i++) many.file('p' + i + '.xml', 'x');
assert.throws(() => forms.assertSafeWorkbook(many.generate({ type: 'nodebuffer' })), /too many parts/);
t.pass('A real form passes; a renamed PDF, a ' + Math.round(bombBytes.length / 1024) + ' KB file that unpacks to 45 MB, and a 1001-part zip are refused before parsing');
console.log(t.checks.length + ' checks passed');
