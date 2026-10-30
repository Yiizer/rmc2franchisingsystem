import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import ExcelJS from 'exceljs';

// Run against the isolated ui-workspace QA server, never the working database.
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5190',out=process.env.TEST_RESULT_ROOT||'test-results/workspace-advisors/browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function login(email){const context=await browser.newContext({viewport:{width:1536,height:1050},reducedMotion:'reduce'});context.setDefaultTimeout(30000);assert.ok((await context.request.post(base+'/api/operations/login',{data:{email,password:'Rmc2Local!2026'}})).ok());return context;}
async function open(page,id,view='Inquiries'){
  await navigate(page,view);
  await page.getByLabel('Search inquiries').fill(id);
  await page.locator('.ops-inq-table tbody tr[role="link"]').filter({hasText:id}).click();
  await page.locator('.ops-workspace-id').filter({hasText:id}).waitFor();
}
try{
  const employee=await login('jefferson'),supervisor=await login('emerson');
  const sample=await(await employee.request.get(base+'/api/operations/sample-form')).body();
  const company='[TEST] Workspace layout QA '+randomUUID();
  async function intake(agent,sender){
    const book=new ExcelJS.Workbook();await book.xlsx.load(sample);const sheet=book.worksheets[0];
    for(const [cell,value] of Object.entries({B10:company,D14:company+' contact',B21:company+' contact',C7:agent,J10:'PRIVATE',J11:'Services',D22:'Total CorpoHealthCheck',G23:'Annual',D25:25,J24:0,C26:'25–55'}))sheet.getCell(cell).value=value;
    const response=await employee.request.post(base+'/api/operations/intake',{multipart:{sender,file:{name:'workspace-layout-qa.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())}}});
    assert.equal(response.status(),201);return (await response.json()).inquiry;
  }
  const original=await intake('Original QA agent','original-layout@example.test'),duplicate=await intake('Incoming QA agent','incoming-layout@example.test');
  assert.equal(duplicate.clientReview.state,'duplicate');
  const page=await employee.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await open(page,duplicate.id);
  const hold=page.getByRole('region',{name:'Duplicate client review'});
  await hold.getByRole('link',{name:'Open existing inquiry',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start handling',exact:true}).count(),0);
  assert.equal(await hold.getByRole('button',{name:'Review matching details',exact:true}).count(),0);
  await hold.getByRole('button',{name:'Recheck availability',exact:true}).click();
  await page.getByText('This submission is still on hold',{exact:true}).waitFor();
  await hold.getByRole('button',{name:'Transfer with BOR',exact:true}).click();
  const bor=page.getByRole('dialog',{name:'Verify BOR and transfer client'});
  await bor.getByText('Original QA agent → Incoming QA agent',{exact:true}).waitFor();
  assert.equal(await bor.getByRole('button',{name:'Request supervisor approval',exact:true}).isDisabled(),true);
  await bor.getByRole('button',{name:'Cancel',exact:true}).click();
  await hold.getByRole('button',{name:'Suggested step Decline request',exact:true}).click();
  const decline=page.getByRole('dialog',{name:'Decline and archive request'});
  await decline.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.locator('.ops-main-action').count(),0);
  await page.getByRole('region',{name:'Next action',exact:true}).getByRole('button',{name:'Open existing inquiry',exact:true}).waitFor();
  assert.ok(await hold.locator('.ops-client-comparison tr.matched').count()>=2);
  pass('Duplicate actions open the correct review, BOR, and decline flows while preparation stays locked');

  const sp=await supervisor.newPage();sp.on('pageerror',e=>errors.push(e.message));await sp.goto(base);await open(sp,duplicate.id);
  await sp.getByRole('region',{name:'Duplicate client review'}).getByRole('button',{name:'Confirm different clients',exact:true}).click();
  const review=sp.getByRole('dialog',{name:'Review matching client details'});
  assert.equal(await review.getByRole('button',{name:'Confirm different clients',exact:true}).isDisabled(),true);
  await review.getByRole('button',{name:'Close dialog',exact:true}).click();
  await sp.locator('.ops-client-comparison').getByRole('cell',{name:company+' contact',exact:true}).nth(1).waitFor();
  await sp.screenshot({path:out+'/duplicate-review-desktop.png',animations:'disabled'});
  pass('Supervisors retain the separate-client review with required confirmation');

  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.ops-sidebar').getBoundingClientRect().right<=1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/duplicate-review-mobile.png',animations:'disabled'});
  await hold.getByRole('button',{name:'Transfer with BOR',exact:true}).scrollIntoViewIfNeeded();
  const box=await hold.getByRole('button',{name:'Transfer with BOR',exact:true}).boundingBox();assert.ok(box.height>=44);
  assert.equal(await page.locator('.ops-main-action').count(),0);
  pass('Mobile workflow fits the screen, hides the closed navigation, and keeps actions touch sized');

  await page.setViewportSize({width:1536,height:1050});await hold.getByRole('link',{name:'Open existing inquiry',exact:true}).click();
  await page.locator('.ops-workspace-id').filter({hasText:original.id}).waitFor();await page.getByRole('button',{name:'Review form',exact:true}).click();
  await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByText('Handling: you',{exact:true}).waitFor();
  const form=page.locator('.ops-ws-summary');await form.getByRole('button',{name:'Request missing details',exact:true}).click();
  await page.getByRole('dialog').getByRole('heading',{name:/Request missing details/}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'View submitted form',exact:true}).click();await page.getByRole('dialog',{name:'Agent submitted form'}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.screenshot({path:out+'/form-review.png',animations:'disabled'});
  pass('Form follow-up and original attachment are accessible from the form review section');

  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  assert.equal(await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).getAttribute('aria-current'),'step');
  assert.equal(await page.getByRole('region',{name:'Suggested templates',exact:true}).count(),1);
  const template=page.locator('.ops-template-card').first();
  await template.getByRole('button',{name:/^Select /}).click();
  assert.equal(await page.locator('.ops-simple-workspace').getAttribute('data-stage'),'1');
  assert.equal(await template.getByRole('button',{name:/^Selected /}).getAttribute('aria-pressed'),'true');
  assert.equal(await template.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(239, 249, 243)');
  assert.equal(await page.locator('.ops-template-card.selected').count(),1);
  await page.getByRole('button',{name:'View all templates',exact:true}).click();
  const filters=page.getByRole('group',{name:'Filter by plan family'});
  await filters.getByRole('button',{name:/BureauHealth 7K/}).click();
  const library=page.locator('#workspace-template-library');
  assert.ok((await library.locator('.ops-template-card').allTextContents()).every(text=>text.includes('BureauHealth 7K')));
  const alternative=library.locator('.ops-template-card').first();await alternative.getByRole('button',{name:/^Select /}).click();
  assert.equal(await page.locator('.ops-template-card.selected').count(),1);
  assert.ok(await alternative.evaluate(el=>el.classList.contains('selected')));
  assert.equal(await page.locator('.ops-simple-workspace').getAttribute('data-stage'),'1');
  await alternative.getByRole('button',{name:/^Preview /}).click();await page.getByRole('dialog').locator('.ops-doc-preview[aria-busy="false"]').waitFor({timeout:120000});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Back to suggestions',exact:true}).click();await template.getByRole('button',{name:/^Select /}).click();
  await page.screenshot({path:out+'/template-cards-desktop.png',animations:'disabled',fullPage:true});
  pass('Cards keep selection on this step, show green selection, filter the library, preview other plans, and show local suggestions by default');

  await sp.getByRole('button',{name:'Back to inquiries',exact:true}).click();await open(sp,original.id);await sp.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  await sp.getByText('View only until they release it.',{exact:true}).waitFor();
  assert.equal(await sp.locator('.ops-template-card .ops-select-template').first().isDisabled(),true);
  assert.equal(await sp.locator('.ops-template-card .ops-customize-template').first().isDisabled(),true);
  assert.equal(await sp.locator('.ops-template-card').first().getByRole('button',{name:/^Preview /}).isEnabled(),true);
  await sp.getByRole('button',{name:'Back to inquiries',exact:true}).click();
  pass('A colleague can preview cards but cannot select or customize while the inquiry is handled');

  await page.bringToFront();await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.ops-sidebar').getBoundingClientRect().right<=1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal((await page.locator('.ops-template-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns)).split(' ').length,1);
  const touch=await template.getByRole('button',{name:/^Preview /}).boundingBox();assert.ok(touch.height>=44);
  await page.screenshot({path:out+'/template-cards-mobile.png',animations:'disabled',fullPage:true});
  await page.setViewportSize({width:1536,height:1050});
  await page.getByRole('button',{name:'Continue to preview',exact:true}).click();
  const prepare=page.getByRole('region',{name:'Next action'});
  assert.equal(await prepare.getByRole('button',{name:'Send to supervisor',exact:true}).count(),0);
  assert.equal(await prepare.getByRole('button',{name:'Prepare PDF & email',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('.ops-proposal-checks').count(),0);
  const check=page.getByRole('button',{name:'Check proposal details',exact:true});
  await check.click();
  assert.equal(await page.locator('.ops-doc-fields .ops-proposal-checks').count(),1);
  await page.getByLabel('Client / addressee',{exact:true}).fill('Corrected client QA');
  await page.getByText('Details changed · check again',{exact:true}).waitFor();
  assert.equal(await page.locator('.ops-checks-summary.matched').count(),0);
  await page.getByRole('button',{name:'Check again',exact:true}).click();
  await page.locator('.ops-check-values').getByText('Corrected client QA',{exact:true}).waitFor();
  await page.getByLabel('Client / addressee',{exact:true}).fill('');
  assert.equal(await prepare.getByRole('button',{name:'Prepare PDF & email',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Check again',exact:true}).click();
  await page.locator('.ops-check-item.error').getByText('Complete before preparing',{exact:true}).waitFor();
  await page.getByLabel('Client / addressee',{exact:true}).fill(original.fields.addressee);
  await page.getByRole('button',{name:'Check again',exact:true}).click();
  await page.locator('.ops-checks-summary.matched').waitFor();
  await page.getByRole('button',{name:/Activity & versions/}).click();await page.getByRole('dialog',{name:'Activity & versions'}).waitFor();await page.keyboard.press('Escape');
  assert.ok((await page.locator('.ops-app').evaluate(el=>getComputedStyle(el).fontFamily)).includes('plex'));
  await page.screenshot({path:out+'/prepare-and-submit.png',animations:'disabled'});
  pass('Requested proposal checks flag stale edits, show original and working values, gate preparation, and keep the PDF separate');

  await page.getByRole('button',{name:'Back to inquiries',exact:true}).click();await open(page,duplicate.id);
  await page.getByRole('button',{name:'Review form',exact:true}).click();await page.getByRole('region',{name:'Duplicate client review'}).getByRole('button',{name:/^(Suggested step )?Decline request$/}).click();
  await page.getByRole('dialog').getByLabel('Reason for declining').fill('Confirmed this is the same client and the original registration remains valid.');
  await page.getByRole('dialog').getByRole('button',{name:'Decline & archive',exact:true}).click();await page.getByRole('heading',{name:'Request declined · Archived',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to inquiries',exact:true}).click();await open(page,duplicate.id,'Archives');
  await page.getByRole('heading',{name:'Request declined · Archived',exact:true}).waitFor();
  pass('Declining an unavailable duplicate moves it to Archives with its original inquiry link retained');
  assert.deepEqual(errors,[]);pass('No browser errors in the redesigned workflow');
}finally{await writeFile(out+'/checks.json',JSON.stringify(checks,null,2));await writeFile(out+'/errors.json',JSON.stringify(errors,null,2));await browser.close();}

