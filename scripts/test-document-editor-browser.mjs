import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir,writeFile } from 'node:fs/promises';

const base=process.env.RMC2_TEST_URL||'http://127.0.0.1:5190';
if(!base.includes(':5190'))throw new Error('Use the isolated 5190 test instance for editor tests.');
const browser=await chromium.launch({executablePath:process.env.RMC2_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
await mkdir('test-results',{recursive:true});
async function login(context,user='cryssa'){
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.getByLabel('Staff account').selectOption(user+'@rmc2.local');await page.getByLabel('Password',{exact:true}).fill('Rmc2Local!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();return page;
}
async function open(page,company){await navigate(page,'Inquiries');await page.getByRole('link',{name:'Open '+company,exact:true}).click();await page.getByRole('button',{name:/Prepare proposal/}).click();}
async function preview(page){await page.locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:90000});await page.locator('.ops-doc-text-layer').first().getByText('RMC2',{exact:false}).first().waitFor({timeout:20000}).catch(()=>{});assert.ok(await page.locator('.ops-doc-paper canvas').count()>1);assert.equal(await page.locator('.ops-doc-preview [role="alert"]').count(),0);}
try{
  let company='Meridian Packaging Co.';
  if(!process.argv.includes('--mobile-only')){
  const context=await browser.newContext({viewport:{width:1540,height:980}});context.setDefaultTimeout(90000);const page=await login(context);
  const unauth=await browser.newContext();assert.equal((await unauth.request.post(base+'/api/operations/proposal-preview',{data:{templateId:'d023',fields:{}}})).status(),401);await unauth.close();pass('Template preview is private');
  const before=(await (await context.request.get(base+'/api/operations/bootstrap')).json()).inquiries;
  const partial=await context.request.post(base+'/api/operations/proposal-preview',{timeout:120000,data:{templateId:'d023',fields:{}}});assert.equal(partial.status(),200);assert.ok((await partial.body()).subarray(0,5).toString()==='%PDF-');pass('Incomplete form can preview the original layout without fabricated values');
  assert.equal((await context.request.post(base+'/api/operations/proposal-preview',{data:{templateId:'d023',fields:{inventedBenefit:'free care'}}})).status(),400);
  assert.equal((await context.request.post(base+'/api/operations/proposal-preview',{headers:{Origin:'https://unrelated.example'},data:{templateId:'d023',fields:{}}})).status(),403);pass('Unsupported terms and cross-origin preview requests are rejected');
  const after=(await (await context.request.get(base+'/api/operations/bootstrap')).json()).inquiries;assert.deepEqual(after,before);pass('Opening a preview does not change handlers, saved inquiries or audit history');
  const sample=await context.request.get(base+'/api/operations/sample-form');
  const imported=await context.request.post(base+'/api/operations/intake',{multipart:{sender:'agent.document-editor@example.com',file:{name:'document-editor-franchise-form.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await sample.body()}}});assert.equal(imported.status(),201);
  const incoming=(await imported.json()).inquiry;company='Document editor test '+Date.now();
  const saved=await context.request.post(base+'/api/operations/inquiries/'+incoming.id+'/save',{data:{revision:incoming.revision,fields:{...incoming.fields,company},templateId:'d024',notes:'Document editor test',email:incoming.email,emailOverrides:[]}});assert.equal(saved.status(),200);
  await page.reload();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  await open(page,company);
  await page.getByRole('button',{name:'Preview & fill proposal',exact:true}).click();await preview(page);
  assert.equal(await page.getByLabel('Account name',{exact:true}).inputValue(),company);
  assert.ok(await page.locator('.ops-doc-text-layer').filter({hasText:company}).count()>=1);assert.equal(await page.getByLabel('Client / addressee',{exact:true}).inputValue(),incoming.source.fields.addressee);pass('Original pages appear with the actual submitted Excel values filled in');
  await page.screenshot({path:'test-results/document-editor-desktop.png'});
  const scrolls=await page.getByRole('dialog').evaluate(dialog=>[dialog,...dialog.querySelectorAll('*')].filter(element=>['auto','scroll'].includes(getComputedStyle(element).overflowY)&&element.scrollHeight>element.clientHeight+3).map(element=>element.className));assert.equal(scrolls.length,1,JSON.stringify(scrolls));pass('Editor has one vertical scroll area');
  await page.getByLabel('Client / addressee',{exact:true}).fill('Document Editor Test Client');await preview(page);await page.locator('.ops-doc-text-layer').filter({hasText:'Document Editor Test Client'}).first().waitFor();pass('Text-box changes appear in the formatted proposal');
  await page.locator('.ops-doc-field').filter({hasText:'Client / addressee'}).getByRole('button',{name:'Use submitted form value',exact:true}).click();await preview(page);await page.waitForFunction(()=>![...document.querySelectorAll('.ops-doc-text-layer')].some(layer=>layer.textContent.includes('Document Editor Test Client')));pass('Edited fields can be restored from the submitted form');
  await page.getByRole('button',{name:'View original master',exact:true}).click();await preview(page);assert.ok((await page.locator('.ops-doc-text-layer').allTextContents()).join('').includes('[Date]'));pass('Unfilled original master is available with its full design');
  await page.getByRole('button',{name:'Show filled proposal',exact:true}).click();await preview(page);
  await page.getByLabel('Agent name',{exact:true}).fill('Editor Test Agent');await preview(page);await page.getByRole('button',{name:'Save proposal details',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const state=await (await context.request.get(base+'/api/operations/bootstrap')).json(),record=state.inquiries.find(record=>record.id===incoming.id);assert.equal(record.fields.agentName,'Editor Test Agent');assert.ok(record.email.body.includes('Editor Test Agent'));assert.ok(record.history.at(-1).at);assert.deepEqual(record.source,incoming.source);pass('Saving updates proposal inputs, automatic email and timestamped history');
  await page.getByRole('button',{name:'Generate proposal',exact:true}).click();await page.getByRole('button',{name:'Send to supervisor for approval',exact:true}).waitFor({timeout:90000});pass('Saved editor fields generate a proposal ready for approval');
  }
  const mobileContext=await browser.newContext({viewport:{width:390,height:844}});const phone=await login(mobileContext);await phone.getByRole('button',{name:'Open navigation',exact:true}).click();await open(phone,company);await phone.getByRole('button',{name:'Preview & fill proposal',exact:true}).click();await preview(phone);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);const paper=phone.locator('.ops-doc-paper').first();assert.ok(await paper.evaluate(element=>element.getBoundingClientRect().width<350));await phone.getByLabel('Client / addressee',{exact:true}).fill('Phone Preview Client');await preview(phone);await phone.locator('.ops-doc-text-layer').filter({hasText:'Phone Preview Client'}).first().waitFor();await phone.screenshot({path:'test-results/document-editor-mobile.png'});pass('Phone editor fits and live preview works');
  await phone.getByRole('button',{name:'Close dialog',exact:true}).click();await mobileContext.close();
  assert.deepEqual(errors,[]);pass('No browser JavaScript errors');await writeFile('test-results/document-editor-browser.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
