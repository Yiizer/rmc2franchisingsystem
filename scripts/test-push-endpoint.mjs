// Phone-notification subscriptions accept only the browsers' own push services (security review 2026-11-13).
//   node scripts/test-push-endpoint.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('push-endpoint');
const push = await t.load('push-hosts');
for (const ok of ['https://fcm.googleapis.com/fcm/send/abc123', 'https://web.push.apple.com/QGx1', 'https://api.push.apple.com/3/device/x', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'https://wns2-par02p.notify.windows.com/w/?token=x'])
  assert.equal(push.pushHostAllowed(ok), true, ok);
for (const bad of ['http://fcm.googleapis.com/fcm/send/abc', 'https://attacker.example/collect', 'https://fcm.googleapis.com.attacker.example/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://fcm.googleapis.com:8443/x', 'https://pushapple.com/x', 'not a url'])
  assert.equal(push.pushHostAllowed(bad), false, bad);
t.pass('Push endpoints: FCM, Apple, Mozilla and Windows push services are accepted; plain http, other hosts, look-alike hosts, IP addresses, other ports and junk are refused');
console.log(t.checks.length + ' checks passed');
