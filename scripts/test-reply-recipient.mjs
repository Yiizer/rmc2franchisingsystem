// Feedback round 2026-11-07, item 9: every outcome email (decline, request details, proposal sent) goes to ONE resolved address. Local mail mode only:
// a capture transport records what the app asked to send and the local test mailbox writes the .eml. Nothing leaves this machine.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setup } from './feedback-harness.mjs';

const t = await setup('reply-recipient');
process.env.RMC2_MAIL_TEST_HOOK = '1';
const [service, forms, activity, registration, transport, recipient, fileStore] = await Promise.all(['service', 'forms', 'activity', 'registration-actions', 'mail-transport', 'reply-recipient', 'file-store'].map(t.load));
const db = t.db, cryssa = t.user('cryssa'), head = t.user('emerson'), dh = t.user('division-head');

// ---------- capture transport (wraps the local mailbox; can be told to fail) ----------
const sent = [];
let failNext = null;
transport.setTestTransport(() => ({ async send(mail) { if (failNext) { const error = failNext; failNext = null; throw error; } sent.push(mail); return await new transport.LocalMailTransport().send(mail); } }));

// ---------- helpers ----------
const values = company => ({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent Smith', agentPhone: '0917' + String(Math.random()).slice(2, 9), contactName: 'Contact ' + company, contactEmail: 'c@example.com', contactPhone: '0998' + String(Math.random()).slice(2, 9), contactPosition: 'HR', existingProvider: 'None', addressee: 'Contact ' + company, addresseePosition: 'HR', requestedPlan: 'Group', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '22-50', dependentAges: '', hospitals: '', dental: '' });
let n = 0;
const uploaded = async (sender, options = {}, who = cryssa) => { n++; return service.intake(who, new File([new Uint8Array(await forms.sampleForm(values('Recipient Co ' + n)))], 'form-' + n + '.xlsx'), sender, options); };
const typed = async agentEmail => { n++; return service.intakeFields(cryssa, { fields: { ...values('Typed Recipient Co ' + n), agentEmail }, idempotencyKey: randomUUID() }); };
const start = async (id, who = cryssa) => activity.updateInquiryActivity(id, who, await t.session(who), { tab: randomUUID(), action: 'start' });
const patch = async (id, change) => { const r = await t.get(id); change(r); r.revision++; await db.run('UPDATE inquiries SET revision=?,data=? WHERE id=?', r.revision, JSON.stringify(r), id); return r; };
const emlText = async file => (await fileStore.files().get(file)).toString();
const lastTo = () => sent.at(-1).to;
async function proposalSent(id) { // a submitted v1 (with a stale recipient override, as older records had) approved by the Head
  const key = 'generated/' + randomUUID() + '.pdf';
  await fileStore.files().put(key, Buffer.from('%PDF-1.4\nproposal\n%%EOF'), { contentType: 'application/pdf' });
  const at = new Date().toISOString();
  const record = await patch(id, r => { r.status = 'Awaiting approval'; r.email = { to: 'stale@example.com', subject: 'Proposal', body: 'Body' }; r.emailOverrides = ['to']; r.submissions = [{ version: 1, at, submittedBy: 'cryssa', fields: r.fields, email: { ...r.email }, emailOverrides: ['to'], generated: { id: 'g1', templateId: 't', sourceHash: 'h', pdf: key, docx: 'x', filename: 'Proposal-' + id, generatedAt: at, preparedBy: 'cryssa', fingerprint: 'f', fields: r.fields, pageCount: 1 }, notes: '', warnings: [] }]; });
  const done = await service.decide(id, head, { revision: record.revision, version: 1, action: 'approve', note: '', flags: [] });
  assert.equal(done.status, 'Sent');
  return done;
}
/** Runs the three outcomes on three fresh copies of one scenario and checks each went to `expected`. */
async function threeOutcomes(label, make, expected, edit) {
  const [forDetails, forDecline, forProposal] = [await make(), await make(), await make()];
  for (const record of [forDetails, forDecline, forProposal])if (edit) await patch(record.id, edit);
  // request missing details
  await start(forDetails.id);
  const before = sent.length;
  const details = await service.requestDetails(forDetails.id, cryssa, { revision: (await t.get(forDetails.id)).revision, body: 'Please send the employee list.' });
  assert.equal(sent.length, before + 1); assert.equal(lastTo(), expected, label + ' details');
  assert.equal(details.detailRequests.at(-1).to, expected); assert.match(await emlText(details.detailRequests.at(-1).file), new RegExp('To: ' + expected.replace('.', '\\.'), 'i'));
  // decline with the email
  const declined = await registration.declineInquiry(forDecline.id, head, { revision: (await t.get(forDecline.id)).revision, reason: 'Outside our territory.', email: { send: true, body: 'We cannot take this request.' } });
  assert.equal(lastTo(), expected, label + ' decline'); assert.equal(sent.at(-1).subject, 'Request declined — ' + declined.fields.company); assert.equal(sent.at(-1).kind, 'decline');
  assert.equal(sent.at(-1).body, 'We cannot take this request.'); assert.equal(declined.status, 'Declined'); assert.equal(declined.closure.email.to, expected);
  assert.match(await emlText(declined.closure.email.file), new RegExp('To: ' + expected.replace('.', '\\.'), 'i'));
  assert.ok(declined.history.at(-1).action.includes('decline email'), 'the audit line records the sent email');
  // proposal sent at approval
  const done = await proposalSent(forProposal.id);
  assert.equal(lastTo(), expected, label + ' proposal'); assert.equal(sent.at(-1).kind, 'reply');
  assert.equal(done.submissions[0].email.to, expected, 'the submission records the real recipient');
  const outbox = JSON.parse((await db.get("SELECT data FROM outbox WHERE inquiry_id=? AND kind='proposal'", forProposal.id)).data);
  assert.equal(outbox.email.to, expected);
}

// ---------- 1. An email-imported inquiry whose agentEmail was edited later ----------
{
  const probe = await uploaded('original.sender@agents.example', { origin: 'email' });
  assert.equal(probe.source.sender, 'original.sender@agents.example'); assert.equal(probe.source.origin, 'email'); assert.equal(probe.email.to, 'original.sender@agents.example');
  assert.equal(recipient.replyRecipient(probe), 'original.sender@agents.example');
  await threeOutcomes('email-imported', () => uploaded('original.sender@agents.example', { origin: 'email' }), 'original.sender@agents.example', r => { r.fields.agentEmail = 'edited.later@elsewhere.example'; r.email.to = 'edited.later@elsewhere.example'; });
  t.pass('Email-imported: after agentEmail is edited, decline, request-details and proposal-sent still go to the original sender');
}

// ---------- 2. A manual entry: the agent email on the record IS the sender ----------
{
  const probe = await typed('typed.agent@example.com');
  assert.equal(recipient.replyRecipient(probe), 'typed.agent@example.com'); assert.equal(probe.email.to, 'typed.agent@example.com');
  await threeOutcomes('manual', () => typed('typed.agent@example.com'), 'typed.agent@example.com');
  // the field is edited later (typo fix or otherwise): the address fixed at intake is still used
  await threeOutcomes('manual-edited', () => typed('typed.agent@example.com'), 'typed.agent@example.com', r => { r.fields.agentEmail = 'edited.agent@example.com'; });
  const pure = await t.load('reply-address');
  assert.equal(pure.replyAddress({ source: { sender: 'a@b.com', fields: { agentEmail: 'c@d.com' } } }), 'a@b.com');
  assert.equal(pure.replyAddress({ source: { fields: { agentEmail: 'c@d.com' } } }), 'c@d.com');
  assert.equal(pure.replyAddress({ source: { sender: 'not an email', fields: { agentEmail: 'c@d.com' } } }), '');
  assert.equal(pure.replyAddress({ source: { fields: {} } }), '');
  t.pass('Manual entry: all three go to the address typed at intake, even after fields.agentEmail is edited; replyAddress (client-safe) agrees with replyRecipient');
}

// ---------- 3. An owner-linked inquiry ----------
{
  await threeOutcomes('owner-submitted', () => uploaded('ignored@example.com', {}, dh), dh.email);
  await threeOutcomes('owner-linked email import', () => uploaded(dh.email, { origin: 'email', ownerId: dh.id }), dh.email, r => { r.fields.agentEmail = 'someone.else@example.com'; });
  t.pass('Owner-linked: all three go to the Division Head’s account email, not to the form’s agent email');
}

// ---------- 4. A record from before this change (no origin, no sender) ----------
{
  await threeOutcomes('legacy', () => uploaded('legacy.sender@agents.example'), 'legacy.sender@agents.example', r => { delete r.source.origin; delete r.source.sender; r.fields.agentEmail = 'edited@elsewhere.example'; });
  const bare = await uploaded('x@example.com');
  await patch(bare.id, r => { delete r.source.origin; delete r.source.sender; r.source.fields.agentEmail = ''; });
  await start(bare.id);
  assert.equal(await t.status(service.requestDetails(bare.id, cryssa, { revision: (await t.get(bare.id)).revision, body: 'Details please' })), 422, 'no reply address: refused');
  const refused = await service.requestDetails(bare.id, cryssa, { revision: (await t.get(bare.id)).revision, body: 'Details please' }).catch(e => e);
  assert.equal(refused.message, 'No reply address on this inquiry.');
  assert.equal(await t.status(registration.declineInquiry(bare.id, cryssa, { revision: (await t.get(bare.id)).revision, reason: 'Not eligible at all.', email: { send: true, body: 'No.' } })), 422);
  assert.notEqual((await t.get(bare.id)).status, 'Declined', 'the decline is not recorded when there is no address');
  t.pass('Legacy records use the original form’s agent email; with no safe address the send is refused (422 "No reply address on this inquiry.")');
}

// ---------- 5. saveDraft ignores a `to` override ----------
{
  const record = await uploaded('real.sender@agents.example', { origin: 'email' });
  await start(record.id);
  const body = (r, email, emailOverrides) => ({ revision: r.revision, fields: r.fields, templateId: '', notes: '', email, emailOverrides });
  let current = await t.get(record.id);
  const saved = await service.saveDraft(record.id, cryssa, body(current, { to: 'hijack@elsewhere.example', subject: 'Own subject', body: 'Own body' }, ['to', 'subject', 'body']));
  assert.equal(saved.email.to, 'real.sender@agents.example', 'the To override is ignored');
  assert.deepEqual(saved.emailOverrides.sort(), ['body', 'subject'], 'and stripped from the stored overrides');
  assert.equal(saved.email.subject, 'Own subject'); assert.equal(saved.email.body, 'Own body');
  current = saved;
  const edited = await service.saveDraft(record.id, cryssa, { ...body(current, { to: 'hijack@elsewhere.example', subject: 'Own subject', body: 'Own body' }, ['to']), fields: { ...current.fields, agentEmail: 'edited.field@elsewhere.example' } });
  assert.equal(edited.email.to, 'real.sender@agents.example', 'editing the agent email field does not move an imported inquiry’s recipient');
  assert.equal(edited.fields.agentEmail, 'edited.field@elsewhere.example');
  t.pass('saveDraft drops a To override and keeps To = the resolved original sender, even when the agent email field is edited');
}

// ---------- 6. Decline email: failure, retry, no email, permissions ----------
{
  const record = await uploaded('decline.sender@agents.example', { origin: 'email' });
  const revision = async () => (await t.get(record.id)).revision;
  const count = sent.length;
  failNext = new transport.MailSendError('NETWORK');
  assert.equal(await t.status(registration.declineInquiry(record.id, head, { revision: await revision(), reason: 'Outside our territory.', email: { send: true, body: 'Sorry.' } })), 422);
  assert.equal((await t.get(record.id)).status, 'New inquiry', 'a failed send does not decline');
  assert.equal(sent.length, count);
  assert.equal((await db.get("SELECT status FROM outbox WHERE inquiry_id=? AND kind='decline'", record.id)).status, 'failed');
  assert.equal(await t.status(registration.declineInquiry(record.id, head, { revision: await revision(), reason: 'Outside our territory.', email: { send: true, body: '   ' } })), 400, 'an empty message is refused');
  assert.equal(await t.status(registration.declineInquiry(record.id, t.user('admin'), { revision: await revision(), reason: 'Outside our territory.', email: { send: true, body: 'Sorry.' } })), 403, 'only people who may prepare proposals can email');
  assert.equal(await t.status(registration.declineInquiry(record.id, head, { revision: await revision(), reason: 'Outside our territory.', email: { send: true, body: 'Sorry.', to: 'x@y.com' } })), 400, 'no to field is accepted');
  const done = await registration.declineInquiry(record.id, head, { revision: await revision(), reason: 'Outside our territory.', email: { send: true, body: 'Sorry.' } });
  assert.equal(done.status, 'Declined'); assert.equal(sent.length, count + 1); assert.equal(lastTo(), 'decline.sender@agents.example');
  assert.equal((await db.all("SELECT status FROM outbox WHERE inquiry_id=? AND kind='decline' ORDER BY version", record.id)).map(r => r.status).join(), 'failed,sent');
  // declining again never emails again
  const again = await registration.declineInquiry(record.id, head, { revision: done.revision, reason: 'Outside our territory.', email: { send: true, body: 'Sorry.' } }).catch(e => e);
  assert.equal(again.status, 409); assert.equal(sent.length, count + 1);
  // without the email box nothing is sent and the behaviour is the old one
  const quiet = await uploaded('quiet.sender@agents.example', { origin: 'email' });
  const before = sent.length;
  const quietDone = await registration.declineInquiry(quiet.id, cryssa, { revision: quiet.revision, reason: 'Outside our territory.' });
  assert.equal(quietDone.status, 'Declined'); assert.equal(sent.length, before); assert.equal(quietDone.closure.email, undefined);
  const unticked = await uploaded('unticked.sender@agents.example', { origin: 'email' });
  assert.equal((await registration.declineInquiry(unticked.id, cryssa, { revision: unticked.revision, reason: 'Outside our territory.', email: { send: false, body: 'ignored' } })).status, 'Declined');
  assert.equal(sent.length, before, 'send:false sends nothing');
  t.pass('Decline email: a failed send declines nothing and can be retried, one message per decline, empty body / extra keys / Admin refused, send:false behaves as before');
}

// ---------- 7. No outcome path builds its own `to` ----------
{
  const read = name => readFileSync('lib/operations/' + name, 'utf8');
  const code = readdirSync('lib/operations').filter(name => name.endsWith('.ts')).map(name => [name, read(name)]);
  const sends = code.flatMap(([name, text]) => [...text.matchAll(/\.send\(\{[^}]*?\bto:([^,}]+)/g)].map(match => [name, match[1].trim()]));
  assert.ok(sends.length >= 3);
  for (const [name, expr] of sends)assert.ok(['draft.to', 'mail.email.to'].includes(expr), name + ' sends to ' + expr);
  const service = read('service.ts'), registration = read('registration-actions.ts');
  assert.equal(/fields\.agentEmail/.test(service.replace(/documentIssues|agentEmail\?\.trim\(\)\.toLowerCase\(\)/g, '')) && /to:\s*record\.fields\.agentEmail/.test(service), false, 'service.ts does not build a To from fields.agentEmail');
  assert.equal(/to:\s*record\.fields\.agentEmail/.test(service) || /to:\s*record\.fields\.agentEmail/.test(registration), false);
  assert.ok(service.includes('replyRecipient(record)') && registration.includes('replyRecipient(record)'));
  t.pass('Source check: every mail send takes its To from the resolved reply recipient (drafted via replyRecipient), none from a record field');
}

console.log(t.checks.length + ' checks passed');
