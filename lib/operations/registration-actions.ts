import { reviewClientRegistration } from './client-service';
import { matchingInquiries } from './inquiry-index';

import { randomUUID } from 'node:crypto';

import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';

import path from 'node:path';

import { z } from 'zod';

import { allUsers, AppError, audit, db, inquiry, notify, persist, safeStorage, transaction } from './database';

import { clientIdentity, clientState, isRegistered, protectionFor, reviewClient, sameAgent } from './client-rules';

import type { Staff } from './types';



function transferIdentity(record:ReturnType<typeof inquiry>){return JSON.stringify([clientIdentity(record),record.fields.agentName,record.fields.agentEmail,record.fields.agentPhone]);}
function available(id:string,user:Staff){

  const owner=db().prepare('SELECT user_id FROM inquiry_activity WHERE inquiry_id=? AND seen_at>? AND user_id<>?').get(id,new Date(Date.now()-90000).toISOString(),user.id);

  if(owner)throw new AppError('A colleague is handling this inquiry. Ask them to finish before changing the client registration.',423);

}

function blocksOthers(record:ReturnType<typeof inquiry>){return matchingInquiries(record).some(other=>other.id!==record.id&&clientState(other,matchingInquiries(other)).matches.some(match=>match.inquiryId===record.id));}
export function declineInquiry(id:string,user:Staff,input:unknown){

  const body=z.object({revision:z.number().int(),reason:z.string().trim().min(10).max(3000)}).strict().parse(input);

  return transaction(()=>{

    const record=inquiry(id);if(record.revision!==body.revision)throw new AppError('Reload this inquiry before declining it.',409);

    if(record.closure)return record;

    if(clientState(record,matchingInquiries(record)).state==='archived')throw new AppError('This expired registration already belongs in Archives. Review a new incoming request instead.',409);

    if(['Sent','Approved — sending','Approved — email failed'].includes(record.status))throw new AppError('An approved or sent proposal cannot be declined as a new request.',409);

    if(['Awaiting approval','Supervisor editing'].includes(record.status)&&!(user.role==='Supervisor'&&user.canApprove))throw new AppError('An approving supervisor must decide a submitted request.',403);

    if(!(user.role==='Supervisor'&&user.canApprove)&&(isRegistered(record)||protectionFor(record)||blocksOthers(record)))throw new AppError('An approving supervisor must decline a request that holds, or is blocking, a client registration.',403);

    available(id,user);

    record.closure={kind:'declined',at:new Date().toISOString(),by:user.id,reason:body.reason,relatedId:record.clientReview?.matches[0]?.inquiryId};

    record.status='Declined';audit(record,user,'Declined request and moved to Archives: '+body.reason);persist(record,body.revision);

    db().prepare('DELETE FROM inquiry_activity WHERE inquiry_id=?').run(id);

    notify(record,'Request declined',body.reason,allUsers().filter(person=>person.active).map(person=>person.id));return record;

  });

}

export async function transferWithBor(id:string,user:Staff,form:FormData){

  const body=z.object({revision:z.coerce.number().int(),previousId:z.string().min(1),previousRevision:z.coerce.number().int(),reference:z.string().trim().min(3).max(300),note:z.string().trim().min(10).max(3000),verified:z.literal('true')}).parse(Object.fromEntries(form));

  const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>7*1024*1024)throw new AppError('Attach the verified BOR as a PDF or image up to 7 MB.');

  const bytes=Buffer.from(await file.arrayBuffer()),ext=path.extname(file.name).toLowerCase();

  const pdf=ext==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-4096).toString('latin1').includes('%%EOF');

  const png=ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));

  const jpg=['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;

  if(!pdf&&!png&&!jpg)throw new AppError('The BOR must be a valid PDF, PNG or JPEG.');

  const storage='bor/'+randomUUID()+ext;let written=false;

  try{return transaction(()=>{

    const record=inquiry(id),previous=inquiry(body.previousId),records=matchingInquiries(record);

    if(record.revision!==body.revision||previous.revision!==body.previousRevision)throw new AppError('The registration changed. Reload both inquiries before transferring.',409);

    if(record.closure||clientState(record,records).state==='archived')throw new AppError('Use an open request from the new agent for the BOR transfer.',409);

    const review=reviewClient(record,records);

    if(review.matches.length!==1||review.matches[0].inquiryId!==previous.id)throw new AppError('Review all matching clients first. A BOR transfer must identify one existing registration.',409);

    if(sameAgent(record.source.fields,previous.source.fields)||review.matches[0].expiredSameAgent)throw new AppError('A BOR transfer requires a different incoming agent.',409);

    available(id,user);available(previous.id,user);

    mkdirSync(path.dirname(safeStorage(storage)),{recursive:true});writeFileSync(safeStorage(storage),bytes,{flag:'wx'});written=true;

    const at=new Date().toISOString();

    if(!(user.role==='Supervisor'&&user.canApprove)){

      if(record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('An agent change is already awaiting supervisor approval.',409);

      record.agentTransferRequest={id:randomUUID(),at,by:user.id,previousId:previous.id,previousRevision:previous.revision,identity:transferIdentity(record),previousIdentity:transferIdentity(previous),reference:body.reference,note:body.note,attachment:{storage,filename:path.basename(file.name),mime:pdf?'application/pdf':png?'image/png':'image/jpeg'}};

      audit(record,user,'Requested supervisor approval for agent change with BOR '+body.reference);persist(record,body.revision);

      notify(record,'Agent change awaiting approval',record.fields.company+' · '+body.reference,allUsers().filter(person=>person.active&&person.role==='Supervisor'&&person.canApprove).map(person=>person.id));return record;

    }



    previous.closure={kind:'transferred',at,by:user.id,reason:'Verified BOR '+body.reference+' — transferred to '+record.fields.agentName,relatedId:id};

    previous.status='Transferred';audit(previous,user,'Client transferred by verified BOR to '+id);persist(previous,body.previousRevision);

    if(record.agentTransferRequest&&!record.agentTransferRequest.decision)record.agentTransferRequest.decision={by:user.id,at,action:'approve',note:body.note};

    record.bor={fromInquiryId:previous.id,at,by:user.id,reference:body.reference,note:body.note,attachment:{storage,filename:path.basename(file.name),mime:pdf?'application/pdf':png?'image/png':'image/jpeg'}};

    record.clientReview=reviewClient(record,matchingInquiries(record));

    if(record.clientReview.state!=='clear')throw new AppError('Another matching registration needs review before this transfer.',409);

    audit(record,user,'Accepted verified BOR '+body.reference+'; client transferred from '+previous.id+'. '+body.note);persist(record,body.revision);

    db().prepare('DELETE FROM inquiry_activity WHERE inquiry_id IN (?,?)').run(id,previous.id);

    notify(record,'Client transferred by BOR',record.fields.agentName+' now holds the client registration. Verified by '+user.name+'.',allUsers().filter(person=>person.active).map(person=>person.id));return record;

  });}catch(error){if(written)try{unlinkSync(safeStorage(storage));}catch{}throw error;}

}



export async function decideAgentTransfer(id:string,user:Staff,input:unknown){

  if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('Supervisor approval is required for an agent change.',403);

  const body=z.object({revision:z.number().int(),requestId:z.string(),action:z.enum(['approve','reject']),note:z.string().trim().min(10).max(3000)}).strict().parse(input);

  const record=inquiry(id),pending=record.agentTransferRequest;

  if(record.revision!==body.revision||!pending||pending.id!==body.requestId||pending.decision)throw new AppError('This agent-change request changed. Reload it.',409);

  const previous=inquiry(pending.previousId);

  if(body.action==='reject')return transaction(()=>{const current=inquiry(id);if(current.revision!==body.revision)throw new AppError('Reload this request.',409);available(id,user);current.agentTransferRequest!.decision={by:user.id,at:new Date().toISOString(),action:'reject',note:body.note};audit(current,user,'Rejected agent change: '+body.note);persist(current,body.revision);notify(current,'Agent change rejected',body.note,[pending.by]);return current;});

  if(transferIdentity(record)!==pending.identity||transferIdentity(previous)!==pending.previousIdentity||previous.revision!==pending.previousRevision)throw new AppError('Client details or the previous registration changed. Submit a fresh agent-change request.',409);

  if(pending.kind==='expiry')return reviewClientRegistration(id,user,{revision:record.revision,action:'reassign-expired',note:body.note});
  if(!pending.attachment)throw new AppError('BOR evidence is missing.',409);
  const form=new FormData();Object.entries({revision:String(record.revision),previousId:previous.id,previousRevision:String(previous.revision),reference:pending.reference,note:pending.note+'; Supervisor approval: '+body.note,verified:'true'}).forEach(([key,value])=>form.set(key,value));

  form.set('file',new File([readFileSync(safeStorage(pending.attachment.storage))],pending.attachment.filename,{type:pending.attachment.mime}));

  return transferWithBor(id,user,form);

}


export function requestExpiredTransfer(id:string,user:Staff,input:unknown){
 const body=z.object({revision:z.number().int(),note:z.string().trim().min(10).max(3000)}).strict().parse(input);
 return transaction(()=>{const record=inquiry(id);if(record.revision!==body.revision)throw new AppError('Reload this inquiry.',409);available(id,user);
 const matches=reviewClient(record,matchingInquiries(record)).matches;
 if(record.closure||matches.length!==1||!matches[0].expired||matches[0].sameAgent)throw new AppError('Review one expired registration for a different agent before requesting a change.',409);
 if(record.agentTransferRequest&&!record.agentTransferRequest.decision)throw new AppError('An agent change is already pending.',409);
 const previous=inquiry(matches[0].inquiryId);available(previous.id,user);
 record.agentTransferRequest={id:randomUUID(),kind:'expiry',at:new Date().toISOString(),by:user.id,previousId:previous.id,previousRevision:previous.revision,identity:transferIdentity(record),previousIdentity:transferIdentity(previous),reference:'Expired registration',note:body.note};
 audit(record,user,'Requested supervisor approval for new agent after expiry: '+body.note);persist(record,body.revision);notify(record,'Agent change awaiting approval',record.fields.company+' · previous registration expired',allUsers().filter(p=>p.active&&p.role==='Supervisor'&&p.canApprove).map(p=>p.id));return record;});
}
