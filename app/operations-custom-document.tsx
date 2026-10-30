'use client';
import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline, RotateCcw, Pencil } from 'lucide-react';
import type { CustomEdit, CustomizedProposal, FormFields } from '@/lib/operations/types';
import type { EditableBlock } from '@/lib/operations/custom-documents';
import { endpoint } from './operations-common';

export default function CustomDocument({inquiryId,templateId,fields,customization,editable,onEdit,zoom}:{inquiryId:string;templateId:string;fields:FormFields;customization:CustomizedProposal;editable:boolean;zoom:string;onEdit:(id:string,edit:CustomEdit|null)=>void}){
  const root=useRef<HTMLDivElement>(null),styles=useRef<HTMLDivElement>(null),active=useRef<HTMLElement|null>(null),blocks=useRef<EditableBlock[]>([]);
  const latest=useRef({onEdit,customization,editable});latest.current={onEdit,customization,editable};
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(''),[retry,setRetry]=useState(0);
  // The parent remounts this view only for an explicit preview refresh.
  useEffect(()=>{
    let alive=true;const controller=new AbortController();
    async function load(){try{
      const response=await fetch(endpoint+'/custom-document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inquiryId,templateId,fields,edits:customization.edits}),signal:controller.signal});
      const data=await response.json() as {error?:string;docx:string;blocks:EditableBlock[]};if(!response.ok)throw new Error(data.error||'Could not open the customized document.');
      if(!alive)return;blocks.current=data.blocks;
      const renderer=await import('docx-preview'),bytes=Uint8Array.from(atob(data.docx),(char)=>char.charCodeAt(0));
      await renderer.renderAsync(bytes,root.current!,styles.current!,{className:'customdoc',inWrapper:true,ignoreHeight:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,useBase64URL:true});
      if(!alive)return;
      root.current!.querySelectorAll<HTMLElement>('section.customdoc').forEach(paper=>{
        const pageWidth=paper.clientWidth;
        // The HTML renderer expands some legacy VML group coordinates into
        // multi-metre images. Keep those unsupported decorative layers in the
        // native PDF, rather than letting them cover the editable text.
        paper.querySelectorAll<SVGElement>('svg').forEach(shape=>{if(shape.getBoundingClientRect().width>pageWidth*2)shape.style.display='none';});
      });
      // Word's auto-fit table sizing differs from HTML's minimum-content sizing.
      // Fit an oversized table to its native page content box, keeping relative
      // column widths. These DOM styles never change the saved Word document.
      root.current!.querySelectorAll<HTMLTableElement>('section.customdoc table').forEach(table=>{
        const available=table.parentElement!.clientWidth;
        if(available&&table.getBoundingClientRect().width>available){
          const columns=[...table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')];
          const widths=columns.map(col=>parseFloat(getComputedStyle(col).width)||1),total=widths.reduce((sum,width)=>sum+width,0);
          columns.forEach((col,index)=>col.style.width=(100*widths[index]/total)+'%');
          table.style.width=available+'px';table.style.maxWidth='100%';table.style.tableLayout='fixed';
        }
      });
      const byAnchor=new Map<string,EditableBlock>(data.blocks.map((block:EditableBlock)=>[block.anchor,block]));
      root.current!.querySelectorAll<HTMLElement>('[id^="rmc2_"]').forEach(anchor=>{
        const block=byAnchor.get(anchor.id),paragraph=anchor.closest('p');if(!block||!paragraph)return;
        paragraph.dataset.customBlock=block.id;paragraph.setAttribute('role','textbox');paragraph.setAttribute('aria-label',block.label);paragraph.setAttribute('aria-multiline','true');paragraph.setAttribute('tabindex','0');paragraph.contentEditable=String(latest.current.editable);paragraph.spellcheck=true;
        if(latest.current.customization.edits[block.id])paragraph.classList.add('custom-edited');
        paragraph.querySelectorAll('img,svg,[style*="position: absolute"]').forEach(node=>node.setAttribute('contenteditable','false'));
      });
      root.current!.querySelectorAll('a').forEach(link=>link.removeAttribute('href'));
      setLoading(false);
    }catch(failure){if(alive){setError((failure as Error).message);setLoading(false);}}}
    void load();return()=>{alive=false;controller.abort();};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[retry]);
  useEffect(()=>{root.current?.querySelectorAll<HTMLElement>('[data-custom-block]').forEach(el=>el.contentEditable=String(editable));},[editable]);
  useEffect(()=>{const host=root.current;if(!host||loading)return;const resize=()=>{host.querySelectorAll<HTMLElement>('section.customdoc').forEach(paper=>{const nativeWidth=parseFloat(getComputedStyle(paper).width)||794;paper.style.zoom=String(zoom==='fit'?Math.max(.15,Math.min(1.25,(host.clientWidth-40)/nativeWidth)):Number(zoom));});};const observer=new ResizeObserver(resize);observer.observe(host);resize();return()=>observer.disconnect();},[loading,zoom]);
  const current=customization.edits[selected];
  function capture(element:HTMLElement){const id=element.dataset.customBlock!;const text=element.innerText.replace(/\r/g,'').replace(/\n$/,'');const before=blocks.current.find(block=>block.id===id);const edit={...(latest.current.customization.edits[id]||{}),text};element.classList.toggle('custom-edited',text!==before?.original||Object.keys(edit).length>1);latest.current.onEdit(id,text===before?.original&&Object.keys(edit).length===1?null:edit);}
  function format(values:Partial<CustomEdit>){const element=active.current;if(!element||!editable)return;const id=element.dataset.customBlock!,edit={...(customization.edits[id]||{}),text:element.innerText.replace(/\n$/,''),...values};
    if(values.bold!==undefined)element.style.fontWeight=values.bold?'bold':'normal';if(values.italic!==undefined)element.style.fontStyle=values.italic?'italic':'normal';if(values.underline!==undefined)element.style.textDecoration=values.underline?'underline':'none';if(values.fontSize)element.style.fontSize=values.fontSize+'pt';if(values.color)element.style.color='#'+values.color;if(values.align)element.style.textAlign=values.align==='both'?'justify':values.align;
    element.querySelectorAll<HTMLElement>('span').forEach(span=>{if(values.bold!==undefined)span.style.fontWeight='inherit';if(values.italic!==undefined)span.style.fontStyle='inherit';if(values.underline!==undefined)span.style.textDecoration='inherit';if(values.fontSize)span.style.fontSize='inherit';if(values.color)span.style.color='inherit';});
    element.classList.add('custom-edited');onEdit(id,edit);element.focus({preventScroll:true});
  }
  function plainInsert(text:string){if(!latest.current.editable)return;const selection=window.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);if(active.current)capture(active.current);}
  function reset(){const element=active.current,block=blocks.current.find(b=>b.id===selected);if(!element||!block)return;onEdit(selected,null);setRetry(value=>value+1);setLoading(true);setSelected('');active.current=null;}
  return <div className="ops-custom-editor">
    <div className="ops-custom-format" aria-label="Customized document formatting">
      <span><Pencil size={14}/>{!editable?'View only':selected?'Editing '+(blocks.current.find(b=>b.id===selected)?.label||'text'):'Click any text to edit'}</span>
      <div><button type="button" aria-label="Bold paragraph" aria-pressed={!!current?.bold} disabled={!selected||!editable} onClick={()=>format({bold:!current?.bold})}><Bold size={15}/></button><button type="button" aria-label="Italic paragraph" aria-pressed={!!current?.italic} disabled={!selected||!editable} onClick={()=>format({italic:!current?.italic})}><Italic size={15}/></button><button type="button" aria-label="Underline paragraph" aria-pressed={!!current?.underline} disabled={!selected||!editable} onClick={()=>format({underline:!current?.underline})}><Underline size={15}/></button><select aria-label="Paragraph font size" disabled={!selected||!editable} value={current?.fontSize||''} onChange={e=>format({fontSize:Number(e.target.value)})}><option value="" disabled>Size</option>{[8,9,10,11,12,14,16,18,20,24,28,36,48].map(size=><option key={size}>{size}</option>)}</select><input type="color" aria-label="Paragraph text color" disabled={!selected||!editable} value={'#'+(current?.color||'102b53')} onChange={e=>format({color:e.target.value.slice(1)})}/>{([['left',AlignLeft],['center',AlignCenter],['right',AlignRight]] as const).map(([align,Icon])=><button type="button" aria-label={'Align '+align} key={align} disabled={!selected||!editable} onClick={()=>format({align})}><Icon size={15}/></button>)}<button type="button" aria-label="Restore original paragraph" disabled={!selected||!editable||!current} onClick={reset}><RotateCcw size={15}/></button></div>
    </div>
    {loading&&<p className="ops-custom-loading" role="status">Opening editable proposal…</p>}{error&&<p className="ops-custom-error" role="alert">{error}<button onClick={()=>{setError('');setLoading(true);setRetry(value=>value+1);}}>Try again</button></p>}
    <div ref={styles}/><div className="ops-custom-canvas" ref={root} aria-label="Editable customized proposal" onFocusCapture={event=>{const element=(event.target as HTMLElement).closest<HTMLElement>('[data-custom-block]');if(element){active.current=element;setSelected(element.dataset.customBlock!);}}} onInput={event=>{const element=(event.target as HTMLElement).closest<HTMLElement>('[data-custom-block]');if(element&&editable)capture(element);}} onPaste={event=>{if((event.target as HTMLElement).closest('[data-custom-block]')){event.preventDefault();plainInsert(event.clipboardData.getData('text/plain'));}}} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();const key=event.key.toLowerCase();format(key==='b'?{bold:!current?.bold}:key==='i'?{italic:!current?.italic}:{underline:!current?.underline});return;}if(event.key==='Enter'&&(event.target as HTMLElement).closest('[data-custom-block]')){event.preventDefault();plainInsert('\n');}}}/>
  </div>;
}
