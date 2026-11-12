// REMAINING_WORK §0 "Inbox unreachable, or the app password revoked", simulated locally (PO 2026-11-12: do not change the
// test version's mail settings). A fake IMAP server on 127.0.0.1 answers like Gmail does when an app password has been
// revoked: NO [AUTHENTICATIONFAILED]. The app's real inbox check (ImapFlow) runs against it. Needs openssl on PATH (Git Bash
// has it) for a throwaway certificate. SQLite, throwaway data dir.   node scripts/test-inbound-down.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { setup } from './feedback-harness.mjs';

const t = await setup('inbound-down');
const key = path.join(t.out, 'fake-imap.key'), cert = path.join(t.out, 'fake-imap.crt');
const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { encoding: 'utf8' });
assert.equal(made.status, 0, 'openssl: ' + made.stderr);

const seen = [];
const server = tls.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, socket => {
  socket.write('* OK [CAPABILITY IMAP4rev1] Fake Gmail ready\r\n');
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk; let i;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      const [tag, command = ''] = line.split(' ');
      seen.push(command.toUpperCase());
      if (/^(LOGIN|AUTHENTICATE)$/i.test(command)) socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
      else if (/^CAPABILITY$/i.test(command)) socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK Success\r\n`);
      else if (/^LOGOUT$/i.test(command)) { socket.write(`* BYE Logging out\r\n${tag} OK Success\r\n`); socket.end(); }
      else socket.write(`${tag} OK Success\r\n`);
    }
  });
  socket.on('error', () => {});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the throwaway certificate only; this process talks to nothing else
Object.assign(process.env, { RMC2_MAIL_MODE: 'smtp', RMC2_SMTP_USER: 'franchising@example.test', RMC2_SMTP_APP_PASSWORD: 'revoked-app-password', RMC2_IMAP_HOST: '127.0.0.1', RMC2_IMAP_PORT: String(port) });
const inbound = await t.load('inbound');
const head = t.user('emerson');

try {
  const first = await inbound.checkInbox().then(() => null, e => e);
  assert.ok(first, 'the check must fail');
  assert.equal(first.status, 503);
  assert.match(first.message, /refused the sign-in.*app password may have been revoked/i);
  assert.ok(seen.includes('LOGIN') || seen.includes('AUTHENTICATE'), 'the app really tried to sign in: ' + seen.join(','));
  assert.ok(!/revoked-app-password|franchising@example/.test(first.message), 'no credentials in the message');
  t.pass('A revoked app password: "Check mail now" answers 503 "The inbox refused the sign-in. The app password may have been revoked or changed." with no credentials in it');

  let health = (await inbound.listInbound(head)).health;
  assert.equal(health.failures, 1); assert.match(health.lastError, /refused the sign-in/);
  t.pass('Requests receives the health record for its warning: 1 failure, the reason and the time');

  for (let i = 0; i < 3; i++) await inbound.checkInbox().catch(() => {});
  health = (await inbound.listInbound(head)).health;
  assert.equal(health.failures, 4);
  assert.equal(inbound.backoffMs(health.failures), 10 * 60000);
  assert.equal(await inbound.claimInboxCheck(), false, 'automatic checks wait while the inbox keeps failing');
  const manual = await inbound.checkInbox().then(() => null, e => e);
  assert.equal(manual?.status, 503, '"Check mail now" still tries');
  t.pass('After 4 failures in a row the automatic check waits 10 minutes; "Check mail now" still tries (503 again, failures counted)');

  server.close();
  const down = await inbound.checkInbox().then(() => null, e => e);
  assert.equal(down?.status, 503); assert.match(down.message, /could not be reached/);
  t.pass('With the inbox down altogether the reason changes to "The inbox could not be reached."');
} finally { server.close(); }
console.log(t.checks.length + ' checks passed');
