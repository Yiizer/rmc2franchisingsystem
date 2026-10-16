import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const folder=path.resolve('test-results/franchising-ux');await mkdir(folder,{recursive:true});
const source=await readFile('lib/operations/proposal-fields.ts','utf8');await writeFile(path.join(folder,'proposal-fields.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {philippinePhone,proposalChecks,proposalFields,addresseeName}=await import(pathToFileURL(path.join(folder,'proposal-fields.mjs')));
for(const input of ['09171234567','+639171234567','(+63) 09171234567','00639171234567','9171234567'])assert.deepEqual(philippinePhone(input),{valid:true,national:'9171234567',display:'(+63) 9171234567'});
assert.equal(philippinePhone('0281234567').display,'(+63) 281234567');
for(const input of ['123','+16505551212','09171234567 ext 1',''])assert.equal(philippinePhone(input).valid,false);
for(const title of ['Dr.','Engr.','Atty.','Prof.']){
  const original={addressee:title+' Maria Santos',agentPhone:'09171234567',requestDate:'2026-10-11'};
  const working=proposalFields({...original},original);assert.equal(working.addresseeTitle,title);assert.equal(addresseeName(working),title+' Maria Santos');
  assert.equal(proposalChecks({...working,agentPhone:'(+63) 9171234567'},original).length,0,'Canonical phone normalization is not flagged as a change');
  assert.ok(proposalChecks({...working,addressee:'Maria Santos',addresseeTitle:'Mr.'},original).some(check=>check.kind==='error'&&check.field==='addresseeTitle'));
}
const original={addressee:'Maria Santos',agentPhone:'09171234567',company:'Original'};
assert.ok(proposalChecks({...original,company:'Corrected'},original).some(check=>check.kind==='changed'&&check.original==='Original'&&check.current==='Corrected'));
console.log('PASS Philippine phone formats, professional titles, and form discrepancy checks');
assert.equal(proposalFields({addressee:'DR. Maria Santos'},{addressee:'DR. Maria Santos'}).addresseeTitle,'Dr.');
assert.equal(proposalFields({addressee:'Maria Santos'},{addressee:'Maria Santos',contactName:'Engr. Maria Santos'}).addresseeTitle,'Engr.');
const suggestionSource=await readFile('lib/operations/suggestions.ts','utf8');await writeFile(path.join(folder,'suggestions.mjs'),ts.transpileModule(suggestionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {suggestTemplates}=await import(pathToFileURL(path.join(folder,'suggestions.mjs'))),catalog=JSON.parse(await readFile('resources/private/catalog.json','utf8'));
assert.ok(suggestTemplates({sector:'DepEd',payment:'Annual',dependents:'5'},catalog).every(option=>option.template.sourceId!=='D023'));
assert.ok(suggestTemplates({sector:'Private',payment:'Semiannual',dependents:'0'},catalog).every(option=>option.template.sector!=='Government'&&!option.template.annualOnly));
console.log('PASS Case-insensitive titles, contact-title inheritance, and source constraints on suggestions');
