import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';

// Only the separate QA server/database may be used for these fictional records.
const base='http://127.0.0.1:5190',out='test-results/workspace-upgrade/pagination-browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const database=new DatabaseSync('test-results/workspace-upgrade/qa-data/rmc2.sqlite');
database.exec('PRAGMA busy_timeout=5000');
const prefix='PAGING-'+Date.now(),created=[],notices=[],checks=[],errors=[],requests=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const save=record=>database.prepare('UPDATE inquiries SET revision=?,data=? WHERE id=?').run(++record.revision,JSON.stringify(record),record.id);
const read=id=>JSON.parse(database.prepare('SELECT data FROM inquiries WHERE id=?').get(id).data);
try{
  const seed=JSON.parse(database.prepare('SELECT data FROM inquiries LIMIT 1').get().data);
  for(let i=0;i<65;i++){
    const id=prefix+'-'+String(i).padStart(3,'0'),at=new Date(Date.now()+i*1000).toISOString();
    const record={...structuredClone(seed),id,revision:1,status:'New inquiry',createdAt:at,updatedAt:at,
      fields:{...seed.fields,company:id,contactName:'Person '+id,addressee:'Person '+id,division:'Division 1',agentName:'Original QA agent',agentEmail:'original@example.test'},
      templateId:'',handledBy:[],history:[],submissions:[],chat:[],detailRequests:[],emailOverrides:[],notes:'',returnNote:'',returnFlags:[],
      generated:undefined,customization:undefined,supervisorEdit:undefined,workProgress:undefined,closure:undefined,protection:undefined,clientReview:undefined,progressReports:undefined,bor:undefined};
    record.source={...seed.source,kind:'attachment',filename:'qa.xlsx',storage:'',sourceHash:id,cells:[],fields:{...record.fields}};
    database.prepare('INSERT INTO inquiries VALUES (?,?,?)').run(id,1,JSON.stringify(record));created.push(id);
  }
  const original=read(created[0]),duplicate=read(created[64]);
  duplicate.fields={...duplicate.fields,company:original.fields.company,contactName:original.fields.contactName,addressee:original.fields.addressee,agentName:'Incoming QA agent',agentEmail:'incoming@example.test'};
  duplicate.source.fields={...duplicate.fields};save(duplicate);
  for(let i=0;i<55;i++){
    const id=randomUUID(),notice={id,inquiryId:original.id,title:prefix+' notice '+i,message:'Paging test notice',at:new Date(Date.now()+100000+i).toISOString(),recipientIds:['jefferson','emerson'],readBy:[]};
    database.prepare('INSERT INTO notifications VALUES (?,?)').run(id,JSON.stringify(notice));notices.push(id);
  }
  const context=await browser.newContext({viewport:{width:1536,height:960}});context.setDefaultTimeout(20000);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/operations/'))requests.push(r.url());});
  await page.goto(base);await page.getByRole('heading',{name:'Welcome back'}).waitFor();
  await page.getByLabel('Username or email').fill('jefferson');await page.getByLabel('Password',{exact:true}).fill('Rmc2Local!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  pass('An unauthenticated session reaches sign-in and loads the workspace after login');
  await navigate(page,'Inquiries');await page.getByRole('navigation',{name:'Inquiries pages'}).waitFor();
  await page.getByLabel('Search inquiries').fill(prefix);
  await page.getByText('1–25 of 65',{exact:true}).waitFor();assert.equal(await page.locator('.ops-inq-table tbody tr').count(),25);
  const first=await page.locator('.ops-inq-table tbody tr').first().innerText();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('26–50 of 65',{exact:true}).waitFor();assert.notEqual(await page.locator('.ops-inq-table tbody tr').first().innerText(),first);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('51–65 of 65',{exact:true}).waitFor();assert.equal(await page.locator('.ops-inq-table tbody tr').count(),15);
  pass('Inquiry paging shows 25, 25 and 15 records with correct totals and distinct rows');
  await page.getByLabel('Search inquiries').fill('no match');await page.getByLabel('Search inquiries').fill(created[1]);await page.getByText('1–1 of 1',{exact:true}).waitFor();await page.getByRole('link',{name:'Open '+created[1],exact:true}).waitFor();
  pass('Search finds records beyond the current page and resets paging after a query change');
  await page.getByRole('link',{name:'Open '+created[1],exact:true}).click();await page.getByRole('heading',{name:created[1],exact:true}).waitFor();
  let edited=read(created[1]);edited.fields.company='Colleague updated '+prefix;save(edited);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:edited.fields.company,exact:true}).waitFor();
  const idle=page.waitForResponse(async response=>response.url().includes('/workspace?')&&response.ok()&&(await response.json()).unchanged===true);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));const idleResponse=await idle;assert.ok((await idleResponse.body()).length<150);
  pass('An open inquiry receives colleague changes; the next unchanged refresh uses a tiny response');
  await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByRole('button',{name:'Edit details',exact:true}).click();
  const company=page.getByRole('dialog').getByLabel('Account name',{exact:true});await company.fill('Unsaved local draft');
  edited=read(created[1]);edited.fields.company='Second colleague update '+prefix;save(edited);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('A colleague updated this inquiry.',{exact:true}).waitFor();assert.equal(await company.inputValue(),'Unsaved local draft');assert.ok(await page.getByRole('dialog').getByRole('button',{name:'Save details',exact:true}).isDisabled());
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Reload latest',exact:true}).click();await page.getByRole('heading',{name:edited.fields.company,exact:true}).waitFor();
  pass('Colleague updates preserve unsaved input and require reloading before a conflicting save');
  await navigate(page,'Inquiries');await page.getByLabel('Search inquiries').fill(created[64]);await page.getByText('1–1 of 1',{exact:true}).waitFor();await page.getByRole('link',{name:'Open '+original.fields.company,exact:true}).click();
  await page.getByRole('button',{name:'Verify BOR & transfer',exact:true}).click();await page.getByText('Original QA agent → Incoming QA agent',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Open existing inquiry',exact:false}).click();await page.getByRole('button',{name:'Start handling',exact:true}).waitFor();assert.ok((await page.locator('.ops-main').innerText()).includes(original.id));
  pass('Duplicate links and BOR checks load the existing inquiry even when it is on another page');
  await page.getByRole('button',{name:'Notifications',exact:true}).first().click();await page.getByRole('navigation',{name:'Notifications pages'}).waitFor();assert.equal(await page.locator('.ops-notice').count(),25);await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of',{exact:false}).waitFor();assert.equal(await page.locator('.ops-notice').count(),25);
  await page.getByRole('button',{name:'Mark all as read',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Mark all as read'&&button.disabled));
  assert.equal(database.prepare("SELECT count(*) AS n FROM notice_recipients WHERE user_id='jefferson' AND is_read=0").get().n,0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM notice_recipients WHERE user_id='emerson' AND is_read=0 AND notice_id IN ("+notices.map(()=>'?').join(',')+")").get(...notices).n,55);
  await page.locator('.ops-notice').first().click();await page.getByRole('heading',{name:original.fields.company,exact:true}).waitFor();
  pass('Notification pages open off-page inquiries; mark-all covers every page without changing another staff member’s read state');
  await navigate(page,'Inquiries');await page.getByLabel('Search inquiries').fill(prefix);await page.getByText('1–25 of 65',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile-pagination.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1536,height:960});await page.screenshot({path:out+'/inquiries.png',fullPage:true});
  assert.ok(!requests.some(url=>url.endsWith('/bootstrap')));assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Welcome back'}).waitFor();
  pass('Mobile paging fits, normal browser flows never request the full archive, and logout clears the workspace');
}finally{
  await browser.close();
  for(const id of notices)database.prepare('DELETE FROM notifications WHERE id=?').run(id);
  for(const id of created){database.prepare('DELETE FROM inquiry_activity WHERE inquiry_id=?').run(id);database.prepare('DELETE FROM inquiries WHERE id=?').run(id);}
  database.close();await writeFile(out+'/checks.json',JSON.stringify({checks,errors},null,2));
}
