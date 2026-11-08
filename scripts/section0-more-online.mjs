// REMAINING_WORK §0, second batch: the staff flows the first online check (pilot-check-online.mjs) did not run, on the
// ONLINE TEST version through the app's own API (vercel curl). Fictional data only (*.example.test). Sends no email:
// nothing here approves, declines or requests details.
//   1. BOR / agent transfer: an Employee asks, a Supervisor approves, the old registration becomes Transferred.
//   2. Template admin: upload a copy of a real template, preview it, publish it, then retire it again.
//   3. Accounts: the Head creates an account, first sign-in is forced to change the password, then the Head deactivates it.
//   4. Notifications: list and mark all read.
//   5. Two people at once: two agents send the same new client at the same moment; two staff open one inquiry together.
// Passwords come from the git-ignored test-results/online-credentials/CREDENTIALS.txt and are never printed.
//   node scripts/section0-more-online.mjs        (ONLY=<regex> runs matching checks)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';

const deployment = 'https://rmc2-test-yiizer.vercel.app', tmp = 'test-results/section0-online/tmp';
await mkdir(tmp, { recursive: true });
const logins = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(l => l.match(/^(\S+@rmc2\.local)\s+username:\s*(\S+).*password:\s*(\S+)/)).filter(Boolean)
  .map(m => [m[2] === 'undefined' ? m[1].split('@')[0] : m[2], { email: m[1], password: m[3] }]));
const cli = path.join(path.dirname(spawnSync('where', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const cookies = {}, tabs = {}, results = [];

function args(user, route, { json, form, binary } = {}) {
  const a = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', ...(binary ? ['--dump-header', '-'] : ['--include']), '--max-time', '180'];
  if (cookies[user]) a.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) a.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [k, v] of Object.entries(form)) a.push(k === 'file' ? '--form' : '--form-string', k + '=' + v);
  if (binary) a.push('--output', binary);
  return a;
}
function parse(user, route, text, expected) {
  const split = text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split), body = text.slice(split).trim();
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const sc = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (sc) cookies[user] = sc[1];
  let value = body; try { value = JSON.parse(body); } catch {}
  const shown = typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300);
  if (expected !== undefined) assert.equal(status, expected, route + ' (' + user + '): ' + (route === 'login' ? '[login response hidden]' : shown));
  return { status, value };
}
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
function vc(user, route, opts = {}) {
  const r = spawnSync(process.execPath, [cli, ...args(user, route, opts)], { input: opts.json === undefined ? undefined : JSON.stringify(opts.json), encoding: opts.binary ? 'latin1' : 'utf8', maxBuffer: 64 << 20, env });
  return parse(user, route, r.stdout || '', opts.expected ?? 200).value;
}
/** Same call, but resolves with {status, value} and runs alongside others (for the "two people at once" checks). */
function vcAsync(user, route, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args(user, route, opts)], { env });
    let out = ''; child.stdout.on('data', d => { out += d; });
    child.on('close', () => resolve(parse(user, route, out, undefined)));
    if (opts.json !== undefined) child.stdin.end(JSON.stringify(opts.json)); else child.stdin.end();
  });
}
const login = (user, creds = logins[user]) => vc(user, 'login', { json: { email: creds.email, password: creds.password } });
const activity = (user, record, action) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action } });
const leave = (user, record) => { try { activity(user, record, 'leave'); } catch {} };
const find = (user, id) => vc(user, 'bootstrap').inquiries.find(r => r.id === id);
const check = async (name, fn) => { if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' · ' + detail : '')); } catch (error) { results.push({ name, ok: false, detail: error.message.slice(0, 600) }); console.log('FAIL ' + name + ' · ' + error.message.slice(0, 600)); } };

const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, ''), today = new Date().toISOString().slice(0, 10);
const cells = { agentName: 'C7', requestDate: 'J7', branch: 'D8', agentPhone: 'J8', company: 'B10', industry: 'J11', address: 'C12', contactName: 'D14', contactEmail: 'B17', contactPhone: 'J16', contactPosition: 'C18', existingProvider: 'J18', addressee: 'B21', addresseePosition: 'G21', requestedPlan: 'D22', payment: 'G23', employees: 'D25', dependents: 'J24', employeeAges: 'C26', dependentAges: 'J26' };
async function formFile(key, company, agent, sample) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(sample); const sheet = book.worksheets[0];
  const values = { agentName: agent, requestDate: today, branch: 'Antipolo', agentPhone: '09175550' + String(Math.floor(Math.random() * 900) + 100), company, industry: 'Services', address: '2 Check Street, Antipolo City', contactName: 'Ms. Rhea Cruz', contactEmail: 'hr.' + key + '.' + stamp + '@clients.example.test', contactPhone: '09985550' + String(Math.floor(Math.random() * 900) + 100), contactPosition: 'HR Manager', existingProvider: 'None', addressee: 'Ms. Rhea Cruz', addresseePosition: 'HR Manager', requestedPlan: 'HMO', payment: 'Annual', employees: 40, dependents: 0, employeeAges: '25-50', dependentAges: '' };
  for (const [field, cell] of Object.entries(cells)) sheet.getCell(cell).value = values[field] ?? '';
  sheet.getCell('J10').value = 'PRIVATE';
  const file = path.join(tmp, 'Check-' + key + '.xlsx'); await writeFile(file, Buffer.from(await book.xlsx.writeBuffer()));
  return '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
const agentEmail = name => name.toLowerCase().replace(/[^a-z]+/g, '.') + '@agents.example.test';
const borPdf = path.join(tmp, 'bor.pdf');
await writeFile(borPdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

let createdUser;
try {
  for (const user of ['cryssa', 'jefferson', 'judy', 'emerson', 'zeo']) login(user);
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('cryssa', 'sample-form', { binary: sampleFile }); const sample = await readFile(sampleFile);

  // 1. BOR transfer: an Employee cannot transfer alone, so it becomes a request; the Supervisor approves it.
  await check('BOR transfer: Employee requests, Supervisor approves, old registration Transferred', async () => {
    const company = 'Check Transfer Builders ' + stamp;
    const first = vc('cryssa', 'intake', { form: { sender: agentEmail('Old Agent'), file: await formFile('bor-a', company, 'Old Agent', sample) }, expected: 201 }).inquiry;
    let second = vc('jefferson', 'intake', { form: { sender: agentEmail('New Agent'), file: await formFile('bor-b', company, 'New Agent', sample) }, expected: 201 }).inquiry;
    second = find('jefferson', second.id);
    assert.equal(second.clientReview?.state, 'duplicate', 'second request not held: ' + JSON.stringify(second.clientReview || null).slice(0, 200));
    const previous = find('jefferson', first.id);
    const requested = vc('jefferson', 'inquiries/' + second.id + '/bor-transfer', { form: { revision: String(second.revision), previousId: previous.id, previousRevision: String(previous.revision), reference: 'BOR-CHECK-' + stamp, note: 'Signed BOR from the client, checked against the letterhead.', verified: 'true', file: '@' + borPdf + ';type=application/pdf' } }).inquiry;
    assert.ok(requested.agentTransferRequest && !requested.agentTransferRequest.decision, 'no pending agent-change request');
    const done = vc('zeo', 'inquiries/' + second.id + '/agent-transfer-decision', { json: { revision: requested.revision, requestId: requested.agentTransferRequest.id, action: 'approve', note: 'BOR verified with the client by phone.' } }).inquiry;
    const old = find('zeo', first.id);
    assert.equal(old.status, 'Transferred', 'old registration status ' + old.status);
    assert.equal(done.clientReview?.state, 'clear', 'new request still held: ' + done.clientReview?.state);
    assert.equal(done.bor?.fromInquiryId, first.id);
    return second.id + ' now holds the client · ' + first.id + ' Transferred';
  });

  // 2. Template admin: re-upload a copy of a real template under a new name, preview, publish, retire.
  await check('Template upload, preview, publish, retire', async () => {
    const boot = vc('emerson', 'bootstrap'), base = boot.templates.find(t => t.sourceId === 'D054' && t.active) || boot.templates.find(t => t.active);
    const docx = path.join(tmp, 'template.docx'); vc('emerson', 'source/' + base.id, { binary: docx });
    const bytes = await readFile(docx); assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'source is not a .docx');
    const staged = vc('emerson', 'template-upload', { form: { family: 'Online Check Plan', variant: 'Check ' + stamp, sector: 'All', annualOnly: 'true', warnings: 'Online check copy. Retired again by the script.', templateId: '', expectedHash: '', file: '@' + docx + ';type=application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, expected: 201 });
    const preview = path.join(tmp, 'template-preview.pdf'); vc('emerson', 'template-stage/' + staged.id, { binary: preview });
    assert.equal((await readFile(preview)).subarray(0, 5).toString(), '%PDF-', 'preview is not a PDF');
    vc('cryssa', 'template-publish', { json: { id: staged.id, reviewed: true }, expected: 403 });
    const published = vc('emerson', 'template-publish', { json: { id: staged.id, reviewed: true } }).template;
    assert.ok(vc('cryssa', 'bootstrap').templates.some(t => t.id === published.id && t.active), 'employee does not see the published template');
    vc('emerson', 'template-active', { json: { id: published.id, expectedHash: published.sourceHash, active: false } });
    assert.ok(!vc('emerson', 'bootstrap').templates.find(t => t.id === published.id)?.active, 'template still available after retiring');
    return staged.pages + ' page preview · published ' + published.id.slice(0, 8) + ' · retired again · employee publish refused (403)';
  });

  // 3. Accounts: create, forced first-sign-in password change, deactivate.
  await check('Head creates an account, first sign-in must change password, Head deactivates it', () => {
    const username = 'check.' + stamp;
    const made = vc('emerson', 'create-account', { json: { name: 'Online Check Person', username, email: username + '@staff.example.test', role: 'Employee', position: 'Online check (test only)', canApprove: false, currentPassword: logins.emerson.password }, expected: 201 });
    createdUser = made.user;
    assert.equal(made.user.mustChangePassword, true, 'new account is not forced to change its password');
    const temp = { email: made.user.email, password: made.temporaryPassword }, fresh = { email: made.user.email, password: randomBytes(18).toString('base64url') };
    login('new', temp);
    const shell = vc('new', 'bootstrap'); assert.ok(shell.inquiries.length === 0 && shell.users.length === 1, 'a temporary-password account sees data'); const ws = vc('new', 'workspace'); assert.ok(ws.inquiries.length === 0 && ws.users.length === 1 && ws.templates.length === 0, 'workspace shows data before activation'); vc('new', 'directory?q=a', { expected: 403 });
    vc('new', 'account-settings', { json: { username, currentPassword: temp.password, password: fresh.password } });
    vc('new', 'login', { json: temp, expected: 401 });
    login('new', fresh); vc('new', 'bootstrap');
    vc('emerson', 'users', { json: { id: made.user.id, active: false, role: 'Employee', canApprove: false, currentPassword: logins.emerson.password } });
    createdUser = undefined;
    const after = vcAsync('new', 'login', { json: fresh });
    return after.then(r => { assert.notEqual(r.status, 200, 'deactivated account can still sign in'); return username + ' · temp password forced change · old password refused · deactivated (sign-in ' + r.status + ')'; });
  });

  // 4. Notifications: list, then mark all read.
  await check('Notifications list and mark all read', () => {
    const before = vc('cryssa', 'workspace').notifications || [];
    vc('cryssa', 'notifications', { json: { all: true } });
    const unread = (vc('cryssa', 'workspace').notifications || []).filter(n => !n.read && !n.readAt).length;
    assert.equal(unread, 0, unread + ' still unread');
    return before.length + ' notices · all marked read';
  });

  // 5a. Two agents send the same new client at the same moment: exactly one is free, the other is held.
  await check('Two agents send the same new client at once: one free, one held', async () => {
    const company = 'Check Same Moment Trading ' + stamp;
    const forms = [await formFile('race-a', company, 'Race Agent One', sample), await formFile('race-b', company, 'Race Agent Two', sample)];
    const [a, b] = await Promise.all([
      vcAsync('cryssa', 'intake', { form: { sender: agentEmail('Race Agent One'), file: forms[0] } }),
      vcAsync('judy', 'intake', { form: { sender: agentEmail('Race Agent Two'), file: forms[1] } }),
    ]);
    assert.deepEqual([a.status, b.status], [201, 201], 'intake statuses ' + a.status + '/' + b.status + ' ' + JSON.stringify(a.value).slice(0, 120) + ' ' + JSON.stringify(b.value).slice(0, 120));
    const ids = [a.value.inquiry.id, b.value.inquiry.id], all = vc('emerson', 'bootstrap').inquiries, states = ids.map(id => all.find(r => r.id === id)?.clientReview?.state || 'none');
    assert.equal(ids[0] === ids[1], false, 'both got the same reference');
    assert.equal(states.filter(s => s === 'duplicate').length, 1, 'expected exactly one held, got ' + states.join('/'));
    return ids.join(' and ') + ' · ' + states.join('/');
  });

  // 5b. Two staff open the same inquiry together: one works on it, the other sees who has it.
  await check('Two staff open one inquiry at once: one holds it, the other is told', async () => {
    const record = vc('cryssa', 'intake', { form: { sender: agentEmail('Shared Agent'), file: await formFile('shared', 'Check Shared Desk ' + stamp, 'Shared Agent', sample) }, expected: 201 }).inquiry;
    tabs.cryssa = randomUUID(); tabs.jefferson = randomUUID();
    const [x, y] = await Promise.all([
      vcAsync('cryssa', 'inquiries/' + record.id + '/activity', { json: { tab: tabs.cryssa, action: 'start' } }),
      vcAsync('jefferson', 'inquiries/' + record.id + '/activity', { json: { tab: tabs.jefferson, action: 'start' } }),
    ]);
    const summary = [x, y].map(r => r.status + ':' + JSON.stringify(r.value).slice(0, 160)).join(' | ');
    const holders = new Set([x.value, y.value].flatMap(v => [v?.lease?.userId, v?.activity?.lease?.userId, v?.holder?.id].filter(Boolean)));
    // Whoever lost must not be able to save over the holder.
    const fresh = find('emerson', record.id), loser = [x, y].find(r => r.status !== 200) ? ([x, y].indexOf([x, y].find(r => r.status !== 200)) === 0 ? 'cryssa' : 'jefferson') : null;
    leave('cryssa', record); leave('jefferson', record);
    assert.ok(holders.size <= 1, 'two holders: ' + summary);
    return record.id + ' · ' + (loser ? loser + ' refused' : 'both answered 200') + ' · ' + summary.slice(0, 260) + ' · revision ' + fresh.revision;
  });
} finally {
  if (createdUser) try { vc('emerson', 'users', { json: { id: createdUser.id, active: false, role: 'Employee', canApprove: false, currentPassword: logins.emerson.password } }); } catch {}
  for (const user of Object.keys(cookies)) try { vc(user, 'logout', { json: {} }); } catch {}
  await writeFile('test-results/section0-online/check-results.json', JSON.stringify(results, null, 2));
  console.log(results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
}
