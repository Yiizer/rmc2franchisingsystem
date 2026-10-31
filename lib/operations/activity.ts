import { z } from 'zod';
import { assertClientReady } from './client-service';
import { isClientArchived, isRegistered } from './client-rules';
import { AppError, allUsers, db, inquiry, transaction } from './database';
import { canPrepareProposal, canEditInquiry } from './types';
import type { InquiryActivity, Staff } from './types';

export const ACTIVITY_TTL_MS=90000;
const activitySchema=z.object({tab:z.string().uuid(),action:z.enum(['poll','start','heartbeat','leave'])}).strict();

// The editing lease is separate from saved records: heartbeats must not change revisions,
// contributors, draft timestamps, or the proposal's approval history.
// Prunes and reads as one unit (a transaction, or the caller's), as the synchronous version did.
export const activeInquiryActivity=():Promise<InquiryActivity[]>=>transaction(pruneAndReadActivity);
async function pruneAndReadActivity():Promise<InquiryActivity[]>{
  const now=new Date().toISOString(),cutoff=new Date(Date.now()-ACTIVITY_TTL_MS).toISOString();
  await db.run('DELETE FROM inquiry_activity WHERE seen_at < ? OR session NOT IN (SELECT token FROM sessions WHERE expires > ?)',cutoff,now);
  await db.exec(`DELETE FROM inquiry_activity WHERE user_id NOT IN (SELECT id FROM users WHERE json_extract(data,'$.active')=1 AND json_extract(data,'$.role') IN ('Employee','Supervisor'))
    OR inquiry_id NOT IN (SELECT id FROM inquiries WHERE json_extract(data,'$.status') IN ('New inquiry','Preparing proposal','Waiting for agent details','Needs correction','Supervisor editing'));
    DELETE FROM inquiry_activity WHERE user_id <> (SELECT b.user_id FROM inquiry_activity b WHERE b.inquiry_id=inquiry_activity.inquiry_id ORDER BY b.started_at,b.user_id LIMIT 1);`);
  for(const row of await db.all('SELECT DISTINCT inquiry_id FROM inquiry_activity') as {inquiry_id:string}[]){
    const record=await inquiry(row.inquiry_id);
    if(isClientArchived(record,Date.parse(now))||record.clientReview?.state==='duplicate'&&!isRegistered(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);
  }
  const rows=await db.all(`SELECT a.inquiry_id AS inquiryId,a.user_id AS userId,MIN(a.started_at) AS startedAt,MAX(a.seen_at) AS seenAt
    FROM inquiry_activity a JOIN inquiries i ON i.id=a.inquiry_id JOIN users u ON u.id=a.user_id
    WHERE json_extract(u.data,'$.active')=1 AND json_extract(u.data,'$.role') IN ('Employee','Supervisor')
    AND json_extract(i.data,'$.status') IN ('New inquiry','Preparing proposal','Waiting for agent details','Needs correction','Supervisor editing')
    GROUP BY a.inquiry_id,a.user_id ORDER BY startedAt`);
  return rows as InquiryActivity[];
}

export async function requireInquiryHandler(id:string,user:Staff){
  await assertClientReady(await inquiry(id),true);
  const owner=(await activeInquiryActivity()).find(row=>row.inquiryId===id);
  if(!owner)throw new AppError('Start handling this inquiry before making changes. Your previous handling session may have expired.',423);
  if(owner.userId!==user.id)throw new AppError(`${(await allUsers()).find(person=>person.id===owner.userId)?.name||'A colleague'} is handling this inquiry. You can view it, but only the current handler can make changes.`,423);
}

export async function updateInquiryActivity(id:string,user:Staff,session:string,input:unknown){
  const body=activitySchema.parse(input);
  return await transaction(async()=>{
    const record=await inquiry(id),now=new Date().toISOString();
    await activeInquiryActivity();
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
    const activity=(await activeInquiryActivity()).filter(row=>row.inquiryId===id);
    if(isClientArchived(record))await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);
    const handling=!!await db.get('SELECT tab FROM inquiry_activity WHERE session=? AND tab=? AND inquiry_id=?',session,body.tab,id)&&canEditInquiry(user,record);
    return {activity,handling};
  });
}
