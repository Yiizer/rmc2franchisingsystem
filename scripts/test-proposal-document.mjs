import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import PizZip from 'pizzip';

await mkdir('test-results/document-editor',{recursive:true});
const dir=path.resolve('test-results/document-editor');
// Test the actual XML filler with filesystem-only dependencies, without
// connecting to or creating any application database.
await writeFile(path.join(dir,'database.mjs'),`export class AppError extends Error{};export const dataRoot=${JSON.stringify(dir)};export const sourceFile=t=>t.file;`);
// Stubs for the storage modules documents.ts imports: fillDocx only needs errors + templateBytes (reads the master from disk).
await writeFile(path.join(dir,'errors.mjs'),`export class AppError extends Error{};`);
await writeFile(path.join(dir,'file-store.mjs'),`export const MIME={};export const deleteQuietly=async()=>{};export const files=()=>{throw new Error('file store is not available in this test')};export const putContentAddressed=async()=>{};`);
await writeFile(path.join(dir,'template-source.mjs'),`import {readFile} from 'node:fs/promises';export const templateBytes=t=>readFile(t.file);`);
for(const name of ['documents','document-renderer','proposal-fields','custom-documents','office-artwork']){
  const source=await readFile('lib/operations/'+name+'.ts','utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '\.\/(database|errors|file-store|template-source|document-renderer|proposal-fields|custom-documents|office-artwork)'/g,"from './$1.mjs'");
  await writeFile(path.join(dir,name+'.mjs'),output);
}
const {fillDocx}=await import(pathToFileURL(path.join(dir,'documents.mjs')));
const {pdfFromDocx}=await import(pathToFileURL(path.join(dir,'document-renderer.mjs')));
const {sourceHeaderArtwork}=await import(pathToFileURL(path.join(dir,'office-artwork.mjs')));
const catalog=JSON.parse(await readFile('resources/private/catalog.json','utf8'));
const fields={requestDate:'2026-10-10',proposalDate:'2026-10-11',addressee:'Dr. Maria Santos',addresseeTitle:'Dr.',addresseePosition:'HR Manager',company:'Test & Company <Local>',address:'123 Antipolo City',agentName:'Juan Dela Cruz',agentPhone:'(+63) 09171234567'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report=[];
for(const template of catalog){
  const source=await readFile(template.file);assert.equal(sha(source),template.sourceHash);
  const filled=await fillDocx(template,fields),preview=await fillDocx(template,fields,true);
  assert.equal(sha(preview),sha(filled),'Complete preview and generated Word bytes agree');
  const sourceZip=new PizZip(source),filledZip=new PizZip(filled);
  const stripText=xml=>xml.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g,'$1$2');
  let preserved=0;
  for(const [name,entry] of Object.entries(sourceZip.files)){
    if(entry.dir)continue;
    assert.ok(filledZip.file(name),name+' retained');
    if(/^word\/(document|header\d+|footer\d+)\.xml$/.test(name))assert.equal(stripText(filledZip.file(name).asText()),stripText(entry.asText()),name+' layout unchanged');
    else{assert.equal(sha(filledZip.file(name).asNodeBuffer()),sha(entry.asNodeBuffer()),name+' byte-for-byte preserved');preserved++;}
  }
  const artwork=sourceHeaderArtwork(filled);
  assert.equal(artwork.length,sourceHeaderArtwork(source).length,'Filling preserves the supplied header artwork and layering');
  for(const image of artwork){assert.ok(image.bytes.length>100);assert.ok(image.x>=0&&image.top>=0&&image.width>0&&image.height>0);}
  assert.equal(sha(await readFile(template.file)),template.sourceHash,'The supplied master remains untouched');
  const text=filledZip.file('word/document.xml').asText();assert.ok(text.includes('Test &amp; Company &lt;Local&gt;'));
  const flat=text.replace(/<[^>]+>/g,'');
  assert.ok(flat.includes('Dear Dr. Maria Santos:'),'All greetings address the client with the supplied professional title');
  assert.ok(flat.includes('October 11, 2026'),'Proposal date can differ from request date');
  assert.ok(/\(\+63\)\s*9171234567/.test(flat),'Philippine number uses one +63 and no leading zero');
  assert.ok(!/Dear\s+(?:Ms\.\/Mr\.|Mr\.\/Ms\.)/.test(flat),'No fixed Mr/Ms greeting remains');
  assert.ok(!/\[(Date|Client|Account name|Address|Agent name|CP number|Designation|Proposal Addresse|Addressee|Contact Number)/i.test(text.replace(/<[^>]+>/g,'')));
  const partial=await fillDocx(template,{},true);assert.ok(new PizZip(partial).file('word/document.xml').asText().includes('[Date]'));
  await writeFile(path.join(dir,template.sourceId+'-filled.docx'),filled);
  const pdf=await pdfFromDocx(preview,true);assert.ok(pdf.bytes.subarray(0,5).toString()==='%PDF-');assert.ok(pdf.pageCount>=2);
  const packagePdf=await pdfFromDocx(filled);assert.equal(sha(pdf.bytes),sha(packagePdf.bytes),'Preview is the same PDF rendered for generation');
  await writeFile(path.join(dir,template.sourceId+'-filled.pdf'),pdf.bytes);
  report.push({id:template.id,pages:pdf.pageCount,preservedParts:preserved,originalHash:template.sourceHash});
  console.log('PASS '+template.sourceId+': all source artwork/styles/relationships retained; '+pdf.pageCount+' PDF pages; preview matches generation');
}
await writeFile(path.join(dir,'fidelity.json'),JSON.stringify(report,null,2));
