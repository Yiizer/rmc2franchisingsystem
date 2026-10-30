import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import ts from 'typescript';
const load = async path => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {suggestTemplates, reviewTemplateChoice, suggestionInputs} = await load('lib/operations/suggestions.ts');
const {manilaTime} = await load('lib/operations/types.ts');
const template=(id,family,variant='Standard',extra={})=>({id,family,variant,name:family+' · '+variant,active:true,sector:'All',sourceId:id,sourceHash:'original',annualOnly:true,...extra});
const catalog=[template('h','Total CorpoHealthCheck'),template('hp','Total CorpoHealthCheck','PEC covered'),template('hd','Total CorpoHealthCheck','PEC + dreaded covered'),template('s','Total CorpoShield'),template('g','BureauHealth 4,250','Standard',{sector:'Government',sourceId:'D023'})];
const fields={requestedPlan:'Total CorpoHealthCheck',sector:'Private',payment:'Annual',dependents:'0'};
const checks=[];
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
check('Default matches and explicit review never change the input or selection',()=>{
 const before=JSON.stringify([fields,catalog]);assert.equal(suggestTemplates(fields,catalog)[0].template.id,'h');assert.equal(reviewTemplateChoice(fields,catalog,'h').status,'Matches known requirements');assert.equal(JSON.stringify([fields,catalog]),before);
 assert.equal(reviewTemplateChoice(fields,catalog,'s').status,'Another template fits better');assert.equal(reviewTemplateChoice(fields,catalog,'').recommendedId,'h');
});
check('Explicit PEC and dreaded variants outrank standard; unavailable coverage requires review',()=>{
 for(const [requestedPlan,id] of [['Total CorpoHealthCheck PEC covered','hp'],['Total CorpoHealthCheck PEC & dreaded covered','hd']]){
  const next={...fields,requestedPlan};assert.equal(suggestTemplates(next,catalog)[0].template.id,id);assert.equal(reviewTemplateChoice(next,catalog,'h').status,'Another template fits better');assert.equal(reviewTemplateChoice(next,catalog.filter(t=>t.id!==id),'h').status,'Needs review');
 }
});
check('Missing, unrecognized, retired and empty choices do not produce a green match',()=>{
 assert.equal(suggestTemplates({},catalog).length,0);
 assert.equal(reviewTemplateChoice({},catalog,'h').status,'Needs review');
 assert.equal(reviewTemplateChoice({...fields,requestedPlan:'Unlisted program'},catalog,'h').status,'Needs review');
 assert.equal(reviewTemplateChoice(fields,catalog.map(t=>({...t,active:false})),'h').status,'Needs review');
 assert.equal(reviewTemplateChoice(fields,[],'').status,'Needs review');
 assert.equal(reviewTemplateChoice(fields,catalog,'missing-template').status,'Needs review');
});
check('Annual schedules, dependent restrictions and customized copies require appropriate review',()=>{
 assert.equal(suggestTemplates({...fields,payment:'Semiannual'},catalog).length,0);
 assert.equal(suggestTemplates({...fields,sector:'Government',requestedPlan:'BureauHealth 4,250',dependents:'2'},catalog).some(t=>t.template.id==='g'),false);
 assert.equal(reviewTemplateChoice(fields,catalog,'g').status,'Another template fits better');
 assert.equal(reviewTemplateChoice(fields,catalog,'h',true).status,'Needs review');
 assert.equal(reviewTemplateChoice({...fields,requestedPlan:'Total CorpoHealthCheck semi annual OP limit'},catalog,'h').status,'Needs review');
});
check('Only meaningful input changes invalidate results; catalog order is stable',()=>{
 assert.equal(suggestionInputs(fields,catalog),suggestionInputs({...fields,agentName:'Updated'},[...catalog].reverse()));
 assert.notEqual(suggestionInputs(fields,catalog),suggestionInputs({...fields,payment:'Semiannual'},catalog));
 assert.notEqual(suggestionInputs(fields,catalog),suggestionInputs(fields,catalog.map(t=>({...t,sourceHash:'updated'}))));
});
check('Numeric Manila dates remain month/day/year across midnight, year and leap-day boundaries',()=>{
 assert.equal(manilaTime('2026-02-03T16:00:00Z'),'02/04/2026, 12:00 AM');
 assert.equal(manilaTime('2026-12-31T16:01:00Z'),'01/01/2027, 12:01 AM');
 assert.equal(manilaTime('2028-02-29T15:59:00Z'),'02/29/2028, 11:59 PM');
});
await mkdir('test-results/workspace-advisors',{recursive:true});
await writeFile('test-results/workspace-advisors/rule-checks.json',JSON.stringify(checks,null,2));
