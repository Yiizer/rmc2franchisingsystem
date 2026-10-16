import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

type Artwork={bytes:Buffer;x:number;top:number;width:number;height:number};
const EMU=12700;

/** Read the original logos and coordinates from masters with flattened header
 * image layers. Explicitly layered masters need no correction. Never modify
 * the source or filled DOCX. */
export function sourceHeaderArtwork(bytes:Buffer):Artwork[]{
  const zip=new PizZip(bytes),parse=(name:string)=>new DOMParser().parseFromString(zip.file(name)!.asText(),'application/xml');
  const section=parse('word/document.xml').getElementsByTagName('w:sectPr')[0];
  if(!section)return [];
  const margin=section.getElementsByTagName('w:pgMar')[0];
  const left=Number(margin?.getAttribute('w:left')||0)/20,top=Number(margin?.getAttribute('w:header')||0)/20;
  const first=section.getElementsByTagName('w:titlePg')[0];
  const type=first&&!['0','false'].includes(first.getAttribute('w:val')||'')?'first':'default';
  const header=Array.from(section.getElementsByTagName('w:headerReference')).find(node=>node.getAttribute('w:type')===type);
  const relations=parse('word/_rels/document.xml.rels');
  const target=Array.from(relations.getElementsByTagName('Relationship')).find(node=>node.getAttribute('Id')===header?.getAttribute('r:id'))?.getAttribute('Target');
  if(!target||!zip.file('word/'+target)||!zip.file('word/_rels/'+target+'.rels'))return [];
  const document=parse('word/'+target),images=parse('word/_rels/'+target+'.rels');
  const anchors=Array.from(document.getElementsByTagName('wp:anchor'));
  const groups=new Map<string,typeof anchors>();
  for(const anchor of anchors){
    const extent=anchor.getElementsByTagName('wp:extent')[0],image=anchor.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed');
    const width=Number(extent?.getAttribute('cx')),height=Number(extent?.getAttribute('cy'));
    if(image&&width>0&&height>0&&width<3_000_000&&height<3_000_000)groups.set(image,[...(groups.get(image)||[]),anchor]);
  }
  const result:Artwork[]=[];
  for(const [image,copies] of groups){
    if(copies.length<2||copies.some(anchor=>anchor.getAttribute('behindDoc')!=='1'||anchor.getAttribute('relativeHeight')!=='0'))continue;
    const anchor=copies[0],extent=anchor.getElementsByTagName('wp:extent')[0];
    const h=anchor.getElementsByTagName('wp:positionH')[0],v=anchor.getElementsByTagName('wp:positionV')[0];
    const hx=h?.getElementsByTagName('wp:posOffset')[0]?.textContent,vy=v?.getElementsByTagName('wp:posOffset')[0]?.textContent;
    if(hx==null||vy==null||!['column','margin','page'].includes(h.getAttribute('relativeFrom')||'')||!['paragraph','page'].includes(v.getAttribute('relativeFrom')||''))continue;
    const crop=anchor.getElementsByTagName('a:srcRect')[0];
    if(crop&&Array.from(crop.attributes).some(attribute=>['t','b','l','r'].includes(attribute.name)&&Number(attribute.value)!==0))continue;
    const asset=Array.from(images.getElementsByTagName('Relationship')).find(node=>node.getAttribute('Id')===image)?.getAttribute('Target');
    if(!asset?.endsWith('.png')||!zip.file('word/'+asset))continue;
    result.push({bytes:zip.file('word/'+asset)!.asNodeBuffer(),x:(h.getAttribute('relativeFrom')==='page'?0:left)+Number(hx)/EMU,top:Math.max(0,(v.getAttribute('relativeFrom')==='page'?0:top)+Number(vy)/EMU),width:Number(extent.getAttribute('cx'))/EMU,height:Number(extent.getAttribute('cy'))/EMU});
  }
  return result;
}

/** Restore source PNGs over LibreOffice's flattened watermark layers, only on
 * pages whose content draws those logos. Retain PDF text streams, fonts, page
 * boxes, background and metadata. Preview and approval packages use this same
 * renderer, and saved/sent files are never changed retrospectively. */
export async function restoreHeaderArtwork(docx:Buffer,bytes:Buffer):Promise<Buffer>{
  const artwork=sourceHeaderArtwork(docx);if(!artwork.length)return bytes;
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false}),embedded=await Promise.all(artwork.map(image=>pdf.embedPng(image.bytes)));
  let restored=0;
  for(const page of pdf.getPages()){
    const resources=page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
    if(!resources)continue;
    const matches=artwork.map(image=>resources.entries().filter(([,ref])=>{
      const object=pdf.context.lookup(ref);if(!(object instanceof PDFRawStream))return false;
      const width=object.dict.lookupMaybe(PDFName.of('Width'),PDFNumber)?.asNumber(),height=object.dict.lookupMaybe(PDFName.of('Height'),PDFNumber)?.asNumber();
      return !!width&&!!height&&Math.abs(width/height-image.width/image.height)<0.01;
    }).map(([name])=>name.asString()));
    const contents=pdf.context.lookup(page.node.get(PDFName.of('Contents')));
    const streams=contents instanceof PDFArray?contents.asArray().map(ref=>pdf.context.lookup(ref)):[contents];
    const commands=streams.filter((stream):stream is PDFRawStream=>stream instanceof PDFRawStream).map(stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n').split(/\s+/);
    const drawn=new Set(commands.filter((command,index)=>command.startsWith('/')&&commands[index+1]==='Do'));
    if(!matches.every(names=>names.some(name=>drawn.has(name))))continue;
    restored++;
    for(let index=0;index<artwork.length;index++){
      const image=artwork[index];page.drawImage(embedded[index],{x:image.x,y:page.getHeight()-image.top-image.height,width:image.width,height:image.height});
    }
  }
  if(!restored)throw new Error('The source header artwork was not found in the converted PDF.');
  return Buffer.from(await pdf.save({useObjectStreams:false}));
}
