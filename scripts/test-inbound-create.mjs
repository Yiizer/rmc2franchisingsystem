// "Create inquiry from this email" (2026-11-13): staff type an inquiry from an email on Requests that has no usable form.
// SQLite, throwaway data dir, no mailbox.   node scripts/test-inbound-create.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('inbound-create');
const inbound = await t.load('inbound'), db = t.db;
const cryssa = t.user('cryssa'), head = t.user('emerson'), dh = t.user('division-head');
const put = async (over = {}) => {
  const id = randomUUID(), record = { id, messageId: '<' + id + '@agent.example.test>', receivedAt: new Date().toISOString(), storedAt: new Date().toISOString(), from: 'agent.lim@agent.example.test', fromName: 'Agent Lim', replyTo: '', subject: 'Request for a proposal', snippet: 'Hi, please send a proposal for Lim Bakery, 25 staff.', text: 'Hi,\n\nPlease send a proposal for Lim Bakery.\n25 employees, ages 22-50.\n\nThanks, Lim', attachments: [], auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', aligned: true }, state: 'new', ...over };
  await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?)', id, record.messageId, record.receivedAt, record.state, JSON.stringify(record));
  return id;
};
const state = async id => (await db.get('SELECT state FROM inbound_messages WHERE id=?', id)).state;
const body = (company = 'Lim Bakery') => ({ fields: { company, agentName: 'Agent Lim', agentEmail: 'agent.lim@agent.example.test', employees: '25', employeeAges: '22-50', sector: 'Private' }, idempotencyKey: randomUUID() });

// 1. An Employee creates the inquiry; it is marked as coming by email, and the email as imported.
const id = await put();
const record = await inbound.createFromInbound(cryssa, id, body());
assert.match(record.id, /^INQ-\d{4}-\d{5}$/);
assert.equal(record.fields.company, 'Lim Bakery'); assert.equal(record.source.origin, 'email'); assert.equal(record.source.sender, 'agent.lim@agent.example.test');
assert.equal(record.source.replyToFrom, undefined, 'no warning when replies go to the sender');
const row = JSON.parse((await db.get('SELECT data FROM inbound_messages WHERE id=?', id)).data);
assert.equal(row.state, 'imported'); assert.equal(row.inquiryId, record.id); assert.equal(row.handledBy, 'cryssa');
const listed = (await inbound.listInbound(cryssa)).messages.find(m => m.id === id);
assert.equal(listed.text.split('\n')[2], 'Please send a proposal for Lim Bakery.', 'the full text keeps its line breaks for Requests');
t.pass('An Employee creates an inquiry from an email without a form: it records origin email and the sender, and the email shows as imported with that inquiry');

// 2. Nobody can create a second inquiry from the same email.
assert.equal(await t.status(inbound.createFromInbound(cryssa, id, body())), 409);
t.pass('A second create from the same email is refused (409 "a colleague already handled this email")');

// 3. Refusals put the email back on Requests.
const id2 = await put();
assert.equal(await t.status(inbound.createFromInbound(head, id2, body())), 403, 'the Head does not create inquiries');
assert.equal(await state(id2), 'new');
assert.equal(await t.status(inbound.createFromInbound(cryssa, id2, { fields: { company: '' }, idempotencyKey: randomUUID() })), 400);
assert.equal(await state(id2), 'new');
assert.equal(await t.status(inbound.createFromInbound(dh, id2, body())), 403, 'a Division Head cannot reach Requests');
const other = body('Other Bakery'); other.fields.agentEmail = 'someone.else@agent.example.test';
const changed = await inbound.createFromInbound(cryssa, id2, other);
assert.equal(await state(id2), 'imported');
assert.equal(changed.source.replyToFrom, 'agent.lim@agent.example.test', 'replies going elsewhere than the sender show the existing warning');
t.pass('The Head (403), a Division Head (403) and invalid details (400) are refused and the email goes back to "To review"; a retry works, and an agent email other than the sender keeps the "Reply-To differs from From" warning');
console.log(t.checks.length + ' checks passed');
