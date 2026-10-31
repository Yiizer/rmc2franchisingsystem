import { requireInquiryHandler } from './activity';
import { randomUUID, createHash } from 'node:crypto';
import { assertClientReady, startClientProtection, updateClientReview } from './client-service';
import { protectionFor } from './client-rules';
import { isSafeEmail, mailConfig, maskEmail } from './mail-config';
import type { MailConfig } from './mail-config';
import { MAIL_REASONS, MailSendError, mailTransport } from './mail-transport';
import type { DeliveryMode, SendResult } from './mail-transport';
import { z } from 'zod';
import { AppError, allUsers, audit, catalog, db, inquiry, notify, persist, transaction } from './database';
import { isAppError } from './errors';
import { MIME, deleteQuietly, files } from './file-store';
import { templateBytes } from './template-source';
import { canEditInquiry, canPrepareProposal, documentIssues, defaultEmail, LABELS } from './types';
import type { CatalogTemplate, InquiryRecord, MailDraft, Notice, Staff } from './types';
import { proposalChecks, proposalFields } from './proposal-fields';
import { nextWorkAction } from './work-progress';
import { customDocument, customEditsSchema } from './custom-documents';
import { fingerprint, generatePackage } from './documents';
import { parseForm, preservePdfForm } from './forms';
import { cachedRenderer, packageRenderer } from './package-rendering';
import { getProposalHelp, PROPOSAL_HELP_PROMPTS, suggestTemplates } from './suggestions';

export function checkRevision(record:InquiryRecord,revision:unknown) { if(record.revision!==revision)throw new AppError('This inquiry changed in another session. Reload before continuing.',409); }
function canPrepare(user:Staff) { if(!canPrepareProposal(user))throw new AppError('Use an Employee or Supervisor account to prepare and submit proposals.',403); }
function canReview(user:Staff) { if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('This account does not have proposal approval permission.',403); }
export async function chosen(record:InquiryRecord):Promise<CatalogTemplate|undefined> {
  const template=(await catalog()).find(t=>t.id===record.templateId&&(t.active||!!record.supervisorEdit));
  const snapshot=record.supervisorEdit?record.submissions.find(item=>item.version===record.supervisorEdit!.version)?.generated:undefined;
  return template&&snapshot?.sourceDocx?{...template,sourceHash:snapshot.sourceHash,storage:snapshot.sourceDocx,sourceName:snapshot.sourceName||template.sourceName,active:true}:template;
}
const draftSchema=z.object({customization:z.object({id:z.string().uuid(),edits:customEditsSchema}).strict().nullable().optional(),revision:z.number().int(),fields:z.record(z.string().max(3000)),templateId:z.string().max(100),notes:z.string().max(10000),email:z.object({to:z.string().max(254),subject:z.string().max(250),body:z.string().max(20000)}),emailOverrides:z.array(z.enum(['to','subject','body'])).max(3),checkpoint:z.object({step:z.number().int().min(0).max(2),paused:z.boolean()}).optional()});
const mailSchema=z.object({to:z.string().max(254).refine(isSafeEmail,'Enter one valid recipient email address'),subject:z.string().min(1).max(250).refine(v=>!/[\r\n\u2028\u2029\0]/.test(v),'Email subject must be one line'),body:z.string().min(1).max(20000)});

async function workReminder(record:InquiryRecord,user:Staff,paused:boolean){
  const rows=await db.all("SELECT id,data FROM notifications WHERE json_extract(data,'$.inquiryId')=? AND json_extract(data,'$.title')='Pick up where you left off'",record.id) as {id:string;data:string}[];
  const existing=rows.filter(row=>{const n=JSON.parse(row.data) as Notice;return n.inquiryId===record.id&&n.title==='Pick up where you left off'&&n.recipientIds.includes(user.id);});
  if(!paused){for(const row of existing)await db.run('DELETE FROM notifications WHERE id=?',row.id);return;}
  const message=`${record.fields.company||record.id} · ${nextWorkAction(record,await chosen(record))}. Your draft is saved.`;
  if(existing.length){const n=JSON.parse(existing[0].data) as Notice;n.message=message;n.at=new Date().toISOString();n.readBy=[];await db.run('UPDATE notifications SET data=? WHERE id=?',JSON.stringify(n),n.id);}
  else await notify(record,'Pick up where you left off',message,[user.id]);
}
function preparationIssues(record:InquiryRecord,template?:CatalogTemplate){return [...documentIssues(record.fields,template,!!record.customization),...proposalChecks(record.fields,record.source.fields,record.customization?undefined:template).filter(check=>check.kind==='error').map(check=>(LABELS[check.field]||'Proposal')+': '+check.message)];}

export async function customize(id:string,user:Staff,input:unknown){
  canPrepare(user);const body=z.object({revision:z.number().int(),templateId:z.string().max(100)}).parse(input);
  return await transaction(async()=>{const record=await inquiry(id);checkRevision(record,body.revision);await assertClientReady(record);if(record.supervisorEdit)throw new AppError('Edit the supervisor copy already opened for this submission.',409);if(!canEditInquiry(user,record))throw new AppError('Return this proposal for correction before customizing it.',409);await requireInquiryHandler(id,user);
    const template=(await catalog()).find(t=>t.id===body.templateId&&t.active);if(!template)throw new AppError('Choose an available proposal template.');
    if(record.customization?.templateId===template.id&&record.customization.sourceHash===template.sourceHash)return record;
    if(record.customization)record.customizationArchive=[...(record.customizationArchive||[]),structuredClone(record.customization)];
    const at=new Date().toISOString();record.templateId=template.id;record.customization={id:randomUUID(),templateId:template.id,sourceHash:template.sourceHash,edits:{},createdAt:at,createdBy:user.id,updatedAt:at,updatedBy:user.id};record.status='Preparing proposal';
    const automatic=defaultEmail(record.fields,template,user.name);for(const key of ['to','subject','body'] as const)if(!record.emailOverrides.includes(key))record.email[key]=automatic[key];
    audit(record,user,'Created CUSTOMIZED copy of '+template.name);await persist(record,body.revision);return record;
  });
}

export async function saveDraft(id:string,user:Staff,input:unknown) {
  canPrepare(user);const body=draftSchema.parse(input);
  // The customized master is read and validated before the transaction (file I/O never runs inside one). Any error
  // is held and raised at the original position below so the order of checks, and their messages, do not change.
  // The held outcome is tied to the master hash it was computed from; if the master changed by the time the transaction
  // runs, it cannot be trusted (and no file I/O is allowed in there), so the user is asked to reload.
  let earlyHash:string|undefined,earlyError:unknown;
  if(body.customization){
    try{const early=await inquiry(id),master=await chosen(early);earlyHash=master?.sourceHash;if(master)customDocument(await templateBytes(master),body.customization.edits);}
    catch(error){earlyError=error;}
  }
  return await transaction(async()=>{
    const record=await inquiry(id);checkRevision(record,body.revision);await assertClientReady(record,true);
    const registered=protectionFor(record);if(registered&&body.fields.agentEmail?.trim().toLowerCase()!==registered.agentEmail.trim().toLowerCase())throw new AppError('The registered agent cannot be changed during the client protection period.',409);
    if(!canEditInquiry(user,record))throw new AppError('This version is locked for review or has already been approved.',409);await requireInquiryHandler(id,user);
    for(const [label,next,current] of [['agent reply email',body.fields.agentEmail,record.fields.agentEmail],['reply recipient',body.email.to,record.email.to]] as const)if(next&&next!==current&&!isSafeEmail(next))throw new AppError('Enter one valid '+label+' (no commas, semicolons, spaces or brackets).',400);
    const unknown=Object.keys(body.fields).filter(key=>!(key in LABELS));if(unknown.length)throw new AppError('Unknown form fields: '+unknown.join(', '));
    if(record.supervisorEdit&&body.templateId!==record.templateId)throw new AppError('Keep the submitted template during supervisor edits. Return the proposal to change plans.',409);
    if(body.templateId&&!(await catalog()).some(t=>t.id===body.templateId&&(t.active||!!record.supervisorEdit)))throw new AppError('Choose an available proposal template.');
    const revision=record.revision;
    const customizationChanges:{field:string;before:string;after:string}[]=[];
    if(body.customization){
      const custom=record.customization,master=await chosen(record);
      if(!custom||custom.id!==body.customization.id||custom.templateId!==body.templateId||!master||custom.sourceHash!==master.sourceHash)throw new AppError("Reload the customized copy before saving edits.",409);
      if(earlyHash!==master.sourceHash)throw new AppError("Reload the customized copy before saving edits.",409);
      if(earlyError)throw earlyError;
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
    const automatic=defaultEmail(record.fields,await chosen(record),user.name);
    record.email=Object.fromEntries((['to','subject','body'] as const).map(key=>[key,record.emailOverrides.includes(key)?body.email[key]:automatic[key]])) as MailDraft;
    if(record.status==='New inquiry'||record.status==='Waiting for agent details')record.status='Preparing proposal';
    await updateClientReview(record,user);
    audit(record,user,body.checkpoint?.paused?'Paused preparation — draft saved':changes.length?'Updated inquiry details':'Started / saved proposal preparation',changes.length?changes:undefined);await persist(record,revision);await workReminder(record,user,!!body.checkpoint?.paused);return record;
  });
}
export async function generate(id:string,user:Staff,revision:number) {
  canPrepare(user);const record=await inquiry(id);checkRevision(record,revision);await assertClientReady(record);
  if(!canEditInquiry(user,record))throw new AppError('The submitted version cannot be regenerated.',409);await requireInquiryHandler(id,user);
  const template=await chosen(record);const issues=preparationIssues(record,template);if(issues.length)throw new AppError('Complete these before generating: '+issues.join('; '));
  const generated=await generatePackage(id,template!,record.fields,user.id,record.customization);
  // The package files are already stored under fresh keys; if the row cannot be committed they are removed again.
  try{return await transaction(async()=>{const fresh=await inquiry(id);checkRevision(fresh,revision);await assertClientReady(fresh);if(!canEditInquiry(user,fresh))throw new AppError('This proposal was submitted while generation was running.',409);await requireInquiryHandler(id,user);fresh.generated=generated;if(!fresh.supervisorEdit)fresh.status='Preparing proposal';const automatic=defaultEmail(fresh.fields,template,user.name);for(const key of ['to','subject','body'] as const)if(!fresh.emailOverrides.includes(key))fresh.email[key]=automatic[key];audit(fresh,user,'Generated '+(fresh.customization?'CUSTOMIZED ':'')+'proposal PDF, Word document and agent email from '+template!.sourceId);await persist(fresh,revision);return fresh;});}catch(error){await deleteQuietly(generated.docx,generated.pdf);throw error;}
}
export async function submit(id:string,user:Staff,revision:number) {
  canPrepare(user);
  // A legacy package's renderer is found by reading its PDF; do that (file I/O) before the transaction, which then
  // uses the cached answer. A cache miss inside the transaction asks the user to retry.
  const early=await inquiry(id);if(early.generated)await packageRenderer(early.generated,{rethrowTransient:true});
  return await transaction(async()=>{const record=await inquiry(id);checkRevision(record,revision);await assertClientReady(record);if(!canEditInquiry(user,record))throw new AppError('This proposal has already been submitted.',409);await requireInquiryHandler(id,user);const template=await chosen(record),issues=preparationIssues(record,template);if(issues.length)throw new AppError('Resolve these before submission: '+issues.join('; '));if(!record.generated||record.generated.fingerprint!==fingerprint(record.fields,template!,record.customization))throw new AppError('Generate an updated proposal before submitting.');const renderer=cachedRenderer(record.generated);if(!renderer)throw new AppError('The proposal files changed. Reload the inquiry and submit again.',409);if(['browser-print','native-word-legacy'].includes(renderer))throw new AppError('Update the PDF & email before submitting this earlier layout.');mailSchema.parse(record.email);if(record.email.to!==record.fields.agentEmail&&!record.emailOverrides.includes('to'))throw new AppError('Confirm the agent reply recipient.');const warnings=[...(record.customization?["CUSTOMIZED proposal — review all content edits against the original template"]:[]),...template!.warnings,...(record.customization?documentIssues(record.fields,template).filter(issue=>!documentIssues(record.fields,template,true).includes(issue)):[]),...proposalChecks(record.fields,record.source.fields,template).filter(check=>check.kind==='changed').map(check=>'Verify '+(LABELS[check.field]||check.field)+': '+(check.original||'(blank)')+' → '+(check.current||'(blank)')),...record.emailOverrides.map(key=>'Edited email '+key)];const version=record.submissions.length+1,reviewEdit=record.supervisorEdit,originalSubmitter=reviewEdit?record.submissions.at(-1)!.submittedBy:user.id;if(reviewEdit)record.submissions.at(-1)!.supersededBy=version;record.submissions.push({... (reviewEdit?{supervisorRevision:{by:user.id,fromVersion:reviewEdit.version}}:{}),version,at:new Date().toISOString(),submittedBy:originalSubmitter,fields:{...record.fields},email:{...record.email},emailOverrides:[...record.emailOverrides],generated:{...record.generated},notes:record.notes,warnings});delete record.supervisorEdit;record.status='Awaiting approval';for(const staff of await allUsers())await workReminder(record,staff,false);record.returnNote='';record.returnFlags=[];audit(record,user,'Submitted proposal v'+version+' to Emerson and Zeo');await persist(record,revision);await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);await notify(record,record.customization?'Customized proposal awaiting approval':'Proposal awaiting approval',`${user.name} submitted ${record.fields.company} · v${version}.`,(await allUsers()).filter(u=>u.active&&u.canApprove&&u.role==='Supervisor').map(u=>u.id));return record;});
}
export async function decide(id:string,user:Staff,input:unknown) {
  canReview(user);const body=z.object({revision:z.number().int(),version:z.number().int(),action:z.enum(['approve','return']),note:z.string().max(10000),flags:z.array(z.string().max(150)).max(30),failSend:z.boolean().optional(),customizationReviewed:z.boolean().optional()}).parse(input);
  const result=await transaction(async()=>{
    const record=await inquiry(id);checkRevision(record,body.revision);await assertClientReady(record);const latest=record.submissions.at(-1);
    if(record.status!=='Awaiting approval'||!latest||latest.version!==body.version||latest.decision)throw new AppError('Another reviewer has already decided this proposal. Refresh the queue.',409);
    if(body.action==='approve'&&latest.generated.customization&&!body.customizationReviewed)throw new AppError('Review and acknowledge the customized content before approving.');
    if(body.action==='approve'&&latest.generated.customization&&body.flags.some(flag=>flag.startsWith('Custom edit ')))throw new AppError('Return flagged customized edits for correction before approving.');
    if(body.action==='return'&&!body.note.trim())throw new AppError('Add a correction note before returning the proposal.');
    latest.decision={action:body.action,actorId:user.id,at:new Date().toISOString(),note:body.note,flags:body.flags,...(latest.generated.customization?{customizationReviewed:body.action==='approve'&&!!body.customizationReviewed}:{})};
    if(body.action==='return'){record.status='Needs correction';record.returnNote=body.note;record.returnFlags=body.flags;audit(record,user,'Returned proposal v'+latest.version+' for correction: '+body.note);await notify(record,'Proposal needs correction',body.note,[latest.submittedBy]);}
    else{record.status='Approved — sending';audit(record,user,'Approved proposal v'+latest.version+' — automatic agent reply queued');await notify(record,'Proposal approved',`${user.name} approved v${latest.version}. The agent reply is being prepared.`,[latest.submittedBy]);const outboxId=randomUUID();await db.run('INSERT INTO outbox VALUES (?,?,?,?,?,?)',outboxId,id,latest.version,'proposal','ready',JSON.stringify({id:outboxId,createdAt:new Date().toISOString(),email:latest.email,pdf:latest.generated.pdf,filename:latest.generated.filename,error:''}));}
    await persist(record,body.revision);return record;
  });
  if(body.action==='approve')await deliver(id,result.submissions.at(-1)!.version,user,!!body.failSend);
  return await inquiry(id);
}
// ---- Outbound mail (outbox states: ready -> sending -> sent | failed | uncertain) ----
const STALE_SENDING_MS=120000;
type MailFailure={code:string;safeReason:string;uncertain:boolean};
function toFailure(error:unknown):MailFailure{
  if(error instanceof MailSendError)return {code:error.code,safeReason:error.safeReason,uncertain:error.uncertain};
  if(isAppError(error)&&error.status<500)return {code:'BLOCKED',safeReason:error.message,uncertain:false};
  console.error('Mail delivery error',error instanceof Error?error.name:'unknown'); // never the message: it can carry addresses
  return {code:'UNKNOWN',safeReason:MAIL_REASONS.UNKNOWN,uncertain:false};
}
const DRY_RUN_TEXT='Dry run — email built and checked, not sent';
function deliveryText(config:MailConfig,result:SendResult){
  if(result.dryRun)return {audit:DRY_RUN_TEXT,notice:DRY_RUN_TEXT,detail:'Dry run: nothing was sent. Retry to send it for real once dry run is turned off.'};
  if(result.mode==='local-test')return {audit:'delivered to the local test mailbox',notice:'Approved reply sent — local test',detail:'No real Gmail message was sent.'};
  if(result.mode==='smtp-live')return {audit:'sent by email to the agent',notice:'Approved reply sent',detail:'Sent to the agent.'};
  const to=config.redirectTo.map(maskEmail).join(', ');
  return {audit:'sent by email to the TEST inbox ('+to+') — redirected, the agent received nothing',notice:'Approved reply sent — test inbox',detail:'Redirected to '+to+'. The agent received nothing.'};
}
const attemptMode=(config:MailConfig):DeliveryMode=>config.mode==='smtp'?(config.env==='production'?'smtp-live':'smtp-redirected'):'local-test';
const maskedRedirect=(config:MailConfig)=>config.mode==='smtp'&&config.env!=='production'&&config.redirectTo.length?config.redirectTo.map(maskEmail).join(', '):'';
/** Caps are counted per attempt (including failures) in SQLite, so a restart cannot reset them. */
async function reserveSend(config:MailConfig,kind:string,outboxId:string){
  if(config.mode!=='smtp'||config.dryRun)return;
  await db.exec('CREATE TABLE IF NOT EXISTS mail_sends (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, outbox_id TEXT NOT NULL)');
  await transaction(async()=>{const now=Date.now(),count=async(span:number)=>((await db.get('SELECT COUNT(*) AS n FROM mail_sends WHERE at>?',new Date(now-span).toISOString())) as {n:number}).n;
    await db.run('DELETE FROM mail_sends WHERE at<?',new Date(now-2*86400000).toISOString());
    if(await count(3600000)>=config.caps.perHour||await count(86400000)>=config.caps.perDay)throw new MailSendError('RATE_LIMITED',MAIL_REASONS.RATE_LIMITED,true,false);
    await db.run('INSERT INTO mail_sends VALUES (?,?,?,?)',randomUUID(),new Date(now).toISOString(),kind,outboxId);});
}
/** Rows stuck in `sending` (crash, lost process) cannot be known to have sent: mark them uncertain, never retry automatically. */
export async function recoverStuckMail(){
  const cutoff=new Date(Date.now()-STALE_SENDING_MS).toISOString();
  const rows=await db.all("SELECT id,inquiry_id,version,kind FROM outbox WHERE status='sending' AND COALESCE(json_extract(data,'$.sendingAt'),'')<?",cutoff) as {id:string;inquiry_id:string;version:number;kind:string}[];
  for(const row of rows)await transaction(async()=>{
    if(!(await db.run("UPDATE outbox SET status='uncertain' WHERE id=? AND status='sending'",row.id)).changes)return;
    if(row.kind!=='proposal')return;
    const record=await inquiry(row.inquiry_id),revision=record.revision;if(record.submissions.find(s=>s.version===row.version)?.delivery)return;
    const at=new Date().toISOString();record.mailUncertain=true;record.status='Approved — sending';delete record.mailFailure;record.updatedAt=at;record.revision++;
    record.history.push({id:randomUUID(),at,actorId:'system',actor:'System',action:'Approved email delivery was interrupted — outcome unknown. An administrator must confirm it after checking the mailbox.'});await persist(record,revision);
  });
}
async function claimOutbox(rowId:string,config:MailConfig){
  if((await db.run("UPDATE outbox SET status='sending',data=json_set(data,'$.sendingAt',?,'$.mode',?,'$.redirectedTo',?) WHERE id=? AND status IN ('ready','failed')",new Date().toISOString(),attemptMode(config),maskedRedirect(config),rowId)).changes===1)return;
  const status=(await db.get('SELECT status FROM outbox WHERE id=?',rowId) as {status:string}|undefined)?.status;
  if(status==='uncertain')throw new AppError('The outcome of this email is unknown. Check the mailbox, then ask an administrator to confirm it. It is not retried automatically to avoid a duplicate.',409);
  if(status==='sent')throw new AppError('This approved reply was already sent.',409);
  throw new AppError('This approved reply is already being delivered.',409);
}
async function recordFailure(id:string,version:number,user:Staff,rowId:string,failure:MailFailure){
  await transaction(async()=>{
    const record=await inquiry(id),revision=record.revision,latest=record.submissions.find(s=>s.version===version);
    const row=await db.get('SELECT data FROM outbox WHERE id=?',rowId) as {data:string};
    if(latest?.delivery)return;
    const at=new Date().toISOString();
    if(failure.uncertain){record.mailUncertain=true;record.status='Approved — sending';delete record.mailFailure;audit(record,user,'Approved email outcome is unknown: '+failure.safeReason+' Not retried automatically; an administrator must confirm after checking the mailbox.');}
    else{record.status='Approved — email failed';record.mailFailure={code:failure.code,safeReason:failure.safeReason,at};delete record.mailUncertain;audit(record,user,'Approved email could not be delivered: '+failure.safeReason);}
    await persist(record,revision);
    await db.run('UPDATE outbox SET status=?,data=? WHERE id=?',failure.uncertain?'uncertain':'failed',JSON.stringify({...JSON.parse(row.data),error:failure.safeReason}),rowId);
    if(latest)await notify(record,failure.uncertain?'Approved email outcome unknown':'Approved email needs attention',failure.safeReason,[latest.submittedBy]);
  });
}
// Storage calls around an SMTP send use a short timeout so a delivery stays well inside STALE_SENDING_MS.
const STORAGE_TIMEOUT_MS=15000;
async function storeEml(relative:string,eml:Buffer){try{await files().put(relative,eml,{contentType:MIME.eml,mode:'replace',timeoutMs:STORAGE_TIMEOUT_MS});return relative;}catch{return '';}}
async function deliver(id:string,version:number,user:Staff,fail=false) {
  await recoverStuckMail();
  const row=await db.get("SELECT id,status,data FROM outbox WHERE inquiry_id=? AND version=? AND kind='proposal'",id,version) as {id:string;status:string;data:string}|undefined;
  if(!row)throw new AppError('Approved email package not found.',409);
  const config=mailConfig();
  await claimOutbox(row.id,config); // atomic: only one caller can move ready/failed -> sending
  let result:SendResult;
  try{
    await assertClientReady(await inquiry(id));
    const mail=JSON.parse(row.data);
    // failSend is a local-test aid only; with real email configured the request flag is ignored.
    if(fail&&config.mode==='local'&&config.env==='local')throw new MailSendError('SIMULATED',undefined,true,false);
    await reserveSend(config,'reply',row.id);
    result=await mailTransport(config).send({messageId:row.id,to:mail.email.to,subject:mail.email.subject,body:mail.email.body,attachments:[{filename:mail.filename+'.pdf',content:await files().get(mail.pdf,{timeoutMs:STORAGE_TIMEOUT_MS}),contentType:'application/pdf'}],kind:'reply'});
  }catch(error){await recordFailure(id,version,user,row.id,toFailure(error));return;}
  try{
    const text=deliveryText(config,result);
    if(result.dryRun){
      // A dry run proves the message can be built; it must never complete the workflow. Retry stays available.
      const file=await storeEml('outbox/'+row.id+'.dry-run.eml',result.eml);
      await transaction(async()=>{const record=await inquiry(id),revision=record.revision,latest=record.submissions.find(s=>s.version===version);if(!latest||latest.delivery)return;
        record.status='Approved — sending';delete record.mailFailure;delete record.mailUncertain;record.mailDryRun={at:result.at,kind:'reply',file};
        audit(record,user,'Approved proposal v'+version+': '+text.audit);await persist(record,revision);
        await db.run('UPDATE outbox SET status=?,data=? WHERE id=?','failed',JSON.stringify({...JSON.parse((await db.get('SELECT data FROM outbox WHERE id=?',row.id) as {data:string}).data),error:''}),row.id);
        await notify(record,text.notice,`Proposal v${version}. ${text.detail}`,[latest.submittedBy]);});
      return;
    }
    const file=await storeEml('outbox/'+row.id+'.eml',result.eml),masked=maskedRedirect(config);
    await transaction(async()=>{const record=await inquiry(id),revision=record.revision,latest=record.submissions.find(s=>s.version===version);if(!latest||latest.decision?.action!=='approve')throw new AppError('No approval exists for this package.',409);if(latest.delivery)return;startClientProtection(record,new Date().toISOString(),'proposal',latest.fields);latest.delivery={id:row.id,at:result.at,mode:result.mode,file,sentBy:user.id,...(masked?{redirectedTo:masked}:{})};record.status='Sent';delete record.mailFailure;delete record.mailUncertain;delete record.mailDryRun;audit(record,user,'Approved proposal v'+version+' '+text.audit);await persist(record,revision);await db.run('UPDATE outbox SET status=?,data=? WHERE id=?','sent',JSON.stringify({...JSON.parse((await db.get('SELECT data FROM outbox WHERE id=?',row.id) as {data:string}).data),file,error:''}),row.id);await notify(record,text.notice,`${config.mode==='local'?latest.email.to:'Agent'} · proposal v${version}. ${text.detail}`,[latest.submittedBy]);});
  }catch{
    // The message left (or was prepared) but we could not record it. Never auto-retry: that could send twice.
    await recordFailure(id,version,user,row.id,{code:'UNKNOWN',safeReason:'The email was sent but the result could not be saved. Check the mailbox, then ask an administrator to confirm it.',uncertain:!result.dryRun});
  }
}
export async function retry(id:string,user:Staff,revision:number) {
  checkRevision(await inquiry(id),revision);
  await recoverStuckMail(); // after the revision check: recovery bumps the revision and must not cause a spurious conflict
  const record=await inquiry(id);
  if(!['Approved — email failed','Approved — sending'].includes(record.status))throw new AppError('There is no failed or unfinished approved reply to retry.',409);
  await assertClientReady(record);await deliver(id,record.submissions.at(-1)!.version,user);return await inquiry(id);
}
const confirmInput=z.object({revision:z.number().int(),reason:z.string().trim().min(10).max(1000)});
const needAdmin=(user:Staff)=>{if(user.role!=='Admin')throw new AppError('Only an administrator can confirm a delivery.',403);};
const UNCERTAIN_STATUSES=['Approved — sending','Approved — email failed'];
async function uncertainRow(id:string,record:InquiryRecord){
  const latest=record.submissions.at(-1);
  const row=latest?await db.get("SELECT id,data FROM outbox WHERE inquiry_id=? AND version=? AND kind='proposal' AND status='uncertain'",id,latest.version) as {id:string;data:string}|undefined:undefined;
  if(!latest||!row||!record.mailUncertain||!UNCERTAIN_STATUSES.includes(record.status)||latest.delivery)throw new AppError('Only an approved reply with an unknown outcome can be confirmed.',409);
  return {latest,row};
}
/** Admin-only: records that a message whose outcome was unknown did arrive. Not verified by SMTP. */
export async function confirmSent(id:string,user:Staff,input:unknown) {
  needAdmin(user);const body=confirmInput.parse(input);
  await recoverStuckMail();
  return await transaction(async()=>{
    const record=await inquiry(id);checkRevision(record,body.revision);
    const {latest,row}=await uncertainRow(id,record);
    await assertClientReady(record);
    const data=JSON.parse(row.data) as {mode?:DeliveryMode;redirectedTo?:string},at=new Date().toISOString();
    const mode:DeliveryMode=data.mode==='local-test'||data.mode==='smtp-live'?data.mode:'smtp-redirected';
    startClientProtection(record,at,'proposal',latest.fields);
    latest.delivery={id:row.id,at,mode,file:'',sentBy:user.id,confirmedManually:true,...(data.redirectedTo?{redirectedTo:data.redirectedTo}:{})};
    record.status='Sent';delete record.mailUncertain;delete record.mailFailure;delete record.mailDryRun;
    audit(record,user,'Manually confirmed — not verified by SMTP. Reason: '+body.reason);await persist(record,body.revision);
    await db.run('UPDATE outbox SET status=?,data=? WHERE id=?','sent',JSON.stringify({...data,error:''}),row.id);
    await notify(record,'Approved reply confirmed manually',`Proposal v${latest.version} was confirmed as sent by an administrator (not verified by the mail server).`,[latest.submittedBy]);
    return record;
  });
}
/** Admin-only: the unknown outcome turned out to be a non-delivery. Re-opens Retry; the duplicate risk is acknowledged in the audit. */
export async function confirmNotSent(id:string,user:Staff,input:unknown) {
  needAdmin(user);const body=confirmInput.parse(input);
  await recoverStuckMail();
  return await transaction(async()=>{
    const record=await inquiry(id);checkRevision(record,body.revision);
    const {latest,row}=await uncertainRow(id,record);
    const at=new Date().toISOString();
    record.mailUncertain=false;record.status='Approved — email failed';
    record.mailFailure={code:'NOT_RECEIVED',safeReason:'An administrator confirmed the email was not received. It can be resent.',at};
    audit(record,user,'Admin confirmed the email was NOT received — resend allowed (duplicate risk acknowledged). Reason: '+body.reason);await persist(record,body.revision);
    await db.run('UPDATE outbox SET status=?,data=? WHERE id=?','failed',JSON.stringify({...JSON.parse(row.data),error:record.mailFailure.safeReason}),row.id);
    await notify(record,'Approved email can be resent',`Proposal v${latest.version}: an administrator confirmed the email was not received.`,[latest.submittedBy]);
    return record;
  });
}
const failureStatus=(failure:MailFailure)=>failure.code==='RATE_LIMITED'?429:422;
export async function requestDetails(id:string,user:Staff,input:unknown) {
  canPrepare(user);const body=z.object({revision:z.number().int(),body:z.string().min(1).max(20000)}).parse(input);
  await recoverStuckMail();
  const outboxId=randomUUID(),file='outbox/'+outboxId+'.eml';
  const draft=await transaction(async()=>{const record=await inquiry(id);checkRevision(record,body.revision);await assertClientReady(record);if(record.supervisorEdit||!canEditInquiry(user,record))throw new AppError('The submitted proposal is locked.',409);await requireInquiryHandler(id,user);
    const email=mailSchema.parse({to:record.fields.agentEmail,subject:'Details needed — '+record.fields.company,body:body.body});
    await db.run("UPDATE outbox SET status='failed' WHERE inquiry_id=? AND kind='details' AND status='ready'",id);
    if(await db.get("SELECT 1 FROM outbox WHERE inquiry_id=? AND kind='details' AND status='sending'",id))throw new AppError('A details request is already being sent for this inquiry.',409);
    const version=((await db.get("SELECT MAX(version) AS v FROM outbox WHERE inquiry_id=? AND kind='details'",id) as {v:number|null}).v||0)+1;
    const now=new Date().toISOString();
    await db.run('INSERT INTO outbox VALUES (?,?,?,?,?,?)',outboxId,id,version,'details','sending',JSON.stringify({id:outboxId,createdAt:now,sendingAt:now,email,error:''}));
    return email;
  });
  const config=mailConfig();
  const settle=(status:string,error:string)=>db.run('UPDATE outbox SET status=?,data=json_set(data,\'$.error\',?) WHERE id=?',status,error,outboxId);
  let result:SendResult;
  try{
    await reserveSend(config,'details',outboxId);
    result=await mailTransport(config).send({messageId:outboxId,to:draft.to,subject:draft.subject,body:draft.body,attachments:[],kind:'details'});
  }catch(error){
    const failure=toFailure(error);await settle(failure.uncertain?'uncertain':'failed',failure.safeReason);
    throw new AppError(failure.uncertain?failure.safeReason+' The message may have been delivered; check the mailbox before sending again. The inquiry status was not changed.':failure.safeReason+' The request was not sent and the inquiry status was not changed.',failureStatus(failure));
  }
  try{
    const text=deliveryText(config,result);
    if(result.dryRun){
      // Dry run: no status, protection or detailRequests change. Only a marker so the UI can offer the built message.
      const stored=await storeEml('outbox/'+outboxId+'.dry-run.eml',result.eml);
      return await transaction(async()=>{const record=await inquiry(id),revision=record.revision;record.mailDryRun={at:result.at,kind:'details',file:stored};audit(record,user,'Details request: '+text.audit);await persist(record,revision);await settle('dryrun','');return record;});
    }
    const stored=await storeEml(file,result.eml);
    return await transaction(async()=>{const record=await inquiry(id),revision=record.revision,at=new Date().toISOString();
      startClientProtection(record,at,'details');record.detailRequests.push({at,actorId:user.id,to:record.fields.agentEmail,body:body.body,file:stored});record.status='Waiting for agent details';delete record.mailDryRun;
      audit(record,user,'Requested missing information from the agent — '+text.audit);await persist(record,revision);await settle('sent','');return record;});
  }catch{
    await settle('uncertain','The email was sent but the result could not be saved.');
    throw new AppError(result.dryRun?'The dry run could not be recorded.':'The request was sent but could not be recorded. Check the mailbox before sending again.',409);
  }
}
export async function intake(user:Staff,file:File,sender:string) {
  if(user.role==='Supervisor')throw new AppError('Use an employee or admin account to import an inquiry.',403);
  if(!z.string().email().safeParse(sender).success)throw new AppError('Enter the agent sender/reply email.');
  const filename=file.name.toLowerCase(),bytes=Buffer.from(await file.arrayBuffer());
  if(!filename.endsWith('.xlsx')&&!filename.endsWith('.pdf'))throw new AppError('Upload the agent’s submitted form as an Excel (.xlsx) or PDF (.pdf) attachment.');
  const source=filename.endsWith('.pdf')?await preservePdfForm(bytes,file.name,sender):await parseForm(bytes,file.name,sender);
  source.sourceHash=createHash('sha256').update(bytes).digest('hex');
  // The original is already stored under a fresh key; if the row cannot be committed, remove it again.
  try{return await transaction(async()=>{const max=await inquiriesMax(),at=new Date().toISOString();const record:InquiryRecord={id:'INQ-'+new Date().getFullYear()+'-'+String(max+1).padStart(5,'0'),revision:1,status:'New inquiry',createdAt:at,updatedAt:at,fields:{...source.fields},source,email:defaultEmail(source.fields),emailOverrides:[],templateId:'',submissions:[],handledBy:[],history:[{id:randomUUID(),at,actorId:user.id,actor:user.name,action:'Imported agent email form. All active staff notified.'}],chat:[],notes:'',returnNote:'',returnFlags:[],detailRequests:[]};await updateClientReview(record,user);
    await persist(record);await notify(record,record.closure?'Request declined — previous registration expired':record.clientReview?.state==='duplicate'?'Duplicate import received — on hold':record.clientReview?.state==='identify'?'Client details needed':'New inquiry',`${record.fields.company||'Agent request'} is ready for form review.`,(await allUsers()).filter(u=>u.active).map(u=>u.id));return record;});}catch(error){await deleteQuietly(source.storage);throw error;}
}
async function inquiriesMax() { const rows=await db.all('SELECT id FROM inquiries') as {id:string}[];return Math.max(129,...rows.map(r=>Number(r.id.split('-').at(-1))||0)); }
export async function alternatives(record:InquiryRecord) { return suggestTemplates(record.fields,await catalog()).map(option=>option.template); }
export async function chat(id:string,user:Staff,input:unknown) {
  canPrepare(user);
  const body=z.object({revision:z.number().int(),question:z.enum([PROPOSAL_HELP_PROMPTS.suggest,PROPOSAL_HELP_PROMPTS.explain,PROPOSAL_HELP_PROMPTS.compare])}).parse(input);
  return await transaction(async()=>{const record=await inquiry(id);checkRevision(record,body.revision);
    await requireInquiryHandler(id,user);
    const topic=body.question===PROPOSAL_HELP_PROMPTS.explain?'explain':body.question===PROPOSAL_HELP_PROMPTS.compare?'compare':'suggest';
    const result=getProposalHelp(record.fields,await catalog(),record.templateId,topic);
    if(topic==='explain'&&!result.items.length)throw new AppError('Choose a proposal template to explain first.');
    const answer=[result.title,result.description,...result.items.map(({template,reasons})=>[template.name,...(topic==='compare'?['Program: '+template.family,'Variant: '+template.variant]:reasons),...template.warnings,'Source: '+template.sourceId+' — '+template.sourceName].join('\n')),result.note].join('\n\n');
    const sources=result.items.map(item=>item.template.id);
    const at=new Date().toISOString();record.chat.push({id:randomUUID(),at,role:'user',text:body.question,actorId:user.id,sources:[]},{id:randomUUID(),at,role:'assistant',text:answer,actorId:'assistant',sources});const revision=record.revision;if(user.role==='Employee')audit(record,user,'Used proposal assistant: '+body.question);else {record.revision++;record.updatedAt=at;}await persist(record,revision);return record;});
}
