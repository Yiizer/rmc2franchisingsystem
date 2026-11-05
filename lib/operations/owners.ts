import { z } from 'zod';
import { allUsers, AppError, audit, db, notify, persist, transaction } from './database';
import { applyOwner } from './client-rules';
import { lockedInquiry } from './inquiry-index';
import { colleagueHolding } from './activity';
import { canApproveProposal, canSetInquiryOwner, isOwnerScoped } from './permissions';
import type { Staff } from './types';

/** The active Division Head / SOA account with this email (case-insensitive, trimmed), if any. */
export async function ownerForEmail(email:string):Promise<Staff|undefined>{
  const wanted=(email||'').trim().toLowerCase();if(!wanted)return undefined;
  return (await allUsers()).find(person=>person.active&&isOwnerScoped(person)&&person.email.trim().toLowerCase()===wanted);
}
/**
 * Sets or clears the Division Head / SOA who owns an inquiry. Same lock order as the other writes (client keys → lease → row, see client-service.ts):
 * lockedInquiry first, then the lease. Protection that already started moves to the new owner; clearing the owner returns it to the form's agent.
 */
export async function setInquiryOwner(id:string,user:Staff,input:unknown){
  if(!canSetInquiryOwner(user))throw new AppError('Your role cannot link an inquiry to a Division Head or SOA.',403);
  const body=z.object({revision:z.number().int(),ownerId:z.string().max(100).nullable()}).strict().parse(input);
  return await transaction(async()=>{
    const record=await lockedInquiry(id);
    if(record.revision!==body.revision)throw new AppError('This inquiry changed. Reload before changing the owner.',409);
    await db.lock('lease:'+id);
    if(await colleagueHolding(id,user))throw new AppError('A colleague is handling this inquiry.',423);
    const owner=body.ownerId?(await allUsers()).find(person=>person.id===body.ownerId&&person.active&&isOwnerScoped(person)):undefined;
    if(body.ownerId&&!owner)throw new AppError('Choose an active Division Head or SOA as the owner.',422);
    if((record.ownerId||null)===(owner?.id||null))return record;
    // Moving a client between owners, or once protection has started, transfers protection: that needs an approver,
    // like any other agent change. Employees may only link an owner to an unowned, unprotected inquiry.
    if((record.ownerId||record.protection)&&!canApproveProposal(user))throw new AppError('Only the Head or an approving supervisor can change the owner once a client is linked or protected.',403);
    const before=record.ownerId||'',revision=record.revision,divisionBefore=record.fields.division||'';
    if(owner){applyOwner(record,owner);}
    else{
      applyOwner(record,null);
      if(record.protection){const src=record.source.fields;record.protection={...record.protection,agentName:src.agentName?.trim()||record.fields.agentName||'Agent',agentEmail:src.agentEmail?.trim()||record.fields.agentEmail||'',agentPhone:src.agentPhone?.trim()||record.fields.agentPhone||''};}
    }
    audit(record,user,owner?'Linked this client to '+owner.name+' ('+owner.role+')':'Removed the Division Head / SOA link',[{field:'ownerId',before,after:owner?.id||''},...(record.fields.division!==divisionBefore?[{field:'division',before:divisionBefore,after:record.fields.division||''}]:[])]);
    await persist(record,revision);
    if(owner)await notify(record,'Client linked to you',(record.fields.company||record.id)+' is now in My Clients.',[owner.id],true);
    return record;
  });
}
