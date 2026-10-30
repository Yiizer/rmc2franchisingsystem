import { randomUUID } from 'node:crypto';
import { allUsers, AppError, audit, catalog, db, inquiry, notify, persist, transaction } from './database';
import { assertClientReady } from './client-service';
import { requireInquiryHandler } from './activity';
import type { Staff } from './types';
import { z } from 'zod';

export function beginSupervisorEdit(id:string,user:Staff,input:unknown){
  if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('An approving supervisor is required.',403);
  const body=z.object({revision:z.number().int(),version:z.number().int()}).strict().parse(input);
  return transaction(()=>{
    const record=inquiry(id);if(record.revision!==body.revision)throw new AppError('Reload the latest submitted version.',409);assertClientReady(record);
    const latest=record.submissions.at(-1);
    if(record.status!=='Awaiting approval'||!latest||latest.version!==body.version||latest.decision)throw new AppError('This proposal is no longer awaiting a decision.',409);
    const template=catalog().find(template=>template.id===latest.generated.templateId);
    if(!template||!latest.generated.sourceDocx)throw new AppError('This older package needs to be returned for preparation from an available master.',409);
    record.supervisorEdit={by:user.id,at:new Date().toISOString(),version:latest.version};
    record.fields=structuredClone(latest.fields);record.email=structuredClone(latest.email);record.emailOverrides=[...latest.emailOverrides];record.templateId=latest.generated.templateId;record.generated=structuredClone(latest.generated);record.notes=latest.notes;
    if(record.customization)record.customizationArchive=[...(record.customizationArchive||[]),structuredClone(record.customization)];
    const at=new Date().toISOString();
    // A separate editable copy retains the submitted master. The submitted PDF remains frozen.
    record.customization={id:randomUUID(),templateId:record.templateId,sourceHash:latest.generated.sourceHash,edits:structuredClone(latest.generated.customization?.edits||{}),createdAt:at,createdBy:user.id,updatedAt:at,updatedBy:user.id};
    record.status='Supervisor editing';audit(record,user,'Opened supervisor edits from submitted version '+latest.version);persist(record,body.revision);
    notify(record,'Supervisor is editing the proposal',user.name+' is preparing a reviewed version.',[latest.submittedBy,...allUsers().filter(person=>person.canApprove).map(person=>person.id)]);return record;
  });
}
export function cancelSupervisorEdit(id:string,user:Staff,input:unknown){
  const body=z.object({revision:z.number().int()}).strict().parse(input);
  if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('An approving supervisor is required.',403);
  return transaction(()=>{
    const record=inquiry(id);if(record.revision!==body.revision||record.status!=='Supervisor editing')throw new AppError('Reload the proposal before canceling edits.',409);assertClientReady(record);requireInquiryHandler(id,user);
    const latest=record.submissions.at(-1)!;
    if(record.customization)record.customizationArchive=[...(record.customizationArchive||[]),structuredClone(record.customization)];
    record.fields=structuredClone(latest.fields);record.email=structuredClone(latest.email);record.emailOverrides=[...latest.emailOverrides];record.generated=structuredClone(latest.generated);record.templateId=latest.generated.templateId;record.customization=latest.generated.customization?structuredClone(latest.generated.customization):undefined;record.notes=latest.notes;
    delete record.supervisorEdit;record.status='Awaiting approval';audit(record,user,'Canceled supervisor edits; retained submitted version '+latest.version);persist(record,body.revision);db().prepare('DELETE FROM inquiry_activity WHERE inquiry_id=?').run(id);return record;
  });
}
