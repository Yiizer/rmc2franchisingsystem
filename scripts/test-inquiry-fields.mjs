// Feedback round 2026-11-07, item 7: manual entry with labeled fields (POST intake-fields -> intakeFields). SQLite, throwaway data dir.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('inquiry-fields');
const [service, forms, ownerView] = await Promise.all(['service', 'forms', 'owner-view'].map(t.load));
const db = t.db, cryssa = t.user('cryssa'), head = t.user('emerson'), admin = t.user('admin'), dh = t.user('division-head'), soa = t.user('soa');
const count = async () => (await db.get('SELECT COUNT(*) AS n FROM inquiries')).n;
const values = (company, extra = {}) => ({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent ' + company, agentPhone: '09175550001', contactName: 'Contact ' + company, contactEmail: 'c@example.com', contactPhone: '09985550001', contactPosition: 'HR', existingProvider: 'None', addressee: 'Contact ' + company, addresseePosition: 'HR', requestedPlan: 'Group', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '22-50', dependentAges: '', hospitals: 'St. Luke’s', dental: 'Smile Dental', ...extra });
const manual = (who, fields, over = {}) => service.intakeFields(who, { fields, idempotencyKey: randomUUID(), ...over });
const excel = async (company, sender, extra) => service.intake(cryssa, new File([new Uint8Array(await forms.sampleForm(values(company, extra)))], company + '.xlsx'), sender);

// ---------- 1. Same result as importing the same values as an Excel file ----------
{
  const viaForm = await manual(cryssa, { ...values('Typed Alpha Co'), agentEmail: 'Typist@Example.com' });
  const viaExcel = await excel('Excel Alpha Co', 'Typist@Example.com');
  const swap = (record, company) => JSON.parse(JSON.stringify(record.fields).replaceAll(company, 'CO'));
  assert.deepEqual(swap(viaForm, 'Typed Alpha Co'), swap(viaExcel, 'Excel Alpha Co'), 'typed fields round-trip into record.fields exactly like an imported form');
  assert.equal(viaForm.fields.division, 'Division 4', 'the division is filled from the branch, as for an import');
  assert.equal(viaForm.fields.sector, 'Private');
  assert.equal(viaForm.fields.agentEmail, 'Typist@Example.com');
  assert.equal(viaForm.source.origin, 'manual'); assert.equal(viaExcel.source.origin, 'upload');
  assert.equal(viaForm.source.sender, 'Typist@Example.com');
  assert.equal(viaForm.source.filename, 'Manual entry – Typed Alpha Co.xlsx');
  assert.ok(viaForm.source.storage.startsWith('attachments/') && viaForm.source.format === 'xlsx');
  assert.equal(viaForm.email.to, 'Typist@Example.com');
  assert.equal(viaForm.status, 'New inquiry'); assert.equal(viaForm.clientReview.state, 'clear');
  assert.ok((await db.all('SELECT data FROM notifications')).some(row => JSON.parse(row.data).inquiryId === viaForm.id && JSON.parse(row.data).title === 'New inquiry'), 'all active staff are notified');
  for (const sector of ['DepEd', 'Government'])assert.equal((await manual(cryssa, { ...values(sector + ' Typed Co', { sector }), agentEmail: 'a@example.com' })).fields.sector, sector);
  assert.equal((await manual(cryssa, { ...values('No Sector Co'), sector: undefined, agentEmail: 'a@example.com' }).catch(e => e)).name === 'ZodError', true, 'undefined values are not strings');
  const noSector = { ...values('No Sector Co 2'), agentEmail: 'a@example.com' }; delete noSector.sector;
  assert.equal((await manual(cryssa, noSector)).fields.sector, 'Private', 'a missing sector defaults to Private');
  t.pass('Typed fields become the same record as the same values imported as Excel; origin=manual, sender=agent email, file name, division fill, notification');
}

// ---------- 2. Validation and permission ----------
{
  const ok = { ...values('Valid Co'), agentEmail: 'a@example.com' };
  assert.equal(await t.status(manual(cryssa, { ...ok, bogus: 'x' })), 400, 'an unknown key');
  assert.equal(await t.status(manual(cryssa, { ...ok, division: 'Division 1' })), 400, 'division is not an allowed key');
  assert.equal(await t.status(manual(cryssa, { ...ok, sector: 'Other' })), 400);
  assert.equal(await t.status(manual(cryssa, { ...ok, company: '  ' })), 400);
  assert.equal(await t.status(manual(cryssa, { ...ok, address: 'x'.repeat(1001) })), 400, 'length limit');
  assert.equal(await t.status(manual(cryssa, { ...ok, agentEmail: '' })), 400, 'staff must give the agent email');
  assert.equal(await t.status(manual(cryssa, { ...ok, agentEmail: 'a@b.com, c@d.com' })), 400);
  assert.equal(await t.status(manual(cryssa, ok, { idempotencyKey: 'not-a-uuid' })), 400);
  assert.equal(await t.status(service.intakeFields(cryssa, { fields: ok })), 400, 'the idempotency key is required');
  assert.equal(await t.status(service.intakeFields(cryssa, { fields: ok, idempotencyKey: randomUUID(), extra: 1 })), 400);
  assert.equal(await t.status(manual(cryssa, ok, { ownerId: cryssa.id })), 422, 'an Employee cannot be the owner');
  assert.equal(await t.status(manual(head, ok)), 403, 'the Head imports nothing (same rule as intake)');
  assert.equal(await t.status(manual(t.user('zeo'), ok)), 403);
  assert.equal(await t.status(manual(admin, { ...ok, company: 'Admin Typed Co' })), 200, 'Admin may import, like intake');
  assert.deepEqual([...forms.MANUAL_FIELD_KEYS].sort(), ['addressee', 'addresseePosition', 'address', 'agentEmail', 'agentName', 'agentPhone', 'branch', 'company', 'contactEmail', 'contactName', 'contactPhone', 'contactPosition', 'dental', 'dependentAges', 'dependents', 'employeeAges', 'employees', 'existingProvider', 'hospitals', 'industry', 'payment', 'requestDate', 'requestedPlan', 'sector'].sort());
  const owned = await manual(cryssa, { ...values('Owner Chosen Co'), agentEmail: 'a@example.com' }, { ownerId: soa.id });
  assert.equal(owned.ownerId, soa.id); assert.equal(owned.ownerAgent.email, soa.email);
  t.pass('Unknown keys, bad sector, blank company, long values, bad agent email, bad key and bad owner give 400/422; Head and Supervisor get 403; staff may link an owner');
}

// ---------- 2b. Single-line fields and the file name ----------
{
  const rec = await manual(cryssa, { ...values('Lakeside Test Foods Inc.\r\n'), address: 'Line one\nLine two\u2028tail', agentEmail: 'a@example.com' });
  assert.equal(rec.source.filename, 'Manual entry \u2013 Lakeside Test Foods Inc.xlsx', 'no double dot before the extension');
  assert.equal(rec.fields.address, 'Line one Line two tail', 'line breaks become spaces');
  assert.equal(rec.fields.company, 'Lakeside Test Foods Inc.');
  const minimal = await manual(cryssa, { company: 'Minimal Entry Co', agentEmail: 'm@example.com' });
  assert.equal(minimal.fields.company, 'Minimal Entry Co');
  t.pass('Line breaks are replaced by spaces, the file name has no double dot, and only company (+ agentEmail for staff) is required');
}

// ---------- 3. Duplicate clients are held exactly like an import ----------
{
  const first = await manual(cryssa, { ...values('Twin Typed Co'), agentEmail: 'first@example.com' });
  const second = await manual(cryssa, { ...values('Twin Typed Co'), agentEmail: 'second@example.com', agentName: 'Another Agent' });
  assert.equal(first.clientReview.state, 'clear');
  assert.equal(second.clientReview.state, 'duplicate');
  assert.equal(second.clientReview.matches[0].inquiryId, first.id);
  const viaExcel = await excel('Twin Typed Co', 'third@example.com');
  assert.equal(viaExcel.clientReview.state, 'duplicate', 'an import of the same client is held the same way');
  t.pass('A second entry for the same client is held as a duplicate, like an imported form');
}

// ---------- 4. Idempotency ----------
{
  const body = { fields: { ...values('Idem Co'), agentEmail: 'idem@example.com' }, idempotencyKey: randomUUID() };
  const before = await count();
  const [one, two] = await Promise.all([service.intakeFields(cryssa, body), service.intakeFields(cryssa, body)]);
  assert.equal(one.id, two.id, 'a double click returns the same inquiry');
  assert.equal(await count(), before + 1, 'and creates only one');
  const again = await service.intakeFields(cryssa, body);
  assert.equal(again.id, one.id);
  assert.equal(await count(), before + 1);
  const files = (await db.all('SELECT data FROM inquiries')).map(row => JSON.parse(row.data).source.storage).filter(Boolean);
  assert.equal(new Set(files).size, files.length, 'no two inquiries share an attachment');
  // the key belongs to the user: another user with the same key creates their own
  const other = await service.intakeFields(admin, { ...body, fields: { ...body.fields, company: 'Idem Admin Co' } });
  assert.notEqual(other.id, one.id);
  // after 24 hours the key is free again
  await db.run('UPDATE settings SET data=? WHERE key=?', JSON.stringify({ inquiryId: one.id, at: new Date(Date.now() - 25 * 3600000).toISOString() }), 'intake_key:' + cryssa.id + ':' + body.idempotencyKey);
  const late = await service.intakeFields(cryssa, { ...body, fields: { ...body.fields, company: 'Idem Late Co' } });
  assert.notEqual(late.id, one.id);
  t.pass('A repeated or simultaneous submit with the same key returns the first inquiry (one row, one file); keys are per user and expire after 24 hours');
}

// ---------- 5. Owner-scoped users: sender forced, daily cap, same response as intake ----------
{
  const result = await service.intakeFields(dh, { fields: values('Owner Typed Co', { agentName: 'Whoever' }), idempotencyKey: randomUUID() });
  assert.equal(result.ownerId, dh.id);
  assert.equal(result.fields.agentEmail, dh.email, 'the reply address is the Division Head’s own email');
  assert.equal(result.source.sender, dh.email); assert.equal(result.source.origin, 'manual');
  const spoof = await service.intakeFields(dh, { fields: { ...values('Owner Spoof Co'), agentEmail: 'someone.else@example.com' }, idempotencyKey: randomUUID(), ownerId: soa.id });
  assert.equal(spoof.fields.agentEmail, dh.email, 'a different agent email in the body is ignored'); assert.equal(spoof.ownerId, dh.id, 'and so is another owner');
  const dto = await ownerView.ownerIntakeResult(result);
  assert.ok(dto.client && dto.client.id === result.id && !JSON.stringify(dto).includes('sharedMobile'));
  const keys = [];
  for (let i = 0; i < 18; i++) { const key = randomUUID(); keys.push(key); await service.intakeFields(dh, { fields: values('Cap Co ' + i), idempotencyKey: key }); }
  // 2 + 18 = 20 today: the 21st is refused with 429, but replaying an earlier key is still answered
  assert.equal(await t.status(service.intakeFields(dh, { fields: values('Cap Co 21'), idempotencyKey: randomUUID() })), 429);
  assert.equal((await service.intakeFields(dh, { fields: values('Cap Co 0'), idempotencyKey: keys[0] })).fields.company, 'Cap Co 0', 'a replay is not a new submission');
  assert.equal(await t.status(service.intakeFields(soa, { fields: values('SOA Typed Co'), idempotencyKey: randomUUID() })), 200, 'the cap is per user');
  // parallel submissions cannot slip past the cap: a fresh owner account with 19 inquiries, 6 at once
  const other = (await t.load('accounts'));
  const dh2 = (await other.createAccount(t.user('emerson'), { name: 'DH Race', username: 'dh.race', email: 'dh.race@rmc2.local', role: 'DivisionHead', position: 'x', canApprove: false, division: 'Division 4', currentPassword: t.PASSWORD })).user;
  const racer = (await t.database.allUsers()).find(u => u.id === dh2.id);
  for (let i = 0; i < 17; i++) await service.intakeFields(racer, { fields: values('Race Fill ' + i), idempotencyKey: randomUUID() });
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => t.status(service.intakeFields(racer, { fields: values('Race Co ' + i), idempotencyKey: randomUUID() }))));
  assert.equal(results.filter(r => r === 200).length, 3, 'exactly the remaining 3 get through: ' + results.join());
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM inquiries WHERE json_extract(data,'$.ownerId')=?", racer.id)).n, 20);
  // expired idempotency keys of this user are pruned when a new one is written
  await db.run('INSERT INTO settings(key,data) VALUES (?,?)', 'intake_key:' + soa.id + ':old', JSON.stringify({ inquiryId: 'x', at: new Date(Date.now() - 30 * 3600000).toISOString() }));
  await service.intakeFields(soa, { fields: values('Prune Co'), idempotencyKey: randomUUID() });
  assert.equal(await db.get('SELECT key FROM settings WHERE key=?', 'intake_key:' + soa.id + ':old'), undefined);
  t.pass('Owner roles: reply address forced to their own email, body owner/agent ignored, 21st submission in a day gets 429 (replays still answered), per user');
}

console.log(t.checks.length + ' checks passed');
