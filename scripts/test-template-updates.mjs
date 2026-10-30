import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';

// This scenario only runs against the dedicated, separately started QA database.
const base='http://127.0.0.1:5190/api/operations/',out='test-results/template-updates';
let cookie='';const checks=[];
async function call(route,body,expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  if(route==='login'&&response.ok)cookie=response.headers.get('set-cookie').split(';')[0];
  const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,expected,route+': '+(Buffer.isBuffer(data)?'binary':JSON.stringify(data)));return data;
}
const pass=name=>{checks.push(name);console.log('PASS '+name);};
await call('login',{email:'cryssa@rmc2.local',password:'Rmc2Local!2026'});
const state=await call('bootstrap'),semi=state.templates.find(t=>t.sourceId==='D097');
await readFile(out+'/qa-data/rmc2.sqlite');
assert.equal(state.templates.length,14);assert.ok(semi?.annualOnly);assert.match(semi.text,/per semi-annual OP limit/);assert.ok(semi.warnings.some(w=>w.includes('premiums remain annual')));
pass('Updated catalog retains three CorpoAide masters and labels the new outpatient limit without inferring semiannual premiums');
const book=new ExcelJS.Workbook();await book.xlsx.load(await call('sample-form'));
const sheet=book.worksheets[0],identity='Template update verification '+randomUUID();
for(const cell of ['B10','D14','B21'])sheet.getCell(cell).value=identity;
sheet.getCell('D22').value='BureauHealth 7K & 5K';
const form=new FormData();form.set('sender','template-update@example.test');form.set('file',new File([await book.xlsx.writeBuffer()],'template-update.xlsx'));
let record=(await call('intake',form,201)).inquiry;
await call('inquiries/'+record.id+'/activity',{tab:randomUUID(),action:'start'});
const act=async(action,body={},expected=200)=>(await call('inquiries/'+record.id+'/'+action,{revision:record.revision,...body},expected)).inquiry;
record=await act('customize',{templateId:'d024'});
const stale={...structuredClone(record.customization),sourceHash:'older-reviewed-source-hash'};
const database=new DatabaseSync(out+'/qa-data/rmc2.sqlite');database.exec('PRAGMA busy_timeout=5000');
try{
  const row=database.prepare('SELECT data FROM inquiries WHERE id=?').get(record.id);
  assert.ok(row,'The API must be connected to this isolated QA database');
  assert.equal(JSON.parse(row.data).revision,record.revision);
  record={...record,revision:record.revision+1,customization:stale};
  database.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(record.revision,JSON.stringify(record),record.id);
}finally{database.close();}
const blocked=await call('inquiries/'+record.id+'/generate',{revision:record.revision},409);
assert.match(blocked.error,/earlier template/);
pass('An older customized source cannot be generated against a replacement master');
await call('custom-document',{inquiryId:record.id,templateId:'d024',fields:record.fields,edits:{}},409);
record=await act('customize',{templateId:'d024'});
assert.notEqual(record.customization.id,stale.id);assert.equal(record.customization.sourceHash,state.templates.find(t=>t.id==='d024').sourceHash);assert.deepEqual(record.customizationArchive.at(-1),stale);
pass('Explicitly creating a new customized copy preserves the old draft in its archive');
const refreshed=record;record=await act('customize',{templateId:'d024'});assert.deepEqual(record,refreshed);
pass('Creating an already current customized copy remains idempotent');
// Save standard mode explicitly, retaining the customized archive, then test the new variant.
record=await act('save',{fields:record.fields,templateId:'d097',customization:null,notes:'Fictional updated-template QA.',email:record.email,emailOverrides:[]});
record=await act('generate');assert.equal(record.generated.sourceHash,semi.sourceHash);assert.ok(record.generated.pageCount>1);
const pdf=await call('file/'+record.id+'/pdf');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
record=await act('submit');const frozen=structuredClone(record.submissions[0]);assert.equal(frozen.generated.sourceHash,semi.sourceHash);
pass('The new DepEd outpatient-limit variant generates and submits the exact updated master');
await call('logout',{});await call('login',{email:'emerson@rmc2.local',password:'Rmc2Local!2026'});
record=await act('decision',{version:1,action:'approve',note:'Reviewed the updated source in isolated QA.',flags:[]});
assert.equal(record.status,'Sent');assert.deepEqual(record.submissions[0].generated,frozen.generated);assert.deepEqual(await call('file/'+record.id+'/pdf?version=1'),pdf);
const eml=(await call('file/'+record.id+'/eml?version=1')).toString('utf8');
const attachment=eml.match(/Content-Disposition: attachment;[^\r]+\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/);
assert.ok(attachment);assert.deepEqual(Buffer.from(attachment[1].replace(/\s/g,''),'base64'),pdf);
pass('Supervisor approval and the local reply retain the same updated PDF bytes');
await call('logout',{});
await writeFile(out+'/checks.json',JSON.stringify({checks,inquiryId:record.id},null,2));
