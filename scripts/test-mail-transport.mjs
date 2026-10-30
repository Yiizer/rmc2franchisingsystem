// Pure tests for the outbound-mail guards. No network, no credentials, never contacts any mail server:
// the SMTP transport is only ever exercised through an injected fake sender.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// nodemailer is a bare import, so modules are transpiled to real files (under the gitignored test-results/) instead of data: URLs.
const outDir = path.resolve('test-results', 'mail-test');
await mkdir(outDir, { recursive: true });
const load = async name => {
  const source = await readFile(`lib/operations/${name}.ts`, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(mail-config|mail-transport)'/g, "from './$1.mjs'");
  const file = path.join(outDir, name + '.mjs');
  await writeFile(file, js);
  return import(pathToFileURL(file).href + '?t=' + Date.now());
};
const config = await load('mail-config');
const transport = await load('mail-transport');
const { parseMailConfig, mailStatusFor, isSafeEmail, maskEmail, LIVE_CONFIRM } = config;
const { prepareMessage, assertEnvelope, SmtpMailTransport, LocalMailTransport, MailSendError, mapSmtpError, safeFilename, MAX_ATTACHMENT_BYTES, MAIL_REASONS } = transport;

const cwd = process.cwd();
const stagingDir = path.join(cwd, 'test-results', 'staging-data'), realDir = path.join(cwd, '.data');
const SECRET = 'SECRET-APP-PW-123';
const base = { RMC2_MAIL_MODE: 'smtp', RMC2_MAIL_ENV: 'staging', RMC2_SMTP_HOST: 'smtp.example.test', RMC2_SMTP_PORT: '465', RMC2_SMTP_USER: 'sender@example.test', RMC2_SMTP_APP_PASSWORD: SECRET, RMC2_MAIL_FROM_ADDRESS: 'sender@example.test', RMC2_MAIL_FROM_NAME: 'RMC2 Test', RMC2_MAIL_ALLOWLIST: 'tester@example.test', RMC2_MAIL_REDIRECT_TO: 'tester@example.test' };
const cfg = (over = {}, dir = stagingDir) => parseMailConfig({ ...base, ...over }, dir, cwd);
const good = cfg();
const mail = (over = {}) => ({ messageId: '11111111-2222-3333-4444-555555555555', to: 'agent@client.test', subject: 'Proposal for Acme', body: 'Hello', attachments: [{ filename: 'Proposal.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' }], kind: 'reply', ...over });
const code = fn => { try { fn(); } catch (e) { return e instanceof MailSendError ? e.code : 'OTHER:' + e.message; } return 'NO_THROW'; };
const codeAsync = async fn => { try { await fn(); } catch (e) { return e instanceof MailSendError ? e.code : 'OTHER:' + e.message; } return 'NO_THROW'; };
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const headersOf = eml => eml.toString().split('\r\n\r\n')[0];
const fakeFactory = (impl, calls = []) => () => ({ sendMail: async options => { calls.push(options); return impl(options); }, close() { calls.close = (calls.close || 0) + 1; } });
const accept = options => ({ accepted: options.envelope.to, rejected: [], messageId: options.messageId });

await check('valid staging config parses; status masks and never exposes host, user or password', () => {
  assert.equal(good.mode, 'smtp'); assert.equal(good.env, 'staging'); assert.deepEqual(good.redirectTo, ['tester@example.test']);
  const status = mailStatusFor(good);
  assert.equal(status.redirectedTo, 'te•••@example.test'); assert.equal(status.dryRun, false);
  for (const text of [JSON.stringify(status), JSON.stringify(good), String(Object.keys(good))]) { assert.ok(!text.includes(SECRET)); assert.ok(!text.includes('smtp.example.test')); }
  assert.ok(!JSON.stringify(status).includes('sender@example.test'));
  assert.equal(good.smtp.pass, SECRET); // available to the transport only (non-enumerable)
  assert.ok(!('smtp' in { ...good }));
  assert.equal(mailStatusFor(cfg({ RMC2_MAIL_DRY_RUN: '1' })).dryRun, true);
});
await check('local is the default; empty values count as unset', () => {
  assert.equal(parseMailConfig({}, stagingDir, cwd).mode, 'local');
  assert.equal(parseMailConfig({ RMC2_MAIL_MODE: '  ' }, stagingDir, cwd).mode, 'local');
  assert.equal(mailStatusFor(parseMailConfig({ RMC2_MAIL_MODE: 'local', RMC2_MAIL_ENV: 'staging' }, stagingDir, cwd)).env, 'local');
  const s = cfg({ RMC2_SMTP_APP_PASSWORD: '' }); assert.equal(s.mode, 'local'); assert.ok(s.warning);
});
await check('guard refusals fall back to local with a value-free warning', () => {
  const refusals = {
    'missing redirect': { RMC2_MAIL_REDIRECT_TO: '' }, 'redirect not on allowlist': { RMC2_MAIL_REDIRECT_TO: 'other@example.test' },
    'empty allowlist': { RMC2_MAIL_ALLOWLIST: '', RMC2_MAIL_REDIRECT_TO: '' }, 'wildcard allowlist': { RMC2_MAIL_ALLOWLIST: '*@example.test', RMC2_MAIL_REDIRECT_TO: 'tester@example.test' },
    'star allowlist': { RMC2_MAIL_ALLOWLIST: '*' }, 'domain-only allowlist': { RMC2_MAIL_ALLOWLIST: 'example.test' },
    'unknown env': { RMC2_MAIL_ENV: 'qa' }, 'missing env': { RMC2_MAIL_ENV: '' }, 'local env': { RMC2_MAIL_ENV: 'local' },
    'unknown mode': { RMC2_MAIL_MODE: 'sendmail' }, 'sender not equal to smtp user': { RMC2_MAIL_FROM_ADDRESS: 'someone@example.test' },
    'missing host': { RMC2_SMTP_HOST: '' }, 'bad port': { RMC2_SMTP_PORT: 'abc' }, 'missing from name': { RMC2_MAIL_FROM_NAME: '' },
    'production without confirmation': { RMC2_MAIL_ENV: 'production' }, 'wrong confirmation': { RMC2_MAIL_ENV: 'production', RMC2_MAIL_LIVE_CONFIRM: 'yes' },
  };
  for (const [name, over] of Object.entries(refusals)) {
    const c = cfg(over); assert.equal(c.mode, 'local', name); assert.ok(c.warning, name); assert.ok(!c.warning.includes(SECRET) && !c.warning.includes('example.test'), name);
  }
  assert.equal(cfg({ RMC2_MAIL_ENV: 'production', RMC2_MAIL_LIVE_CONFIRM: LIVE_CONFIRM }, stagingDir).mode, 'local', 'production is refused under test-results even when confirmed');
  assert.equal(cfg({}, realDir).mode, 'local', 'staging smtp on the real .data directory');
  assert.equal(cfg({}, path.join(realDir, 'nested')).mode, 'local');
  assert.equal(cfg({ RMC2_MAIL_ENV: 'production', RMC2_MAIL_LIVE_CONFIRM: LIVE_CONFIRM }, path.join(cwd, 'prod-data')).mode, 'smtp', 'production needs confirm + non-test data dir');
});
await check('email validator and masking', () => {
  for (const bad of ['a@b.com,c@d.com', '"x@y.com"@z.com', 'a@b.com\r\nBcc: e@x.com', 'ａ@b.com', 'a@b.com;c@d.com', '<a@b.com>', 'a b@c.com', 'a@b', 'a@@b.com', '(a)@b.com', 'a@b..com', 'K@b.com', 'a@b.com\u2028', '']) assert.equal(isSafeEmail(bad), false, JSON.stringify(bad));
  for (const ok of ['a@b.com', 'First.Last+tag@Sub.Example.co']) assert.equal(isSafeEmail(ok), true, ok);
  assert.equal(maskEmail('tester@gmail.com'), 'te•••@gmail.com'); assert.equal(maskEmail('ab@x.co'), 'a•••@x.co');
});
await check('redirect rewrites envelope, header, subject and body; original never reaches the envelope', async () => {
  const { options, envelope } = prepareMessage(good, mail());
  assert.deepEqual(envelope, { from: 'sender@example.test', to: ['tester@example.test'] });
  assert.deepEqual(options.envelope, envelope); assert.deepEqual(options.to, [{ name: '', address: 'tester@example.test' }]);
  assert.equal(options.from.address, 'sender@example.test'); assert.equal(options.subject, '[TEST → agent@client.test] Proposal for Acme');
  assert.ok(options.text.startsWith('[TEST EMAIL') && options.text.includes('agent@client.test') && options.text.endsWith('Hello'));
  assert.equal(options.headers['X-RMC2-Original-To'], 'agent@client.test'); assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  assert.ok(!('cc' in options) && !('bcc' in options) && !('replyTo' in options));
  const result = await new SmtpMailTransport(cfg({ RMC2_MAIL_DRY_RUN: '1' }), () => { throw new Error('must not connect'); }).send(mail());
  const head = headersOf(result.eml);
  assert.match(head, /^To: .*tester@example\.test/m); assert.ok(!/^(To|Cc|Bcc): .*agent@client\.test/mi.test(head)); assert.match(head, /X-RMC2-Original-To: agent@client\.test/i);
});
await check('injection attempts are refused before anything is built', () => {
  for (const to of ['a@b.com,c@d.com', '"x@y.com"@z.com', 'agent@client.test\r\nBcc: evil@x.test', 'ａgent@client.test', 'agent@client.test;evil@x.test', 'Agent <agent@client.test>', 'agent@client.test\u2028']) assert.equal(code(() => prepareMessage(good, mail({ to }))), 'GUARD_REFUSED', JSON.stringify(to));
  assert.equal(code(() => prepareMessage(good, mail({ messageId: 'x\r\nBcc: e@x.test' }))), 'GUARD_REFUSED');
});
await check('CRLF in subject/body cannot create headers', async () => {
  const sneaky = mail({ subject: 'Hi\r\nBcc: evil@x.test\u2028Cc: e2@x.test\0', body: 'line1\r\nBcc: not-a-header@x.test\u2029x\0' });
  const { options } = prepareMessage(good, sneaky);
  assert.ok(!/[\r\n\u2028\u2029\0]/.test(options.subject)); assert.ok(!options.text.includes('\0') && !options.text.includes('\r') && !/[\u2028\u2029]/.test(options.text));
  const result = await new SmtpMailTransport(cfg({ RMC2_MAIL_DRY_RUN: '1' }), () => { throw new Error('no'); }).send(sneaky);
  const head = headersOf(result.eml);
  assert.ok(!/^bcc:/im.test(head)); assert.ok(!/^cc:/im.test(head)); assert.ok(!head.includes('evil@x.test') || /^Subject:/im.test(head));
});
await check('final gate: exact, case-insensitive allowlist membership; plus-addressing and lookalikes do not match', () => {
  const plus = cfg({ RMC2_MAIL_ALLOWLIST: 'tester+a@example.test', RMC2_MAIL_REDIRECT_TO: 'tester+a@example.test' });
  assert.equal(plus.mode, 'smtp'); assert.equal(code(() => assertEnvelope(plus, ['tester+a@example.test'])), 'NO_THROW'); assert.equal(code(() => assertEnvelope(plus, ['TESTER+A@example.test'])), 'NO_THROW');
  for (const bad of ['tester@example.test', 'tester+b@example.test', 'tester+a@example.test.evil.test', 'xtester+a@example.test', 'tester+a@example.test,x@y.test', '']) assert.equal(code(() => assertEnvelope(plus, [bad])), 'GUARD_REFUSED', bad);
  assert.equal(code(() => assertEnvelope(good, ['tester@example.test', 'other@example.test'])), 'GUARD_REFUSED');
  assert.equal(code(() => assertEnvelope(good, [])), 'GUARD_REFUSED');
  assert.equal(code(() => assertEnvelope(good, ['Kester@example.test'])), 'GUARD_REFUSED');
  const tampered = { ...good, redirectTo: ['evil@x.test'] }; assert.equal(code(() => prepareMessage(tampered, mail())), 'GUARD_REFUSED', 'redirect outside allowlist');
  const none = { ...good, redirectTo: [] }; assert.equal(code(() => prepareMessage(none, mail())), 'GUARD_REFUSED', 'no redirect');
  const local = parseMailConfig({}, stagingDir, cwd); assert.equal(code(() => prepareMessage(local, mail())), 'GUARD_REFUSED', 'local config cannot build smtp mail');
});
await check('production config sends unredirected, unprefixed mail only to a valid exact address', () => {
  const prod = cfg({ RMC2_MAIL_ENV: 'production', RMC2_MAIL_LIVE_CONFIRM: LIVE_CONFIRM }, path.join(cwd, 'prod-data'));
  const { options, envelope } = prepareMessage(prod, mail()); assert.deepEqual(envelope.to, ['agent@client.test']); assert.equal(options.subject, 'Proposal for Acme'); assert.equal(options.text, 'Hello'); assert.ok(!options.headers);
  assert.equal(code(() => prepareMessage(prod, mail({ to: 'a@b.com,c@d.com' }))), 'GUARD_REFUSED');
});
await check('filenames are sanitized; attachments over 15 MB are refused', () => {
  for (const name of ['../../etc/passwd', 'Pro posal\r\nX: y.pdf', '..hidden.pdf', 'ünï.pdf', '', '....', 'a'.repeat(300) + '.pdf']) { const clean = safeFilename(name); assert.match(clean, /^[A-Za-z0-9._-]+$/, name); assert.ok(!clean.startsWith('.'), name); assert.ok(clean.length <= 100); }
  const { options } = prepareMessage(good, mail({ attachments: [{ filename: '../x y\r\n.pdf', content: Buffer.from('a'), contentType: 'application/pdf; evil=1' }] }));
  assert.match(options.attachments[0].filename, /^[A-Za-z0-9._-]+$/); assert.equal(options.attachments[0].contentType, 'application/octet-stream'); assert.ok(Buffer.isBuffer(options.attachments[0].content));
  assert.equal(code(() => prepareMessage(good, mail({ attachments: [{ filename: 'a.pdf', content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), contentType: 'application/pdf' }] }))), 'ATTACHMENT_TOO_LARGE');
  assert.equal(code(() => prepareMessage(good, mail({ attachments: [{ filename: 'a.pdf', content: Buffer.alloc(MAX_ATTACHMENT_BYTES), contentType: 'application/pdf' }] }))), 'NO_THROW');
});
await check('dry run builds and validates without connecting; guard failures still apply', async () => {
  const dry = cfg({ RMC2_MAIL_DRY_RUN: '1' }); let connected = 0;
  const result = await new SmtpMailTransport(dry, () => { connected++; throw new Error('no'); }).send(mail());
  assert.equal(connected, 0); assert.equal(result.dryRun, true); assert.equal(result.mode, 'smtp-redirected'); assert.ok(result.eml.includes('tester@example.test'));
  assert.equal(await codeAsync(() => new SmtpMailTransport(dry, () => { connected++; throw new Error('no'); }).send(mail({ to: 'bad,x@y.test' }))), 'GUARD_REFUSED'); assert.equal(connected, 0);
});
await check('smtp send passes the redirected envelope to the sender, verifies acceptance and closes it', async () => {
  const calls = [];
  const result = await new SmtpMailTransport(good, fakeFactory(accept, calls)).send(mail());
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].envelope.to, ['tester@example.test']); assert.equal(calls.close, 1); assert.equal(result.dryRun, false); assert.equal(result.mode, 'smtp-redirected');
  assert.equal(await codeAsync(() => new SmtpMailTransport(good, fakeFactory(o => ({ accepted: [], rejected: o.envelope.to }))).send(mail())), 'RECIPIENT_REFUSED');
});
await check('errors map to safe reasons and uncertainty is decided by the SMTP stage', async () => {
  const run = async err => { try { await new SmtpMailTransport(good, fakeFactory(() => { throw err; })).send(mail()); } catch (e) { return e; } };
  const leaky = 'agent@client.test tester@example.test ' + SECRET;
  const cases = [
    [{ code: 'EAUTH', command: 'AUTH PLAIN', message: leaky }, 'AUTH', false], [{ code: 'EENVELOPE', command: 'RCPT TO', message: leaky }, 'RECIPIENT_REFUSED', false],
    [{ code: 'ETIMEDOUT', command: 'CONN', message: leaky }, 'TIMEOUT', false], [{ code: 'ETIMEDOUT', command: 'DATA', message: leaky }, 'TIMEOUT', true],
    [{ code: 'ECONNECTION', command: 'CONN', message: leaky }, 'NETWORK', false], [{ code: 'ESOCKET', command: 'CONN', message: 'connect ECONNREFUSED ' + leaky }, 'NETWORK', false], [{ code: 'ESOCKET', command: 'DATA END', message: 'socket timeout ' + leaky }, 'TIMEOUT', true],
    [{ code: 'EPROTOCOL', command: 'DATA END', message: leaky }, 'UNKNOWN', true], [new Error(leaky), 'UNKNOWN', true],
  ];
  for (const [err, expectedCode, uncertain] of cases) {
    const e = await run(err); assert.ok(e instanceof MailSendError, expectedCode); assert.equal(e.code, expectedCode); assert.equal(e.uncertain, uncertain, expectedCode + ' uncertain');
    for (const text of [e.safeReason, e.message, JSON.stringify(e)]) { assert.ok(!text.includes('@') && !text.includes(SECRET), expectedCode + ' leaks'); }
  }
  for (const reason of Object.values(MAIL_REASONS)) assert.ok(!reason.includes('@') && !/password:|secret/i.test(reason));
  assert.ok(mapSmtpError(null) instanceof MailSendError);
});
await check('overall timeout aborts a hung send as uncertain and releases the connection', async () => {
  const calls = [];
  const hung = new SmtpMailTransport(good, fakeFactory(() => new Promise(() => {}), calls), 25);
  const started = Date.now();
  const e = await hung.send(mail()).catch(x => x);
  assert.equal(e.code, 'TIMEOUT'); assert.equal(e.uncertain, true); assert.ok(Date.now() - started < 1000); assert.equal(calls.close, 1);
});
await check('local transport writes the legacy-style message and still validates recipient and attachments', async () => {
  const local = new LocalMailTransport();
  const result = await local.send(mail({ subject: 'Hi\r\nBcc: e@x.test' }));
  const text = result.eml.toString(); assert.equal(result.mode, 'local-test'); assert.match(text, /^To: agent@client\.test/m); assert.ok(!/^Bcc:/im.test(text.split('\r\n\r\n')[0])); assert.match(text, /filename="Proposal\.pdf"/);
  assert.equal(await codeAsync(() => local.send(mail({ to: 'a@b.com, c@d.com' }))), 'GUARD_REFUSED');
  assert.equal(await codeAsync(() => local.send(mail({ attachments: [{ filename: 'a.pdf', content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), contentType: 'application/pdf' }] }))), 'ATTACHMENT_TOO_LARGE');
});
console.log(`\n${passed} mail-transport checks passed (no network used)`);
