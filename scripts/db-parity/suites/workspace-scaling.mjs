// Parity copy of scripts/test-workspace-scaling.mjs: identical except the fixture count comes from QA_SCALE (default 5000).
// Over the network to a remote Postgres, 5000 projections take more than 15 minutes (each inquiry is several round trips).
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';

const out=path.resolve('test-results/workspace-scaling/'+Date.now());
await mkdir(out,{recursive:true});
process.env.RMC2_DATA_DIR=path.join(out,'qa-data');
assert.ok(process.env.RMC2_DATA_DIR.startsWith(path.resolve('test-results')+path.sep));
for(const name of await readdir('lib/operations'))if(name.endsWith('.ts')){
  const source=await readFile('lib/operations/'+name,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g,'$1.mjs$2');
  await writeFile(path.join(out,name.replace(/\.ts$/,'.mjs')),code);
}
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')));
const database=await load('database'),rules=await load('client-rules'),index=await load('inquiry-index'),queries=await load('workspace-query');
const db=database.db,employee=(await database.allUsers()).find(user=>user.id==='cryssa'),supervisor=(await database.allUsers()).find(user=>user.id==='emerson');
const seed=(await database.inquiries())[0],checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const params=value=>new URLSearchParams(Object.entries(value).map(([key,value])=>[key,String(value)]));
const view=async(value={},user=employee)=>queries.workspaceView(user,params(value));
const fixture=(id,values={})=>{
  const r={...structuredClone(seed),id,revision:1,fields:{...seed.fields,company:'Archive company '+id,contactName:'Contact '+id,addressee:'Contact '+id,division:'Division '+(Number(id.slice(-1))%3+1)},source:{...seed.source,kind:'attachment',filename:'archive.xlsx',sourceHash:'hash-'+id,cells:[]},...values};
  r.source.fields={...r.fields};return r;
};
const insert={run:(...values)=>db.run('INSERT INTO inquiries(id,revision,data) VALUES (?,?,?)',...values)};
const save=async r=>await db.run('UPDATE inquiries SET revision=?,data=? WHERE id=?',r.revision,JSON.stringify(r),r.id);
const beforeHashes=await db.all('SELECT id,data FROM inquiries');

try{
  const cases=[];
  for(let i=0;i<80;i++){
    const record=fixture('INDEX-'+String(i).padStart(4,'0'));
    record.fields.company=i%5?'CafÃ© Test Co. '+(i%13):'Company '+i;
    record.fields.addressee=(i%3?'Dr. ':'')+'Clement '+(i%11);
    record.source.fields={...record.fields,company:i%7?record.fields.company:'Original Company '+(i%5)};
    if(i%9===0)record.source.sourceHash='shared-file';
    if(i%10===0)record.source.kind='sample';
    if(i%8===0)record.clientReview={state:'duplicate',identity:rules.clientIdentity(record),matches:[]};
    if(i%12===0)record.protection={startedAt:seed.createdAt,activityAt:seed.createdAt,expiresAt:new Date(Date.now()-1000).toISOString(),agentName:'Agent',agentEmail:'agent1@example.com',agentPhone:'09171234567',activityKind:'proposal'};
    if(i%16===0)record.closure={kind:'transferred',by:'emerson',at:seed.createdAt,reason:'Test'};
    cases.push(record);await insert.run(record.id,record.revision,JSON.stringify(record));
  }
  cases[1].clientReview={state:'clear',identity:rules.clientIdentity(cases[1]),matches:[],exceptions:[{inquiryId:cases[14].id,identity:rules.clientIdentity(cases[14])}]};await save(cases[1]);
  const complete=await database.inquiries(),fast=rules.clientStates(complete);
  for(const record of cases){
    const expected=rules.clientState(record,complete);
    assert.deepEqual(fast[record.id],expected);
    assert.deepEqual(rules.clientState(record,await index.matchingInquiries(record)),expected);
  }
  pass('Indexed duplicate checks match full scans for original/current names, files, titles, samples, exceptions, expired clients and transfers');
  const edited=structuredClone(cases[3]);edited.fields.company='Changed outside the application';edited.source.fields.company=edited.fields.company;edited.fields.addressee='Fresh name';edited.fields.contactName='Fresh name';edited.source.fields.addressee='Fresh name';edited.source.fields.contactName='Fresh name';edited.source.sourceHash='fresh-file';edited.revision++;await save(edited);
  assert.ok((await index.matchingInquiries(edited)).some(r=>r.id===edited.id));
  const oldCandidates=await index.matchingInquiries(cases[3]);assert.ok(!oldCandidates.some(r=>r.id===edited.id));
  pass('Direct SQLite imports/updates invalidate derived indexes and remove obsolete matching keys');
  const rolledBack=fixture('ROLLBACK-1'),abort=new Error('abort registration');await assert.rejects(database.transaction(async()=>{await insert.run(rolledBack.id,1,JSON.stringify(rolledBack));await index.matchingInquiries(rolledBack);throw abort;}),abort);assert.ok(!(await index.matchingInquiries(rolledBack)).some(r=>r.id===rolledBack.id));
  pass('A rolled-back registration also rolls back its lookup index');
  await db.run("DELETE FROM inquiries WHERE id LIKE 'INDEX-%'");
  const count=Number(process.env.QA_SCALE||5000);
  await database.transaction(async()=>{
  for(let i=0;i<count;i++){
    const id='PERF-'+String(i).padStart(6,'0'),record=fixture(id);
    record.createdAt=new Date(Date.now()-i*60000).toISOString();record.updatedAt=record.createdAt;
    record.history=Array.from({length:40},(_,j)=>({id:randomUUID(),at:record.createdAt,actorId:'cryssa',actor:'Test employee',action:'Historical activity '+j+' '+'.'.repeat(300)}));
    record.source.cells=Array.from({length:80},(_,j)=>({cell:'A'+j,value:'Historical spreadsheet value '+j}));
    record.notes='Private history must stay out of lists';
    if(i%2)record.closure={kind:'declined',at:record.createdAt,by:'cryssa',reason:'Historical request'};
    await insert.run(id,1,JSON.stringify(record));
  }
  });
  const started=performance.now(),first=await view({view:'Inquiries'}),coldMs=performance.now()-started;
  assert.equal(first.inquiries.length,25);assert.ok(first.pagination.total>=Math.floor(count/2));
  assert.ok(first.inquiries.every(r=>!('history' in r)&&!('source' in r)&&!('submissions' in r)&&!('notes' in r)));
  assert.deepEqual(first.packageRenderers,{});
  assert.ok(!JSON.stringify(first).includes('Private history must stay out of lists'));
  const next=await view({view:'Inquiries',page:2,metadataVersion:first.metadataVersion});
  assert.equal(next.inquiries.length,25);assert.ok(next.inquiries.every(r=>!first.inquiries.some(other=>other.id===r.id)));assert.ok(!next.templates&&!next.users);
  pass('5,000 history-heavy inquiries return 25 summaries, stable pages and no full history/source/PDF metadata in lists');
  const target='PERF-'+String(count-2).padStart(6,'0'),found=await view({view:'Inquiries',search:target});
  assert.equal(found.inquiries.length,1);assert.equal(found.inquiries[0].id,target);
  const archives=await view({view:'Archives',search:'PERF-'});assert.equal(archives.pagination.total,count/2);
  const divisions=await view({view:'Archives',division:'Division 2'});assert.ok(divisions.inquiries.every(r=>r.fields.division==='Division 2'));
  pass('Server-side search finds inquiries beyond the first page, with accurate archive totals and division filters');
  const warmStart=performance.now(),idle=await view({view:'Inquiries',cursor:first.cursor,metadataVersion:first.metadataVersion}),warmMs=performance.now()-warmStart;
  assert.equal(idle.unchanged,true);assert.ok(Buffer.byteLength(JSON.stringify(idle))<150);
  const fullStart=performance.now(),opened=await view({view:'Inquiry Workspace',selected:target,metadataVersion:first.metadataVersion});
  assert.equal(opened.current.id,target);assert.equal(opened.current.history.length,40);
  const local=await database.inquiry(target);local.fields.company='Updated by another employee';local.revision++;await save(local);
  const update=await view({view:'Inquiry Workspace',selected:target,knownRevision:opened.current.revision,cursor:opened.cursor,metadataVersion:first.metadataVersion});
  assert.equal(update.current.fields.company,'Updated by another employee');
  pass('Unchanged polling stays below 150 bytes; opening loads full history and colleague edits refresh the selected inquiry');
  const fullMs=performance.now()-fullStart;
  const untouched=await view({view:'Inquiry Workspace',selected:target,knownRevision:local.revision,metadataVersion:first.metadataVersion});assert.ok(!untouched.current);
  const notices=[];
  for(let i=0;i<55;i++){const notice={id:randomUUID(),inquiryId:target,title:'Notification '+i,message:'Test',at:new Date(Date.now()+i).toISOString(),recipientIds:['cryssa','emerson'],readBy:[]};notices.push(notice);await db.run('INSERT INTO notifications VALUES (?,?)',notice.id,JSON.stringify(notice));}
  const notices1=await view({view:'Notifications'}),notices2=await view({view:'Notifications',noticePage:2});
  assert.equal(notices1.notifications.length,25);assert.equal(notices2.notifications.length,25);assert.ok(notices1.unreadCount>=55);assert.ok(notices2.notifications.every(n=>!notices1.notifications.some(other=>other.id===n.id)));
  const read=notices[0];read.readBy=['cryssa'];await db.run('UPDATE notifications SET data=? WHERE id=?',JSON.stringify(read),read.id);
  assert.equal((await view({view:'Notifications'})).unreadCount,notices1.unreadCount-1);assert.ok((await view({view:'Notifications'},supervisor)).unreadCount>=55);
  pass('Notification pagination and total unread counts stay correct and independent for each employee');
  const EXP=Number(process.env.QA_EXPIRY_MS||300),now=Date.now(),expires=fixture('DEADLINE-1',{protection:{startedAt:new Date(now-30*86400000+EXP).toISOString(),activityAt:new Date(now-30*86400000+EXP).toISOString(),expiresAt:new Date(now+EXP).toISOString(),agentName:'Agent',agentEmail:'expiry@example.test',agentPhone:'09171234567',activityKind:'proposal'}});await insert.run(expires.id,1,JSON.stringify(expires));
  const active=await view({view:'Inquiries',search:expires.id});assert.equal(active.pagination.total,1);
  await new Promise(resolve=>setTimeout(resolve,EXP+50));
  const expired=await view({view:'Inquiries',search:expires.id,cursor:active.cursor,metadataVersion:active.metadataVersion});assert.ok(!expired.unchanged);assert.equal(expired.pagination.total,0);assert.equal((await view({view:'Archives',search:expires.id})).pagination.total,1);
  pass('30-day expiry updates views without a database write or manual reload');
  const activation=await view({}, {...employee,mustChangePassword:true});assert.equal(activation.inquiries.length,0);assert.equal(activation.templates.length,0);assert.equal(activation.users.length,1);
  pass('Temporary-password accounts receive no archive, colleague or template data');
  for(const original of beforeHashes)assert.equal((await db.get('SELECT data FROM inquiries WHERE id=?',original.id)).data,original.data);
  pass('Indexing and browsing preserve original inquiry history byte for byte');
  const report={count,checks,coldMs,warmMs,fullMs,listBytes:Buffer.byteLength(JSON.stringify(next)),idleBytes:Buffer.byteLength(JSON.stringify(idle)),initialBytes:Buffer.byteLength(JSON.stringify(first)),fullRecordBytes:(await db.get("SELECT SUM(length(CAST(data AS TEXT))) AS bytes FROM inquiries WHERE id LIKE 'PERF-%'")).bytes};
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{db.close();}


