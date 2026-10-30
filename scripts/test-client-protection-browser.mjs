import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base='http://127.0.0.1:5190',out='test-results/client-protection';
const fixture=JSON.parse(await readFile(out+'/checks.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.RMC2_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1510,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(30000);
const errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function open(id){
  await navigate(page,'Inquiries');
  await page.locator('tr[role="link"]').filter({hasText:id}).click();
  await page.locator('.ops-workspace-id').filter({hasText:id}).waitFor();
}
try{
  assert.ok((await context.request.post(base+'/api/operations/login',{data:{email:'cryssa@rmc2.local',password:'Rmc2Local!2026'}})).ok());
  await page.goto(base);await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  await open(fixture.records.original);
  const protection=page.getByRole('region',{name:'Agent client protection'});
  await protection.getByRole('timer',{name:'28 days of client protection remaining'}).waitFor();
  await page.screenshot({path:out+'/countdown-desktop.png'});
  pass('Workspace displays the agent and a visual 30-day countdown');
  await protection.getByRole('button',{name:'Record progress report',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Record the agent’s progress report'});
  const sentAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(Date.now()-3600000).replace(' ','T');
  await dialog.getByLabel('Sent date and time (Manila)',{exact:true}).fill(sentAt);
  await dialog.getByLabel('Email subject / report reference',{exact:true}).fill('Browser verified progress report');
  await dialog.getByLabel('Progress summary',{exact:true}).fill('The registered agent confirmed the next client discussion and documentation schedule.');
  await dialog.getByRole('button',{name:'Record report & reset timer',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await protection.getByRole('timer',{name:'30 days of client protection remaining'}).waitFor();
  await protection.locator('summary').filter({hasText:'2 progress reports'}).click();
  await protection.getByText('Browser verified progress report',{exact:true}).waitFor();
  pass('Recording a progress report updates the countdown and visible history');

  await open(fixture.records.duplicate);
  const duplicate=page.getByRole('region',{name:'Duplicate client review'});
  await duplicate.getByRole('heading',{name:'Duplicate client · processing paused',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start handling',exact:true}).count(),0);
  await page.screenshot({path:out+'/duplicate-desktop.png'});
  await duplicate.locator('article').filter({hasText:fixture.records.original}).getByRole('button',{name:'Open existing inquiry',exact:true}).click();
  await page.locator('.ops-workspace-id').filter({hasText:fixture.records.original}).waitFor();
  pass('Duplicate warnings block preparation and open the existing inquiry directly');

  await navigate(page,'Archives');
  await page.getByRole('heading',{name:'Archives',exact:true}).waitFor();
  const archived=page.locator('tr[role="link"]').filter({hasText:fixture.records.archived});
  await archived.getByText('Expired · archived',{exact:true}).waitFor();
  await page.screenshot({path:out+'/archives-desktop.png'});
  await archived.click();await page.getByRole('timer',{name:'Client protection expired',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Record progress report',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Start handling',exact:true}).count(),0);
  pass('Archives retains expired inquiries with a read-only expired indicator');

  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('aside.ops-sidebar').getBoundingClientRect().right<=1);
  await page.screenshot({path:out+'/archives-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile archive detail should fit the viewport');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await navigate(page,'Inquiries');
  await page.waitForFunction(()=>document.querySelector('aside.ops-sidebar').getBoundingClientRect().right<=1);
  await page.locator('tr[role="link"]').filter({hasText:fixture.records.duplicate}).click();
  await page.getByRole('region',{name:'Duplicate client review'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile duplicate warning should fit the viewport');
  await page.screenshot({path:out+'/duplicate-mobile.png'});
  pass('Countdown, duplicate warnings and archive details remain usable on phones');
  assert.deepEqual(errors,[]);pass('No client JavaScript errors');
  await writeFile(out+'/browser-checks.json',JSON.stringify({checks,errors},null,2));
}catch(error){await page.screenshot({path:out+'/browser-failure.png'});throw error;}finally{await browser.close();}
