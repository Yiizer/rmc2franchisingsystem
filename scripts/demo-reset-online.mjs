// Replaces the inquiries on the ONLINE TEST version with a fresh, fictional demo set that shows every state, including
// the Division Head / SOA flows. The real historical client directory, accounts, templates and settings are NOT touched.
//   node --env-file=.env.supabase.test scripts/demo-reset-online.mjs --project-ref pgoiqwixaeqbxlwbmren            dry run (lists)
//   node --env-file=.env.supabase.test scripts/demo-reset-online.mjs --project-ref pgoiqwixaeqbxlwbmren --apply    back up, remove, seed
// Before removing anything, every inquiry and notification is backed up to test-results/demo-online/backup-<time>.json (git-ignored).
// Seeding goes through the app's own API (vercel curl). Approvals and the details request send real email, redirected to
// the test inbox (5 sends). Passwords come from the git-ignored test-results/online-credentials/CREDENTIALS.txt.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import postgres from 'postgres';

const TEST_REF = 'pgoiqwixaeqbxlwbmren', deployment = 'https://rmc2-test-yiizer.vercel.app';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes('--apply'), url = (process.env.RMC2_DATABASE_URL || '').trim();
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only (--project-ref ' + TEST_REF + ').');
assert.ok(url.includes(TEST_REF), 'Refusing: RMC2_DATABASE_URL is not the test project.');
const out = 'test-results/demo-online', tmp = path.join(out, 'tmp'); await mkdir(tmp, { recursive: true });

// ---------- 1. Back up and remove the old test inquiries (database) ----------
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });
const existing = await sql`select id, data::text as data from rmc2.inquiries order by id`;
console.log('Inquiries online now: ' + existing.length + (existing.length ? ' (' + existing.map(r => r.id).join(', ') + ')' : ''));
if (!apply) { console.log('Dry run: nothing removed or created. Add --apply.'); await sql.end(); process.exit(0); }
const notices = await sql`select id, data::text as data from rmc2.notifications`;
const backup = path.join(out, 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await writeFile(backup, JSON.stringify({ at: new Date().toISOString(), inquiries: existing.map(r => JSON.parse(r.data)), notifications: notices.map(r => JSON.parse(r.data)) }, null, 1));
console.log('Backed up ' + existing.length + ' inquiries and ' + notices.length + ' notifications to ' + backup);
await sql.begin(async tx => {
  for (const table of ['notice_recipients', 'notifications', 'inquiry_activity', 'inquiry_handover', 'inquiry_index_pending', 'inquiry_keys', 'inquiry_summaries', 'file_access', 'outbox', 'inbound_messages', 'historical_reviews', 'inquiries']) {
    await tx.unsafe('delete from rmc2.' + table);
  }
});
console.log('Removed the old test inquiries (accounts, templates, settings, the client directory and email send counts are kept).');

// ---------- 2. Seed a fresh demo set through the app ----------
const logins = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(l => l.match(/^(\S+@rmc2\.local)\s+username:\s*(\S+).*password:\s*(\S+)/)).filter(Boolean)
  .map(m => [m[2] === 'undefined' ? m[1].split('@')[0] : m[2], { email: m[1], password: m[3] }]));
const cli = path.join(path.dirname(spawnSync('where', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const cookies = {}, tabs = {};
function vc(user, route, { json, form, expected = 200, binary = false } = {}) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', ...(binary ? ['--dump-header', '-'] : ['--include']), '--max-time', '180'];
  if (cookies[user]) args.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [k, v] of Object.entries(form)) args.push(k === 'file' ? '--form' : '--form-string', k + '=' + v);
  if (binary) args.push('--output', binary);
  const r = spawnSync(process.execPath, [cli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: binary ? 'latin1' : 'utf8', maxBuffer: 64 << 20 });
  const text = r.stdout || '', split = text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split), body = text.slice(split).trim();
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const sc = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (sc) cookies[user] = sc[1];
  let value = body; try { value = JSON.parse(body); } catch {}
  assert.equal(status, expected, route + ' (' + user + '): ' + (typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300)));
  return value;
}
const login = user => vc(user, 'login', { json: { email: logins[user].email, password: logins[user].password } });
const start = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'start' } });
const leave = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'leave' } });
const act = (user, record, name, extra = {}) => vc(user, 'inquiries/' + record.id + '/' + name, { json: { revision: record.revision, ...extra } }).inquiry;
const save = (user, record, changes = {}) => act(user, record, 'save', { fields: record.fields, templateId: record.templateId, notes: record.notes, email: record.email, emailOverrides: record.emailOverrides, ...changes });

const today = new Date().toISOString().slice(0, 10);
// Fictional clients and agents only. Branches are chosen to show the division auto-fill.
const C = (key, company, person, position, sector, industry, plan, employees, dependents, ages, dependentAges, payment, agent, branch, address, extra = {}) => ({ key, company, person, position, sector, industry, plan, employees, dependents, ages, dependentAges, payment, agent, branch, address, ...extra });
const clients = [
  C('northstar', 'Northstar Logistics Corporation', 'Engr. Paolo Navarro', 'Operations Manager', 'PRIVATE', 'Logistics and warehousing', 'Total CorpoShield', 120, 30, '21–59', '1–55', 'Annual', 'Marco Delos Santos', 'Cubao', '200 Aurora Boulevard, Cubao, Quezon City', { state: 'New inquiry · Division 5 filled from the branch (Cubao)' }),
  C('lakeside', 'Lakeside Manufacturing Inc.', 'Dr. Mateo Ramos', 'Company Physician', 'PRIVATE', 'Food manufacturing', 'Total CorpoHealthCheck', 80, 20, '22–60', '2–55', 'Annual', 'Tomas Mendoza', 'Lipa 2', '400 Ayala Highway, Lipa City, Batangas', { template: 'D054', by: 'judy', state: 'Preparing proposal · PDF ready, not submitted' }),
  C('sunrise', 'Sunrise Community Multi-Purpose Cooperative', 'Atty. Lucia Villanueva', 'General Manager', 'PRIVATE', 'Cooperative', 'Group healthcare', 32, 12, '', '3–50', 'Annual', 'Rosa Lim', 'Tacloban', '500 Real Street, Tacloban City', { by: 'cryssa', details: true, state: 'Waiting for agent details · branch not on the list stays Unconfirmed' }),
  C('bayani', 'Bayani Elementary School', 'Dr. Camila Reyes', 'School Principal', 'GOVT / DepEd', 'Public education (DepEd)', 'BureauHealth 4,250', 25, 0, '25–58', '', 'Annual', 'Nina Mercado', 'Baguio', '100 Session Road, Baguio City', { template: 'D023', by: 'cryssa', submit: true, state: 'Awaiting approval · approve it live' }),
  C('cedar', 'Cedar Digital Services Inc.', 'Ms. Isabelle Cruz', 'HR Manager', 'PRIVATE', 'Information technology', 'Total CorpoHealthCheck', 18, 0, '23–45', '', 'Semiannual', 'Lea Bautista', 'Antipolo', '300 Sumulong Highway, Antipolo City', { template: 'D054', by: 'jefferson', submit: true, ret: true, state: 'Needs correction · returned by Zeo' }),
  C('harbor', 'Harbor Point Hotel and Suites', 'Mr. Daniel Aquino', 'Human Resources Director', 'PRIVATE', 'Hospitality', 'Total CorpoShield', 95, 25, '20–58', '1–50', 'Annual', 'Carla Javier', 'Tanauan', '88 J.P. Laurel Highway, Tanauan, Batangas', { template: 'D094', by: 'judy', submit: true, approve: 'emerson', owner: 'division-head', report: 'approve', state: 'Sent · Division Head · progress report approved' }),
  C('coastal', 'Rizal Coastal Foods Corporation', 'Ms. Andrea Lopez', 'HR Officer', 'PRIVATE', 'Food processing', 'Total CorpoHealthCheck', 60, 15, '21–55', '1–50', 'Annual', 'Joanna Reyes', 'Taytay', '45 Manila East Road, Taytay, Rizal', { template: 'D054', by: 'cryssa', submit: true, approve: 'zeo', owner: 'division-head', state: 'Sent · Division Head · 30 days, file a report live' }),
  C('pacific', 'Pacific Crest Builders Inc.', 'Engr. Victor Lim', 'HR and Admin Manager', 'PRIVATE', 'Construction', 'Total CorpoShield', 140, 40, '21–60', '1–55', 'Annual', 'Irene Santos', 'Lipa 1', '9 C.M. Recto Avenue, Lipa City', { template: 'D095', by: 'jefferson', submit: true, approve: 'zeo', owner: 'soa', report: 'pending', state: 'Sent · SOA · report waiting in the Progress reports queue' }),
  C('meridian', 'Meridian Packaging Co.', 'Mr. Ramon Castillo', 'Plant Manager', 'PRIVATE', 'Packaging', 'Total CorpoShield', 50, 10, '22–58', '2–45', 'Annual', 'Paolo Garcia', 'La Union', '12 Quezon Avenue, San Fernando, La Union', { template: 'D094', by: 'judy', submit: true, approve: 'emerson', owner: 'soa', daysLeft: 5, state: 'Sent · SOA · 5 days left (warning + reminder)' }),
  C('silverline', 'Silverline Trading Co.', 'Ms. Grace Uy', 'Owner', 'PRIVATE', 'Wholesale trading', 'Group healthcare', 6, 0, '30–52', '', 'Monthly', 'Ben Ocampo', 'Cainta', '12 Ortigas Extension, Cainta, Rizal', { by: 'jefferson', decline: true, state: 'Declined · in Archives with the reason' }),
];
clients.push({ ...clients[0], key: 'northstar-duplicate', agent: 'Victor Tan', branch: 'Mandaluyong', state: 'Duplicate on hold · same client, another agent' });
const cells = { agentName: 'C7', requestDate: 'J7', branch: 'D8', agentPhone: 'J8', company: 'B10', industry: 'J11', address: 'C12', contactName: 'D14', contactEmail: 'B17', contactPhone: 'J16', contactPosition: 'C18', existingProvider: 'J18', addressee: 'B21', addresseePosition: 'G21', requestedPlan: 'D22', payment: 'G23', employees: 'D25', dependents: 'J24', employeeAges: 'C26', dependentAges: 'J26', hospitals: 'C29', dental: 'I29' };
const agentEmail = client => client.agent.toLowerCase().replace(/[^a-z]+/g, '.') + '@agents.example.test';
async function workbook(client, index, template) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(template); const sheet = book.worksheets[0];
  book.creator = 'RMC2 demo data (fictional)';
  const values = { agentName: client.agent, requestDate: today, branch: client.branch, agentPhone: '0917555' + String(1000 + index).slice(-4), company: client.company, industry: client.industry, address: client.address, contactName: client.person, contactEmail: 'hr.' + client.key.split('-')[0] + '@clients.example.test', contactPhone: '0998555' + String(2000 + index).slice(-4), contactPosition: client.position, existingProvider: 'None', addressee: client.person, addresseePosition: client.position, requestedPlan: client.plan, payment: client.payment, employees: client.employees, dependents: client.dependents, employeeAges: client.ages, dependentAges: client.dependentAges, hospitals: 'For confirmation', dental: 'For confirmation' };
  for (const [field, cell] of Object.entries(cells)) sheet.getCell(cell).value = values[field] ?? '';
  sheet.getCell('J10').value = client.sector;
  return Buffer.from(await book.xlsx.writeBuffer());
}
const formFile = async (client, index, sample) => { const file = path.join(tmp, 'Franchise-Form-' + client.key + '.xlsx'); await writeFile(file, await workbook(client, index, sample)); return '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; };

const report = [];
try {
  for (const user of ['cryssa', 'jefferson', 'judy', 'emerson', 'zeo', 'division-head', 'soa']) login(user);
  const { templates } = vc('emerson', 'bootstrap');
  const templateId = sourceId => { const t = templates.find(t => t.sourceId === sourceId && t.active); assert.ok(t, 'Template ' + sourceId + ' is not active'); return t.id; };
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('cryssa', 'sample-form', { binary: sampleFile }); const sample = await readFile(sampleFile);
  for (const [index, client] of clients.entries()) {
    let record = vc('cryssa', 'intake', { form: { sender: agentEmail(client), ...(client.owner ? { ownerId: client.owner } : {}), file: await formFile(client, index, sample) }, expected: 201 }).inquiry;
    const by = client.by;
    if (client.template) {
      start(by, record); record = save(by, record, { templateId: templateId(client.template) }); record = act(by, record, 'generate');
      if (client.submit) record = act(by, record, 'submit');
      leave(by, record);
    }
    if (client.details) { start(by, record); record = act(by, record, 'request-details', { body: 'Dear Ms. Lim,\n\nThank you for the inquiry for ' + client.company + '. Before we can prepare the proposal, please send the age range of the ' + client.employees + ' employees.\n\nThank you.' }); leave(by, record); }
    if (client.ret) record = act('zeo', record, 'decision', { version: 1, action: 'return', note: 'Please confirm the addressee position with the agent and check the payment mode before resubmitting.', flags: ['Client details'] });
    if (client.approve) record = act(client.approve, record, 'decision', { version: 1, action: 'approve', note: 'Approved for the demo.', flags: [] });
    if (client.decline) { start(by, record); record = act(by, record, 'decline', { reason: 'Only 6 employees; below the minimum group size for these plans. The agent was informed.' }); }
    if (client.report && record.status === 'Sent') {
      const filed = vc(client.owner, 'my-clients/' + record.id + '/progress-report', { form: { summary: 'Met the HR team; they are reviewing the proposal with finance and asked for a follow-up next week.', reference: 'Call with ' + client.person + ', ' + today, requestId: randomUUID() }, expected: 201 }).client;
      if (client.report === 'approve') vc('zeo', 'inquiries/' + record.id + '/progress-report/' + filed.progressReports.at(-1).id + '/decision', { json: { action: 'approve' } });
    }
    if (client.daysLeft && record.status === 'Sent') {
      const s = new Date(Date.now() - (30 - client.daysLeft) * 86400000).toISOString(), e = new Date(Date.now() + client.daysLeft * 86400000).toISOString();
      await sql`update rmc2.inquiries set revision = revision + 1, data = jsonb_set(jsonb_set(jsonb_set(data, '{protection,startedAt}', to_jsonb(${s}::text)), '{protection,activityAt}', to_jsonb(${s}::text)), '{protection,expiresAt}', to_jsonb(${e}::text)) where id = ${record.id}`;
      await sql`insert into rmc2.inquiry_index_pending (id) values (${record.id}) on conflict do nothing`;
    }
    report.push({ id: record.id, company: client.company, state: client.state, status: record.status, division: record.fields.division, owner: client.owner || '' });
    console.log(record.id + ' · ' + record.status.padEnd(26) + ' · ' + (record.fields.division || '').padEnd(12) + ' · ' + client.company);
  }
  // A Division Head submits a client in the app, and the SOA tries one that is already protected.
  const own = vc('division-head', 'intake', { form: { file: await formFile(C('golden', 'Golden Harvest Agri Cooperative', 'Mr. Leo Santos', 'Chairman', 'PRIVATE', 'Agriculture', 'Total CorpoHealthCheck', 40, 10, '25–60', '3–50', 'Annual', 'Division Head', 'Antipolo', '7 Marcos Highway, Antipolo City'), 20, sample) }, expected: 201 });
  report.push({ id: own.client.id, company: own.client.client, state: 'New inquiry · submitted in the app by the Division Head', status: own.client.status });
  console.log(own.client.id + ' · submitted by the Division Head · ' + own.client.status);
  const dup = vc('soa', 'intake', { form: { file: await formFile({ ...clients.find(c => c.key === 'coastal'), key: 'coastal-soa', agent: 'SOA' }, 21, sample) }, expected: 201 });
  report.push({ id: dup.client.id, company: 'Rizal Coastal Foods Corporation', state: 'SOA submitted an already-protected client · "This client is already protected."', status: dup.client.status, alreadyProtected: dup.alreadyProtected });
  console.log(dup.client.id + ' · SOA duplicate · alreadyProtected=' + dup.alreadyProtected);
  await writeFile(path.join(out, 'demo-records.json'), JSON.stringify(report, null, 2));
  console.log('Done: ' + report.length + ' demo inquiries. List in ' + out + '/demo-records.json');
} finally {
  for (const user of Object.keys(cookies)) try { vc(user, 'logout', { json: {} }); } catch {}
  await sql.end();
}
