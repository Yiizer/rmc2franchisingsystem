import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { z } from 'zod';
import { AppError } from './database';
import type { CustomEdit, CustomChange } from './types';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const customEditsSchema=z.record(z.object({text:z.string().max(30000),bold:z.boolean().optional(),italic:z.boolean().optional(),underline:z.boolean().optional(),fontSize:z.number().min(6).max(48).optional(),color:z.string().regex(/^[0-9A-Fa-f]{6}$/).optional(),align:z.enum(['left','center','right','both']).optional()}).strict()).refine(edits=>Object.keys(edits).length<=2500&&JSON.stringify(edits).length<=500000,'Customized content is too large.');
type XmlDocument=ReturnType<DOMParser['parseFromString']>;
type XmlElement=NonNullable<XmlDocument['documentElement']>;
type XmlNode=XmlElement['parentNode'];
const elements=(element:XmlElement,name:string)=>Array.from(element.getElementsByTagNameNS(W,name));
function parent(node:XmlNode,name:string):XmlElement|null {
  for(let p=node;p;p=p.parentNode)if(p.nodeType===1&&p.namespaceURI===W&&p.localName===name)return p as XmlElement;
  return null;
}
function tokens(paragraph:XmlElement) {
  return Array.from(paragraph.getElementsByTagNameNS(W,'*')).filter(node=>parent(node.parentNode,'p')===paragraph&&(node.localName==='t'||node.localName==='tab'||node.localName==='br'&&!node.getAttributeNS(W,'type')));
}
const tokenText=(node:XmlElement)=>node.localName==='br'?'\n':node.localName==='tab'?'\t':node.textContent||'';
const textOf=(paragraph:XmlElement)=>tokens(paragraph).map(tokenText).join('');
const parts=(zip:PizZip)=>Object.keys(zip.files).filter(file=>/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(file)).sort();
const parser=()=>new DOMParser({onError:()=>{throw new AppError('The source document XML could not be read.');}});
const key=(part:string,index:number)=>part.slice(5,-4)+'-p'+index;
export type EditableBlock={id:string;anchor:string;label:string;original:string;text:string};

function replaceText(paragraph:XmlElement,value:string){
  const nodes=tokens(paragraph),before=nodes.map(tokenText).join(''),doc=paragraph.ownerDocument!;
  if(before===value)return;
  let prefix=0,suffix=0;
  while(prefix<before.length&&prefix<value.length&&before[prefix]===value[prefix])prefix++;
  while(suffix<before.length-prefix&&suffix<value.length-prefix&&before[before.length-1-suffix]===value[value.length-1-suffix])suffix++;
  const end=before.length-suffix,insert=value.slice(prefix,value.length-suffix);
  function fragment(text:string){const f=doc.createDocumentFragment();for(const piece of text.split(/([\n\t])/)){if(!piece)continue;const node=doc.createElementNS(W,piece==='\n'?'w:br':piece==='\t'?'w:tab':'w:t');if(node.localName==='t'){node.setAttribute('xml:space','preserve');node.appendChild(doc.createTextNode(piece));}f.appendChild(node);}return f;}
  if(!nodes.length){const run=doc.createElementNS(W,'w:r');run.appendChild(fragment(value));paragraph.appendChild(run);return;}
  let offset=0,inserted=false;
  for(const node of nodes){const text=tokenText(node),next=offset+text.length;
    if(next>=prefix&&offset<=end){const left=text.slice(0,Math.max(0,prefix-offset)),right=text.slice(Math.max(0,end-offset));const replacement=left+(!inserted?insert:'')+right;inserted=true;node.parentNode!.replaceChild(fragment(replacement),node);}
    offset=next;
  }
}
function styleParagraph(paragraph:XmlElement,edit:CustomEdit){
  const doc=paragraph.ownerDocument!;
  function property(owner:XmlElement,name:string,value:string){let node=Array.from(owner.childNodes).find(n=>n.nodeType===1&&n.localName===name&&n.namespaceURI===W) as XmlElement|undefined;if(!node){node=doc.createElementNS(W,'w:'+name);owner.appendChild(node);}node.setAttributeNS(W,'w:val',value);}
  for(const run of elements(paragraph,'r').filter(run=>parent(run.parentNode,'p')===paragraph)){
    let properties=Array.from(run.childNodes).find(n=>n.nodeType===1&&n.localName==='rPr') as XmlElement|undefined;
    if(!properties){properties=doc.createElementNS(W,'w:rPr');run.insertBefore(properties,run.firstChild);}
    if(edit.bold!==undefined)property(properties,'b',edit.bold?'1':'0');
    if(edit.italic!==undefined)property(properties,'i',edit.italic?'1':'0');
    if(edit.underline!==undefined)property(properties,'u',edit.underline?'single':'none');
    if(edit.fontSize!==undefined)property(properties,'sz',String(edit.fontSize*2));
    if(edit.color)property(properties,'color',edit.color);
  }
  if(edit.align){let properties=Array.from(paragraph.childNodes).find(n=>n.nodeType===1&&n.localName==='pPr') as XmlElement|undefined;if(!properties){properties=doc.createElementNS(W,'w:pPr');paragraph.insertBefore(properties,paragraph.firstChild);}property(properties,'jc',edit.align);}
}
export function customDocument(bytes:Buffer,edits:Record<string,CustomEdit>,annotate=false){
  const zip=new PizZip(bytes),blocks:EditableBlock[]=[],changes:CustomChange[]=[],seen=new Set<string>();let bookmark=800000;
  for(const part of parts(zip)){
    const xml=zip.file(part)!.asText(),doc=parser().parseFromString(xml,'application/xml');if(!doc.documentElement)throw new AppError('The source document is empty.');const paragraphs=elements(doc.documentElement,'p');
    paragraphs.forEach((paragraph,index)=>{
      const id=key(part,index),original=textOf(paragraph),edit=edits[id],label=(parent(paragraph.parentNode,'tc')?'Table cell':'Proposal text')+' · '+(original.trim().replace(/\s+/g,' ').slice(0,65)||'Blank paragraph'),anchor='rmc2_'+id.replace(/-/g,'_');seen.add(id);
      if(edit){replaceText(paragraph,edit.text);if(Object.keys(edit).some(k=>k!=='text'))styleParagraph(paragraph,edit);const formatting=Object.keys(edit).filter(k=>k!=='text');if(original!==edit.text||formatting.length)changes.push({id,label,before:original,after:edit.text,formatting});}
      blocks.push({id,anchor,label,original,text:textOf(paragraph)});
      if(annotate){const start=doc.createElementNS(W,'w:bookmarkStart'),end=doc.createElementNS(W,'w:bookmarkEnd');start.setAttributeNS(W,'w:id',String(bookmark));start.setAttributeNS(W,'w:name',anchor);end.setAttributeNS(W,'w:id',String(bookmark++));const properties=Array.from(paragraph.childNodes).find(n=>n.nodeType===1&&n.localName==='pPr');paragraph.insertBefore(start,properties?.nextSibling||paragraph.firstChild);paragraph.appendChild(end);}
    });
    if(annotate||paragraphs.some((_,index)=>edits[key(part,index)]))zip.file(part,new XMLSerializer().serializeToString(doc),{date:zip.files[part].date});
  }
  const unknown=Object.keys(edits).filter(id=>!seen.has(id));if(unknown.length)throw new AppError('Some customized sections no longer match this template. Reload the document.',409);
  return {bytes:zip.generate({type:'nodebuffer'}),blocks,changes};
}
