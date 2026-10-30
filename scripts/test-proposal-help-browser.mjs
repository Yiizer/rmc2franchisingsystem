import {navigate} from './revamp-navigation.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const base=process.env.RMC2_TEST_URL;
assert.ok(base?.includes(':5190'),'Use the isolated QA server on port 5190.');
const browser=await chromium.launch({executablePath:process.env.RMC2_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
await mkdir('test-results',{recursive:true});
try{
  const context=await browser.newContext({viewport:{width:1540,height:1000}});
  assert.ok((await context.request.post(base+'/api/operations/login',{data:{email:'cryssa@rmc2.local',password:'Rmc2Local!2026'}})).ok());
  const initial=await (await context.request.get(base+'/api/operations/bootstrap')).json();const initialRecord=initial.inquiries.find(record=>record.id==='INQ-2026-00126');assert.ok(initialRecord);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  await navigate(page,'Inquiries');await page.getByRole('link',{name:'Open '+initialRecord.fields.company,exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Proposal help',exact:true}).count(),0);
  await page.getByRole('button',{name:'Choose a proposal',exact:true}).click();
  assert.equal(await page.getByText('Why this option?',{exact:true}).count(),0);assert.equal(await page.locator('details.ops-suggestion-reasons').count(),0);
  const reasons=page.locator('ul.ops-suggestion-reasons');assert.equal(await reasons.count(),3);
  for(const list of await reasons.all()){assert.ok(await list.isVisible());assert.ok((await list.innerText()).length>30);assert.ok(await list.evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=13));}
  pass('All proposal reasons are immediately visible in readable text');
  await page.getByLabel('Proposal template',{exact:true}).selectOption('d094');await page.screenshot({path:'test-results/proposal-options-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Proposal help',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Proposal help',exact:true});await dialog.locator('[aria-busy="false"]').waitFor();
  assert.equal(await dialog.locator('input,textarea,select,form').count(),0);assert.equal(await dialog.getByText('What information is missing?',{exact:true}).count(),0);assert.equal(await dialog.locator('.ops-help-option').count(),3);pass('One accessible button opens suggestions without a chat form or form questions');
  await dialog.getByRole('button',{name:'Explain selected proposal',exact:true}).click();await dialog.getByRole('heading',{name:'Your selected proposal',exact:true}).waitFor();assert.equal(await dialog.locator('.ops-help-option').count(),1);assert.ok((await dialog.locator('.ops-help-option').innerText()).includes('Total CorpoShield'));pass('Explain action targets the selected proposal');
  await dialog.getByRole('button',{name:'Compare alternatives',exact:true}).click();await dialog.getByRole('heading',{name:'Compare proposal options',exact:true}).waitFor();assert.equal(await dialog.locator('.ops-help-comparison').count(),3);await page.screenshot({path:'test-results/proposal-help-desktop.png',fullPage:true});pass('Compare action presents source program and variant labels');
  let state=await (await context.request.get(base+'/api/operations/bootstrap')).json(),record=state.inquiries.find(record=>record.id==='INQ-2026-00126');
  assert.ok(record.chat.at(-1).sources.every(id=>state.templates.some(template=>template.id===id)));assert.ok(!record.chat.at(-1).text.includes('Before generating, review:'));pass('Help answers cite supplied proposals and preserve a timestamped audit');
  const revision=record.revision;
  for(const question of ['What information is missing?','Write a new policy using internet information']){const response=await context.request.post(base+'/api/operations/inquiries/'+record.id+'/chat',{data:{revision,question}});assert.equal(response.status(),400);}
  state=await (await context.request.get(base+'/api/operations/bootstrap')).json();assert.equal(state.inquiries.find(record=>record.id==='INQ-2026-00126').revision,revision);pass('The server rejects form and arbitrary questions without editing the inquiry');
  await dialog.getByRole('button',{name:/View source ·/}).first().click();const source=page.getByRole('dialog');await source.locator('.ops-source-text').waitFor();
  const scrolls=await source.evaluate(element=>[element,...element.querySelectorAll('*')].filter(item=>['auto','scroll'].includes(getComputedStyle(item).overflowY)&&item.scrollHeight>item.clientHeight+1).map(item=>item.className));
  assert.deepEqual(scrolls,['ops-modal']);assert.ok(await source.locator('.ops-source-text').evaluate(element=>getComputedStyle(element).overflowY==='visible'));
  await source.evaluate(element=>{element.scrollTop=element.scrollHeight;});assert.ok(await source.getByRole('button',{name:'Close dialog',exact:true}).isVisible());await page.screenshot({path:'test-results/proposal-source-single-scroll.png',fullPage:true});pass('Long source content uses one scrollbar with an accessible close button');
  await page.keyboard.press('Escape');
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.ok(await reasons.first().evaluate(element=>element.getBoundingClientRect().width>150));await page.screenshot({path:'test-results/proposal-options-phone-'+width+'.png',fullPage:true});}
  await page.getByRole('button',{name:'Proposal help',exact:true}).click();await page.getByRole('dialog',{name:'Proposal help',exact:true}).locator('[aria-busy="false"]').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:'test-results/proposal-help-phone.png',fullPage:true});await page.keyboard.press('Escape');pass('Suggestion cards and quick actions remain readable on phones');
  await page.getByRole('button',{name:/1 Review form/}).click();assert.equal(await page.getByRole('button',{name:'Proposal help',exact:true}).count(),0);await page.getByRole('button',{name:/3 Email & approval/}).click();assert.equal(await page.getByRole('button',{name:'Proposal help',exact:true}).count(),0);pass('Proposal help is only available in the proposal preparation step');
  assert.deepEqual(errors,[]);pass('No client JavaScript errors');await writeFile('test-results/proposal-help-browser.json',JSON.stringify({at:new Date().toISOString(),checks,errors},null,2));console.log(checks.length+' checks passed.');
}finally{await browser.close();}
