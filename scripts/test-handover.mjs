// Unit-level checks for lock lifetime, handover requests, take-over and reservations (SQLite, throwaway data dir).
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';

const out=path.resolve('test-results/handover/'+Date.now());
await mkdir(out,{recursive:true});
process.env.RMC2_DATA_DIR=path.join(out,'qa-data');
assert.ok(process.env.RMC2_DATA_DIR.startsWith(path.resolve('test-results')+path.sep));
for(const name of await readdir('lib/operations'))if(name.endsWith('.ts')){
  const code=ts.transpileModule(await readFile('lib/operations/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g,'$1.mjs$2');
  await writeFile(path.join(out,name.replace(/\.ts$/,'.mjs')),code);
}
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')));
const database=await load('database'),activity=await load('activity');
const db=database.db,users=await database.allUsers(),checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const byRole=(role,n=0)=>users.filter(u=>u.active&&u.role===role)[n];
const [c,j]=[byRole('Employee',0),byRole('Employee',1)],sup=byRole('Supervisor',0),admin=byRole('Admin');
assert.ok(c&&j&&sup&&admin&&c.id!==j.id);

const seed=(await database.inquiries())[0];
let counter=0;
async function fixture(){
  const id='HANDOVER-'+(++counter);
  const r={...structuredClone(seed),id,revision:1,status:'New inquiry',submissions:[],history:[],clientReview:undefined,closure:undefined,fields:{...seed.fields,company:'Handover Co '+counter,contactName:'Contact '+counter,addressee:'Contact '+counter},source:{...seed.source,kind:'attachment',filename:'handover-'+counter+'.xlsx',sourceHash:'handover-hash-'+counter,cells:[]}};
  r.source.fields={...r.fields};
  await db.run('INSERT INTO inquiries(id,revision,data) VALUES (?,?,?)',r.id,r.revision,JSON.stringify(r));
  return r;
}
const sessions=new Map();
async function session(user){
  if(!sessions.has(user.id)){const token='tok-'+user.id+'-'+randomUUID();await db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)',token,user.id,new Date(Date.now()+3600000).toISOString());sessions.set(user.id,token);}
  return sessions.get(user.id);
}
const act=async(user,id,action,extra={},tab)=>activity.updateInquiryActivity(id,user,await session(user),{tab:tab||tabs.get(user.id+id)||setTab(user,id),action,...extra});
const tabs=new Map();const setTab=(user,id)=>{const t=randomUUID();tabs.set(user.id+id,t);return t;};
const status=async(promise)=>{try{await promise;return 200;}catch(e){return e.status??e.statusCode??e.code??('ERR '+e.message);}};
const owner=async id=>(await activity.activeInquiryActivity()).find(a=>a.inquiryId===id);
const ageLease=(id,ms)=>db.run('UPDATE inquiry_activity SET seen_at=? WHERE inquiry_id=?',new Date(Date.now()-ms).toISOString(),id);
const notices=async()=>(await db.all('SELECT data FROM notifications')).map(r=>JSON.parse(r.data));

try{
  // 1. Lifetime
  assert.equal(activity.ACTIVITY_TTL_MS,180000);
  let r=await fixture();
  assert.equal((await act(c,r.id,'start')).handling,true);
  await ageLease(r.id,170000);
  assert.equal((await owner(r.id))?.userId,c.id,'a lease seen 170 s ago is still live');
  const beat=await act(c,r.id,'heartbeat');
  assert.equal(beat.handling,true);
  assert.ok(Date.now()-Date.parse((await owner(r.id)).seenAt)<5000,'a heartbeat from a hidden tab refreshes the lease');
  await ageLease(r.id,95000);
  assert.equal((await owner(r.id))?.userId,c.id,'the old 90 s limit no longer frees the lock');
  assert.equal(await status(act(j,r.id,'start')),423);
  pass('Heartbeats keep the lease alive; a lease older than 90 s but under 3 minutes still blocks colleagues');
  await ageLease(r.id,185000);
  assert.equal(await owner(r.id),undefined);
  assert.equal(await status(act(j,r.id,'start')),200);
  assert.equal((await act(c,r.id,'heartbeat')).handling,false,'the expired holder cannot silently take the lock back');
  pass('A lease unseen for over 3 minutes is freed and the next person can start');
  const source=await readFile('app/operations-activity.tsx','utf8');
  assert.ok(!/setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'\)/.test(source),'poll interval must not skip hidden tabs');
  assert.ok(/IDLE_MS=15\*60000/.test(source));
  pass('Client heartbeat interval runs while hidden and the idle limit is 15 minutes');

  // 2. Request handover
  r=await fixture();
  await act(c,r.id,'start');
  assert.equal(await status(act(j,r.id,'request-handover')),200);
  const poll=await act(c,r.id,'poll');
  assert.equal(poll.handover?.requesterId,j.id);
  assert.ok((await notices()).some(n=>n.inquiryId===r.id&&n.title==='Handover requested'&&n.recipientIds.includes(c.id)));
  assert.equal(await status(act(j,r.id,'request-handover')),429);
  try{await act(j,r.id,'request-handover');}catch(e){assert.match(e.message,/ask again in \d+ minute/);}
  assert.equal(await status(act(c,r.id,'request-handover')),409,'the holder cannot ask themselves');
  assert.equal(await status(act(admin,r.id,'request-handover')),403);
  assert.equal(await status(act(sup,r.id,'request-handover')),200,'a different requester is not rate limited by the first');
  pass('Request handover notifies the holder, surfaces on the holder poll, and is rate limited to one per requester per 5 minutes (429)');
  await db.run('UPDATE inquiry_handover SET at=? WHERE user_id=?',new Date(Date.now()-6*60000).toISOString(),j.id);
  assert.equal(await status(act(j,r.id,'request-handover')),200);
  pass('The rate limit lifts after 5 minutes');
  assert.equal(await status(act(j,r.id,'dismiss-handover')),403,'only the holder can answer');
  await act(c,r.id,'dismiss-handover');
  assert.equal((await act(c,r.id,'poll')).handover,null);
  assert.ok((await notices()).some(n=>n.inquiryId===r.id&&n.title==='Still being handled'&&n.recipientIds.includes(j.id)));
  pass('Keep working clears the banner and tells the requesters');

  // 3. Take over
  assert.equal(await status(act(j,r.id,'take-over')),403);
  assert.equal((await owner(r.id)).userId,c.id);
  pass('An employee cannot take over (403) and the lock is unchanged');
  const old=tabs.get(c.id+r.id);
  const mine=await act(sup,r.id,'take-over');
  assert.equal(mine.handling,true);
  assert.equal((await owner(r.id)).userId,sup.id);
  const lost=await act(c,r.id,'heartbeat');
  assert.equal(lost.handling,false);assert.equal(lost.activity[0].userId,sup.id);
  assert.equal(await status(activity.requireInquiryHandler(r.id,c)),423);
  assert.equal(await status(activity.requireInquiryHandler(r.id,sup)),200);
  assert.ok((await notices()).some(n=>n.inquiryId===r.id&&n.title==='Inquiry taken over'&&n.recipientIds.includes(c.id)));
  const after=await database.inquiry(r.id);
  assert.ok(after.history.some(h=>h.actorId===sup.id&&/Took over/.test(h.action)));
  assert.equal(after.revision,r.revision,'a handover does not invalidate open copies');
  assert.ok(old);
  pass('Supervisor takes over for themselves: they hold the lock at once, the old holder flips to view only, is notified, and it is in the history');

  r=await fixture();
  await act(c,r.id,'start');
  assert.equal(await status(act(sup,r.id,'take-over',{targetUserId:admin.id})),422);
  assert.equal(await status(act(sup,r.id,'take-over',{targetUserId:'nobody'})),422);
  const handed=await act(sup,r.id,'take-over',{targetUserId:j.id});
  assert.equal(handed.handling,false);
  const reserved=await owner(r.id);
  assert.equal(reserved.userId,j.id);assert.equal(reserved.reserved,true);assert.equal(reserved.reservedBy,sup.id);
  assert.equal((await act(c,r.id,'heartbeat')).handling,false);
  assert.ok((await notices()).some(n=>n.inquiryId===r.id&&n.title==='Inquiry assigned to you'&&n.recipientIds.includes(j.id)));
  pass('Supervisor assigns to an employee: a reservation owns the inquiry and the target is notified');
  assert.equal(await status(act(c,r.id,'start')),423);
  assert.equal(await status(act(sup,r.id,'start')),423);
  assert.equal(await status(activity.requireInquiryHandler(r.id,c)),423);
  assert.equal(await status(activity.requireInquiryHandler(r.id,j)),423,'the reservation alone does not allow edits');
  pass('A reservation blocks third users from starting (423) and from editing');
  assert.equal(await status(act(j,r.id,'start')),200);
  assert.equal((await owner(r.id)).reserved,undefined);
  assert.equal((await owner(r.id)).userId,j.id);
  assert.equal(await status(activity.requireInquiryHandler(r.id,j)),200);
  assert.equal((await db.all("SELECT id FROM inquiry_handover WHERE inquiry_id=? AND kind='reserve'",r.id)).length,0);
  pass('The target starting converts the reservation into a real lease');

  r=await fixture();
  await act(c,r.id,'start');await act(sup,r.id,'take-over',{targetUserId:j.id});
  await db.run("UPDATE inquiry_handover SET until_at=? WHERE inquiry_id=? AND kind='reserve'",new Date(Date.now()-1000).toISOString(),r.id);
  assert.equal(await owner(r.id),undefined);
  assert.equal(await status(act(c,r.id,'start')),200);
  pass('A reservation lapses after its 15 minutes');
  console.log('\n'+checks.length+' checks passed');
}finally{
  for(const t of ['inquiry_activity','inquiry_handover'])await db.run('DELETE FROM '+t);
}
