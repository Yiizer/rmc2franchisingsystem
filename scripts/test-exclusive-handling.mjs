import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:5190',out='test-results/exclusive-handling';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[];let page,db;
const pass=message=>{checks.push(message);console.log('PASS '+message);};
async function login(who){const ctx=await browser.newContext({viewport:{width:1440,height:950}});ctx.setDefaultTimeout(45000);assert.ok((await ctx.request.post(base+'/api/operations/login',{data:{email:who+'@rmc2.local',password:'Rmc2Local!2026'}})).ok());return ctx;}
const state=async ctx=>(await(await ctx.request.get(base+'/api/operations/bootstrap')).json());
const activity=(ctx,id,tab,action)=>ctx.request.post(base+'/api/operations/inquiries/'+id+'/activity',{data:{tab,action}});
const payload=r=>({revision:r.revision,fields:r.fields,templateId:r.templateId,notes:r.notes,email:r.email,emailOverrides:r.emailOverrides});
async function current(ctx,id){return (await state(ctx)).inquiries.find(r=>r.id===id);}
async function open(ctx,r){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await navigate(p,'Inquiries');await p.getByRole('link',{name:'Open '+r.fields.company,exact:true}).filter({hasText:r.id}).click();return p;}
async function until(fn){for(let i=0;i<80;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('State did not settle');}
async function preview(p){await p.locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:120000});assert.equal(await p.locator('.ops-doc-preview [role="alert"]').count(),0);}
try{
 const c=await login('cryssa'),j=await login('jefferson'),supervisor=await login('zeo'),admin=await login('admin');
 const source=await(await c.request.get(base+'/api/operations/sample-form')).body();
 let response=await c.request.post(base+'/api/operations/intake',{multipart:{sender:'exclusive.agent@example.com',file:{name:'exclusive-form.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source}}});assert.equal(response.status(),201);let r=(await response.json()).inquiry;
 const ct=randomUUID(),jt=randomUUID(),ct2=randomUUID();
 response=await c.request.post(base+'/api/operations/inquiries/'+r.id+'/save',{data:payload(r)});assert.equal(response.status(),423);
 const race=await Promise.all([activity(c,r.id,ct,'start'),activity(j,r.id,jt,'start')]);assert.deepEqual(race.map(r=>r.status()).sort(),[200,423]);assert.equal((await state(c)).activity.filter(a=>a.inquiryId===r.id).length,1);assert.deepEqual(await current(c,r.id),r);
 pass('Start handling is required, and simultaneous claims produce exactly one owner without changing saved records');
 await activity(c,r.id,ct,'leave');await activity(j,r.id,jt,'leave');assert.equal((await activity(c,r.id,ct,'start')).status(),200);
 for(const [action,data] of [['save',payload(r)],['customize',{revision:r.revision,templateId:'d023'}],['generate',{revision:r.revision}],['submit',{revision:r.revision}],['request-details',{revision:r.revision,body:'Please confirm details.'}],['chat',{revision:r.revision,question:'Compare the alternatives'}]]){
   response=await j.request.post(base+'/api/operations/inquiries/'+r.id+'/'+action,{data});assert.equal(response.status(),423,action+': '+await response.text());
 }
 assert.deepEqual(await current(c,r.id),r);
 assert.equal((await activity(supervisor,r.id,randomUUID(),'start')).status(),423);assert.equal((await activity(admin,r.id,randomUUID(),'start')).status(),403);
 assert.equal((await j.request.get(base+'/api/operations/file/'+r.id+'/source')).status(),200);
 pass('Other employees and supervisors cannot mutate the handler’s draft through the API; source viewing still works');
 await activity(c,r.id,ct2,'start');await activity(j,r.id,ct,'leave');assert.equal((await activity(j,r.id,jt,'start')).status(),423);
 await activity(c,r.id,ct,'leave');assert.equal((await activity(j,r.id,jt,'start')).status(),423);
 await activity(c,r.id,ct2,'leave');assert.equal((await activity(j,r.id,jt,'start')).status(),200);
 await activity(c,r.id,ct2,'heartbeat');assert.equal((await state(c)).activity.find(a=>a.inquiryId===r.id).userId,'jefferson');
 pass('Closing one owner tab preserves their other tab; outsiders and late heartbeats cannot release or steal a lock');
 db=new DatabaseSync(path.resolve(out,'qa-data/rmc2.sqlite'));
 db.prepare('UPDATE inquiry_activity SET seen_at=? WHERE inquiry_id=?').run(new Date(Date.now()-95000).toISOString(),r.id);
 await activity(j,r.id,jt,'heartbeat');assert.equal((await activity(c,r.id,ct,'start')).status(),200);
 assert.equal((await j.request.post(base+'/api/operations/inquiries/'+r.id+'/save',{data:payload(r)})).status(),423);
 await activity(c,r.id,ct,'leave');pass('Expired ownership cannot save or reclaim silently after another employee picks up');
 page=await open(c,r);const viewer=await open(j,r);
 await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByText('Handling: you',{exact:true}).waitFor();
 await viewer.getByText('Cryssa Kate Aban is handling this inquiry',{exact:true}).waitFor();assert.equal(await viewer.getByRole('button',{name:'Help alongside',exact:true}).count(),0);
 await viewer.getByRole('button',{name:'View submitted form',exact:true}).click();await viewer.getByRole('dialog',{name:'Agent submitted form'}).waitFor();await viewer.getByRole('button',{name:'Close dialog',exact:true}).click();
 await viewer.getByRole('button',{name:/Choose template/}).click();assert.equal(await viewer.getByLabel('Proposal template',{exact:true}).count(),0);assert.equal(await viewer.getByRole('button',{name:/Browse templates/}).isEnabled(),true);assert.equal(await viewer.getByRole('button',{name:'Use this template',exact:true}).first().isDisabled(),true);assert.equal(await viewer.getByRole('button',{name:'Customize',exact:true}).count(),0);
 await viewer.locator('.ops-proposal-choice').first().getByRole('button',{name:'Preview template',exact:true}).click();await preview(viewer);assert.equal(await viewer.getByLabel('Client / addressee',{exact:true}).isDisabled(),true);assert.equal(await viewer.getByRole('button',{name:'Save details',exact:true}).count(),0);
 await viewer.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await viewer.screenshot({path:out+'/locked-workspace.png'});
 pass('Viewer sees a lock banner and can inspect the form and templates, with all preparation controls disabled');
 await page.getByRole('button',{name:/Choose template/}).click();await page.locator('.ops-proposal-choice').filter({has:page.getByRole('heading',{name:'BureauHealth 7K & 5K · Standard',exact:true})}).getByRole('button',{name:'Use this template',exact:true}).click();await page.getByRole('button',{name:'Continue to preview',exact:true}).click();await preview(page);
 await page.getByLabel('Client / addressee',{exact:true}).fill('Dr. Exclusive Handler');await page.getByRole('button',{name:'Release to queue',exact:true}).click();await page.getByRole('heading',{name:'Inquiries',exact:true}).waitFor();
 r=await current(c,r.id);assert.equal(r.fields.addressee,'Dr. Exclusive Handler');assert.ok(r.handledBy.includes('cryssa'));assert.equal((await state(c)).activity.filter(a=>a.inquiryId===r.id).length,0);
 await viewer.getByRole('button',{name:'Start handling',exact:true}).waitFor();await viewer.getByRole('button',{name:'Start handling',exact:true}).click();await viewer.getByText('Handling: you',{exact:true}).waitFor();
 assert.equal(await viewer.locator('.ops-proposal-choice').first().getByRole('button',{name:'Use this template',exact:true}).isEnabled(),true);assert.ok((await viewer.locator('.ops-proposal-choice.selected .ops-suggestion-source').innerText()).includes('D024'));
 pass('Release to queue saves before unlocking; the next employee picks up the same saved draft');
 await page.reload();await navigate(page,'Inquiries');await page.getByRole('columnheader',{name:'Current handler',exact:true}).waitFor();
 const row=page.getByRole('link',{name:'Open '+r.fields.company,exact:true}).filter({hasText:r.id});assert.equal(await row.locator('td.dir-cell-handler').textContent(),'JSJefferson SilotView only');await row.screenshot({path:out+'/current-handler-column.png'});
 pass('Inquiry lists show one current handler instead of accumulated historical contributors');
 await viewer.locator('.ops-proposal-choice').first().getByRole('button',{name:'Customize',exact:true}).click();await viewer.locator('[data-custom-block]').first().waitFor();
 r=await current(j,r.id);await row.click();await page.getByRole('button',{name:/Preview & approval/}).click();await preview(page);
 assert.equal(await page.getByRole('button',{name:'Edit document',exact:true}).isDisabled(),true);assert.equal(await page.locator('[contenteditable="true"]').count(),0);assert.equal(await page.getByLabel('Client / addressee',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Prepare PDF & email',exact:true}).count(),0);
 await page.locator('.ops-doc-toolbar').evaluate(e=>window.scrollBy(0,e.getBoundingClientRect().top-64));const before=await page.locator('.ops-doc-fields').evaluate(e=>e.getBoundingClientRect().top);await page.getByRole('region',{name:'Scrollable proposal document',exact:true}).evaluate(e=>e.scrollTop=1800);assert.equal(await page.locator('.ops-doc-fields').evaluate(e=>e.getBoundingClientRect().top),before);
 pass('Saved customized proposals remain visible but not editable, with independent PDF scrolling');
 await viewer.getByRole('button',{name:'Release to queue',exact:true}).click();await page.getByRole('button',{name:'Start handling',exact:true}).waitFor();await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByText('Handling: you',{exact:true}).waitFor();
 await page.getByLabel('Client / addressee',{exact:true}).fill('Unsaved recovery value');
 db.prepare('UPDATE inquiry_activity SET seen_at=? WHERE inquiry_id=?').run(new Date(Date.now()-95000).toISOString(),r.id);
 assert.equal((await activity(j,r.id,jt,'start')).status(),200);
 await page.getByText('Jefferson Silot is handling this inquiry',{exact:true}).waitFor();assert.equal(await page.getByLabel('Client / addressee',{exact:true}).isDisabled(),true);await page.getByText('Your unsaved changes are kept on this device. Start handling again before saving them.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to inquiries',exact:true}).click();assert.ok(await page.evaluate(id=>JSON.parse(sessionStorage.getItem('rmc2-draft-cryssa-'+id)).fields.addressee==='Unsaved recovery value',r.id));assert.notEqual((await current(j,r.id)).fields.addressee,'Unsaved recovery value');
 pass('If a lease expires, editing stops and unsaved local changes are retained without overwriting the new owner');
 await activity(j,r.id,jt,'leave');assert.deepEqual(errors,[]);pass('No browser JavaScript errors');await writeFile(out+'/checks.json',JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'});throw error;}finally{db?.close();await browser.close();}
