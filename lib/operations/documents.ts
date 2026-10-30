import PizZip from 'pizzip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pdfFromDocx } from './document-renderer';
import { AppError, dataRoot, sourceFile } from './database';
import { customDocument } from './custom-documents';
import type { CatalogTemplate, FormFields, GeneratedPackage, CustomizedProposal } from './types';
import { addresseeName, philippinePhone } from './proposal-fields';

export function fingerprint(fields:FormFields,template:CatalogTemplate,customization?:CustomizedProposal) { return createHash('sha256').update(JSON.stringify({fields:Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)),source:template.sourceHash,...(customization?{customization:{id:customization.id,edits:Object.entries(customization.edits).sort(([a],[b])=>a.localeCompare(b))}}:{})})).digest('hex'); }
const unescapeXml=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,t=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[t]||t));
const escapeXml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function fillParagraph(xml:string,values:Record<string,string>) {
  const matches=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
  const texts=matches.map(m=>unescapeXml(m[1]));
  const original=texts.join('');
  // Some masters use a fixed greeting, split across Word runs. Change text
  // only: retain the paragraph, run formatting, logos and page artwork.
  if(/^\s*Dear\s+(?:Ms\.?\s*\/\s*Mr\.?|Mr\.?\s*\/\s*Ms\.?)\s*:\s*$/i.test(original)&&values.client){
    let inserted=false;let i=0;
    return xml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(_whole,open,_text,close)=>{
      const hasText=!!texts[i++]?.trim();const value=!inserted&&hasText?'Dear '+values.client+':':'';
      if(hasText)inserted=true;return open+escapeXml(value)+close;
    });
  }
  const slots=[...original.matchAll(/\[([^\[\]]+)\]/g)].reverse();
  for(const slot of slots){const key=slot[1].trim().toLowerCase();const replacement=values[key];if(replacement===undefined)continue;const start=slot.index!,end=start+slot[0].length;let offset=0;for(let i=0;i<texts.length;i++){const length=unescapeXml(matches[i][1]).length,lo=Math.max(0,start-offset),hi=Math.min(length,end-offset);if(hi>lo){texts[i]=texts[i].slice(0,lo)+(start>=offset&&start<offset+length?replacement:'')+texts[i].slice(hi);}offset+=length;}}
  let index=0;return xml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(_whole,open,_text,close)=>open+escapeXml(texts[index++])+close);
}
export async function fillDocx(template:CatalogTemplate, fields:FormFields, preview=false):Promise<Buffer> {
  const original=await readFile(sourceFile(template));
  if(createHash('sha256').update(original).digest('hex')!==template.sourceHash)throw new AppError('The proposal source changed. Import and review the new version before generating.');
  const dateValue=fields.proposalDate??fields.requestDate??'';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)?new Date(dateValue+'T12:00:00+08:00'):null;
  const client=addresseeName(fields),phone=philippinePhone(fields.agentPhone).national;
  const values:Record<string,string>={'date':date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('en-PH',{dateStyle:'long',timeZone:'Asia/Manila'}).format(date):'','client':client,'position':fields.addresseePosition,'designation':fields.addresseePosition,'account name':fields.company,'address':fields.address,'account address':fields.address,'agent name':fields.agentName,'cp number':phone,'contact number':phone,'agent’s contact number':phone,'agent\'s contact number':phone,'proposal addresse':client,'proposal addressee':client,'addressee':client};
  for(const placeholder of template.placeholders){const key=placeholder.slice(1,-1).trim().toLowerCase();if(key.startsWith('contact number')||key.startsWith('agent’s contact number'))values[key]=phone;}
  // In a working preview, keep a missing source placeholder visible. Never
  // fabricate a value, or permit an unfinished preview to become a package.
  for(const key of Object.keys(values)){if(preview&&!values[key]?.trim())delete values[key];else values[key]??='';}
  const zip=new PizZip(original);
  for(const filename of Object.keys(zip.files).filter(f=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(f))){const xml=zip.file(filename)!.asText();zip.file(filename,xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,paragraph=>fillParagraph(paragraph,values)),{date:zip.files[filename].date});}
  const filled=zip.generate({type:'nodebuffer'});
  const remaining=zip.file('word/document.xml')!.asText().replace(/<[^>]+>/g,'');
  if(!preview&&/\[(Date|Client|Account name|Address|Agent name|CP number|Designation|Proposal Addresse|Addressee|Contact Number)/i.test(remaining))throw new AppError('A proposal placeholder could not be filled. The draft has not been generated.');
  return filled;
}
export async function generatePackage(id:string,template:CatalogTemplate,fields:FormFields,preparedBy:string,customization?:CustomizedProposal):Promise<GeneratedPackage> {
  if(customization&&(customization.templateId!==template.id||customization.sourceHash!==template.sourceHash))throw new AppError('This customized draft uses an earlier template. Create a fresh customized copy and review its edits before generating.',409);
  const base=await fillDocx(template,fields),custom=customization?customDocument(base,customization.edits):undefined,bytes=custom?.bytes||base,pdf=await pdfFromDocx(bytes),packageId=randomUUID();
  await mkdir(path.join(dataRoot,'generated'),{recursive:true});
  await mkdir(path.join(dataRoot,'sources'),{recursive:true});
  const original=await readFile(sourceFile(template));
  if(createHash('sha256').update(original).digest('hex')!==template.sourceHash)throw new AppError('The proposal source changed during generation. Review the new source before trying again.',409);
  const sourceDocx='sources/'+template.sourceHash+'.docx';
  await writeFile(path.join(dataRoot,sourceDocx),original,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  if(createHash('sha256').update(await readFile(path.join(dataRoot,sourceDocx))).digest('hex')!==template.sourceHash)throw new AppError('The archived proposal source could not be verified.',409);
  const docx='generated/'+packageId+'.docx',pdfPath='generated/'+packageId+'.pdf';
  await writeFile(path.join(dataRoot,docx),bytes);await writeFile(path.join(dataRoot,pdfPath),pdf.bytes);
  return {id:packageId,renderer:'native-word-v2',templateId:template.id,sourceHash:template.sourceHash,sourceDocx,sourceName:template.sourceName,templateName:template.name,docx,pdf:pdfPath,filename:id+'-'+template.sourceId+(customization?'-CUSTOMIZED':''),generatedAt:new Date().toISOString(),preparedBy,fingerprint:fingerprint(fields,template,customization),fields:{...fields},pageCount:pdf.pageCount,...(customization?{customization:{...structuredClone(customization),changes:custom!.changes}}:{})};
}
