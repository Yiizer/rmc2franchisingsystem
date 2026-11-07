// Feedback round 2026-11-08, item 1: protection-expiry reminders for staff (PO Q1/Q2). Throwaway SQLite data dir (feedback-harness), no network.
// Recipients: the employees who handled the client (handledBy + the preparer of the sent version) and every active Head and Supervisor;
// never an inactive user, never a Division Head / SOA (their own owner reminder covers their own client). Once per client per threshold
// (7 and 2 days) per protection period; a renewal starts a new period.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('protection-reminders-employees');
const [ownerView, clientService] = await Promise.all(['owner-view', 'client-service'].map(t.load));
const { db, database } = t, DAY = 86400000, NOW = Date.now();
const pushed = [];
database.setNoticeHook(notice => { pushed.push(notice.id); });

// judy is made inactive: a handler who left must not be notified.
{ const judy = t.user('judy'); await db.run('UPDATE users SET data=? WHERE id=?', JSON.stringify({ ...judy, active: false }), 'judy'); }

const at = ms => new Date(ms).toISOString();
const delivery = ms => ({ id: randomUUID(), at: at(ms), mode: 'local-test', file: '' });
const sub = (by, extra = {}) => ({ version: 1, at: at(NOW - 20 * DAY), submittedBy: by, fields: {}, email: { to: '', subject: '', body: '' }, emailOverrides: [], generated: {}, notes: '', warnings: [], ...extra });
const protection = daysLeft => ({ startedAt: at(NOW - (30 - daysLeft) * DAY), activityAt: at(NOW - (30 - daysLeft) * DAY), expiresAt: at(NOW + daysLeft * DAY), agentName: 'Agent', agentEmail: 'agent@example.com', agentPhone: '0917', ownerId: 'division-head', activityKind: 'proposal' });
let n = 0;
async function client(company, daysLeft, over = {}) {
  const createdAt = at(NOW - 25 * DAY), id = 'INQ-REM-' + String(++n).padStart(3, '0');
  const record = { id, revision: 1, status: 'Sent', createdAt, updatedAt: createdAt, fields: { company }, source: { filename: '', storage: '', sheet: '', cells: [], fields: {}, receivedAt: createdAt }, email: { to: '', subject: '', body: '' }, emailOverrides: [], templateId: '', submissions: [], handledBy: [], history: [], chat: [], notes: '', returnNote: '', returnFlags: [], detailRequests: [], ownerId: 'division-head', ownerAgent: { name: 'Division Head', email: 'divisionhead@rmc2.local', phone: '09170000004' }, protection: daysLeft === null ? undefined : protection(daysLeft), ...over };
  await database.persist(record);
  return record;
}
const staffNotices = async id => (await db.all("SELECT data FROM notifications WHERE id LIKE 'staff-reminder-%'")).map(r => JSON.parse(r.data)).filter(x => !id || x.inquiryId === id);
const dateOf = iso => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(iso));

// ---------- Fixtures ----------
const a = await client('Seven Day Corp', 6.5, { handledBy: ['cryssa', 'judy', 'division-head', 'emerson'], submissions: [sub('jefferson', { delivery: delivery(NOW - 20 * DAY) })] });
const b = await client('Two Day Corp', 1.5); // nobody handled it (PO Q2): the Head and Supervisors still hear
const far = await client('Far Away Corp', 10, { handledBy: ['cryssa'] });
const held = await client('Pending Report Corp', 1, { handledBy: ['cryssa'], progressReports: [{ id: 'p', sentAt: at(NOW), recordedAt: at(NOW), recordedBy: 'division-head', sender: 'a@b.co', summary: 'pending report text', reference: 'ref', status: 'pending' }] });
const closed = await client('Closed Corp', 3, { handledBy: ['cryssa'], status: 'Declined', closure: { kind: 'declined', at: at(NOW - DAY), by: 'cryssa', reason: 'no' } });
const expired = await client('Expired Corp', -1, { handledBy: ['cryssa'] });
const dryRunOnly = await client('Dry Run Corp', 5, { submissions: [sub('cryssa', { delivery: { ...delivery(NOW - 20 * DAY), dryRun: true } })] });

// ---------- 1. First sweep: exactly the expected notices, recipients and text ----------
{
  const created = await ownerView.staffProtectionReminders(NOW);
  assert.equal(created, 3, 'Seven Day, Two Day and Dry Run get a notice');
  const [na] = await staffNotices(a.id), [nb] = await staffNotices(b.id);
  assert.deepEqual([...na.recipientIds].sort(), ['cryssa', 'emerson', 'jefferson', 'zeo'], 'handlers + sender + Head + Supervisor; not the inactive judy, not the Division Head');
  assert.equal(na.title, 'Protection ending soon');
  assert.equal(na.message, `Seven Day Corp: protection ends in 7 days (${dateOf(a.protection.expiresAt)}). Ask the agent for a progress report or the client will be released.`);
  assert.deepEqual([...nb.recipientIds].sort(), ['emerson', 'zeo'], 'nobody handled it: the Head and Supervisors');
  assert.equal(nb.message, `Two Day Corp: protection ends in 2 days (${dateOf(b.protection.expiresAt)}). Ask the agent for a progress report or the client will be released.`);
  const [nd] = await staffNotices(dryRunOnly.id);
  assert.deepEqual([...nd.recipientIds].sort(), ['emerson', 'zeo'], 'a dry-run delivery is not a sent version');
  assert.match(nd.message, /ends in 5 days/, 'the actual days left (PO Q4)');
  for (const r of [far, held, closed, expired]) assert.equal((await staffNotices(r.id)).length, 0, r.fields.company);
  assert.equal(pushed.length, 3, 'one push per inserted notice');
  // The in-app list reads notice_recipients: cryssa sees it, the Division Head never sees a staff notice.
  assert.ok(await db.get('SELECT 1 FROM notice_recipients WHERE notice_id=? AND user_id=?', na.id, 'cryssa'));
  assert.equal((await db.all("SELECT notice_id FROM notice_recipients WHERE user_id IN ('division-head','soa','judy','admin') AND notice_id LIKE 'staff-reminder-%'")).length, 0);
  t.pass('7-day and 2-day notices reach handlers, the sender, the Head and Supervisors; never inactive users, owners or the Admin; exact text with the date; none when far off, pending, closed or expired');
}

// ---------- 2. Re-runs and parallel runs create nothing new ----------
{
  for (let i = 0; i < 3; i++) assert.equal(await ownerView.staffProtectionReminders(NOW + i * 60000), 0);
  const parallel = await Promise.all([ownerView.staffProtectionReminders(NOW), ownerView.staffProtectionReminders(NOW)]);
  assert.deepEqual(parallel, [0, 0]);
  assert.equal((await staffNotices()).length, 3);
  assert.equal(pushed.length, 3, 'no push on a re-run');
  t.pass('Re-running the sweep (sequentially or in parallel) sends nothing new and pushes nothing');
}

// ---------- 3. Seven Day moves inside 2 days: one more; first seen inside 2 days gave only the 2-day one ----------
{
  assert.equal(await ownerView.staffProtectionReminders(NOW + 5 * DAY), 2, 'Seven Day now has 1.5 days left; Far Away reaches 5 days');
  assert.equal((await staffNotices(a.id)).length, 2);
  assert.match((await staffNotices(far.id))[0].message, /ends in 5 days/);
  assert.match((await staffNotices(a.id)).map(x => x.message).join('\n'), /ends in 2 days/);
  assert.equal((await staffNotices(b.id)).length, 1, 'Two Day was first seen inside 2 days: only the 2-day notice');
  t.pass('One more notice at 2 days; a client first seen inside 2 days only gets the 2-day one');
}

// ---------- 4. Renewal: an approved progress report starts a new period, and the reminders come again ----------
{
  const record = await t.get(a.id);
  record.progressReports = [{ id: 'renew', sentAt: at(NOW), recordedAt: at(NOW), recordedBy: 'division-head', sender: 'a@b.co', summary: 'client still talking to us', reference: 'PR-1', status: 'pending' }];
  record.revision++; await db.run('UPDATE inquiries SET revision=?,data=? WHERE id=?', record.revision, JSON.stringify(record), a.id);
  assert.equal(await ownerView.staffProtectionReminders(NOW), 0, 'pending report: held, nothing new');
  const renewed = await clientService.decideProgressReport(a.id, 'renew', t.user('zeo'), { action: 'approve' });
  const expiry = Date.parse(renewed.protection.expiresAt);
  assert.ok(expiry > NOW + 29 * DAY);
  assert.equal(await ownerView.staffProtectionReminders(NOW), 0, '30 days left: nothing');
  assert.equal(await ownerView.staffProtectionReminders(expiry - 6.5 * DAY), 1, 'new period: the 7-day reminder again');
  assert.equal(await ownerView.staffProtectionReminders(expiry - 6.5 * DAY), 0);
  assert.equal(await ownerView.staffProtectionReminders(expiry - 1.5 * DAY), 1, 'new period: the 2-day reminder again');
  assert.equal((await staffNotices(a.id)).length, 4);
  t.pass('A renewed protection sends the 7-day and 2-day reminders again in its new period, once each');
}

// ---------- 5. Owner reminders are unchanged and separate ----------
{
  const owner = t.user('division-head'), mine = await (async () => { await ownerView.ownerReminders(owner, [await t.get(b.id)], NOW); return (await db.all("SELECT data FROM notifications WHERE id LIKE 'reminder-%'")).map(r => JSON.parse(r.data)).filter(x => x.inquiryId === b.id); })();
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].recipientIds, ['division-head']);
  assert.equal(mine[0].message, 'Two Day Corp · protection ends in 2 days. File a progress report to renew it.', 'owner wording unchanged');
  t.pass('The owner reminder keeps its own wording and recipient, separate from the staff notice');
}

// ---------- 6. The 10-minute slot: one winner per slot across callers ----------
{
  const slot = 1_800_000_000_000; // a fixed instant on a 10-minute boundary
  assert.equal(await ownerView.claimReminderSlot(slot), true);
  assert.equal(await ownerView.claimReminderSlot(slot + 60000), false, 'same slot');
  const both = await Promise.all([ownerView.claimReminderSlot(slot + 600000), ownerView.claimReminderSlot(slot + 600000)]);
  assert.deepEqual(both.sort(), [false, true], 'two callers, one winner');
  assert.equal((await db.all("SELECT key FROM settings WHERE key LIKE 'protection-reminder-slot:%'")).length, 1, 'older slot rows are removed');
  t.pass('The reminder slot is claimed by one caller per 10 minutes, and old slot rows are cleaned up');
}

console.log(`\n${t.checks.length} checks passed.`);
