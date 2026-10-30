import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import ExcelJS from 'exceljs';

// Only the isolated test server; the working database must never be used here.
const base='http://127.0.0.1:5190',out='test-results/workspace-advisors/edge-cases';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function login(who){const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(120000);assert.ok((await context.request.post(base+'/api/operations/login',{data:{email:who,password:'Rmc2Local!2026'}})).ok());return context;}
async function open(page,id){await navigate(page,'Inquiries');await page.getByLabel('Search inquiries').fill(id);await page.locator('.ops-inq-table tbody tr[role="link"]').filter({hasText:id}).click();await page.locator('.ops-workspace-id').filter({hasText:id}).waitFor();}
async function capture(page,name){await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(10,10);await page.screenshot({path:out+'/'+name+'.png',fullPage:true,animations:'disabled'});}
function contrast(fg,bg){const luminance=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
try {
  const employee=await login('judy');
  const book=new ExcelJS.Workbook();await book.xlsx.load(await(await employee.request.get(base+'/api/operations/sample-form')).body());
  const company='Cedar Digital Services · '+randomUUID().slice(0,6);
  for(const [cell,value] of Object.entries({B10:company,D14:company+' contact',B21:company+' contact',C7:'Lea Bautista',J10:'PRIVATE',J11:'Services',D22:'Total CorpoHealthCheck',G23:'Annual',D25:25,J24:0}))book.worksheets[0].getCell(cell).value=value;
  const intake=await employee.request.post(base+'/api/operations/intake',{multipart:{sender:'card-review@example.test',file:{name:'card-review.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())}}});assert.equal(intake.status(),201);
  const record=(await intake.json()).inquiry;
  const page=await employee.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);await open(page,record.id);
  await page.getByRole('button',{name:'Start handling',exact:true}).click();await page.getByText('Handling: you',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'Suggested templates',exact:true}).count(),1);
  const first=page.locator('.ops-template-card').first();await first.getByRole('button',{name:/^Select /}).click();
  const chosen=await first.getAttribute('aria-label');
  assert.ok((await first.locator('.ops-template-description').innerText()).length>0);
  assert.equal(await page.locator('.ops-template-card.selected').getAttribute('aria-label'),chosen);
  assert.ok((await first.locator('.ops-template-description').innerText()).length>0);
  await page.evaluate(()=>document.fonts.ready);
  const cdp=await employee.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const root=(await cdp.send('DOM.getDocument')).root.nodeId;
  const nodeId=(await cdp.send('DOM.querySelector',{nodeId:root,selector:'.ops-template-card h3'})).nodeId;
  await writeFile(out+'/font.json',JSON.stringify({platform:await cdp.send('CSS.getPlatformFontsForNode',{nodeId}),computed:await first.locator('h3').evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:getComputedStyle(el).fontWeight}))},null,2));
  const palette=await page.locator('.ops-template-selection, .ops-main-action button, .ops-select-template, .ops-customize-template').evaluateAll(elements=>elements.map(el=>({text:el.textContent,fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));
  for(const color of palette)assert.ok(contrast(color.fg,color.bg)>=4.5,'Text contrast: '+color.text);
  await capture(page,'cards-desktop');await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.ops-sidebar').getBoundingClientRect().right<=1);await capture(page,'cards-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1600,height:1000});
  pass('Selected and action colors meet text contrast; template descriptions preserve selection; cards fit mobile');

  // Hold a save response to check the actual pending state, then let the normal request finish.
  let release,started;
  const held=new Promise(resolve=>release=resolve),observed=new Promise(resolve=>started=resolve);
  await page.route('**/api/operations/inquiries/'+record.id+'/save',async route=>{started();await held;await route.continue();},{times:1});
  await page.getByRole('button',{name:'Continue to preview',exact:true}).click();await observed;
  assert.equal(await first.locator('.ops-select-template').isDisabled(),true);
  assert.equal(await first.locator('.ops-customize-template').isDisabled(),true);
  release();await page.locator('.ops-doc-editor').waitFor();
  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();await first.getByRole('button',{name:/^Customize /}).click();await page.locator('[data-custom-block][contenteditable="true"]').first().waitFor();
  let saved=(await(await employee.request.get(base+'/api/operations/inquiries/'+record.id)).json()).inquiry;const customId=saved.customization.id;
  const block=page.locator('[data-custom-block][contenteditable="true"]').filter({hasText:'Diamond'}).first();await block.fill('Customized review text');
  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  await page.locator('.ops-template-card.selected').getByRole('button',{name:/^Continue customizing /}).click();await page.locator('[data-custom-block][contenteditable="true"]').filter({hasText:'Customized review text'}).waitFor();
  assert.equal(await page.locator('[data-custom-block][contenteditable="true"]').filter({hasText:'Customized review text'}).innerText(),'Customized review text');
  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();await page.getByRole('button',{name:'View all templates',exact:true}).click();await page.locator('#workspace-template-library').waitFor();
  await page.getByRole('group',{name:'Filter by plan family'}).getByRole('button',{name:'Total CorpoShield',exact:true}).click();
  const other=page.locator('#workspace-template-library .ops-template-card').first();await other.getByRole('button',{name:/^Customize /}).click();
  const confirm=page.getByRole('dialog',{name:'Create another customized copy?'});await confirm.getByRole('button',{name:'Keep current copy',exact:true}).click();
  assert.equal((await(await employee.request.get(base+'/api/operations/inquiries/'+record.id)).json()).inquiry.customization.id,customId);
  await other.getByRole('button',{name:/^Customize /}).click();await confirm.getByRole('button',{name:'Save & create copy',exact:true}).click();await page.locator('[data-custom-block][contenteditable="true"]').first().waitFor();
  saved=(await(await employee.request.get(base+'/api/operations/inquiries/'+record.id)).json()).inquiry;
  assert.notEqual(saved.customization.id,customId);assert.ok(saved.customizationArchive.some(item=>item.id===customId&&Object.values(item.edits).some(edit=>JSON.stringify(edit).includes('Customized review text'))));
  await page.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();await page.locator('.ops-template-card').first().getByRole('button',{name:/^Select /}).click();
  await page.getByRole('dialog',{name:'Switch to a standard template?'}).getByRole('button',{name:'Keep customizing',exact:true}).click();
  pass('Busy states block edits; continuing keeps custom edits; changing copies confirms and archives the saved edits');
  await page.getByRole('button',{name:'Preview & approval',exact:true}).click();await page.getByRole('button',{name:'PDF preview',exact:true}).click();await page.locator('.ops-doc-preview[aria-busy="false"]').waitFor();await capture(page,'checks-outside-preview');
  await page.getByRole('button',{name:'Back to inquiries',exact:true}).click();

  // Read-only API fixtures exercise unavailable and unmatched libraries without modifying the catalog.
  const viewer=await login('admin');let mode='unmatched';
  await viewer.route('**/api/operations/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()!=='GET'||(!url.pathname.endsWith('/workspace')&&!url.pathname.endsWith('/inquiries/'+record.id)))return route.continue();
    const response=await route.fetch(),data=await response.json();
    if(data.templates&&mode==='empty')data.templates=[];
    for(const item of [data.current,data.inquiry])if(item?.id===record.id){item.fields={...item.fields,sector:'',requestedPlan:''};}
    await route.fulfill({response,json:data});
  });
  const vp=await viewer.newPage();vp.on('pageerror',error=>errors.push(error.message));await vp.goto(base);await open(vp,record.id);await vp.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  await vp.getByText('No matching templates for the known details.',{exact:false}).waitFor();await vp.getByRole('button',{name:'View all templates',exact:true}).click();
  assert.equal(await vp.locator('.ops-template-card .ops-select-template').first().isDisabled(),true);
  mode='empty';await vp.reload();await open(vp,record.id);await vp.getByRole('navigation',{name:'Proposal workflow'}).getByRole('button',{name:'Choose template',exact:true}).click();
  await vp.getByText('No active templates are available.',{exact:false}).waitFor();assert.equal(await vp.locator('.ops-template-card').count(),0);
  pass('Unmatched requests show manual-review guidance; empty libraries remain clear and view-only permissions stay enforced');
  assert.deepEqual(errors,[]);pass('No browser errors in edge cases');
} finally {await writeFile(out+'/checks.json',JSON.stringify(checks,null,2));await writeFile(out+'/errors.json',JSON.stringify(errors,null,2));await browser.close();}
