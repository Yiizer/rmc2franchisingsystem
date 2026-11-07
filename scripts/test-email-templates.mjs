// Feedback round 2026-11-07, item 10: each staff member's own email templates (settings key email_templates:<userId>). SQLite, local mail only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('email-templates');
process.env.RMC2_MAIL_TEST_HOOK = '1';
const [templates, service, forms, activity, registration, transport, types] = await Promise.all(['email-templates', 'service', 'forms', 'activity', 'registration-actions', 'mail-transport', 'types'].map(t.load));
const db = t.db, cryssa = t.user('cryssa'), jefferson = t.user('jefferson'), head = t.user('emerson'), zeo = t.user('zeo');
const sent = [];
transport.setTestTransport(() => ({ async send(mail) { sent.push(mail); return await new transport.LocalMailTransport().send(mail); } }));
const values = company => ({ company, sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent Smith', agentPhone: '0917' + String(Math.random()).slice(2, 9), contactName: 'Contact ' + company, contactEmail: 'c@example.com', contactPhone: '0998' + String(Math.random()).slice(2, 9), contactPosition: 'HR', existingProvider: 'None', addressee: 'Contact ' + company, addresseePosition: 'HR', requestedPlan: 'Group', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '22-50', dependentAges: '', hospitals: '', dental: '' });
let n = 0;
const uploaded = async () => { n++; return service.intake(cryssa, new File([new Uint8Array(await forms.sampleForm(values('Template Co ' + n)))], 'form-' + n + '.xlsx'), 'sender@agents.example', { origin: 'email' }); };
const act = async (who, id, action) => activity.updateInquiryActivity(id, who, await t.session(who), { tab: (act.tabs[who.id + id] ||= randomUUID()), action });
act.tabs = {};
const draft = (r, email, emailOverrides = [], templateId = '') => ({ revision: r.revision, fields: r.fields, templateId, notes: '', email, emailOverrides });
const catalog = (await t.database.catalog()).find(item => item.active);

// ---------- 1. Fill-in ----------
{
  const values = { agentName: 'Ana', company: 'Acme {company}', proposalName: 'Gold', myName: 'Cryssa' };
  assert.equal(templates.fillPlaceholders('Dear {agentName}, {company} / {proposalName} / {myName} / {agentName}', values), 'Dear Ana, Acme {company} / Gold / Cryssa / Ana', 'plain one-pass replacement: a value is never searched again');
  assert.equal(templates.fillPlaceholders('{foo} {Company} {agentName', values), '{foo} {Company} {agentName', 'unknown or unclosed braces stay as typed');
  assert.equal(templates.fillPlaceholders('${myName} {{company}}', values), '$Cryssa {Acme {company}}');
  assert.deepEqual(types.EMAIL_PLACEHOLDERS, ['{agentName}', '{company}', '{proposalName}', '{myName}']);
  t.pass('fillPlaceholders: the four placeholders are replaced once, anything else is left alone');
}

// ---------- 2. Read, save, reset ----------
{
  const first = await templates.getEmailTemplates(cryssa);
  assert.deepEqual(first.mine, {});
  assert.ok(first.defaults.proposal.subject.includes('{company}') && first.defaults.proposal.body.includes('{myName}') && first.defaults.details.body && first.defaults.decline.body);
  assert.ok(!('subject' in first.defaults.details) && !('subject' in first.defaults.decline));
  // The built-in wording, filled in, is exactly what defaultEmail writes today.
  const fields = { agentName: 'Ana', company: 'Acme' };
  const built = types.defaultEmail(fields, { name: 'Gold Plan' }, 'Cryssa');
  const viaDefaults = { subject: templates.fillPlaceholders(first.defaults.proposal.subject, { agentName: 'Ana', company: 'Acme', proposalName: 'Gold Plan', myName: 'Cryssa' }), body: templates.fillPlaceholders(first.defaults.proposal.body, { agentName: 'Ana', company: 'Acme', proposalName: 'Gold Plan', myName: 'Cryssa' }) };
  assert.deepEqual(viaDefaults, { subject: built.subject, body: built.body }, 'defaults are today’s wording turned into placeholders');
  const saved = await templates.saveEmailTemplates(cryssa, { proposal: { subject: ' Hello {company} ', body: 'Hi {agentName},\n{proposalName} is attached.\n\nBest regards,\nCryssa' }, details: { body: 'Details please, {agentName}.' } });
  assert.equal(saved.mine.proposal.subject, 'Hello {company}', 'the subject is trimmed');
  assert.ok(saved.mine.updatedAt);
  assert.deepEqual((await templates.getEmailTemplates(cryssa)).mine.details, { body: 'Details please, {agentName}.' });
  const partial = await templates.saveEmailTemplates(cryssa, { decline: { body: 'Sorry, {agentName}.' } });
  assert.ok(partial.mine.proposal && partial.mine.details && partial.mine.decline, 'a kind left out is unchanged');
  const reset = await templates.saveEmailTemplates(cryssa, { details: null });
  assert.equal(reset.mine.details, undefined, 'null resets that kind to the default'); assert.ok(reset.mine.proposal);
  await templates.saveEmailTemplates(cryssa, { proposal: null, decline: null });
  assert.deepEqual(Object.keys((await templates.getEmailTemplates(cryssa)).mine), ['updatedAt']);
  // validation
  for (const [label, body] of [['subject over 250', { proposal: { subject: 'x'.repeat(251), body: 'ok' } }], ['body over 10000', { details: { body: 'x'.repeat(10001) } }], ['empty body', { decline: { body: '' } }], ['multi-line subject', { proposal: { subject: 'a\nb', body: 'ok' } }], ['unknown kind', { bogus: { body: 'x' } }], ['a user id in the body', { userId: 'emerson', proposal: { subject: 's', body: 'b' } }], ['subject on details', { details: { subject: 's', body: 'b' } }], ['wrong type', { proposal: 'text' }]])assert.equal(await t.status(templates.saveEmailTemplates(cryssa, body)), 400, label);
  assert.equal((await templates.saveEmailTemplates(cryssa, { proposal: { subject: 'x'.repeat(250), body: 'y'.repeat(10000) } })).mine.proposal.body.length, 10000, 'the limits are inclusive');
  await templates.saveEmailTemplates(cryssa, { proposal: null });
  t.pass('Defaults mirror today’s wording; save is partial, null resets a kind; limits and unknown keys are enforced (400)');
}

// ---------- 3. Privacy and roles ----------
{
  await templates.saveEmailTemplates(cryssa, { proposal: { subject: 'Cryssa subject', body: 'Cryssa body' } });
  assert.deepEqual((await templates.getEmailTemplates(jefferson)).mine, {}, 'another Employee never sees it');
  assert.deepEqual((await templates.getEmailTemplates(head)).mine, {});
  await templates.saveEmailTemplates(jefferson, { proposal: { subject: 'Jefferson subject', body: 'Jefferson body' } });
  assert.equal((await templates.getEmailTemplates(cryssa)).mine.proposal.subject, 'Cryssa subject', 'saving as someone else never touches your template');
  assert.deepEqual((await db.all("SELECT key FROM settings WHERE key LIKE 'email_templates:%' ORDER BY key")).map(r => r.key), ['email_templates:cryssa', 'email_templates:jefferson']);
  for (const id of ['admin', 'division-head', 'soa']) {
    assert.equal(await t.status(templates.getEmailTemplates(t.user(id))), 403, id + ' GET');
    assert.equal(await t.status(templates.saveEmailTemplates(t.user(id), { proposal: { subject: 's', body: 'b' } })), 403, id + ' POST');
  }
  for (const who of [head, zeo])assert.equal(await t.status(templates.getEmailTemplates(who)), 200);
  assert.equal((await t.database.allUsers()).some(u => JSON.stringify(u).includes('Cryssa subject')), false, 'templates are never part of the staff list');
  const guard = await t.load('scope-guard');
  assert.equal(guard.ownerRouteAllowed('GET', ['email-templates']) || guard.ownerRouteAllowed('POST', ['email-templates']), false, 'owner roles are also blocked by the route whitelist');
  t.pass('Own templates only (keyed by the session user); Admin, Division Head and SOA get 403 and are not whitelisted; templates are not in Staff');
}

// ---------- 4. The proposal draft uses the preparer’s template ----------
{
  const record = await uploaded();
  await act(cryssa, record.id, 'start');
  let current = await t.get(record.id);
  const saved = await service.saveDraft(record.id, cryssa, draft(current, { to: '', subject: '', body: '' }, [], catalog.id));
  assert.equal(saved.email.subject, 'Cryssa subject');
  assert.equal(saved.email.body, 'Cryssa body');
  assert.equal(saved.email.to, 'sender@agents.example');
  await templates.saveEmailTemplates(cryssa, { proposal: { subject: 'Proposal for {company} ({proposalName})', body: 'Hi {agentName},\n{unknown} {proposalName} for {company}.\nRegards, {myName}' } });
  current = await t.get(record.id);
  const filled = await service.saveDraft(record.id, cryssa, draft(current, saved.email, [], catalog.id));
  assert.equal(filled.email.subject, `Proposal for ${filled.fields.company} (${catalog.name})`);
  assert.equal(filled.email.body, `Hi Agent Smith,\n{unknown} ${catalog.name} for ${filled.fields.company}.\nRegards, ${cryssa.name}`);
  // a per-email edit still wins over the template
  const edited = await service.saveDraft(record.id, cryssa, draft(filled, { ...filled.email, subject: 'My one-off subject' }, ['subject'], catalog.id));
  assert.equal(edited.email.subject, 'My one-off subject'); assert.equal(edited.email.body, filled.email.body);
  // Another preparer without a saved template gets the built-in wording with their own name
  await act(cryssa, record.id, 'leave');
  await templates.saveEmailTemplates(jefferson, { proposal: null });
  await act(jefferson, record.id, 'start');
  const theirs = await service.saveDraft(record.id, jefferson, draft(await t.get(record.id), edited.email, [], catalog.id));
  const builtIn = types.defaultEmail(theirs.fields, catalog, jefferson.name);
  assert.equal(theirs.email.subject, builtIn.subject); assert.equal(theirs.email.body, builtIn.body);
  assert.equal(theirs.email.body.includes(jefferson.name), true);
  t.pass('A draft saved by a user with a template uses it (placeholders filled, unknown left); a one-off subject edit still wins; a user without one gets the built-in wording');
}

// ---------- 5. Details and decline send exactly what the dialog sent ----------
{
  const forDetails = await uploaded(), forDecline = await uploaded();
  await act(cryssa, forDetails.id, 'start');
  const text = 'Dear {agentName}, custom words from the dialog. {company}';
  await service.requestDetails(forDetails.id, cryssa, { revision: (await t.get(forDetails.id)).revision, body: text });
  assert.equal(sent.at(-1).body, text, 'request details: the server does not rewrite the body'); assert.equal(sent.at(-1).kind, 'details');
  const declineText = 'Hello,\nWe decline. {myName}';
  await registration.declineInquiry(forDecline.id, head, { revision: (await t.get(forDecline.id)).revision, reason: 'Outside our territory.', email: { send: true, body: declineText } });
  assert.equal(sent.at(-1).body, declineText, 'decline: the server does not rewrite the body'); assert.equal(sent.at(-1).kind, 'decline');
  t.pass('Request details and decline send the dialog text unchanged');
}

console.log(t.checks.length + ' checks passed');
