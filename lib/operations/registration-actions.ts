import { reviewClientRegistration } from './client-service';
import { colleagueHolding } from './activity';
import { lockedInquiry, matchingInquiries } from './inquiry-index';

import { randomUUID } from 'node:crypto';

import path from 'node:path';

import { z } from 'zod';

import { allUsers, AppError, audit, db, inquiry, lockInquiryRows, notify, persist, transaction } from './database';

import { deleteQuietly, files } from './file-store';

import { clientIdentity, clientState, isRegistered, protectionFor, reviewClient, sameRegisteredAgent } from './client-rules';
import { canApproveProposal, canPrepareProposal } from './permissions';
import { replyRecipient } from './reply-recipient';
import { mailConfig } from './mail-config';
import { mailTransport } from './mail-transport';
import type { SendResult } from './mail-transport';
import { jsonMerge } from './sql-dialect';
import { deliveryText, failureStatus, mailSchema, recoverStuckMail, reserveSend, storeEml, toFailure } from './service';

import type { InquiryRecord, Staff } from './types';



function transferIdentity(record:InquiryRecord){return JSON.stringify([clientIdentity(record),record.fields.agentName,record.fields.agentEmail,record.fields.agentPhone]);}
async function available(id:string,user:Staff){

  await db.lock('lease:'+id); // a colleague starting to handle this inquiry must wait for this decision to commit
  const owner=await colleagueHolding(id,user);

  if(owner)throw new AppError('A colleague is handling this inquiry. Ask them to finish before changing the client registration.',423);

}

async function blocksOthers(record:InquiryRecord){for(const other of await matchingInquiries(record))if(other.id!==record.id&&clientState(other,await matchingInquiries(other)).matches.some(match=>match.inquiryId===record.id))return true;return false;}
/** Everything that must hold before a request can be declined (after the "already declined" shortcut). Throws; the caller holds the row and lease locks. */
async function declineGuards(record:InquiryRecord,user:Staff,id:string){
  if(clientState(record,await matchingInquiries(record)).state==='archived')throw new AppError('This expired registration already belongs in Archives. Review a new incoming request instead.',409);
  if(['Sent','Approved — sending','Approved — email failed'].includes(record.status))throw new AppError('An approved or sent proposal cannot be declined as a new request.',409);
  if(['Awaiting approval','Supervisor editing'].includes(record.status)&&!canApproveProposal(user))throw new AppError('An approving supervisor must decide a submitted request.',403);
  if(!canApproveProposal(user)&&(isRegistered(record)||protectionFor(record)||await blocksOthers(record)))throw new AppError('An approving supervisor must decline a request that holds, or is blocking, a client registration.',403);
  await available(id,user);
}
async function applyDecline(record:InquiryRecord,user:Staff,reason:string,expected:number,email?:{at:string;to:string;file:string;audit:string}){
  record.closure={kind:'declined',at:new Date().toISOString(),by:user.id,reason,relatedId:record.clientReview?.matches[0]?.inquiryId,...(email?{email:{at:email.at,to:email.to,file:email.file}}:{})};
  delete record.mailDryRun;record.status='Declined';audit(record,user,'Declined request and moved to Archives: '+reason+(email?' — decline email: '+email.audit:''));await persist(record,expected);
  await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',record.id);await db.run("DELETE FROM inquiry_handover WHERE inquiry_id=?",record.id);
  await notify(record,'Request declined',reason,(await allUsers()).filter(person=>person.active).map(person=>person.id));return record;
}
const declineSchema=z.object({revision:z.number().int(),reason:z.string().trim().min(10).max(3000),email:z.object({send:z.boolean(),body:z.string().max(20000)}).strict().optional()}).strict();
/**
 * Decline a request. With email.send the agent is told first, the way requestDetails works (mail I/O outside transactions):
 * claim an outbox row, send to replyRecipient(record) through the same caps / staging redirect / dry-run, and only then record the decline.
 * If the send fails nothing is declined and the error is returned, so staff can retry or untick the box.
 */
export async function declineInquiry(id:string,user:Staff,input:unknown){
  const body=declineSchema.parse(input);
  if(!body.email?.send)return await transaction(async()=>{
    const record=await lockedInquiry(id);if(record.revision!==body.revision)throw new AppError('Reload this inquiry before declining it.',409);
    await db.lock('lease:'+id); // lock order: ck: → lease: → rows → idx-sync (matchingInquiries below takes idx-sync)
    if(record.closure)return record;
    await declineGuards(record,user,id);
    return await applyDecline(record,user,body.reason,body.revision);
  });
  if(!canPrepareProposal(user))throw new AppError('Use a Head, Supervisor or Employee account to email the agent.',403);
  const message=z.string().trim().min(1).max(20000).parse(body.email.body);
  await recoverStuckMail();
  const outboxId=randomUUID(),file='outbox/'+outboxId+'.eml';
  const draft=await transaction(async()=>{
    const record=await lockedInquiry(id);if(record.revision!==body.revision)throw new AppError('Reload this inquiry before declining it.',409);
    await db.lock('lease:'+id);
    if(record.closure)throw new AppError('This request was already declined.',409); // never email twice
    await declineGuards(record,user,id);
    const email=mailSchema.parse({to:replyRecipient(record),subject:'Request declined — '+(record.fields.company||'your request').replace(/[\r\n\u2028\u2029\0]+/g,' '),body:message});
    await db.run("UPDATE outbox SET status='failed' WHERE inquiry_id=? AND kind='decline' AND status='ready'",id);
    if(await db.get("SELECT 1 FROM outbox WHERE inquiry_id=? AND kind='decline' AND status='sending'",id))throw new AppError('A decline email is already being sent for this inquiry.',409);
    const version=((await db.get("SELECT MAX(version) AS v FROM outbox WHERE inquiry_id=? AND kind='decline'",id) as {v:number|null}).v||0)+1;
    const now=new Date().toISOString();
    await db.run('INSERT INTO outbox (id,inquiry_id,version,kind,status,data) VALUES (?,?,?,?,?,?)',outboxId,id,version,'decline','sending',JSON.stringify({id:outboxId,createdAt:now,sendingAt:now,email,error:''}));
    return email;
  });
  const config=mailConfig();
  const settle=(status:string,error:string)=>db.run(`UPDATE outbox SET status=?,data=${jsonMerge(db,'data',['error'])} WHERE id=?`,status,error,outboxId);
  let result:SendResult;
  try{
    await reserveSend(config,'decline',outboxId);
    result=await mailTransport(config).send({messageId:outboxId,to:draft.to,subject:draft.subject,body:draft.body,attachments:[],kind:'decline'});
  }catch(error){
    const failure=toFailure(error);await settle(failure.uncertain?'uncertain':'failed',failure.safeReason);
    throw new AppError(failure.uncertain?failure.safeReason+' The message may have been delivered; check the mailbox before sending again. The request was not declined.':failure.safeReason+' The email was not sent and the request was not declined.',failureStatus(failure));
  }
  try{
    const text=deliveryText(config,result);
    if(result.dryRun){
      // Dry run: nothing is declined. Only a marker so the UI can offer the built message.
      const stored=await storeEml('outbox/'+outboxId+'.dry-run.eml',result.eml);
      return await transaction(async()=>{const record=await inquiry(id),revision=record.revision;record.mailDryRun={at:result.at,kind:'decline',file:stored};audit(record,user,'Decline email: '+text.audit);await persist(record,revision);await settle('dryrun','');return record;});
    }
    const stored=await storeEml(file,result.eml);
    return await transaction(async()=>{
      const record=await lockedInquiry(id);await db.lock('lease:'+id);
      // The email is already out: record the decline on whatever revision is current, but every guard still applies.
      if(record.closure){await settle('sent','');return record;}
      await declineGuards(record,user,id);
      const declined=await applyDecline(record,user,body.reason,record.revision,{at:result.at,to:draft.to,file:stored,audit:text.audit});
      await settle('sent','');return declined;
    });
  }catch{
    await settle('uncertain','The email was sent but the decline could not be recorded.');
    throw new AppError(result.dryRun?'The dry run could not be recorded.':'The decline email was sent but the decline could not be recorded. Check the mailbox, then decline this request again without the email.',409);
  }
}
export async function transferWithBor(id:string,user:Staff,form:FormData){

  const body=z.object({revision:z.coerce.number().int(),previousId:z.string().min(1),previousRevision:z.coerce.number().int(),reference:z.string().trim().min(3).max(300),note:z.string().trim().min(10).max(3000),verified:z.literal('true')}).parse(Object.fromEntries(form));

  const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>7*1024*1024)throw new AppError('Attach the verified BOR as a PDF or image up to 7 MB.');

  const bytes=Buffer.from(await file.arrayBuffer()),ext=path.extname(file.name).toLowerCase();

  const pdf=ext==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-4096).toString('latin1').includes('%%EOF');

  const png=ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));

  const jpg=['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;

  if(!pdf&&!png&&!jpg)throw new AppError('The BOR must be a valid PDF, PNG or JPEG.');

  // Cheap read-only pre-check so a stale request uploads nothing; the transaction re-checks everything.
  const early=await inquiry(id),earlyPrevious=await inquiry(body.previousId);
  if(early.revision!==body.revision||earlyPrevious.revision!==body.previousRevision)throw new AppError('The registration changed. Reload both inquiries before transferring.',409);

  const storage='bor/'+randomUUID()+ext,mime=pdf?'application/pdf':png?'image/png':'image/jpeg';let written=false,used=false;

  // File first (never inside transaction()), then the row; every committed path below references this key.
  try{await files().put(storage,bytes,{contentType:mime});written=true;const saved=await transaction(async()=>{

    const record=await lockedInquiry(id);await db.lock('lease:'+id,'lease:'+body.previousId);await lockInquiryRows([id,body.previousId]);const previous=await inquiry(body.previousId),records=await matchingInquiries(record);

    if(record.revision!==body.revision||previous.revision!==body.previousRevision)throw new AppError('The registration changed. Reload both inquiries before transferring.',409);

    if(record.closure||clientState(record,records).state==='archived')throw new AppError('Use an open request from the new agent for the BOR transfer.',409);

    const review=reviewClient(record,records);

    if(review.matches.length!==1||review.matches[0].inquiryId!==previous.id)throw new AppError('Review all matching clients first. A BOR transfer must identify one existing registration.',409);

    if(sameRegisteredAgent(record,previous)||review.matches[0].expiredSameAgent)throw new AppError('A BOR transfer requires a different incoming agent.',409);

    await available(id,user);await available(previous.id,user);

    const at=new Date().toISOString();

    if(!canApproveProposal(user)){

      if(record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('An agent change is already awaiting supervisor approval.',409);

      record.agentTransferRequest={id:randomUUID(),at,by:user.id,previousId:previous.id,previousRevision:previous.revision,identity:transferIdentity(record),previousIdentity:transferIdentity(previous),reference:body.reference,note:body.note,attachment:{storage,filename:path.basename(file.name),mime:pdf?'application/pdf':png?'image/png':'image/jpeg'}};

      audit(record,user,'Requested supervisor approval for agent change with BOR '+body.reference);await persist(record,body.revision);

      await notify(record,'Agent change awaiting approval',record.fields.company+' · '+body.reference,(await allUsers()).filter(person=>person.active&&canApproveProposal(person)).map(person=>person.id));return record;

    }



    previous.closure={kind:'transferred',at,by:user.id,reason:'Verified BOR '+body.reference+' — transferred to '+record.fields.agentName,relatedId:id};

    previous.status='Transferred';audit(previous,user,'Client transferred by verified BOR to '+id);await persist(previous,body.previousRevision);

    if(record.agentTransferRequest&&!record.agentTransferRequest.decision)record.agentTransferRequest.decision={by:user.id,at,action:'approve',note:body.note};

    record.bor={fromInquiryId:previous.id,at,by:user.id,reference:body.reference,note:body.note,attachment:{storage,filename:path.basename(file.name),mime:pdf?'application/pdf':png?'image/png':'image/jpeg'}};

    record.clientReview=reviewClient(record,await matchingInquiries(record));

    if(record.clientReview.state!=='clear')throw new AppError('Another matching registration needs review before this transfer.',409);

    audit(record,user,'Accepted verified BOR '+body.reference+'; client transferred from '+previous.id+'. '+body.note);await persist(record,body.revision);

    await db.run('DELETE FROM inquiry_activity WHERE inquiry_id IN (?,?)',id,previous.id);await db.run("DELETE FROM inquiry_handover WHERE inquiry_id IN (?,?)",id,previous.id);

    await notify(record,'Client transferred by BOR',record.fields.agentName+' now holds the client registration. Verified by '+user.name+'.',(await allUsers()).filter(person=>person.active).map(person=>person.id));return record;

  });used=true;return saved;}finally{if(written&&!used)await deleteQuietly(storage);}

}



export async function decideAgentTransfer(id:string,user:Staff,input:unknown){

  if(!canApproveProposal(user))throw new AppError('Supervisor approval is required for an agent change.',403);

  const body=z.object({revision:z.number().int(),requestId:z.string(),action:z.enum(['approve','reject']),note:z.string().trim().min(10).max(3000)}).strict().parse(input);

  const record=await inquiry(id),pending=record.agentTransferRequest;

  if(record.revision!==body.revision||!pending||pending.id!==body.requestId||pending.decision)throw new AppError('This agent-change request changed. Reload it.',409);

  const previous=await inquiry(pending.previousId);

  if(body.action==='reject')return await transaction(async()=>{const current=await inquiry(id);if(current.revision!==body.revision)throw new AppError('Reload this request.',409);await available(id,user);current.agentTransferRequest!.decision={by:user.id,at:new Date().toISOString(),action:'reject',note:body.note};audit(current,user,'Rejected agent change: '+body.note);await persist(current,body.revision);await notify(current,'Agent change rejected',body.note,[pending.by]);return current;});

  if(transferIdentity(record)!==pending.identity||transferIdentity(previous)!==pending.previousIdentity||previous.revision!==pending.previousRevision)throw new AppError('Client details or the previous registration changed. Submit a fresh agent-change request.',409);

  if(pending.kind==='expiry')return await reviewClientRegistration(id,user,{revision:record.revision,action:'reassign-expired',note:body.note});
  if(!pending.attachment)throw new AppError('BOR evidence is missing.',409);
  const form=new FormData();Object.entries({revision:String(record.revision),previousId:previous.id,previousRevision:String(previous.revision),reference:pending.reference,note:pending.note+'; Supervisor approval: '+body.note,verified:'true'}).forEach(([key,value])=>form.set(key,value));

  form.set('file',new File([new Uint8Array(await files().get(pending.attachment.storage))],pending.attachment.filename,{type:pending.attachment.mime}));

  return await transferWithBor(id,user,form);

}


export async function requestExpiredTransfer(id:string,user:Staff,input:unknown){
 const body=z.object({revision:z.number().int(),note:z.string().trim().min(10).max(3000)}).strict().parse(input);
 return await transaction(async()=>{const record=await lockedInquiry(id);if(record.revision!==body.revision)throw new AppError('Reload this inquiry.',409);await available(id,user);
 // The previous registration is only known after matching (idx-sync), so its lease comes later; a rare deadlock here is detected and retried (40P01).
 const matches=reviewClient(record,await matchingInquiries(record)).matches;
 if(record.closure||matches.length!==1||!matches[0].expired||matches[0].sameAgent)throw new AppError('Review one expired registration for a different agent before requesting a change.',409);
 if(record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('An agent change is already pending.',409);
 const previous=await inquiry(matches[0].inquiryId);await available(previous.id,user);
 record.agentTransferRequest={id:randomUUID(),kind:'expiry',at:new Date().toISOString(),by:user.id,previousId:previous.id,previousRevision:previous.revision,identity:transferIdentity(record),previousIdentity:transferIdentity(previous),reference:'Expired registration',note:body.note};
 audit(record,user,'Requested supervisor approval for new agent after expiry: '+body.note);await persist(record,body.revision);await notify(record,'Agent change awaiting approval',record.fields.company+' · previous registration expired',(await allUsers()).filter(p=>p.active&&canApproveProposal(p)).map(p=>p.id));return record;});
}
