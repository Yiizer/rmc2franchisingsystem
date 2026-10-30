import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import ExcelJS from 'exceljs';

// Never target the working server: requests create records only in the isolated QA database.
const base='http://127.0.0.1:5190',out='test-results/workspace-advisors/controls';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[],external=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function login(name){const context=await browser.newContext({viewport:{width:1800,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(45000);assert.ok((await context.request.post(base+'/api/operations/login',{data:{email:name,password:'Rmc2Local!2026'}})).ok());return context;}
async function open(page,id){await navigate(page,'Inquiries');await page.getByLabel('Search inquiries').fill(id);await page.locator('.ops-inq-table tbody tr[role="link"]').filter({hasText:id}).click();await page.locator('.ops-workspace-id').filter({hasText:id}).waitFor();}
async function shot(page,name){await page.mouse.move(5,5);await page.screenshot({path:out+'/'+name+'.png',animations:'disabled'});}
try {
 const employee=await login('judy'),page=await employee.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&/^https?:/.test(r.url()))external.push(r.url());});
 const book=new ExcelJS.Workbook();await book.xlsx.load(await(await employee.request.get(base+'/api/operations/sample-form')).body());
 const company='Compact controls QA '+randomUUID().slice(0,8);
 for(const [cell,value] of Object.entries({B10:company,D14:company+' contact',B21:company+' contact',J10:'PRIVATE',J11:'Services',D22:'Total CorpoHealthCheck',G23:'Annual',D25:25,J24:0}))book.worksheets[0].getCell(cell).value=value;
 const intake=await employee.request.post(base+'/api/operations/intake',{multipart:{sender:'compact@example.test',file:{name:'compact.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())}}});assert.equal(intake.status(),201);const record=(await intake.json()).inquiry;
 await page.goto(base);await open(page,record.id);await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.locator('.ops-handling-you').waitFor();
 assert.ok(Number(await page.locator('.ops-handling-you').evaluate(e=>getComputedStyle(e).fontWeight))>=700);
 const newStatusColor=await page.locator('.ops-workspace-id .ops-badge').first().evaluate(e=>getComputedStyle(e).backgroundColor);
 assert.match(await page.locator('.ops-rail-details').innerText(),/\d{2}\/\d{2}\/\d{4}/);
 const handling=page.getByRole('region',{name:'Inquiry activity'});
 const doneBox=await handling.getByRole('button',{name:'Release to queue',exact:true}).boundingBox();
 const nextBox=await page.locator('.ops-main-action .primary').boundingBox();
 assert.ok(Math.abs(doneBox.width-nextBox.width)<1);
 assert.ok((await handling.getByRole('status').boundingBox()).y<doneBox.y);
 assert.equal(await page.locator('.ops-more-actions').count(),0);
 pass('Handling uses a separate status row and full-width action; dates display MM/DD/YYYY; More is absent');

 await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
 assert.equal(await page.getByRole('region',{name:'Suggested templates',exact:true}).count(),1);
 assert.equal(await page.getByRole('group',{name:'Filter by plan family'}).count(),0);
 assert.equal(await page.locator('.ops-advisor-result').count(),0);
 await page.locator('.ops-template-card').first().getByRole('button',{name:/^Select /}).click();
 const selected=await page.locator('.ops-template-card.selected').getAttribute('aria-label');
 await shot(page,'templates-default');
 const advisor=page.getByRole('region',{name:'AI template advisor',exact:true});
 const review=advisor.getByRole('button',{name:'Check selected template',exact:true});await review.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.notEqual(await review.evaluate(e=>getComputedStyle(e).outlineStyle),'none');await page.keyboard.press('Enter');
 await advisor.getByText('Matches known requirements',{exact:true}).waitFor();
 assert.equal(await page.locator('.ops-selected-template-summary strong').innerText(),selected);
 await page.getByRole('button',{name:'View all templates',exact:true}).click();
 assert.equal(await page.getByRole('group',{name:'Filter by plan family'}).locator('[aria-pressed=true]').innerText(),'Total CorpoHealthCheck');
 await page.getByRole('button',{name:'Back to suggestions',exact:true}).click();
 const suggested=page.getByRole('region',{name:'Suggested templates',exact:true}),grid=suggested.locator('.ops-template-grid');
 let sizes=await suggested.locator('.ops-template-card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));assert.equal(sizes.length,3);assert.ok(sizes.every(b=>Math.abs(b.y-sizes[0].y)<1&&Math.abs(b.height-sizes[0].height)<1));
 const buttonRows=await suggested.locator('.ops-template-card').evaluateAll(es=>es.map(e=>[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect().toJSON())));assert.ok(buttonRows.every(b=>Math.abs(b[0].y-b[1].y)<1&&b[2].y>b[0].y));
 await page.locator('.ops-workspace-templates').evaluate(e=>e.style.width='779px');assert.equal((await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns)).split(' ').length,1);
 await page.locator('.ops-workspace-templates').evaluate(e=>e.style.width='780px');assert.equal((await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns)).split(' ').length,3);
 await page.locator('.ops-workspace-templates').evaluate(e=>e.style.removeProperty('width'));await shot(page,'cards-desktop');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal((await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns)).split(' ').length,1);assert.ok((await suggested.locator('button').first().boundingBox()).height>=44);await shot(page,'cards-mobile');await page.setViewportSize({width:1800,height:1000});
 pass('Local suggestions appear by default; the AI review requires a keyboard/click request; three equal cards switch to one at 780px');
 await page.getByRole('button',{name:'Review form',exact:true}).click();await page.getByRole('button',{name:'Edit details',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'Requested coverage',exact:true}).click();await dialog.getByLabel('Requested plan',{exact:true}).fill('Total CorpoShield');await dialog.getByRole('button',{name:'Save details',exact:true}).click();
 await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();await page.getByText('Details or templates changed · review again',{exact:true}).waitFor();
 assert.equal(await page.locator('.ops-selected-template-summary strong').innerText(),selected);
 assert.ok((await suggested.locator('.ops-template-card').first().getAttribute('aria-label')).includes('CorpoShield'));
 const poll=page.waitForResponse(r=>r.url().includes('/api/operations/workspace?'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await poll;
 await page.getByText('Details or templates changed · review again',{exact:true}).waitFor();
 await advisor.getByRole('button',{name:'Review again',exact:true}).click();await advisor.getByText('Another template fits better',{exact:true}).waitFor();
 pass('Form edits refresh free suggestions but mark the explicit AI review outdated; polling never reviews or selects a template');
 // A catalog response is a read-only fixture; no template masters or source data are modified.
 let inject=true;
 const templates=(await(await employee.request.get(base+'/api/operations/bootstrap')).json()).templates;
 await page.route('**/api/operations/workspace?**',async route=>{const response=await route.fetch(),data=await response.json();if(inject){delete data.unchanged;data.templates=templates.map(t=>t.id==='d094'?{...t,sourceHash:'new-revision',name:'Total CorpoShield · Updated master with a long display name for layout review'}:t);}await route.fulfill({response,json:data});});
 const update=page.waitForResponse(r=>r.url().includes('/api/operations/workspace?'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await update;await page.getByText('Details or templates changed · review again',{exact:true}).waitFor();
 await advisor.getByRole('button',{name:'Review again',exact:true}).click();await page.getByText('Total CorpoShield · Standard. Preview this template for its benefits, rates and eligibility.',{exact:true}).waitFor();
 assert.equal(await page.locator('.ops-selected-template-summary strong').innerText(),selected);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(page,'catalog-updated');
 inject=false;await page.unroute('**/api/operations/workspace?**');
 pass('Catalog changes invalidate explicit reviews; unreviewed revisions use a safe family/variant description and long names wrap');
 await page.getByRole('button',{name:'Continue to preview',exact:true}).click();await page.locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:120000});console.log('Testing the editor footer');
 assert.notEqual(await page.locator('.ops-workspace-id .ops-badge').first().evaluate(e=>getComputedStyle(e).backgroundColor),newStatusColor);
 await page.getByRole('button',{name:'Change template',exact:true}).waitFor();assert.equal(await page.locator('.ops-more-actions').count(),0);
 await page.locator('.ops-doc-controls').getByText('AI proposal checker',{exact:true}).waitFor();
 assert.equal(await page.locator('.ops-proposal-checks').count(),0);assert.equal(await page.locator('.ops-workspace-rail').getByRole('button',{name:'Save changes',exact:true}).count(),0);
 const fields=page.getByRole('region',{name:'Proposal fields'}),controls=page.locator('.ops-doc-controls');
 await page.getByLabel('Client / addressee',{exact:true}).fill(company+' changed contact');assert.equal(await page.locator('.ops-proposal-checks').count(),0);
 await controls.getByRole('button',{name:'Check proposal details',exact:true}).click();await page.locator('.ops-check-values').getByText(company+' changed contact',{exact:true}).waitFor();
 await page.getByLabel('Client / addressee',{exact:true}).fill(company+' changed again');await page.getByText('Details changed · check again',{exact:true}).waitFor();assert.equal(await page.locator('.ops-check-values').count(),0);
 await controls.getByRole('button',{name:'Check again',exact:true}).click();await page.locator('.ops-check-values').getByText(company+' changed again',{exact:true}).waitFor();
 assert.equal(await page.locator('.ops-doc-document-area .ops-proposal-checks').count(),0);
 pass('Optional checks do not run on load or typing; explicit reruns compare current values and stale summaries hide old results');
 for(const viewport of [{width:1800,height:1000},{width:1600,height:650},{width:390,height:844}]){
   await page.setViewportSize(viewport);await controls.scrollIntoViewIfNeeded();
   const before=await controls.boundingBox();await fields.evaluate(e=>e.scrollTop=e.scrollHeight);const after=await controls.boundingBox();assert.ok(Math.abs(before.y-after.y)<1);
   const resultBox=await page.locator('.ops-doc-action-dock .ops-proposal-checks').boundingBox();assert.ok(resultBox.y>=0&&Math.abs(resultBox.y+resultBox.height-after.y)<2,'Check results stay immediately above the footer');
   assert.ok(after.y>=0&&after.y+after.height<=viewport.height,'Controls inside viewport');
   assert.ok((await controls.locator('button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height))).every(height=>height>=44),'Every footer action has a 44px target');
   const scroll=page.getByRole('region',{name:'Scrollable proposal document',exact:true});const pageTop=await page.evaluate(()=>scrollY);await scroll.evaluate(e=>e.scrollTop=500);assert.equal(await page.evaluate(()=>scrollY),pageTop);
   assert.equal(await controls.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(page,viewport.width===390?'editor-mobile':viewport.height===650?'editor-short':'editor-desktop');
 }
 pass('Field scrolling keeps Save/Update/Check stationary on desktop, short screens and mobile; PDF scrolling is independent');
 await page.setViewportSize({width:1800,height:1000});await controls.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('All changes saved · Preview needs updating',{exact:true}).waitFor();
 assert.equal(await controls.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true);await controls.getByRole('button',{name:'Update preview',exact:true}).click();await page.locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:120000});
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);pass('Saving and preview refresh work from the footer with no external AI calls or JavaScript errors');

 // Submitted checks must ignore working details and changed catalog masters.
 const supervisor=await login('emerson');
 const savedRecords=(await(await supervisor.request.get(base+'/api/operations/bootstrap')).json()).inquiries;
 const submitted=savedRecords.find(r=>r.fields.company.startsWith('Visual QA ')&&r.status==='Sent'&&r.submissions.length>=2);
 assert.ok(submitted,'Run test-workspace-upgrade-browser first to create a reviewed submission');
 await supervisor.route('**/api/operations/**',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const url=new URL(route.request().url());if(!url.pathname.endsWith('/workspace')&&!url.pathname.endsWith('/inquiries/'+submitted.id))return route.continue();
   const response=await route.fetch(),data=await response.json();
   if(data.templates)data.templates=data.templates.map(t=>({...t,sourceHash:'a-later-catalog-revision'}));
   for(const r of [data.current,data.inquiry])if(r?.id===submitted.id)r.fields={...r.fields,addressee:'WORKING DETAIL SHOULD NOT APPEAR'};
   await route.fulfill({response,json:data});
 });
 const sp=await supervisor.newPage();sp.on('pageerror',e=>errors.push(e.message));await sp.goto(base);await open(sp,submitted.id);await sp.getByRole('button',{name:'Preview & approval',exact:true}).click();
 assert.equal(await sp.locator('.ops-proposal-checks').count(),0);
 await sp.locator('.ops-saved-pdf-toolbar').getByRole('button',{name:'Check proposal details',exact:true}).click();
 const result=sp.getByRole('region',{name:'Proposal detail checks'});await result.getByText('Submitted version 2 · compared with the submitted form',{exact:true}).waitFor();
 assert.ok(!(await result.innerText()).includes('WORKING DETAIL SHOULD NOT APPEAR'));
 assert.ok(!(await result.innerText()).includes('Choose a proposal template'));
 await result.getByText('Form details checked. This saved master differs from the current catalog; refer to its original proposal for template rules.',{exact:true}).waitFor();
 await sp.getByRole('button',{name:/Activity & versions/}).click();await sp.getByRole('dialog').getByRole('button',{name:/^Version 1/}).click();
 const version=sp.getByRole('dialog');await version.getByRole('button',{name:'Check proposal details',exact:true}).click();await version.getByText('Submitted version 1 · compared with the submitted form',{exact:true}).waitFor();
 assert.ok(!(await version.locator('.ops-proposal-checks').innerText()).includes('WORKING DETAIL SHOULD NOT APPEAR'));
 await shot(sp,'submitted-version-check');assert.deepEqual(errors,[]);
 pass('Saved and historical checks use their submitted snapshots, never the working fields or a replacement master');
} finally {await writeFile(out+'/checks.json',JSON.stringify(checks,null,2));await writeFile(out+'/errors.json',JSON.stringify(errors,null,2));await browser.close();}
