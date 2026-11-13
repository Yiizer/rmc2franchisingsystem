// Final pass, READ-ONLY: signs in as every role on the ONLINE TEST version (vercel curl) and checks that each one's pages
// load and that what it must not see is refused. GETs only, plus sign-in/out. Passwords come from the git-ignored
// test-results/online-credentials/CREDENTIALS.txt and are never printed.   node scripts/roles-check-online.mjs
import { spawnSync } from 'node:child_process'; import { readFileSync } from 'node:fs'; import path from 'node:path';
const deployment = 'https://rmc2-test-yiizer.vercel.app';
const creds = Object.fromEntries(readFileSync('test-results/online-credentials/CREDENTIALS.txt', 'utf8').split(/\r?\n/).map(l => l.match(/^(\S+@rmc2\.local)\s+username:\s*(\S+).*password:\s*(\S+)/)).filter(Boolean).map(m => [m[1].split('@')[0], { email: m[1], password: m[3] }]));
const cli = path.join(path.dirname(spawnSync('where', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
function call(route, json, cookie) {
  const out = spawnSync(process.execPath, [cli, 'curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', '--include', '--max-time', '120', ...(cookie ? ['--header', 'Cookie: ' + cookie] : []), ...(json ? ['--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-'] : [])], { input: json ? JSON.stringify(json) : undefined, encoding: 'utf8', env, maxBuffer: 64 << 20 }).stdout || '';
  const split = out.search(/\r?\n\r?\n(?!HTTP\/)/); let body; try { body = JSON.parse(out.slice(split).trim()); } catch { body = null; }
  return { status: Number([...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]), cookie: out.match(/set-cookie:\s*(rmc2_session=[^;]+)/i)?.[1], body };
}
// [account, routes that must load (200), routes that must be refused (403)]
const plan = {
  cryssa: [['workspace', 'directory?q=a', 'divisions', 'email-templates'], ['monitoring/proposals?range=week', 'problem-reports', 'create-account-get-guard']],
  zeo: [['workspace', 'directory?q=a', 'monitoring/proposals?range=week', 'inbound'], ['problem-reports']],
  emerson: [['workspace', 'directory?q=a', 'monitoring/proposals?range=week', 'inbound', 'divisions', 'email-templates', 'template-history'], ['problem-reports']], // problem reports: Admin only since 2026-11-13
  admin: [['bootstrap', 'monitoring', 'problem-reports'], ['monitoring/proposals?range=week']],
  divisionhead: [['session', 'my-clients', 'my-team'], ['workspace', 'inbound', 'directory?q=a', 'problem-reports']],
  soa: [['session', 'my-clients'], ['workspace', 'my-team', 'inbound', 'directory?q=a']],
};
let ok = 0, bad = 0;
for (const [who, [allowed, refused]] of Object.entries(plan)) {
  const c = creds[who]; if (!c) { console.log('SKIP ' + who + ': no test credentials'); continue; }
  const login = call('login', { email: c.email, password: c.password });
  if (login.status !== 200) { console.log('FAIL ' + who + ' sign-in ' + login.status); bad++; continue; }
  const line = [];
  for (const route of allowed) { const r = call(route, null, login.cookie); const pass = r.status === 200; pass ? ok++ : bad++; line.push(route.split('?')[0] + ' ' + r.status + (pass ? '' : ' ✗')); }
  for (const route of refused.filter(r => !r.endsWith('-get-guard'))) { const r = call(route, null, login.cookie); const pass = r.status === 403 || r.status === 404; pass ? ok++ : bad++; line.push('no ' + route.split('?')[0] + ' ' + r.status + (pass ? '' : ' ✗')); }
  if (who === 'emerson') { const inbound = call('inbound', null, login.cookie).body; const has = inbound && 'health' in inbound; has ? ok++ : bad++; line.push('inbox health ' + (has ? JSON.stringify(inbound.health) : 'missing ✗')); }
  call('logout', {}, login.cookie);
  console.log((line.some(l => l.includes('✗')) ? 'FAIL ' : 'PASS ') + who + ': ' + line.join(' · '));
}
console.log(ok + ' passed, ' + bad + ' failed');
