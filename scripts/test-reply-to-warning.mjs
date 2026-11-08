// Pilot plan 2026-11-16, item 9: an emailed inquiry whose Reply-To differs from From keeps the From address, so the
// To line can warn "Reply-To differs from From". Local only, no server, nothing is sent.
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('reply-to-warning');
const [service, forms] = await Promise.all(['service', 'forms'].map(t.load));
const cryssa = t.user('cryssa'), dh = t.user('division-head');
const values = company => ({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent Smith', agentPhone: '09170000' + String(Math.floor(Math.random() * 900) + 100), agentEmail: 'agent@example.com', addressee: 'Ms Cruz', addresseePosition: 'HR', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '30' });
let n = 0;
const file = async () => { n++; return new File([new Uint8Array(await forms.sampleForm(values('Reply Warn Co ' + n)))], 'form-' + n + '.xlsx'); };

const differs = await service.intake(cryssa, await file(), 'replies@other.example', { origin: 'email', fromAddress: 'Agent@Example.com' });
assert.equal(differs.source.replyToFrom, 'agent@example.com');
t.pass('Reply-To differs from From: the From address is kept (lowercased)');

const same = await service.intake(cryssa, await file(), 'agent@example.com', { origin: 'email', fromAddress: 'AGENT@example.com' });
assert.equal(same.source.replyToFrom, undefined);
t.pass('Same address in another case: no warning');

const uploaded = await service.intake(cryssa, await file(), 'agent@example.com', { origin: 'upload' });
assert.equal(uploaded.source.replyToFrom, undefined);
t.pass('Upload without a From address: no warning');

const owner = await service.intake(dh, await file(), 'ignored@example.com', { fromAddress: 'someone@else.example' });
assert.equal(owner.source.replyToFrom, undefined);
t.pass('A Division Head / SOA submission replies to their own account: no warning');

console.log(t.checks.length + ' checks passed');
