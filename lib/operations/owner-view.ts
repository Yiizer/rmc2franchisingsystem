import { createHash } from 'node:crypto';
import { AppError, db, jsonParam, emitNotice } from './database';
import { clientState, hasPendingReport, lastActivityAt, protectionDaysLeft, protectionFor, protectionExpired } from './client-rules';
import { synchronizeInquiryIndex, matchingInquiries } from './inquiry-index';
import { isOwnerScoped } from './permissions';
import { jsonText } from './sql-dialect';
import { reportStatus } from './types';
import type { ClientState, InquiryRecord, Notice, Staff } from './types';

// Everything a Division Head / SOA may see. Nothing here returns an InquiryRecord: each value is copied field by field into a small DTO, so a field
// added to the record later can never leak by accident. NOT in the DTO: notes, chat, history, other agents, client-review matches, other inquiries'
// ids, staff or internal fields, email bodies, customization, storage paths.

export type OwnerReport = { id:string; submittedAt:string; summary:string; reference:string; status:'pending'|'approved'|'rejected'; decidedAt:string|null; rejectReason:string|null; hasAttachment:boolean };
export type OwnerClient = {
  id:string; client:string; status:string; createdAt:string; lastActivityAt:string; division:string; branch:string;
  protection:{ startedAt:string; expiresAt:string; daysLeft:number; held:boolean }|null;
  progressReports:OwnerReport[]; hasSentProposal:boolean; sentAt:string|null;
};
export type OwnerNotice = { id:string; inquiryId:string; title:string; message:string; at:string; read:boolean };
export type OwnerUser = Pick<Staff,'id'|'name'|'email'|'role'|'position'|'division'|'phone'|'username'|'mustChangePassword'>;

export const ownerUser=(user:Staff):OwnerUser=>({id:user.id,name:user.name,email:user.email,role:user.role,position:user.position,division:user.division,phone:user.phone,username:user.username,mustChangePassword:user.mustChangePassword});
const notFound=()=>new AppError('Not found',404);
const sentSubmission=(record:InquiryRecord)=>record.submissions.filter(item=>item.delivery&&!item.delivery.dryRun).at(-1);

/** Short, owner-facing label for the internal status. */
export function ownerStatusLabel(record:InquiryRecord,state:ClientState):string{
  if(state.state==='duplicate'&&!record.closure)return 'Already protected';
  if(record.closure)return record.closure.kind==='transferred'?'Transferred':'Closed';
  if(state.state==='archived')return 'Protection expired';
  if(state.state==='identify')return 'Received';
  switch(record.status){
    case 'New inquiry':return 'Received';
    case 'Preparing proposal':case 'Needs correction':return 'Preparing proposal';
    case 'Waiting for agent details':return 'Waiting for your details';
    case 'Awaiting approval':case 'Supervisor editing':return 'Proposal under review';
    case 'Approved — sending':case 'Approved — email failed':return 'Proposal approved';
    case 'Sent':return 'Enrolled';
    case 'Declined':return 'Closed';
    case 'Transferred':return 'Transferred';
    default:return 'Received';
  }
}
export function ownerClientDto(record:InquiryRecord,state:ClientState,now=Date.now()):OwnerClient{
  const protection=protectionFor(record),sent=sentSubmission(record);
  return {
    id:record.id,client:record.fields.company||'Client details pending',status:ownerStatusLabel(record,state),createdAt:record.createdAt,lastActivityAt:lastActivityAt(record),
    division:record.fields.division||'',branch:record.fields.branch||'',
    protection:protection?{startedAt:protection.startedAt,expiresAt:protection.expiresAt,daysLeft:protectionDaysLeft(protection,now),held:hasPendingReport(record)}:null,
    progressReports:(record.progressReports||[]).map(report=>({id:report.id,submittedAt:report.recordedAt,summary:report.summary,reference:report.reference,status:reportStatus(report),decidedAt:report.decidedAt||null,rejectReason:reportStatus(report)==='rejected'?report.rejectReason||null:null,hasAttachment:!!report.attachment})).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)),
    hasSentProposal:!!sent,sentAt:sent?.delivery?.at||null,
  };
}
async function owned(user:Staff):Promise<InquiryRecord[]>{
  if(!isOwnerScoped(user))throw new AppError('Not allowed.',403);
  const rows=await db.all<{data:string}>(`SELECT data FROM inquiries WHERE ${jsonText(db,'data','ownerId')}=?`,user.id);
  return rows.map(row=>JSON.parse(row.data) as InquiryRecord).filter(record=>record.ownerId===user.id);
}
async function dtos(records:InquiryRecord[]):Promise<OwnerClient[]>{
  await synchronizeInquiryIndex(); // a write: before the reads below
  const now=Date.now(),result:OwnerClient[]=[];
  for(const record of records)result.push(ownerClientDto(record,clientState(record,await matchingInquiries(record,false),now),now));
  return result.sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt)||a.id.localeCompare(b.id));
}
/**
 * At most one in-app reminder per client per threshold (7 and 2 days left). The notification id is derived from client + expiry + threshold and
 * inserted with ON CONFLICT DO NOTHING, so loading the app any number of times (or from two devices) creates it once, and it comes back only after
 * an approved report moves the expiry. When first seen already inside 2 days, only the 2-day reminder is created.
 */
export async function ownerReminders(user:Staff,records:InquiryRecord[],now=Date.now()){
  for(const record of records){
    const protection=protectionFor(record);
    if(!protection||record.closure||hasPendingReport(record)||protectionExpired(record,protection,now))continue;
    const days=protectionDaysLeft(protection,now),threshold=days<=2?2:days<=7?7:0;
    if(!threshold)continue;
    const id='reminder-'+createHash('sha256').update([record.id,protection.expiresAt,threshold].join('|')).digest('hex').slice(0,40);
    const notice:Notice={id,inquiryId:record.id,title:'Protection ending soon',message:`${record.fields.company||'Your client'} · protection ends in ${days} day${days===1?'':'s'}. File a progress report to renew it.`,at:new Date(now).toISOString(),recipientIds:[user.id],readBy:[]};
    const inserted=await db.run('INSERT INTO notifications(id,data) VALUES (?,?) ON CONFLICT (id) DO NOTHING',id,jsonParam(notice));
    if(inserted.changes)await emitNotice(notice,record.fields.company||'');
  }
}
export async function listOwnerClients(user:Staff){
  const records=await owned(user);await ownerReminders(user,records);
  return dtos(records);
}
export async function ownerClient(user:Staff,id:string):Promise<OwnerClient>{
  const row=await db.get<{data:string}>('SELECT data FROM inquiries WHERE id=?',id);
  const record=row?JSON.parse(row.data) as InquiryRecord:undefined;
  // Missing and not-yours look identical.
  if(!isOwnerScoped(user)||!record||record.ownerId!==user.id)throw notFound();
  return (await dtos([record]))[0];
}
async function ownedRecord(user:Staff,id:string){
  const row=await db.get<{data:string}>('SELECT data FROM inquiries WHERE id=?',id);
  const record=row?JSON.parse(row.data) as InquiryRecord:undefined;
  if(!isOwnerScoped(user)||!record||record.ownerId!==user.id)throw notFound();
  return record;
}
/** The delivered proposal PDF only (never a draft or a submission waiting for approval). */
export async function ownerProposalFile(user:Staff,id:string){
  const record=await ownedRecord(user,id),sent=sentSubmission(record);
  if(!sent?.generated.pdf)throw notFound();
  return {record,storage:sent.generated.pdf,name:(sent.generated.filename||'Proposal')+'.pdf'};
}
export async function ownerReportFile(user:Staff,id:string,reportId:string){
  const record=await ownedRecord(user,id),report=record.progressReports?.find(item=>item.id===reportId);
  if(!report?.attachment)throw notFound();
  return {record,attachment:report.attachment};
}
async function ownerNotices(user:Staff,owned:Set<string>):Promise<OwnerNotice[]>{
  const rows=await db.all<{data:string}>('SELECT n.data FROM notice_recipients r JOIN notifications n ON n.id=r.notice_id WHERE r.user_id=? ORDER BY r.at DESC,r.notice_id DESC LIMIT 100',user.id);
  return rows.map(row=>JSON.parse(row.data) as Notice).filter(notice=>notice.recipientIds.includes(user.id)&&owned.has(notice.inquiryId)).slice(0,50)
    .map(notice=>({id:notice.id,inquiryId:notice.inquiryId,title:notice.title,message:notice.message,at:notice.at,read:notice.readBy.includes(user.id)}));
}
/** The whole signed-in payload of a Division Head / SOA: themselves, their own clients and their own notifications. Nothing else. */
export async function ownerBootstrap(user:Staff){
  if(user.mustChangePassword)return {scoped:true as const,user:ownerUser(user),clients:[] as OwnerClient[],notifications:[] as OwnerNotice[],unreadCount:0};
  const records=await owned(user);await ownerReminders(user,records);
  const clients=await dtos(records),notifications=await ownerNotices(user,new Set(records.map(record=>record.id)));
  return {scoped:true as const,user:ownerUser(user),clients,notifications,unreadCount:notifications.filter(notice=>!notice.read).length};
}
/** Response to a Division Head / SOA's own submission. A duplicate reveals nothing about the other client or agent. */
export async function ownerIntakeResult(record:InquiryRecord){
  const client=(await dtos([record]))[0],alreadyProtected=client.status==='Already protected';
  return {client,alreadyProtected,...(alreadyProtected?{message:'This client is already protected.'}:{})};
}
