import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
const base=process.env.RMC2_TEST_URL||'http://127.0.0.1:5190';
if(!/^http:\/\/(127\.0\.0\.1|localhost):(5190|5194)$/.test(base))throw new Error('Use an isolated localhost QA instance on port 5190 or 5194 for workflow tests.');
const sessions={};const checks=[];const handlingTabs={};
const ok=(name,test=true)=>{assert.ok(test,name);checks.push(name);process.stdout.write('PASS '+name+'\n');};
async function call(user,route,body,expected=200){const response=await fetch(base+'/api/operations/'+route,{method:body===undefined?'GET':'POST',headers:{...(sessions[user]?{Cookie:sessions[user]}:{}),...(body instanceof FormData?{}:body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(route==='login'&&response.ok)sessions[user]=response.headers.get('set-cookie').split(';')[0];const content=response.headers.get('content-type')||'';const value=content.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());assert.equal(response.status,expected,route+': '+JSON.stringify(value));return value;}
async function login(id){await call(id,'login',{email:id+'@rmc2.local',password:'Rmc2Local!2026'});}
async function state(id){return call(id,'bootstrap');}
async function save(user,record,changes={}){await call(user,'inquiries/'+record.id+'/activity',{tab:handlingTabs[user]??=(randomUUID()),action:'start'});return (await call(user,'inquiries/'+record.id+'/save',{revision:record.revision,fields:record.fields,templateId:record.templateId,notes:record.notes,email:record.email,emailOverrides:record.emailOverrides,...changes})).inquiry;}
async function action(user,record,name,extra={},expected=200){return (await call(user,'inquiries/'+record.id+'/'+name,{revision:record.revision,...extra},expected)).inquiry;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await call('none','bootstrap',undefined,401);ok('Server rejects unauthenticated access');
await call('bad','login',{email:'cryssa@rmc2.local',password:'wrong'},401);ok('Password is checked');
await Promise.all(['cryssa','jefferson','judy','emerson','zeo','admin'].map(login));
const expectedTemplates=JSON.parse(await readFile('resources/private/catalog.json','utf8')).filter(template=>template.active);
const original=await state('cryssa');ok('All '+expectedTemplates.length+' source templates loaded, including retained retired versions',original.templates.length===expectedTemplates.length);ok('Both supervisors can approve',original.users.filter(u=>u.canApprove&&u.active).length===2);
const sampleBytes=await call('cryssa','sample-form');const fixture=new ExcelJS.Workbook();await fixture.xlsx.load(sampleBytes);const identity='[TEST] Workflow '+randomUUID();for(const cell of ['B10','D14','B21'])fixture.worksheets[0].getCell(cell).value=identity;const bytes=await fixture.xlsx.writeBuffer();const form=new FormData();form.append('file',new File([bytes],'filled-franchise-form.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));form.append('sender','agent.workflow@example.com');
let record=(await call('cryssa','intake',form,201)).inquiry;
ok('Real Excel workbook parsed',record.fields.company===identity&&record.source.cells.length>30);
ok('Agent reply recipient remains separate',record.fields.agentEmail==='agent.workflow@example.com'&&record.fields.contactEmail==='school.contact@example.com');
for(const person of original.users){const current=await state(person.id);ok(person.id+' received new inquiry notice',current.notifications.some(n=>n.inquiryId===record.id&&n.title==='New inquiry'));}
ok('Viewing does not record a handler',(await state('cryssa')).inquiries.find(r=>r.id===record.id).handledBy.length===0);
const staleCopy=record;
record=await save('cryssa',record,{fields:{...record.fields,company:identity+' revised',employeeAges:''},templateId:'d024'});
await call('jefferson','inquiries/'+record.id+'/save',{revision:staleCopy.revision,fields:staleCopy.fields,templateId:'',notes:'',email:staleCopy.email,emailOverrides:[]},409);ok('Stale colleague edits cannot overwrite current work');
ok('First contributor recorded',record.handledBy.includes('cryssa'));
ok('Original form remains unchanged',record.source.fields.company===identity);
await action('cryssa',record,'generate',{},400);ok('Missing ages block generation');
record=await action('cryssa',record,'request-details',{body:'Dear agent, please provide the employee age range.'});ok('Details request recorded',record.status==='Waiting for agent details'&&record.detailRequests.length===1);
record=await save('cryssa',record,{fields:{...record.fields,employeeAges:'25–58'},email:{...record.email,subject:'Reviewed proposal for local workflow test'},emailOverrides:['subject']});
record=await action('cryssa',record,'chat',{question:'Compare the alternatives'});ok('Assistant cites only supplied sources',record.chat.at(-1).sources.every(id=>original.templates.some(t=>t.id===id)));
record=await action('cryssa',record,'generate');ok('Actual multi-page PDF and DOCX generated',!!record.generated&&record.generated.pageCount>1);
ok('Manual email subject survives generation',record.email.subject==='Reviewed proposal for local workflow test');
const firstPdf=await call('cryssa','file/'+record.id+'/pdf');ok('PDF has a real PDF header',firstPdf.subarray(0,4).toString()==='%PDF');
const sourceMaster=await call('cryssa','file/'+record.id+'/master');ok('Exact proposal master is archived with the package',sha(sourceMaster)===record.generated.sourceHash);
record=await action('cryssa',record,'submit');ok('Submitted package is immutable',record.status==='Awaiting approval'&&record.submissions.length===1);
for(const id of ['emerson','zeo'])ok(id+' receives approval notice',(await state(id)).notifications.some(n=>n.inquiryId===record.id&&n.title==='Proposal awaiting approval'));
await action('cryssa',record,'decision',{version:1,action:'approve',note:'',flags:[]},403);ok('Employee cannot approve through the API');
await call('cryssa','inquiries/'+record.id+'/save',{revision:record.revision,fields:record.fields,templateId:record.templateId,notes:'',email:record.email,emailOverrides:[]},409);ok('Submission is locked against employee edits');
await action('zeo',record,'decision',{version:1,action:'return',note:'',flags:[]},400);ok('Returning requires a reason');
const submitted1=record;
record=await action('zeo',record,'decision',{version:1,action:'return',note:'Confirm the addressee position.',flags:['Client details']});ok('Zeo can return a proposal with flags',record.status==='Needs correction');
await action('emerson',submitted1,'decision',{version:1,action:'approve',note:'',flags:[]},409);ok('Second stale supervisor decision is rejected');
record=await save('jefferson',record,{fields:{...record.fields,addresseePosition:'Administrative Officer'},notes:'Position confirmed with agent.'});
record=await action('jefferson',record,'generate');record=await action('jefferson',record,'submit');ok('After return, a colleague can start handling, correct and resubmit',record.submissions.length===2&&record.handledBy.includes('jefferson'));
ok('New preparer identity is retained',record.submissions[1].generated.preparedBy==='jefferson');
const oldPdf=await call('emerson','file/'+record.id+'/pdf?version=1');ok('Previous PDF version is preserved',sha(oldPdf)===sha(firstPdf));
ok('Previous source master is preserved',sha(await call('emerson','file/'+record.id+'/master?version=1'))===sha(sourceMaster));
const submitted2=record;
record=await action('emerson',record,'decision',{version:2,action:'approve',note:'Corrected details approved.',flags:[],failSend:true});ok('Failed automatic send retains approval',record.status==='Approved — email failed'&&record.submissions[1].decision.action==='approve');
await action('zeo',submitted2,'decision',{version:2,action:'approve',note:'',flags:[]},409);ok('One approval resolves the request');
record=await action('jefferson',record,'retry');ok('Retry sends approved version without another approval',record.status==='Sent'&&record.submissions[1].delivery.mode==='local-test');
const eml=await call('cryssa','file/'+record.id+'/eml?version=2');const mail=eml.toString('utf8');ok('Approved reply is addressed to agent',mail.includes('To: agent.workflow@example.com'));
const attachment=mail.match(/Content-Disposition: attachment;[^\r]+\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/);assert.ok(attachment);const attachedPdf=Buffer.from(attachment[1].replace(/\s/g,''),'base64');const secondPdf=await call('cryssa','file/'+record.id+'/pdf?version=2');ok('Email attaches the exact approved PDF',sha(attachedPdf)===sha(secondPdf));
await action('jefferson',record,'retry',{},409);ok('A sent reply cannot be retried / duplicated');
const notice=(await state('cryssa')).notifications.find(n=>n.inquiryId===record.id&&n.title==='New inquiry');await call('cryssa','notifications',{ids:[notice.id]});ok('Notification read receipts are per staff member',!(await state('judy')).notifications.find(n=>n.id===notice.id).readBy.includes('judy'));
await call('cryssa','users',{id:'zeo',role:'Supervisor',active:true,canApprove:false},403);ok('Staff role changes require admin permission');
const catalogWorkbook=new ExcelJS.Workbook();await catalogWorkbook.xlsx.load(bytes);const catalogSheet=catalogWorkbook.worksheets[0],catalogIdentity='[TEST] Catalog verification '+randomUUID();catalogSheet.getCell('B10').value=catalogIdentity;catalogSheet.getCell('D14').value=catalogIdentity;catalogSheet.getCell('B21').value=catalogIdentity;
const form2=new FormData();form2.append('file',new File([await catalogWorkbook.xlsx.writeBuffer()],'catalog-test.xlsx'));form2.append('sender','catalog.agent@example.com');let catalogRecord=(await call('cryssa','intake',form2,201)).inquiry;
const generated=[];
for(const template of original.templates.filter(t=>t.active)){catalogRecord=await save('cryssa',catalogRecord,{fields:{...catalogRecord.fields,company:catalogIdentity,employeeAges:'25–58',dependents:'0',payment:'Annual'},templateId:template.id});catalogRecord=await action('cryssa',catalogRecord,'generate');generated.push({sourceId:template.sourceId,...catalogRecord.generated});ok(template.sourceId+' placeholders compile into a PDF',catalogRecord.generated.pageCount>1);}
await mkdir('test-results',{recursive:true});await writeFile('test-results/workflow.json',JSON.stringify({at:new Date().toISOString(),checks,workflowInquiry:record.id,catalogInquiry:catalogRecord.id,generated,finalVersion:record.submissions[1]},null,2));
process.stdout.write(`\n${checks.length} checks passed. Workflow inquiry: ${record.id}.\n`);
