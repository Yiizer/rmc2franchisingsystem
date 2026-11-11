// SCAN ONLY on the ONLINE TEST version: signs in as the Admin, runs "Scan stored files" (records which files are unused,
// with the time first seen) and prints the counts per folder. It never calls the delete route. Also checks that the Head
// is refused. Passwords come from the git-ignored test-results/online-credentials/CREDENTIALS.txt and are never printed.
//   node scripts/stored-files-scan-online.mjs
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
const signIn = who => { const r = call('login', { email: creds[who].email, password: creds[who].password }); if (r.status !== 200) throw new Error(who + ' sign-in ' + r.status); return r.cookie; };

const head = signIn('emerson');
const refused = call('stored-files', null, head).status;
call('logout', {}, head);
const admin = signIn('admin');
const scan = call('stored-files/scan', {}, admin);
const status = call('stored-files', null, admin);
call('logout', {}, admin);
console.log('Head GET stored-files: ' + refused + (refused === 403 ? ' (refused, as it should be)' : ' ✗'));
console.log('Admin scan: ' + scan.status + ' · ' + JSON.stringify(scan.body && { total: scan.body.total, unused: scan.body.unused, ready: scan.body.ready, byFolder: scan.body.byFolder, readyAt: scan.body.readyAt, error: scan.body.error }));
console.log('Admin status: ' + status.status + ' · unused ' + status.body?.unused);
if (refused !== 403 || scan.status !== 200 || status.status !== 200) process.exit(1);
