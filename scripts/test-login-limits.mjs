// REMAINING_WORK §2 security, login limits: per account (not per typed name), per IP, site-wide, pruning, and the
// non-blocking password hash. SQLite, throwaway data dir.   node scripts/test-login-limits.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('login-limits');
const accounts = await t.load('accounts');
const PW = t.PASSWORD, db = t.db, head = t.user('emerson');
const login = (email, password, ip = '') => t.status(accounts.authenticate({ email, password }, ip));
const reset = () => db.run('DELETE FROM auth_attempts');

// 1. Old hashes (made with the sync scrypt at seed time) still verify with the async check.
assert.equal(await login('cryssa', PW), 200); assert.equal(await login('cryssa@rmc2.local', PW), 200);
t.pass('Seeded passwords sign in by username and by email (async check reads the old hash)');

// 2. Per account: wrong guesses by username and by email share one count of 8.
await reset();
for (let i = 0; i < 4; i++) assert.equal(await login('jefferson', 'wrong-' + i), 401);
for (let i = 0; i < 4; i++) assert.equal(await login('JEFFERSON@rmc2.local', 'wrong-e' + i), 401);
assert.equal(await login('jefferson@rmc2.local', PW), 429, 'the 9th attempt on the account is refused even with the right password');
assert.equal(await login('judy', PW), 200, 'another account is not affected');
t.pass('8 wrong guesses split between username and email lock the account; others unaffected');

// 3. Unlock clears the per-account block.
await accounts.unlockAccount(head, { userId: 'jefferson' });
assert.equal(await login('jefferson', PW), 200, 'unlock lets the account sign in again');
t.pass('Unlock account clears the per-account block');

// 4. Per IP: 60 attempts from one address, then refused; another address still works. Success does not reset it.
await reset();
for (let i = 0; i < 59; i++) assert.equal(await login('nobody' + i, 'x', '203.0.113.7'), 401);
assert.equal(await login('zeo', PW, '203.0.113.7'), 200, '60th attempt (a correct one) still allowed');
assert.equal(await login('zeo', PW, '203.0.113.7'), 429, '61st from the same address refused');
assert.equal(await login('zeo', PW, '198.51.100.9'), 200, 'another address is fine');
t.pass('Per-IP limit: 60 attempts per 15 minutes, not reset by a correct password');

// 5. Site-wide: 300 wrong passwords from many addresses and names block every sign-in.
await reset();
for (let i = 0; i < 300; i++) assert.equal(await login('spread' + i, 'x', '10.0.' + Math.floor(i / 50) + '.' + (i % 50)), 401);
assert.equal(await login('cryssa', PW, '192.0.2.1'), 200, 'sign-ins still work at 300 failures');
assert.equal(await login('nobody-final', 'x', '192.0.2.2'), 401, 'the 301st failure is still answered normally');
assert.equal(await login('cryssa', PW, '192.0.2.3'), 429, 'after 301 failures every sign-in waits');
t.pass('Site-wide limit: more than 300 wrong passwords in 15 minutes pauses all sign-ins');

// 6. Pruning drops rows whose window and block are both over, and keeps live ones.
await reset();
const old = Date.now() - 60 * 60000;
await db.run('INSERT INTO auth_attempts (key,failures,window_start,blocked_until) VALUES (?,?,?,?)', 'login:old', 3, old, 0);
await db.run('INSERT INTO auth_attempts (key,failures,window_start,blocked_until) VALUES (?,?,?,?)', 'login:blocked', 9, old, Date.now() + 60000);
await db.run('INSERT INTO auth_attempts (key,failures,window_start,blocked_until) VALUES (?,?,?,?)', 'login:recent', 2, Date.now(), 0);
await accounts.pruneAttempts();
assert.deepEqual((await db.all('SELECT key FROM auth_attempts ORDER BY key')).map(r => r.key), ['login:blocked', 'login:recent']);
t.pass('Pruning removes finished rows only');

// 7. A password set through the app (async hash) signs in, and the old one stops working.
await reset();
const made = await accounts.createAccount(head, { name: 'Limit Check', username: 'limit.check', email: 'limit.check@rmc2.local', role: 'Employee', position: 'Test', canApprove: false, currentPassword: PW });
assert.equal(await login('limit.check', made.temporaryPassword), 200);
const fresh = 'a-long-unique-passphrase-' + Date.now();
await accounts.updateOwnAccount({ ...made.user }, { username: 'limit.check', currentPassword: made.temporaryPassword, password: fresh });
assert.equal(await login('limit.check', fresh), 200); assert.equal(await login('limit.check', made.temporaryPassword), 401);
t.pass('Passwords hashed by the async helper verify; the replaced one is refused');

console.log(t.checks.length + ' checks passed');
