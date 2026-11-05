// Demo prep (test version only): links Sent demo clients to the sample Division Head and SOA, so "My Clients", the
// protection countdown and the progress-report approval can be shown. Uses Zeo (approving supervisor), because linking
// a protected client needs an approver. Runs through `vercel curl` with the git-ignored test credentials.
//   node scripts/demo-link-owner-clients.mjs [deploymentUrl]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const deployment = process.argv[2] || 'https://rmc2-test-yiizer.vercel.app';
// Keyed by account id (the username column, or the email name when none); the Division Head signs in as divisionhead@rmc2.local.
const logins = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^(\S+@rmc2\.local)\s+username:\s*(\S+).*password:\s*(\S+)/)).filter(Boolean)
  .map(m => [m[2] === 'undefined' ? m[1].split('@')[0] : m[2], { email: m[1], password: m[3] }]));
const vercelCli = path.join(path.dirname(spawnSync(process.platform === 'win32' ? 'where' : 'which', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
const cookies = {};
function vc(user, route, json) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', '--include', '--max-time', '120'];
  if (cookies[user]) args.push('--header', 'Cookie: ' + cookies[user]);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  const r = spawnSync(process.execPath, [vercelCli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: 'utf8', maxBuffer: 64 << 20 });
  const t = r.stdout || '', split = t.search(/\r?\n\r?\n(?!HTTP\/)/), head = t.slice(0, split), body = t.slice(split).trim();
  const sc = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (sc) cookies[user] = sc[1];
  let v = body; try { v = JSON.parse(body); } catch {}
  return { status: Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]), v };
}
for (const u of ['zeo', 'division-head', 'soa']) assert.equal(vc(u, 'login', { email: logins[u].email, password: logins[u].password }).status, 200, 'login ' + u);
const boot = vc('zeo', 'bootstrap').v;
const sent = boot.inquiries.filter(r => r.status === 'Sent' && !r.ownerId && boot.clientStates[r.id]?.state !== 'archived' && r.protection).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
assert.ok(sent.length >= 2, 'need two Sent, protected, unlinked demo clients; found ' + sent.length);
for (const [record, owner] of [[sent[0], 'division-head'], [sent[1], 'soa']]) {
  const r = vc('zeo', 'inquiries/' + record.id + '/owner', { revision: record.revision, ownerId: owner });
  console.log(r.status === 200 ? 'LINKED' : 'FAILED ' + r.status + ' ' + JSON.stringify(r.v).slice(0, 200), record.id, '→', owner);
}
for (const u of ['division-head', 'soa']) {
  const mine = vc(u, 'my-clients').v.clients || [];
  console.log(u + ': ' + mine.length + ' client(s) — ' + mine.map(c => c.status + (c.protection ? ', ' + c.protection.daysLeft + ' days left' : '')).join('; '));
}
