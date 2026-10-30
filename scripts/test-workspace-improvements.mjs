import {navigate} from './revamp-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import ExcelJS from 'exceljs';

// Only the isolated test server; the working database must never be used here.
const base='http://127.0.0.1:5190',out='test-results/workspace-cards/edge-cases';
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

  assert.equal(await page.locator('#client-protection-controls > summary').count(),0);
  await page.locator('#client-protection-controls').waitFor({state:'visible'});
  let assistanceRequests=0;
  page.on('request',request=>{if(/proposal-help|\/ai(?:\/|$)/.test(request.url()))assistanceRequests++;});
  await page.getByRole('button',{name:'Choose template',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'Suggested templates',exact:true}).count(),0);
  assert.ok(await page.locator('#workspace-template-library .ops-template-card').count()>3);
  assert.equal(await page.getByText('Template notes',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Suggest templates',exact:true}).click();
  const suggested=page.getByRole('region',{name:'Suggested templates',exact:true});
  assert.ok(await suggested.locator('.ops-template-card').count()<=3);
  const ids=await suggested.locator('.ops-template-card h3').allTextContents();
  await suggested.locator('.ops-template-card').first().getByRole('button',{name:/^Select /}).click();
  const save=page.getByRole('button',{name:'Save changes',exact:true});
  await save.waitFor();
  assert.ok(await save.evaluate(el=>el.nextElementSibling.textContent.includes('Continue to preview')));
  await save.click();await save.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Review form',exact:true}).click();
  await page.getByRole('button',{name:'Choose template',exact:true}).click();
  assert.deepEqual(await suggested.locator('.ops-template-card h3').allTextContents(),ids);
  for(const width of [1600,1200,768,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);
    await capture(page,'improvements-'+width);
  }
  assert.equal(assistanceRequests,0);assert.deepEqual(errors,[]);
  pass('Explicit suggestions, persistent selection, visible protection, save placement and responsive layout');
} finally {await browser.close();}

