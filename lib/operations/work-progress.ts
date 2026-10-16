import { editableStatus } from './types';
import { currentRecordProposal } from './proposal-state';
import type { CatalogTemplate, InquiryRecord } from './types';

export function workStep(record:InquiryRecord, userId:string) {
  if(!editableStatus(record.status))return 2;
  return record.workProgress?.[userId]?.step ?? (record.generated?2:record.templateId?1:0);
}
export function nextWorkAction(record:InquiryRecord,template?:Pick<CatalogTemplate,'sourceHash'>) {
  if(record.status==='Needs correction')return 'Correct the proposal';
  if(record.status==='Waiting for agent details')return 'Check missing details';
  if(!record.templateId)return 'Choose a proposal';
  if(!record.generated)return 'Finish proposal details';
  const changed=!currentRecordProposal(record,template);
  return changed?'Update the proposal':'Send to supervisor';
}
export function unfinishedWork(record:InquiryRecord,userId:string) {
  return editableStatus(record.status)&&(!!record.workProgress?.[userId]||record.handledBy.includes(userId));
}
