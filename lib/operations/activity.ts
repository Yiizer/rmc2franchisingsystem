import { z } from 'zod';
import { assertClientReady } from './client-service';
import { isClientArchived, isRegistered } from './client-rules';
import { AppError, allUsers, db, inquiry, transaction } from './database';
import { jsonBool, jsonText } from './sql-dialect';
import { canPrepareProposal, canEditInquiry } from './types';
import type { InquiryActivity, Staff } from './types';

export const ACTIVITY_TTL_MS=90000;
const activitySchema=z.object({tab:z.string().uuid(),action:z.enum(['poll','start','heartbeat','leave'])}).strict();
const ACTIVE_STATUSES="('New inquiry','Preparing proposal','Waiting for agent details','Needs correction','Supervisor editing')";

// The editing lease is separate from saved records: heartbeats must not change revisions,
// contributors, draft timestamps, or the proposal's approval history.
//
// Reading never writes. activeInquiryActivity() returns what pruning would leave behind: current (seen within the TTL,
// on a live session), by an active employee/supervisor, on an inquiry still being worked, one owner per inquiry (the
// earliest), and not archived or held. Housekeeping (pruneActivity) runs on start/leave/heartbeat and, throttled, on polls.
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
  const result:InquiryActivity[]=[];
  for(const row of rows){
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
  for(const row of await db.all<{inquiry_id:string}>('SELECT DISTINCT inquiry_id FROM inquiry_activity')){
    const record=await inquiry(row.inquiry_id);
    if(isClientArchived(record,Date.parse(now))||record.clientReview?.state==='duplicate'&&!isRegistered(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);
  }
}
// Polls prune at most this often per process (and only when no other request holds the prune lock).
const POLL_PRUNE_MS=10000;
let lastPollPrune=0;
export async function pruneActivityThrottled():Promise<void>{
  if(Date.now()-lastPollPrune<POLL_PRUNE_MS)return;
  lastPollPrune=Date.now();
  await transaction(pruneActivity);
}

export async function requireInquiryHandler(id:string,user:Staff){
  await assertClientReady(await inquiry(id),true);
  if(db.inTransaction())await db.lock('lease:'+id); // a start for this inquiry must not slip in between this check and the caller's commit
  const owner=(await activeInquiryActivity()).find(row=>row.inquiryId===id);
  if(!owner)throw new AppError('Start handling this inquiry before making changes. Your previous handling session may have expired.',423);
  if(owner.userId!==user.id)throw new AppError(`${(await allUsers()).find(person=>person.id===owner.userId)?.name||'A colleague'} is handling this inquiry. You can view it, but only the current handler can make changes.`,423);
}

export async function updateInquiryActivity(id:string,user:Staff,session:string,input:unknown){
  const body=activitySchema.parse(input);
  return await transaction(async()=>{
    await db.lock('lease:'+id); // exclusive handling: start/leave/heartbeat for one inquiry run one at a time
    const record=await inquiry(id),now=new Date().toISOString();
    if(body.action!=='poll')await pruneActivity();
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
        await db.run(`INSERT INTO inquiry_activity(session,tab,inquiry_id,user_id,started_at,seen_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(session,tab) DO UPDATE SET inquiry_id=excluded.inquiry_id,user_id=excluded.user_id,
          started_at=CASE WHEN inquiry_activity.inquiry_id=excluded.inquiry_id THEN inquiry_activity.started_at ELSE excluded.started_at END,seen_at=excluded.seen_at`,session,body.tab,id,user.id,now,now);
      }else{
        // A late heartbeat cannot recreate activity or steal another handler's lease.
        await db.run('UPDATE inquiry_activity SET seen_at=? WHERE session=? AND tab=? AND inquiry_id=? AND user_id=?',now,session,body.tab,id,user.id);
      }
    }
    if(isClientArchived(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);
    const activity=(await activeInquiryActivity()).filter(row=>row.inquiryId===id);
    const holds=!!await db.get('SELECT tab FROM inquiry_activity WHERE session=? AND tab=? AND inquiry_id=?',session,body.tab,id)&&activity.some(row=>row.userId===user.id);
    return {activity,handling:holds&&canEditInquiry(user,record)};
  });
}
