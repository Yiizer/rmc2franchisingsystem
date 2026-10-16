import { requireInquiryHandler } from './activity';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AppError, allUsers, audit, catalog, dataRoot, db, inquiry, notify, persist, safeStorage, sourceFile, transaction } from './database';
import { canPrepareProposal, documentIssues, defaultEmail, editableStatus, LABELS } from './types';
import type { CatalogTemplate, FormFields, InquiryRecord, MailDraft, Notice, Staff, Submission } from './types';
import { proposalChecks, proposalFields } from './proposal-fields';
import { nextWorkAction } from './work-progress';
import { customDocument, customEditsSchema } from './custom-documents';
import { fingerprint, generatePackage } from './documents';
import { parseForm, preservePdfForm } from './forms';
import { packageRenderer } from './package-rendering';
import { getProposalHelp, PROPOSAL_HELP_PROMPTS, suggestTemplates } from './suggestions';

export function checkRevision(record:InquiryRecord,revision:unknown) { if(record.revision!==revision)throw new AppError('This inquiry changed in another session. Reload before continuing.',409); }
function canPrepare(user:Staff) { if(!canPrepareProposal(user))throw new AppError('Use an Employee or Supervisor account to prepare and submit proposals.',403); }
function canReview(user:Staff) { if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('This account does not have proposal approval permission.',403); }
export function chosen(record:InquiryRecord):CatalogTemplate|undefined { return catalog().find(t=>t.id===record.templateId&&t.active); }
const draftSchema=z.object({customization:z.object({id:z.string().uuid(),edits:customEditsSchema}).strict().nullable().optional(),revision:z.number().int(),fields:z.record(z.string().max(3000)),templateId:z.string().max(100),notes:z.string().max(10000),email:z.object({to:z.string().max(254),subject:z.string().max(250),body:z.string().max(20000)}),emailOverrides:z.array(z.enum(['to','subject','body'])).max(3),checkpoint:z.object({step:z.number().int().min(0).max(2),paused:z.boolean()}).optional()});
const mailSchema=z.object({to:z.string().email(),subject:z.string().min(1).max(250).refine(v=>!/[\r\n]/.test(v),'Email subject must be one line'),body:z.string().min(1).max(20000)});

function workReminder(record:InquiryRecord,user:Staff,paused:boolean){
  const rows=db().prepare('SELECT id,data FROM notifications').all() as {id:string;data:string}[];
  const existing=rows.filter(row=>{const n=JSON.parse(row.data) as Notice;return n.inquiryId===record.id&&n.title==='Pick up where you left off'&&n.recipientIds.includes(user.id);});
  if(!paused){for(const row of existing)db().prepare('DELETE FROM notifications WHERE id=?').run(row.id);return;}
  const message=`${record.fields.company||record.id} · ${nextWorkAction(record,chosen(record))}. Your draft is saved.`;
  if(existing.length){const n=JSON.parse(existing[0].data) as Notice;n.message=message;n.at=new Date().toISOString();n.readBy=[];db().prepare('UPDATE notifications SET data=? WHERE id=?').run(JSON.stringify(n),n.id);}
  else notify(record,'Pick up where you left off',message,[user.id]);
}
function preparationIssues(record:InquiryRecord,template?:CatalogTemplate){return [...documentIssues(record.fields,template,!!record.customization),...proposalChecks(record.fields,record.source.fields,record.customization?undefined:template).filter(check=>check.kind==='error').map(check=>(LABELS[check.field]||'Proposal')+': '+check.message)];}

export function customize(id:string,user:Staff,input:unknown){
  canPrepare(user);const body=z.object({revision:z.number().int(),templateId:z.string().max(100)}).parse(input);
  return transaction(()=>{const record=inquiry(id);checkRevision(record,body.revision);if(!editableStatus(record.status))throw new AppError('Return this proposal for correction before customizing it.',409);requireInquiryHandler(id,user);
    const template=catalog().find(t=>t.id===body.templateId&&t.active);if(!template)throw new AppError('Choose an available proposal template.');
    if(record.customization?.templateId===template.id)return record;
    if(record.customization)record.customizationArchive=[...(record.customizationArchive||[]),structuredClone(record.customization)];
    const at=new Date().toISOString();record.templateId=template.id;record.customization={id:randomUUID(),templateId:template.id,sourceHash:template.sourceHash,edits:{},createdAt:at,createdBy:user.id,updatedAt:at,updatedBy:user.id};record.status='Preparing proposal';
    const automatic=defaultEmail(record.fields,template,user.name);for(const key of ['to','subject','body'] as const)if(!record.emailOverrides.includes(key))record.email[key]=automatic[key];
    audit(record,user,'Created CUSTOMIZED copy of '+template.name);persist(record,body.revision);return record;
  });
}

export function saveDraft(id:string,user:Staff,input:unknown) {
  canPrepare(user);const body=draftSchema.parse(input);
  return transaction(()=>{
    const record=inquiry(id);checkRevision(record,body.revision);
    if(!editableStatus(record.status))throw new AppError('This version is locked for review or has already been approved.',409);requireInquiryHandler(id,user);
    const unknown=Object.keys(body.fields).filter(key=>!(key in LABELS));if(unknown.length)throw new AppError('Unknown form fields: '+unknown.join(', '));
    if(body.templateId&&!catalog().some(t=>t.id===body.templateId&&t.active))throw new AppError('Choose an available proposal master.');
    const revision=record.revision;
    const customizationChanges:{field:string;before:string;after:string}[]=[];
    if(body.customization){
      const custom=record.customization,master=catalog().find(t=>t.id===body.templateId);
      if(!custom||custom.id!==body.customization.id||custom.templateId!==body.templateId||!master||custom.sourceHash!==master.sourceHash)throw new AppError("Reload the customized copy before saving edits.",409);
      customDocument(readFileSync(sourceFile(master)),body.customization.edits);
      for(const key of new Set([...Object.keys(custom.edits),...Object.keys(body.customization.edits)])){const before=custom.edits[key],after=body.customization.edits[key];if(JSON.stringify(before)!==JSON.stringify(after))customizationChanges.push({field:"Customized content · "+key,before:before?JSON.stringify(before):"Original template content",after:after?JSON.stringify(after):"Restored template content"});}
      custom.edits=body.customization.edits;custom.updatedAt=new Date().toISOString();custom.updatedBy=user.id;
    }else if(record.customization&&(body.customization===null||body.templateId!==record.templateId)){
      record.customizationArchive=[...(record.customizationArchive||[]),structuredClone(record.customization)];delete record.customization;customizationChanges.push({field:"Proposal mode",before:"Customized",after:"Standard template"});
    }
    const changes=Object.entries(body.fields).filter(([key,value])=>record.fields[key]!==value).map(([field,after])=>({field:LABELS[field]||field,before:record.fields[field]||'',after}));
    changes.push(...customizationChanges);
    if(record.templateId!==body.templateId)changes.push({field:'Proposal template',before:record.templateId,after:body.templateId});
    if(record.notes!==body.notes)changes.push({field:'Internal notes',before:record.notes,after:body.notes});
    for(const key of ['to','subject','body'] as const)if(record.email[key]!==body.email[key]&&body.emailOverrides.includes(key))changes.push({field:'Email '+key,before:record.email[key],after:body.email[key]});
    record.fields=proposalFields(body.fields,record.source.fields);record.templateId=body.templateId;record.notes=body.notes;record.emailOverrides=[...new Set(body.emailOverrides)];
    if(body.checkpoint)record.workProgress={...record.workProgress,[user.id]:{...body.checkpoint,at:new Date().toISOString()}};
    const automatic=defaultEmail(record.fields,chosen(record),user.name);
    record.email=Object.fromEntries((['to','subject','body'] as const).map(key=>[key,record.emailOverrides.includes(key)?body.email[key]:automatic[key]])) as MailDraft;
    if(record.status==='New inquiry'||record.status==='Waiting for agent details')record.status='Preparing proposal';
    audit(record,user,body.checkpoint?.paused?'Paused preparation — draft saved':changes.length?'Updated inquiry details':'Started / saved proposal preparation',changes.length?changes:undefined);persist(record,revision);workReminder(record,user,!!body.checkpoint?.paused);return record;
  });
}
export async function generate(id:string,user:Staff,revision:number) {
  canPrepare(user);const record=inquiry(id);checkRevision(record,revision);
  if(!editableStatus(record.status))throw new AppError('The submitted version cannot be regenerated.',409);requireInquiryHandler(id,user);
  const template=chosen(record);const issues=preparationIssues(record,template);if(issues.length)throw new AppError('Complete these before generating: '+issues.join('; '));
  const generated=await generatePackage(id,template!,record.fields,user.id,record.customization);
  return transaction(()=>{const fresh=inquiry(id);checkRevision(fresh,revision);if(!editableStatus(fresh.status))throw new AppError('This proposal was submitted while generation was running.',409);requireInquiryHandler(id,user);fresh.generated=generated;fresh.status='Preparing proposal';const automatic=defaultEmail(fresh.fields,template,user.name);for(const key of ['to','subject','body'] as const)if(!fresh.emailOverrides.includes(key))fresh.email[key]=automatic[key];audit(fresh,user,'Generated '+(fresh.customization?'CUSTOMIZED ':'')+'proposal PDF, Word document and agent email from '+template!.sourceId);persist(fresh,revision);return fresh;});
}
export function submit(id:string,user:Staff,revision:number) {
  canPrepare(user);
  return transaction(()=>{const record=inquiry(id);checkRevision(record,revision);if(!editableStatus(record.status))throw new AppError('This proposal has already been submitted.',409);requireInquiryHandler(id,user);const template=chosen(record),issues=preparationIssues(record,template);if(issues.length)throw new AppError('Resolve these before submission: '+issues.join('; '));if(!record.generated||record.generated.fingerprint!==fingerprint(record.fields,template!,record.customization))throw new AppError('Generate an updated proposal before submitting.');if(['browser-print','native-word-legacy'].includes(packageRenderer(record.generated)))throw new AppError('Update the PDF & email before submitting this earlier layout.');mailSchema.parse(record.email);if(record.email.to!==record.fields.agentEmail&&!record.emailOverrides.includes('to'))throw new AppError('Confirm the agent reply recipient.');const warnings=[...(record.customization?["CUSTOMIZED proposal — review all content edits against the original master"]:[]),...template!.warnings,...(record.customization?documentIssues(record.fields,template).filter(issue=>!documentIssues(record.fields,template,true).includes(issue)):[]),...proposalChecks(record.fields,record.source.fields,template).filter(check=>check.kind==='changed').map(check=>'Verify '+(LABELS[check.field]||check.field)+': '+(check.original||'(blank)')+' → '+(check.current||'(blank)')),...record.emailOverrides.map(key=>'Edited email '+key)];const version=record.submissions.length+1;record.submissions.push({version,at:new Date().toISOString(),submittedBy:user.id,fields:{...record.fields},email:{...record.email},emailOverrides:[...record.emailOverrides],generated:{...record.generated},notes:record.notes,warnings});record.status='Awaiting approval';for(const staff of allUsers())workReminder(record,staff,false);record.returnNote='';record.returnFlags=[];audit(record,user,'Submitted proposal v'+version+' to Emerson and Zeo');persist(record,revision);db().prepare('DELETE FROM inquiry_activity WHERE inquiry_id=?').run(id);notify(record,record.customization?'Customized proposal awaiting approval':'Proposal awaiting approval',`${user.name} submitted ${record.fields.company} · v${version}.`,allUsers().filter(u=>u.active&&u.canApprove&&u.role==='Supervisor').map(u=>u.id));return record;});
}
export async function decide(id:string,user:Staff,input:unknown) {
  canReview(user);const body=z.object({revision:z.number().int(),version:z.number().int(),action:z.enum(['approve','return']),note:z.string().max(10000),flags:z.array(z.string().max(150)).max(30),failSend:z.boolean().optional(),customizationReviewed:z.boolean().optional()}).parse(input);
  const result=transaction(()=>{
    const record=inquiry(id);checkRevision(record,body.revision);const latest=record.submissions.at(-1);
    if(record.status!=='Awaiting approval'||!latest||latest.version!==body.version||latest.decision)throw new AppError('Another reviewer has already decided this proposal. Refresh the queue.',409);
    if(body.action==='approve'&&latest.generated.customization&&!body.customizationReviewed)throw new AppError('Review and acknowledge the customized content before approving.');
    if(body.action==='approve'&&latest.generated.customization&&body.flags.some(flag=>flag.startsWith('Custom edit ')))throw new AppError('Return flagged customized edits for correction before approving.');
    if(body.action==='return'&&!body.note.trim())throw new AppError('Add a correction note before returning the proposal.');
    latest.decision={action:body.action,actorId:user.id,at:new Date().toISOString(),note:body.note,flags:body.flags,...(latest.generated.customization?{customizationReviewed:body.action==='approve'&&!!body.customizationReviewed}:{})};
    if(body.action==='return'){record.status='Needs correction';record.returnNote=body.note;record.returnFlags=body.flags;audit(record,user,'Returned proposal v'+latest.version+' for correction: '+body.note);notify(record,'Proposal needs correction',body.note,[latest.submittedBy]);}
    else{record.status='Approved — sending';audit(record,user,'Approved proposal v'+latest.version+' — automatic agent reply queued');notify(record,'Proposal approved',`${user.name} approved v${latest.version}. The agent reply is being prepared.`,[latest.submittedBy]);const outboxId=randomUUID();db().prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?)').run(outboxId,id,latest.version,'proposal','ready',JSON.stringify({id:outboxId,createdAt:new Date().toISOString(),email:latest.email,pdf:latest.generated.pdf,filename:latest.generated.filename,error:''}));}
    persist(record,body.revision);return record;
  });
  if(body.action==='approve')await deliver(id,result.submissions.at(-1)!.version,user,!!body.failSend);
  return inquiry(id);
}
const running=new Set<string>();
async function deliver(id:string,version:number,user:Staff,fail=false) {
  const row=db().prepare("SELECT id,status,data FROM outbox WHERE inquiry_id=? AND version=? AND kind='proposal'").get(id,version) as {id:string;status:string;data:string}|undefined;
  if(!row)throw new AppError('Approved email package not found.',409);
  if(running.has(row.id))throw new AppError('This approved reply is already being delivered.',409);
  running.add(row.id);
  try{
    const mail=JSON.parse(row.data);const file='outbox/'+row.id+'.eml';
    if(fail)throw new Error('Local delivery failure requested for testing. The approved package is preserved.');
    // A stable outbox id/file is reused on recovery; a lost HTTP response cannot create a second local reply.
    if(!existsSync(safeStorage(file)))writeMail(file,mail.email,readFileSync(safeStorage(mail.pdf)),mail.filename+'.pdf',row.id);
    transaction(()=>{const record=inquiry(id),revision=record.revision,latest=record.submissions.find(s=>s.version===version);if(!latest||latest.decision?.action!=='approve')throw new AppError('No approval exists for this package.',409);if(latest.delivery)return;latest.delivery={id:row.id,at:new Date().toISOString(),mode:'local-test',file};record.status='Sent';audit(record,user,'Approved proposal v'+version+' delivered to the local test mailbox');persist(record,revision);db().prepare('UPDATE outbox SET status=?,data=? WHERE id=?').run('sent',JSON.stringify({...mail,file,error:''}),row.id);notify(record,'Approved reply sent — local test',`${latest.email.to} · proposal v${version}. No real Gmail message was sent.`,[latest.submittedBy]);});
  }catch(error){transaction(()=>{const record=inquiry(id),revision=record.revision,latest=record.submissions.find(s=>s.version===version);if(latest?.delivery)return;record.status='Approved — email failed';audit(record,user,'Approved email could not be delivered: '+(error as Error).message);persist(record,revision);db().prepare('UPDATE outbox SET status=?,data=? WHERE id=?').run('failed',JSON.stringify({...JSON.parse(row.data),error:(error as Error).message}),row.id);if(latest)notify(record,'Approved email needs attention',(error as Error).message,[latest.submittedBy]);});
  }finally{running.delete(row.id);}
}
export async function retry(id:string,user:Staff,revision:number) { const record=inquiry(id);checkRevision(record,revision);if(!['Approved — email failed','Approved — sending'].includes(record.status))throw new AppError('There is no failed or unfinished approved reply to retry.',409);await deliver(id,record.submissions.at(-1)!.version,user);return inquiry(id); }
function writeMail(relative:string,email:MailDraft,pdf?:Buffer,filename?:string,messageId:string=randomUUID()) {
  mailSchema.parse(email);mkdirSync(path.join(dataRoot,'outbox'),{recursive:true});
  const boundary='rmc2-'+messageId;
  const lines=[`From: RMC2 Franchising <franchising@rmc2.local>`,`To: ${email.to}`,`Subject: =?UTF-8?B?${Buffer.from(email.subject).toString('base64')}?=`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${messageId}@rmc2.local>`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(email.body).toString('base64')];
  if(pdf)lines.push(`--${boundary}`,'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${filename}"`,'Content-Transfer-Encoding: base64','',pdf.toString('base64').match(/.{1,76}/g)!.join('\r\n'));
  lines.push(`--${boundary}--`,'');writeFileSync(safeStorage(relative),lines.join('\r\n'));
}
export function requestDetails(id:string,user:Staff,input:unknown) {
  canPrepare(user);const body=z.object({revision:z.number().int(),body:z.string().min(1).max(20000)}).parse(input);
  return transaction(()=>{const record=inquiry(id);checkRevision(record,body.revision);if(!editableStatus(record.status))throw new AppError('The submitted proposal is locked.',409);requireInquiryHandler(id,user);const file='outbox/'+randomUUID()+'.eml';writeMail(file,{to:record.fields.agentEmail,subject:'Details needed — '+record.fields.company,body:body.body});record.detailRequests.push({at:new Date().toISOString(),actorId:user.id,to:record.fields.agentEmail,body:body.body,file});record.status='Waiting for agent details';audit(record,user,'Requested missing information from the agent — local test mailbox');persist(record,body.revision);return record;});
}
export async function intake(user:Staff,file:File,sender:string) {
  if(user.role==='Supervisor')throw new AppError('Use an employee or admin account to import an inquiry.',403);
  if(!z.string().email().safeParse(sender).success)throw new AppError('Enter the agent sender/reply email.');
  const filename=file.name.toLowerCase(),bytes=Buffer.from(await file.arrayBuffer());
  if(!filename.endsWith('.xlsx')&&!filename.endsWith('.pdf'))throw new AppError('Upload the agent’s submitted form as an Excel (.xlsx) or PDF (.pdf) attachment.');
  const source=filename.endsWith('.pdf')?await preservePdfForm(bytes,file.name,sender):await parseForm(bytes,file.name,sender);
  return transaction(()=>{const max=inquiriesMax(),at=new Date().toISOString();const record:InquiryRecord={id:'INQ-'+new Date().getFullYear()+'-'+String(max+1).padStart(5,'0'),revision:1,status:'New inquiry',createdAt:at,updatedAt:at,fields:{...source.fields},source,email:defaultEmail(source.fields),emailOverrides:[],templateId:'',submissions:[],handledBy:[],history:[{id:randomUUID(),at,actorId:user.id,actor:user.name,action:'Imported agent email form. All active staff notified.'}],chat:[],notes:'',returnNote:'',returnFlags:[],detailRequests:[]};persist(record);notify(record,'New inquiry',`${record.fields.company||'Agent request'} is ready for form review.`,allUsers().filter(u=>u.active).map(u=>u.id));return record;});
}
function inquiriesMax() { const rows=db().prepare('SELECT id FROM inquiries').all() as {id:string}[];return Math.max(129,...rows.map(r=>Number(r.id.split('-').at(-1))||0)); }
export function alternatives(record:InquiryRecord) { return suggestTemplates(record.fields,catalog()).map(option=>option.template); }
export function chat(id:string,user:Staff,input:unknown) {
  canPrepare(user);
  const body=z.object({revision:z.number().int(),question:z.enum([PROPOSAL_HELP_PROMPTS.suggest,PROPOSAL_HELP_PROMPTS.explain,PROPOSAL_HELP_PROMPTS.compare])}).parse(input);
  return transaction(()=>{const record=inquiry(id);checkRevision(record,body.revision);
    requireInquiryHandler(id,user);
    const topic=body.question===PROPOSAL_HELP_PROMPTS.explain?'explain':body.question===PROPOSAL_HELP_PROMPTS.compare?'compare':'suggest';
    const result=getProposalHelp(record.fields,catalog(),record.templateId,topic);
    if(topic==='explain'&&!result.items.length)throw new AppError('Choose a proposal template to explain first.');
    const answer=[result.title,result.description,...result.items.map(({template,reasons})=>[template.name,...(topic==='compare'?['Program: '+template.family,'Variant: '+template.variant]:reasons),...template.warnings,'Source: '+template.sourceId+' — '+template.sourceName].join('\n')),result.note].join('\n\n');
    const sources=result.items.map(item=>item.template.id);
    const at=new Date().toISOString();record.chat.push({id:randomUUID(),at,role:'user',text:body.question,actorId:user.id,sources:[]},{id:randomUUID(),at,role:'assistant',text:answer,actorId:'assistant',sources});const revision=record.revision;if(user.role==='Employee')audit(record,user,'Used proposal assistant: '+body.question);else {record.revision++;record.updatedAt=at;}persist(record,revision);return record;});
}
