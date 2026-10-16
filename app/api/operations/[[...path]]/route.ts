import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { AppError, allUsers, catalog, db, inquiries, inquiry, passwordMatches, safeStorage, sourceFile, tokenHash } from '@/lib/operations/database';
import { customDocument, customEditsSchema } from '@/lib/operations/custom-documents';
import { chat, customize, decide, generate, intake, requestDetails, retry, saveDraft, submit } from '@/lib/operations/service';
import { sampleForm } from '@/lib/operations/forms';
import { previewWorkbook } from '@/lib/operations/form-preview';
import { fillDocx } from '@/lib/operations/documents';
import { conversionName, pdfFromDocx } from '@/lib/operations/document-renderer';
import { activeInquiryActivity, updateInquiryActivity } from '@/lib/operations/activity';
import { LABELS, isSampleForm } from '@/lib/operations/types';
import { packageRenderers } from '@/lib/operations/package-rendering';
import path from 'node:path';
import type { Notice, Staff } from '@/lib/operations/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path?:string[]}>};
function staff(request:NextRequest):Staff {
  const token=request.cookies.get('rmc2_session')?.value;if(!token)throw new AppError('Sign in to your workspace.',401);
  const session=db().prepare('SELECT user_id,expires FROM sessions WHERE token=?').get(tokenHash(token)) as {user_id:string;expires:string}|undefined;
  if(!session||Date.parse(session.expires)<Date.now())throw new AppError('Your session expired. Sign in again.',401);
  const user=allUsers().find(u=>u.id===session.user_id&&u.active);if(!user)throw new AppError('This staff account is inactive.',401);return user;
}
function response(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function errorResponse(error:unknown){if(error instanceof ZodError)return response({error:error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')},400);if(error instanceof AppError)return response({error:error.message},error.status);console.error('Operations error',error);return response({error:'The request could not be completed. Check the server log and try again.'},500);}
function fileResponse(bytes:Buffer,mime:string,name:string,attachment=true) {return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':mime,'Content-Disposition':`${attachment?'attachment':'inline'}; filename="${name.replace(/[^a-zA-Z0-9_. -]/g,'_')}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export async function GET(request:NextRequest,context:Context){try{
  const route=(await context.params).path||[];
  if(route[0]==='login-options')return response({users:allUsers().map(({id,name,email,role})=>({id,name,email,role}))});
  const user=staff(request);
  if(route[0]==='bootstrap'){const notices=(db().prepare('SELECT data FROM notifications').all() as {data:string}[]).map(r=>JSON.parse(r.data) as Notice).filter(n=>n.recipientIds.includes(user.id)).sort((a,b)=>b.at.localeCompare(a.at));const records=inquiries();return response({user,users:allUsers(),inquiries:records,packageRenderers:packageRenderers(records),activity:activeInquiryActivity(),templates:catalog().map(({file,text,...t})=>({...t,text,file:''})),notifications:notices,integrations:{database:'SQLite · shared server storage',gmail:'Local test mailbox · no real Gmail sends',ai:'Simulated · supplied proposal sources only',documents:conversionName()}});}
  if(route[0]==='pdf-worker')return new NextResponse(readFileSync(path.join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')),{headers:{'Content-Type':'text/javascript','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
  if(route[0]==='sample-form')return fileResponse(await sampleForm(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','RMC2-sample-franchise-form.xlsx');
  if(route[0]==='form-preview'&&route[1]){const record=inquiry(route[1]);if(!record.source.storage&&!isSampleForm(record.source))throw new AppError('This inquiry has no submitted Excel attachment.',404);try{return response(await previewWorkbook(record.source.storage?readFileSync(safeStorage(record.source.storage)):await sampleForm(record.source.fields)));}catch(error){throw new AppError(error instanceof Error&&/^(The attachment|Too many sheets|A populated sheet|The sheet layout)/.test(error.message)?error.message:'The attachment could not be previewed. Download the original Excel file.');}}
  if(route[0]==='source'&&route[1]){const template=catalog().find(t=>t.id===route[1]);if(!template)throw new AppError('Template not found',404);return fileResponse(readFileSync(sourceFile(template)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',template.sourceName);}
  if(route[0]==='file'&&route[1]){const record=inquiry(route[1]),kind=route[2],version=Number(request.nextUrl.searchParams.get('version')),snapshot=version?record.submissions.find(s=>s.version===version):undefined,generated=version?snapshot?.generated:record.generated;
    if(kind==='source'){if(!record.source.storage&&isSampleForm(record.source))return fileResponse(await sampleForm(record.source.fields),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Sample-franchise-form.xlsx');if(!record.source.storage)throw new AppError('This starting example has no submitted attachment. Import an agent’s PDF or Excel form to test intake.',404);const pdf=record.source.format==='pdf'||record.source.filename.toLowerCase().endsWith('.pdf');return fileResponse(readFileSync(safeStorage(record.source.storage)),pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',record.source.filename,!pdf||request.nextUrl.searchParams.get('download')==='1');}
    if(kind==='eml'){const submission=snapshot||record.submissions.at(-1);if(!submission?.delivery)throw new AppError('No delivered email exists for this version.',404);return fileResponse(readFileSync(safeStorage(submission.delivery.file)),'message/rfc822',record.id+'-v'+submission.version+'.eml');}
    if(kind==='details'){const index=Number(request.nextUrl.searchParams.get('index'));const item=record.detailRequests[index];if(!item)throw new AppError('Details request not found',404);return fileResponse(readFileSync(safeStorage(item.file)),'message/rfc822',record.id+'-details.eml');}
    if(kind==='master'){if(!generated?.sourceDocx)throw new AppError('An archived master is not available for this earlier package.',404);return fileResponse(readFileSync(safeStorage(generated.sourceDocx)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',generated.sourceName||'original-proposal-master.docx');}
    if(!generated||!['pdf','docx'].includes(kind))throw new AppError('Generate a proposal first.',404);
    const packageId=request.nextUrl.searchParams.get('package');if(packageId&&packageId!==generated.id)throw new AppError('The prepared file changed. Reload the latest proposal.',409);
    return fileResponse(readFileSync(safeStorage(kind==='pdf'?generated.pdf:generated.docx)),kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',generated.filename+'.'+kind,kind!=='pdf');}
  throw new AppError('Route not found',404);
}catch(error){return errorResponse(error);}}
export async function POST(request:NextRequest,context:Context){try{
  const origin=request.headers.get('origin');
  if(origin){const from=new URL(origin),host=new URL(request.nextUrl.protocol+'//'+(request.headers.get('host')||request.nextUrl.host));const loopback=['localhost','127.0.0.1','[::1]'];const sameHost=from.host===host.host||(loopback.includes(from.hostname)&&loopback.includes(host.hostname)&&from.port===host.port);if(!sameHost||from.protocol!==host.protocol)throw new AppError('Use the application on the same origin.',403);}
  const route=(await context.params).path||[];
  if(route[0]==='login'){const body=z.object({email:z.string().email(),password:z.string().min(1).max(200)}).parse(await request.json());const row=(db().prepare('SELECT data,password FROM users').all() as {data:string;password:string}[]).find(r=>JSON.parse(r.data).email.toLowerCase()===body.email.toLowerCase());if(!row||!JSON.parse(row.data).active||!passwordMatches(body.password,row.password))throw new AppError('The email or password is incorrect.',401);const token=randomBytes(32).toString('hex'),user=JSON.parse(row.data) as Staff;db().prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token),user.id,new Date(Date.now()+12*3600000).toISOString());const result=response({user});result.cookies.set('rmc2_session',token,{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/',maxAge:12*3600});return result;}
  const user=staff(request);
  if(route[0]==='proposal-preview'){
    const body=z.object({templateId:z.string().max(30),fields:z.record(z.string().max(2000)).refine(values=>Object.keys(values).length<=Object.keys(LABELS).length&&Object.keys(values).every(key=>key in LABELS),'Use supported proposal fields only'),original:z.boolean().optional(),inquiryId:z.string().max(100).optional(),customEdits:customEditsSchema.optional()}).strict().parse(await request.json());
    const template=catalog().find(t=>t.id===body.templateId&&t.active);if(!template)throw new AppError('Template not found',404);
    if(body.fields.requestDate&&!/^\d{4}-\d{2}-\d{2}$/.test(body.fields.requestDate))throw new AppError('Use a valid date for the proposal preview.');
    const bytes=body.original?readFileSync(sourceFile(template)):await fillDocx(template,body.fields,true);
    if(body.original&&createHash('sha256').update(bytes).digest('hex')!==template.sourceHash)throw new AppError('The proposal source changed. Review the new master before previewing.',409);
    let previewBytes=bytes;
    if(body.customEdits&&!body.original){const record=body.inquiryId?inquiry(body.inquiryId):null;if(!record?.customization||record.templateId!==template.id||record.customization.sourceHash!==template.sourceHash)throw new AppError('Open a customized inquiry to preview content edits.',409);previewBytes=customDocument(bytes,body.customEdits).bytes;}
    const pdf=await pdfFromDocx(previewBytes,true);
    // Transient preview: no inquiry, handler, approval or audit mutation.
    return fileResponse(pdf.bytes,'application/pdf',template.sourceId+'-preview.pdf',false);
  }
  if(route[0]==='custom-document'){
    const body=z.object({inquiryId:z.string().max(100),templateId:z.string().max(100),fields:z.record(z.string().max(3000)).refine(values=>Object.keys(values).every(key=>key in LABELS),'Use supported proposal fields only'),edits:customEditsSchema}).strict().parse(await request.json());
    const record=inquiry(body.inquiryId),template=catalog().find(t=>t.id===body.templateId&&t.active);
    if(!template||!record.customization||record.customization.templateId!==template.id||record.customization.sourceHash!==template.sourceHash)throw new AppError('Create a customized copy before editing this document.',409);
    const result=customDocument(await fillDocx(template,body.fields,true),body.edits,true);
    return response({docx:result.bytes.toString('base64'),blocks:result.blocks,changes:result.changes});
  }
  if(route[0]==='logout'){const token=request.cookies.get('rmc2_session')?.value;if(token)db().prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token));const result=response({ok:true});result.cookies.delete('rmc2_session');return result;}
  if(route[0]==='intake'){const form=await request.formData(),file=form.get('file');if(!(file instanceof File))throw new AppError('Choose the agent’s submitted PDF or Excel form.');return response({inquiry:await intake(user,file,String(form.get('sender')||''))},201);}
  if(route[0]==='notifications'){const body=z.object({ids:z.array(z.string()).max(500)}).parse(await request.json());for(const id of body.ids){const row=db().prepare('SELECT data FROM notifications WHERE id=?').get(id) as {data:string}|undefined;if(!row)continue;const notice=JSON.parse(row.data) as Notice;if(notice.recipientIds.includes(user.id)&&!notice.readBy.includes(user.id)){notice.readBy.push(user.id);db().prepare('UPDATE notifications SET data=? WHERE id=?').run(JSON.stringify(notice),id);}}return response({ok:true});}
  if(route[0]==='users'){if(user.role!=='Admin')throw new AppError('Admin access is required.',403);const body=z.object({id:z.string(),active:z.boolean(),role:z.enum(['Employee','Supervisor','Admin']),canApprove:z.boolean()}).parse(await request.json());const target=allUsers().find(u=>u.id===body.id);if(!target)throw new AppError('Staff member not found',404);if(body.id===user.id&&(!body.active||body.role!=='Admin'))throw new AppError('Keep your current admin account active.');const updated={...target,...body,canApprove:body.role==='Supervisor'&&body.canApprove};if(!allUsers().map(u=>u.id===target.id?updated:u).some(u=>u.active&&u.canApprove&&u.role==='Supervisor'))throw new AppError('Keep at least one active approving supervisor.');db().prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(updated),body.id);db().prepare('DELETE FROM sessions WHERE user_id=?').run(body.id);return response({ok:true});}
  if(route[0]==='inquiries'&&route[1]){const id=route[1],action=route[2],body=await request.json();
    if(action==='activity')return response(updateInquiryActivity(id,user,tokenHash(request.cookies.get('rmc2_session')!.value),body));
    const result=action==='customize'?customize(id,user,body):action==='save'?saveDraft(id,user,body):action==='generate'?await generate(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='submit'?submit(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='decision'?await decide(id,user,body):action==='retry'?await retry(id,user,z.object({revision:z.number().int()}).parse(body).revision):action==='request-details'?requestDetails(id,user,body):action==='chat'?chat(id,user,body):null;
    if(!result)throw new AppError('Action not found',404);return response({inquiry:result});}
  throw new AppError('Route not found',404);
}catch(error){return errorResponse(error);}}
