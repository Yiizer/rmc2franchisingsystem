import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, db, hashPassword, transaction } from './database';
import { isAppError } from './errors';
import { canManageDivisionSoas } from './permissions';
import { checkRate, clearAttempts, phoneField, securityEvent, unique, username, verifyCurrent } from './accounts';
import type { Staff, TeamMember } from './types';

// A Division Head manages the SOAs of their OWN division (feedback round 2026-11-07, item 5). Every function re-reads the acting user from the database:
// they must still be an active Division Head with a division. The target must be an SOA of that same division; anything else (another division,
// another role, an unknown id) gets the SAME 403, so the answer never tells whether an account exists.
// Create, deactivate and reset need the Division Head's own password again, as for the Head's account actions.
const DENIED = 'You can only manage the SOAs of your own division.';
const member = (person: Staff): TeamMember => ({ id: person.id, name: person.name, email: person.email, username: person.username, position: person.position, phone: person.phone, active: person.active, mustChangePassword: person.mustChangePassword, division: person.division });

async function actingHead(session: Staff): Promise<Staff & { division: string }> {
  if (!canManageDivisionSoas(session)) throw new AppError(DENIED, 403);
  const row = await db.get<{ data: string }>('SELECT data FROM users WHERE id=?', session.id);
  const fresh = row ? JSON.parse(row.data) as Staff : undefined;
  if (!fresh || !fresh.active || !canManageDivisionSoas(fresh) || !fresh.division) throw new AppError(DENIED, 403);
  return fresh as Staff & { division: string };
}
async function ownSoa(head: Staff & { division: string }, id: unknown): Promise<Staff> {
  const rows = await db.all<{ data: string }>('SELECT data FROM users');
  const target = typeof id === 'string' ? rows.map(row => JSON.parse(row.data) as Staff).find(person => person.id === id) : undefined;
  if (!target || target.role !== 'SOA' || target.division !== head.division) throw new AppError(DENIED, 403);
  return target;
}
const passwordBody = z.object({ currentPassword: z.string().min(1).max(200) });

export async function listTeam(session: Staff): Promise<{ division: string; members: TeamMember[] }> {
  const head = await actingHead(session);
  const rows = await db.all<{ data: string }>('SELECT data FROM users');
  const members = rows.map(row => JSON.parse(row.data) as Staff).filter(person => person.role === 'SOA' && person.division === head.division).map(member).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  return { division: head.division, members };
}
/** Role is forced to SOA and the division to the Division Head's; any role/division/canApprove in the body is ignored. */
export async function createSoa(session: Staff, input: unknown) {
  const head = await actingHead(session);
  const body = z.object({ name: z.string().trim().min(2).max(100), username, email: z.string().trim().email().max(254), position: z.string().trim().max(200), phone: phoneField.optional(), currentPassword: z.string().min(1).max(200) }).parse(input);
  await checkRate('team-create:' + head.id); // counted whether or not the password is right (the shared limit: 8 attempts per 15 minutes per Division Head)
  await verifyCurrent(head, body.currentPassword);
  return await transaction(async () => {
    await db.lock('users-admin');
    await actingHead(session); // still an active Division Head once the account lock is held
    // One generic answer: a Division Head must not learn which usernames or emails exist elsewhere.
    try { await unique(body.username); await unique(body.email); } catch (error) { if (isAppError(error) && error.status === 409) throw new AppError('Choose a different username or email.', 409); throw error; }
    const temporaryPassword = randomBytes(18).toString('base64url');
    const person: Staff = { id: randomUUID(), name: body.name, username: body.username, email: body.email.toLowerCase(), role: 'SOA', position: body.position, canApprove: false, active: true, mustChangePassword: true, division: head.division, ...(body.phone ? { phone: body.phone } : {}) };
    await db.run('INSERT INTO users (id,data,password) VALUES (?,?,?)', person.id, JSON.stringify(person), await hashPassword(temporaryPassword));
    await securityEvent(head, 'Created SOA account ' + person.id + ' in ' + head.division);
    return { user: member(person), temporaryPassword };
  });
}
/** Deactivate only (PO Q8): the Head reactivates. Ends the SOA's sessions the same way the Head's deactivation does. */
export async function deactivateSoa(session: Staff, id: string, input: unknown) {
  const head = await actingHead(session);
  const body = passwordBody.parse(input);
  await verifyCurrent(head, body.currentPassword);
  return await transaction(async () => {
    await db.lock('users-admin');
    await actingHead(session);
    const target = await ownSoa(head, id), updated: Staff = { ...target, active: false };
    await db.run('UPDATE users SET data=? WHERE id=?', JSON.stringify(updated), target.id);
    await db.run('DELETE FROM sessions WHERE user_id=?', target.id); await db.run('DELETE FROM inquiry_activity WHERE user_id=?', target.id);
    await securityEvent(head, 'Deactivated SOA account ' + target.id + ' in ' + head.division);
    return { user: member(updated) };
  });
}
/** One-time temporary password; signs the SOA out everywhere and clears a sign-in lockout. */
export async function resetSoaPassword(session: Staff, id: string, input: unknown) {
  const head = await actingHead(session);
  const body = passwordBody.parse(input);
  await verifyCurrent(head, body.currentPassword);
  return await transaction(async () => {
    await db.lock('users-admin');
    await actingHead(session);
    const target = await ownSoa(head, id), temporaryPassword = randomBytes(18).toString('base64url'), updated: Staff = { ...target, mustChangePassword: true };
    await db.run('UPDATE users SET data=?,password=? WHERE id=?', JSON.stringify(updated), await hashPassword(temporaryPassword), target.id);
    await db.run('DELETE FROM sessions WHERE user_id=?', target.id); await db.run('DELETE FROM inquiry_activity WHERE user_id=?', target.id);
    await clearAttempts(target);
    await securityEvent(head, 'Reset password and signed out SOA ' + target.id + ' in ' + head.division);
    return { temporaryPassword };
  });
}
