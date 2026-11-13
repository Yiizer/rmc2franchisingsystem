// Pilot plan 2026-11-16, REMAINING_WORK §0: runs the never-tested staff flows on the ONLINE TEST version through the
// app's own API (vercel curl), with fictional clients and agents only (*.example.test). Mail is in staging mode, so every
// send goes to the test inbox: one approval, one details request, one decline (3 sends).
// Passwords come from the git-ignored test-results/online-credentials/CREDENTIALS.txt and are never printed.
//   node scripts/pilot-check-online.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';

const deployment = 'https://rmc2-test-yiizer.vercel.app', tmp = 'test-results/pilot-online/tmp';
await mkdir(tmp, { recursive: true });
const logins = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(l => l.match(/^(\S+@rmc2\.local)\s+username:\s*(\S+).*password:\s*(\S+)/)).filter(Boolean)
  .map(m => [m[2] === 'undefined' ? m[1].split('@')[0] : m[2], { email: m[1], password: m[3] }]));
const cli = path.join(path.dirname(spawnSync('where', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const cookies = {}, tabs = {}, results = [];
function vc(user, route, { json, form, expected = 200, binary = false } = {}) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', ...(binary ? ['--dump-header', '-'] : ['--include']), '--max-time', '180'];
  if (cookies[user]) args.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [k, v] of Object.entries(form)) args.push(k === 'file' ? '--form' : '--form-string', k + '=' + v);
  if (binary) args.push('--output', binary);
  const r = spawnSync(process.execPath, [cli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: binary ? 'latin1' : 'utf8', maxBuffer: 64 << 20, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const text = r.stdout || '', split = text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split), body = text.slice(split).trim();
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const sc = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (sc) cookies[user] = sc[1];
  let value = body; try { value = JSON.parse(body); } catch {}
  const shown = typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300);
  assert.equal(status, expected, route + ' (' + user + '): ' + (route === 'login' ? '[login response hidden]' : shown));
  return value;
}
const login = user => vc(user, 'login', { json: { email: logins[user].email, password: logins[user].password } });
const start = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'start' } });
const leave = (user, record) => { try { vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'leave' } }); } catch {} };
const act = (user, record, name, extra = {}) => vc(user, 'inquiries/' + record.id + '/' + name, { json: { revision: record.revision, ...extra } }).inquiry;
const save = (user, record, changes = {}) => act(user, record, 'save', { fields: record.fields, templateId: record.templateId, notes: record.notes, email: record.email, emailOverrides: record.emailOverrides, ...changes });
const check = async (name, fn) => { if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' · ' + detail : '')); } catch (error) { results.push({ name, ok: false, detail: error.message.slice(0, 600) }); console.log('FAIL ' + name + ' · ' + error.message.slice(0, 600)); } };

const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, ''), today = new Date().toISOString().slice(0, 10);
const cells = { agentName: 'C7', requestDate: 'J7', branch: 'D8', agentPhone: 'J8', company: 'B10', industry: 'J11', address: 'C12', contactName: 'D14', contactEmail: 'B17', contactPhone: 'J16', contactPosition: 'C18', existingProvider: 'J18', addressee: 'B21', addresseePosition: 'G21', requestedPlan: 'D22', payment: 'G23', employees: 'D25', dependents: 'J24', employeeAges: 'C26', dependentAges: 'J26', hospitals: 'C29', dental: 'I29' };
async function formFile(key, company, agent, sample, extra = {}) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(sample); const sheet = book.worksheets[0];
  const values = { agentName: agent, requestDate: today, branch: 'Antipolo', agentPhone: '09175550' + String(Math.floor(Math.random() * 900) + 100), company, industry: 'Services', address: '1 Pilot Street, Antipolo City', contactName: 'Ms. Pia Lopez', contactEmail: 'hr.' + key + '@clients.example.test', contactPhone: '09985550123', contactPosition: 'HR Manager', existingProvider: 'None', addressee: 'Ms. Pia Lopez', addresseePosition: 'HR Manager', requestedPlan: 'Total CorpoHealthCheck', payment: 'Annual', employees: 40, dependents: 0, employeeAges: '22–55', dependentAges: '', hospitals: 'For confirmation', dental: 'For confirmation', ...extra };
  for (const [field, cell] of Object.entries(cells)) sheet.getCell(cell).value = values[field] ?? '';
  sheet.getCell('J10').value = 'PRIVATE';
  const file = path.join(tmp, 'Pilot-' + key + '.xlsx'); await writeFile(file, Buffer.from(await book.xlsx.writeBuffer()));
  return '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
const agentEmail = name => name.toLowerCase().replace(/[^a-z]+/g, '.') + '@agents.example.test';

try {
  for (const user of ['cryssa', 'jefferson', 'judy', 'emerson', 'zeo', 'admin', 'division-head']) login(user);
  const boot = vc('emerson', 'bootstrap'), template = boot.templates.find(t => t.sourceId === 'D054' && t.active) || boot.templates.find(t => t.active);
  const dh = boot.users.find(u => u.email === 'divisionhead@rmc2.local');
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('cryssa', 'sample-form', { binary: sampleFile }); const sample = await readFile(sampleFile);
  const company = 'Pilot Check Foods ' + stamp;
  let main, details, declined;
  const ONLY = process.env.ONLY; if (ONLY) main = vc('emerson', 'bootstrap').inquiries.find(r => r.id === process.env.MAIN);

  // 1. Return for correction, then the employee corrects and resubmits.
  await check('Intake, prepare, submit, return, correct, resubmit', async () => {
    main = vc('cryssa', 'intake', { form: { sender: agentEmail('Lara Pilot'), ownerId: dh.id, file: await formFile('main', company, 'Lara Pilot', sample) }, expected: 201 }).inquiry;
    start('cryssa', main); main = save('cryssa', main, { templateId: template.id }); main = act('cryssa', main, 'generate'); main = act('cryssa', main, 'submit'); leave('cryssa', main);
    assert.equal(main.status, 'Awaiting approval');
    main = act('zeo', main, 'decision', { version: 1, action: 'return', note: 'Please confirm the addressee position with the agent.', flags: ['Client details'] });
    assert.equal(main.status, 'Needs correction');
    start('cryssa', main); main = save('cryssa', main, { fields: { ...main.fields, addresseePosition: 'Human Resources Manager' } }); main = act('cryssa', main, 'generate'); main = act('cryssa', main, 'submit'); leave('cryssa', main);
    assert.equal(main.status, 'Awaiting approval'); assert.equal(main.submissions.length, 2);
    return main.id + ' · returned by Zeo, v2 submitted · template ' + template.sourceId;
  });

  // 2. Approval sends the proposal (staging: redirected to the test inbox).
  await check('Head approves v2 and the email is sent to the test inbox', () => {
    main = act('emerson', main, 'decision', { version: 2, action: 'approve', note: 'Approved in the pilot check.', flags: [] });
    assert.equal(main.status, 'Sent', 'status ' + main.status + ' ' + JSON.stringify(main.mailFailure || ''));
    return 'Sent · protection until ' + main.protection?.expiresAt?.slice(0, 10);
  });

  // 3. Request missing details (one email to the test inbox).
  await check('Request missing details sends an email', async () => {
    details = vc('jefferson', 'intake', { form: { sender: agentEmail('Noel Pilot'), file: await formFile('details', 'Pilot Check Details ' + stamp, 'Noel Pilot', sample, { employeeAges: '', contactName: 'Mr. Dan Reyes', addressee: 'Mr. Dan Reyes' }) }, expected: 201 }).inquiry;
    start('jefferson', details);
    details = act('jefferson', details, 'request-details', { body: 'Dear Mr. Pilot,\n\nPlease send the age range of the employees.\n\nThank you.' }); leave('jefferson', details);
    assert.equal(details.status, 'Waiting for agent details', 'status ' + details.status);
    return details.id + ' · ' + details.detailRequests.length + ' request(s)';
  });

  // 4. Decline with the decline email (one email to the test inbox).
  await check('Decline with email', async () => {
    declined = vc('cryssa', 'intake', { form: { sender: agentEmail('Ivy Pilot'), file: await formFile('decline', 'Pilot Check Tiny ' + stamp, 'Ivy Pilot', sample, { employees: 4, contactName: 'Ms. Joy Tan', addressee: 'Ms. Joy Tan' }) }, expected: 201 }).inquiry;
    start('cryssa', declined);
    declined = act('cryssa', declined, 'decline', { reason: 'Only 4 employees; below the minimum group size for these plans.', email: { send: true, body: 'Dear Ms. Pilot,\n\nThank you for the inquiry. We are unable to offer these plans for a group of 4.\n\nBest regards.' } });
    assert.equal(declined.status, 'Declined', 'status ' + declined.status);
    return declined.id + ' · declined, email ' + (declined.closure?.email?.status || JSON.stringify(declined.closure?.email || 'none').slice(0, 80));
  });

  // 5. A duplicate of the Sent client from another agent is held; the supervisor's decision is recorded.
  await check('Duplicate client is held, recheck keeps the hold', async () => {
    let dup = vc('judy', 'intake', { form: { sender: agentEmail('Other Pilot'), file: await formFile('dup', company, 'Other Pilot', sample) }, expected: 201 }).inquiry;
    dup = vc('cryssa', 'bootstrap').inquiries.find(r => r.id === dup.id) || dup;
    assert.equal(dup.clientReview?.state, 'duplicate', 'clientReview ' + JSON.stringify(dup.clientReview || null).slice(0, 200));
    const after = act('zeo', dup, 'review-client', { action: 'recheck', note: '' });
    assert.equal(after.clientReview?.state, 'duplicate');
    return dup.id + ' held while ' + main.id + ' is protected';
  });

  // 6. The owning Division Head files a progress report with an attachment; the Head approves it.
  await check('Division Head files a progress report with an attachment, Head approves', async () => {
    const note = path.join(tmp, 'call-notes.pdf'); await writeFile(note, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const waiting = vc('emerson', 'bootstrap').inquiries.find(r => r.id === main.id)?.progressReports?.find(p => p.status === 'pending');
    const filed = waiting ? { progressReports: [waiting] } : vc('division-head', 'my-clients/' + main.id + '/progress-report', { form: { summary: 'Met HR; they are reviewing the proposal with finance.', reference: 'Call, ' + today, requestId: randomUUID(), file: '@' + note + ';type=application/pdf' }, expected: 201 }).client;
    const report = filed.progressReports.find(p => p.status === 'pending' || (!p.decidedAt && !p.status)) || filed.progressReports[0];
    vc('emerson', 'inquiries/' + main.id + '/progress-report/' + report.id + '/decision', { json: { action: 'approve' } });
    const staffView = vc('emerson', 'bootstrap').inquiries.find(r => r.id === main.id)?.progressReports?.find(p => p.id === report.id);
    return 'report ' + report.id.slice(0, 8) + ' approved · owner view attachment: ' + JSON.stringify(report.attachment ? Object.keys(report.attachment) : null) + ' · staff view: ' + JSON.stringify(staffView ? Object.keys(staffView) : null);
  });

  // 7. Screens' data for each role (GETs only).
  await check('Users & roles, notifications, monitoring, directory, divisions, email templates, Requests load', () => {
    const users = vc('admin', 'bootstrap'); const n = vc('cryssa', 'workspace'); vc('emerson', 'monitoring/proposals?range=week'); vc('cryssa', 'monitoring/proposals?range=week', { expected: 403 });
    vc('cryssa', 'directory?q=pilot'); vc('emerson', 'divisions'); vc('emerson', 'email-templates'); const inbound = vc('cryssa', 'inbound');
    return (users.users?.length ?? '?') + ' users · ' + (n.notifications?.length ?? JSON.stringify(n).slice(0, 40)) + ' notices · inbound ' + (inbound.messages?.length ?? '?');
  });
  // 8. Report a problem (pilot item 5): who can file, read and update.
  await check('Problem reports: Division Head files, Employee and Supervisor refused, Head and Admin read', () => {
    const filed = vc('division-head', 'problem-reports', { json: { description: 'Online check from the Division Head account (test only).', page: 'My Clients' }, expected: 201 });
    vc('division-head', 'problem-reports', { expected: 403 }); vc('cryssa', 'problem-reports', { expected: 403 }); vc('zeo', 'problem-reports', { expected: 403 });
    vc('cryssa', 'problem-reports/' + filed.id + '/status', { json: { status: 'fixed' }, expected: 403 });
    const seen = vc('admin', 'problem-reports').reports.find(r => r.id === filed.id);
    assert.ok(seen && seen.role === 'DivisionHead' && seen.status === 'new', 'Admin does not see the new report');
    vc('admin', 'problem-reports/' + filed.id + '/status', { json: { status: 'fixed' } });
    return 'filed ' + filed.id.slice(0, 8) + ' · version ' + seen.version + ' · marked fixed by the Head';
  });
  await check('Check mail now runs', () => JSON.stringify(vc('cryssa', 'inbound/check', { json: {} })).slice(0, 200));
  await check('Sent proposal PDF and .eml download', async () => {
    const pdf = path.join(tmp, 'sent.pdf'); const head = vc('cryssa', 'file/' + main.id + '/pdf', { binary: pdf });
    const bytes = (await readFile(pdf)); assert.ok(bytes.subarray(0, 5).toString() === '%PDF-', 'not a PDF'); const eml = path.join(tmp, 'sent.eml'); vc('cryssa', 'file/' + main.id + '/eml', { binary: eml }); return 'pdf ' + bytes.length + ' bytes · eml ' + (await readFile(eml)).length + ' bytes';
  });
} finally {
  for (const user of Object.keys(cookies)) try { vc(user, 'logout', { json: {} }); } catch {}
  await writeFile('test-results/pilot-online/check-results.json', JSON.stringify(results, null, 2));
  console.log(results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
}
