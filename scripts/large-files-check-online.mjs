// Phase 5 / pilot plan item 2 on the ONLINE TEST version: a 6 MB form (over Vercel's 4.5 MB body limit) goes in through
// a signed upload link and comes back out through a signed download link. Fictional data only (*.example.test); creates
// one test inquiry. Signed links and passwords are never printed.
//   node scripts/large-files-check-online.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';

const deployment = 'https://rmc2-test-yiizer.vercel.app', tmp = 'test-results/large-files-online/tmp';
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
import { randomBytes } from 'node:crypto';

const MB = 1024 * 1024;
try {
  login('cryssa');
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('cryssa', 'sample-form', { binary: sampleFile }); const sample = await readFile(sampleFile);
  const company = 'Large File Check ' + stamp;
  // The sample form plus 6 MB of incompressible padding as an embedded picture, so the .xlsx itself is over 6 MB.
  const formPath = (await formFile('large', company, 'Lara Large', sample)).slice(1).replace(/;type=.*$/, '');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile(formPath));
  book.worksheets[0].addImage(book.addImage({ buffer: randomBytes(6 * MB), extension: 'png' }), 'N40:O41');
  const bytes = Buffer.from(await book.xlsx.writeBuffer()); await writeFile(formPath, bytes);
  const name = 'Large file check ' + stamp + '.xlsx';
  let inquiryId;

  await check('A 6 MB form is refused through the normal request (the 4.5 MB limit this fixes)', () => {
    const r = spawnSync(process.execPath, [cli, 'curl', '/api/operations/intake', '--deployment', deployment, '--', '--silent', '--output', path.join(tmp, 'refused.txt'), '--write-out', '%{http_code}', '--max-time', '120', '--header', 'Cookie: ' + cookies.cryssa, '--form', 'file=@' + formPath + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    const code = Number((r.stdout || '').trim().slice(-3)); assert.equal(code, 413, 'expected 413, got ' + code); return (bytes.length / MB).toFixed(1) + ' MB → HTTP 413';
  });
  await check('The same form goes in through a signed upload link and becomes an inquiry', async () => {
    const start = vc('cryssa', 'uploads/start', { json: { name, size: bytes.length, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    assert.equal(start.mode, 'signed'); assert.match(start.url, /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);
    const put = await fetch(start.url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-upsert': 'false' } });
    assert.ok(put.ok, 'storage PUT HTTP ' + put.status);
    const created = vc('cryssa', 'intake', { form: { sender: agentEmail('Lara Large'), file__upload: start.id, file__name: name }, expected: 201 }).inquiry;
    inquiryId = created.id; assert.equal(created.source.filename, name); assert.equal(created.fields.company, company);
    const again = vc('cryssa', 'intake', { form: { sender: agentEmail('Lara Large'), file__upload: start.id, file__name: name }, expected: 400 });
    assert.match(again.error, /did not finish/);
    return inquiryId + ' · ' + name + ' · the upload id cannot be used twice';
  });
  await check('The 6 MB form downloads through a 60-second signed link, byte for byte', async () => {
    assert.ok(inquiryId, 'no inquiry from the previous check');
    const head = path.join(tmp, 'download-headers.txt');
    const r = spawnSync(process.execPath, [cli, 'curl', '/api/operations/file/' + inquiryId + '/source', '--deployment', deployment, '--', '--silent', '--dump-header', head, '--output', path.join(tmp, 'redirect-body.txt'), '--max-time', '120', '--header', 'Cookie: ' + cookies.cryssa], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    assert.equal(r.status, 0); const headers = await readFile(head, 'utf8'); await writeFile(head, ''); // the link is not kept on disk
    assert.match(headers, /^HTTP\/[\d.]+ 302/m); assert.match(headers, /^cache-control:\s*no-store/im); assert.match(headers, /^referrer-policy:\s*no-referrer/im);
    const location = /^location:\s*(\S+)/im.exec(headers)?.[1]; assert.match(location || '', /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/sign\/.*[?&]download=/);
    const got = Buffer.from(await (await fetch(location)).arrayBuffer());
    assert.ok(got.equals(bytes), 'downloaded ' + got.length + ' bytes, expected ' + bytes.length);
    return 'HTTP 302 → signed link → ' + (got.length / MB).toFixed(1) + ' MB, identical';
  });
  await check('A small file still downloads directly through the app', () => {
    const file = path.join(tmp, 'small.xlsx'); vc('cryssa', 'sample-form', { binary: file }); return 'sample form HTTP 200';
  });
} finally {
  await writeFile(path.join(tmp, 'results.json'), JSON.stringify(results, null, 2));
  console.log(results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
}
