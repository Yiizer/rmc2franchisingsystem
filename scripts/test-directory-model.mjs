import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const load=async p=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(await readFile(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {projectHistorical,parseSourceDate,classifyStatus,manilaToday}=await load('lib/operations/directory-model.ts');
const root=process.env.TEST_RESULT_ROOT||'test-results/directory-register',db=new DatabaseSync(root+'/qa-data/rmc2.sqlite',{readOnly:true}),before=new DatabaseSync(root+'/baseline/rmc2.sqlite',{readOnly:true}),checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const rows=db.prepare('SELECT * FROM historical_accounts').all();
const get=(sheet,n)=>rows.find(r=>r.sheet===sheet&&r.source_row===n);
check('Stable 3,577 source identities; inquiries and review history unchanged',()=>{
 assert.equal(rows.length,3577);assert.deepEqual(db.prepare('SELECT id FROM historical_accounts ORDER BY id').all(),before.prepare('SELECT id FROM historical_accounts ORDER BY id').all());
 for(const table of ['inquiries','historical_reviews'])assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY id').all(),before.prepare('SELECT * FROM '+table+' ORDER BY id').all());
});
check('All 18 sheets retained; every named-row source value and fill preserved',()=>{
 const report=JSON.parse(db.prepare('SELECT report FROM historical_imports').get().report);assert.equal(report.sheets.length,18);
 for(const row of rows){const old=JSON.parse(before.prepare('SELECT data FROM historical_accounts WHERE id=?').get(row.id).data),now=JSON.parse(row.data);for(const cell of old.cells){const updated=now.cells.find(c=>c.column===cell.column);assert.ok(updated,row.id+':'+cell.column);assert.equal(updated.value,cell.value);assert.equal(updated.fill,cell.fill);}}
});
check('Explicit closed, expired, on-hold and waiting remarks outrank red source fills',()=>{
 for(const [n,status] of [[2,'closed'],[3,'expired'],[6,'hold'],[17,'waiting']])assert.equal(projectHistorical(get('AMAPHIL',n)).statusKey,status);
});
check('Legend under contract-price heading is preserved but excluded from financial fields',()=>{
 const row=get('GENERATED MOAs',2),data=JSON.parse(row.data);assert.equal(data.cells.find(c=>c.column==='I').role,'legend');assert.ok(!projectHistorical(row).fields.some(f=>f.key==='contract'));
});
check('Current Manila calendar age and saved Excel age remain distinct',()=>{
 const item=projectHistorical(get('AMAPHIL',2),'2026-10-21');assert.equal(item.age,358);assert.equal(item.savedAge,'356');assert.equal(item.recordedDate,'10/28/2025');assert.equal(manilaToday(new Date('2026-10-20T16:01:00Z')),'2026-10-21');
 const future=projectHistorical(get('AMAPHIL',2),'2025-10-20');assert.equal(future.age,null);assert.equal(future.dateIssue,'Future date');
 assert.equal(parseSourceDate('02/04/2026'),'');assert.equal(parseSourceDate('2026-02-31'),'');assert.equal(parseSourceDate('October 28,2025'),'2025-10-28');
});
check('Coverage expiry and date closed are not substituted for account age',()=>{
 for(const name of ['LIST OF COMPLETED ACCOUNTS (AMA','SOAMOAAMAPHIL (PRIVATE)']){const row=rows.find(r=>r.sheet===name);const item=projectHistorical(row);assert.equal(item.age,null);assert.ok(item.fields.some(f=>f.key==='expiry'||f.key==='dateClosed'));}
});
check('Verified sheet legends only; unknown and contradictory evidence stays reviewable',()=>{
 const data={source:'',plan:'',statusText:'',remarks:'',dates:[],cells:[{column:'G',label:'Status:',value:'',color:'#FFFF00',fill:'FFFFFF00',fillType:'rgb'}]};
 assert.equal(classifyStatus(data,'GENERATED MOAs').key,'pending');assert.equal(classifyStatus(data,'AMAPHIL').key,'review');
 data.cells[0].color='#FF0000';assert.equal(classifyStatus(data,'GENERATED MOAs').key,'review');assert.equal(classifyStatus(data,'IWC').key,'disapproved');
 data.statusText='Expired';data.remarks='CLOSED DEAL';assert.equal(classifyStatus(data,'AMAPHIL').key,'review');
});
check('Financial amounts format as pesos and meaningful extra columns survive',()=>{
 const item=projectHistorical(get('AMAPHIL',16));assert.ok(item.fields.find(f=>f.key==='payment').display.includes('840,535.00'));
 const extra=rows.map(r=>projectHistorical(r)).flatMap(r=>r.fields).filter(f=>f.key.startsWith('source_'));assert.ok(extra.length>0);
});
await writeFile(root+'/model-checks.json',JSON.stringify({checks},null,2));db.close();before.close();
