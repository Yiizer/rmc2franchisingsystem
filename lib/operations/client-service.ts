import {historicalAgentChangeBlocked} from './historical';
import { matchingInquiries } from './inquiry-index';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { allUsers, AppError, audit, db, inquiry, notify, persist, transaction } from './database';
import { deleteQuietly, files } from './file-store';
import { CLIENT_PROTECTION_MS, clientIdentity, clientState, isRegistered, protectedAgent, protectionFor, reviewClient } from './client-rules';
import type { AgentProgressReport, FormFields, InquiryRecord, Staff } from './types';

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
    await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);
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
    const record=await inquiry(id);if(record.revision!==body.revision)throw new AppError('This inquiry changed. Reload before reviewing it.',409);
    if(clientState(record,await matchingInquiries(record)).state==='archived')throw new AppError('Expired inquiries stay in Archives. Import a new agent form to register the client.',409);
    if(body.action==='distinct'&&record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('A supervisor must decide the pending agent change first.',409);
    if(body.action==='distinct'||body.action==='reassign-expired'){
      const owner=await db.get('SELECT user_id FROM inquiry_activity WHERE inquiry_id=? AND seen_at>? AND user_id<>?',id,new Date(Date.now()-90000).toISOString(),user.id);
      if(owner)throw new AppError('A colleague is handling this inquiry.',423);
      if(body.action==='reassign-expired'&&!(user.role==='Supervisor'&&user.canApprove))throw new AppError('An approving supervisor must approve an agent change after expiry.',403);
      if(body.note.length<10)throw new AppError('Record the reason for this client review (at least 10 characters).');
      const fresh=reviewClient(record,await matchingInquiries(record));
      if(body.action==='distinct'){if(!body.matchId)throw new AppError('Choose the specific match to review.');fresh.matches=fresh.matches.filter(match=>match.inquiryId===body.matchId);}
      if(!fresh.matches.length)throw new AppError('Recheck availability; no matching client remains.',409);
      if(body.action==='distinct'&&fresh.matches.some(match=>!match.expired)&&!(user.role==='Supervisor'&&user.canApprove))throw new AppError('An approving supervisor must decide whether an active or registered client is a different client.',403);
      if(fresh.matches.some(match=>match.expiredSameAgent))throw new AppError('The same agent cannot restart an expired registration. Recheck to decline this request.',409);
      if(body.action==='reassign-expired'&&fresh.matches.some(match=>!match.expired||match.sameAgent))throw new AppError('Only expired registrations for a different agent can be reassigned. Review the current matches first.',409);
      record.clientReview={...fresh,identity:clientIdentity(record),exceptions:[...(record.clientReview?.identity===clientIdentity(record)?record.clientReview.exceptions||[]:[]),...await Promise.all(fresh.matches.map(async match=>({inquiryId:match.inquiryId,identity:clientIdentity(await inquiry(match.inquiryId))})))],reviewedBy:user.id,reviewedAt:new Date().toISOString(),note:body.note};
      if(body.action==='reassign-expired'&&record.agentTransferRequest&&!record.agentTransferRequest.decision)record.agentTransferRequest.decision={by:user.id,at:new Date().toISOString(),action:'approve',note:body.note};
      if(body.action==='reassign-expired')for(const match of fresh.matches){
        const previous=await inquiry(match.inquiryId),revision=previous.revision;
        if(await db.get('SELECT user_id FROM inquiry_activity WHERE inquiry_id=? AND seen_at>? AND user_id<>?',previous.id,new Date(Date.now()-90000).toISOString(),user.id))throw new AppError('A colleague is handling the previous registration.',423);
        previous.closure={kind:'transferred',at:new Date().toISOString(),by:user.id,reason:'Supervisor approved a different agent after protection expired: '+body.note,relatedId:record.id};
        previous.status='Transferred';audit(previous,user,'Approved new agent after expiry; registration continues in '+record.id);await persist(previous,revision);
      }
    }
    await updateClientReview(record,user);
    audit(record,user,body.action==='reassign-expired'?'Approved new agent registration after expiry: '+body.note:body.action==='distinct'?'Reviewed matching names/accounts as DIFFERENT CLIENTS: '+body.note:'Rechecked duplicate-client availability');await persist(record,body.revision);
    return record;
  });
}
const reportSchema=z.object({revision:z.number().int(),requestId:z.string().uuid(),sender:z.string().trim().email(),sentAt:z.string().datetime({offset:true}),summary:z.string().trim().min(10).max(10000),reference:z.string().trim().min(3).max(300)}).strict();
export async function addProgressReport(id:string,user:Staff,input:unknown,file?:File){
  const body=reportSchema.parse(input);
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
  // Cheap read-only pre-checks so a repeat or stale request uploads nothing; the transaction re-checks everything.
  const early=await inquiry(id);
  if(early.progressReports?.some(report=>report.id===body.requestId))return early;
  if(early.revision!==body.revision)throw new AppError('This inquiry changed. Reload before recording the report.',409);
  let written=false,appended=false,keep=false;
  try{
    if(attachment&&bytes){await files().put(attachment.storage,bytes,{contentType:attachment.mime});written=true;}
    const saved=await transaction(async()=>{
    appended=false;
    const record=await inquiry(id);
    if(record.progressReports?.some(report=>report.id===body.requestId))return record;
    if(record.revision!==body.revision)throw new AppError('This inquiry changed. Reload before recording the report.',409);
    await assertClientReady(record);
    const protection=protectionFor(record);if(!protection)throw new AppError('The 30-day countdown starts when a reply or proposal is successfully sent to the agent.');
    if(body.sender.toLowerCase()!==protection.agentEmail.trim().toLowerCase())throw new AppError('Only a progress report from the currently registered agent can reset this client’s countdown.',409);
    const sentAt=Date.parse(body.sentAt),now=Date.now();
    if(sentAt>now)throw new AppError('A progress report cannot have a future sent date.');
    if(sentAt<=Date.parse(protection.activityAt)||sentAt>=Date.parse(protection.expiresAt))throw new AppError('Use a report sent after the last recorded activity and before the protection deadline.');
    const report:AgentProgressReport={id:body.requestId,sentAt:new Date(sentAt).toISOString(),recordedAt:new Date(now).toISOString(),recordedBy:user.id,sender:body.sender.toLowerCase(),summary:body.summary,reference:body.reference,...(attachment?{attachment}:{})};
    record.progressReports=[...(record.progressReports||[]),report];appended=true;
    record.protection={...protection,activityAt:report.sentAt,expiresAt:new Date(sentAt+CLIENT_PROTECTION_MS).toISOString(),activityKind:'progress-report'};
    audit(record,user,'Recorded agent progress report '+body.reference+' — protection reset from '+report.sentAt+' until '+record.protection.expiresAt);await persist(record,body.revision);
    await notify(record,'Client protection renewed',`${protection.agentName} · 30 days from the report’s sent date.`,(await allUsers()).filter(person=>person.active).map(person=>person.id));return record;
    });
    keep=appended;
    return saved;
  }finally{if(written&&!keep)await deleteQuietly(attachment?.storage);}
}
