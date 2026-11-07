// Feedback round 2026-11-07, item 2: the "shared mobile" flag. SQLite, throwaway data dir, no browser.
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('feedback-shared-mobile');
const [phone, rules, service, forms, queries, ownerView, types] = await Promise.all(['phone', 'client-rules', 'service', 'forms', 'workspace-query', 'owner-view', 'types'].map(t.load));

// ---------- 1. The normalizer ----------
for (const same of ['0917 123 4567', '+63 917-123-4567', '9171234567', '0063 917 123 4567', '(0917) 123-4567', '639171234567'])assert.equal(phone.phMobileKey(same), '9171234567', same);
for (const blank of ['', '   ', 'n/a', '123', '02 8123 4567', '0917 123 456', '0917 123 45678', '+1 212 555 0100'])assert.equal(phone.phMobileKey(blank), '', JSON.stringify(blank));
t.pass('phMobileKey: 0917..., +63 917-..., 9171234567 and 0063... are equal; short, long, landline or blank give no key');

// ---------- 2. The flag on a record (pure) ----------
const rec = (contactPhone, agentPhone, ownerPhone) => ({ fields: { contactPhone, agentPhone }, ...(ownerPhone === undefined ? {} : { ownerAgent: { phone: ownerPhone } }) });
assert.equal(phone.hasSharedMobile(rec('0917 123 4567', '+63 917-123-4567')), true);
assert.equal(phone.hasSharedMobile(rec('09171234567', '9171234567')), true);
assert.equal(phone.hasSharedMobile(rec('09171234567', '09171234568')), false, 'a different number never flags');
assert.equal(phone.hasSharedMobile(rec('', '')), false, 'two blanks never flag');
assert.equal(phone.hasSharedMobile(rec('09171234567', '')), false, 'a blank on one side never flags');
assert.equal(phone.hasSharedMobile(rec('02 8123 4567', '02 8123 4567')), false, 'a landline is not a mobile');
assert.equal(phone.hasSharedMobile(rec('09171234567', '09998887777', '09171234567')), true, 'an owner-linked record compares with the owner phone');
assert.equal(phone.hasSharedMobile(rec('09171234567', '09171234567', '09998887777')), false, 'an owner-linked record ignores the form agent phone');
assert.equal(phone.hasSharedMobile(rec('09171234567', '09171234567', '')), true, 'an owner with no phone on file falls back to the form agent phone (the contract: ownerAgent.phone || agentPhone)');
t.pass('hasSharedMobile: formats, blanks, landline, different numbers and the owner phone');

// ---------- 3. samePerson / sameAgent keep their exact old behaviour ----------
assert.equal(rules.sameAgent({ agentPhone: '0917 123 4567', agentName: 'Dr. Ana Cruz' }, { agentPhone: '+63 917 123 4567', agentName: 'Ana Cruz' }), true);
assert.equal(rules.sameAgent({ agentPhone: '0917123', agentName: 'Ana Cruz' }, { agentPhone: '917123', agentName: 'Ana Cruz' }), true, 'old rule: short numbers still match (phMobileKey would give no key)');
assert.equal(rules.sameAgent({ agentPhone: '09171234567', agentName: 'Ana Cruz' }, { agentPhone: '09171234568', agentName: 'Ana Cruz' }), false);
assert.equal(rules.sameAgent({ agentEmail: 'A@x.com', agentPhone: '1' }, { agentEmail: 'a@x.com', agentPhone: '2' }), true);
t.pass('client-rules sameAgent keeps its own phone comparison (unchanged)');

// ---------- 4. End to end: intake -> list summaries; never blocks ----------
const cryssa = t.user('cryssa'), head = t.user('emerson'), dh = t.user('division-head');
const sheet = (company, contactPhone, agentPhone, extra = {}) => forms.sampleForm({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent ' + company, agentPhone, contactName: 'Contact ' + company, contactEmail: 'c@example.com', contactPhone, contactPosition: 'HR', existingProvider: 'None', addressee: 'Contact ' + company, addresseePosition: 'HR', requestedPlan: 'Group', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '22-50', dependentAges: '', hospitals: '', dental: '', ...extra });
const file = async (company, c, a) => new File([new Uint8Array(await sheet(company, c, a))], company + '.xlsx', { type: 'application/octet-stream' });
const shared = await service.intake(cryssa, await file('Shared Mobile Co', '0917 555 0101', '+63 917-555-0101'), 'agent1@example.com');
const other = await service.intake(cryssa, await file('Different Mobile Co', '0917 555 0102', '0917 555 0199'), 'agent2@example.com');
const view = await queries.workspaceView(head, new URLSearchParams({ view: 'Inquiries' }));
const row = id => view.inquiries.find(item => item.id === id);
assert.equal(row(shared.id)?.sharedMobile, true);
assert.equal(row(other.id)?.sharedMobile, undefined);
assert.equal('sharedMobile' in row(other.id), false, 'the key is absent, not false');
const savedShared = await t.get(shared.id);
assert.equal(savedShared.clientReview.state, 'clear', 'the flag does not hold or review the client');
assert.ok(!types.documentIssues(savedShared.fields).some(issue => /mobile|phone/i.test(issue)), 'not a document issue');
assert.ok(!types.missingFields(savedShared.fields).some(issue => /mobile|phone/i.test(issue)), 'not a missing field');
assert.equal(JSON.stringify(savedShared).includes('sharedMobile'), false, 'derived at read time, not stored on the record');
t.pass('Employee/Head list summaries carry sharedMobile only for the matching inquiry; client review stays clear; no new blocker');

// ---------- 5. An owner-linked inquiry uses the owner phone; owner-scoped users never see the flag ----------
const owned = await service.intake(dh, await file('Owner Linked Co', dh.phone, '0917 000 0000'), 'ignored@example.com');
assert.equal(phone.hasSharedMobile(await t.get(owned.id)), true, 'client mobile equals the Division Head phone');
const ownedRow = (await queries.workspaceView(head, new URLSearchParams({ view: 'Inquiries' }))).inquiries.find(item => item.id === owned.id);
assert.equal(ownedRow?.sharedMobile, true);
const mine = await ownerView.listOwnerClients(dh);
assert.ok(mine.length > 0);
assert.equal(JSON.stringify(mine).includes('sharedMobile'), false, 'the owner view never carries the flag');
assert.equal((await ownerView.ownerClient(dh, owned.id)) && JSON.stringify(await ownerView.ownerClient(dh, owned.id)).includes('sharedMobile'), false);
t.pass('owner-linked inquiry compares with the owner phone; owner-scoped responses never include sharedMobile');

console.log(t.checks.length + ' checks passed');
