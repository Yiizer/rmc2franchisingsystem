import type { CatalogTemplate, CustomEdit, CustomizedProposal, FormFields, GeneratedPackage } from './types';

export function sameProposalFields(left:FormFields,right:FormFields){
  return Object.keys({...left,...right}).every(key=>left[key]===right[key]);
}
export function sameProposalEdits(left:Record<string,CustomEdit>={},right:Record<string,CustomEdit>={}){
  return Object.keys({...left,...right}).every(key=>{
    const a=left[key],b=right[key];
    return !!a&&!!b&&Object.keys({...a,...b}).every(property=>a[property as keyof CustomEdit]===b[property as keyof CustomEdit]);
  });
}
export function proposalIsCurrent(fields:FormFields,templateId:string,customization:CustomizedProposal|undefined,generated:GeneratedPackage|undefined,sourceHash?:string){
  return !!generated&&generated.templateId===templateId&&(!sourceHash||generated.sourceHash===sourceHash)&&
    generated.customization?.id===customization?.id&&sameProposalEdits(generated.customization?.edits,customization?.edits)&&sameProposalFields(fields,generated.fields);
}
export function currentRecordProposal(record:{fields:FormFields;templateId:string;customization?:CustomizedProposal;generated?:GeneratedPackage},template?:Pick<CatalogTemplate,'sourceHash'>){
  return proposalIsCurrent(record.fields,record.templateId,record.customization,record.generated,template?.sourceHash);
}
