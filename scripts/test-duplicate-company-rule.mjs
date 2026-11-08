// PO decision 2026-11-08 (F5): a duplicate hold needs the same company or the same submitted file. A shared client
// contact / addressee name alone, at a different company, no longer holds. Local only, no server, nothing is sent.
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('duplicate-company-rule');
const [service, forms] = await Promise.all(['service', 'forms'].map(t.load));
const cryssa = t.user('cryssa');
let n = 0;
const values = (company, contact) => ({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-08', agentName: 'Agent ' + (++n), agentPhone: '0917000' + String(1000 + n), agentEmail: 'agent' + n + '@example.test', contactName: contact, addressee: contact, addresseePosition: 'HR', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '30' });
const intake = async (company, contact, bytes) => { const data = bytes || await forms.sampleForm(values(company, contact)); return { record: await service.intake(cryssa, new File([new Uint8Array(data)], 'form-' + (++n) + '.xlsx'), 'agent' + n + '@example.test'), bytes: data }; };

const first = (await intake('Rule Check Foods', 'Ms. Pia Lopez')).record;
assert.equal(first.clientReview?.state, 'clear');

const sameContact = (await intake('Rule Check Builders', 'Ms. Pia Lopez')).record;
assert.notEqual(sameContact.clientReview?.state, 'duplicate', JSON.stringify(sameContact.clientReview?.matches));
t.pass('A different company that shares only the contact name is not held');

const sameCompany = (await intake('Rule Check Foods', 'Mr. Dan Reyes')).record;
assert.equal(sameCompany.clientReview?.state, 'duplicate');
assert.ok(sameCompany.clientReview.matches.some(m => m.inquiryId === first.id && m.reasons.includes('Same account / company')));
t.pass('The same company with another contact is held, reason "Same account / company"');

const both = (await intake('Rule Check Foods', 'Ms. Pia Lopez')).record;
const match = both.clientReview.matches.find(m => m.inquiryId === first.id);
assert.ok(match && match.reasons.includes('Same account / company') && match.reasons.includes('Same client / addressee name'));
t.pass('Same company and same contact: held, and the shared name is listed as an extra reason');

const original = await intake('Rule Check Original Name', 'Mr. Leo Cruz');
const resent = (await intake(null, null, original.bytes)).record;
assert.ok(resent.clientReview.matches.some(m => m.inquiryId === original.record.id && m.reasons.includes('Same submitted file')));
t.pass('The identical submitted file is still held');

console.log(t.checks.length + ' checks passed');
