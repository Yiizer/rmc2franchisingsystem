import {clientDirectory,directoryClient,directoryRecord,editDirectoryRecord} from '@/lib/operations/directory-clients';
import { directory, historicalDetail, historicalMatches, reviewHistorical, withHistoricalHold } from '@/lib/operations/historical';
import { authenticate, createAccount, resetPassword, unlockAccount, updateAccount, updateOwnAccount } from '@/lib/operations/accounts';
import { assertOwnerScopedRoute } from '@/lib/operations/scope-guard';
import { canManageTemplates, isOwnerScoped } from '@/lib/operations/permissions';
import { claimReminderSlot, runClaimedReminders, staffProtectionReminders, listOwnerClients, ownerBootstrap, ownerClient, ownerIntakeResult, ownerProposalFile, ownerReportFile } from '@/lib/operations/owner-view';
import { setInquiryOwner } from '@/lib/operations/owners';
import { declineInquiry, transferWithBor, decideAgentTransfer, requestExpiredTransfer } from '@/lib/operations/registration-actions';
import { beginSupervisorEdit, cancelSupervisorEdit } from '@/lib/operations/supervisor-edit';
import { stageTemplate, publishTemplate, setTemplateActive, templateStage } from '@/lib/operations/template-admin';
import { monitoring } from '@/lib/operations/monitoring';
import { proposalEmployee, proposalStats } from '@/lib/operations/proposal-stats';
import { createSoa, deactivateSoa, listTeam, resetSoaPassword } from '@/lib/operations/division-team';
import { getEmailTemplates, saveEmailTemplates } from '@/lib/operations/email-templates';
import { checkInbox, claimInboxCheck, runClaimedInboxCheck, cronAllowed, dismissInbound, importInbound, inboundAttachment, listInbound } from '@/lib/operations/inbound';
import { chosen } from '@/lib/operations/service';
import { NextRequest, NextResponse, after } from 'next/server';
import { clientStates } from '@/lib/operations/client-rules';
import { addProgressReport, decideProgressReport, reviewClientRegistration } from '@/lib/operations/client-service';
import { privateFile, logFileAccess } from '@/lib/operations/file-privacy';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { AppError, allUsers, catalog, databaseLabel, db, ensureReady, inquiries, inquiry, tokenHash, transaction } from '@/lib/operations/database';
import { forUpdate, jsonAppend, jsonArrayHas } from '@/lib/operations/sql-dialect';
import { templateBytes } from '@/lib/operations/template-source';
import { isAppError } from '@/lib/operations/errors';
import { isStorageError } from '@/lib/operations/file-store';
import { customDocument, customEditsSchema } from '@/lib/operations/custom-documents';
import { chat, confirmNotSent, confirmSent, customize, decide, generate, intake, intakeFields, recoverStuckMail, requestDetails, retry, saveDraft, submit } from '@/lib/operations/service';
import { mailStatus } from '@/lib/operations/mail-config';
import { sampleForm } from '@/lib/operations/forms';
import { previewWorkbook } from '@/lib/operations/form-preview';
import { fillDocx } from '@/lib/operations/documents';
import { conversionName, pdfFromDocx } from '@/lib/operations/document-renderer';
import { activeInquiryActivity, updateInquiryActivity } from '@/lib/operations/activity';
import { LABELS, isSampleForm } from '@/lib/operations/types';
import { packageRenderers } from '@/lib/operations/package-rendering';
import { inquiryDetails, workspaceView } from '@/lib/operations/workspace-query';
import path from 'node:path';
import type { Notice, Staff } from '@/lib/operations/types';
import { readDivisionTable, saveDivisionTable } from '@/lib/operations/division-store';
import { pushSettings, queuePushForNotice, sendTestPush, removePushSubscription, savePushSubscription, sendPush, setPushMuted } from '@/lib/operations/push';
import { setNoticeHook } from '@/lib/operations/database';
import { setInboxHook } from '@/lib/operations/inbound';
import { canReviewInbound } from '@/lib/operations/permissions';
// Phone notifications: every saved in-app notice, and emails waiting on Requests, also go to subscribed phones.
setNoticeHook(queuePushForNotice);
setInboxHook(async waiting=>{const people=(await allUsers()).filter(person=>person.active&&canReviewInbound(person)).map(person=>person.id);await sendPush(people,{title:'New email on Requests',body:waiting+' email'+(waiting===1?'':'s')+' waiting',url:'/#requests',type:'inquiry'});});
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path?:string[]}>};
async function staff(request:NextRequest):Promise<Staff> {
  const token=request.cookies.get('rmc2_session')?.value;if(!token)throw new AppError('Sign in to your workspace.',401);
  const session=await db.get('SELECT user_id,expires FROM sessions WHERE token=?',tokenHash(token)) as {user_id:string;expires:string}|undefined;
  if(!session||Date.parse(session.expires)<Date.now())throw new AppError('Your session expired. Sign in again.',401);
  const user=(await allUsers()).find(u=>u.id===session.user_id&&u.active);if(!user)throw new AppError('This staff account is inactive.',401);return user;
}
function response(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function errorResponse(error:unknown){if(error instanceof ZodError)return response({error:error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')},400);if(isStorageError(error))return response({error:error.message},error.status);if(isAppError(error)){if(error.status>=500){console.error('Operations service error',error);return response({error:'We could not complete this request. Please try again. If it continues, contact your administrator.'},error.status);}return response({error:error.message},error.status);}console.error('Operations error',error);return response({error:'We could not complete this request. Please try again. If it continues, contact your administrator.'},500);}
function fileResponse(bytes:Buffer,mime:string,name:string,attachment=true) {return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':mime,'Content-Disposition':`${attachment?'attachment':'inline'}; filename="${name.replace(/[^a-zA-Z0-9_. -]/g,'_')}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'}});}
/** Division Head / SOA reads. The route was already checked against the whitelist; returns undefined for the two static routes the normal handler serves. */
async function ownerGet(request:NextRequest,route:string[],user:Staff):Promise<NextResponse|undefined>{
  if(route[0]==='bootstrap')return response(await ownerBootstrap(user));
  if(user.mustChangePassword)throw new AppError('Set your own password in Settings to activate your account.',403);
  if(route[0]!=='my-clients')return undefined;
  if(route.length===1)return response({clients:await listOwnerClients(user)});
  if(route.length===2)return response({client:await ownerClient(user,route[1])});
  if(route[2]==='proposal'){const file=await ownerProposalFile(user,route[1]);return fileResponse(await privateFile(user,route[1],'owner-proposal',file.storage),'application/pdf',file.name,request.nextUrl.searchParams.get('download')==='1');}
  const file=await ownerReportFile(user,route[1],route[3]);return fileResponse(await privateFile(user,route[1],'owner-progress-report',file.attachment.storage),file.attachment.mime,file.attachment.filename);
}
export async function GET(request:NextRequest,context:Context){try{
  await ensureReady();
  const route=(await context.params).path||[];
  if(route[0]==='login-options')return response({users:[]});
  if(route[0]==='inbound'&&route[1]==='cron'){if(!cronAllowed(request.headers.get('authorization')))throw new AppError('Not allowed.',401);const inbox=await checkInbox();const reminders=await staffProtectionReminders().catch(()=>-1);return response({...inbox,reminders});}
  const user=await staff(request);
  // Division Heads / SOAs: whitelist first, before any lookup.
  if(isOwnerScoped(user)){assertOwnerScopedRoute(user,'GET',route);const scoped=await ownerGet(request,route,user);if(scoped)return scoped;}
  // A temporary-password session only needs its own Settings page; the workspace still loads (the app reads the user from it).
  if(user.mustChangePassword&&route[0]==='inbound')throw new AppError('Set your own password in Settings to activate your account.',403);
  if(route[0]==='inbound'&&!route[1])return response(await listInbound(user));
  if(route[0]==='inbound'&&route[1]&&route[2]==='attachment'){const file=await inboundAttachment(user,route[1],Number(route[3]));return fileResponse(file.bytes,file.type,file.name);}
  if(route[0]==='workspace'){const checking=await claimInboxCheck();if(checking)after(runClaimedInboxCheck);if(await claimReminderSlot())after(runClaimedReminders);const view=await workspaceView(user,request.nextUrl.searchParams);return response(checking?{...view,inboxChecking:true}:view);}
  if(user.mustChangePassword){if(route[0]!=='bootstrap')throw new AppError('Set your own password in Settings to activate your account.',403);return response({user,users:[user],inquiries:[],clientStates:{},packageRenderers:{},activity:[],templates:[],notifications:[],integrations:{database:'',gmail:'',ai:'',documents:''},mail:mailStatus()});}

  if(route[0]==='bootstrap'){await recoverStuckMail();const snap=await db.snapshot(async()=>{const notices=(await db.all('SELECT data FROM notifications') as {data:string}[]).map(r=>JSON.parse(r.data) as Notice).filter(n=>n.recipientIds.includes(user.id)).sort((a,b)=>b.at.localeCompare(a.at));return {notices,records:await inquiries(),users:await allUsers(),activity:await activeInquiryActivity(),templates:await catalog()};});const records=snap.records;return response({user,users:snap.users,inquiries:records,clientStates:clientStates(records),packageRenderers:await packageRenderers(records),activity:snap.activity,templates:snap.templates.map(({file,text,...t})=>({...t,text,file:''})),notifications:snap.notices,integrations:{database:databaseLabel(),gmail:'Local test mailbox · no real Gmail sends',ai:'Simulated · supplied proposal sources only',documents:conversionName()},mail:mailStatus()});}
  if(route[0]==='divisions')return response(await readDivisionTable(user));
  if(route[0]==='push'&&!route[1])return response(await pushSettings(user));
  if(route[0]==='directory')return response(route[1]==='client'&&route[2]?await directoryClient(route[2]):route[1]?{record:await directoryRecord(route[1])}:await clientDirectory(request.nextUrl.searchParams));
  if(route[0]==='inquiries'&&route[1]&&route[2]==='historical-matches')return response({matches:await historicalMatches(await inquiry(route[1]))});
  if(route[0]==='monitoring'&&route[1]==='proposals'&&route.length===2)return response(await proposalStats(user,request.nextUrl.searchParams));
  if(route[0]==='monitoring'&&route[1]==='proposals'&&route[2]==='employee'&&route.length===3)return response(await proposalEmployee(user,request.nextUrl.searchParams));
  if(route[0]==='my-team'&&route.length===1)return response(await listTeam(user)); // Division Head only; an SOA passes the whitelist and gets 403 here
  if(route[0]==='email-templates'&&route.length===1)return response(await getEmailTemplates(user));
  if(route[0]==='monitoring')return response(await monitoring(user));
  if(route[0]==='inquiries'&&route.length===2)return response(await inquiryDetails(route[1]));
  if(route[0]==='template-stage'&&route[1]){const staged=await templateStage(user,route[1]);return fileResponse(await privateFile(user,'template:'+staged.template.id,'template-preview',staged.pdf),'application/pdf','template-preview.pdf',false);}
  if(route[0]==='template-history'){if(!canManageTemplates(user))throw new AppError('Only the Head can manage proposal templates.',403);return response({versions:(await db.all("SELECT id,data,state,actor_id,at FROM template_versions WHERE state<>'staged' ORDER BY at DESC") as {id:string;data:string;state:string;actor_id:string;at:string}[]).map(row=>{const t=JSON.parse(row.data).template;return {id:row.id,templateId:t.id,name:t.name,hash:t.sourceHash,state:row.state,by:row.actor_id,at:row.at};})});}
  if(route[0]==='pdf-worker')return new NextResponse(readFileSync(path.join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')),{headers:{'Content-Type':'text/javascript','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
  if(route[0]==='sample-form')return fileResponse(await sampleForm(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','RMC2-sample-franchise-form.xlsx');
  if(route[0]==='form-preview'&&route[1]){const record=await inquiry(route[1]);if(!record.source.storage&&!isSampleForm(record.source))throw new AppError('This inquiry has no submitted Excel attachment.',404);try{return response(await previewWorkbook(record.source.storage?await privateFile(user,record.id,'form-preview',record.source.storage):await sampleForm(record.source.fields)));}catch(error){if(isStorageError(error)&&(error.code==='not_found'||error.code==='unavailable'))throw error;throw new AppError(error instanceof Error&&/^(The attachment|Too many sheets|A populated sheet|The sheet layout)/.test(error.message)?error.message:'The attachment could not be previewed. Download the original Excel file.');}}
  if(route[0]==='source'&&route[1]){const template=(await catalog()).find(t=>t.id===route[1]);if(!template)throw new AppError('Template not found',404);await logFileAccess(user,'template:'+template.id,'source');return fileResponse(await templateBytes(template),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',template.sourceName);}
  if(route[0]==='file'&&route[1]){const record=await inquiry(route[1]),kind=route[2],version=Number(request.nextUrl.searchParams.get('version')),snapshot=version?record.submissions.find(s=>s.version===version):undefined,generated=version?snapshot?.generated:record.generated;
    if(kind==='source'){if(!record.source.storage&&isSampleForm(record.source))return fileResponse(await sampleForm(record.source.fields),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Sample-franchise-form.xlsx');if(!record.source.storage)throw new AppError('This starting example has no submitted attachment. Import an agent’s PDF or Excel form to test intake.',404);const pdf=record.source.format==='pdf'||record.source.filename.toLowerCase().endsWith('.pdf');return fileResponse(await privateFile(user,record.id,'source',record.source.storage),pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',record.source.filename,!pdf||request.nextUrl.searchParams.get('download')==='1');}
    if(kind==='pending-bor'){const attachment=record.agentTransferRequest?.attachment;if(!attachment)throw new AppError('BOR request not found.',404);return fileResponse(await privateFile(user,record.id,'bor',attachment.storage),attachment.mime,attachment.filename);}
    if(kind==='bor'){if(!record.bor)throw new AppError('BOR not found.',404);return fileResponse(await privateFile(user,record.id,'bor',record.bor.attachment.storage),record.bor.attachment.mime,record.bor.attachment.filename);}
    if(kind==='progress'){const report=record.progressReports?.find(item=>item.id===request.nextUrl.searchParams.get('report'));if(!report?.attachment)throw new AppError('Progress-report attachment not found.',404);return fileResponse(await privateFile(user,record.id,'progress-report',report.attachment.storage),report.attachment.mime,report.attachment.filename);}
    if(kind==='eml'&&request.nextUrl.searchParams.get('dryRun')==='1'){if(!record.mailDryRun?.file)throw new AppError('No email file for this dry run.',404);return fileResponse(await privateFile(user,record.id,'email',record.mailDryRun.file),'message/rfc822',record.id+'-dry-run.eml');}
    if(kind==='eml'){const submission=snapshot||record.submissions.at(-1);if(!submission?.delivery)throw new AppError('No delivered email exists for this version.',404);if(!submission.delivery.file)throw new AppError('No email file for this delivery.',404);return fileResponse(await privateFile(user,record.id,'email',submission.delivery.file),'message/rfc822',record.id+'-v'+submission.version+'.eml');}
    if(kind==='details'){const index=Number(request.nextUrl.searchParams.get('index'));const item=record.detailRequests[index];if(!item)throw new AppError('Details request not found',404);if(!item.file)throw new AppError('No email file for this delivery.',404);return fileResponse(await privateFile(user,record.id,'details-email',item.file),'message/rfc822',record.id+'-details.eml');}
    if(kind==='master'){if(!generated?.sourceDocx)throw new AppError('An archived master is not available for this earlier package.',404);return fileResponse(await privateFile(user,record.id,'master',generated.sourceDocx),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',generated.sourceName||'original-proposal-master.docx');}
    if(!generated||!['pdf','docx'].includes(kind))throw new AppError('Generate a proposal first.',404);
    const packageId=request.nextUrl.searchParams.get('package');if(packageId&&packageId!==generated.id)throw new AppError('The prepared file changed. Reload the latest proposal.',409);
    return fileResponse(await privateFile(user,record.id,kind,kind==='pdf'?generated.pdf:generated.docx),kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',generated.filename+'.'+kind,kind!=='pdf');}
  throw new AppError('Route not found',404);
}catch(error){return errorResponse(error);}}
export async function POST(request:NextRequest,context:Context){try{
  await ensureReady();
  const origin=request.headers.get('origin');
  if(origin){const from=new URL(origin),host=new URL(request.nextUrl.protocol+'//'+(request.headers.get('host')||request.nextUrl.host));const loopback=['localhost','127.0.0.1','[::1]'];const sameHost=from.host===host.host||(loopback.includes(from.hostname)&&loopback.includes(host.hostname)&&from.port===host.port);if(!sameHost||from.protocol!==host.protocol)throw new AppError('Use the application on the same origin.',403);}
  const route=(await context.params).path||[];
  if(route[0]==='login'){const user=await authenticate(await request.json()),token=randomBytes(32).toString('hex');await db.run('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)',tokenHash(token),user.id,new Date(Date.now()+12*3600000).toISOString());const result=response({user});result.cookies.set('rmc2_session',token,{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/',maxAge:12*3600});return result;}
  const user=await staff(request);
  if(user.mustChangePassword&&!['account-settings','logout'].includes(route[0]))throw new AppError('Change your temporary password in Settings before continuing.',403);
  // Division Heads / SOAs: whitelist first, before any lookup or write.
  if(isOwnerScoped(user)){
    assertOwnerScopedRoute(user,'POST',route);
    if(route[0]==='my-clients'){const form=await request.formData(),file=form.get('file');const text=(name:string)=>{const value=form.get(name);return typeof value==='string'&&value.trim()?value:undefined;};await addProgressReport(route[1],user,{requestId:text('requestId'),sentAt:text('sentAt'),summary:form.get('summary'),reference:form.get('reference')},file instanceof File?file:undefined);return response({client:await ownerClient(user,route[1])},201);}
  }
  if(route[0]==='inbound'&&route[1]==='check'){await listInbound(user);return response(await checkInbox());}
  if(route[0]==='inbound'&&route[1]&&route[2]==='import'){const body=z.object({index:z.number().int().min(0).max(50)}).parse(await request.json());return response({inquiry:await importInbound(user,route[1],body.index)},201);}
  if(route[0]==='inbound'&&route[1]&&route[2]==='dismiss'){await dismissInbound(user,route[1]);return response({ok:true});}
  if(route[0]==='account-settings'){const updated=await updateOwnAccount(user,await request.json());const result=response({user:updated});result.cookies.delete('rmc2_session');return result;}
  if(route[0]==='directory'&&route[1]&&route[2]==='edit')return response({record:await editDirectoryRecord(route[1],user,await request.json())});
  if(route[0]==='create-account')return response(await createAccount(user,await request.json()),201);
  if(route[0]==='reset-password')return response(await resetPassword(user,await request.json()));
  if(route[0]==='unlock-account')return response(await unlockAccount(user,await request.json()));
  if(route[0]==='monitoring-check')return response(await monitoring(user,true));
  if(route[0]==='template-upload')return response(await stageTemplate(user,await request.formData()),201);
  if(route[0]==='template-publish')return response({template:await publishTemplate(user,await request.json())});
  if(route[0]==='template-active')return response({template:await setTemplateActive(user,await request.json())});
  if(route[0]==='divisions')return response(await saveDivisionTable(user,await request.json()));
  if(route[0]==='push'&&route[1]==='subscribe')return response(await savePushSubscription(user,await request.json()));
  if(route[0]==='push'&&route[1]==='unsubscribe')return response(await removePushSubscription(user,await request.json()));
  if(route[0]==='push'&&route[1]==='test')return response(await sendTestPush(user));
  if(route[0]==='push'&&route[1]==='mute')return response(await setPushMuted(user,await request.json()));
  if(route[0]==='inquiries'&&route[1]&&route[2]==='bor-transfer')return response({inquiry:await transferWithBor(route[1],user,await request.formData())});

  if(route[0]==='proposal-preview'){
    const body=z.object({templateId:z.string().max(30),fields:z.record(z.string().max(2000)).refine(values=>Object.keys(values).length<=Object.keys(LABELS).length&&Object.keys(values).every(key=>key in LABELS),'Use supported proposal fields only'),original:z.boolean().optional(),inquiryId:z.string().max(100).optional(),customEdits:customEditsSchema.optional()}).strict().parse(await request.json());
    const previewRecord=body.inquiryId?await inquiry(body.inquiryId):undefined;const template=previewRecord?.supervisorEdit&&previewRecord.templateId===body.templateId?await chosen(previewRecord):(await catalog()).find(t=>t.id===body.templateId&&t.active);if(!template)throw new AppError('Template not found',404);
    if(body.fields.requestDate&&!/^\d{4}-\d{2}-\d{2}$/.test(body.fields.requestDate))throw new AppError('Use a valid date for the proposal preview.');
    const bytes=body.original?await templateBytes(template):await fillDocx(template,body.fields,true);
    if(body.original&&createHash('sha256').update(bytes).digest('hex')!==template.sourceHash)throw new AppError('The proposal source changed. Review the new master before previewing.',409);
    let previewBytes=bytes;
    if(body.customEdits&&!body.original){const record=body.inquiryId?await inquiry(body.inquiryId):null;if(!record?.customization||record.templateId!==template.id||record.customization.sourceHash!==template.sourceHash)throw new AppError('Open a customized inquiry to preview content edits.',409);previewBytes=customDocument(bytes,body.customEdits).bytes;}
    const pdf=await pdfFromDocx(previewBytes,true);
    // Transient preview: no inquiry, handler, approval or audit mutation.
    return fileResponse(pdf.bytes,'application/pdf',template.sourceId+'-preview.pdf',false);
  }
  if(route[0]==='custom-document'){
    const body=z.object({inquiryId:z.string().max(100),templateId:z.string().max(100),fields:z.record(z.string().max(3000)).refine(values=>Object.keys(values).every(key=>key in LABELS),'Use supported proposal fields only'),edits:customEditsSchema}).strict().parse(await request.json());
    const record=await inquiry(body.inquiryId),template=record.supervisorEdit&&record.templateId===body.templateId?await chosen(record):(await catalog()).find(t=>t.id===body.templateId&&t.active);
    if(!template||!record.customization||record.customization.templateId!==template.id||record.customization.sourceHash!==template.sourceHash)throw new AppError('Create a customized copy before editing this document.',409);
    const result=customDocument(await fillDocx(template,body.fields,true),body.edits,true);
    return response({docx:result.bytes.toString('base64'),blocks:result.blocks,changes:result.changes});
  }
  if(route[0]==='logout'){const token=request.cookies.get('rmc2_session')?.value;if(token)await db.run('DELETE FROM sessions WHERE token=?',tokenHash(token));const result=response({ok:true});result.cookies.delete('rmc2_session');return result;}
  if(route[0]==='intake'){const form=await request.formData(),file=form.get('file');if(!(file instanceof File))throw new AppError('Choose the agent’s submitted PDF or Excel form.');const ownerField=form.get('ownerId'),options=!isOwnerScoped(user)&&typeof ownerField==='string'&&ownerField?{ownerId:ownerField}:{};const record=await intake(user,file,String(form.get('sender')||''),options);return isOwnerScoped(user)?response(await ownerIntakeResult(record),201):response({inquiry:record},201);}
  if(route[0]==='intake-fields'&&route.length===1){const record=await intakeFields(user,await request.json());return isOwnerScoped(user)?response(await ownerIntakeResult(record),201):response({inquiry:record},201);}
  if(route[0]==='my-team'){ // Division Head only (division-team.ts answers 403 for anyone else, with one message for every failure)
    if(route.length===2&&route[1]==='create')return response(await createSoa(user,await request.json()),201);
    if(route.length===3&&route[2]==='deactivate')return response(await deactivateSoa(user,route[1],await request.json()));
    if(route.length===3&&route[2]==='reset-password')return response(await resetSoaPassword(user,route[1],await request.json()));
  }
  if(route[0]==='email-templates'&&route.length===1)return response(await saveEmailTemplates(user,await request.json()));
  if(route[0]==='notifications'){const body=z.union([z.object({all:z.literal(true)}).strict(),z.object({ids:z.array(z.string()).max(500)}).strict()]).parse(await request.json());if('all' in body){await transaction(async()=>{await db.all(`SELECT id FROM notifications WHERE id IN (SELECT notice_id FROM notice_recipients WHERE user_id=? AND is_read=0) ORDER BY id${forUpdate(db)}`,user.id);await db.run(`UPDATE notifications SET data=${jsonAppend(db,'data','readBy')} WHERE id IN (SELECT notice_id FROM notice_recipients WHERE user_id=? AND is_read=0) AND NOT COALESCE(${jsonArrayHas(db,'data','readBy')},false)`,user.id,user.id,user.id);});return response({ok:true});}await transaction(async()=>{for(const id of [...new Set(body.ids)].sort()){const row=await db.get('SELECT data FROM notifications WHERE id=?'+forUpdate(db),id) as {data:string}|undefined;if(!row)continue;const notice=JSON.parse(row.data) as Notice;if(notice.recipientIds.includes(user.id)&&!notice.readBy.includes(user.id)){notice.readBy.push(user.id);await db.run('UPDATE notifications SET data=? WHERE id=?',JSON.stringify(notice),id);}}});return response({ok:true});}
  if(route[0]==='users')return response(await updateAccount(user,await request.json()));
  if(route[0]==='inquiries'&&route[1]&&route[2]==='progress-report'&&route[3]&&route[4]==='decision'&&route.length===5)return response({inquiry:await withHistoricalHold(await decideProgressReport(route[1],route[3],user,await request.json()))});
  // Filing is for the owning Division Head / SOA only (through my-clients/:id/progress-report); staff, and owner-scoped users here, are refused.
  if(route[0]==='inquiries'&&route[1]&&route[2]==='progress-report'&&route.length===3)throw new AppError('Only the Division Head or SOA who owns this client can file a progress report.',403);
  if(route[0]==='inquiries'&&route[1]){const id=route[1],action=route[2],body=await request.json();
    if(action==='activity')return response(await updateInquiryActivity(id,user,tokenHash(request.cookies.get('rmc2_session')!.value),body));
    const result=action==='request-expired-transfer'?await requestExpiredTransfer(id,user,body):action==='review-historical'?await reviewHistorical(id,user,body):action==='agent-transfer-decision'?await decideAgentTransfer(id,user,body):action==='decline'?await declineInquiry(id,user,body):action==='begin-review-edit'?await beginSupervisorEdit(id,user,body):action==='cancel-review-edit'?await cancelSupervisorEdit(id,user,body):action==='review-client'?await reviewClientRegistration(id,user,body):action==='customize'?await customize(id,user,body):action==='save'?await saveDraft(id,user,body):action==='generate'?await generate(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='submit'?await submit(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='decision'?await decide(id,user,body):action==='retry'?await retry(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='owner'?await setInquiryOwner(id,user,body):action==='request-details'?await requestDetails(id,user,body):action==='confirm-sent'?await confirmSent(id,user,body):action==='confirm-not-sent'?await confirmNotSent(id,user,body):action==='chat'?await chat(id,user,body):null;
    if(!result)throw new AppError('Action not found',404);return response({inquiry:await withHistoricalHold(result)});}
  throw new AppError('Route not found',404);
}catch(error){return errorResponse(error);}}
