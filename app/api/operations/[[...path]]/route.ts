import {clientDirectory,directoryClient,directoryRecord,editDirectoryRecord} from '@/lib/operations/directory-clients';
import { directory, historicalDetail, historicalMatches, reviewHistorical, withHistoricalHold } from '@/lib/operations/historical';
import { authenticate, createAccount, updateOwnAccount } from '@/lib/operations/accounts';
import { declineInquiry, transferWithBor, decideAgentTransfer, requestExpiredTransfer } from '@/lib/operations/registration-actions';
import { beginSupervisorEdit, cancelSupervisorEdit } from '@/lib/operations/supervisor-edit';
import { stageTemplate, publishTemplate, setTemplateActive, templateStage } from '@/lib/operations/template-admin';
import { monitoring } from '@/lib/operations/monitoring';
import { chosen } from '@/lib/operations/service';
import { NextRequest, NextResponse } from 'next/server';
import { clientStates } from '@/lib/operations/client-rules';
import { addProgressReport, reviewClientRegistration } from '@/lib/operations/client-service';
import { privateFile, logFileAccess } from '@/lib/operations/file-privacy';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { AppError, allUsers, catalog, db, inquiries, inquiry, safeStorage, sourceFile, tokenHash, transaction } from '@/lib/operations/database';
import { customDocument, customEditsSchema } from '@/lib/operations/custom-documents';
import { chat, confirmNotSent, confirmSent, customize, decide, generate, intake, recoverStuckMail, requestDetails, retry, saveDraft, submit } from '@/lib/operations/service';
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
function errorResponse(error:unknown){if(error instanceof ZodError)return response({error:error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')},400);if(error instanceof AppError){if(error.status>=500){console.error('Operations service error',error);return response({error:'We could not complete this request. Please try again. If it continues, contact your administrator.'},error.status);}return response({error:error.message},error.status);}console.error('Operations error',error);return response({error:'We could not complete this request. Please try again. If it continues, contact your administrator.'},500);}
function fileResponse(bytes:Buffer,mime:string,name:string,attachment=true) {return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':mime,'Content-Disposition':`${attachment?'attachment':'inline'}; filename="${name.replace(/[^a-zA-Z0-9_. -]/g,'_')}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'}});}
export async function GET(request:NextRequest,context:Context){try{
  const route=(await context.params).path||[];
  if(route[0]==='login-options')return response({users:[]});
  const user=await staff(request);
  if(route[0]==='workspace')return response(await workspaceView(user,request.nextUrl.searchParams));
  if(user.mustChangePassword){if(route[0]!=='bootstrap')throw new AppError('Set your own password in Settings to activate your account.',403);return response({user,users:[user],inquiries:[],clientStates:{},packageRenderers:{},activity:[],templates:[],notifications:[],integrations:{database:'',gmail:'',ai:'',documents:''},mail:mailStatus()});}

  if(route[0]==='bootstrap'){await recoverStuckMail();const notices=(await db.all('SELECT data FROM notifications') as {data:string}[]).map(r=>JSON.parse(r.data) as Notice).filter(n=>n.recipientIds.includes(user.id)).sort((a,b)=>b.at.localeCompare(a.at));const records=await inquiries();return response({user,users:await allUsers(),inquiries:records,clientStates:clientStates(records),packageRenderers:packageRenderers(records),activity:await activeInquiryActivity(),templates:(await catalog()).map(({file,text,...t})=>({...t,text,file:''})),notifications:notices,integrations:{database:'SQLite · shared server storage',gmail:'Local test mailbox · no real Gmail sends',ai:'Simulated · supplied proposal sources only',documents:conversionName()},mail:mailStatus()});}
  if(route[0]==='directory')return response(route[1]==='client'&&route[2]?await directoryClient(route[2]):route[1]?{record:await directoryRecord(route[1])}:await clientDirectory(request.nextUrl.searchParams));
  if(route[0]==='inquiries'&&route[1]&&route[2]==='historical-matches')return response({matches:await historicalMatches(await inquiry(route[1]))});
  if(route[0]==='monitoring')return response(await monitoring(user));
  if(route[0]==='inquiries'&&route.length===2)return response(await inquiryDetails(route[1]));
  if(route[0]==='template-stage'&&route[1]){const staged=await templateStage(user,route[1]);return fileResponse(await privateFile(user,'template:'+staged.template.id,'template-preview',staged.pdf),'application/pdf','template-preview.pdf',false);}
  if(route[0]==='template-history'){if(user.role!=='Admin')throw new AppError('Admin access is required.',403);return response({versions:(await db.all("SELECT id,data,state,actor_id,at FROM template_versions WHERE state<>'staged' ORDER BY at DESC") as {id:string;data:string;state:string;actor_id:string;at:string}[]).map(row=>{const t=JSON.parse(row.data).template;return {id:row.id,templateId:t.id,name:t.name,hash:t.sourceHash,state:row.state,by:row.actor_id,at:row.at};})});}
  if(route[0]==='pdf-worker')return new NextResponse(readFileSync(path.join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')),{headers:{'Content-Type':'text/javascript','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
  if(route[0]==='sample-form')return fileResponse(await sampleForm(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','RMC2-sample-franchise-form.xlsx');
  if(route[0]==='form-preview'&&route[1]){const record=await inquiry(route[1]);if(!record.source.storage&&!isSampleForm(record.source))throw new AppError('This inquiry has no submitted Excel attachment.',404);try{return response(await previewWorkbook(record.source.storage?await privateFile(user,record.id,'form-preview',record.source.storage):await sampleForm(record.source.fields)));}catch(error){throw new AppError(error instanceof Error&&/^(The attachment|Too many sheets|A populated sheet|The sheet layout)/.test(error.message)?error.message:'The attachment could not be previewed. Download the original Excel file.');}}
  if(route[0]==='source'&&route[1]){const template=(await catalog()).find(t=>t.id===route[1]);if(!template)throw new AppError('Template not found',404);await logFileAccess(user,'template:'+template.id,'source');return fileResponse(readFileSync(sourceFile(template)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',template.sourceName);}
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
  const origin=request.headers.get('origin');
  if(origin){const from=new URL(origin),host=new URL(request.nextUrl.protocol+'//'+(request.headers.get('host')||request.nextUrl.host));const loopback=['localhost','127.0.0.1','[::1]'];const sameHost=from.host===host.host||(loopback.includes(from.hostname)&&loopback.includes(host.hostname)&&from.port===host.port);if(!sameHost||from.protocol!==host.protocol)throw new AppError('Use the application on the same origin.',403);}
  const route=(await context.params).path||[];
  if(route[0]==='login'){const user=await authenticate(await request.json()),token=randomBytes(32).toString('hex');await db.run('INSERT INTO sessions VALUES (?,?,?)',tokenHash(token),user.id,new Date(Date.now()+12*3600000).toISOString());const result=response({user});result.cookies.set('rmc2_session',token,{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/',maxAge:12*3600});return result;}
  const user=await staff(request);
  if(user.mustChangePassword&&!['account-settings','logout'].includes(route[0]))throw new AppError('Change your temporary password in Settings before continuing.',403);
  if(route[0]==='account-settings'){const updated=await updateOwnAccount(user,await request.json());const result=response({user:updated});result.cookies.delete('rmc2_session');return result;}
  if(route[0]==='directory'&&route[1]&&route[2]==='edit')return response({record:await editDirectoryRecord(route[1],user,await request.json())});
  if(route[0]==='create-account')return response(await createAccount(user,await request.json()),201);
  if(route[0]==='monitoring-check')return response(await monitoring(user,true));
  if(route[0]==='template-upload')return response(await stageTemplate(user,await request.formData()),201);
  if(route[0]==='template-publish')return response({template:await publishTemplate(user,await request.json())});
  if(route[0]==='template-active')return response({template:await setTemplateActive(user,await request.json())});
  if(route[0]==='inquiries'&&route[1]&&route[2]==='bor-transfer')return response({inquiry:await transferWithBor(route[1],user,await request.formData())});

  if(route[0]==='proposal-preview'){
    const body=z.object({templateId:z.string().max(30),fields:z.record(z.string().max(2000)).refine(values=>Object.keys(values).length<=Object.keys(LABELS).length&&Object.keys(values).every(key=>key in LABELS),'Use supported proposal fields only'),original:z.boolean().optional(),inquiryId:z.string().max(100).optional(),customEdits:customEditsSchema.optional()}).strict().parse(await request.json());
    const previewRecord=body.inquiryId?await inquiry(body.inquiryId):undefined;const template=previewRecord?.supervisorEdit&&previewRecord.templateId===body.templateId?await chosen(previewRecord):(await catalog()).find(t=>t.id===body.templateId&&t.active);if(!template)throw new AppError('Template not found',404);
    if(body.fields.requestDate&&!/^\d{4}-\d{2}-\d{2}$/.test(body.fields.requestDate))throw new AppError('Use a valid date for the proposal preview.');
    const bytes=body.original?readFileSync(sourceFile(template)):await fillDocx(template,body.fields,true);
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
  if(route[0]==='intake'){const form=await request.formData(),file=form.get('file');if(!(file instanceof File))throw new AppError('Choose the agent’s submitted PDF or Excel form.');return response({inquiry:await intake(user,file,String(form.get('sender')||''))},201);}
  if(route[0]==='notifications'){const body=z.union([z.object({all:z.literal(true)}).strict(),z.object({ids:z.array(z.string()).max(500)}).strict()]).parse(await request.json());if('all' in body){await db.run("UPDATE notifications SET data=json_insert(data,'$.readBy[#]',?) WHERE id IN (SELECT notice_id FROM notice_recipients WHERE user_id=? AND is_read=0)",user.id,user.id);return response({ok:true});}await transaction(async()=>{for(const id of body.ids){const row=await db.get('SELECT data FROM notifications WHERE id=?',id) as {data:string}|undefined;if(!row)continue;const notice=JSON.parse(row.data) as Notice;if(notice.recipientIds.includes(user.id)&&!notice.readBy.includes(user.id)){notice.readBy.push(user.id);await db.run('UPDATE notifications SET data=? WHERE id=?',JSON.stringify(notice),id);}}});return response({ok:true});}
  if(route[0]==='users'){if(user.role!=='Admin')throw new AppError('Admin access is required.',403);const body=z.object({id:z.string(),active:z.boolean(),role:z.enum(['Employee','Supervisor','Admin']),canApprove:z.boolean()}).parse(await request.json());await transaction(async()=>{const target=(await allUsers()).find(u=>u.id===body.id);if(!target)throw new AppError('Staff member not found',404);if(body.id===user.id&&(!body.active||body.role!=='Admin'))throw new AppError('Keep your current admin account active.');const updated={...target,...body,canApprove:body.role==='Supervisor'&&body.canApprove};if(!(await allUsers()).map(u=>u.id===target.id?updated:u).some(u=>u.active&&u.canApprove&&u.role==='Supervisor'))throw new AppError('Keep at least one active approving supervisor.');await db.run('UPDATE users SET data=? WHERE id=?',JSON.stringify(updated),body.id);await db.run('DELETE FROM sessions WHERE user_id=?',body.id);});return response({ok:true});}
  if(route[0]==='inquiries'&&route[1]&&route[2]==='progress-report'){const form=await request.formData(),file=form.get('file');const result=await addProgressReport(route[1],user,{revision:Number(form.get('revision')),requestId:form.get('requestId'),sender:form.get('sender'),sentAt:form.get('sentAt'),summary:form.get('summary'),reference:form.get('reference')},file instanceof File?file:undefined);return response({inquiry:await withHistoricalHold(result)});}
  if(route[0]==='inquiries'&&route[1]){const id=route[1],action=route[2],body=await request.json();
    if(action==='activity')return response(await updateInquiryActivity(id,user,tokenHash(request.cookies.get('rmc2_session')!.value),body));
    const result=action==='request-expired-transfer'?await requestExpiredTransfer(id,user,body):action==='review-historical'?await reviewHistorical(id,user,body):action==='agent-transfer-decision'?await decideAgentTransfer(id,user,body):action==='decline'?await declineInquiry(id,user,body):action==='begin-review-edit'?await beginSupervisorEdit(id,user,body):action==='cancel-review-edit'?await cancelSupervisorEdit(id,user,body):action==='review-client'?await reviewClientRegistration(id,user,body):action==='customize'?await customize(id,user,body):action==='save'?await saveDraft(id,user,body):action==='generate'?await generate(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='submit'?await submit(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='decision'?await decide(id,user,body):action==='retry'?await retry(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='request-details'?await requestDetails(id,user,body):action==='confirm-sent'?await confirmSent(id,user,body):action==='confirm-not-sent'?await confirmNotSent(id,user,body):action==='chat'?await chat(id,user,body):null;
    if(!result)throw new AppError('Action not found',404);return response({inquiry:await withHistoricalHold(result)});}
  throw new AppError('Route not found',404);
}catch(error){return errorResponse(error);}}
