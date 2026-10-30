import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:5190',out='test-results/activity-scroll';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[];let page;
const pass=message=>{checks.push(message);console.log('PASS '+message);};
async function login(who){const context=await browser.newContext({viewport:{width:1540,height:1000}});context.setDefaultTimeout(45000);assert.ok((await context.request.post(base+'/api/operations/login',{data:{email:who+'@rmc2.local',password:'Rmc2Local!2026'}})).ok());return context;}
async function state(ctx){return (await(await ctx.request.get(base+'/api/operations/bootstrap')).json());}
async function opened(ctx,r){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('link',{name:'Open '+r.fields.company,exact:true}).click();return p;}
async function activity(ctx,id,tab,action){return ctx.request.post(base+'/api/operations/inquiries/'+id+'/activity',{data:{tab,action}});}
async function until(fn){for(let i=0;i<65;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('Activity did not settle');}
async function preview(p){await p.locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:120000});assert.equal(await p.locator('.ops-doc-preview [role="alert"]').count(),0);}
async function independentScroll(p){
  const area=p.getByRole('region',{name:'Scrollable proposal document',exact:true});
  await area.evaluate(e=>e.scrollTop=0);
  const before=await p.locator('.ops-doc-fields').evaluate(e=>({top:e.getBoundingClientRect().top,window:window.scrollY,modal:e.closest('.ops-modal')?.scrollTop||0}));
  await area.evaluate(e=>e.scrollTop=2400);await p.waitForTimeout(100);
  const after=await p.locator('.ops-doc-fields').evaluate(e=>({top:e.getBoundingClientRect().top,window:window.scrollY,modal:e.closest('.ops-modal')?.scrollTop||0}));
  assert.deepEqual(after,before);
  assert.ok(await area.evaluate(e=>e.scrollTop>1500&&e.scrollHeight>e.clientHeight*3));
  const box=await area.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+Math.min(150,box.height/2));await p.mouse.wheel(0,500);await p.waitForTimeout(300);
  assert.equal(await p.evaluate(()=>window.scrollY),before.window);assert.ok(await area.evaluate(e=>e.scrollTop>2400));
}
try{
  const cryssa=await login('cryssa'),jefferson=await login('jefferson'),admin=await login('admin');
  let initial=(await state(cryssa)).inquiries.find(r=>r.id==='INQ-2026-00129');
  page=await opened(cryssa,initial);await page.getByRole('button',{name:'Start handling',exact:true}).waitFor();
  assert.deepEqual((await state(cryssa)).activity,[]);pass('Opening an inquiry alone does not claim it or change its contributor history');
  await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByText('Handling: you',{exact:true}).waitFor();
  const before=await state(cryssa);assert.equal(before.inquiries.find(r=>r.id===initial.id).revision,initial.revision);assert.equal(before.activity[0].userId,'cryssa');
  const other=await jefferson.newPage();await other.goto(base);await other.getByText('Handling now · Cryssa Kate Aban',{exact:true}).waitFor();
  await other.getByRole('link',{name:'Open '+initial.fields.company,exact:true}).click();await other.getByText('Cryssa Kate Aban is handling this inquiry',{exact:true}).waitFor();
  await other.getByRole('button',{name:'Help alongside',exact:true}).click();await other.getByRole('button',{name:'Release to queue',exact:true}).waitFor();
  await page.getByText('Jefferson Silot is handling this inquiry',{exact:true}).waitFor();
  assert.equal((await state(cryssa)).activity.length,2);assert.equal((await state(cryssa)).inquiries.find(r=>r.id===initial.id).revision,initial.revision);
  await other.screenshot({path:out+'/live-handling.png'});pass('Two staff accounts see live handling notices and can explicitly help without an assignment or lock');
  await other.getByRole('button',{name:'Release to queue',exact:true}).click();await until(async()=>!(await state(cryssa)).activity.some(a=>a.userId==='jefferson'));
  await page.getByRole('button',{name:'Release to queue',exact:true}).click();await until(async()=>!(await state(cryssa)).activity.length);pass('Leaving releases activity and does not change inquiry revisions');
  const tab=randomUUID(),secondTab=randomUUID();
  assert.equal((await activity(admin,initial.id,randomUUID(),'start')).status(),403);
  assert.equal((await activity(cryssa,'not-found',randomUUID(),'start')).status(),404);
  assert.equal((await activity(cryssa,initial.id,'invalid-tab','start')).status(),400);
  await activity(cryssa,initial.id,tab,'start');await activity(cryssa,initial.id,secondTab,'start');await activity(jefferson,initial.id,tab,'leave');
  assert.equal((await state(cryssa)).activity.length,1);
  await activity(cryssa,initial.id,tab,'leave');assert.equal((await state(cryssa)).activity.length,1);
  await activity(cryssa,initial.id,secondTab,'leave');await activity(cryssa,initial.id,secondTab,'heartbeat');assert.equal((await state(cryssa)).activity.length,0);
  pass('Presence is authenticated, scoped to each tab/session, and late heartbeats cannot resurrect a released tab');
  await activity(cryssa,initial.id,tab,'start');
  const database=new DatabaseSync(path.resolve(out,'qa-data/rmc2.sqlite'));
  database.prepare('UPDATE inquiry_activity SET seen_at=? WHERE tab=?').run(new Date(Date.now()-95000).toISOString(),tab);
  assert.equal((await state(cryssa)).activity.length,0);database.close();pass('Disconnected activity expires after 90 seconds');
  await page.getByRole('link',{name:'Open '+initial.fields.company,exact:true}).click();await page.getByRole('button',{name:/Choose template/}).click();await page.getByLabel('Proposal template',{exact:true}).selectOption('d024');
  await until(async()=>(await state(cryssa)).activity.some(a=>a.userId==='cryssa'));
  await page.getByRole('button',{name:'Continue to preview',exact:true}).click();await preview(page);
  assert.ok(await page.locator('.ops-workspace-id .ops-badge.preparing').count());
  const badge=await page.locator('.ops-workspace-id .ops-badge.preparing').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));assert.equal(badge.background,'rgb(228, 237, 255)');pass('Editing starts handling automatically and Preparing proposal has a distinct blue badge');
  await page.locator('.ops-doc-toolbar').evaluate(e=>window.scrollBy(0,e.getBoundingClientRect().top-64));await independentScroll(page);await page.screenshot({path:out+'/separate-document-scroll.png'});pass('Embedded PDF scrolls independently, including mouse-wheel input, with fill details stationary');
  await page.locator('.ops-check-proposal').click();await page.locator('.ops-doc-notes-column').waitFor();await independentScroll(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);pass('Independent document scrolling also works beside AI comments');
  await page.locator('.ops-ai-notes').getByRole('button',{name:'Close AI notes',exact:true}).click();
  await page.setViewportSize({width:1366,height:720});await page.waitForTimeout(300);await page.locator('.ops-doc-toolbar').evaluate(e=>window.scrollBy(0,e.getBoundingClientRect().top-64));await independentScroll(page);
  const fields=await page.locator('.ops-doc-fields').evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:innerHeight}));assert.ok(fields.bottom<=fields.height+1,JSON.stringify(fields));
  pass('Fill controls remain visible while scrolling the PDF on a smaller laptop');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const mobileArea=page.getByRole('region',{name:'Scrollable proposal document',exact:true});await mobileArea.scrollIntoViewIfNeeded();await independentScroll(page);await page.screenshot({path:out+'/phone-document-scroll.png'});pass('Phone preview has its own scroll area without horizontal page overflow');
  await page.setViewportSize({width:1280,height:854});await page.getByRole('button',{name:/Choose template/}).click();await page.locator('.ops-proposal-choice').first().getByRole('button',{name:'Preview template',exact:true}).click();await preview(page);await independentScroll(page);await page.screenshot({path:out+'/template-modal-scroll.png'});
  const scrollers=await page.getByRole('dialog').evaluate(e=>[e,...e.querySelectorAll('*')].filter(n=>['auto','scroll'].includes(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+4).map(n=>n.className));assert.deepEqual(scrollers,['ops-doc-document-area']);pass('Template modal has one document scrollbar; the dialog and form stay still');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.locator('.ops-proposal-choice').first().getByRole('button',{name:'Customize',exact:true}).click();await page.locator('[data-custom-block]').first().waitFor();
  await page.getByRole('region',{name:'Scrollable proposal document',exact:true}).evaluate(e=>e.scrollTop=0);await page.locator('.ops-doc-toolbar').evaluate(e=>window.scrollBy(0,e.getBoundingClientRect().top-64));await independentScroll(page);
  const tool=await page.locator('.ops-custom-format').boundingBox(),doc=await page.getByRole('region',{name:'Scrollable proposal document',exact:true}).boundingBox();assert.ok(Math.abs(tool.y-doc.y)<3,JSON.stringify({tool,doc}));pass('Customized document uses the same scroll pane and keeps its formatting toolbar pinned');
  await page.getByRole('button',{name:'Release to queue',exact:true}).click();await until(async()=>!(await state(cryssa)).activity.length);
  assert.deepEqual(errors,[]);pass('No browser JavaScript errors');await writeFile(out+'/checks.json',JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'});throw error;}finally{await browser.close();}
