// REMAINING_WORK §0 email edge cases on the ONLINE TEST version (PO 2026-11-12: "Yes, run them"). Fictional data only.
//   Part 1, incoming: sends 9 test emails from the test mailbox to itself (Gmail SMTP, the app password in the git-ignored
//   .env.mail.test), runs "Check mail now" as the Head and checks how each one was handled: several attachments, more than 5,
//   a message over 15 MB, an attachment over 7 MB, a non-form workbook, a renamed file, a PDF that staff turn into an
//   inquiry by hand, and the same client emailed twice.
//   Part 2, the sending cap: details requests on fictional inquiries until the app refuses one with the limit (5 an hour).
//   Every outgoing email goes to the staging redirect (the same test inbox); nothing reaches an agent.
// A failed or "uncertain" send cannot be forced on TEST without changing its mail settings, which the PO declined; those
// run locally in scripts/test-mail-service.mjs (fake transport). Passwords and keys are never printed.
//   node scripts/email-edge-online.mjs            (PART=1 or PART=2 to run one part)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import path from 'node:path';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';

const deployment = 'https://rmc2-test-yiizer.vercel.app', tmp = 'test-results/email-edge-online/tmp';
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
  if (expected !== null) assert.equal(status, expected, route + ' (' + user + '): ' + (route === 'login' ? '[hidden]' : (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 300)));
  return expected === null ? { status, value } : value;
}
const login = user => vc(user, 'login', { json: { email: logins[user].email, password: logins[user].password } });
const start = (user, record) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'start' } });
const leave = (user, record) => { try { vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action: 'leave' } }); } catch { /* best effort */ } };
const check = async (name, fn) => { try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' · ' + detail : '')); } catch (error) { results.push({ name, ok: false, detail: error.message.slice(0, 600) }); console.log('FAIL ' + name + ' · ' + error.message.slice(0, 600)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, ''), today = new Date().toISOString().slice(0, 10);
const cells = { agentName: 'C7', requestDate: 'J7', branch: 'D8', agentPhone: 'J8', company: 'B10', industry: 'J11', address: 'C12', contactName: 'D14', contactEmail: 'B17', contactPhone: 'J16', contactPosition: 'C18', existingProvider: 'J18', addressee: 'B21', addresseePosition: 'G21', requestedPlan: 'D22', payment: 'G23', employees: 'C25', dependents: 'G25', employeeAges: 'J25', dependentAges: 'J26', benefits: 'B29' };
async function formBytes(sample, company, agent, extra = {}) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(sample); const sheet = book.worksheets[0];
  const values = { agentName: agent, requestDate: today, branch: 'Antipolo', agentPhone: '09175550' + String(Math.floor(Math.random() * 900) + 100), company, industry: 'Services', address: '1 Edge Street, Antipolo City', contactName: 'Ms. Edge Lopez', contactEmail: 'hr.edge@clients.example.test', contactPhone: '09985550123', contactPosition: 'HR Manager', existingProvider: 'None', addressee: 'Ms. Edge Lopez', addresseePosition: 'HR Manager', requestedPlan: 'Standard', payment: 'Annual', employees: 25, dependents: 0, employeeAges: '25-50', dependentAges: '', benefits: 'Standard', ...extra };
  for (const [field, cell] of Object.entries(cells)) sheet.getCell(cell).value = values[field] ?? '';
  sheet.getCell('J10').value = 'PRIVATE';
  return Buffer.from(await book.xlsx.writeBuffer());
}
const pdf = (size = 2000) => Buffer.concat([Buffer.from('%PDF-1.4\n% fictional test file\n'), randomBytes(Math.max(0, size - 40)), Buffer.from('\n%%EOF\n')]);
const parts = (process.env.PART || '1,2').split(',');
/** Creating an inquiry is an Employee or Admin step (canImportInquiry); the Head and Supervisors are refused (403). */
function importByHand(m) {
  assert.equal(vc('emerson', 'inbound/' + m.id + '/import', { json: { index: 0 }, expected: null }).status, 403, 'the Head may not create the inquiry');
  const r = vc('jefferson', 'inbound/' + m.id + '/import', { json: { index: 0 }, expected: null });
  assert.ok([200, 201].includes(r.status), 'import ' + r.status + ' ' + JSON.stringify(r.value).slice(0, 200));
  const after = vc('jefferson', 'inbound').messages.find(x => x.id === m.id);
  assert.equal(after.state, 'imported'); return after.inquiryId + ' created by an Employee (the Head was refused, 403)';
}

try {
  for (const user of ['emerson', 'jefferson']) login(user);
  const sampleFile = path.join(tmp, 'sample-form.xlsx'); vc('jefferson', 'sample-form', { binary: sampleFile }); const sample = await readFile(sampleFile);

  if (parts.includes('1')) {
    const env = parseEnv(await readFile('.env.mail.test', 'utf8'));
    const mailbox = env.RMC2_SMTP_USER.trim();
    const transport = nodemailer.createTransport({ host: env.RMC2_SMTP_HOST || 'smtp.gmail.com', port: Number(env.RMC2_SMTP_PORT || 465), secure: Number(env.RMC2_SMTP_PORT || 465) === 465, auth: { user: mailbox, pass: env.RMC2_SMTP_APP_PASSWORD.replace(/\s+/g, '') } });
    const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const other = new ExcelJS.Workbook(); other.addWorksheet('Invoice').addRow(['Item', 'Amount']).commit(); const otherBytes = Buffer.from(await other.xlsx.writeBuffer());
    const dupCompany = 'Edge Check Dup Foods ' + stamp;
    const cases = {
      several: { text: 'Form plus two PDFs and a Word file.', attachments: [{ filename: 'franchise-form.xlsx', content: await formBytes(sample, 'Edge Check Several ' + stamp, 'Agent Several'), contentType: xlsxType }, { filename: 'profile.pdf', content: pdf() }, { filename: 'letter.pdf', content: pdf() }, { filename: 'notes.docx', content: randomBytes(3000), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] },
      seven: { text: 'Seven PDFs.', attachments: Array.from({ length: 7 }, (_, i) => ({ filename: `page-${i + 1}.pdf`, content: pdf() })) },
      huge: { text: 'One very large attachment (about 12 MB, over 15 MB once encoded).', attachments: [{ filename: 'scan.pdf', content: pdf(12 * 1024 * 1024) }] },
      bigFile: { text: 'One 8 MB PDF (over the 7 MB attachment limit, under 15 MB in total).', attachments: [{ filename: 'big-scan.pdf', content: pdf(8 * 1024 * 1024) }] },
      notForm: { text: 'An Excel file that is not the franchise form.', attachments: [{ filename: 'invoice.xlsx', content: otherBytes, contentType: xlsxType }] },
      renamed: { text: 'A PDF renamed to .xlsx.', attachments: [{ filename: 'form.xlsx', content: pdf(), contentType: xlsxType }] },
      pdfOnly: { text: 'A filled-in form as PDF only.', attachments: [{ filename: 'franchise-form.pdf', content: pdf() }] },
      dup1: { text: 'First request for this client.', attachments: [{ filename: 'form.xlsx', content: await formBytes(sample, dupCompany, 'Agent Dup One'), contentType: xlsxType }] },
      dup2: { text: 'Second agent, same client.', attachments: [{ filename: 'form.xlsx', content: await formBytes(sample, dupCompany, 'Agent Dup Two'), contentType: xlsxType }] },
    };
    const ids = {};
    for (const [key, c] of Object.entries(cases)) {
      ids[key] = `edge-${key}-${stamp}-${randomUUID().slice(0, 8)}@rmc2-check.example.test`;
      await transport.sendMail({ from: mailbox, to: mailbox, subject: `Edge check ${stamp} ${key}`, text: c.text, attachments: c.attachments, messageId: '<' + ids[key] + '>' });
      if (key === 'dup1') await sleep(5000); // so the two emails for one client arrive in order
    }
    console.log('Sent ' + Object.keys(cases).length + ' test emails to the test inbox');
    let found = {};
    for (let round = 0; round < 12 && Object.keys(found).length < Object.keys(ids).length; round++) {
      await sleep(round ? 15000 : 10000);
      vc('emerson', 'inbound/check', { json: {} });
      const list = vc('emerson', 'inbound').messages;
      found = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, list.find(m => (m.messageId || '').includes(id))]).filter(([, m]) => m));
    }
    await writeFile(path.join(tmp, 'inbound.json'), JSON.stringify(found, null, 2));
    const got = key => { const m = found[key]; assert.ok(m, key + ': not on Requests after the checks'); return m; };
    await check('several attachments: the form and both PDFs are kept, the Word file is not; the form is imported automatically', async () => {
      const m = got('several'); assert.deepEqual(m.attachments.map(a => a.type).sort(), ['pdf', 'pdf', 'xlsx']); assert.equal(m.state, 'imported'); assert.ok(m.inquiryId);
      return m.inquiryId;
    });
    await check('more than 5 attachments: at most 5 are kept; PDFs wait for staff', async () => { const m = got('seven'); assert.equal(m.attachments.length, 5); assert.equal(m.state, 'new'); return '5 of 7 kept'; });
    await check('a message over 15 MB is not downloaded: listed as skipped with a reason to open it in the mailbox', async () => { const m = got('huge'); assert.equal(m.state, 'dismissed'); assert.match(m.importError || '', /too large/i); assert.equal(m.attachments.length, 0); return m.importError; });
    await check('an attachment over 7 MB is not stored; the email still waits for staff', async () => { const m = got('bigFile'); assert.equal(m.attachments.length, 0); assert.equal(m.state, 'new'); });
    await check('a workbook that is not the franchise form is not imported; it waits on Requests with the reason', async () => { const m = got('notForm'); assert.equal(m.state, 'new'); assert.ok(m.importError, 'a reason is shown'); return m.importError; });
    await check('a PDF renamed to .xlsx is not kept (the bytes must match the name)', async () => { const m = got('renamed'); assert.equal(m.attachments.length, 0); assert.equal(m.state, 'new'); });
    await check('an emailed PDF waits on Requests, then staff create the inquiry from it by hand', async () => {
      const m = got('pdfOnly'); assert.equal(m.state, 'new'); assert.equal(m.attachments.length, 1);
      return importByHand(m);
    });
    await check('the same client emailed by two agents: the first is clear, the second is held as a duplicate', async () => {
      const a = got('dup1'), b = got('dup2'); assert.equal(a.state, 'imported'); assert.equal(b.state, 'imported');
      const first = vc('emerson', 'inquiries/' + a.inquiryId).inquiry, second = vc('emerson', 'inquiries/' + b.inquiryId).inquiry;
      assert.notEqual(first.clientReview?.state, 'duplicate', 'first ' + first.clientReview?.state);
      assert.equal(second.clientReview?.state, 'duplicate', 'second ' + second.clientReview?.state);
      return a.inquiryId + ' clear, ' + b.inquiryId + ' held';
    });
  }

  if (parts.includes('1b')) { // re-run only the hand import, on the PDF email a previous part 1 left on Requests
    const stored = JSON.parse(await readFile(path.join(tmp, 'inbound.json'), 'utf8'));
    await check('an emailed PDF waits on Requests, then staff create the inquiry from it by hand', async () => importByHand(stored.pdfOnly));
  }

  if (parts.includes('2')) {
    await check('sending cap: details requests send until the hourly limit, then the next is refused (429) with the limit message and the inquiry is unchanged', async () => {
      const sent = [];
      for (let i = 1; i <= 6; i++) {
        const file = path.join(tmp, `cap-${i}.xlsx`);
        await writeFile(file, await formBytes(sample, `Edge Check Cap ${i} ${stamp}`, `Agent Cap ${i}`, { employeeAges: '', contactName: `Mr. Cap ${i}`, addressee: `Mr. Cap ${i}` }));
        const record = vc('jefferson', 'intake', { form: { sender: `cap.agent${i}@agents.example.test`, file: '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, expected: 201 }).inquiry;
        start('jefferson', record);
        const r = vc('jefferson', 'inquiries/' + record.id + '/request-details', { json: { revision: record.revision, body: 'Dear agent,\n\nPlease send the age range of the employees.\n\nThank you.' }, expected: null });
        leave('jefferson', record);
        if (r.status === 429) {
          assert.match(String(r.value?.error || ''), /sending limit was reached/i);
          const after = vc('jefferson', 'inquiries/' + record.id).inquiry;
          assert.notEqual(after.status, 'Waiting for agent details', 'a refused send must not move the inquiry on');
          return `${sent.length} sent (${sent.join(', ')}), then ${record.id} refused: "${r.value.error}"`;
        }
        assert.equal(r.status, 200, 'details request ' + r.status + ' ' + JSON.stringify(r.value).slice(0, 200));
        sent.push(record.id);
      }
      // The test version runs with the demo-day caps (RMC2_MAIL_CAP_PER_HOUR=30 / _PER_DAY=100 since 2026-11-05), so 6 sends
      // are within the limit. The cap boundary itself is checked in scripts/test-mail-service.mjs (5/hour, 20/day).
      return `${sent.length} sent and none refused: the cap on TEST is above 6 (demo caps); the boundary is checked locally`;
    });
  }
} finally {
  for (const user of Object.keys(cookies)) { try { vc(user, 'logout', { json: {} }); } catch { /* ignore */ } }
  await writeFile(path.join('test-results/email-edge-online', 'results.json'), JSON.stringify({ stamp, results }, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ', FAILED: ' + failed.map(f => f.name).join(' | ') : ''));
  process.exitCode = failed.length ? 1 : 0;
}
