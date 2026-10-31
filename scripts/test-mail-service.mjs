// Service-level mail tests: real service + SQLite in a throwaway data directory, fake transport / dry run.
// No network: the SMTP transport is never reached (a fake transport is injected via the env-guarded test hook).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const dir = path.resolve('test-results', 'mail-service', String(Date.now()));
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
process.env.RMC2_DATA_DIR = dir;
process.env.RMC2_MAIL_TEST_HOOK = '1';
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_(?!TEST_HOOK)|SMTP_)/.test(key)) delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const database = await imp('database.ts'), svc = await imp('service.ts'), transport = await imp('mail-transport.ts'), types = await imp('types.ts'), wq = await imp('workspace-query.ts');
const { db, allUsers, inquiry, persist } = database;
if (db.dialect !== 'sqlite') throw new Error('test-mail-service is SQLite-only (it rewrites mail_sends and lease rows directly)');
const { MailSendError } = transport;

const smtpEnv = { RMC2_MAIL_MODE: 'smtp', RMC2_MAIL_ENV: 'staging', RMC2_SMTP_HOST: 'smtp.example.test', RMC2_SMTP_PORT: '465', RMC2_SMTP_USER: 's@example.test', RMC2_SMTP_APP_PASSWORD: 'pw', RMC2_MAIL_FROM_ADDRESS: 's@example.test', RMC2_MAIL_FROM_NAME: 'T', RMC2_MAIL_ALLOWLIST: 'tester@example.test', RMC2_MAIL_REDIRECT_TO: 'tester@example.test' };
const setEnv = (extra = null) => { for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_(?!TEST_HOOK)|SMTP_)/.test(key)) delete process.env[key]; if (extra) Object.assign(process.env, extra); };
let behavior = null, sends = [];
const ok = config => ({ at: new Date().toISOString(), providerId: 'fake', mode: config.mode === 'smtp' ? 'smtp-redirected' : 'local-test', dryRun: false, eml: Buffer.from('From: fake\r\n\r\nbody') });
transport.setTestTransport(config => ({ send: async mail => { sends.push(mail); return behavior ? await behavior(config, mail) : ok(config, mail); } }));
const fail = (code, uncertain = false) => async () => { throw new MailSendError(code, undefined, true, uncertain); };

const users = await allUsers(), emerson = users.find(u => u.id === 'emerson'), admin = users.find(u => u.id === 'admin'), emp = users.find(u => u.id === 'cryssa');
mkdirSync(path.join(dir, 'files'), { recursive: true }); writeFileSync(path.join(dir, 'files', 'x.pdf'), '%PDF-1.4 test');
const base = (await db.all('SELECT id FROM inquiries ORDER BY id')).map(r => r.id)[0];
let counter = 0;
const lease = async id => { await db.run('INSERT OR REPLACE INTO sessions VALUES (?,?,?)','s' + id, 'cryssa', new Date(Date.now() + 3600000).toISOString()); await db.run('INSERT OR REPLACE INTO inquiry_activity VALUES (?,?,?,?,?,?)','s' + id, 't', id, 'cryssa', new Date().toISOString(), new Date().toISOString()); };
async function fresh(kind = 'approval') {
  const r = structuredClone(await inquiry(base)); r.id = 'INQ-2026-9' + String(++counter).padStart(4, '0'); r.revision = 1; r.history = []; r.fields.agentEmail = 'agent@client.test'; r.fields.company = 'Acme ' + counter;
  r.submissions = [];
  if (kind === 'approval') {
    r.status = 'Awaiting approval';
    r.submissions = [{ version: 1, at: new Date().toISOString(), submittedBy: 'cryssa', fields: { ...r.fields }, email: { to: 'agent@client.test', subject: 'Proposal', body: 'Hello' }, emailOverrides: [], generated: { pdf: 'files/x.pdf', filename: 'Proposal', docx: '', id: 'g', fingerprint: 'f' }, notes: '', warnings: [] }];
  } else r.status = 'Preparing proposal';
  await persist(r); if (kind !== 'approval') await lease(r.id);
  return r.id;
}
const approve = async (id, failSend = false) => svc.decide(id, emerson, { revision: (await inquiry(id)).revision, version: 1, action: 'approve', note: '', flags: [], failSend });
const retry = async id => svc.retry(id, emerson, (await inquiry(id)).revision);
const status = async (fn, expected) => { try { await fn(); } catch (e) { assert.equal(e.status, expected, e.message); return e; } assert.fail('expected status ' + expected); };
const rejectsZod = fn => assert.rejects(async () => fn(), e => e.name === "ZodError");
const outbox = async id => (await db.get("SELECT status FROM outbox WHERE inquiry_id=? AND kind='proposal'",id))?.status;
let passed = 0;
const check = async (name, fn) => { setEnv(); behavior = null; sends = []; await fn(); passed++; console.log('PASS ' + name); };

await check('workspace payload (both branches) carries mail status and the gmail label reflects the mode', async () => {
  const view = await wq.workspaceView(admin, new URLSearchParams());
  assert.equal(view.mail.mode, 'local'); assert.equal(typeof view.mail.label, 'string'); assert.equal(view.mail.env, 'local');
  const gated = await wq.workspaceView({ ...emp, mustChangePassword: true }, new URLSearchParams());
  assert.equal(gated.mail.mode, 'local');
  setEnv(smtpEnv); const smtp = await wq.workspaceView(admin, new URLSearchParams());
  assert.equal(smtp.mail.mode, 'smtp'); assert.equal(smtp.mail.redirectedTo, 'te•••@example.test'); assert.match(smtp.integrations.gmail, /TEST EMAIL/);
  assert.ok(!JSON.stringify(smtp).includes('"pw"') && !JSON.stringify(smtp.mail).includes('smtp.example.test'));
});
await check('email validation: documentIssues and save-time rejection', async () => {
  for (const bad of ['a@b.com,c@d.com', 'a@b.com;c@d.com', '<a@b.com>', 'a b@c.com', 'a@b.com\r\nBcc: x@y.com']) assert.ok(types.documentIssues({ agentEmail: bad }).includes('Valid agent reply email'), bad);
  assert.ok(!types.documentIssues({ agentEmail: 'agent@client.test' }).includes('Valid agent reply email'));
  const id = await fresh('draft'), rec = await inquiry(id);
  const draft = async over => ({ revision: (await inquiry(id)).revision, fields: { ...rec.fields, ...over.fields }, templateId: '', notes: '', email: { ...rec.email, ...over.email }, emailOverrides: over.email ? ['to'] : [] });
  for (const bad of ['a@b.com,c@d.com', 'a@b.com;c@d.com', '<a@b.com>', 'a b@c.com']) await status(async () => svc.saveDraft(id, emp, await draft({ fields: { agentEmail: bad } })), 400);
  await status(async () => svc.saveDraft(id, emp, await draft({ email: { to: 'x@y.com,z@y.com' } })), 400);
  assert.equal((await inquiry(id)).fields.agentEmail, 'agent@client.test');
});
await check('double claim: concurrent retries send once, the other gets 409', async () => {
  const id = await fresh(); let r = await approve(id, true);
  assert.equal(r.status, 'Approved — email failed'); assert.equal(r.mailFailure.code, 'SIMULATED'); assert.equal(await outbox(id), 'failed');
  behavior = async (c, m) => { await new Promise(res => setTimeout(res, 60)); return ok(c, m); };
  const rev = (await inquiry(id)).revision;
  const [a, b] = await Promise.allSettled([svc.retry(id, emerson, rev), svc.retry(id, emerson, rev)]);
  const results = [a, b]; assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.find(x => x.status === 'rejected').reason.status, 409);
  assert.equal(sends.length, 1); assert.equal((await inquiry(id)).status, 'Sent'); assert.equal((await inquiry(id)).submissions[0].delivery.mode, 'local-test'); assert.equal(await outbox(id), 'sent');
  await status(() => retry(id), 409);
});
await check('failed -> retry -> uncertain blocks retry, then confirmSent matrix', async () => {
  setEnv(smtpEnv);
  const id = await fresh(); behavior = fail('NETWORK'); let r = await approve(id);
  assert.equal(r.status, 'Approved — email failed'); assert.equal(r.mailFailure.code, 'NETWORK');
  behavior = fail('TIMEOUT', true); r = await retry(id);
  assert.equal(r.status, 'Approved — sending'); assert.equal(r.mailUncertain, true); assert.equal(r.mailFailure, undefined); assert.equal(await outbox(id), 'uncertain');
  const calls = sends.length; await status(() => retry(id), 409); assert.equal(sends.length, calls, 'uncertain must never resend');
  const rev = (await inquiry(id)).revision;
  await status(async () => svc.confirmSent(id, emerson, { revision: rev, reason: 'checked the inbox ok' }), 403);
  await status(async () => svc.confirmSent(id, emp, { revision: rev, reason: 'checked the inbox ok' }), 403);
  await rejectsZod(() => svc.confirmSent(id, admin, { revision: rev, reason: 'short' }));
  await status(async () => svc.confirmSent(id, admin, { revision: rev - 1, reason: 'checked the inbox ok' }), 409);
  const sentOnly = await fresh(); behavior = null; await approve(sentOnly);
  await status(async () => svc.confirmSent(sentOnly, admin, { revision: (await inquiry(sentOnly)).revision, reason: 'not uncertain at all' }), 409);
  const c = await svc.confirmSent(id, admin, { revision: rev, reason: 'Verified in the test inbox' });
  assert.equal(c.status, 'Sent'); const d = c.submissions[0].delivery; assert.equal(d.confirmedManually, true); assert.equal(d.mode, 'smtp-redirected'); assert.equal(d.redirectedTo, 'te•••@example.test'); assert.ok(c.protection); assert.equal(c.mailUncertain, undefined); assert.equal(await outbox(id), 'sent');
  assert.ok(c.history.at(-1).action.startsWith('Manually confirmed — not verified by SMTP'));
  await status(async () => svc.confirmNotSent(id, admin, { revision: c.revision, reason: 'already confirmed sent' }), 409);
});
await check('confirmNotSent matrix and failed -> retry -> uncertain -> not sent -> retry -> Sent', async () => {
  const id = await fresh(); behavior = fail('NETWORK'); await approve(id);
  behavior = fail('TIMEOUT', true); await retry(id);
  const rev = (await inquiry(id)).revision;
  await status(async () => svc.confirmNotSent(id, emerson, { revision: rev, reason: 'it never arrived' }), 403);
  await rejectsZod(() => svc.confirmNotSent(id, admin, { revision: rev, reason: 'no' }));
  const other = await fresh(); behavior = fail('NETWORK'); await approve(other);
  await status(async () => svc.confirmNotSent(other, admin, { revision: (await inquiry(other)).revision, reason: 'not uncertain at all' }), 409);
  const n = await svc.confirmNotSent(id, admin, { revision: rev, reason: 'Nothing arrived in the inbox' });
  assert.equal(n.status, 'Approved — email failed'); assert.equal(n.mailUncertain, false); assert.equal(await outbox(id), 'failed'); assert.ok(!n.protection);
  assert.ok(n.history.at(-1).action.startsWith('Admin confirmed the email was NOT received — resend allowed (duplicate risk acknowledged)'));
  behavior = null; const r = await retry(id); assert.equal(r.status, 'Sent'); assert.ok(r.protection);
});
await check('recoverStuckMail turns a stale sending row into uncertain (and keeps the status confirmable)', async () => {
  const id = await fresh(); const r = await inquiry(id); r.status = 'Approved — email failed'; r.mailFailure = { code: 'NETWORK', safeReason: 'x', at: new Date().toISOString() }; await persist(r, r.revision);
  await db.run('INSERT INTO outbox VALUES (?,?,?,?,?,?)','stuck-' + id, id, 1, 'proposal', 'sending', JSON.stringify({ sendingAt: new Date(Date.now() - 300000).toISOString(), mode: 'local-test' }));
  await db.run('INSERT INTO outbox VALUES (?,?,?,?,?,?)','live-' + id, id, 9, 'proposal', 'sending', JSON.stringify({ sendingAt: new Date().toISOString() }));
  await svc.recoverStuckMail(); const s = await inquiry(id);
  assert.equal(s.mailUncertain, true); assert.equal(s.status, 'Approved — sending'); assert.equal(s.mailFailure, undefined);
  assert.equal((await db.get('SELECT status FROM outbox WHERE id=?','live-' + id)).status, 'sending', 'fresh sending rows are left alone');
  // first Retry after recovery must give the uncertain answer, not a revision conflict
  const e = await status(() => svc.retry(id, emerson, r.revision + 0), 409); assert.match(e.message, /unknown|changed/);
  const e2 = await status(async () => svc.retry(id, emerson, (await inquiry(id)).revision), 409); assert.match(e2.message, /unknown/);
  const c = await svc.confirmSent(id, admin, { revision: (await inquiry(id)).revision, reason: 'Seen in the test inbox' }); assert.equal(c.status, 'Sent'); assert.equal(c.submissions[0].delivery.mode, 'local-test');
});
await check('caps: 5 per hour boundary, 20 per day boundary, old rows pruned, failures count', async () => {
  setEnv(smtpEnv); await db.exec('DELETE FROM mail_sends'); // SQLite-only test; the table is created by openDatabase now
  const ids = []; for (let i = 0; i < 7; i++) ids.push(await fresh());
  for (let i = 0; i < 5; i++) assert.equal((await approve(ids[i])).status, 'Sent');
  const sixth = await approve(ids[5]); assert.equal(sixth.status, 'Approved — email failed'); assert.equal(sixth.mailFailure.code, 'RATE_LIMITED');
  assert.equal(sends.length, 5, 'the capped attempt never reached the transport');
  const rows = async () => (await db.get('SELECT COUNT(*) n FROM mail_sends')).n; assert.equal(await rows(), 5);
  // hour window slides: age the rows past 1h but inside the day -> allowed again
  await db.run('UPDATE mail_sends SET at=?',new Date(Date.now() - 2 * 3600000).toISOString());
  assert.equal((await retry(ids[5])).status, 'Sent');
  // day cap: fill to 19 rows older than an hour, one more is allowed (20), the next is not
  const need = 19 - await rows(); for (let i = 0; i < need; i++) await db.run('INSERT INTO mail_sends VALUES (?,?,?,?)','d' + i, new Date(Date.now() - 3 * 3600000).toISOString(), 'reply', 'o');
  assert.equal(await rows(), 19); assert.equal((await approve(ids[6])).status, 'Sent'); assert.equal(await rows(), 20);
  const extra = await fresh(); const blocked = await approve(extra); assert.equal(blocked.mailFailure.code, 'RATE_LIMITED');
  // rows older than 2 days are pruned on the next attempt
  await db.run('UPDATE mail_sends SET at=?',new Date(Date.now() - 3 * 86400000).toISOString());
  assert.equal((await retry(extra)).status, 'Sent'); assert.equal(await rows(), 1);
  // failed attempts count too
  behavior = fail('NETWORK'); const f = await fresh(); await approve(f); assert.equal(await rows(), 2);
});
await check('requestDetails failure leaves status, protection and requests untouched; success records them', async () => {
  const id = await fresh('draft'); const before = await inquiry(id);
  behavior = fail('NETWORK'); let e = await status(() => svc.requestDetails(id, emp, { revision: before.revision, body: 'Please send TIN' }), 422);
  assert.ok(!/@/.test(e.message)); const after = await inquiry(id);
  assert.equal(after.status, 'Preparing proposal'); assert.equal(after.protection, undefined); assert.equal(after.detailRequests.length, 0); assert.equal(after.revision, before.revision);
  assert.equal((await db.get("SELECT status FROM outbox WHERE inquiry_id=? AND kind='details'",id)).status, 'failed');
  behavior = fail('TIMEOUT', true); e = await status(() => svc.requestDetails(id, emp, { revision: before.revision, body: 'Please send TIN' }), 422); assert.match(e.message, /may have been delivered/); assert.equal((await inquiry(id)).status, 'Preparing proposal');
  setEnv(smtpEnv); await db.exec('DELETE FROM mail_sends'); behavior = null;
  const ok1 = await svc.requestDetails(id, emp, { revision: before.revision, body: 'Please send TIN' });
  assert.equal(ok1.status, 'Waiting for agent details'); assert.equal(ok1.detailRequests.length, 1); assert.ok(ok1.protection);
});
await check('dry run: proposal stays Approved — sending, no delivery or protection, Retry later sends for real', async () => {
  setEnv({ ...smtpEnv, RMC2_MAIL_DRY_RUN: '1' }); behavior = async () => { throw new Error('transport must not be used in the dry-run check'); };
  transport.setTestTransport(null);
  const id = await fresh(); const r = await approve(id);
  assert.equal(r.status, 'Approved — sending'); assert.equal(r.submissions[0].delivery, undefined); assert.equal(r.protection, undefined); assert.equal(r.mailUncertain, undefined);
  assert.equal(r.mailDryRun.kind, 'reply'); assert.ok(existsSync(path.join(dir, r.mailDryRun.file))); assert.equal(await outbox(id), 'failed');
  assert.ok(r.history.at(-1).action.includes('Dry run — email built and checked, not sent'));
  const again = await retry(id); assert.equal(again.status, 'Approved — sending', 'retry in dry run is still allowed and still not completed');
  // details dry run
  const d = await fresh('draft'); const dr = await svc.requestDetails(d, emp, { revision: (await inquiry(d)).revision, body: 'Please send TIN' });
  assert.equal(dr.status, 'Preparing proposal'); assert.equal(dr.protection, undefined); assert.equal(dr.detailRequests.length, 0); assert.equal(dr.mailDryRun.kind, 'details'); assert.ok(existsSync(path.join(dir, dr.mailDryRun.file)));
  // dry run off -> real (fake) send completes the flow and clears the marker
  transport.setTestTransport(config => ({ send: async mail => { sends.push(mail); return ok(config, mail); } })); setEnv(smtpEnv); await db.exec('DELETE FROM mail_sends');
  const real = await retry(id); assert.equal(real.status, 'Sent'); assert.ok(real.protection); assert.equal(real.mailDryRun, undefined); assert.equal(real.submissions[0].delivery.mode, 'smtp-redirected');
  const dReal = await svc.requestDetails(d, emp, { revision: (await inquiry(d)).revision, body: 'Please send TIN' }); assert.equal(dReal.status, 'Waiting for agent details'); assert.equal(dReal.mailDryRun, undefined);
  behavior = null;
});
console.log(`\n${passed} mail-service checks passed (fake transport / dry run, no network)`);
process.exit(0);
