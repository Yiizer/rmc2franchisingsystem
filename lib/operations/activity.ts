import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertClientReady } from './client-service';
import { isClientArchived, isRegistered } from './client-rules';
import { AppError, allUsers, db, inquiry, lockInquiryRows, notify, persist, transaction } from './database';
import { jsonBool, jsonText } from './sql-dialect';
import { canPrepareProposal, canEditInquiry, canTakeOver } from './types';
import type { HandoverRequest, InquiryActivity, InquiryRecord, Staff } from './types';

// The tab keeps heartbeating while hidden (browsers slow hidden timers to about once a minute), so a closed tab frees its lock within this window.
export const ACTIVITY_TTL_MS=180000;
export const RESERVATION_MS=15*60000;
export const HANDOVER_COOLDOWN_MS=5*60000;
const HANDOVER_REQUEST_LIFE_MS=60*60000;
const activitySchema=z.object({tab:z.string().uuid(),action:z.enum(['poll','start','heartbeat','leave','request-handover','dismiss-handover','take-over']),targetUserId:z.string().min(1).max(100).optional()}).strict();
const ACTIVE_STATUSES="('New inquiry','Preparing proposal','Waiting for agent details','Needs correction','Supervisor editing')";

/** Who may take a lock away from its holder (defined in types.ts so the browser shares it). */
export { canTakeOver } from './types';

// The editing lease is separate from saved records: heartbeats must not change revisions,
// contributors, draft timestamps, or the proposal's approval history.
//
// Reading never writes. activeInquiryActivity() returns what pruning would leave behind: current (seen within the TTL,
// on a live session), by an active employee/supervisor, on an inquiry still being worked, one owner per inquiry (the
// earliest), and not archived or held. Housekeeping (pruneActivity) runs on start/leave/heartbeat and, throttled, on polls.
// A live reservation (a supervisor assigned the inquiry to someone who has not opened it yet) owns the inquiry outright.
export async function activeInquiryActivity():Promise<InquiryActivity[]>{
  const now=new Date(),cutoff=new Date(now.getTime()-ACTIVITY_TTL_MS).toISOString();
  const valid=`SELECT a.* FROM inquiry_activity a JOIN inquiries i ON i.id=a.inquiry_id JOIN users u ON u.id=a.user_id
      WHERE a.seen_at>=? AND a.session IN (SELECT token FROM sessions WHERE expires>?)
      AND ${jsonBool(db,'u.data','active')} AND ${jsonText(db,'u.data','role')} IN ('Employee','Supervisor')
      AND ${jsonText(db,'i.data','status')} IN ${ACTIVE_STATUSES}`;
  // The owner of an inquiry is its earliest lease (ties by user id); only that user's rows are reported.
  const owner=db.dialect==='postgres'
    ?`SELECT DISTINCT ON (inquiry_id) inquiry_id,user_id FROM valid ORDER BY inquiry_id,started_at,user_id`
    :`SELECT DISTINCT v.inquiry_id,(SELECT b.user_id FROM valid b WHERE b.inquiry_id=v.inquiry_id ORDER BY b.started_at,b.user_id LIMIT 1) AS user_id FROM valid v`;
  const rows=await db.all<InquiryActivity>(`WITH valid AS (${valid}), owner AS (${owner})
    SELECT v.inquiry_id AS "inquiryId",v.user_id AS "userId",MIN(v.started_at) AS "startedAt",MAX(v.seen_at) AS "seenAt"
    FROM valid v JOIN owner o ON o.inquiry_id=v.inquiry_id AND o.user_id=v.user_id
    GROUP BY v.inquiry_id,v.user_id ORDER BY "startedAt"`,cutoff,now.toISOString());
  const reserved=await db.all<{inquiry_id:string;user_id:string;by_user:string;at:string}>(`SELECT h.inquiry_id,h.user_id,h.by_user,h.at FROM inquiry_handover h JOIN inquiries i ON i.id=h.inquiry_id JOIN users u ON u.id=h.user_id
      WHERE h.kind='reserve' AND h.until_at>=? AND ${jsonBool(db,'u.data','active')} AND ${jsonText(db,'u.data','role')} IN ('Employee','Supervisor')
      AND ${jsonText(db,'i.data','status')} IN ${ACTIVE_STATUSES}`,now.toISOString());
  const held=new Set(reserved.map(row=>row.inquiry_id));
  const all:InquiryActivity[]=[...rows.filter(row=>!held.has(row.inquiryId)),...reserved.map(row=>({inquiryId:row.inquiry_id,userId:row.user_id,startedAt:row.at,seenAt:row.at,reserved:true,reservedBy:row.by_user}))];
  const result:InquiryActivity[]=[];
  for(const row of all){
    const record=await inquiry(row.inquiryId);
    if(isClientArchived(record,now.getTime())||record.clientReview?.state==='duplicate'&&!isRegistered(record))continue;
    result.push(row);
  }
  return result;
}
/** Deletes leases the reader above already ignores. Inside a transaction only; skipped when another request is pruning. */
export async function pruneActivity():Promise<void>{
  if(!await db.tryLock('act-prune'))return;
  const now=new Date().toISOString(),cutoff=new Date(Date.now()-ACTIVITY_TTL_MS).toISOString();
  await db.run('DELETE FROM inquiry_activity WHERE seen_at < ? OR session NOT IN (SELECT token FROM sessions WHERE expires > ?)',cutoff,now);
  await db.run(`DELETE FROM inquiry_activity WHERE user_id NOT IN (SELECT id FROM users WHERE ${jsonBool(db,'data','active')} AND ${jsonText(db,'data','role')} IN ('Employee','Supervisor'))
    OR inquiry_id NOT IN (SELECT id FROM inquiries WHERE ${jsonText(db,'data','status')} IN ${ACTIVE_STATUSES})`);
  await db.run('DELETE FROM inquiry_activity WHERE user_id <> (SELECT b.user_id FROM inquiry_activity b WHERE b.inquiry_id=inquiry_activity.inquiry_id ORDER BY b.started_at,b.user_id LIMIT 1)');
  await db.run(`DELETE FROM inquiry_handover WHERE (kind='reserve' AND until_at < ?) OR (kind='request' AND at < ?)
    OR inquiry_id NOT IN (SELECT id FROM inquiries WHERE ${jsonText(db,'data','status')} IN ${ACTIVE_STATUSES})`,now,new Date(Date.now()-HANDOVER_REQUEST_LIFE_MS).toISOString());
  for(const row of await db.all<{inquiry_id:string}>('SELECT DISTINCT inquiry_id FROM inquiry_activity')){
    const record=await inquiry(row.inquiry_id);
    if(isClientArchived(record,Date.parse(now))||record.clientReview?.state==='duplicate'&&!isRegistered(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);
  }
}
// Polls prune at most this often per process (and only when no other request holds the prune lock).
// Housekeeping only: a failed prune never fails the poll (readers already ignore stale leases); the next poll tries again.
const POLL_PRUNE_MS=10000;
let lastPollPrune=0;
export async function pruneActivityThrottled():Promise<void>{
  if(Date.now()-lastPollPrune<POLL_PRUNE_MS)return;
  lastPollPrune=Date.now();
  try{await transaction(pruneActivity);}catch{console.error('[rmc2] activity prune skipped after an error');}
}

/** The colleague (not this user) who holds or is reserved this inquiry right now, using the same TTL and reservation
 * rules as handling. Used by decline, BOR transfer and client review, which do not require holding the lock themselves
 * but must not act under a colleague (PO decision 2026-11-05). */
export async function colleagueHolding(id:string,user:Pick<Staff,'id'>){
  return (await activeInquiryActivity()).find(row=>row.inquiryId===id&&row.userId!==user.id);
}

export async function requireInquiryHandler(id:string,user:Staff){
  await assertClientReady(await inquiry(id),true);
  if(db.inTransaction())await db.lock('lease:'+id); // a start for this inquiry must not slip in between this check and the caller's commit
  const owner=(await activeInquiryActivity()).find(row=>row.inquiryId===id);
  if(!owner)throw new AppError('Start handling this inquiry before making changes. Your previous handling session may have expired.',423);
  const name=(await allUsers()).find(person=>person.id===owner.userId)?.name||'A colleague';
  // A reservation is not a lease: even the person it was made for must start handling before changing anything.
  if(owner.reserved)throw new AppError(owner.userId===user.id?'This inquiry was assigned to you. Start handling it before making changes.':`${name} has been assigned this inquiry. You can view it, but only the assigned handler can make changes.`,423);
  if(owner.userId!==user.id)throw new AppError(`${name} is handling this inquiry. You can view it, but only the current handler can make changes.`,423);
}

const claimLease=(id:string,user:Staff,session:string,tab:string,now:string)=>db.run(`INSERT INTO inquiry_activity(session,tab,inquiry_id,user_id,started_at,seen_at) VALUES(?,?,?,?,?,?)
  ON CONFLICT(session,tab) DO UPDATE SET inquiry_id=excluded.inquiry_id,user_id=excluded.user_id,
  started_at=CASE WHEN inquiry_activity.inquiry_id=excluded.inquiry_id THEN inquiry_activity.started_at ELSE excluded.started_at END,seen_at=excluded.seen_at`,session,tab,id,user.id,now,now);
const nameOf=(users:Staff[],id:string)=>users.find(person=>person.id===id)?.name||'A colleague';
const label=(record:InquiryRecord)=>record.fields.company||record.id;
// The history entry is added without bumping the revision: a handover must not make everyone's open copy stale.
const logHandover=(record:InquiryRecord,user:Staff,action:string)=>{record.history.push({id:randomUUID(),at:new Date().toISOString(),actorId:user.id,actor:user.name,action});};

export async function updateInquiryActivity(id:string,user:Staff,session:string,input:unknown){
  const body=activitySchema.parse(input);
  return await transaction(async()=>{
    // Take-over writes the inquiry row. Lock it before the lease, as client review and details requests do
    // (row → lease: → idx-sync), so the two paths cannot wait on each other.
    if(body.action==='take-over')await lockInquiryRows([id]);
    await db.lock('lease:'+id); // exclusive handling: start/leave/heartbeat for one inquiry run one at a time
    const record=await inquiry(id),now=new Date().toISOString();
    if(body.action!=='poll')await pruneActivity();
    // Releasing (or starting fresh) answers any open handover requests addressed to this user, so old ones never reappear.
    if(body.action==='leave'||body.action==='start')await db.run("UPDATE inquiry_handover SET state='closed' WHERE kind='request' AND state='open' AND inquiry_id=? AND by_user=?",id,user.id);
    if(body.action==='leave')await db.run('DELETE FROM inquiry_activity WHERE session=? AND tab=? AND inquiry_id=? AND user_id=?',session,body.tab,id,user.id);
    if(body.action==='start'||body.action==='heartbeat'){
      if(!canPrepareProposal(user))throw new AppError('Employee or supervisor access is required.',403);
      if(body.action==='start')await assertClientReady(record,true);
      if(!canEditInquiry(user,record)){
        if(body.action==='start')throw new AppError('This proposal is not available for editing by your account.',403);
        await db.run('DELETE FROM inquiry_activity WHERE session=? AND tab=? AND user_id=?',session,body.tab,user.id);
      }else if(body.action==='start'){
        await assertClientReady(record,true);
        const owner=(await activeInquiryActivity()).find(row=>row.inquiryId===id);
        if(owner&&owner.userId!==user.id)await requireInquiryHandler(id,user);
        // Starting converts a reservation made for this user into a real lease.
        await db.run("DELETE FROM inquiry_handover WHERE inquiry_id=? AND kind='reserve' AND user_id=?",id,user.id);
        await claimLease(id,user,session,body.tab,now);
      }else{
        // A late heartbeat cannot recreate activity or steal another handler's lease.
        await db.run('UPDATE inquiry_activity SET seen_at=? WHERE session=? AND tab=? AND inquiry_id=? AND user_id=?',now,session,body.tab,id,user.id);
      }
    }
    if(body.action==='request-handover'||body.action==='dismiss-handover'||body.action==='take-over'){
      const owner=(await activeInquiryActivity()).find(row=>row.inquiryId===id),users=await allUsers();
      if(body.action==='request-handover'){
        if(!canPrepareProposal(user)||!canEditInquiry(user,record))throw new AppError('Employee or supervisor access is required to ask for a handover.',403);
        if(!owner)throw new AppError('Nobody is handling this inquiry right now. You can start handling it yourself.',409);
        if(owner.userId===user.id)throw new AppError('You are already handling this inquiry.',409);
        if(owner.reserved)throw new AppError(`This inquiry is reserved for ${nameOf(users,owner.userId)}. Ask a supervisor if it should go to you instead.`,409);
        const last=await db.get<{at:string}>("SELECT at FROM inquiry_handover WHERE kind='request' AND inquiry_id=? AND user_id=? AND at>? ORDER BY at DESC LIMIT 1",id,user.id,new Date(Date.now()-HANDOVER_COOLDOWN_MS).toISOString());
        if(last){const wait=Math.max(1,Math.ceil((Date.parse(last.at)+HANDOVER_COOLDOWN_MS-Date.now())/60000));throw new AppError(`You already asked ${nameOf(users,owner.userId)} to hand this over. You can ask again in ${wait} minute${wait===1?'':'s'}.`,429);}
        await db.run("INSERT INTO inquiry_handover(id,inquiry_id,kind,user_id,by_user,at,until_at,state) VALUES(?,?,'request',?,?,?,?,'open')",randomUUID(),id,user.id,owner.userId,now,new Date(Date.now()+HANDOVER_REQUEST_LIFE_MS).toISOString());
        await notify(record,'Handover requested',`${user.name} asked to take over ${label(record)}.`,[owner.userId]);
      }else if(body.action==='dismiss-handover'){
        if(!owner||owner.userId!==user.id||owner.reserved)throw new AppError('Only the current handler can answer a handover request.',403);
        const open=await db.all<{user_id:string}>("SELECT user_id FROM inquiry_handover WHERE kind='request' AND state='open' AND inquiry_id=? AND by_user=?",id,user.id);
        await db.run("UPDATE inquiry_handover SET state='kept' WHERE kind='request' AND state='open' AND inquiry_id=? AND by_user=?",id,user.id);
        const requesters=[...new Set(open.map(row=>row.user_id))];
        if(requesters.length)await notify(record,'Still being handled',`${user.name} is still working on ${label(record)}.`,requesters);
      }else{
        if(!canTakeOver(user))throw new AppError('Only a supervisor can take over an inquiry.',403);
        const target=body.targetUserId&&body.targetUserId!==user.id?users.find(person=>person.id===body.targetUserId):user;
        if(!target||!target.active||!canPrepareProposal(target)||!canEditInquiry(target,record))throw new AppError('Choose an active employee or supervisor who can prepare this proposal.',422);
        await assertClientReady(record,true);
        if(!owner)throw new AppError('Nobody is handling this inquiry right now. Start handling it, or ask the employee to.',409);
        if(owner.userId===user.id)throw new AppError(owner.reserved?'This inquiry is already reserved for you. Choose Start handling.':'You already hold this inquiry.',409);
        if(owner.userId===target.id)throw new AppError(`${target.name} already holds this inquiry.`,409);
        await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);
        await db.run("DELETE FROM inquiry_handover WHERE inquiry_id=? AND kind='reserve'",id);
        await db.run("UPDATE inquiry_handover SET state='closed' WHERE inquiry_id=? AND kind='request' AND state='open'",id);
        const was=nameOf(users,owner.userId);
        if(target.id===user.id)await claimLease(id,user,session,body.tab,now);
        else await db.run("INSERT INTO inquiry_handover(id,inquiry_id,kind,user_id,by_user,at,until_at,state) VALUES(?,?,'reserve',?,?,?,?,'open')",randomUUID(),id,target.id,user.id,now,new Date(Date.now()+RESERVATION_MS).toISOString());
        logHandover(record,user,target.id===user.id?`Took over handling from ${was}`:`Took over handling from ${was} and assigned it to ${target.name}`);
        await persist(record,record.revision);
        await notify(record,'Inquiry taken over',`${user.name} took over ${label(record)}.`,[owner.userId]);
        if(target.id!==user.id)await notify(record,'Inquiry assigned to you',`${user.name} assigned ${label(record)} to you. Open it and choose Start handling within 15 minutes.`,[target.id]);
      }
    }
    if(isClientArchived(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);
    const activity=(await activeInquiryActivity()).filter(row=>row.inquiryId===id);
    const holds=!!await db.get('SELECT tab FROM inquiry_activity WHERE session=? AND tab=? AND inquiry_id=?',session,body.tab,id)&&activity.some(row=>row.userId===user.id&&!row.reserved);
    // The holder's tab learns about a colleague's request from this response.
    let handover:HandoverRequest|null=null;
    if(holds){
      const open=await db.get<{id:string;user_id:string;at:string}>("SELECT id,user_id,at FROM inquiry_handover WHERE kind='request' AND state='open' AND inquiry_id=? AND by_user=? AND at>? ORDER BY at DESC LIMIT 1",id,user.id,new Date(Date.now()-HANDOVER_REQUEST_LIFE_MS).toISOString());
      if(open)handover={id:open.id,requesterId:open.user_id,at:open.at};
    }
    return {activity,handling:holds&&canEditInquiry(user,record),handover};
  });
}
