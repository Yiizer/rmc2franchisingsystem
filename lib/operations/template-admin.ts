import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import { AppError, catalog, db, safeStorage, transaction } from './database';
import { pdfFromDocx } from './document-renderer';
import { securityEvent } from './accounts';
import type { CatalogTemplate, Staff } from './types';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function admin(user:Staff){if(user.role!=='Admin')throw new AppError('Only administrators can manage proposal templates.',403);}
type StagedTemplate={template:CatalogTemplate;expectedHash:string|null;pdf:string;pages:number};
const metadata=z.object({templateId:z.string().max(100).default(''),expectedHash:z.string().max(64).default(''),family:z.string().trim().min(2).max(100),variant:z.string().trim().min(2).max(100),sector:z.enum(['Government','All']),annualOnly:z.enum(['true','false']),warnings:z.string().max(5000).default('')});
export async function stageTemplate(user:Staff,form:FormData){
  admin(user);const body=metadata.parse(Object.fromEntries(form)),file=form.get('file');
  if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.docx')||!file.size||file.size>15*1024*1024)throw new AppError('Upload a Word .docx template up to 15 MB.');
  const existing=body.templateId?(await catalog()).find(template=>template.id===body.templateId):undefined;
  if(body.templateId&&(!existing||existing.sourceHash!==body.expectedHash))throw new AppError('This template changed. Reload before uploading its replacement.',409);
  const bytes=Buffer.from(await file.arrayBuffer());let zip:PizZip;
  try{zip=new PizZip(bytes);}catch{throw new AppError('The uploaded file is not a readable Word document.');}
  const entries=Object.values(zip.files),names=Object.keys(zip.files);let total=0;
  if(entries.length>1200||!zip.file('word/document.xml')||!zip.file('[Content_Types].xml'))throw new AppError('Use a standard Word .docx document.');
  for(const entry of entries){
    const size=(entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize||0;total+=size;
    if(size>20*1024*1024||total>80*1024*1024||entry.name.includes('..')||entry.name.startsWith('/')||entry.name.includes('\\'))throw new AppError('The document contains unsupported or oversized content.');
  }
  if(names.some(name=>/vbaProject|embeddings\/|activeX\/|altChunk/i.test(name)))throw new AppError('Remove macros, embedded files and active content before uploading.');
  const paragraphs:string[]=[];
  for(const name of names.filter(name=>/\.(?:xml|rels)$/i.test(name))){
    const xml=zip.file(name)!.asText();
    if(xml.length>6*1024*1024||/<!DOCTYPE|<!ENTITY|<w:altChunk\b|<w:object\b/i.test(xml))throw new AppError('The document contains unsupported active content.');
    const doc=new DOMParser({onError:()=>{throw new AppError('The document contains invalid XML.');}}).parseFromString(xml,'application/xml');
    if(name.endsWith('.rels'))for(const relation of Array.from(doc.getElementsByTagName('Relationship'))){if(relation.getAttribute('TargetMode')==='External')throw new AppError('Remove external links and linked images from the template before uploading.');}
    if(/^word\/(document|header\d+|footer\d+)\.xml$/.test(name))for(const paragraph of Array.from(doc.getElementsByTagNameNS(W,'p')))paragraphs.push(Array.from(paragraph.getElementsByTagNameNS(W,'t')).map(node=>node.textContent).join(''));
  }
  const text=paragraphs.join('\n');if(text.trim().length<20)throw new AppError('The template has no readable proposal text.');
  const placeholders=[...new Set(text.match(/\[[^\[\]\r\n]{1,100}\]/g)||[])];
  const supported=/^\[(date|client|position|designation|account name|address|account address|agent name|cp number|contact number[^\]]*|agent[’']s contact number[^\]]*|proposal addresse|proposal addressee|addressee)\]$/i;
  const unsupported=placeholders.filter(value=>!supported.test(value));
  if(unsupported.length)throw new AppError('Replace unsupported placeholders before uploading: '+unsupported.join(', '));
  const hash=createHash('sha256').update(bytes).digest('hex'),id=existing?.id||'t'+randomUUID().replaceAll('-','').slice(0,20),storage='templates/'+hash+'.docx';
  const template:CatalogTemplate={id,name:body.family+' · '+body.variant,family:body.family,variant:body.variant,sector:body.sector,sourceName:path.basename(file.name),sourceId:existing?.sourceId||id.toUpperCase(),sourceHash:hash,file:'',storage,text,placeholders,warnings:body.warnings.split('\n').map(line=>line.trim()).filter(Boolean),annualOnly:body.annualOnly==='true',active:true,updatedAt:new Date().toISOString(),updatedBy:user.id};
  // Validate the exact uploaded bytes with the same converter used for proposals.
  const pdf=await pdfFromDocx(bytes,true),stageId=randomUUID(),pdfStorage='templates/previews/'+stageId+'.pdf';
  mkdirSync(path.dirname(safeStorage(pdfStorage)),{recursive:true});
  try{writeFileSync(safeStorage(storage),bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(createHash('sha256').update(readFileSync(safeStorage(storage))).digest('hex')!==hash)throw new AppError('The saved template could not be verified.',409);}
  writeFileSync(safeStorage(pdfStorage),pdf.bytes,{flag:'wx'});
  const staged:StagedTemplate={template,expectedHash:existing?.sourceHash||null,pdf:pdfStorage,pages:pdf.pageCount};
  await db.run('INSERT INTO template_versions VALUES (?,?,?,?,?,?)',stageId,id,JSON.stringify(staged),'staged',user.id,new Date().toISOString());
  await securityEvent(user,'Staged template '+id+' source '+hash);return {id:stageId,template:{...template,file:'',storage:undefined},pages:pdf.pageCount};
}
export async function templateStage(user:Staff,id:string){admin(user);const row=await db.get('SELECT data,state FROM template_versions WHERE id=?',id) as {data:string;state:string}|undefined;if(!row)throw new AppError('Template preview not found.',404);return {...JSON.parse(row.data) as StagedTemplate,state:row.state};}
export async function publishTemplate(user:Staff,input:unknown){
  admin(user);const body=z.object({id:z.string().uuid(),reviewed:z.literal(true)}).strict().parse(input);
  return await transaction(async()=>{
    const staged=await templateStage(user,body.id);if(staged.state==='published')return staged.template;
    const current=(await catalog()).find(template=>template.id===staged.template.id);
    if((current?.sourceHash||null)!==staged.expectedHash)throw new AppError('Another administrator updated this template. Upload and review again.',409);
    if(current)await db.run('INSERT INTO template_versions VALUES (?,?,?,?,?,?)',randomUUID(),current.id,JSON.stringify({template:current}),'previous',user.id,new Date().toISOString());
    await db.run('INSERT OR REPLACE INTO template_overrides VALUES (?,?)',staged.template.id,JSON.stringify(staged.template));
    await db.run("UPDATE template_versions SET state='published' WHERE id=?",body.id);await securityEvent(user,'Published template '+staged.template.id+' source '+staged.template.sourceHash);return staged.template;
  });
}
export async function setTemplateActive(user:Staff,input:unknown){admin(user);const body=z.object({id:z.string(),expectedHash:z.string(),active:z.boolean()}).strict().parse(input);return await transaction(async()=>{const template=(await catalog()).find(template=>template.id===body.id);if(!template||template.sourceHash!==body.expectedHash)throw new AppError('Reload the template library first.',409);const next={...template,active:body.active};await db.run('INSERT OR REPLACE INTO template_overrides VALUES (?,?)',next.id,JSON.stringify(next));await securityEvent(user,(body.active?'Activated':'Retired')+' template '+next.id);return next;});}
