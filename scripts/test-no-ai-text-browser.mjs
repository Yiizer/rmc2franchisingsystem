// Feedback items 1 and 8: no screen may show the standalone word "AI" or "Won", in visible text, aria-labels or titles.
// Signs in as each role, visits every sidebar page and one inquiry workspace (staff roles), and fails on any match.
//   BASE_URL=http://127.0.0.1:5195 node scripts/test-no-ai-text-browser.mjs
// Start a dev server on a seeded, isolated data dir first (never point this at port 5173):
//   set RMC2_DATA_DIR=test-results/feedback-1107/qa-data&& set RMC2_SEED_DEMO=1&& npx next dev --hostname 127.0.0.1 --port 5195
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = (process.env.BASE_URL || 'http://127.0.0.1:5195').replace(/\/$/, '');
assert.ok(!/:5173\b/.test(base), 'Do not run this against port 5173.');
const out = 'test-results/no-ai-text';
await mkdir(out, { recursive: true });
const password = process.env.LOCAL_PASSWORD || 'Rmc2Local!2026'; // database.LOCAL_PASSWORD
const BAD = /\b(AI|Won)\b/;
const roles = [
  { who: 'Head', logins: ['emerson@rmc2.local', 'emerson'] }, { who: 'Supervisor', logins: ['zeo@rmc2.local', 'zeo'] },
  { who: 'Employee', logins: ['cryssa@rmc2.local', 'cryssa'] }, { who: 'Admin', logins: ['admin@rmc2.local', 'admin'] },
  { who: 'Division Head', logins: ['divisionhead@rmc2.local', 'division-head'], owner: true }, { who: 'SOA', logins: ['soa@rmc2.local', 'soa'], owner: true },
];
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const failures = [], visited = [], errors = [];

async function login(ctx, logins) {
  for (const email of logins) {
    const r = await ctx.request.post(base + '/api/operations/login', { data: { email, password } });
    if (r.ok()) return email;
  }
  throw new Error('Could not sign in with any of: ' + logins.join(', '));
}
// Everything a person can read or hear on the current screen.
const scan = page => page.evaluate(() => {
  const found = [];
  const visible = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const text = document.body.innerText || '';
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],img[alt]')) {
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) { const v = el.getAttribute(attr); if (v) found.push({ kind: attr, value: v, shown: visible(el) }); }
  }
  return { text, attrs: found };
});
async function check(page, label) {
  const { text, attrs } = await scan(page);
  visited.push(label);
  for (const line of text.split('\n')) if (BAD.test(line)) failures.push(label + ' [text] ' + line.trim().slice(0, 140));
  for (const a of attrs) if (BAD.test(a.value)) failures.push(label + ' [' + a.kind + '] ' + a.value.slice(0, 140));
}

try {
  for (const role of roles) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    ctx.setDefaultTimeout(30000);
    await login(ctx, role.logins);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(role.who + ': ' + e.message));
    await page.goto(base + '/');
    await page.locator('.ops-shell-sidebar nav button').first().waitFor();
    await check(page, role.who + ' / home');
    // Every sidebar item (open the collapsed Admin group first when there is one).
    const summary = page.locator('.ops-admin-nav summary');
    if (await summary.count()) { if (!(await page.locator('.ops-admin-nav').getAttribute('open'))) await summary.click(); }
    const names = (await page.locator('.ops-shell-sidebar nav button').evaluateAll(list => list.map(b => b.getAttribute('aria-label') || b.textContent.trim()))).filter(Boolean);
    for (const name of [...new Set(names)]) {
      await page.locator('.ops-shell-sidebar nav button', { has: page.locator('span', { hasText: name }) }).first().click().catch(async () => { await page.getByRole('button', { name, exact: true }).first().click(); });
      await page.waitForTimeout(700);
      await check(page, role.who + ' / ' + name);
    }
    // Settings (the account menu), where the email templates live.
    await page.locator('.ops-profile-trigger').click();
    await page.locator('.ops-profile-menu button', { hasText: /settings/i }).first().click();
    await page.waitForTimeout(900);
    await check(page, role.who + ' / Settings');
    if (!role.owner) {
      // One inquiry workspace: open the first row of the Inquiries list.
      await page.locator('.ops-shell-sidebar nav button', { has: page.locator('span', { hasText: /^Inquiries$/ }) }).first().click();
      const row = page.locator('tr[role=link]').first();
      if (await row.count().catch(() => 0) || await row.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
        await row.click();
        await page.waitForTimeout(1500);
        await check(page, role.who + ' / inquiry workspace');
        for (const step of ['Choose a proposal template', 'Prepare the proposal']) {
          const tab = page.getByRole('button', { name: new RegExp(step.split(' ').slice(-2).join(' '), 'i') }).first();
          if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(600); await check(page, role.who + ' / workspace step ' + step); }
        }
      } else console.log('NOTE ' + role.who + ': no inquiry rows to open');
    } else {
      await page.goto(base + '/#submit-inquiry'); await page.waitForTimeout(600);
      await page.getByRole('tab', { name: 'Fill in details' }).click().catch(() => {});
      await check(page, role.who + ' / Submit inquiry (fill in details)');
    }
    await ctx.close();
  }
} catch (error) {
  await writeFile(out + '/failure.txt', String(error.stack || error)).catch(() => {});
  console.error('FAIL (script error)', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log('Screens scanned: ' + visited.length);
for (const v of visited) console.log('  ' + v);
if (errors.length) console.log('Page errors (not a failure of this check):\n  ' + [...new Set(errors)].join('\n  '));
if (failures.length) { console.error('FAIL ' + failures.length + ' match(es) for /\\b(AI|Won)\\b/:\n  ' + failures.join('\n  ')); process.exitCode = 1; }
else if (!process.exitCode) console.log('PASS No visible text, aria-label, title or placeholder says "AI" or "Won" on ' + visited.length + ' screens.');
