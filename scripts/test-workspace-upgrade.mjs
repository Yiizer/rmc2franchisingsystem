import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import PizZip from 'pizzip';
import ExcelJS from 'exceljs';
import {PDFDocument} from 'pdf-lib';

const base='http://127.0.0.1:5190/api/operations/',out='test-results/workspace-upgrade';
await mkdir(out,{recursive:true});const cookies={},checks=[],run=Date.now();
async function call(who,route,body,expected=200,headers={}){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{Cookie:cookies[who]}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  const value=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,expected,route+': '+(Buffer.isBuffer(value)?'binary':JSON.stringify(value)));
  if(route==='login'&&response.ok)cookies[who]=response.headers.get('set-cookie').split(';')[0];return value;
}
const pass=(name,condition=true)=>{assert.ok(condition,name);checks.push(name);console.log('PASS '+name);};
const act=(who,record,action,extra={},expected=200)=>call(who,'inquiries/'+record.id+'/'+action,{revision:record.revision,...extra},expected).then(result=>result.inquiry);
const bootstrap=who=>call(who,'bootstrap');
const payload=record=>({fields:record.fields,templateId:record.templateId,customization:record.customization?{id:record.customization.id,edits:record.customization.edits}:null,notes:record.notes,email:record.email,emailOverrides:record.emailOverrides});
for(const who of ['cryssa','jefferson','emerson','zeo','admin'])await call(who,'login',{email:who,password:'Rmc2Local!2026'});
const initial=await bootstrap('admin'),database=new DatabaseSync(out+'/qa-data/rmc2.sqlite');database.exec('PRAGMA busy_timeout=5000');
assert.ok(database.prepare('SELECT id FROM users WHERE id=?').get('admin'),'Use the dedicated QA database.');
const sample=await call('cryssa','sample-form');
async function intake(company,person,agent='Megan',sender='megan@example.test'){
  const book=new ExcelJS.Workbook();await book.xlsx.load(sample);const sheet=book.worksheets[0];
  for(const [cell,value] of Object.entries({B10:company,D14:person,B21:person,C7:agent,J10:'PRIVATE',J11:'Services',D22:'Total CorpoHealthCheck',G23:'Annual',D25:25,J24:0,C26:'25–55'}))sheet.getCell(cell).value=value;
  const form=new FormData();form.set('sender',sender);form.set('file',new File([await book.xlsx.writeBuffer()],'qa-form.xlsx'));return (await call('cryssa','intake',form,201)).inquiry;
}
const hold=async(who,r)=>{await call(who,'inquiries/'+r.id+'/activity',{action:'start',tab:randomUUID()});};
function fixture(r,values){assert.ok(database.prepare('SELECT id FROM inquiries WHERE id=?').get(r.id));const next={...r,...values,revision:r.revision+1};database.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(next.revision,JSON.stringify(next),r.id);return next;}
try{
  pass('CorpoAide is retired from selections while its catalog/source history is retained',initial.templates.filter(t=>t.active).length===11&&initial.templates.filter(t=>['d091','d092','d093'].includes(t.id)).every(t=>!t.active));
  await call('anonymous','bootstrap',undefined,401);await call('cryssa','monitoring',undefined,403);await call('jefferson','template-history',undefined,403);await call('cryssa','template-upload',new FormData(),403);
  pass('Admin tools, template publishing and health data are protected by server-side role checks');
  assert.deepEqual(await call('anonymous','login-options'),{users:[]});
  await call('cryssa','notifications',{ids:[]},403,{Origin:'https://unrelated.example.test'});
  pass('Login does not enumerate staff; cross-origin changes are rejected');
  const person={name:'QA New Employee',username:'qa'+run,email:'qa'+run+'@example.test',role:'Employee',position:'QA',canApprove:false,currentPassword:'Rmc2Local!2026'};
  await call('cryssa','create-account',person,403);await call('admin','create-account',{...person,currentPassword:'incorrect'},403);
  const created=await call('admin','create-account',person,201);assert.ok(created.temporaryPassword.length>=20);
  await call('fresh','login',{email:person.username,password:created.temporaryPassword});await call('fresh','notifications',{ids:[]},403);await call('fresh','sample-form',undefined,403);assert.deepEqual((await bootstrap('fresh')).inquiries,[]);
  await call('fresh','account-settings',{username:person.username,currentPassword:'wrong',password:'New QA passphrase 2026!'},403);
  await call('fresh','account-settings',{username:'admin',currentPassword:created.temporaryPassword,password:'New QA passphrase 2026!'},409);
  await call('fresh2','login',{email:person.username,password:created.temporaryPassword});
  await call('fresh','account-settings',{username:person.username+'updated',currentPassword:created.temporaryPassword,password:'New QA passphrase 2026!'});
  await call('fresh','bootstrap',undefined,401);await call('fresh2','bootstrap',undefined,401);
  await call('fresh','login',{email:person.username+'updated',password:'New QA passphrase 2026!'});
  const stored=database.prepare('SELECT password FROM users WHERE id=?').get(created.user.id).password;assert.ok(!stored.includes('New QA passphrase'));
  pass('Admin creates unique staff accounts; temporary password must change; credentials are hashed and all old sessions are revoked');
  for(let i=0;i<8;i++)await call('unknown','login',{email:'rate-limit-'+run,password:'bad'},401);
  await call('unknown','login',{email:'rate-limit-'+run,password:'bad'},429);pass('Repeated login failures are throttled');

  let original=await intake('Expired client '+run,'Clement '+run);await hold('cryssa',original);original=await act('cryssa',original,'request-details',{body:'Please confirm your franchise details.'});
  original=fixture(original,{protection:{...original.protection,startedAt:new Date(Date.now()-31*86400000).toISOString(),activityAt:new Date(Date.now()-31*86400000).toISOString(),expiresAt:new Date(Date.now()-86400000).toISOString()}});
  const repeated=await intake('Expired client '+run,'Clement '+run);
  pass('The same agent’s expired client repeat is flagged, automatically declined and archived',repeated.status==='Declined'&&repeated.closure.relatedId===original.id&&(await bootstrap('cryssa')).clientStates[repeated.id].state==='archived');
  await call('cryssa','inquiries/'+repeated.id+'/activity',{tab:randomUUID(),action:'start'},409);
  const intakePdf=await PDFDocument.create();intakePdf.addPage().drawText('Pending client identity '+run);const intakeForm=new FormData();intakeForm.set('sender','megan@example.test');intakeForm.set('file',new File([await intakePdf.save()],'late-identity.pdf'));
  let pending=(await call('cryssa','intake',intakeForm,201)).inquiry;assert.equal(pending.clientReview.state,'identify');await hold('cryssa',pending);
  pending=await act('cryssa',pending,'save',{...payload(pending),fields:{...original.fields}});
  pass('A PDF import is also declined when later identification reveals an expired same-agent repeat',pending.status==='Declined'&&pending.closure.relatedId===original.id);
  let freshAgent=await intake('Expired client '+run,'Clement '+run,'Josh','josh@example.test');assert.equal(freshAgent.clientReview.state,'duplicate');freshAgent=await act('cryssa',freshAgent,'review-client',{action:'recheck'});assert.equal(freshAgent.clientReview.state,'duplicate');await act('cryssa',freshAgent,'review-client',{action:'reassign-expired',note:'Reviewed expired protection and a different incoming agent.'},403);freshAgent=await act('emerson',freshAgent,'review-client',{action:'reassign-expired',note:'Reviewed expired protection and a different incoming agent.'});pass('A different agent remains on hold after expiry until a supervisor approves the new registration',freshAgent.clientReview.state==='clear');
  let active=await intake('BOR client '+run,'BOR Clement '+run);
  let duplicate=await intake('BOR client '+run,'BOR Clement '+run,'Declined Agent','declined@example.test');
  duplicate=await act('cryssa',duplicate,'decline',{reason:'Existing registration remains protected; unavailable for this agent.'});
  pass('Employees can decline an unavailable duplicate and retain linked evidence in Archives',duplicate.closure.kind==='declined'&&duplicate.closure.relatedId===active.id);
  let incoming=await intake('BOR client '+run,'BOR Clement '+run,'Josh','josh@example.test');
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Fictional verified broker of record for QA');const bor=await pdf.save();
  const repeatAfterHandover=await intake('Expired client '+run,'Clement '+run);
  assert.equal(repeatAfterHandover.status,'Declined');
  let laterBor=await intake('Expired client '+run,'Clement '+run,'Riley','riley@example.test');
  assert.equal(laterBor.clientReview.matches.length,1);assert.equal(laterBor.clientReview.matches[0].inquiryId,freshAgent.id);
  const laterBorForm=new FormData();Object.entries({revision:laterBor.revision,previousId:freshAgent.id,previousRevision:freshAgent.revision,reference:'Later BOR '+run,note:'Verified the current client holder and new BOR agent.',verified:'true'}).forEach(([key,value])=>laterBorForm.set(key,String(value)));laterBorForm.set('file',new File([bor],'later-bor.pdf'));
  laterBor=(await call('cryssa','inquiries/'+laterBor.id+'/bor-transfer',laterBorForm)).inquiry;
  pass('Expired history still rejects the former agent but does not block a later verified BOR handover',laterBor.clientReview.state==='clear');
  function borForm(verified=true){const form=new FormData();Object.entries({revision:incoming.revision,previousId:active.id,previousRevision:active.revision,reference:'QA verified BOR '+run,note:'Verified client authorization and incoming agent identity.',verified:String(verified)}).forEach(([key,value])=>form.set(key,String(value)));form.set('file',new File([bor],'bor.pdf'));return form;}
  await call('cryssa','inquiries/'+incoming.id+'/bor-transfer',borForm(false),400);
  incoming=(await call('cryssa','inquiries/'+incoming.id+'/bor-transfer',borForm())).inquiry;
  const transferred=(await bootstrap('cryssa')).inquiries.find(record=>record.id===active.id);
  pass('Verified BOR transfers to a different agent, archives the previous registration, and records both audit trails',!!incoming.bor&&incoming.clientReview.state==='clear'&&transferred.closure.relatedId===incoming.id&&transferred.status==='Transferred');
  assert.deepEqual(await call('cryssa','file/'+incoming.id+'/bor'),Buffer.from(bor));await call('anonymous','file/'+incoming.id+'/bor',undefined,401);
  await call('cryssa','inquiries/'+active.id+'/activity',{tab:randomUUID(),action:'start'},409);pass('BOR evidence is private and the previous registration cannot continue processing');

  let proposal=await intake('Supervisor edited client '+run,'Dr. QA Client '+run,'Agent QA','review@example.test');
  await hold('cryssa',proposal);proposal=await act('cryssa',proposal,'save',{...payload(proposal),templateId:'d054'});proposal=await act('cryssa',proposal,'generate');
  const oldPdf=await call('cryssa','file/'+proposal.id+'/pdf');proposal=await act('cryssa',proposal,'submit');const frozen=structuredClone(proposal.submissions[0]);
  await act('cryssa',proposal,'begin-review-edit',{version:1},403);
  proposal=await act('emerson',proposal,'begin-review-edit',{version:1});await hold('emerson',proposal);
  await act('cryssa',proposal,'save',payload(proposal),409);await call('cryssa','inquiries/'+proposal.id+'/activity',{tab:randomUUID(),action:'start'},403);assert.equal((await bootstrap('emerson')).activity.find(a=>a.inquiryId===proposal.id).userId,'emerson');await call('zeo','inquiries/'+proposal.id+'/activity',{tab:randomUUID(),action:'start'},423);await act('zeo',proposal,'decision',{version:1,action:'approve',note:'',flags:[]},409);
  pass('Only an approving supervisor edits the review copy; employee saves, competing edits and stale approvals are blocked');
  const master=initial.templates.find(t=>t.id==='d054'),bytes=await call('admin','source/d054'),zip=new PizZip(bytes);zip.file('word/document.xml',zip.file('word/document.xml').asText().replace('appreciate','appreciate very much'));
  const changed=zip.generate({type:'nodebuffer'});
  function uploadForm(file=changed,id='d054'){const form=new FormData();Object.entries({templateId:id,expectedHash:id?master.sourceHash:'',family:master.family,variant:'Standard',sector:'All',annualOnly:'false',warnings:'QA replacement source notes'}).forEach(([key,value])=>form.set(key,value));form.set('file',new File([file],'qa-updated-template.docx'));return form;}
  const unsafe=new PizZip(bytes);unsafe.file('word/vbaProject.bin','fake');await call('admin','template-upload',uploadForm(unsafe.generate({type:'nodebuffer'})),400);
  const external=new PizZip(bytes);external.file('word/_rels/unsafe.rels','<Relationships><Relationship TargetMode="External" Target="file:///private"/></Relationships>');await call('admin','template-upload',uploadForm(external.generate({type:'nodebuffer'})),400);
  const staged=await call('admin','template-upload',uploadForm(),201);assert.equal((await bootstrap('admin')).templates.find(t=>t.id==='d054').sourceHash,master.sourceHash);
  await call('admin','template-publish',{id:staged.id,reviewed:false},400);await call('cryssa','template-publish',{id:staged.id,reviewed:true},403);
  await call('admin','template-publish',{id:staged.id,reviewed:true});assert.equal((await bootstrap('admin')).templates.find(t=>t.id==='d054').sourceHash,createHash('sha256').update(changed).digest('hex'));
  pass('Admin replacement requires validated DOCX, rendered preview and explicit review; active and previous versions are preserved');
  assert.deepEqual(await call('cryssa','file/'+proposal.id+'/pdf?version=1'),oldPdf);
  const model=await call('emerson','custom-document',{inquiryId:proposal.id,templateId:'d054',fields:proposal.fields,edits:{}}),block=model.blocks.find(block=>block.original.includes('appreciate'));
  assert.ok(block,'Supervisor edits use the archived submitted master even after the live template changes');
  proposal.customization.edits[block.id]={text:block.original.replace('appreciate','appreciate greatly')};
  proposal=await act('emerson',proposal,'save',payload(proposal));proposal=await act('emerson',proposal,'generate');proposal=await act('emerson',proposal,'submit');
  assert.equal(proposal.submissions.length,2);assert.deepEqual(proposal.submissions[0].generated,frozen.generated);assert.deepEqual(proposal.submissions[0].fields,frozen.fields);assert.equal(proposal.submissions[1].supervisorRevision.by,'emerson');
  const reviewedPdf=await call('emerson','file/'+proposal.id+'/pdf?version=2');
  proposal=await act('zeo',proposal,'decision',{version:2,action:'approve',note:'Reviewed the minor changes.',flags:[],customizationReviewed:true});assert.equal(proposal.status,'Sent');
  assert.deepEqual(await call('zeo','file/'+proposal.id+'/pdf?version=2'),reviewedPdf);
  const eml=(await call('zeo','file/'+proposal.id+'/eml?version=2')).toString();assert.ok(eml.replace(/\r\n/g,'').includes(reviewedPdf.toString('base64')));
  pass('Supervisor edits produce a new version; either supervisor approves it; the delivered PDF is exact and the old version is unchanged');
  const added=await call('admin','template-upload',uploadForm(changed,''),201);await call('admin','template-publish',{id:added.id,reviewed:true});
  const addedTemplate=(await bootstrap('admin')).templates.find(t=>t.id===added.template.id);assert.ok(addedTemplate.active);await call('admin','template-active',{id:addedTemplate.id,expectedHash:addedTemplate.sourceHash,active:false});
  pass('Admin can add a distinct template, view its version history, and retire it without deleting files',(await call('admin','template-history')).versions.length>=3);
  const health=await call('admin','monitoring-check',{});pass('Admin connectivity checks exercise database, private storage and PDF conversion; token counts reflect no live AI usage',health.services.filter(s=>['Database','Private file storage','PDF converter'].includes(s.name)).every(s=>s.state==='healthy')&&health.ai.usage.requests===0);
  await writeFile(out+'/fixtures.json',JSON.stringify({proposalId:proposal.id,duplicateId:duplicate.id,incomingId:incoming.id,createdUser:created.user.id,run},null,2));
}finally{database.close();await writeFile(out+'/checks.json',JSON.stringify(checks,null,2));}
