import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import PizZip from 'pizzip';
import ts from 'typescript';
const folder=path.resolve('test-results/custom-proposals/integrity');await mkdir(folder,{recursive:true});
await writeFile(path.join(folder,'database.mjs'),'export class AppError extends Error{}');
const source=await readFile('lib/operations/custom-documents.ts','utf8');await writeFile(path.join(folder,'custom-documents.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./database'","'./database.mjs'"));
const {customDocument,customEditsSchema}=await import(pathToFileURL(path.join(folder,'custom-documents.mjs'))),catalog=JSON.parse(await readFile('resources/private/catalog.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const master of catalog){
  const bytes=await readFile(master.file),original=customDocument(bytes,{}),targets=[original.blocks.find(b=>b.original.trim()),original.blocks.find(b=>b.label.startsWith('Table cell')&&b.original.trim()),original.blocks.filter(b=>b.original.trim()).at(-1)];
  const edits=Object.fromEntries(targets.map((block,index)=>[block.id,{text:index===1?'Custom rate <5000> & benefit\nSecond line':block.original+' — CUSTOMIZED',...(index===0?{bold:true,color:'123456',fontSize:12}:{} )}]));
  const updated=customDocument(bytes,edits),reread=customDocument(updated.bytes,{}),after=new Map(reread.blocks.map(b=>[b.id,b.original]));
  for(const block of original.blocks)assert.equal(after.get(block.id),edits[block.id]?.text??block.original,master.id+' '+block.id);
  const baseZip=new PizZip(bytes),updatedZip=new PizZip(updated.bytes);for(const [name,entry] of Object.entries(baseZip.files))if(!entry.dir&&!/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name))assert.equal(hash(entry.asNodeBuffer()),hash(updatedZip.file(name).asNodeBuffer()),name);
  assert.throws(()=>customDocument(bytes,{'forged-id':{text:'x'}}));assert.equal(hash(await readFile(master.file)),master.sourceHash);console.log('PASS '+master.id+': all text edits round-trip; untouched paragraphs and original assets preserved');
}
assert.equal(customEditsSchema.safeParse({a:{text:'x',color:'red;display:none'}}).success,false);
assert.equal(customEditsSchema.safeParse({a:{text:'x',fontSize:999}}).success,false);
console.log('PASS Invalid formatting rejected');

// Tab stops (w:pPr/w:tabs/w:tab) are settings, not text. An edit made in the browser editor, which shows tabs as em
// spaces (U+2003), must land in the body text and leave the tab-stop settings alone (demo bug, 2026-11-05).
{
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  let checked=0;
  for(const master of catalog){
    const bytes=await readFile(master.file),xml=new PizZip(bytes).file('word/document.xml').asText();
    const paragraphs=xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[];
    const original=customDocument(bytes,{}),byId=new Map(original.blocks.map(b=>[b.id,b]));
    const target=original.blocks.find(b=>/^document-p\d+$/.test(b.id)&&b.original.trim().length>8&&/<w:tabs>/.test(paragraphs[Number(b.id.split('-p')[1])]||''));
    if(!target)continue;
    assert.ok(!/^\t/.test(target.original)||/<w:r[ >][^]*?<w:tab\/>/.test(paragraphs[Number(target.id.split('-p')[1])]),master.id+' tab stops are not counted as text');
    const typed=target.original.replace(/\t/g,' ')+' (edited)';
    const updated=customDocument(bytes,{[target.id]:{text:typed}}),reread=new Map(customDocument(updated.bytes,{}).blocks.map(b=>[b.id,b.original]));
    assert.equal(reread.get(target.id),target.original+' (edited)',master.id+' '+target.id+' edit lands in the body text');
    const tabStops=s=>(s.match(/<w:tabs>[\s\S]*?<\/w:tabs>/g)||[]).join('');
    assert.equal(tabStops(new PizZip(updated.bytes).file('word/document.xml').asText()),tabStops(xml),master.id+' tab-stop settings unchanged');
    assert.ok(byId.get(target.id));checked++;
  }
  assert.ok(checked>0,'at least one template has a paragraph with tab stops');
  console.log('PASS Tab-stop paragraphs: browser edits land in the text and keep the tab settings ('+checked+' templates)');
}
