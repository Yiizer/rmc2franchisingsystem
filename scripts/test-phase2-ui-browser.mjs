// Phase 2 UI walk-through (Division Head / SOA app, report queue, owner field, users & roles, monitoring) in a real browser.
// Start the server first on an isolated data dir:
//   set RMC2_DATA_DIR=test-results/phase2-ui/qa-data&& set RMC2_SEED_DEMO=1&& npx next dev --hostname 127.0.0.1 --port 5190
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5190', out = 'test-results/phase2-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const password = 'Rmc2Local!2026', errors = [];
const pass = message => console.log('PASS ' + message);
const api = path => base + '/api/operations/' + path;

async function context(who, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
  ctx.setDefaultTimeout(45000);
  const login = who === 'division-head' || who === 'soa' ? who : who + '@rmc2.local';
  const response = await ctx.request.post(api('login'), { data: { email: login, password } });
  assert.ok(response.ok(), 'login ' + who + ' ' + response.status() + ' ' + await response.text());
  return ctx;
}
async function open(ctx, hash = '') {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + '/' + hash);
  return page;
}
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  const cryssa = await context('cryssa'), zeo = await context('zeo'), emerson = await context('emerson'), admin = await context('admin'), dh = await context('division-head');

  // --- set up: link a Sent demo record with protection to the Division Head (once protected, only the Head or an approving supervisor may).
  // The seed has no sent proposal, so put one protected, delivered record in place directly in the isolated test database.
  const db = new DatabaseSync(path.resolve(out, 'qa-data/rmc2.sqlite'));
  const row = db.prepare('SELECT id,data FROM inquiries WHERE id=?').get('INQ-2026-00128');
  const seeded = JSON.parse(row.data), at = new Date(Date.now() - 10 * 86400000).toISOString();
  seeded.status = 'Sent';
  seeded.submissions = [{ version: 1, at, submittedBy: 'cryssa', fields: seeded.fields, email: seeded.email, emailOverrides: [], generated: { id: 'g1', templateId: 't', sourceHash: 'h', pdf: 'generated/none.pdf', docx: 'x', filename: 'Proposal', generatedAt: at, preparedBy: 'cryssa', fingerprint: 'f', fields: seeded.fields, pageCount: 1 }, notes: '', warnings: [], decision: { action: 'approve', actorId: 'zeo', at, note: '', flags: [] }, delivery: { id: 'd1', at, mode: 'local-test', file: '' } }];
  seeded.protection = { startedAt: at, activityAt: at, expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(), agentName: seeded.fields.agentName || 'Agent', agentEmail: seeded.fields.agentEmail || 'agent@example.com', agentPhone: seeded.fields.agentPhone || '', activityKind: 'proposal' };
  seeded.revision += 1;
  db.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(seeded.revision, JSON.stringify(seeded), seeded.id);
  db.prepare('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING').run(seeded.id);
  db.close();
  const boot = await (await cryssa.request.get(api('bootstrap'))).json();
  const sent = boot.inquiries.find(r => r.id === seeded.id);
  assert.ok(sent && boot.clientStates[sent.id]?.protection, 'a protected Sent record exists');
  let linked = await emerson.request.post(api('inquiries/' + sent.id + '/owner'), { data: { revision: sent.revision, ownerId: 'division-head' } });
  assert.equal(linked.status(), 200, await linked.text());
  const company = sent.fields.company;
  pass('Head linked "' + company + '" to the Division Head through POST inquiries/:id/owner');

  // --- Division Head, desktop
  let page = await open(dh);
  await page.getByRole('heading', { name: 'My Clients', level: 1 }).waitFor();
  const navNames = (await page.locator('.ops-shell-sidebar nav button').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  assert.deepEqual(navNames, ['My Clients', 'Submit inquiry'], 'nav: ' + navNames.join(','));
  assert.equal(await page.getByRole('button', { name: 'Dashboard' }).count(), 0);
  pass('Division Head sees only My Clients and Submit inquiry (' + navNames.join(' | ') + ')');
  await page.getByRole('link', { name: 'Open ' + company }).first().waitFor();
  await page.getByLabel('Search my clients').fill('zzzz-none');
  await page.getByRole('heading', { name: 'No clients match' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('link', { name: 'Open ' + company }).first().waitFor();
  pass('My Clients lists the linked client; search and "No clients match" state work');
  await page.screenshot({ path: out + '/dh-my-clients-desktop.png' });
  // unknown hash goes to My Clients
  await page.goto(base + '/#dashboard'); await page.getByRole('heading', { name: 'My Clients', level: 1 }).waitFor();
  pass('A disallowed hash (#dashboard) shows My Clients');

  // --- Submit inquiry with the sample form
  const sample = await (await cryssa.request.get(api('sample-form'))).body();
  await page.getByRole('button', { name: 'Submit inquiry' }).first().click();
  await page.getByRole('heading', { name: 'Submit inquiry', level: 1 }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'sample-form.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: sample });
  await page.getByRole('button', { name: 'Submit inquiry', exact: true }).last().click();
  const submitted = await Promise.race([page.getByText('Inquiry submitted').waitFor().then(() => 'ok'), page.getByText('This client is already protected.').waitFor().then(() => 'dup'), page.getByText(/We couldn.t (read|submit)/).waitFor().then(() => 'fail')]);
  await page.screenshot({ path: out + '/dh-submit-result.png' });
  assert.notEqual(submitted, 'fail');
  pass('Submit inquiry with the sample form shows: ' + (submitted === 'ok' ? 'Inquiry submitted' : 'This client is already protected.'));
  await page.setInputFiles('input[type=file]', []).catch(() => {});

  // bad type and size
  await page.goto(base + '/#submit-inquiry');
  await page.reload();
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await page.getByText('Please choose an Excel or PDF file.').waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024) });
  await page.getByText(/This file is 8\.0 MB\. The limit is 7 MB\./).waitFor();
  pass('Submit inquiry rejects a wrong type and an 8 MB file with the specified messages');

  // --- Client page and the progress report
  await page.goto(base + '/#my-clients'); await page.reload();
  await page.getByRole('link', { name: 'Open ' + company }).first().click();
  await page.getByRole('heading', { name: company, level: 1 }).waitFor();
  await page.getByText('An approved report gives you 30 days from the approval date.').waitFor();
  await page.getByRole('button', { name: 'File progress report' }).first().waitFor();
  await page.screenshot({ path: out + '/dh-client-desktop.png' });
  const clientHash = new URL(page.url()).hash;
  const clientId = decodeURIComponent(clientHash.replace('#my-clients/', ''));
  // validation
  await page.getByRole('button', { name: 'File progress report' }).first().click();
  const modal = page.getByRole('dialog', { name: 'File progress report' });
  await modal.waitFor();
  assert.equal(await modal.getByRole('button', { name: 'Send for review' }).isDisabled(), true);
  await modal.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024) });
  await modal.getByText(/This file is 8\.0 MB\. The limit is 7 MB\./).waitFor();
  await modal.locator('input[type=file]').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await modal.getByText('Please choose a PDF or a photo.').waitFor();
  await modal.getByLabel('Summary').fill('Met the HR head on site, presented the plan and agreed on a follow-up demo.');
  await modal.getByLabel('Reference').fill('Re: Plan presentation, week 1');
  await modal.locator('input[type=file]').setInputFiles({ name: 'minutes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') });
  await page.screenshot({ path: out + '/dh-file-report-modal.png' });
  await modal.getByRole('button', { name: 'Send for review' }).click();
  await page.getByText('Report sent for review. Your protection is held until it is decided.').waitFor();
  await page.getByText('Pending review').first().waitFor();
  await page.getByText('Held — report under review').first().waitFor();
  const filing = page.getByRole('button', { name: 'File progress report' }).first();
  assert.equal(await filing.getAttribute('aria-disabled'), 'true');
  await page.getByText('You already have a report under review.').waitFor();
  await page.screenshot({ path: out + '/dh-client-pending.png' });
  pass('Division Head filed a report (validation, 7 MB and type checks, toast, Pending item, Held protection, button aria-disabled with reason)');

  // --- Supervisor approves in the Progress reports tab
  let zp = await open(zeo);
  await zp.locator('.ops-shell-sidebar').getByRole('button', { name: /^Approval Queue/ }).click();
  await zp.getByRole('button', { name: /^Progress reports/ }).click();
  const card = zp.locator('.ops-report-card', { hasText: company });
  await card.waitFor();
  await card.getByText('Re: Plan presentation, week 1').waitFor();
  await zp.screenshot({ path: out + '/supervisor-progress-reports.png' });
  await card.getByRole('button', { name: 'Approve' }).click();
  const approve = zp.getByRole('dialog', { name: 'Approve progress report?' });
  await approve.getByText(/will run 30 days from today, until/).waitFor();
  await approve.getByRole('button', { name: 'Approve report' }).click();
  await zp.getByText(/Report approved\. Protection runs until/).first().waitFor();
  await zp.locator('.ops-report-card', { hasText: company }).waitFor({ state: 'detached' });
  pass('Supervisor sees the Progress reports tab, approves with the confirm modal; the card leaves the queue');

  // --- Division Head sees Approved and 30 days
  await page.reload();
  await page.getByRole('heading', { name: company, level: 1 }).waitFor();
  await page.getByText('Approved', { exact: true }).first().waitFor();
  const days = Number((await page.locator('.ops-client-countdown strong').innerText()).trim());
  assert.ok(days >= 29 && days <= 30, 'days left after approval: ' + days);
  await page.screenshot({ path: out + '/dh-client-approved.png' });
  pass('Division Head sees Approved and ' + days + ' days left after the approval');

  // --- Second report, rejected with a reason
  const form = { summary: 'Second follow-up call with the finance officer, awaiting the budget.', reference: 'Re: Budget call' };
  let second = await dh.request.post(api('my-clients/' + clientId + '/progress-report'), { multipart: { ...form, requestId: crypto.randomUUID() } });
  assert.equal(second.status(), 201, await second.text());
  await zp.reload();
  await zp.locator('.ops-shell-sidebar').getByRole('button', { name: /^Approval Queue/ }).click();
  await zp.getByRole('button', { name: /^Progress reports/ }).click();
  const card2 = zp.locator('.ops-report-card', { hasText: 'Re: Budget call' });
  await card2.getByRole('button', { name: 'Reject' }).click();
  const reject = zp.getByRole('dialog', { name: 'Reject progress report' });
  assert.equal(await reject.getByRole('button', { name: 'Reject report' }).isDisabled(), true);
  await reject.getByLabel(/^Reason/).fill('Please attach the budget email.');
  await reject.getByRole('button', { name: 'Reject report' }).click();
  await zp.getByText(/Report rejected\./).first().waitFor();
  await page.reload();
  await page.getByText('Reason: Please attach the budget email.').waitFor();
  await page.screenshot({ path: out + '/dh-client-rejected.png' });
  pass('Supervisor rejected a second report with a reason; the Division Head sees "Reason: Please attach the budget email."');

  // --- Employee: no Record button, report list read-only with chips, owner shown
  let ep = await open(cryssa);
  await ep.locator('.ops-shell-sidebar').getByRole('button', { name: 'Closed', exact: true }).click();
  await ep.getByRole('link', { name: 'Open ' + company }).first().click();
  await ep.getByRole('button', { name: 'View client protection and progress reports' }).first().click();
  await ep.getByRole('heading', { name: 'Client protection & progress reports' }).waitFor();
  assert.equal(await ep.getByRole('button', { name: /Record (the agent.s )?progress report/ }).count(), 0);
  await ep.getByText('Approved', { exact: true }).first().waitFor();
  await ep.getByText('Reason: Please attach the budget email.').waitFor();
  assert.equal(await ep.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
  await ep.locator('.ops-rail-details').getByText('Division Head').first().waitFor();
  await ep.screenshot({ path: out + '/employee-protection-card.png' });
  pass('Employee: no "Record progress report" button; reports are read-only with status chips; Owner shown in the details');
  // Owner picker (Employee, unlinked and unprotected inquiry)
  const bootNow = await (await cryssa.request.get(api('bootstrap'))).json();
  const unlinked = bootNow.inquiries.find(r => r.status === 'New inquiry' && !r.ownerId && bootNow.inquiries.filter(o => o.fields.company === r.fields.company).length === 1);
  ep = await open(cryssa, '#inquiries/all'); await ep.getByRole('link', { name: 'Open ' + unlinked.fields.company }).first().waitFor();
  await ep.getByRole('link', { name: 'Open ' + unlinked.fields.company }).first().click();
  await ep.getByRole('button', { name: 'Start handling' }).first().click();
  await ep.getByRole('button', { name: 'Edit details' }).first().click();
  const edit = ep.getByRole('dialog', { name: 'Edit inquiry details' });
  await edit.getByText('Owner (Division Head / SOA)').waitFor();
  const picker = edit.getByRole('combobox', { name: 'Owner (Division Head / SOA)' });
  await picker.click();
  const options = await ep.getByRole('listbox').getByRole('option').allInnerTexts();
  assert.ok(options[0] === 'Not linked' && options.some(o => /^Division Head · Division 4/.test(o)) && options.some(o => /^SOA · Division 4 · SOA/.test(o)), 'options: ' + options.join(' | '));
  await picker.press('ArrowDown'); await picker.press('ArrowDown');
  await ep.screenshot({ path: out + '/employee-owner-picker.png' });
  await picker.press('Enter');
  await ep.getByText('Owner linked').first().waitFor();
  await ep.getByText(/Only the Head or an approving supervisor can change the owner/).waitFor();
  const linkedNow = (await (await cryssa.request.get(api('bootstrap'))).json()).inquiries.find(r => r.id === unlinked.id);
  assert.ok(linkedNow.ownerId, 'owner saved on the record');
  pass('Owner picker (combobox): Not linked first, Division Head / SOA options, Up/Down + Enter links the owner for an Employee');

  // --- Head: Users & Roles
  let hp = await open(emerson);
  await hp.locator('.ops-shell-sidebar').getByRole('button', { name: 'Users & Roles' }).click();
  await hp.getByRole('heading', { name: /Users & roles/i }).waitFor();
  await hp.getByText('Create accounts and set roles. Admin accounts are managed by IT.').waitFor();
  const roleOptions = await hp.getByLabel('Role for Division Head').locator('option').allInnerTexts();
  assert.deepEqual(roleOptions, ['Head', 'Supervisor', 'Employee', 'Division Head', 'SOA']);
  await hp.getByLabel('Division for Division Head').waitFor();
  assert.equal(await hp.getByText('Can approve').count(), 0);
  await hp.getByRole('button', { name: 'Create account' }).click();
  const create = hp.getByRole('dialog', { name: 'Create staff account' });
  await create.getByLabel('Role').selectOption('SOA');
  await create.locator('select[name=division]').waitFor();
  await create.getByLabel('Phone (optional)').waitFor();
  await hp.screenshot({ path: out + '/head-users-roles.png' });
  pass('Head: Users & Roles has Division select for Division Head/SOA, no Admin role, no "Can approve", phone field');
  await hp.keyboard.press('Escape');
  // monitoring AI usage only
  await zp.locator('.ops-shell-sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await zp.getByRole('heading', { name: 'Monitoring' }).waitFor();
  await zp.getByRole('heading', { name: 'AI usage' }).waitFor();
  assert.equal(await zp.locator('.ops-health-card').count(), 0);
  assert.equal(await zp.getByText('Run connectivity checks').count(), 0);
  pass('Supervisor Monitoring shows AI usage only (no service cards, no connectivity checks)');

  // --- Admin: reset-only
  let ap = await open(admin);
  await ap.locator('.ops-admin-nav summary').click();
  await ap.locator('.ops-shell-sidebar').getByRole('button', { name: 'Users & Roles' }).click();
  await ap.getByText('Reset a password or unlock an account in an emergency. Role changes are made by the Head.').waitFor();
  assert.ok(await ap.getByRole('button', { name: /Reset password for/ }).count() > 0);
  assert.equal(await ap.locator('select[aria-label^="Role for"]').count(), 0);
  assert.equal(await ap.getByRole('button', { name: 'Create account' }).count(), 0);
  await ap.screenshot({ path: out + '/admin-users-roles.png' });
  const adminNav = (await ap.locator('.ops-shell-sidebar nav button').allInnerTexts()).map(t => t.trim());
  assert.ok(!adminNav.includes('Proposal Templates'));
  pass('Admin: Users & Roles is a read-only list with Reset password / Unlock only; no role selects, no Create account, no Proposal Templates');

  // --- Phone, 375px
  const phone = await context('division-head', { width: 375, height: 812 });
  const mp = await open(phone);
  await mp.getByRole('heading', { name: 'My Clients', level: 1 }).waitFor();
  await mp.locator('.ops-tabbar').waitFor();
  await mp.getByRole('link', { name: 'Open ' + company }).first().waitFor();
  assert.equal(await mp.locator('.ops-oc-table-wrap').isVisible(), false);
  assert.ok(await noHorizontalScroll(mp), 'My Clients scrolls sideways at 375px');
  const small = await mp.locator('.ops-tabbar button').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().height)));
  assert.ok(small.every(h => h >= 56), 'tab heights ' + small);
  await mp.screenshot({ path: out + '/phone-my-clients.png' });
  await mp.getByRole('link', { name: 'Open ' + company }).first().click();
  await mp.getByRole('heading', { name: company, level: 1 }).waitFor();
  assert.ok(await noHorizontalScroll(mp), 'Client page scrolls sideways at 375px');
  await mp.screenshot({ path: out + '/phone-client.png', fullPage: true });
  await mp.getByRole('button', { name: 'File progress report' }).first().click();
  const sheet = mp.getByRole('dialog', { name: 'File progress report' });
  await sheet.waitFor();
  assert.ok(await noHorizontalScroll(mp));
  await mp.screenshot({ path: out + '/phone-file-report.png' });
  pass('375px: My Clients cards + bottom tab bar (tabs >= 56px), client page and file-report sheet have no horizontal scroll');

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  pass('No page errors or console errors');
} catch (error) {
  await writeFile(out + '/failure.txt', String(error.stack || error)).catch(() => {});
  console.error('FAIL', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
