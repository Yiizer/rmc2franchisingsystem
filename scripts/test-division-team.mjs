// Feedback round 2026-11-07, item 5: a Division Head manages the SOAs of their own division. SQLite, throwaway data dir.
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('division-team');
const [team, accounts, guard, perm] = await Promise.all(['division-team', 'accounts', 'scope-guard', 'permissions'].map(t.load));
const PW = t.PASSWORD, db = t.db;
const head = t.user('emerson'), dhA = t.user('division-head'), soaA = t.user('soa');
const same403 = async (promise, label) => { try { await promise; assert.fail(label + ' should have been refused'); } catch (error) { assert.equal(error.status, 403, label); return error.message; } };

// A second Division Head in another division, and an SOA in that division, made by the Head.
const made = await accounts.createAccount(head, { name: 'Division Head Two', username: 'dh.two', email: 'dh.two@rmc2.local', role: 'DivisionHead', position: 'Division Head', canApprove: false, division: 'Division 2', currentPassword: PW });
const dhB = (await t.database.allUsers()).find(u => u.id === made.user.id);
const soaB = (await accounts.createAccount(head, { name: 'SOA Two', username: 'soa.two', email: 'soa.two@rmc2.local', role: 'SOA', position: 'SOA', canApprove: false, division: 'Division 2', currentPassword: PW })).user;
const events = async () => (await db.all('SELECT action FROM security_events')).map(row => row.action);

// ---------- 1. Permission ----------
{
  for (const [role, expected] of [['Head', false], ['Supervisor', false], ['Employee', false], ['DivisionHead', true], ['SOA', false], ['Admin', false]])assert.equal(perm.canManageDivisionSoas({ role }), expected, role);
  assert.equal(perm.canManageAccounts({ role: 'DivisionHead' }), false, 'the Head-only account permissions are unchanged');
  assert.equal(perm.canResetPassword({ role: 'DivisionHead' }), false);
  t.pass('canManageDivisionSoas is Division Head only; canManageAccounts / canResetPassword are unchanged');
}

// ---------- 2. List ----------
{
  const mine = await team.listTeam(dhA);
  assert.equal(mine.division, 'Division 4');
  assert.deepEqual(mine.members.map(m => m.id), [soaA.id]);
  assert.equal(mine.members[0].name, soaA.name);
  assert.equal(JSON.stringify(mine).toLowerCase().includes('password'), false, 'no password material in the list');
  assert.equal('role' in mine.members[0] || 'canApprove' in mine.members[0], false, 'TeamMember carries no role or approval flag');
  assert.deepEqual((await team.listTeam(dhB)).members.map(m => m.id), [soaB.id], 'each Division Head sees only their own division');
  t.pass('listTeam shows only the SOAs of the Division Head’s own division');
}

// ---------- 3. Create ----------
let createdSoa, firstTemp;
{
  assert.equal(await t.status(team.createSoa(dhA, { name: 'New SOA', username: 'new.soa', email: 'new.soa@rmc2.local', position: 'SOA', currentPassword: 'wrong-password-1' })), 403, 'a wrong password is refused');
  assert.equal(await t.status(team.createSoa(dhA, { name: 'x', username: 'new.soa', email: 'bad', position: 'SOA', currentPassword: PW })), 400);
  const result = await team.createSoa(dhA, { name: 'New SOA', username: 'New.Soa', email: 'New.SOA@rmc2.local', position: 'SOA Division 4', phone: '09175551234', currentPassword: PW, role: 'Head', division: 'Division 2', canApprove: true, active: false });
  createdSoa = result.user; firstTemp = result.temporaryPassword;
  assert.equal(createdSoa.division, 'Division 4', 'a division in the body is ignored');
  assert.equal((await t.database.allUsers()).find(u => u.id === createdSoa.id).role, 'SOA', 'the role is forced to SOA');
  const stored = (await t.database.allUsers()).find(u => u.id === createdSoa.id);
  assert.equal(stored.canApprove, false); assert.equal(stored.active, true); assert.equal(stored.mustChangePassword, true);
  assert.equal(stored.email, 'new.soa@rmc2.local'); assert.equal(stored.username, 'new.soa');
  assert.ok(typeof firstTemp === 'string' && firstTemp.length >= 14);
  assert.equal(JSON.stringify(result.user).includes(firstTemp), false);
  assert.equal((await accounts.authenticate({ email: 'new.soa', password: firstTemp })).id, createdSoa.id, 'the temporary password signs the new SOA in');
  const clash1 = await team.createSoa(dhA, { name: 'Dup', username: 'new.soa', email: 'dup@rmc2.local', position: 'SOA', currentPassword: PW }).catch(e => e);
  const clash2 = await team.createSoa(dhA, { name: 'Dup', username: 'dup.user', email: 'new.soa@rmc2.local', position: 'SOA', currentPassword: PW }).catch(e => e);
  assert.equal(clash1.status, 409); assert.equal(clash2.status, 409);
  assert.equal(clash1.message, 'Choose a different username or email.'); assert.equal(clash2.message, clash1.message, 'one generic message for both');
  const headClash = await accounts.createAccount(head, { name: 'Dup', username: 'new.soa', email: 'x@rmc2.local', role: 'SOA', position: 'x', canApprove: false, division: 'Division 4', currentPassword: PW }).catch(e => e);
  assert.equal(headClash.message, 'That username or email is already in use.', 'the Head\u2019s own message is unchanged');
  assert.deepEqual((await team.listTeam(dhA)).members.map(m => m.id).sort(), [soaA.id, createdSoa.id].sort());
  assert.ok((await events()).some(a => a.startsWith('Created SOA account ' + createdSoa.id)));
  t.pass('createSoa: role SOA and the Division Head’s division are forced (body ignored), password re-check, unique username/email, temporary password works, audited');
}

// ---------- 3b. Create is rate limited per Division Head, counted with a wrong password too ----------
{
  let refused = 0;
  for (let i = 0; i < 10; i++) { const out = await t.status(team.createSoa(dhB, { name: 'Flood ' + i, username: 'flood.' + i, email: 'flood' + i + '@rmc2.local', position: 'SOA', currentPassword: 'wrong-password-1' })); if (out === 429) refused++; else assert.equal(out, 403); }
  assert.ok(refused >= 1, 'wrong-password guesses on my-team/create run into the limit');
  assert.equal(await t.status(team.createSoa(dhB, { name: 'Late', username: 'late.soa', email: 'late@rmc2.local', position: 'SOA', currentPassword: made.temporaryPassword })), 429, 'even the right password is refused once the limit is hit');
  await db.run("DELETE FROM auth_attempts WHERE key=?", 'team-create:' + dhB.id); await db.run("DELETE FROM auth_attempts WHERE key=?", 'settings:' + dhB.id);
  t.pass('my-team/create is rate limited per Division Head; a clash returns the generic 409');
}

// ---------- 4. Deactivate / reset: same-division SOAs only, one identical 403 for everything else ----------
{
  const attempts = [
    ['an SOA of another division', () => team.deactivateSoa(dhA, soaB.id, { currentPassword: PW })],
    ['a Supervisor', () => team.deactivateSoa(dhA, t.user('zeo').id, { currentPassword: PW })],
    ['a Division Head', () => team.deactivateSoa(dhA, dhB.id, { currentPassword: PW })],
    ['the Head', () => team.deactivateSoa(dhA, head.id, { currentPassword: PW })],
    ['an unknown id', () => team.deactivateSoa(dhA, 'no-such-user', { currentPassword: PW })],
    ['an SOA of another division (reset)', () => team.resetSoaPassword(dhA, soaB.id, { currentPassword: PW })],
    ['a Supervisor (reset)', () => team.resetSoaPassword(dhA, t.user('zeo').id, { currentPassword: PW })],
    ['an unknown id (reset)', () => team.resetSoaPassword(dhA, 'no-such-user', { currentPassword: PW })],
    ['own account', () => team.deactivateSoa(dhA, dhA.id, { currentPassword: PW })],
    ['the other Division Head acting on Division 4 SOA', () => team.deactivateSoa(dhB, soaA.id, { currentPassword: made.temporaryPassword })],
    ['the other Division Head resetting Division 4 SOA', () => team.resetSoaPassword(dhB, createdSoa.id, { currentPassword: made.temporaryPassword })],
  ];
  const messages = new Set();
  for (const [label, run] of attempts)messages.add(await same403(run(), label));
  assert.equal(messages.size, 1, 'every failure carries the same message: ' + [...messages].join(' | '));
  assert.equal(await t.status(team.deactivateSoa(dhA, 123, { currentPassword: PW })), 403, 'a non-string id is the same 403');
  // nothing changed on the refused attempts
  const all = await t.database.allUsers();
  assert.equal(all.find(u => u.id === soaB.id).active, true); assert.equal(all.find(u => u.id === 'zeo').active, true);
  t.pass('Cross-division, non-SOA and unknown targets all get the identical 403 and change nothing');
}

// ---------- 5. Every route/service refuses everyone who is not a Division Head ----------
{
  for (const who of [soaA, t.user('zeo'), t.user('cryssa'), head, t.user('admin')]) {
    const body = { currentPassword: PW };
    assert.equal(await t.status(team.listTeam(who)), 403, who.id + ' list');
    assert.equal(await t.status(team.createSoa(who, { name: 'Nope', username: 'nope.x', email: 'nope@rmc2.local', position: 'x', currentPassword: PW })), 403, who.id + ' create');
    assert.equal(await t.status(team.deactivateSoa(who, createdSoa.id, body)), 403, who.id + ' deactivate');
    assert.equal(await t.status(team.resetSoaPassword(who, createdSoa.id, body)), 403, who.id + ' reset');
  }
  // a stale session object cannot outlive a deactivation or a demotion: the acting user is re-read from the database
  await db.run('UPDATE users SET data=? WHERE id=?', JSON.stringify({ ...dhB, active: false }), dhB.id);
  assert.equal(await t.status(team.listTeam(dhB)), 403, 'an inactive Division Head (stale session copy)');
  const { division: _gone, ...noDivision } = dhB;
  await db.run('UPDATE users SET data=? WHERE id=?', JSON.stringify(noDivision), dhB.id);
  assert.equal(await t.status(team.listTeam(dhB)), 403, 'a Division Head without a division');
  await db.run('UPDATE users SET data=? WHERE id=?', JSON.stringify(dhB), dhB.id);
  assert.equal(await t.status(team.listTeam(dhB)), 200);
  t.pass('SOA, Supervisor, Employee, Head and Admin get 403 on all four operations; the acting user is re-read from the database');
}

// ---------- 6. Reset password ----------
{
  assert.equal(await t.status(team.resetSoaPassword(dhA, createdSoa.id, { currentPassword: 'wrong-password-1' })), 403);
  const token = 'tok-new-soa';
  await db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)', token, createdSoa.id, new Date(Date.now() + 3600000).toISOString());
  const { temporaryPassword } = await team.resetSoaPassword(dhA, createdSoa.id, { currentPassword: PW });
  assert.notEqual(temporaryPassword, firstTemp);
  assert.equal(await db.get('SELECT token FROM sessions WHERE user_id=?', createdSoa.id), undefined, 'reset signs the SOA out everywhere');
  assert.equal(await t.status(accounts.authenticate({ email: 'new.soa', password: firstTemp })), 401, 'the old password stops working');
  assert.equal((await accounts.authenticate({ email: 'new.soa', password: temporaryPassword })).mustChangePassword, true);
  assert.ok((await events()).some(a => a.startsWith('Reset password and signed out SOA ' + createdSoa.id)));
  t.pass('resetSoaPassword: password re-check, new temporary password, sessions ended, old password dead, audited');
}

// ---------- 7. Deactivate ----------
{
  assert.equal(await t.status(team.deactivateSoa(dhA, createdSoa.id, { currentPassword: 'wrong-password-1' })), 403);
  assert.equal((await t.database.allUsers()).find(u => u.id === createdSoa.id).active, true, 'a wrong password changes nothing');
  await db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)', 'tok-new-soa-2', createdSoa.id, new Date(Date.now() + 3600000).toISOString());
  const out = await team.deactivateSoa(dhA, createdSoa.id, { currentPassword: PW });
  assert.equal(out.user.active, false);
  assert.equal(await db.get('SELECT token FROM sessions WHERE user_id=?', createdSoa.id), undefined, 'deactivation ends the target’s sessions');
  assert.equal(await t.status(accounts.authenticate({ email: 'new.soa', password: 'anything-at-all-123' })), 401);
  assert.equal((await team.listTeam(dhA)).members.find(m => m.id === createdSoa.id).active, false, 'the member stays listed (inactive) so the Head can reactivate');
  assert.ok((await events()).some(a => a.startsWith('Deactivated SOA account ' + createdSoa.id)));
  // There is no reactivate for a Division Head: the Head does that through updateAccount.
  assert.equal(typeof team.reactivateSoa, 'undefined');
  assert.equal(await t.status(accounts.updateAccount(dhA, { id: createdSoa.id, active: true, role: 'SOA', canApprove: false, currentPassword: PW })), 403);
  assert.equal(await t.status(accounts.updateAccount(head, { id: createdSoa.id, active: true, role: 'SOA', canApprove: false, division: 'Division 4', currentPassword: PW })), 200, 'the Head can reactivate');
  t.pass('deactivateSoa: password re-check, sessions ended, sign-in refused, audited; only the Head can reactivate (Q8)');
}

// ---------- 8. Route whitelist ----------
{
  for (const route of [['my-team']])assert.equal(guard.ownerRouteAllowed('GET', route), true, 'GET ' + route.join('/'));
  for (const route of [['my-team', 'create'], ['my-team', 'abc', 'deactivate'], ['my-team', 'abc', 'reset-password'], ['intake-fields']])assert.equal(guard.ownerRouteAllowed('POST', route), true, 'POST ' + route.join('/'));
  for (const route of [['create-account'], ['reset-password'], ['users'], ['unlock-account'], ['my-team', 'abc'], ['my-team', 'abc', 'activate'], ['my-team', 'create', 'x'], ['my-team', 'abc', 'deactivate', 'x'], ['email-templates'], ['monitoring', 'proposals']])assert.equal(guard.ownerRouteAllowed('POST', route), false, 'POST ' + route.join('/'));
  for (const route of [['monitoring', 'proposals'], ['email-templates'], ['my-team', 'x'], ['users']])assert.equal(guard.ownerRouteAllowed('GET', route), false, 'GET ' + route.join('/'));
  assert.equal(await t.status((async () => guard.assertOwnerScopedRoute(soaA, 'POST', ['create-account']))()), 403);
  t.pass('Whitelist: my-team and intake-fields pass for owner roles; create-account, reset-password, users, email-templates and monitoring stay refused');
}

console.log(t.checks.length + ' checks passed');
