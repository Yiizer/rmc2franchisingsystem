import { jsonText } from './sql-dialect';
import {historicalAgentChangeBlocked} from './historical';
import { colleagueHolding } from './activity';
import { lockedInquiry, matchingInquiries } from './inquiry-index';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { allUsers, AppError, audit, db, inquiry, lockInquiryRows, notify, persist, transaction } from './database';
import { deleteQuietly, files } from './file-store';
import { CLIENT_PROTECTION_MS, MAX_REJECTED_REPORTS, clientIdentity, clientState, isRegistered, protectedAgent, protectionFor, reviewClient } from './client-rules';
import { reportStatus } from './types';
import type { AgentProgressReport, FormFields, InquiryRecord, Staff } from './types';
import { canApproveProposal, canDecideProgressReport, canFileProgressReport } from './permissions';

export async function assertClientReady(record:InquiryRecord,allowIdentify=false){
  if(await historicalAgentChangeBlocked(record))throw new AppError('A supervisor must resolve the historical agent-change request before processing.',409);
  const state=clientState(record,await matchingInquiries(record));
  if(state.state==='archived')throw new AppError('This inquiry is archived and cannot be processed. Review its closure or expired registration in Archives.',409);
  if(state.state==='duplicate')throw new AppError('Duplicate client — processing is on hold. Open '+(state.matches[0]?.inquiryId||'the existing inquiry')+' or request a supervisor review.',409);
  if(state.state==='identify'&&!allowIdentify)throw new AppError('Enter the account/company or client name and save the details so duplicate checking can finish first.',409);
}
export async function updateClientReview(record:InquiryRecord,user?:Staff){
  const previous=record.clientReview?.state;
  record.clientReview=reviewClient(record,await matchingInquiries(record));
  // Completed work is never held; its matches stay informational (clientState overlaps).
  if(isRegistered(record)&&record.clientReview.state==='duplicate')record.clientReview={...record.clientReview,state:'clear'};
  const expiredRepeat=record.clientReview.matches.find(match=>match.expiredSameAgent);
  if(expiredRepeat&&!record.closure&&!isRegistered(record)){
    record.status='Declined';record.closure={kind:'declined',at:new Date().toISOString(),by:user?.id||'system',reason:'Same agent requested the same client after their previous 30-day registration expired.',relatedId:expiredRepeat.inquiryId};
    if(user)audit(record,user,'Automatically declined repeated request from an expired agent registration');
  }
  if(record.clientReview.state==='duplicate'){
    await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);await db.run("DELETE FROM inquiry_handover WHERE inquiry_id=?",record.id);
    if(previous!=='duplicate')await notify(record,'Duplicate client — on hold',`${record.fields.company||'Client'} matches ${record.clientReview.matches.map(item=>item.inquiryId).join(', ')}. Open the existing inquiry before processing.`,(await allUsers()).filter(person=>person.active).map(person=>person.id));
  }
  return record.clientReview;
}
export function startClientProtection(record:InquiryRecord,at:string,kind:'proposal'|'details',fields:FormFields=record.fields){
  if(record.protection)return;
  const existing=protectionFor(record);
  record.protection=existing||{startedAt:at,activityAt:at,expiresAt:new Date(Date.parse(at)+CLIENT_PROTECTION_MS).toISOString(),...protectedAgent(record,fields),activityKind:kind};
}
export async function reviewClientRegistration(id:string,user:Staff,input:unknown){
  const body=z.object({revision:z.number().int(),action:z.enum(['recheck','distinct','reassign-expired']),matchId:z.string().optional(),note:z.string().trim().max(3000).default('')}).strict().parse(input);
  return await transaction(async()=>{
    const record=await lockedInquiry(id);if(record.revision!==body.revision)throw new AppError('This inquiry changed. Reload before reviewing it.',409);
    if(body.action!=='recheck')await db.lock('lease:'+id); // lock order: ck: → lease: → rows → idx-sync (matchingInquiries takes idx-sync)
    if(clientState(record,await matchingInquiries(record)).state==='archived')throw new AppError('Expired inquiries stay in Archives. Import a new agent form to register the client.',409);
    if(body.action==='distinct'&&record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('A supervisor must decide the pending agent change first.',409);
    if(body.action==='distinct'||body.action==='reassign-expired'){
      const owner=await colleagueHolding(id,user);
      if(owner)throw new AppError('A colleague is handling this inquiry.',423);
      if(body.action==='reassign-expired'&&!canApproveProposal(user))throw new AppError('An approving supervisor must approve an agent change after expiry.',403);
      if(body.note.length<10)throw new AppError('Record the reason for this client review (at least 10 characters).');
      const fresh=reviewClient(record,await matchingInquiries(record));
      if(body.action==='distinct'){if(!body.matchId)throw new AppError('Choose the specific match to review.');fresh.matches=fresh.matches.filter(match=>match.inquiryId===body.matchId);}
      if(!fresh.matches.length)throw new AppError('Recheck availability; no matching client remains.',409);
      if(body.action==='distinct'&&fresh.matches.some(match=>!match.expired)&&!canApproveProposal(user))throw new AppError('An approving supervisor must decide whether an active or registered client is a different client.',403);
      if(fresh.matches.some(match=>match.expiredSameAgent))throw new AppError('The same agent cannot restart an expired registration. Recheck to decline this request.',409);
      if(body.action==='reassign-expired'&&fresh.matches.some(match=>!match.expired||match.sameAgent))throw new AppError('Only expired registrations for a different agent can be reassigned. Review the current matches first.',409);
      record.clientReview={...fresh,identity:clientIdentity(record),exceptions:[...(record.clientReview?.identity===clientIdentity(record)?record.clientReview.exceptions||[]:[]),...await Promise.all(fresh.matches.map(async match=>({inquiryId:match.inquiryId,identity:clientIdentity(await inquiry(match.inquiryId))})))],reviewedBy:user.id,reviewedAt:new Date().toISOString(),note:body.note};
      if(body.action==='reassign-expired'&&record.agentTransferRequest&&!record.agentTransferRequest.decision)record.agentTransferRequest.decision={by:user.id,at:new Date().toISOString(),action:'approve',note:body.note};
      if(body.action==='reassign-expired'){await db.lock(...fresh.matches.map(match=>'lease:'+match.inquiryId));await lockInquiryRows([record.id,...fresh.matches.map(match=>match.inquiryId)]);}
      if(body.action==='reassign-expired')for(const match of fresh.matches){
        const previous=await inquiry(match.inquiryId),revision=previous.revision;
        if(await colleagueHolding(previous.id,user))throw new AppError('A colleague is handling the previous registration.',423);
        previous.closure={kind:'transferred',at:new Date().toISOString(),by:user.id,reason:'Supervisor approved a different agent after protection expired: '+body.note,relatedId:record.id};
        previous.status='Transferred';audit(previous,user,'Approved new agent after expiry; registration continues in '+record.id);await persist(previous,revision);
      }
    }
    await updateClientReview(record,user);
    audit(record,user,body.action==='reassign-expired'?'Approved new agent registration after expiry: '+body.note:body.action==='distinct'?'Reviewed matching names/accounts as DIFFERENT CLIENTS: '+body.note:'Rechecked duplicate-client availability');await persist(record,body.revision);
    return record;
  });
}
const reportSchema=z.object({requestId:z.string().uuid().optional(),sentAt:z.string().datetime({offset:true}).optional(),summary:z.string().trim().min(10).max(10000),reference:z.string().trim().min(3).max(300)}).strict();
const notFound=()=>new AppError('Not found',404);
/**
 * Files a progress report for approval. Only the Division Head / SOA who owns the client may file; anyone else is refused (403 for other roles, 404 for
 * another owner's client, which looks the same as a client that does not exist). The report waits as 'pending' (and holds the client's protection)
 * until the Head or a Supervisor decides it; the 30-day countdown restarts only on approval. One pending report per client.
 */
/** After MAX_REJECTED_REPORTS rejections since protection was last renewed, refiling is refused: refiling must not keep a
 * client held indefinitely. Franchising can still renew or transfer the client. */
function tooManyRejections(record:InquiryRecord){
  const since=protectionFor(record)?.activityAt||'';
  const rejected=(record.progressReports||[]).filter(report=>reportStatus(report)==='rejected'&&(report.recordedAt||report.sentAt)>=since).length;
  if(rejected>=MAX_REJECTED_REPORTS)throw new AppError(`${rejected} reports for this client were rejected since protection was last renewed. Contact franchising before filing again.`,409);
}
/** Progress reports one Division Head / SOA may file in 24 hours. */
const REPORTS_PER_DAY=20;
export async function addProgressReport(id:string,user:Staff,input:unknown,file?:File){
  if(!canFileProgressReport(user))throw new AppError('Only the Division Head or SOA who owns this client can file a progress report.',403);
  const body=reportSchema.parse(input),requestId=body.requestId||randomUUID();
  // Cheap read-only pre-checks, before touching the file, so a repeat or refused request uploads nothing; the transaction
  // re-checks everything. A missing inquiry and someone else's look the same (no existence oracle).
  const early=await inquiry(id).catch(()=>{throw notFound();});
  if(early.ownerId!==user.id)throw notFound();
  if(early.progressReports?.some(report=>report.id===requestId))return early;
  if(early.progressReports?.some(report=>reportStatus(report)==='pending'))throw new AppError('A progress report for this client is already waiting for approval.',409);
  tooManyRejections(early);
  // At most REPORTS_PER_DAY reports (each up to 7 MB) per Division Head / SOA in 24 hours, across all their clients.
  const since=new Date(Date.now()-86400000).toISOString();
  const owned=await db.all<{data:string}>(`SELECT data FROM inquiries WHERE ${jsonText(db,'data','ownerId')}=?`,user.id);
  const recent=owned.reduce((n,row)=>n+((JSON.parse(row.data) as InquiryRecord).progressReports||[]).filter(r=>r.submittedBy===user.id&&(r.recordedAt||'')>since).length,0);
  if(recent>=REPORTS_PER_DAY)throw new AppError(`You can file up to ${REPORTS_PER_DAY} progress reports a day. Contact franchising if you need to file more.`,429);
  let attachment:AgentProgressReport['attachment'];let bytes:Buffer|undefined;
  if(file&&file.size){
    if(file.size>7*1024*1024)throw new AppError('The progress report must be smaller than 7 MB.');
    bytes=Buffer.from(await file.arrayBuffer());
    const extension=path.extname(file.name).toLowerCase();
    const pdf=extension==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-4096).toString('latin1').includes('%%EOF');
    const png=extension==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=['.jpg','.jpeg'].includes(extension)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!pdf&&!png&&!jpg)throw new AppError('Attach the original progress report as a PDF, PNG or JPEG file.');
    attachment={storage:'progress-reports/'+randomUUID()+extension,filename:path.basename(file.name),mime:pdf?'application/pdf':png?'image/png':'image/jpeg'};
  }
  // File first (never inside transaction()), then the row. The key is deleted again unless this call appended the report.
  let written=false,appended=false,keep=false;
  try{
    if(attachment&&bytes){await files().put(attachment.storage,bytes,{contentType:attachment.mime});written=true;}
    const saved=await transaction(async()=>{
    appended=false;
    const record=await lockedInquiry(id);
    if(record.ownerId!==user.id)throw notFound();
    if(record.progressReports?.some(report=>report.id===requestId))return record;
    if(record.progressReports?.some(report=>reportStatus(report)==='pending'))throw new AppError('A progress report for this client is already waiting for approval.',409);
    tooManyRejections(record);
    await assertClientReady(record);
    const protection=protectionFor(record);if(!protection)throw new AppError('The 30-day countdown starts when a reply or proposal is successfully sent to the agent.',409);
    const now=Date.now(),sentAt=body.sentAt?Date.parse(body.sentAt):now;
    if(sentAt>now+60000)throw new AppError('A progress report cannot have a future sent date.');
    if(sentAt<Date.parse(protection.startedAt))throw new AppError('Use a report sent after the protection started.');
    const report:AgentProgressReport={id:requestId,sentAt:new Date(Math.min(sentAt,now)).toISOString(),recordedAt:new Date(now).toISOString(),recordedBy:user.id,submittedBy:user.id,sender:user.email.toLowerCase(),summary:body.summary,reference:body.reference,status:'pending',...(attachment?{attachment}:{})};
    const revision=record.revision;
    record.progressReports=[...(record.progressReports||[]),report];appended=true;
    audit(record,user,'Filed progress report '+body.reference+' — waiting for approval');await persist(record,revision);
    await notify(record,'Progress report awaiting approval',`${record.fields.company||record.id} · ${user.name} filed a progress report (${body.reference}).`,(await allUsers()).filter(person=>person.active&&canDecideProgressReport(person)).map(person=>person.id));
    return record;
    });
    keep=appended;
    return saved;
  }finally{if(written&&!keep)await deleteQuietly(attachment?.storage);}
}
/** Head or Supervisor decides a pending report. One decision is enough and the first one wins. Approval restarts the 30 days from the decision time. */
export async function decideProgressReport(id:string,reportId:string,user:Staff,input:unknown){
  if(!canDecideProgressReport(user))throw new AppError('Only the Head or a Supervisor can decide a progress report.',403);
  const body=z.object({action:z.enum(['approve','reject']),reason:z.string().trim().max(3000).optional()}).strict().parse(input);
  if(body.action==='reject'&&(body.reason?.length||0)<5)throw new AppError('Give a reason for rejecting this report (at least 5 characters).');
  return await transaction(async()=>{
    const record=await lockedInquiry(id);
    const report=record.progressReports?.find(item=>item.id===reportId);if(!report)throw new AppError('Progress report not found',404);
    if(reportStatus(report)!=='pending')throw new AppError('This progress report was already decided.',409);
    const revision=record.revision,decidedAt=new Date().toISOString();
    if(body.action==='approve'){
      const protection=protectionFor(record);
      if(!protection||record.closure)throw new AppError('This client is no longer protected, so the report cannot renew it.',409);
      record.protection={...protection,activityAt:decidedAt,expiresAt:new Date(Date.parse(decidedAt)+CLIENT_PROTECTION_MS).toISOString(),activityKind:'progress-report'};
    }
    record.progressReports=record.progressReports!.map(item=>item.id===reportId?{...item,status:body.action==='approve'?'approved' as const:'rejected' as const,decidedBy:user.id,decidedAt,...(body.action==='reject'?{rejectReason:body.reason}:{})}:item);
    audit(record,user,body.action==='approve'?'Approved progress report '+report.reference+' — protection renewed until '+record.protection!.expiresAt:'Rejected progress report '+report.reference+': '+body.reason);await persist(record,revision);
    if(record.ownerId)await notify(record,body.action==='approve'?'Progress report approved':'Progress report rejected',body.action==='approve'?`${record.fields.company||record.id} · protection renewed for 30 days.`:`${record.fields.company||record.id} · ${body.reason}`,[record.ownerId],true);
    return record;
  });
}
