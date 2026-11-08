// Security review 2026-11-09 (inbound email): who counts as a verified sender. Only DMARC pass aligned with the From
// domain qualifies; SPF + DKIM pass for some other domain does not; sender-controlled text cannot fake a result.
//   node scripts/test-inbound-auth.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('inbound-auth');
const inbound = await t.load('inbound');
const read = inbound.readAuthResults, ok = auth => inbound.senderVerified(auth);

// A real Gmail-style header from an agent whose domain publishes DMARC.
const genuine = 'mx.google.com; dkim=pass header.i=@agency.example header.s=s1 header.b=AbC; spf=pass (google.com: domain of agent@agency.example designates 1.2.3.4 as permitted sender) smtp.mailfrom=agent@agency.example; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=agency.example';
const g = read(genuine, 'agent@agency.example');
assert.deepEqual(g, { spf: 'pass', dkim: 'pass', dmarc: 'pass', aligned: true }); assert.equal(ok(g), true);
t.pass('Genuine agent mail: DMARC pass aligned with the From domain is verified');

// The attack from the review: attacker owns evil.example (valid SPF/DKIM) and puts From: agent@agency.example.
const forged = 'mx.google.com; dkim=pass header.i=@evil.example header.s=s1 header.b=XyZ; spf=pass (google.com: domain of x@evil.example designates 5.6.7.8 as permitted sender) smtp.mailfrom=x@evil.example; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=agency.example';
const f = read(forged, 'agent@agency.example');
assert.equal(f.spf, 'pass'); assert.equal(f.dkim, 'pass'); assert.equal(ok(f), false);
t.pass('SPF and DKIM pass for another domain no longer count as verified');

// Sender-controlled text placing "dmarc=pass" before the real result.
const tricked = 'mx.google.com; spf=pass (google.com: domain of x.dmarc=pass@evil.example designates 5.6.7.8 as permitted sender) smtp.mailfrom=x.dmarc=pass@evil.example; dmarc=fail header.from=agency.example';
const tr = read(tricked, 'agent@agency.example');
assert.equal(tr.dmarc, 'fail'); assert.equal(ok(tr), false);
t.pass('A fake "dmarc=pass" inside sender text is ignored');

// DMARC pass, but for a different From domain than the message shows.
const other = read('mx.google.com; dmarc=pass header.from=evil.example', 'agent@agency.example');
assert.equal(other.aligned, false); assert.equal(ok(other), false);
t.pass('DMARC pass for a different domain is not aligned');

// No header, no proof; and records stored before this change (no "aligned") never qualify.
assert.equal(ok(read('', 'agent@agency.example')), false);
assert.equal(ok({ spf: 'pass', dkim: 'pass', dmarc: 'pass' }), false);
t.pass('Missing header, and older records without the alignment flag, are not verified');
console.log(t.checks.length + ' checks passed');
