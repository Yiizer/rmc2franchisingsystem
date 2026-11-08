// Phase 2 checks (SQLite, throwaway data dir, no browser): roles and permissions, Head-only account management, Division Head / SOA data scoping,
// inquiry owners, progress-report approval with the protection hold, and the 7/2-day reminders.
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';

const out=path.resolve('test-results/roles-scoping/'+Date.now());
await mkdir(out,{recursive:true});
process.env.RMC2_DATA_DIR=path.join(out,'qa-data');
assert.ok(process.env.RMC2_DATA_DIR.startsWith(path.resolve('test-results')+path.sep));
for(const name of await readdir('lib/operations'))if(name.endsWith('.ts')){
  const code=ts.transpileModule(await readFile('lib/operations/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g,'$1.mjs$2');
  await writeFile(path.join(out,name.replace(/\.ts$/,'.mjs')),code);
}
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')));
const [database,perm,rules,accounts,clientService,ownerView,owners,service,guard,activity,monitoring,templateAdmin,inbound,filesModule,forms,types]=await Promise.all(['database','permissions','client-rules','accounts','client-service','owner-view','owners','service','scope-guard','activity','monitoring','template-admin','inbound','file-store','forms','types'].map(load));
const db=database.db,users=await database.allUsers(),checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const status=async promise=>{try{await promise;return 200;}catch(e){return e.name==='ZodError'?400:e.status??('ERR '+(e.name||'')+' '+e.message);}};
const user=id=>{const u=users.find(person=>person.id===id);assert.ok(u,id);return u;};
const head=user('emerson'),zeo=user('zeo'),cryssa=user('cryssa'),admin=user('admin'),dhA=user('division-head'),soa=user('soa');
const PASSWORD=database.LOCAL_PASSWORD,DAY=86400000;

// ---------- 1. Permission matrix ----------
{
  const roles=['Head','Supervisor','Employee','DivisionHead','SOA','Admin'];
  const row=(fn,expected)=>roles.forEach((role,i)=>{const subject={role,canApprove:role==='Head'||role==='Supervisor'};assert.equal(fn(subject),expected[i],fn.name+' '+role);});
  //                                     Head   Sup    Emp    DH     SOA    Admin
  row(perm.canManageAccounts,           [true, false, false, false, false, false]);
  row(perm.canResetPassword,            [true, false, false, false, false, true ]);
  row(perm.canApproveProposal,          [true, true,  false, false, false, false]);
  row(perm.canDecideProgressReport,     [true, true,  false, false, false, false]);
  row(perm.canPrepareProposal,          [true, true,  true,  false, false, false]);
  row(perm.canFileProgressReport,       [false,false, false, true,  true,  false]);
  row(perm.canManageTemplates,          [true, false, false, false, false, false]);
  row(perm.canSeeSystemHealth,          [false,false, false, false, false, true ]);
  row(perm.canSeeAiUsage,               [true, true,  false, false, false, true ]);
  row(perm.canSeeIntegrations,          [false,false, false, false, false, true ]);
  row(perm.canTakeOver,                 [true, true,  false, false, false, false]);
  row(perm.canSeeAllInquiries,          [true, true,  true,  false, false, true ]);
  row(perm.isOwnerScoped,               [false,false, false, true,  true,  false]);
  row(perm.canImportInquiry,            [false,false, true,  false, false, true ]);
  row(perm.canReviewInbound,            [true, true,  true,  false, false, true ]);
  assert.equal(perm.canApproveProposal({role:'Supervisor',canApprove:false}),false);
  assert.equal(types.canTakeOver(head),true,'types.ts re-export');
  assert.equal(types.canEditInquiry(head,{status:'Supervisor editing'}),true);
  assert.equal(types.canEditInquiry(user('cryssa'),{status:'Supervisor editing'}),false);
  pass('Permission matrix for every role and capability');
  assert.equal(head.role,'Head');assert.equal(head.canApprove,true);
  assert.equal(dhA.division,'Division 4');assert.equal(soa.role,'SOA');
  pass('Seed: Emerson is Head; Division Head and SOA sample accounts exist in Division 4');
}

// ---------- 2. Accounts ----------
let dhB;
{
  const make=(who,extra={})=>accounts.createAccount(who,{name:'Division Head B',username:'dhb',email:'dhb@rmc2.local',role:'DivisionHead',position:'Division Head',canApprove:true,division:'Division 2',currentPassword:PASSWORD,...extra});
  assert.equal(await status(make(zeo)),403);assert.equal(await status(make(admin)),403);assert.equal(await status(make(cryssa)),403);assert.equal(await status(make(dhA)),403);
  assert.equal(await status(make(head,{division:undefined})),400,'a Division Head needs a division');
  assert.equal(await status(make(head,{division:'Division 9'})),400);
  const created=await make(head);
  dhB=created.user;assert.equal(dhB.role,'DivisionHead');assert.equal(dhB.division,'Division 2');assert.equal(dhB.canApprove,false,'Division Heads cannot be approvers');assert.equal(dhB.mustChangePassword,true);
  assert.equal(created.temporaryPassword.length>=20,true);
  pass('Head can create a Division Head (division required, never an approver); Supervisor, Admin, Employee and Division Head get 403');
  const sup2=await accounts.createAccount(head,{name:'Second Supervisor',username:'sup2',email:'sup2@rmc2.local',role:'Supervisor',position:'Supervisor',canApprove:true,currentPassword:PASSWORD});
  assert.equal(sup2.user.canApprove,true);
  const upd=input=>accounts.updateAccount(head,{currentPassword:PASSWORD,...input});
  assert.equal(await status(accounts.updateAccount(head,{id:'cryssa',active:true,role:'Supervisor',canApprove:true})),400,'a role change without the Head password is refused');
  assert.equal(await status(accounts.updateAccount(head,{id:'cryssa',active:true,role:'Supervisor',canApprove:true,currentPassword:'wrong-password-1'})),403,'a wrong password is refused');
  assert.equal(await status(accounts.updateAccount(head,{id:'cryssa',active:true,role:'Employee',canApprove:false,phone:'0917000111'})),200,'a phone-only edit needs no password');
  assert.equal(await status(accounts.updateAccount(zeo,{id:'cryssa',active:true,role:'Employee',canApprove:false})),403);
  assert.equal(await status(accounts.updateAccount(admin,{id:'cryssa',active:true,role:'Employee',canApprove:false})),403);
  assert.equal(await status(upd({id:head.id,active:true,role:'Supervisor',canApprove:true})),400,'the Head cannot demote themselves');
  assert.equal(await status(upd({id:head.id,active:false,role:'Head',canApprove:true})),400,'the Head cannot deactivate themselves');
  assert.equal(await status(upd({id:'cryssa',active:true,role:'SOA',canApprove:false})),400,'SOA needs a division');
  assert.equal(await status(upd({id:'cryssa',active:true,role:'Employee',canApprove:true,phone:'09171112222',division:'Division 3'})),200);
  const cr=(await database.allUsers()).find(u=>u.id==='cryssa');assert.equal(cr.canApprove,false);assert.equal(cr.division,undefined,'division only belongs to Division Head / SOA');assert.equal(cr.phone,'09171112222');
  assert.equal(await status(upd({id:'cryssa',active:true,role:'Employee',canApprove:false})),200);
  // at least one active approver must remain: deactivate every approver but one, then the last
  assert.equal(await status(upd({id:'zeo',active:false,role:'Supervisor',canApprove:true})),200);
  assert.equal(await status(upd({id:sup2.user.id,active:false,role:'Supervisor',canApprove:true})),200);
  const noHead=await status(accounts.updateAccount(head,{id:head.id,active:true,role:'Head',canApprove:true}));assert.equal(noHead,200);
  assert.equal(await status(upd({id:'zeo',active:true,role:'Supervisor',canApprove:true})),200);
  pass('Account updates are Head-only, keep self-protection and keep at least one active approver');
  // password reset / unlock
  assert.equal(await status(accounts.resetPassword(zeo,{userId:'cryssa',currentPassword:PASSWORD})),403);
  assert.equal(await status(accounts.resetPassword(admin,{userId:head.id,currentPassword:PASSWORD})),403,'an Admin cannot take over the Head account');
  assert.equal(await status(accounts.resetPassword(admin,{userId:'cryssa',currentPassword:'wrong-password-123'})),403);
  const token='sess-'+randomUUID();await db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)',token,'cryssa',new Date(Date.now()+3600000).toISOString());
  const reset=await accounts.resetPassword(admin,{userId:'cryssa',currentPassword:PASSWORD});
  assert.equal(reset.user.mustChangePassword,true);
  assert.equal(await db.get('SELECT token FROM sessions WHERE user_id=?','cryssa'),undefined,'sessions are cleared');
  const signedIn=await accounts.authenticate({email:'cryssa@rmc2.local',password:reset.temporaryPassword});assert.equal(signedIn.id,'cryssa');
  assert.equal(await status(accounts.authenticate({email:'cryssa@rmc2.local',password:PASSWORD})),401,'the old password stops working');
  await db.run('DELETE FROM auth_attempts WHERE key=?','login-user:cryssa');
  await db.run('INSERT INTO auth_attempts(key,failures,window_start,blocked_until) VALUES (?,?,?,?)','login-user:cryssa',9,Date.now(),Date.now()+900000);
  assert.equal(await status(accounts.authenticate({email:'cryssa@rmc2.local',password:'x'.repeat(14)})),429);
  assert.equal(await status(accounts.unlockAccount(cryssa,{userId:'cryssa'})),403);
  await accounts.unlockAccount(admin,{userId:'cryssa'});
  assert.equal(await status(accounts.authenticate({email:'cryssa@rmc2.local',password:'x'.repeat(14)})),401,'unlocked: wrong password is a normal 401 again');
  // put the demo password back for later steps
  await db.run('UPDATE users SET password=? WHERE id=?',database.passwordHash(PASSWORD),'cryssa');
  pass('Admin can reset a password (one-time password, sessions cleared) and unlock; Admin cannot reset the Head; others get 403');
}
const everyone=await database.allUsers();
const dhBUser=everyone.find(u=>u.id===dhB.id);

// ---------- helpers: forms, intake, direct record edits ----------
let counter=0;
const formFor=async(company,agent='Agent Smith',branch='Antipolo')=>{counter++;return new File([new Uint8Array(await forms.sampleForm({company,sector:'Private',industry:'Services',address:'Antipolo City',branch,requestDate:'2026-11-05',agentName:agent,agentPhone:'0917123'+String(4000+counter),contactName:'Contact '+company,contactEmail:'c@example.com',contactPhone:'0998123'+String(4000+counter),contactPosition:'HR',existingProvider:'None',addressee:'Contact '+company,addresseePosition:'HR',requestedPlan:'Group',payment:'Annual',employees:'20',dependents:'0',employeeAges:'22-50',dependentAges:'',hospitals:'',dental:''}))],'form-'+counter+'.xlsx',{type:'application/octet-stream'});};
const get=async id=>JSON.parse((await db.get('SELECT data FROM inquiries WHERE id=?',id)).data);
const patch=async(id,fn)=>{const r=await get(id);fn(r);r.revision++;await db.run('UPDATE inquiries SET revision=?,data=? WHERE id=?',r.revision,JSON.stringify(r),id);return r;};
const notices=async()=>(await db.all('SELECT data FROM notifications')).map(r=>JSON.parse(r.data));
const protect=(record,daysLeft,extra={})=>({startedAt:new Date(Date.now()-(30-daysLeft)*DAY).toISOString(),activityAt:new Date(Date.now()-(30-daysLeft)*DAY).toISOString(),expiresAt:new Date(Date.now()+daysLeft*DAY).toISOString(),...rules.protectedAgent(record,record.fields),activityKind:'proposal',...extra});
async function sentProposal(id){ // a delivered proposal with a real private PDF
  const key='generated/'+randomUUID()+'.pdf';await filesModule.files().put(key,Buffer.from('%PDF-1.4\nproposal\n%%EOF'),{contentType:'application/pdf'});
  const at=new Date().toISOString();
  await patch(id,r=>{r.status='Sent';r.submissions=[{version:1,at,submittedBy:'cryssa',fields:r.fields,email:r.email,emailOverrides:[],generated:{id:'g1',templateId:'t',sourceHash:'h',pdf:key,docx:'x',filename:'Proposal-'+id,generatedAt:at,preparedBy:'cryssa',fingerprint:'f',fields:r.fields,pageCount:1},notes:'',warnings:[],decision:{action:'approve',actorId:'zeo',at,note:'',flags:[]},delivery:{id:'d1',at,mode:'local-test',file:''}}];});
  return key;
}

// ---------- 3. Owners: in-app submission, manual import, e-mail, duplicates ----------
const mine=await service.intake(dhA,await formFor('Alpha Trading Corp'),'ignored@example.com');
assert.equal(mine.ownerId,dhA.id);assert.equal(mine.fields.division,'Division 4','division fills from the owner');assert.equal(mine.ownerAgent.email,dhA.email);
assert.equal(mine.fields.agentEmail,dhA.email,'the reply address is the account address, not a typed one');
pass('A Division Head submitting a form owns it; division fills from their account');
assert.equal(await status(service.intake(head,await formFor('Head Import'),'a@example.com')),403);
assert.equal(await status(service.intake(zeo,await formFor('Zeo Import'),'a@example.com')),403);
const manual=await service.intake(cryssa,await formFor('Manual Co'),'agent@example.com',{ownerId:soa.id});
assert.equal(manual.ownerId,soa.id);
assert.equal(await status(service.intake(cryssa,await formFor('Bad Owner Co'),'agent@example.com',{ownerId:cryssa.id})),422,'an Employee cannot be an owner');
const plain=await service.intake(cryssa,await formFor('Plain Co'),'agent@example.com');assert.equal(plain.ownerId,undefined);assert.equal(plain.fields.division,'Division 4','the form branch (Antipolo) fills the division');
const spelled=await service.intake(cryssa,await formFor('Spelling Co','Agent Smith','Baliuag'),'agent@example.com');assert.equal(spelled.fields.division,'Division 2');assert.equal(spelled.fields.branch,'Baliwag Bulacan','a known spelling becomes the proper branch name');assert.equal(spelled.source.fields.branch,'Baliuag','the original form text is kept');
const unlisted=await service.intake(cryssa,await formFor('Unlisted Co','Agent Smith','Tacloban'),'agent@example.com');assert.equal(unlisted.fields.division,'Unconfirmed','an unlisted branch stays for staff');assert.equal(unlisted.fields.branch,'Tacloban');
console.log('PASS Intake fills the division from the form branch (Antipolo → Division 4, Baliuag → Baliwag Bulacan); unlisted branches stay Unconfirmed');
pass('Manual import accepts an optional ownerId (active Division Head / SOA only); Head and Supervisor stay blocked from importing');
// e-mail intake: sender address matches (case-insensitive, trimmed) an active owner account
{
  const sendMail=async(from,file,auth={spf:'pass',dkim:'pass',dmarc:'pass'})=>{
    const id=randomUUID(),key='inbound/'+id+'/0-form.xlsx';await filesModule.files().put(key,Buffer.from(await file.arrayBuffer()),{contentType:'application/octet-stream'});
    const record={id,messageId:'m-'+id,receivedAt:new Date().toISOString(),from,fromName:'',replyTo:'',subject:'form',snippet:'',attachments:[{name:'form.xlsx',type:'xlsx',size:file.size,key}],auth,state:'new'};
    await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?)',id,record.messageId,record.receivedAt,'new',JSON.stringify(record));
    return inbound.importInbound(cryssa,id,0,true);
  };
  const viaMail=await sendMail('DivisionHead@RMC2.local',await formFor('Mail Corp'));
  assert.equal(viaMail.ownerId,dhA.id);assert.equal(viaMail.fields.division,'Division 4');
  assert.equal((await owners.ownerForEmail('  DIVISIONHEAD@rmc2.local ')).id,dhA.id);
  const stranger=await sendMail('stranger@example.com',await formFor('Stranger Corp'));assert.equal(stranger.ownerId,undefined);
  const spoof=await sendMail('divisionhead@rmc2.local',await formFor('Spoof Corp'),{spf:'fail',dkim:'none',dmarc:'fail'});assert.equal(spoof.ownerId,undefined,'a sender that failed authentication is not linked');
  await db.run("UPDATE users SET data=json_set(data,'$.active',json('false')) WHERE id=?",'soa');
  const inactive=await sendMail('soa@rmc2.local',await formFor('Inactive Owner Corp'));assert.equal(inactive.ownerId,undefined,'inactive owner accounts are not matched');
  await db.run("UPDATE users SET data=json_set(data,'$.active',json('true')) WHERE id=?",'soa');
  pass('E-mail intake links the inquiry when the sender is an active Division Head / SOA (case-insensitive); strangers, failed authentication and inactive accounts are not linked');
}
// Protected client of DH A (protection owned by the account), with a delivered proposal
const clientA=mine;
await patch(clientA.id,r=>{r.protection=protect(r,20);});
const proposalKey=await sentProposal(clientA.id);
const protectedA=await get(clientA.id);
assert.equal(protectedA.protection.ownerId,dhA.id);assert.equal(protectedA.protection.agentEmail,dhA.email,'protection belongs to the owner account');
// duplicate by DH B
const dup=await service.intake(dhBUser,await formFor('Alpha Trading Corp'),'x@example.com');
const dupResult=await ownerView.ownerIntakeResult(dup);
assert.equal(dupResult.alreadyProtected,true);assert.equal(dupResult.message,'This client is already protected.');
const leak=JSON.stringify(dupResult);
for(const secret of [clientA.id,dhA.id,dhA.email,dhA.name,'Agent Smith','matches'])assert.equal(leak.includes(secret),false,'duplicate response must not mention '+secret);
assert.equal((await get(dup.id)).clientReview.state,'duplicate','staff still get the duplicate hold');
assert.equal(dupResult.client.status,'Already protected');
pass('A duplicate submission by another Division Head returns only alreadyProtected, with no details of the other owner or client');
{
  const sameOwner=await service.intake(dhA,await formFor('Alpha Trading Corp'),'x@example.com');
  assert.equal((await get(sameOwner.id)).clientReview.matches[0].sameAgent,true,'same owner account counts as the same agent');
  assert.equal((await get(dup.id)).clientReview.matches[0].sameAgent,false,'different owner accounts are different agents');
  pass('Same-agent comparison uses ownerId when both sides have one');
}

// ---------- 4. Scoping ----------
{
  const routes=[['workspace'],['directory'],['directory','client','x'],['inbound'],['inbound','x','attachment','0'],['inquiries',clientA.id],['inquiries',clientA.id,'historical-matches'],['file',clientA.id,'source'],['file',clientA.id,'pdf'],['file',clientA.id,'progress'],['form-preview',clientA.id],['monitoring'],['template-stage','x'],['template-history'],['source','x'],['login-options-x'],['my-clients',clientA.id,'report'],['my-clients',clientA.id,'proposal','x'],[]];
  for(const route of routes)for(const who of [dhA,soa])assert.equal(await status(Promise.resolve().then(()=>guard.assertOwnerScopedRoute(who,'GET',route))),403,'GET /'+route.join('/'));
  const posts=[['chat'],['create-account'],['users'],['monitoring-check'],['template-upload'],['template-publish'],['template-active'],['proposal-preview'],['custom-document'],['reset-password'],['unlock-account'],['inbound','check'],['inbound','x','import'],['directory','x','edit'],['inquiries',clientA.id,'chat'],['inquiries',clientA.id,'decision'],['inquiries',clientA.id,'generate'],['inquiries',clientA.id,'submit'],['inquiries',clientA.id,'owner'],['inquiries',clientA.id,'activity'],['inquiries',clientA.id,'progress-report'],['inquiries',clientA.id,'progress-report','r','decision'],['inquiries',clientA.id,'confirm-sent'],['login-x'],['my-clients'],['my-clients',clientA.id],['my-clients',clientA.id,'progress-report','x']];
  for(const route of posts)for(const who of [dhA,soa])assert.equal(await status(Promise.resolve().then(()=>guard.assertOwnerScopedRoute(who,'POST',route))),403,'POST /'+route.join('/'));
  for(const route of [['bootstrap'],['sample-form'],['pdf-worker'],['my-clients'],['my-clients',clientA.id],['my-clients',clientA.id,'proposal'],['my-clients',clientA.id,'report','r1']])assert.equal(guard.ownerRouteAllowed('GET',route),true,route.join('/'));
  for(const route of [['logout'],['account-settings'],['notifications'],['intake'],['my-clients',clientA.id,'progress-report']])assert.equal(guard.ownerRouteAllowed('POST',route),true,route.join('/'));
  for(const who of [head,zeo,cryssa,admin])guard.assertOwnerScopedRoute(who,'GET',['workspace']); // staff are not restricted by this guard
  pass('Division Head / SOA: every route outside the whitelist (workspace, directory, inbound, inquiries/:id, files, templates, chat, monitoring, users, decisions...) answers 403');

  const ownIds=(await db.all("SELECT id,data FROM inquiries")).map(r=>JSON.parse(r.data)).filter(r=>r.ownerId===dhA.id).map(r=>r.id).sort();
  assert.deepEqual((await ownerView.listOwnerClients(dhA)).map(c=>c.id).sort(),ownIds);
  assert.equal((await ownerView.listOwnerClients(dhA)).some(c=>[dup.id,manual.id].includes(c.id)),false);
  const dto=await ownerView.ownerClient(dhA,clientA.id);
  const allowedKeys=['id','client','status','createdAt','lastActivityAt','division','branch','protection','progressReports','hasSentProposal','sentAt'];
  assert.deepEqual(Object.keys(dto).sort(),allowedKeys.sort(),'DTO has exactly the agreed fields');
  assert.deepEqual(Object.keys(dto.protection).sort(),['daysLeft','expiresAt','held','startedAt']);
  assert.equal(dto.status,'Proposal sent');assert.equal(dto.hasSentProposal,true);assert.equal(dto.protection.daysLeft,20);assert.equal(dto.protection.held,false);
  const text=JSON.stringify(dto);
  for(const secret of ['history','chat','notes','storage','agentEmail','clientReview','matches','Sampaguita'])assert.equal(text.includes(secret),false,'DTO must not contain '+secret);
  // everything of A is invisible to B, in exactly the same way as a missing id
  const missing=await ownerView.ownerClient(dhBUser,'INQ-0000-00000').catch(e=>e);
  for(const probe of [()=>ownerView.ownerClient(dhBUser,clientA.id),()=>ownerView.ownerProposalFile(dhBUser,clientA.id),()=>ownerView.ownerReportFile(dhBUser,clientA.id,'r1'),()=>ownerView.ownerClient(soa,clientA.id)]){
    const error=await probe().catch(e=>e);assert.equal(error.status,404);assert.equal(error.message,missing.message,'not-owned and missing are indistinguishable');
  }
  assert.equal(await status(ownerView.ownerClient(cryssa,clientA.id)),404,'my-clients is for owners only');
  pass('Division Head B cannot read A through my-clients/:id, proposal or report file (404 identical to a missing id); the DTO holds only the agreed fields');
  const file=await ownerView.ownerProposalFile(dhA,clientA.id);assert.equal(file.storage,proposalKey);
  assert.equal(await status(ownerView.ownerProposalFile(dhA,(await service.intake(dhA,await formFor('No Proposal Corp'),'x@example.com')).id)),404,'a record without a sent proposal has no proposal file');
  await patch(clientA.id,r=>{r.submissions[0].delivery.dryRun=true;});
  assert.equal(await status(ownerView.ownerProposalFile(dhA,clientA.id)),404,'a dry-run delivery is not a sent proposal');
  await patch(clientA.id,r=>{delete r.submissions[0].delivery.dryRun;});
  pass('The owner can open the sent proposal PDF only');

  // notifications never reach owner-scoped users unless they concern their own client
  const before=(await notices()).length;
  const staffMade=await service.intake(cryssa,await formFor('Broadcast Corp'),'agent@example.com');
  const fresh=(await notices()).slice(before);
  assert.ok(fresh.length>0&&fresh.every(n=>![dhA.id,dhBUser.id,soa.id].some(id=>n.recipientIds.includes(id))),'broadcast notices skip Division Heads / SOAs');
  const boot=await ownerView.ownerBootstrap(dhA);
  assert.deepEqual(Object.keys(boot).sort(),['clients','notifications','scoped','unreadCount','user']);
  assert.equal(JSON.stringify(boot).includes('Broadcast Corp'),false);
  assert.equal(JSON.stringify(boot.user).includes('password'),false);
  assert.ok(boot.notifications.every(n=>ownIds.includes(n.inquiryId)));
  assert.deepEqual(Object.keys(boot.notifications[0]||{id:1,inquiryId:1,title:1,message:1,at:1,read:1}).sort(),['at','id','inquiryId','message','read','title']);
  assert.equal((await service.intake(dhA,await formFor('Notice Probe Corp'),'x@example.com')).ownerId,dhA.id);
  pass('Bootstrap for a Division Head carries only their user, own clients and own notifications (no recipient lists, no other clients)');
  void staffMade;
}

// ---------- 5. Progress reports with approval ----------
const reportInput={summary:'Met the HR manager; proposal is under their review.',reference:'Call log 11/05'};
const target=clientA.id;
{
  assert.equal(await status(clientService.addProgressReport(target,cryssa,reportInput)),403,'Employee filing is refused');
  assert.equal(await status(clientService.addProgressReport(target,head,reportInput)),403);
  assert.equal(await status(clientService.addProgressReport(target,zeo,reportInput)),403);
  assert.equal(await status(clientService.addProgressReport(target,dhBUser,reportInput)),404,'another owner cannot file');
  assert.equal(await status(clientService.addProgressReport(target,dhA,{...reportInput,summary:'short'})),400);
  const before=await get(target),expiry=before.protection.expiresAt,mark=(await notices()).length;
  const filed=await clientService.addProgressReport(target,dhA,reportInput);
  const report=filed.progressReports.at(-1);
  assert.equal(report.status,'pending');assert.equal(report.submittedBy,dhA.id);assert.equal(filed.protection.expiresAt,expiry,'filing alone does not renew');
  const submitNotice=(await notices()).slice(mark).filter(n=>n.title==='Progress report awaiting approval');
  assert.equal(submitNotice.length,1);assert.deepEqual([...submitNotice[0].recipientIds].sort(),['emerson','zeo'].sort(),'only the Head and Supervisors are told');
  pass('Employee/Head/Supervisor filing is refused (403); the owner files a pending report; only Head and Supervisors are notified');
  assert.equal(await status(clientService.addProgressReport(target,dhA,{...reportInput,reference:'Another call'})),409,'one pending report at a time');
  const same=await clientService.addProgressReport(target,dhA,{...reportInput,requestId:report.id});assert.equal(same.progressReports.length,1,'a retry with the same requestId is idempotent');
  pass('A second pending report is refused (409)');
  assert.equal(await status(clientService.decideProgressReport(target,report.id,cryssa,{action:'approve'})),403);
  assert.equal(await status(clientService.decideProgressReport(target,report.id,dhA,{action:'approve'})),403);
  assert.equal(await status(clientService.decideProgressReport(target,report.id,admin,{action:'approve'})),403);
  assert.equal(await status(clientService.decideProgressReport(target,'nope',zeo,{action:'approve'})),404);
  assert.equal(await status(clientService.decideProgressReport(target,report.id,zeo,{action:'reject'})),400,'rejecting needs a reason');
  assert.equal(await status(clientService.decideProgressReport(target,report.id,zeo,{action:'reject',reason:'no'})),400);
  const mark2=(await notices()).length;
  const approved=await clientService.decideProgressReport(target,report.id,zeo,{action:'approve'});
  const decided=approved.progressReports.at(-1);
  assert.equal(decided.status,'approved');assert.equal(decided.decidedBy,'zeo');
  assert.equal(Date.parse(approved.protection.expiresAt),Date.parse(decided.decidedAt)+30*DAY,'30 days from the approval');
  assert.equal(approved.protection.activityAt,decided.decidedAt);assert.equal(approved.protection.activityKind,'progress-report');
  assert.equal(await status(clientService.decideProgressReport(target,report.id,head,{action:'approve'})),409,'first decision wins');
  assert.equal(await status(clientService.decideProgressReport(target,report.id,head,{action:'reject',reason:'too late for this'})),409);
  const decisionNotice=(await notices()).slice(mark2).filter(n=>n.title==='Progress report approved');
  assert.equal(decisionNotice.length,1);assert.deepEqual(decisionNotice[0].recipientIds,[dhA.id],'only the owner is told of the decision');
  pass('A Supervisor approves: protection runs 30 days from the decision; the first decision wins (409); only the owner is notified');
  // rejection with a reason
  const second=await clientService.addProgressReport(target,dhA,{...reportInput,reference:'Second call'});
  const secondId=second.progressReports.at(-1).id;
  const expiryBefore=(await get(target)).protection.expiresAt;
  const rejected=await clientService.decideProgressReport(target,secondId,head,{action:'reject',reason:'Please attach the call log.'});
  assert.equal(rejected.progressReports.at(-1).status,'rejected');assert.equal(rejected.protection.expiresAt,expiryBefore,'a rejection does not renew');
  const dto=await ownerView.ownerClient(dhA,target);
  assert.equal(dto.progressReports[0].status,'rejected');assert.equal(dto.progressReports[0].rejectReason,'Please attach the call log.');
  pass('A rejection records and shows its reason to the owner without renewing protection');
  // legacy reports without a status read as approved
  await patch(target,r=>{r.progressReports.unshift({id:'legacy',sentAt:r.createdAt,recordedAt:r.createdAt,recordedBy:'cryssa',sender:'a@b.co',summary:'legacy report text',reference:'old'});});
  const legacy=(await ownerView.ownerClient(dhA,target)).progressReports.find(r=>r.id==='legacy');assert.equal(legacy.status,'approved');
  pass('Legacy reports without a status are treated as approved');
}

// ---------- 6. The hold ----------
{
  const rec=await service.intake(dhA,await formFor('Held Corp'),'x@example.com');
  await patch(rec.id,r=>{r.status='Sent';r.protection=protect(r,-2);r.progressReports=[{id:'p1',sentAt:r.createdAt,recordedAt:new Date(Date.now()-3*DAY).toISOString(),recordedBy:dhA.id,submittedBy:dhA.id,sender:dhA.email,summary:'pending report text',reference:'ref',status:'pending'}];});
  let r=await get(rec.id);
  assert.equal(rules.isClientArchived(r),false,'past expiry with a pending report is not archived');
  let state=rules.clientStates([r])[rec.id];assert.notEqual(state.state,'archived');assert.equal(state.held,true);
  const dto=await ownerView.ownerClient(dhA,rec.id);assert.equal(dto.protection.held,true);assert.notEqual(dto.status,'Protection expired');
  // a new request for the same client is still blocked while held
  const rival=await service.intake(dhBUser,await formFor('Held Corp'),'x@example.com');
  assert.equal((await get(rival.id)).clientReview.state,'duplicate','a held client still protects against other agents');
  const ended=await clientService.decideProgressReport(rec.id,'p1',zeo,{action:'reject',reason:'Not enough evidence'});
  assert.equal(rules.isClientArchived(ended),true,'after rejection past the old date, protection has ended');
  assert.equal(rules.clientStates([ended])[rec.id].state,'archived');
  assert.equal((await ownerView.ownerClient(dhA,rec.id)).status,'Protection expired');
  // approval after the old expiry renews from the decision
  const rec2=await service.intake(dhA,await formFor('Held Two Corp'),'x@example.com');
  await patch(rec2.id,r=>{r.status='Sent';r.protection=protect(r,-1);r.progressReports=[{id:'p2',sentAt:r.createdAt,recordedAt:new Date().toISOString(),recordedBy:dhA.id,submittedBy:dhA.id,sender:dhA.email,summary:'pending report text',reference:'ref',status:'pending'}];});
  const renewed=await clientService.decideProgressReport(rec2.id,'p2',head,{action:'approve'});
  assert.equal(rules.isClientArchived(renewed),false);assert.ok(Date.parse(renewed.protection.expiresAt)>Date.now()+29*DAY);
  pass('Hold: a client past its date with a pending report is not archived and still blocks rivals; after a rejection it is archived; an approval renews from the decision');
  assert.equal(rules.protectionExpired({progressReports:[]},{expiresAt:new Date(Date.now()-1000).toISOString()}),true);
}

// ---------- 7. Reminders ----------
{
  const rec=await service.intake(dhA,await formFor('Reminder Corp'),'x@example.com');
  const mine=async()=>(await notices()).filter(n=>n.inquiryId===rec.id&&n.title==='Protection ending soon');
  await patch(rec.id,r=>{r.status='Sent';r.protection=protect(r,10);});
  await ownerView.listOwnerClients(dhA);assert.equal((await mine()).length,0,'more than 7 days left: nothing yet');
  await patch(rec.id,r=>{r.protection=protect(r,6.5);});
  await ownerView.listOwnerClients(dhA);await ownerView.ownerBootstrap(dhA);await ownerView.listOwnerClients(dhA);
  assert.equal((await mine()).length,1,'one reminder at 7 days, however often the app loads');
  assert.deepEqual((await mine())[0].recipientIds,[dhA.id]);
  const exp7=(await get(rec.id)).protection.expiresAt;
  await patch(rec.id,r=>{r.protection=protect(r,1.5);});
  await ownerView.listOwnerClients(dhA);await ownerView.listOwnerClients(dhA);
  assert.equal((await mine()).length,2,'one more at 2 days');
  await ownerView.ownerBootstrap(dhA);assert.equal((await mine()).length,2,'never repeated');
  assert.notEqual(exp7,(await get(rec.id)).protection.expiresAt);
  // first seen already inside 2 days: only the 2-day reminder
  const late=await service.intake(dhA,await formFor('Late Reminder Corp'),'x@example.com');
  await patch(late.id,r=>{r.status='Sent';r.protection=protect(r,1);});
  await ownerView.listOwnerClients(dhA);
  assert.equal((await notices()).filter(n=>n.inquiryId===late.id&&n.title==='Protection ending soon').length,1);
  // pending report or expired client: no reminder
  const held=await service.intake(dhA,await formFor('No Reminder Corp'),'x@example.com');
  await patch(held.id,r=>{r.status='Sent';r.protection=protect(r,1);r.progressReports=[{id:'q',sentAt:r.createdAt,recordedAt:r.createdAt,recordedBy:dhA.id,sender:'a@b.co',summary:'pending report text',reference:'ref',status:'pending'}];});
  await ownerView.listOwnerClients(dhA);
  assert.equal((await notices()).filter(n=>n.inquiryId===held.id&&n.title==='Protection ending soon').length,0);
  pass('Reminders: at most one per client per threshold (7 and 2 days), idempotent across loads, none while a report is pending');
}

// ---------- 8. Owner changes, lastActivityAt, other role checks ----------
{
  const rec=await service.intake(cryssa,await formFor('Link Corp'),'agent@example.com');
  assert.equal(await status(owners.setInquiryOwner(rec.id,admin,{revision:rec.revision,ownerId:dhA.id})),403);
  assert.equal(await status(owners.setInquiryOwner(rec.id,dhA,{revision:rec.revision,ownerId:dhA.id})),403);
  assert.equal(await status(owners.setInquiryOwner(rec.id,cryssa,{revision:rec.revision+5,ownerId:dhA.id})),409);
  assert.equal(await status(owners.setInquiryOwner(rec.id,cryssa,{revision:rec.revision,ownerId:'cryssa'})),422);
  const linked=await owners.setInquiryOwner(rec.id,cryssa,{revision:rec.revision,ownerId:dhA.id});
  assert.equal(linked.ownerId,dhA.id);assert.equal(linked.fields.division,'Division 4');assert.ok(linked.history.at(-1).action.includes('Linked'));
  assert.equal((await ownerView.listOwnerClients(dhA)).some(c=>c.id===rec.id),true);
  await patch(rec.id,r=>{r.protection=protect(r,15);});
  const moved=await owners.setInquiryOwner(rec.id,zeo,{revision:(await get(rec.id)).revision,ownerId:soa.id});
  assert.equal(moved.protection.ownerId,soa.id);assert.equal(moved.protection.agentEmail,soa.email,'protection moves to the new owner');
  const cleared=await owners.setInquiryOwner(rec.id,head,{revision:moved.revision,ownerId:null});
  assert.equal(cleared.ownerId,undefined);assert.equal(cleared.protection.ownerId,undefined);assert.equal(cleared.protection.agentEmail,cleared.source.fields.agentEmail);
  assert.equal((await ownerView.listOwnerClients(dhA)).some(c=>c.id===rec.id),false);
  pass('Head/Supervisor/Employee can set, move and clear the owner (audited, revision-checked); Admin and owners cannot');
  const act=rules.lastActivityAt(await get(clientA.id));
  assert.ok(Date.parse(act)>=Date.parse((await get(clientA.id)).progressReports.at(-1).decidedAt||0));
  assert.ok(ownerView.ownerClientDto(await get(clientA.id),{state:'clear',matches:[],protection:null}).lastActivityAt===act);
  const ordered=await ownerView.listOwnerClients(dhA);
  assert.deepEqual(ordered.map(c=>c.lastActivityAt),[...ordered.map(c=>c.lastActivityAt)].sort().reverse(),'my-clients is sorted by latest activity');
  pass('lastActivityAt is the newest of the record events and my-clients sorts by it');

  // other scattered checks
  assert.equal(await status(monitoring.monitoring(cryssa)),403);
  const limited=await monitoring.monitoring(head);assert.deepEqual(Object.keys(limited).sort(),['ai','checkedAt']);
  assert.deepEqual(Object.keys(await monitoring.monitoring(zeo)).sort(),['ai','checkedAt']);
  const full=await monitoring.monitoring(admin);assert.ok(full.services.length>=3);
  assert.equal(await status(templateAdmin.stageTemplate(zeo,new FormData())),403);
  assert.equal(await status(templateAdmin.stageTemplate(admin,new FormData())),403);
  assert.notEqual(await status(templateAdmin.stageTemplate(head,new FormData())),403,'the Head passes the role check');
  assert.equal(await status(inbound.listInbound(dhA)),403);assert.equal(await status(inbound.listInbound(admin)),200);assert.equal(await status(inbound.listInbound(head)),200);
  pass('Monitoring (Head/Supervisor: AI usage only; Admin: full), templates (Head only) and Requests access follow the permission module');
  // locking: the Head can start handling and take over
  const lock=await service.intake(cryssa,await formFor('Lock Corp'),'agent@example.com');
  const sessions=new Map();const session=async u=>{if(!sessions.has(u.id)){const t='tok-'+u.id+randomUUID();await db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)',t,u.id,new Date(Date.now()+3600000).toISOString());sessions.set(u.id,t);}return sessions.get(u.id);};
  const act2=async(u,action,extra={})=>activity.updateInquiryActivity(lock.id,u,await session(u),{tab:u.id==='emerson'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',action,...extra});
  assert.equal((await act2(cryssa,'start')).handling,true);
  assert.equal((await act2(head,'take-over')).handling,true,'the Head can take over a lock');
  assert.equal((await activity.activeInquiryActivity()).find(a=>a.inquiryId===lock.id)?.userId,'emerson');
  assert.equal(await status(act2(admin,'take-over')),403);
  assert.equal(await status(act2(dhA,'start')),403);
  pass('The Head holds and takes over locks like a Supervisor; Admin and Division Heads cannot');
}

// Rule (a), PO 2026-11-06: once a supervisor approves a new agent after expiry, an older request that was held during the
// previous protection stays on hold, even when it is rechecked.
{
  const a=await service.intake(cryssa,await formFor('Successor Rule Co','Agent Alpha'),'alpha@example.com');
  await sentProposal(a.id);await patch(a.id,r=>{r.protection={...protect(r,10),expiresAt:new Date(Date.now()+10*DAY).toISOString()};});
  const b=await service.intake(cryssa,await formFor('Successor Rule Co','Agent Bravo'),'bravo@example.com');
  assert.equal(b.clientReview.state,'duplicate','B is held while A is protected');
  await patch(a.id,r=>{r.protection={...r.protection,startedAt:new Date(Date.now()-40*DAY).toISOString(),activityAt:new Date(Date.now()-40*DAY).toISOString(),expiresAt:new Date(Date.now()-DAY).toISOString()};});
  let c=await service.intake(cryssa,await formFor('Successor Rule Co','Agent Charlie'),'charlie@example.com');
  assert.equal(c.clientReview.state,'duplicate','C waits for a supervisor after A expired');
  c=await clientService.reviewClientRegistration(c.id,zeo,{revision:c.revision,action:'reassign-expired',note:'Verified expiry and the new agent.'});
  assert.equal(c.clientReview.state,'clear','Zeo approved C as the new agent');assert.ok(c.clientReview.reassignedAt);
  const fresh=await get(b.id);
  const rechecked=await clientService.reviewClientRegistration(b.id,cryssa,{revision:fresh.revision,action:'recheck',note:''});
  assert.equal(rechecked.clientReview.state,'duplicate','B stays on hold after the recheck');
  assert.ok(rechecked.clientReview.matches.some(m=>m.inquiryId===c.id),'B is now held by the approved new owner C');
  pass('Rule (a): after a supervisor approves a new agent, an older held request stays on hold when rechecked');
}

// Security review fixes (2026-11-05)
{
  // Admin may reset only Employees; approvers and Division Heads / SOAs need the Head.
  assert.equal(await status(accounts.resetPassword(admin,{userId:'zeo',currentPassword:PASSWORD})),403,'an Admin cannot reset an approving Supervisor');
  assert.equal(await status(accounts.resetPassword(admin,{userId:dhA.id,currentPassword:PASSWORD})),403,'an Admin cannot reset a Division Head');
  assert.equal(await status(accounts.unlockAccount(admin,{userId:head.id})),403,'an Admin cannot unlock the Head');
  assert.equal(await status(accounts.unlockAccount(admin,{userId:'jefferson'})),200);
  pass('Security: Admin resets are limited to Employees, and Admin cannot unlock the Head');
  // Owner changes on a linked or protected client need an approver.
  const linked=await service.intake(cryssa,await formFor('Owner Change Co'),'agent@example.com',{ownerId:dhA.id});
  assert.equal(await status(owners.setInquiryOwner(linked.id,cryssa,{revision:linked.revision,ownerId:soa.id})),403,'an Employee cannot move a linked client to another owner');
  assert.equal(await status(owners.setInquiryOwner(linked.id,cryssa,{revision:linked.revision,ownerId:null})),403,'an Employee cannot clear the owner');
  const moved=await owners.setInquiryOwner(linked.id,zeo,{revision:linked.revision,ownerId:soa.id});assert.equal(moved.ownerId,soa.id,'an approving Supervisor can');
  pass('Security: once linked or protected, only the Head or an approving Supervisor can change the owner');
  // The hold lasts at most 7 days past the date; after 2 rejections refiling is refused.
  const holdRecord={progressReports:[{id:'r',status:'pending',sentAt:new Date().toISOString(),recordedAt:new Date().toISOString()}]};
  assert.equal(rules.protectionExpired(holdRecord,{expiresAt:new Date(Date.now()-3*DAY).toISOString()}),false,'held 3 days past the date');
  assert.equal(rules.protectionExpired(holdRecord,{expiresAt:new Date(Date.now()-8*DAY).toISOString()}),true,'not held more than 7 days past the date');
  const capped=await service.intake(dhA,await formFor('Rejection Cap Co'),'x@example.com');
  await sentProposal(capped.id);
  await patch(capped.id,r=>{r.protection=protect(r,20);r.protection.ownerId=dhA.id;});
  for(const n of [1,2]){const f=await clientService.addProgressReport(capped.id,dhA,{...reportInput,reference:'Attempt '+n});await clientService.decideProgressReport(capped.id,f.progressReports.at(-1).id,zeo,{action:'reject',reason:'Not enough detail'});}
  assert.equal(await status(clientService.addProgressReport(capped.id,dhA,{...reportInput,reference:'Attempt 3'})),409,'a third report after two rejections is refused');
  pass('Security: a pending report holds protection for at most 7 days past its date; two rejections stop refiling');
  // No existence oracle: a missing inquiry and someone else's look the same to an owner.
  const missing=await clientService.addProgressReport('INQ-2099-99999',dhA,reportInput).catch(e=>e);
  const foreign=await clientService.addProgressReport(linked.id,dhA,reportInput).catch(e=>e);
  assert.equal(missing.status,404);assert.equal(foreign.status,404);assert.equal(missing.message,foreign.message);
  pass('Security: filing on a missing or foreign client gives the same 404');
}

console.log('\n'+checks.length+' checks passed');
