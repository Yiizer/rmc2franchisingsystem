import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { allUsers, AppError, db, passwordHash, passwordMatches, tokenHash, transaction } from './database';
import type { Staff } from './types';

export async function securityEvent(user:Staff,action:string){await db.run('INSERT INTO security_events VALUES (?,?,?,?)',randomUUID(),new Date().toISOString(),user.id,action);}
const username=z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,'Use letters, numbers, dots, dashes or underscores.').transform(value=>value.toLowerCase());
const newPassword=z.string().min(14,'Use at least 14 characters.').max(200).refine(value=>!['Rmc2Local!2026','passwordpassword','12345678901234'].includes(value),'Choose a unique password.');
async function unique(login:string,except?:string){if((await allUsers()).some(user=>user.id!==except&&[user.username||user.id,user.email].some(value=>value.toLowerCase()===login.toLowerCase())))throw new AppError('That username or email is already in use.',409);}
export async function checkRate(key:string){
  const row=await db.get('SELECT blocked_until FROM auth_attempts WHERE key=?',key) as {blocked_until:number}|undefined;
  if(row&&row.blocked_until>Date.now())throw new AppError('Too many attempts. Wait 15 minutes before trying again.',429);
}
async function failed(key:string){
  // Read-modify-write of the attempt counter: one failure at a time so parallel guesses are all counted.
  await transaction(async()=>{
  const now=Date.now(),row=await db.get('SELECT failures,window_start FROM auth_attempts WHERE key=?',key) as {failures:number;window_start:number}|undefined;
  const fresh=!row||now-row.window_start>15*60000,count=fresh?1:row.failures+1;
  await db.run('INSERT OR REPLACE INTO auth_attempts VALUES (?,?,?,?)',key,count,fresh?now:row!.window_start,count>=8?now+15*60000:0);
  });
}
export async function authenticate(input:unknown){
  const body=z.object({email:z.string().trim().min(1).max(254),password:z.string().min(1).max(200)}).strict().parse(input);
  const key='login:'+tokenHash(body.email.toLowerCase());await checkRate(key);
  const row=(await db.all('SELECT data,password FROM users') as {data:string;password:string}[]).find(row=>{const user:Staff=JSON.parse(row.data);return [user.email,user.username||user.id].some(value=>value.toLowerCase()===body.email.toLowerCase());});
  // Constant-cost password verification also applies to unknown usernames.
  const fallback='00000000000000000000000000000000:'+ '00'.repeat(64);
  const valid=passwordMatches(body.password,row?.password||fallback);
  if(!row||!valid||!JSON.parse(row.data).active){await failed(key);throw new AppError('The username or password is incorrect.',401);}
  await db.run('DELETE FROM auth_attempts WHERE key=?',key);return JSON.parse(row.data) as Staff;
}
async function verifyCurrent(user:Staff,password:string){
  const key='settings:'+user.id;await checkRate(key);
  const row=await db.get('SELECT password FROM users WHERE id=?',user.id) as {password:string};
  if(!passwordMatches(password,row.password)){await failed(key);throw new AppError('Your current password is incorrect.',403);}
  await db.run('DELETE FROM auth_attempts WHERE key=?',key);
}
export async function updateOwnAccount(user:Staff,input:unknown){
  const body=z.object({username,currentPassword:z.string().min(1).max(200),password:newPassword.optional()}).strict().parse(input);
  await verifyCurrent(user,body.currentPassword);
  if(user.mustChangePassword&&!body.password)throw new AppError('Set a new password to finish activating your account.');
  if(body.password===body.currentPassword)throw new AppError('Choose a different password from the current one.');
  return await transaction(async()=>{
    await unique(body.username,user.id);const updated={...user,username:body.username,mustChangePassword:false};
    await db.run('UPDATE users SET data=? WHERE id=?',JSON.stringify(updated),user.id);
    if(body.password)await db.run('UPDATE users SET password=? WHERE id=?',passwordHash(body.password),user.id);
    await db.run('DELETE FROM sessions WHERE user_id=?',user.id);
    await db.run('DELETE FROM inquiry_activity WHERE user_id=?',user.id);
    await securityEvent(user,'Changed own account credentials; all sessions revoked');return updated;
  });
}
export async function createAccount(user:Staff,input:unknown){
  if(user.role!=='Admin')throw new AppError('Admin access is required.',403);
  const body=z.object({name:z.string().trim().min(2).max(100),username,email:z.string().trim().email().max(254),role:z.enum(['Employee','Supervisor','Admin']),position:z.string().trim().max(200),canApprove:z.boolean(),currentPassword:z.string().min(1).max(200)}).strict().parse(input);
  await verifyCurrent(user,body.currentPassword);
  return await transaction(async()=>{
    await unique(body.username);await unique(body.email);
    const temporaryPassword=randomBytes(18).toString('base64url');
    const person:Staff={id:randomUUID(),name:body.name,username:body.username,email:body.email.toLowerCase(),role:body.role,position:body.position,canApprove:body.role==='Supervisor'&&body.canApprove,active:true,mustChangePassword:true};
    await db.run('INSERT INTO users VALUES (?,?,?)',person.id,JSON.stringify(person),passwordHash(temporaryPassword));
    await securityEvent(user,'Created staff account '+person.id+' ('+person.role+')');return {user:person,temporaryPassword};
  });
}
