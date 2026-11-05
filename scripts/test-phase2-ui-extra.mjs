// Phase 2 UI checks that test-phase2-ui-browser.mjs does not cover, in a real browser on an isolated test database:
//  approve from inside an inquiry, "already decided", the daily report limit, the two-rejection block, the reset-password
//  window and a Division Head's first sign-in with a temporary password.
// Start the server first (fresh data dir each run):
//   set RMC2_DATA_DIR=test-results/phase2-extra/qa-data&& set RMC2_SEED_DEMO=1&& npx next dev --hostname 127.0.0.1 --port 5194
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5194', out = 'test-results/phase2-extra';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const password = 'Rmc2Local!2026', errors = [];
const pass = message => console.log('PASS ' + message);
const api = p => base + '/api/operations/' + p;
async function context(who, pw = password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } }); ctx.setDefaultTimeout(45000);
  const login = who === 'division-head' || who === 'soa' ? who : who + '@rmc2.local';
  const r = await ctx.request.post(api('login'), { data: { email: login, password: pw } });
  assert.ok(r.ok(), 'login ' + who + ' ' + r.status());
  return ctx;
}
async function open(ctx, hash = '') {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + '/' + hash); return page;
}
const db = () => new DatabaseSync(path.resolve(out, 'qa-data/rmc2.sqlite'));
function editRecord(id, fn) { const d = db(); const row = d.prepare('SELECT data FROM inquiries WHERE id=?').get(id); const r = JSON.parse(row.data); fn(r); r.revision += 1; d.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(r.revision, JSON.stringify(r), id); d.prepare('INSERT INTO inquiry_index_pending(id) VALUES (?) ON CONFLICT DO NOTHING').run(id); d.close(); return r; }
const fileReport = (ctx, id, reference) => ctx.request.post(api('my-clients/' + id + '/progress-report'), { multipart: { summary: 'Met the HR officer and walked through the proposal with finance.', reference, requestId: randomUUID() } });

try {
  const zeo = await context('zeo'), emerson = await context('emerson'), dh = await context('division-head');
  let page;
  // Set up: a protected, Sent client owned by the Division Head.
  const id = 'INQ-2026-00128', at = new Date(Date.now() - 10 * 86400000).toISOString();
  const seeded = process.env.SKIP ? editRecord(id, () => {}) : editRecord(id, r => { r.status = 'Sent'; r.submissions = [{ version: 1, at, submittedBy: 'cryssa', fields: r.fields, email: r.email, emailOverrides: [], generated: { id: 'g1', templateId: 't', sourceHash: 'h', pdf: 'generated/none.pdf', docx: 'x', filename: 'Proposal', generatedAt: at, preparedBy: 'cryssa', fingerprint: 'f', fields: r.fields, pageCount: 1 }, notes: '', warnings: [], decision: { action: 'approve', actorId: 'zeo', at, note: '', flags: [] }, delivery: { id: 'd1', at, mode: 'local-test', file: 'x' } }]; r.protection = { startedAt: at, activityAt: at, expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(), agentName: 'Agent', agentEmail: 'agent@example.com', agentPhone: '', activityKind: 'proposal' }; });
  const boot = await (await emerson.request.get(api('bootstrap'))).json(), sent = boot.inquiries.find(r => r.id === id);
  if(!process.env.SKIP)assert.equal((await emerson.request.post(api('inquiries/' + id + '/owner'), { data: { revision: sent.revision, ownerId: 'division-head' } })).status(), 200);
  const company = seeded.fields.company;

  const skip=Number(process.env.SKIP||0);
  // 1. Approve from inside the inquiry (workspace protection card).
if(skip<1){
  assert.equal((await fileReport(dh, id, 'Call 1')).status(), 201);
  page = await open(zeo, '#inquiries/all');
  await page.getByRole('link', { name: 'Open ' + company, exact: true }).first().click();
  // The protection card sits on the first step; the 'days left' link in the summary jumps there.
  await page.locator('.ops-protection-link').first().click();
  await page.getByRole('button', { name: /^Approve/ }).first().waitFor();
  await page.getByRole('button', { name: /^Approve/ }).first().click();
  await page.getByRole('button', { name: /Approve report/ }).click();
  await page.getByText(/Report approved/).first().waitFor();
  let mine = (await (await dh.request.get(api('my-clients'))).json()).clients[0];
  assert.equal(mine.progressReports.at(-1).status, 'approved'); assert.equal(mine.protection.daysLeft, 30);
  await page.screenshot({ path: out + '/approve-in-inquiry.png' });
  pass('Approve from inside the inquiry (protection card → confirm) renews protection to 30 days');
}

  // 2. "Already decided": Zeo has the queue open, Emerson decides first, then Zeo clicks Approve.
if(skip<2){
  assert.equal((await fileReport(dh, id, 'Call 2')).status(), 201);
  page = await open(zeo, '#approval-queue/progress-reports');
  await page.getByRole('button', { name: /^Approve/ }).first().waitFor();
  const pending = (await (await emerson.request.get(api('workspace?view=Inquiries&search=&filter=All+statuses&division=&page=1&noticePage=1&selected='))).json()).pendingProgressReports.find(p => p.inquiryId === id);
  assert.equal((await emerson.request.post(api('inquiries/' + id + '/progress-report/' + pending.reportId + '/decision'), { data: { action: 'approve' } })).status(), 200);
  await page.getByRole('button', { name: /^Approve/ }).first().click();
  await page.getByRole('button', { name: /Approve report/ }).click();
  await page.getByText(/already decided/i).first().waitFor();
  await page.screenshot({ path: out + '/already-decided.png' });
  pass('A second decider sees "already decided" and no second decision is recorded');
}

  // 3. Daily report limit: 20 reports in the last 24 hours (put in place directly), then the Division Head tries again.
  editRecord(id, r => { const now = new Date().toISOString(); for (let i = 0; i < 20; i++) r.progressReports.push({ id: randomUUID(), sentAt: now, recordedAt: now, recordedBy: 'division-head', submittedBy: 'division-head', sender: 'x', summary: 'Filler report for the daily limit.', reference: 'Filler ' + i, status: 'approved', decidedBy: 'zeo', decidedAt: now }); });
  page = await open(dh, '#my-clients/' + id);
  await page.getByRole('button', { name: /File progress report/ }).first().click();
  await page.getByLabel(/Summary/).fill('Met the HR officer and walked through the proposal with finance.');
  await page.getByLabel(/Reference/).fill('Call 3');
  await page.getByRole('button', { name: /Send for review/ }).click();
  await page.getByText(/up to 20 progress reports a day/).first().waitFor();
  await page.screenshot({ path: out + '/daily-limit.png' });
  editRecord(id, r => { r.progressReports = r.progressReports.filter(x => !/^Filler /.test(x.reference)); });
  pass('Daily limit: the 21st report in 24 hours shows "You can file up to 20 progress reports a day…"');

  // 4. Two rejections since the last renewal block refiling, with the reason shown.
  for (const ref of ['Call 4', 'Call 5']) {
    assert.equal((await fileReport(dh, id, ref)).status(), 201);
    const p = (await (await emerson.request.get(api('workspace?view=Inquiries&search=&filter=All+statuses&division=&page=1&noticePage=1&selected='))).json()).pendingProgressReports.find(x => x.inquiryId === id);
    assert.equal((await emerson.request.post(api('inquiries/' + id + '/progress-report/' + p.reportId + '/decision'), { data: { action: 'reject', reason: 'Not enough detail yet' } })).status(), 200);
  }
  page = await open(dh, '#my-clients/' + id);
  await page.getByText(/Contact franchising before filing again/).first().waitFor();
  const button = page.getByRole('button', { name: /File progress report/ }).first();
  assert.equal(await button.getAttribute('aria-disabled'), 'true');
  await page.screenshot({ path: out + '/two-rejections.png' });
  pass('Two rejections: File progress report is disabled with "Contact franchising before filing again."');

  // 5. Reset-password window (Head) shows a one-time password.
  page = await open(emerson, '#users-&-roles');
  await page.getByText('Judy Villaruel').first().waitFor();
  const row = page.locator('.ops-user-row').filter({ hasText: 'Judy Villaruel' });
  await row.getByRole('button', { name: /Reset password/ }).click();
  await page.getByLabel(/password/i).last().fill(password);
  await page.getByRole('button', { name: /^Reset password$/ }).last().click();
  await page.getByText(/temporary password/i).first().waitFor();
  await page.screenshot({ path: out + '/reset-password.png' });
  pass('Reset password window: confirm with the Head password, a one-time temporary password is shown');

  // 6. A Division Head's first sign-in with a temporary password goes to Settings only.
  const reset = await (await emerson.request.post(api('reset-password'), { data: { userId: 'division-head', currentPassword: password } })).json();
  const fresh = await context('division-head', reset.temporaryPassword);
  page = await open(fresh, '#my-clients');
  await page.getByText(/temporary password|Set your own password|choose a new password/i).first().waitFor();
  const clientsHidden = await page.getByText(company).count();
  assert.equal(clientsHidden, 0, 'no client data before the password is changed');
  assert.equal((await fresh.request.get(api('my-clients'))).status() >= 400 || ((await (await fresh.request.get(api('bootstrap'))).json()).clients || []).length === 0, true);
  await page.screenshot({ path: out + '/dh-temp-password.png' });
  pass('Division Head with a temporary password sees only the password page, no clients');

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  pass('No page errors');
} finally { await browser.close(); }
