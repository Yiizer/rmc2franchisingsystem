import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:5190';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:720}});context.setDefaultTimeout(120000);
try{
  const page=await context.newPage();let previewRequests=0;
  page.on('request',request=>{if(request.url().endsWith('/proposal-preview'))previewRequests++;});
  await page.goto(base);await page.getByLabel('Staff account').selectOption('cryssa@rmc2.local');await page.getByLabel('Password',{exact:true}).fill('Rmc2Local!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  const sample=await(await context.request.get(base+'/api/operations/sample-form')).body();
  const imported=await context.request.post(base+'/api/operations/intake',{multipart:{sender:'ai.zoom@example.com',file:{name:'ai-zoom-form.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:sample}}});assert.equal(imported.status(),201);const record=(await imported.json()).inquiry;await page.reload();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  await navigate(page,'Inquiries');await page.getByRole('link',{name:'Open '+record.fields.company,exact:true}).filter({hasText:record.id}).click();await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button').nth(1).click();await page.getByLabel('Proposal template',{exact:true}).selectOption('d023');await page.getByRole('button',{name:'Continue to preview',exact:true}).click();await page.locator('.ops-doc-preview[aria-busy="false"]').waitFor();
  const openedRequests=previewRequests;await page.getByRole('button',{name:'AI notes',exact:true}).click();await page.locator('.ops-doc-notes-column .ops-ai-notes').waitFor();await page.waitForTimeout(300);assert.equal(previewRequests,openedRequests);console.log('PASS Opening AI notes does not regenerate the document');
  await page.getByLabel('Proposal zoom').selectOption('1.25');await page.waitForFunction(()=>document.querySelector('.ops-doc-paper').getBoundingClientRect().width>700);await page.waitForTimeout(300);
  const dimensions=await page.locator('.ops-doc-preview').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,paper:e.querySelector('.ops-doc-paper').getBoundingClientRect().width,canvas:e.querySelector('canvas').getBoundingClientRect().width,verticalScrolls:[e,...e.querySelectorAll('*')].filter(n=>['auto','scroll'].includes(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+3).length}));
  assert.ok(dimensions.scrollWidth>dimensions.width);assert.ok(Math.abs(dimensions.paper-dimensions.canvas)<2);assert.equal(dimensions.verticalScrolls,0);await page.locator('.ops-doc-preview').evaluate(e=>{e.scrollLeft=180;});assert.ok(await page.locator('.ops-doc-preview').evaluate(e=>e.scrollLeft)>0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);console.log('PASS Zoomed PDF pans horizontally without clipping pages or adding another vertical scrollbar');
  await page.getByLabel('Proposal zoom').selectOption('fit');await page.evaluate(()=>window.scrollTo(0,1800));await page.waitForTimeout(350);await page.screenshot({path:'test-results/sidebar-fix/ai-comments-final-zoom.png'});console.log('PASS Fit width remains available with comments open');
}finally{await browser.close();}
