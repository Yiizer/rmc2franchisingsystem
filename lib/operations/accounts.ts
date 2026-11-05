import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { allUsers, AppError, db, passwordHash, passwordMatches, tokenHash, transaction } from './database';
import type { Staff } from './types';
import { DIVISIONS, STAFF_ROLES, canApproveProposal, canBeApprover, canManageAccounts, canResetPassword, isOwnerScoped } from './permissions';

export async function securityEvent(user:Staff,action:string){await db.run('INSERT INTO security_events (id,at,actor_id,action) VALUES (?,?,?,?)',randomUUID(),new Date().toISOString(),user.id,action);}
const username=z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,'Use letters, numbers, dots, dashes or underscores.').transform(value=>value.toLowerCase());
const newPassword=z.string().min(14,'Use at least 14 characters.').max(200).refine(value=>!['Rmc2Local!2026','passwordpassword','12345678901234'].includes(value),'Choose a unique password.');
async function unique(login:string,except?:string){if((await allUsers()).some(user=>user.id!==except&&[user.username||user.id,user.email].some(value=>value.toLowerCase()===login.toLowerCase())))throw new AppError('That username or email is already in use.',409);}
const RATE_WINDOW_MS=15*60000,RATE_MAX_ATTEMPTS=8;
// Counts this attempt BEFORE the password is checked, in one atomic statement (INSERT ... ON CONFLICT DO UPDATE ... RETURNING,
// the same on SQLite and Postgres), so parallel guesses cannot all slip through a check-then-record gap: at most
// RATE_MAX_ATTEMPTS attempts per window are ever verified, the next one gets 429 and the block lasts 15 minutes.
// The window restarts 15 minutes after its first attempt; a successful sign-in deletes the row.
export async function checkRate(key:string){
  const now=Date.now(),W=RATE_WINDOW_MS;
  const row=await db.get<{blocked_until:number}>(`INSERT INTO auth_attempts (key,failures,window_start,blocked_until) VALUES (?,1,CAST(? AS BIGINT),0)
    ON CONFLICT(key) DO UPDATE SET
      failures=CASE WHEN auth_attempts.blocked_until>CAST(? AS BIGINT) THEN auth_attempts.failures WHEN CAST(? AS BIGINT)-auth_attempts.window_start>${W} THEN 1 ELSE auth_attempts.failures+1 END,
      window_start=CASE WHEN auth_attempts.blocked_until<=CAST(? AS BIGINT) AND CAST(? AS BIGINT)-auth_attempts.window_start>${W} THEN CAST(? AS BIGINT) ELSE auth_attempts.window_start END,
      blocked_until=CASE WHEN auth_attempts.blocked_until>CAST(? AS BIGINT) THEN auth_attempts.blocked_until
        WHEN CAST(? AS BIGINT)-auth_attempts.window_start>${W} THEN 0
        WHEN auth_attempts.failures+1>${RATE_MAX_ATTEMPTS} THEN CAST(? AS BIGINT)+${W} ELSE 0 END
    RETURNING blocked_until`,key,now,now,now,now,now,now,now,now,now);
  if(row&&Number(row.blocked_until)>now)throw new AppError('Too many attempts. Wait 15 minutes before trying again.',429);
}
export async function authenticate(input:unknown){
  const body=z.object({email:z.string().trim().min(1).max(254),password:z.string().min(1).max(200)}).strict().parse(input);
  const key='login:'+tokenHash(body.email.toLowerCase());await checkRate(key);
  const row=(await db.all('SELECT data,password FROM users') as {data:string;password:string}[]).find(row=>{const user:Staff=JSON.parse(row.data);return [user.email,user.username||user.id].some(value=>value.toLowerCase()===body.email.toLowerCase());});
  // Constant-cost password verification also applies to unknown usernames.
  const fallback='00000000000000000000000000000000:'+ '00'.repeat(64);
  const valid=passwordMatches(body.password,row?.password||fallback);
  if(!row||!valid||!JSON.parse(row.data).active){throw new AppError('The username or password is incorrect.',401);}
  await db.run('DELETE FROM auth_attempts WHERE key=?',key);return JSON.parse(row.data) as Staff;
}
async function verifyCurrent(user:Staff,password:string){
  const key='settings:'+user.id;await checkRate(key);
  const row=await db.get('SELECT password FROM users WHERE id=?',user.id) as {password:string};
  if(!passwordMatches(password,row.password)){throw new AppError('Your current password is incorrect.',403);}
  await db.run('DELETE FROM auth_attempts WHERE key=?',key);
}
export async function updateOwnAccount(user:Staff,input:unknown){
  const body=z.object({username,currentPassword:z.string().min(1).max(200),password:newPassword.optional()}).strict().parse(input);
  await verifyCurrent(user,body.currentPassword);
  if(user.mustChangePassword&&!body.password)throw new AppError('Set a new password to finish activating your account.');
  if(body.password===body.currentPassword)throw new AppError('Choose a different password from the current one.');
  return await transaction(async()=>{
    await db.lock('users-admin'); // usernames/emails stay unique when two edits land together
    // Build on the stored record, not the session copy: an admin may have changed role/access or deactivated the account meanwhile.
    const row=await db.get<{data:string}>('SELECT data FROM users WHERE id=?',user.id);const current=row?JSON.parse(row.data) as Staff:undefined;
    if(!current?.active)throw new AppError('This account is no longer active.',403);
    await unique(body.username,user.id);const updated={...current,username:body.username,mustChangePassword:false};
    await db.run('UPDATE users SET data=? WHERE id=?',JSON.stringify(updated),user.id);
    if(body.password)await db.run('UPDATE users SET password=? WHERE id=?',passwordHash(body.password),user.id);
    await db.run('DELETE FROM sessions WHERE user_id=?',user.id);
    await db.run('DELETE FROM inquiry_activity WHERE user_id=?',user.id);
    await securityEvent(user,'Changed own account credentials; all sessions revoked');return updated;
  });
}
const divisionField=z.enum(DIVISIONS);
const phoneField=z.string().trim().max(40).regex(/^[0-9+(). -]*$/,'Use digits, spaces and + ( ) - . only.');
function roleFields(role:Staff['role'],division:string|undefined,canApprove:boolean){
  if(isOwnerScoped({role})&&!division)throw new AppError('Choose a division for a Division Head or SOA account.',400);
  return {division:isOwnerScoped({role})?division:undefined,canApprove:role==='Head'||(canBeApprover(role)&&canApprove)};
}
/** Head only. Admins keep password reset and unlock, not account management. */
export async function createAccount(user:Staff,input:unknown){
  if(!canManageAccounts(user))throw new AppError('Only the Head can manage accounts.',403);
  const body=z.object({name:z.string().trim().min(2).max(100),username,email:z.string().trim().email().max(254),role:z.enum(STAFF_ROLES),position:z.string().trim().max(200),canApprove:z.boolean(),division:divisionField.optional(),phone:phoneField.optional(),currentPassword:z.string().min(1).max(200)}).strict().parse(input);
  const extra=roleFields(body.role,body.division,body.canApprove);
  await verifyCurrent(user,body.currentPassword);
  return await transaction(async()=>{
    await db.lock('users-admin');
    await unique(body.username);await unique(body.email);
    const temporaryPassword=randomBytes(18).toString('base64url');
    const person:Staff={id:randomUUID(),name:body.name,username:body.username,email:body.email.toLowerCase(),role:body.role,position:body.position,canApprove:extra.canApprove,active:true,mustChangePassword:true,...(extra.division?{division:extra.division}:{}),...(body.phone?{phone:body.phone}:{})};
    await db.run('INSERT INTO users (id,data,password) VALUES (?,?,?)',person.id,JSON.stringify(person),passwordHash(temporaryPassword));
    await securityEvent(user,'Created staff account '+person.id+' ('+person.role+')');return {user:person,temporaryPassword};
  });
}
/** Head only: role, active, approval flag, division, position, phone. Self-protection and the "at least one approver" rule hold. */
export async function updateAccount(user:Staff,input:unknown){
  if(!canManageAccounts(user))throw new AppError('Only the Head can manage accounts.',403);
  const body=z.object({id:z.string().max(100),active:z.boolean(),role:z.enum(STAFF_ROLES),canApprove:z.boolean(),division:divisionField.nullable().optional(),position:z.string().trim().max(200).optional(),phone:phoneField.nullable().optional()}).strict().parse(input);
  await transaction(async()=>{
    await db.lock('users-admin');
    const users=await allUsers(),target=users.find(u=>u.id===body.id);if(!target)throw new AppError('Staff member not found',404);
    if(body.id===user.id&&(!body.active||body.role!=='Head'))throw new AppError('Keep your current account active as the Head.');
    const extra=roleFields(body.role,body.division===undefined?target.division:body.division??undefined,body.canApprove);
    const {division:_d,phone:_p,...rest}=target;
    const phone=body.phone===undefined?target.phone:body.phone||undefined;
    const updated:Staff={...rest,role:body.role,active:body.active,canApprove:extra.canApprove,...(body.position!==undefined?{position:body.position}:{}),...(extra.division?{division:extra.division}:{}),...(phone?{phone}:{})};
    const after=users.map(u=>u.id===target.id?updated:u);
    if(!after.some(u=>u.active&&canApproveProposal(u)))throw new AppError('Keep at least one active approver.');
    if(!after.some(u=>u.active&&u.role==='Head'))throw new AppError('At least one active Head is required.');
    await db.run('UPDATE users SET data=? WHERE id=?',JSON.stringify(updated),body.id);await db.run('DELETE FROM sessions WHERE user_id=?',body.id);await db.run('DELETE FROM inquiry_activity WHERE user_id=?',body.id);
    await securityEvent(user,'Updated staff account '+body.id+' ('+updated.role+(updated.active?'':', inactive')+')');
  });
  return {ok:true};
}
/** Head and Admin. Sets a one-time temporary password and signs the person out everywhere. An Admin cannot reset the Head or another Admin (that would hand over account management). */
export async function resetPassword(user:Staff,input:unknown){
  if(!canResetPassword(user))throw new AppError('You cannot reset passwords.',403);
  const body=z.object({userId:z.string().max(100),currentPassword:z.string().min(1).max(200)}).strict().parse(input);
  if(body.userId===user.id)throw new AppError('Change your own password in Settings.');
  await verifyCurrent(user,body.currentPassword);
  return await transaction(async()=>{
    await db.lock('users-admin');
    const target=(await allUsers()).find(u=>u.id===body.userId);if(!target)throw new AppError('Staff member not found',404);
    // An Admin holding a reset password could sign in as that person. So an Admin may reset only Employee accounts;
    // approvers (Head, Supervisor) and Division Heads / SOAs, who own clients, are reset by the Head.
    if(user.role==='Admin'&&target.role!=='Employee')throw new AppError('Ask the Head to reset this account.',403);
    const temporaryPassword=randomBytes(18).toString('base64url'),updated:Staff={...target,mustChangePassword:true};
    await db.run('UPDATE users SET data=?,password=? WHERE id=?',JSON.stringify(updated),passwordHash(temporaryPassword),target.id);
    await db.run('DELETE FROM sessions WHERE user_id=?',target.id);await db.run('DELETE FROM inquiry_activity WHERE user_id=?',target.id);
    await clearAttempts(target);
    await securityEvent(user,'Reset password and signed out '+target.id);return {user:updated,temporaryPassword};
  });
}
async function clearAttempts(target:Staff){for(const login of new Set([target.email,target.username||target.id]))await db.run('DELETE FROM auth_attempts WHERE key=?','login:'+tokenHash(login.toLowerCase()));await db.run('DELETE FROM auth_attempts WHERE key=?','settings:'+target.id);}
/** Head and Admin: clears the sign-in lockout (too many wrong passwords) without changing the password. */
export async function unlockAccount(user:Staff,input:unknown){
  if(!canResetPassword(user))throw new AppError('You cannot unlock accounts.',403);
  const body=z.object({userId:z.string().max(100)}).strict().parse(input);
  const target=(await allUsers()).find(u=>u.id===body.userId);if(!target)throw new AppError('Staff member not found',404);
  if(user.role==='Admin'&&(target.role==='Head'||target.role==='Admin'))throw new AppError('Ask the Head to unlock this account.',403);
  await clearAttempts(target);await securityEvent(user,'Unlocked sign-in for '+target.id);return {ok:true};
}
