// Adds a set of fictional demo inquiries to the ONLINE TEST version, each left in a different workflow state, so
// every screen has something to show in a presentation. Existing records are kept; a client already present is skipped.
// Runs through `vercel curl` (your Vercel login handles Deployment Protection). Passwords come from the git-ignored
// test-results/online-credentials/CREDENTIALS.txt. Approvals and details requests send real email, redirected to the test inbox.
//   node scripts/demo-seed-online.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';

const deployment = process.env.RMC2_DEMO_URL || 'https://rmc2-test-yiizer.vercel.app';
if (!/^https:\/\/rmc2-(test|preview)-[a-z0-9-]*yiizer\.vercel\.app$/.test(deployment)) throw new Error('Demo data goes to the online TEST version only.');
const out = 'test-results/demo-online', tmp = path.join(out, 'tmp');
await mkdir(tmp, { recursive: true });

const passwords = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^(\S+@rmc2\.local)\s.*password:\s*(\S+)/)).filter(Boolean).map(m => [m[1].split('@')[0], m[2]]));
const cookies = {}, tabs = {};
// The vercel CLI's own entry point, run with this Node (no shell, so header and form values are passed exactly).
const vercelCli = process.env.VERCEL_CLI_JS || path.join(path.dirname(spawnSync(process.platform === 'win32' ? 'where' : 'which', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');

function vc(user, route, { json, form, expected = 200, binary = false } = {}) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', ...(binary ? ['--dump-header', '-'] : ['--include']), '--max-time', '120'];
  if (cookies[user]) args.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [key, value] of Object.entries(form)) args.push('--form', key + '=' + value);
  if (binary) args.push('--output', binary);
  const result = spawnSync(process.execPath, [vercelCli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: binary ? 'latin1' : 'utf8', maxBuffer: 64 << 20 });
  const text = result.stdout || '';
  const split = text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split), body = text.slice(split).trim();
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const setCookie = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im);
  if (setCookie) cookies[user] = setCookie[1];
  let value = body; try { value = JSON.parse(body); } catch {}
  assert.equal(status, expected, route + ' (' + user + '): ' + (typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300)) + (result.stderr ? ' | ' + result.stderr.slice(-300) : ''));
  return value;
}
const login = user => { assert.ok(passwords[user], 'No password for ' + user); vc(user, 'login', { json: { email: user + '@rmc2.local', password: passwords[user] } }); };
const start = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'start' } });
const leave = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'leave' } });
const act = (user, record, name, extra = {}) => vc(user, 'inquiries/' + record.id + '/' + name, { json: { revision: record.revision, ...extra } }).inquiry;
const save = (user, record, changes = {}) => act(user, record, 'save', { fields: record.fields, templateId: record.templateId, notes: record.notes, email: record.email, emailOverrides: record.emailOverrides, ...changes });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fictional clients and agents only. Addresses use example.test; every email is redirected to the test inbox anyway.
const today = new Date().toISOString().slice(0, 10);
const clients = [
  { key: 'northstar', state: 'New inquiry: walk through the whole process live', company: 'Northstar Logistics Corporation', person: 'Engr. Paolo Navarro', position: 'Operations Manager', sector: 'PRIVATE', industry: 'Logistics and warehousing', plan: 'Total CorpoShield', employees: 120, dependents: 30, ages: '21–59', dependentAges: '1–55', payment: 'Annual', agent: 'Marco Delos Santos', branch: 'Pasig', address: '200 Ortigas Avenue, Pasig City' },
  { key: 'lakeside', state: 'Preparing proposal: draft with a PDF ready, not yet submitted', company: 'Lakeside Manufacturing Inc.', person: 'Dr. Mateo Ramos', position: 'Company Physician', sector: 'PRIVATE', industry: 'Food manufacturing', plan: 'Total CorpoHealthCheck', employees: 80, dependents: 20, ages: '22–60', dependentAges: '2–55', payment: 'Annual', agent: 'Tomas Mendoza', branch: 'Cainta', address: '400 Felix Avenue, Cainta, Rizal', template: 'D054', by: 'judy' },
  { key: 'sunrise', state: 'Waiting for agent details: the form has no employee ages', company: 'Sunrise Community Multi-Purpose Cooperative', person: 'Atty. Lucia Villanueva', position: 'General Manager', sector: 'PRIVATE', industry: 'Cooperative', plan: 'Group healthcare', employees: 32, dependents: 12, ages: '', dependentAges: '3–50', payment: 'Annual', agent: 'Rosa Lim', branch: 'Quezon City', address: '500 Kalayaan Avenue, Quezon City', by: 'cryssa' },
  { key: 'bayani', state: 'Awaiting approval: a supervisor can approve it live', company: 'Bayani Elementary School', person: 'Dr. Camila Reyes', position: 'School Principal', sector: 'GOVT / DepEd', industry: 'Public education (DepEd)', plan: 'BureauHealth 4,250', employees: 25, dependents: 0, ages: '25–58', dependentAges: '', payment: 'Annual', agent: 'Nina Mercado', branch: 'Antipolo', address: '100 Sumulong Highway, Antipolo City, Rizal', template: 'D023', by: 'cryssa' },
  { key: 'cedar', state: 'Needs correction: returned by a supervisor with a note', company: 'Cedar Digital Services Inc.', person: 'Ms. Isabelle Cruz', position: 'HR Manager', sector: 'PRIVATE', industry: 'Information technology', plan: 'Total CorpoHealthCheck', employees: 18, dependents: 0, ages: '23–45', dependentAges: '', payment: 'Semiannual', agent: 'Lea Bautista', branch: 'Makati', address: '300 Ayala Avenue, Makati City', template: 'D054', by: 'jefferson' },
  { key: 'harbor', state: 'Sent: approved, emailed, 30-day protection running, one progress report', company: 'Harbor Point Hotel and Suites', person: 'Mr. Daniel Aquino', position: 'Human Resources Director', sector: 'PRIVATE', industry: 'Hospitality', plan: 'Total CorpoShield', employees: 95, dependents: 25, ages: '20–58', dependentAges: '1–50', payment: 'Annual', agent: 'Carla Javier', branch: 'Pasay', address: '88 Roxas Boulevard, Pasay City', template: 'D094', by: 'judy' },
  { key: 'silverline', state: 'Declined: in Archives with the reason', company: 'Silverline Trading Co.', person: 'Ms. Grace Uy', position: 'Owner', sector: 'PRIVATE', industry: 'Wholesale trading', plan: 'Group healthcare', employees: 6, dependents: 0, ages: '30–52', dependentAges: '', payment: 'Monthly', agent: 'Ben Ocampo', branch: 'Manila', address: '12 Ongpin Street, Binondo, Manila', by: 'jefferson' },
];
// Same client as Northstar, sent by a different agent: processing is held for review.
clients.push({ ...clients[0], key: 'northstar-duplicate', state: 'Duplicate client on hold: same company, different agent', agent: 'Victor Tan', branch: 'Mandaluyong' });
const cells = { agentName: 'C7', requestDate: 'J7', branch: 'D8', agentPhone: 'J8', company: 'B10', industry: 'J11', address: 'C12', contactName: 'D14', contactEmail: 'B17', contactPhone: 'J16', contactPosition: 'C18', existingProvider: 'J18', addressee: 'B21', addresseePosition: 'G21', requestedPlan: 'D22', payment: 'G23', employees: 'D25', dependents: 'J24', employeeAges: 'C26', dependentAges: 'J26', hospitals: 'C29', dental: 'I29' };
const agentEmail = client => client.agent.toLowerCase().replace(/[^a-z]+/g, '.') + '@agents.example.test';

async function workbook(client, index, template) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(template); const sheet = book.worksheets[0];
  book.creator = 'RMC2 demo data (fictional)'; book.description = 'Fictional form for the demo. No real client or agent.';
  const values = { agentName: client.agent, requestDate: today, branch: client.branch, agentPhone: '0917555' + String(1000 + index).slice(-4), company: client.company, industry: client.industry, address: client.address, contactName: client.person, contactEmail: 'hr.' + client.key.split('-')[0] + '@clients.example.test', contactPhone: '0998555' + String(2000 + index).slice(-4), contactPosition: client.position, existingProvider: 'None', addressee: client.person, addresseePosition: client.position, requestedPlan: client.plan, payment: client.payment, employees: client.employees, dependents: client.dependents, employeeAges: client.ages, dependentAges: client.dependentAges, hospitals: 'For confirmation', dental: 'For confirmation' };
  for (const [field, cell] of Object.entries(cells)) sheet.getCell(cell).value = values[field] ?? '';
  sheet.getCell('J10').value = client.sector;
  return Buffer.from(await book.xlsx.writeBuffer());
}

const report = [];
const users = ['admin', 'cryssa', 'jefferson', 'judy', 'emerson', 'zeo'];
try {
  for (const user of users) login(user);
  const initial = vc('admin', 'bootstrap');
  console.log('Online now: ' + initial.inquiries.length + ' inquiries, ' + initial.templates.length + ' templates.');
  const templateId = sourceId => { const t = initial.templates.find(t => t.sourceId === sourceId && t.active); assert.ok(t, 'Template ' + sourceId + ' is not active online'); return t.id; };
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('cryssa', 'sample-form', { binary: sampleFile });
  const sample = await readFile(sampleFile);

  for (const [index, client] of clients.entries()) {
    const email = agentEmail(client);
    const existing = initial.inquiries.find(r => r.fields.company === client.company && r.fields.agentEmail === email);
    if (existing) { report.push({ id: existing.id, company: client.company, state: client.state, status: existing.status, skipped: 'already present' }); console.log('skip ' + existing.id + ' ' + client.company); continue; }
    const bytes = await workbook(client, index, sample), filename = 'Franchise-Form-' + client.key + '.xlsx', file = path.join(tmp, filename);
    await writeFile(file, bytes);
    let record = vc('cryssa', 'intake', { form: { sender: email, file: '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, expected: 201 }).inquiry;
    const by = client.by;
    if (client.template) {
      start(by, record);
      record = save(by, record, { templateId: templateId(client.template) });
      record = act(by, record, 'generate');
      if (client.key !== 'lakeside') record = act(by, record, 'submit');
      leave(by, record);
    }
    if (client.key === 'cedar') record = act('zeo', record, 'decision', { version: 1, action: 'return', note: 'Please confirm the addressee position with the agent and check the payment mode before resubmitting.', flags: ['Client details'] });
    if (client.key === 'harbor') {
      record = act('emerson', record, 'decision', { version: 1, action: 'approve', note: 'Approved. Standard CorpoShield terms.', flags: [] });
      if (record.status === 'Sent') {
        await sleep(65000); // the report must be sent after the reply that started the protection
        const sentAt = new Date(Date.now() - 15000).toISOString();
        record = vc('judy', 'inquiries/' + record.id + '/progress-report', { form: { revision: String(record.revision), requestId: randomUUID(), sender: email, sentAt, summary: 'Agent met the HR Director; the client is comparing rates and asked for a follow-up meeting next week.', reference: 'Email from Carla Javier, ' + today } }).inquiry;
      }
    }
    if (client.key === 'sunrise') { start(by, record); record = act(by, record, 'request-details', { body: 'Dear Ms. Lim,\n\nThank you for the inquiry for Sunrise Community Multi-Purpose Cooperative. Before we can prepare the proposal, please send the age range of the 32 employees.\n\nThank you.' }); leave(by, record); }
    if (client.key === 'silverline') record = act(by, record, 'decline', { reason: 'Only 6 employees; below the minimum group size for these plans. The agent was informed.' });
    report.push({ id: record.id, company: client.company, agent: client.agent, state: client.state, status: record.status, client: record.clientReview?.state });
    console.log(record.id + ' · ' + client.company + ' · ' + record.status + ' · ' + (record.clientReview?.state || ''));
    await writeFile(path.join(out, 'demo-records.json'), JSON.stringify(report, null, 2));
  }
  await writeFile(path.join(out, 'demo-records.json'), JSON.stringify(report, null, 2));
  console.log('Done: ' + report.length + ' demo inquiries. List in ' + out + '/demo-records.json');
} finally {
  for (const user of users) if (cookies[user]) try { vc(user, 'logout', { json: {} }); } catch {}
}
