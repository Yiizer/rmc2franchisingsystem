// Checks the online steps that had never run on the test version, without touching the records used live in the demo:
// the inbox check and Requests list, a customized proposal from paragraph edit to approval and email, a duplicate
// recheck, and a password change (changed and changed back). Adds one fictional client, Pacific Crest Builders, which
// ends up Sent with a Customized label. Runs through `vercel curl`.   node scripts/demo-check-online.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';

const deployment = 'https://rmc2-test-yiizer.vercel.app', tmp = 'test-results/demo-online/tmp';
const passwords = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^(\S+@rmc2\.local)\s.*password:\s*(\S+)/)).filter(Boolean).map(m => [m[1].split('@')[0], m[2]]));
const vercelCli = path.join(path.dirname(spawnSync(process.platform === 'win32' ? 'where' : 'which', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const cookies = {}, tabs = {}, results = [];
function vc(user, route, { json, form, expected = 200 } = {}) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', '--include', '--max-time', '120'];
  if (cookies[user]) args.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [key, value] of Object.entries(form)) args.push('--form', key + '=' + value);
  const result = spawnSync(process.execPath, [vercelCli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: 'utf8', maxBuffer: 64 << 20 });
  const text = result.stdout || '', split = text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split), body = text.slice(split).trim();
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const setCookie = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (setCookie) cookies[user] = setCookie[1];
  let value = body; try { value = JSON.parse(body); } catch {}
  assert.equal(status, expected, route + ' (' + user + '): ' + JSON.stringify(value).slice(0, 400));
  return value;
}
const login = (user, password = passwords[user]) => vc(user, 'login', { json: { email: user + '@rmc2.local', password } });
const act = (user, record, name, extra = {}) => vc(user, 'inquiries/' + record.id + '/' + name, { json: { revision: record.revision, ...extra } }).inquiry;
const save = (user, record, changes = {}) => act(user, record, 'save', { fields: record.fields, templateId: record.templateId, notes: record.notes, email: record.email, emailOverrides: record.emailOverrides, customization: record.customization ? { id: record.customization.id, edits: record.customization.edits } : null, ...changes });
const handle = (user, record, action) => vc(user, 'inquiries/' + record.id + '/activity', { json: { tab: tabs[user] ??= randomUUID(), action } });
// ONLY=custom reruns just the customized-proposal checks.
const only = process.env.ONLY, wanted = name => !only || (only === 'custom' && /ustomiz/.test(name));
const check = (name, fn) => { if (!wanted(name)) return; try { const detail = fn(); results.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' · ' + detail : '')); } catch (error) { results.push({ name, ok: false, detail: error.message }); console.log('FAIL ' + name + ' · ' + error.message.slice(0, 400)); } };

for (const user of ['cryssa', 'jefferson', 'zeo', 'judy']) login(user);
try {
  // 1. Inbox: the list loads and a manual check runs (it imports whatever form is waiting; nothing is sent).
  check('Requests list loads', () => { const list = vc('cryssa', 'inbound'); return JSON.stringify(list).slice(0, 160); });
  check('Check mail now runs', () => { const result = vc('cryssa', 'inbound/check', { json: {} }); return JSON.stringify(result).slice(0, 200); });

  // 2. Customized proposal: copy, edit one paragraph, PDF, submit, approve with the customization acknowledged, email.
  let record;
  const sample = await readFile(path.join(tmp, 'sample-form.xlsx')), book = new ExcelJS.Workbook(); await book.xlsx.load(sample);
  const sheet = book.worksheets[0], today = new Date().toISOString().slice(0, 10);
  const values = { C7: 'Irene Santos', J7: today, D8: 'Taguig', J8: '09175554001', B10: 'Pacific Crest Builders Inc.', J10: 'PRIVATE', J11: 'Construction', C12: '9 Lawton Avenue, Taguig City', D14: 'Engr. Victor Lim', B17: 'hr.pacificcrest@clients.example.test', J16: '09985554002', C18: 'HR and Admin Manager', J18: 'None', B21: 'Engr. Victor Lim', G21: 'HR and Admin Manager', D22: 'Total CorpoShield', G23: 'Annual', D25: 140, J24: 40, C26: '21–60', J26: '1–55', C29: 'For confirmation', I29: 'For confirmation' };
  for (const [cell, value] of Object.entries(values)) sheet.getCell(cell).value = value;
  const file = path.join(tmp, 'Franchise-Form-pacific-crest.xlsx'); await writeFile(file, Buffer.from(await book.xlsx.writeBuffer()));
  const boot = vc('cryssa', 'bootstrap'), template = boot.templates.find(t => t.sourceId === 'D094' && t.active);
  record = boot.inquiries.find(r => r.fields.company === values.B10);
  if (!record) record = vc('cryssa', 'intake', { form: { sender: 'irene.santos@agents.example.test', file: '@' + file + ';type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, expected: 201 }).inquiry;
  check('Customize, edit a paragraph, generate, submit', () => {
    if (record.status === 'Sent') return 'already done earlier';
    handle('jefferson', record, 'start');
    record = act('jefferson', record, 'customize', { templateId: template.id });
    const model = vc('jefferson', 'custom-document', { json: { inquiryId: record.id, templateId: template.id, fields: record.fields, edits: {} } });
    const block = model.blocks.find(b => typeof b.text === 'string' && b.text.length > 80 && !/\{|\}/.test(b.text));
    assert.ok(block, 'no editable paragraph found');
    const edits = { [block.id]: { text: block.text + ' Coverage for construction site injuries is confirmed with the client.' } };
    record = save('jefferson', record, { customization: { id: record.customization.id, edits } });
    record = act('jefferson', record, 'generate');
    record = act('jefferson', record, 'submit');
    handle('jefferson', record, 'leave');
    assert.equal(record.status, 'Awaiting approval');
    return record.id + ' · edited block ' + block.id + ' · ' + record.generated.pageCount + ' pages';
  });
  check('Supervisor approves the customized proposal and the email is sent', () => {
    if (record.status === 'Sent') return 'already sent';
    const version = record.submissions.at(-1).version;
    record = act('zeo', record, 'decision', { version, action: 'approve', note: 'Customized wording reviewed and approved.', flags: [], customizationReviewed: true });
    assert.equal(record.status, 'Sent', 'status is ' + record.status + ' ' + JSON.stringify(record.mailFailure || ''));
    return record.status + ' · protection until ' + record.protection?.expiresAt;
  });

  // 3. Duplicate recheck keeps the hold while the original registration is active.
  check('Duplicate recheck keeps the hold', () => {
    const dup = vc('cryssa', 'bootstrap').inquiries.find(r => r.fields.company === 'Northstar Logistics Corporation' && r.fields.agentName === 'Victor Tan');
    assert.ok(dup, 'duplicate record not found');
    const after = act('cryssa', dup, 'review-client', { action: 'recheck', note: '' });
    assert.equal(after.clientReview?.state, 'duplicate');
    return dup.id + ' still on hold';
  });

  // 4. Password change for Judy, then changed back to the password in CREDENTIALS.txt.
  check('Password change, then sign in with the new one, then change back', () => {
    const original = passwords.judy, temporary = 'Demo-' + randomUUID().slice(0, 12) + '-Aa1!';
    vc('judy', 'account-settings', { json: { username: 'judy', currentPassword: original, password: temporary } });
    delete cookies.judy; login('judy', temporary);
    try { vc('judy', 'account-settings', { json: { username: 'judy', currentPassword: temporary, password: original } }); }
    catch (error) { // keep the credentials file true if the old password can't be set again
      spawnSync(process.execPath, ['-e', `const fs=require('fs'),f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^(judy@rmc2\\.local\\s.*password:\\s*)\\S+/m,'$1'+process.argv[2]))`, 'test-results/online-credentials/CREDENTIALS.txt', temporary]);
      throw new Error('changed, but changing back failed; CREDENTIALS.txt now holds the new password · ' + error.message);
    }
    delete cookies.judy; login('judy', original);
    return 'judy can sign in with the original password again (username "judy" now also works)';
  });
} finally {
  for (const user of Object.keys(cookies)) try { vc(user, 'logout', { json: {} }); } catch {}
  await writeFile('test-results/demo-online/check-results.json', JSON.stringify(results, null, 2));
  console.log(results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
}
