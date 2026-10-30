import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

const base=process.env.RMC2_TEST_URL||'http://127.0.0.1:5190';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):5190$/,'Use the isolated QA server on port 5190.');
const out=path.resolve('test-results/client-protection'),data=path.join(out,'qa-data');
await mkdir(out,{recursive:true});
for(const name of ['types','client-rules']){
  const source=await readFile('lib/operations/'+name+'.ts','utf8');
  await writeFile(path.join(out,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("'./types'","'./types.mjs'"));
}
const {CLIENT_PROTECTION_MS,clientState,isClientArchived,isRegistered,normalizeClient,protectionDaysLeft}=await import(pathToFileURL(path.join(out,'client-rules.mjs')));
const checks=[],sessions={};let database;
const pass=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};

// Pure client-rules scenarios: no server needed (run alone with RMC2_PURE_ONLY=1).
{
  const DAY=86400000,now=Date.parse('2026-10-30T00:00:00Z');
  const iso=offset=>new Date(now+offset*DAY).toISOString();
  let seq=0;
  const rec=(id,agent,changes={})=>{
    const fields={company:'Rule Co',contactName:'Rita Rule',addressee:'Rita Rule',agentName:'Agent '+agent,agentEmail:agent.toLowerCase()+'@example.test',agentPhone:''};
    return {id,createdAt:iso(-10+(seq++)),status:'New inquiry',fields,source:{kind:'upload',filename:id+'.xlsx',storage:id,sourceHash:'h-'+id,fields:{...fields}},submissions:[],detailRequests:[],...changes};
  };
  const decided=(action='approve',delivered=false)=>[{version:1,decision:{action},...(delivered?{delivery:{at:iso(-3)}}:{})}];
  const sent=(id,agent,days=-3)=>rec(id,agent,{status:'Sent',submissions:decided('approve',true),protection:{startedAt:iso(days),activityAt:iso(days),expiresAt:iso(days+30),agentName:'Agent '+agent,agentEmail:agent.toLowerCase()+'@example.test',agentPhone:'',activityKind:'proposal'}});
  const st=(r,all)=>clientState(r,all,now);

  const a1=sent('A1','Alpha',-5),b1=sent('B1','Beta',-2);
  pass('Older Sent and newer Sent for one client are both clear; newer lists the older as an overlap',st(a1,[a1,b1]).state==='clear'&&st(b1,[a1,b1]).state==='clear'&&st(b1,[a1,b1]).overlaps?.[0]?.inquiryId==='A1'&&!st(a1,[a1,b1]).overlaps&&st(b1,[a1,b1]).matches.length===0);
  const a2=sent('A2','Alpha'),b2=rec('B2','Beta');
  pass('A new import from a different agent is held while the Sent registration stays clear',st(b2,[a2,b2]).state==='duplicate'&&st(b2,[a2,b2]).matches[0].inquiryId==='A2'&&st(a2,[a2,b2]).state==='clear');
  const a3=rec('A3','Alpha',{status:'Approved — email failed',submissions:decided('approve')});
  const b3=rec('B3','Beta');
  pass('Approved with a failed email is registered and clear, so a retry is not blocked',isRegistered(a3)&&!a3.protection&&st(a3,[a3,b3]).state==='clear'&&st(b3,[a3,b3]).state==='duplicate');
  const staleA3={...a3,clientReview:{state:'duplicate',identity:'x',matches:[{inquiryId:'OLD'}]}};
  pass('A stale saved duplicate flag on a registered record is ignored',st(staleA3,[staleA3,b3]).state==='clear'&&st(b3,[staleA3,b3]).state==='duplicate');
  const a4=rec('A4','Alpha'),b4=rec('B4','Beta');
  pass('An unprocessed older request keeps blocking a newer one from another agent',!isRegistered(a4)&&st(a4,[a4,b4]).state==='clear'&&st(b4,[a4,b4]).state==='duplicate');
  const a5=rec('A5','Alpha',{status:'Declined',submissions:decided('reject')}),b5=rec('B5','Beta');
  pass('A declined submission is not registered; the closed claim does not block the newer request',!isRegistered(a5)&&st(b5,[{...a5,closure:{kind:'declined',at:iso(-1),by:'x',reason:'r'}},b5]).state==='clear');
  const a6=sent('A6','Alpha',-40),b6=rec('B6','Alpha');
  pass('An expired registration is archived and the same agent repeat matches it as an expired same-agent request',st(a6,[a6,b6]).state==='archived'&&st(b6,[a6,b6]).state==='duplicate'&&st(b6,[a6,b6]).matches[0].expiredSameAgent===true);
  const a7=sent('A7','Alpha',-40),b7=rec('B7','Beta');
  pass('A different agent after expiry still needs supervisor approval',st(b7,[a7,b7]).state==='duplicate'&&st(b7,[a7,b7]).matches[0].expired===true&&st(b7,[a7,b7]).matches[0].expiredSameAgent===false);
  const a8=sent('A8','Alpha');
  pass('A registered record with no matches has no overlaps',st(a8,[a8]).state==='clear'&&st(a8,[a8]).overlaps===undefined);
  // Fix round: registered records are not auto-declined; projections keep approvals; declined-but-protected still blocks.
  const old9=sent('A9','Alpha',-40),reg9=sent('B9','Alpha',-2);
  pass('A registered record matching an expired same-agent registration stays clear (never auto-declined)',isRegistered(reg9)&&st(reg9,[old9,reg9]).state==='clear'&&st(reg9,[old9,reg9]).overlaps?.[0]?.expiredSameAgent===true);
  const proj=r=>({...r,submissions:r.submissions.filter(s=>s.decision?.action==='approve').map(s=>({version:s.version,decision:s.decision}))});
  const a10=rec('A10','Alpha',{status:'Approved — sending',submissions:decided('approve')}),b10=rec('B10','Beta');
  pass('An approved-but-undelivered record counts as registered in its projection and blocks a newer other-agent request',isRegistered(proj(a10))&&st(proj(a10),[proj(a10),b10]).state==='clear'&&st(b10,[proj(a10),b10]).state==='duplicate');
  const a11={...sent('A11','Alpha'),status:'Declined',closure:{kind:'declined',at:iso(-1),by:'x',reason:'r'}},b11=rec('B11','Beta');
  pass('A declined record whose protection is still active keeps blocking a newer other-agent request',st(b11,[a11,b11]).state==='duplicate'&&st(b11,[a11,b11]).matches[0].inquiryId==='A11'&&st(b11,[a11,b11]).matches[0].expired===false);
  const a12={...sent('A12','Alpha',-40),status:'Declined',closure:{kind:'declined',at:iso(-35),by:'x',reason:'r'}},b12=rec('B12','Beta');
  pass('A declined record whose protection has expired no longer blocks',st(b12,[a12,b12]).state==='clear');
  console.log('\nPure client-rules checks passed: '+checks.length);
  if(process.env.RMC2_PURE_ONLY)process.exit(0);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function call(user,route,body,expected=200,headers={}){
  const response=await fetch(base+'/api/operations/'+route,{method:body===undefined?'GET':'POST',headers:{...(sessions[user]?{Cookie:sessions[user]}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  if(route==='login'&&response.ok)sessions[user]=response.headers.get('set-cookie').split(';')[0];
  const value=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,expected,route+': '+JSON.stringify(Buffer.isBuffer(value)?value.subarray(0,100).toString():value));
  return {value,response};
}
const state=async user=>(await call(user,'bootstrap')).value;
const current=async id=>(await state('cryssa')).inquiries.find(record=>record.id===id);
const act=async(user,record,action,body={},expected=200)=>(await call(user,'inquiries/'+record.id+'/'+action,action==='activity'?body:{revision:record.revision,...body},expected)).value.inquiry;
async function workbook(company,person,agent='Agent Alpha'){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Sheet1');
  const values={A6:'ACCOUNT PROFILE',C7:agent,J7:'2026-10-16',D8:'Antipolo',J8:'09171234567',B10:company,J10:'PRIVATE',J11:'Services',C12:'Antipolo City',D14:person,B17:'client@example.test',J16:'09981234567',C18:'Manager',J18:'None',B21:person,G21:'Manager',D22:'Group healthcare',G23:'Annual',D25:10,J24:0,C26:'25–58'};
  for(const [cell,value] of Object.entries(values))sheet.getCell(cell).value=value;
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function intake(company,person,sender='alpha@example.test',agent='Agent Alpha',bytes){
  const form=new FormData();form.append('sender',sender);form.append('file',new File([bytes||await workbook(company,person,agent)],'client-form.xlsx'));
  return (await call('cryssa','intake',form,201)).value.inquiry;
}
function fixture(record,changes){
  const next={...record,...changes,revision:record.revision+1};
  database.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(next.revision,JSON.stringify(next),next.id);return next;
}
async function report(record,changes={},expected=200,attachment){
  const body={revision:record.revision,requestId:randomUUID(),sender:record.protection.agentEmail,sentAt:new Date(Date.now()-3600000).toISOString(),summary:'The agent reports an ongoing client discussion.',reference:'Verified agent email / progress report',...changes};
  const form=new FormData();for(const [key,value] of Object.entries(body))form.set(key,String(value));if(attachment)form.set('file',attachment);
  return (await call('cryssa','inquiries/'+record.id+'/progress-report',form,expected)).value.inquiry;
}

await call('anonymous','bootstrap',undefined,401);
for(const user of ['cryssa','jefferson','emerson','admin'])await call(user,'login',{email:user+'@rmc2.local',password:'Rmc2Local!2026'});
assert.ok((await readFile(path.join(data,'rmc2.sqlite'))).length,'Use RMC2_DATA_DIR=test-results/client-protection/qa-data for the QA server.');
database=new DatabaseSync(path.join(data,'rmc2.sqlite'));database.exec('PRAGMA busy_timeout=5000');
try{
  const suffix=Date.now(),company='Protection Company '+suffix,person='Clement Fernandez '+suffix;
  let original=await intake(company,person);
  pass('First client registration is clear and has no countdown before an outbound reply',(await state('cryssa')).clientStates[original.id].state==='clear'&&!(await state('cryssa')).clientStates[original.id].protection);
  await act('cryssa',original,'activity',{tab:randomUUID(),action:'start'});
  original=await act('cryssa',original,'request-details',{body:'Please confirm the account details.'});
  pass('A successful details reply starts exactly 30 days of protection',Date.parse(original.protection.expiresAt)-Date.parse(original.protection.startedAt)===CLIENT_PROTECTION_MS);
  pass('The registered agent owns protection, independently of the handling employee',original.protection.agentEmail==='alpha@example.test'&&original.protection.agentName==='Agent Alpha');
  pass('Countdown includes the final moment and expires at the exact deadline',!isClientArchived(original,Date.parse(original.protection.expiresAt)-1)&&isClientArchived(original,Date.parse(original.protection.expiresAt))&&protectionDaysLeft(original.protection,Date.parse(original.protection.expiresAt))===0);

  const sourceBytes=await workbook(company,person),same=await intake(company,person,'alpha@example.test','Agent Alpha',sourceBytes);
  const identical=await intake(company,person,'beta@example.test','Agent Beta',sourceBytes);
  pass('Repeated client from the same agent is flagged and links to the existing inquiry',same.clientReview.state==='duplicate'&&same.clientReview.matches.some(match=>match.inquiryId===original.id&&match.sameAgent));
  pass('An identical form from a different sender is flagged',identical.clientReview.matches.some(match=>match.inquiryId===same.id)===false&&identical.clientReview.state==='duplicate'&&identical.clientReview.matches.some(match=>match.inquiryId===original.id&&!match.sameAgent));
  const otherAgent=await intake(company,person,'beta@example.test','Agent Beta');
  pass('Changing agents does not bypass matching client details',otherAgent.clientReview.state==='duplicate'&&otherAgent.clientReview.matches.some(match=>!match.sameAgent&&match.inquiryId===original.id));
  const byPerson=await intake('Another Company '+suffix,'Dr. '+person,'gamma@example.test','Agent Gamma');
  const byAccount=await intake(company,'Different Client '+suffix,'delta@example.test','Agent Delta');
  pass('Either the client name or account name triggers review',byPerson.clientReview.matches.some(match=>match.reasons.includes('Same client / addressee name'))&&byAccount.clientReview.matches.some(match=>match.reasons.includes('Same account / company')));
  for(const action of ['activity','save','generate','customize','submit','request-details']){
    const payload=action==='activity'?{tab:randomUUID(),action:'start'}:action==='save'?{fields:otherAgent.fields,templateId:'',notes:'',email:otherAgent.email,emailOverrides:[]}:action==='customize'?{templateId:'d023'}:action==='request-details'?{body:'This must not be sent.'}:{};
    await act('cryssa',otherAgent,action,payload,409);
  }
  await act('emerson',otherAgent,'decision',{version:1,action:'approve',note:'',flags:[]},409);
  pass('Server blocks duplicate pickup, saving, customization, generation, submission, outbound requests and approval');
  await act('cryssa',byPerson,'review-client',{action:'distinct',note:'These are unrelated accounts with matching names.'},403);
  const distinct=await act('emerson',byPerson,'review-client',{action:'distinct',note:'The source forms show unrelated clients with matching full names.'});
  pass('A supervisor can clear a false match with an audited reason',distinct.clientReview.state==='clear'&&distinct.clientReview.reviewedBy==='emerson'&&distinct.history.at(-1).action.includes('DIFFERENT CLIENTS'));
  pass('A false-match decision does not block the existing legitimate registration',(await state('cryssa')).clientStates[original.id].state==='clear');

  original=fixture(await current(original.id),{protection:{...original.protection,startedAt:new Date(Date.now()-20*86400000).toISOString(),activityAt:new Date(Date.now()-20*86400000).toISOString(),expiresAt:new Date(Date.now()+10*86400000).toISOString()}});
  const beforeMail=await readFile(path.join(data,original.detailRequests[0].file));
  const sentAt=new Date(Date.now()-2*86400000).toISOString(),requestId=randomUUID();
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Fictional agent progress report');const pdfBytes=Buffer.from(await pdf.save());
  original=await report(original,{sentAt,requestId},200,new File([pdfBytes],'agent-progress.pdf',{type:'application/pdf'}));
  pass('Progress report resets protection from its sent date, rather than the date staff recorded it',Date.parse(original.protection.expiresAt)===Date.parse(sentAt)+CLIENT_PROTECTION_MS&&protectionDaysLeft(original.protection)===28);
  pass('Report receipt, reference, summary and recording employee are retained',original.progressReports.at(-1).recordedBy==='cryssa'&&original.progressReports.at(-1).reference.includes('Verified'));
  const revision=original.revision,expiry=original.protection.expiresAt;
  const retried=await report(original,{sentAt,requestId,revision:revision-1});
  pass('Retrying the same report cannot reset the timer twice',retried.revision===revision&&retried.progressReports.length===1&&retried.protection.expiresAt===expiry);
  await report(original,{sender:'different-agent@example.test'},409);
  await report(original,{sentAt:new Date(Date.now()+86400000).toISOString()},400);
  await report(original,{sentAt:original.protection.activityAt},400);
  await report(original,{},400,new File(['not a PDF'],'unsafe.pdf'));
  pass('Reports from another agent, future reports, old reports and invalid attachments do not extend protection');
  pass('Recording progress does not rewrite previously sent files',sha(beforeMail)===sha(await readFile(path.join(data,original.detailRequests[0].file))));
  const reportId=original.progressReports[0].id,download='file/'+original.id+'/progress?report='+reportId;
  await call('anonymous',download,undefined,401);
  const retrieved=await call('jefferson',download);
  pass('Confidential reports require sign-in and preserve the uploaded bytes',sha(retrieved.value)===sha(pdfBytes));
  pass('Private file responses cannot be publicly cached or fetched cross-origin',retrieved.response.headers.get('cache-control')==='private, no-store'&&retrieved.response.headers.get('cross-origin-resource-policy')==='same-origin'&&retrieved.response.headers.get('x-content-type-options')==='nosniff');
  pass('Confidential-file access is logged without claiming or editing the inquiry',database.prepare('SELECT user_id FROM file_access WHERE inquiry_id=? AND kind=?').get(original.id,'progress-report').user_id==='jefferson'&&(await current(original.id)).revision===revision);
  await call('cryssa','inquiries/'+original.id+'/review-client',{revision,action:'recheck',note:''},403,{Origin:'https://unrelated.example.test'});
  pass('Cross-origin writes are rejected');

  const pdfForm=new FormData();pdfForm.set('sender','pdf-agent@example.test');pdfForm.set('file',new File([pdfBytes],'intake.pdf'));
  let pdfInquiry=(await call('cryssa','intake',pdfForm,201)).value.inquiry;
  pass('A PDF without extracted client details is held for identification',pdfInquiry.clientReview.state==='identify');
  const copiedPdf=new FormData();copiedPdf.set('sender','other-pdf-agent@example.test');copiedPdf.set('file',new File([pdfBytes],'copied-form.pdf'));
  const copied=(await call('cryssa','intake',copiedPdf,201)).value.inquiry;
  pass('An identical PDF is flagged even before its client fields are entered',copied.clientReview.state==='duplicate'&&copied.clientReview.matches.some(match=>match.inquiryId===pdfInquiry.id&&match.reasons.includes('Same submitted file')));
  await act('cryssa',pdfInquiry,'generate',{},409);
  await act('cryssa',pdfInquiry,'activity',{tab:randomUUID(),action:'start'});
  pdfInquiry=await act('cryssa',pdfInquiry,'save',{fields:{...pdfInquiry.fields,company:'PDF Client '+suffix,contactName:person,addressee:person},templateId:'',notes:'',email:pdfInquiry.email,emailOverrides:[]});
  pass('Saving client details on a PDF runs duplicate checks before processing',pdfInquiry.clientReview.state==='duplicate');

  let expiring=await intake('Expired Account '+suffix,'Expiry Contact '+suffix,'old-agent@example.test','Old Agent');
  await act('cryssa',expiring,'activity',{tab:randomUUID(),action:'start'});
  expiring=await act('cryssa',expiring,'request-details',{body:'Please send your progress.'});
  const waiting=await intake(expiring.fields.company,expiring.fields.contactName,'next-agent@example.test','Next Agent');
  pass('A second agent cannot register the client during the protection window',waiting.clientReview.state==='duplicate');
  expiring=fixture(expiring,{protection:{...expiring.protection,startedAt:new Date(Date.now()-31*86400000).toISOString(),activityAt:new Date(Date.now()-31*86400000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString()}});
  pass('Expired protection appears in Archives without altering original workflow status',(await state('cryssa')).clientStates[expiring.id].state==='archived'&&expiring.status==='Waiting for agent details');
  await act('cryssa',expiring,'activity',{tab:randomUUID(),action:'start'},409);
  await report(expiring,{},409);
  let next=await intake(expiring.fields.company,expiring.fields.contactName,'fresh-agent@example.test','Fresh Agent');
  pass('A new agent waits for supervisor approval after expiry',next.clientReview.state==='duplicate');
  await act('cryssa',next,'review-client',{action:'reassign-expired',note:'Verified expiry and the new agent.'},403);
  next=await act('emerson',next,'review-client',{action:'reassign-expired',note:'Verified expiry and the new agent.'});
  pass('Supervisor approval clears the expired-registration hold',next.clientReview.state==='clear');
  const stillBlocked=await act('cryssa',waiting,'review-client',{action:'recheck',note:''});
  pass('Previously flagged submissions do not silently activate after expiry',stillBlocked.clientReview.state==='duplicate'&&stillBlocked.clientReview.matches.some(match=>match.inquiryId===next.id));
  pass('Archived forms and details emails remain available to authorized staff',(await call('jefferson','file/'+expiring.id+'/source')).value.length>100);

  let proposal=await intake('Proposal Delivery '+suffix,'Proposal Contact '+suffix,'proposal-agent@example.test','Proposal Agent');
  const storedPdf='packages/'+randomUUID()+'.pdf';await mkdir(path.dirname(path.join(data,storedPdf)),{recursive:true});await writeFile(path.join(data,storedPdf),pdfBytes);
  const generated={id:randomUUID(),templateId:'test-private-fixture',sourceHash:'fixture',renderer:'native-word-v2',pdf:storedPdf,docx:'not-downloaded.docx',filename:'fictional-test-proposal',generatedAt:new Date().toISOString(),preparedBy:'cryssa',fingerprint:'isolated-test',fields:{...proposal.fields},pageCount:1};
  proposal=fixture(proposal,{status:'Awaiting approval',generated,submissions:[{version:1,at:new Date().toISOString(),submittedBy:'cryssa',fields:{...proposal.fields},email:{...proposal.email},emailOverrides:[],generated,notes:'',warnings:[]}]});
  proposal=await act('emerson',proposal,'decision',{version:1,action:'approve',note:'Fictional QA approval.',flags:[],failSend:true});
  pass('An unsuccessful proposal send does not start the countdown',proposal.status==='Approved — email failed'&&!proposal.protection);
  proposal=await act('cryssa',proposal,'retry');
  pass('The countdown starts only when the approved proposal is successfully delivered',proposal.status==='Sent'&&!!proposal.protection&&proposal.protection.agentEmail==='proposal-agent@example.test');
  const frozen=JSON.stringify(proposal.submissions);
  proposal=fixture(proposal,{protection:{...proposal.protection,startedAt:new Date(Date.now()-5*86400000).toISOString(),activityAt:new Date(Date.now()-5*86400000).toISOString(),expiresAt:new Date(Date.now()+25*86400000).toISOString()}});
  proposal=await report(proposal);
  pass('Progress reports on sent proposals preserve all frozen submission data',JSON.stringify(proposal.submissions)===frozen);
  const availableCompany='Concurrent Account '+suffix,availablePerson='Concurrent Person '+suffix;
  const simultaneous=await Promise.all([intake(availableCompany,availablePerson,'one@example.test','Agent One'),intake(availableCompany,availablePerson,'two@example.test','Agent Two')]);
  pass('Simultaneous submissions cannot register two agents for the same client',simultaneous.filter(record=>record.clientReview.state==='clear').length===1&&simultaneous.filter(record=>record.clientReview.state==='duplicate').length===1);
  pass('Name normalization recognizes punctuation, accents and honorific-safe matches',normalizeClient('  CLEMENT  FERNÁNDEZ! ')==='clement fernandez');
  const summary={at:new Date().toISOString(),checks,records:{original:original.id,duplicate:otherAgent.id,archived:expiring.id,newAgent:next.id,proposal:proposal.id}};
  await writeFile(path.join(out,'checks.json'),JSON.stringify(summary,null,2));console.log('\n'+checks.length+' client-protection checks passed.');
}finally{database?.close();}
