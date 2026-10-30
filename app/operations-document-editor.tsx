'use client';
import { manilaTime } from '@/lib/operations/types';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Download, FileText, RefreshCw, RotateCcw, Check, Eye, Sparkles } from 'lucide-react';
import CustomDocument from './operations-custom-document';
import type { CatalogTemplate, FormFields, CustomizedProposal, CustomEdit, GeneratedPackage } from '@/lib/operations/types';
import { addresseeName, philippinePhone, proposalTitles } from '@/lib/operations/proposal-fields';
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import { endpoint } from './operations-common';
import ProposalAiNotes from './operations-ai-notes';
import ProposalDetailChecks, { useProposalDetailCheck, ProposalCheckButton, ProposalCheckResults } from './operations-proposal-checks';
import { sameProposalFields, sameProposalEdits } from '@/lib/operations/proposal-state';
import './operations-document.css';
import './operations-document-controls.css';

const slots=['proposalDate','addresseeTitle','addressee','addresseePosition','company','address','agentName','agentPhone'] as const;
const slotLabels:Record<string,string>={proposalDate:'Proposal date',addresseeTitle:'Title',addressee:'Client / addressee',addresseePosition:'Position / designation',company:'Account name',address:'Account address',agentName:'Agent name',agentPhone:'Agent contact number'};
export default function ProposalDocumentEditor({template,fields,originalFields,editable,busy,onField,onSave,onChoose,onClose,savedAt,embedded=false,externalAssistance=false,helpVisible=false,onDismissHelp,helpContent,customization,inquiryId,onCustomEdit,prepared,previewOnly=false,dirty=true}:{
  dirty?:boolean;customization?:CustomizedProposal;previewOnly?:boolean;prepared?:GeneratedPackage;inquiryId?:string;onCustomEdit?:(id:string,edit:CustomEdit|null)=>void;
  template:CatalogTemplate;fields:FormFields;originalFields:FormFields;editable:boolean;busy:boolean;
  onField:(key:string,value:string)=>void;onSave:()=>Promise<boolean>;onChoose?:()=>void;onClose?:()=>void;savedAt:string;embedded?:boolean;externalAssistance?:boolean;helpVisible?:boolean;onDismissHelp?:()=>void;helpContent?:ReactNode;
}){
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[zoom,setZoom]=useState('fit'),[original,setOriginal]=useState(false);
  const [renderedPdf,setRenderedPdf]=useState<PDFDocumentProxy|null>(null),[snapshot,setSnapshot]=useState(JSON.stringify({fields,customEdits:customization?.edits})),[customEditing,setCustomEditing]=useState(!!customization&&editable);
  const [width,setWidth]=useState(760),[localSaving,setLocalSaving]=useState(false),[geometry,setGeometry]=useState({top:128,toolbarTop:64,available:700}),[checked,setChecked]=useState(false),[localTemplateHelp,setLocalTemplateHelp]=useState(false);
  const viewport=useRef<HTMLDivElement>(null),sidebar=useRef<HTMLElement>(null),editor=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null),activePdf=useRef<PDFDocumentProxy|null>(null);
  const snapshotValues=JSON.parse(snapshot) as {fields:FormFields;customEdits?:Record<string,CustomEdit>};
  const updating=loading||(!error&&pdf!==renderedPdf),outdated=!sameProposalFields(fields,snapshotValues.fields)||!sameProposalEdits(customization?.edits,snapshotValues.customEdits);
  const savedPdf=inquiryId&&prepared?endpoint+'/file/'+inquiryId+'/pdf?package='+prepared.id:'';
  const useSavedPdf=!!inquiryId&&!!prepared&&!original&&prepared.templateId===template.id&&prepared.sourceHash===template.sourceHash&&prepared.customization?.id===customization?.id&&sameProposalFields(snapshotValues.fields,prepared.fields)&&sameProposalEdits(snapshotValues.customEdits,prepared.customization?.edits);
  const detailCheck=useProposalDetailCheck({fields,originalFields,template,customization});
  const checks=detailCheck.stale ? [] : detailCheck.snapshot?.checks || [];
  useEffect(()=>{const element=viewport.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(160,entry.contentRect.width-40)));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const root=editor.current,bar=toolbar.current;if(!root||!bar)return;
    const dialog=root.closest('.ops-modal') as HTMLElement|null;
    const header=dialog?.querySelector(':scope > .ops-card-head') as HTMLElement|null;
    const footer=root.querySelector('.ops-doc-footer') as HTMLElement|null;
    const measure=()=>{
      const toolbarTop=dialog?(header?.getBoundingClientRect().height||64):64;
      const top=toolbarTop+bar.getBoundingClientRect().height+8;
      const available=dialog?dialog.clientHeight-top-(footer?.getBoundingClientRect().height||0)-12:window.innerHeight-top-16;
      setGeometry(previous=>previous.top===top&&previous.available===available&&previous.toolbarTop===toolbarTop?previous:{top,toolbarTop,available});
    };
    const observer=new ResizeObserver(measure);observer.observe(bar);if(dialog)observer.observe(dialog);if(header)observer.observe(header);if(footer)observer.observe(footer);
    window.addEventListener('resize',measure);measure();return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[embedded]);
  useEffect(()=>{if(prepared&&prepared.templateId===template.id&&prepared.customization?.id===customization?.id&&sameProposalFields(fields,prepared.fields)&&sameProposalEdits(customization?.edits,prepared.customization?.edits)){setOriginal(false);setSnapshot(JSON.stringify({fields:prepared.fields,customEdits:prepared.customization?.edits}));}},[prepared?.id]);
  useEffect(()=>{if(!editable)setSnapshot(JSON.stringify({fields,customEdits:customization?.edits}));},[editable,fields,customization]);
  useEffect(()=>{if(helpVisible){setChecked(false);setLocalTemplateHelp(false);}},[helpVisible]);
  useEffect(()=>{
    let active=true,settled=false;const controller=new AbortController();let documentTask:{destroy:()=>Promise<void>}|undefined;
    setLoading(true);setError('');setRenderedPdf(null);
    async function load(){try{
      const response=await fetch(useSavedPdf?savedPdf:endpoint+'/proposal-preview',useSavedPdf?{signal:controller.signal,cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateId:template.id,fields:JSON.parse(snapshot).fields,original,...(customization?{inquiryId,customEdits:JSON.parse(snapshot).customEdits}:{})}),signal:controller.signal,cache:'no-store'});
      if(!response.ok){const failure=await response.json() as {error?:string};throw new Error(failure.error||'The preview could not be prepared.');}
      const bytes=new Uint8Array(await response.arrayBuffer()),renderer=await import('pdfjs-dist');renderer.GlobalWorkerOptions.workerSrc=endpoint+'/pdf-worker';if(!active)return;
      const task=renderer.getDocument({data:bytes,enableXfa:false});documentTask=task;const result=await task.promise;
      if(active){settled=true;const previous=activePdf.current;activePdf.current=result;setPdf(result);setLoading(false);void previous?.loadingTask.destroy();}else await result.loadingTask.destroy();
    }catch(failure){if(active){setError((failure as Error).message);setLoading(false);}}}
    void load();return()=>{active=false;controller.abort();if(!settled)void documentTask?.destroy();};
  },[template.id,template.sourceHash,snapshot,original,retry,useSavedPdf,savedPdf]);
  useEffect(()=>()=>{void activePdf.current?.loadingTask.destroy();},[]);
  function updatePreview(){setOriginal(false);setSnapshot(JSON.stringify({fields,customEdits:customization?.edits}));setRetry(value=>value+1);}
  async function save(){setLocalSaving(true);try{if(await onSave()&&!embedded)onClose?.();}finally{setLocalSaving(false);}}
  const notesOpen=!externalAssistance&&(checked||helpVisible||localTemplateHelp);
  function closeNotes(){setChecked(false);setLocalTemplateHelp(false);onDismissHelp?.();}
  function toggleNotes(){if(notesOpen)closeNotes();else if(helpContent)setLocalTemplateHelp(true);else setChecked(true);}
  return <div ref={editor} className={'ops-doc-editor'+(embedded?' embedded':'')+(geometry.available<620?' compact':'')+(geometry.available<500?' short':'')} style={{'--ops-doc-sticky-top':geometry.top+'px','--ops-doc-toolbar-top':geometry.toolbarTop+'px','--ops-doc-available-height':geometry.available+'px'} as CSSProperties}>
    <div ref={toolbar} className="ops-doc-toolbar">{customization&&<div className="ops-custom-view-tabs">{!embedded&&<span className="ops-badge customized">Customized</span>}<button className="ops-btn" aria-pressed={customEditing} disabled={!editable} onClick={()=>setCustomEditing(true)}>Edit document</button><button className="ops-btn" aria-pressed={!customEditing} onClick={()=>{updatePreview();setCustomEditing(false);}}>PDF preview</button></div>}<div><FileText size={18}/><b>{template.sourceId}</b><span>{template.variant}</span></div><div><button className="ops-btn" aria-pressed={original} onClick={()=>{setOriginal(!original);if(customization)setCustomEditing(false);}}><Eye size={15}/>{original?'Show filled proposal':'Show blank template'}</button><label>Zoom<select aria-label="Proposal zoom" value={zoom} onChange={e=>setZoom(e.target.value)}><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option></select></label><a className="ops-link" href={endpoint+'/source/'+template.id}><Download size={15}/>Blank Word template</a>{useSavedPdf&&!outdated&&<a className="ops-link" href={savedPdf} download><Download size={15}/>Download PDF</a>}{!externalAssistance&&<button className="ops-btn ops-ai-toggle" aria-expanded={notesOpen} onClick={toggleNotes}><Sparkles size={15}/>AI notes</button>}</div></div>
    <div className={'ops-doc-layout'+(notesOpen?' has-ai-notes':'')}>
      <div className="ops-doc-sidebar-column"><aside ref={sidebar} className="ops-doc-fields">
        <div className="ops-doc-fields-scroll" role="region" aria-label="Proposal fields" tabIndex={0}><div className="ops-doc-fields-intro"><h3>{editable?'Fill proposal details':'Proposal details'}</h3><p>{editable?<>From the form. Click <b>Update preview</b> after edits.</>:<>This version is read-only.</>}</p></div>
        <div className="ops-doc-field-grid">{slots.map(key=>{const check=checks.find(c=>c.field===key),value=fields[key]||'';return <label key={key} className={'ops-doc-field'+(['address','addressee','addresseePosition','company'].includes(key)?' wide':'')}>
          <span className="ops-doc-field-label"><span>{key==='agentPhone'?'Agent phone':key==='addresseePosition'?'Position':key==='addressee'?'Client name':slotLabels[key]}</span>{check&&<span className="ops-edited">{check.kind==='error'?'Check':'Changed'}</span>}{editable&&check&&key!=='addresseeTitle'&&<button type="button" className="ops-doc-restore" aria-label={'Restore '+slotLabels[key]+' from form'} title="Use submitted form value" disabled={busy||localSaving} onClick={()=>onField(key,originalFields[key==='proposalDate'?'requestDate':key]||'')}><RotateCcw size={12}/></button>}</span>
          {key==='addresseeTitle'?<select aria-label="Addressee title" value={value} disabled={!editable||busy||localSaving} onChange={e=>onField(key,e.target.value)}>{proposalTitles.map(title=><option key={title} value={title}>{title||'No title'}</option>)}</select>:key==='address'?<textarea rows={2} aria-label={slotLabels[key]} value={value} disabled={!editable||busy||localSaving} onChange={e=>onField(key,e.target.value)}/>:<input aria-label={slotLabels[key]} type={key==='proposalDate'?'date':'text'} value={value} disabled={!editable||busy||localSaving} onChange={e=>onField(key,e.target.value)} onBlur={()=>{if(key==='agentPhone'&&editable){const phone=philippinePhone(value);if(phone.valid&&phone.display!==value)onField(key,phone.display);}}}/>}
          {key==='agentPhone'&&value&&<small className={philippinePhone(value).valid?'':'ops-field-error'}>{philippinePhone(value).valid?'PDF: '+philippinePhone(value).display.replace(' ',''):'Check the Philippine contact number.'}</small>}
        </label>;})}</div>
        <p className="ops-doc-salutation"><b>Greeting:</b> Dear {addresseeName(fields)||'[Client]'}:</p>
        <p className="ops-doc-field-note">{customization?(editable?"Edit text, rates and benefits directly in the document. Check PDF preview before submitting.":"Saved customized proposal · view only"):"Template benefits and artwork stay unchanged."}</p>
        </div>
        <div className="ops-doc-action-dock">
        <ProposalCheckResults check={detailCheck}/>
        <footer className="ops-doc-controls" aria-label="Proposal editing controls">
          {editable && <div className="ops-doc-field-actions">
            <button className="ops-btn ops-save-changes" disabled={busy||localSaving||!dirty} onClick={save}>{localSaving?'Saving…':'Save changes'}</button>
            <button className="ops-btn" disabled={busy||localSaving||updating} onClick={updatePreview}><RefreshCw size={15}/>Update preview</button>
          </div>}
          <div className="ops-checker-label"><b>AI proposal checker</b><small>Simulated AI · staff review required</small></div><ProposalCheckButton check={detailCheck} disabled={busy||localSaving}/>
          <small className="ops-doc-control-status" role="status">{editable && (busy||localSaving ? 'Please wait · ' : dirty ? 'Unsaved changes · ' : 'All changes saved · ')}{outdated&&!original?'Preview needs updating':'Compare with the submitted form'}</small>
        </footer>
        </div>
      </aside></div>
      <div className="ops-doc-document-area" role="region" tabIndex={0} aria-label="Scrollable proposal document">
      {customization&&customEditing&&inquiryId&&<CustomDocument zoom={zoom} key={customization.id+":"+retry} inquiryId={inquiryId} templateId={template.id} fields={JSON.parse(snapshot).fields} customization={customization} editable={editable&&!busy} onEdit={onCustomEdit||(()=>{})}/>}
      <div style={{display:customization&&customEditing?"none":undefined}} className="ops-doc-preview" ref={viewport} role="region" tabIndex={0} aria-label="Formatted proposal pages" aria-busy={updating}>
        <div className="ops-doc-preview-status" role="status">{updating?<><RefreshCw size={14} className="ops-spin"/>{pdf?'Updating preview…':'Opening template layout…'}</>:error?<span role="alert">{error}<button className="ops-link" onClick={()=>setRetry(retry+1)}>Retry preview</button></span>:<><Check size={14}/><span className="ops-doc-scroll-hint">Scroll here to read · </span>{original?'Blank template':outdated?'Preview has pending edits':useSavedPdf?'Saved PDF':'Preview updated'} · {pdf?.numPages} pages</>}</div>
        {!pdf&&<div className="ops-doc-loading"><FileText size={32}/><p>{error?'Preview unavailable':'Preparing the proposal pages…'}</p></div>}
        {pdf&&Array.from({length:pdf.numPages},(_,index)=><DocumentPage key={index} pdf={pdf} number={index+1} width={width} zoom={zoom} onRendered={()=>{if(index===0&&activePdf.current===pdf)setRenderedPdf(pdf);}} onError={()=>setError('A proposal page could not be displayed. Retry the preview.')}/>) }
      </div></div>
      {notesOpen&&<div className="ops-doc-notes-column"><ProposalAiNotes onClose={closeNotes}>
        {!checked&&helpContent?helpContent:<ProposalDetailChecks fields={fields} originalFields={originalFields} template={template} customization={customization}/>}
      </ProposalAiNotes></div>}
    </div>
    {!embedded&&<div className="ops-doc-footer"><p>{previewOnly?'Current layout preview':'Original template layout.'}<small>{previewOnly?'Preview only · not the saved submission':<>Saved {manilaTime(savedAt)}</>}</small></p><button className="ops-btn" onClick={onClose}>Close</button>{onChoose&&<button className="ops-btn primary" onClick={onChoose}>Use this template</button>}</div>}
  </div>;
}

export function DocumentPage({pdf,number,width,zoom,onRendered,onError}:{pdf:PDFDocumentProxy;number:number;width:number;zoom:string;onRendered:()=>void;onError:()=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:width,height:width*1.42});
  const callbacks=useRef({onRendered,onError});callbacks.current={onRendered,onError};
  useEffect(()=>{
    let active=true,renderTask:RenderTask|undefined,textTask:TextLayer|undefined;
    async function render(){try{
      const page=await pdf.getPage(number);if(!active)return;
      const base=page.getViewport({scale:1}),scale=zoom==='fit'?Math.min(1.25,width/base.width):Number(zoom),view=page.getViewport({scale});
      setSize({width:view.width,height:view.height});
      const element=canvas.current!;const ratio=Math.min(window.devicePixelRatio||1,2);
      element.width=Math.ceil(view.width*ratio);element.height=Math.ceil(view.height*ratio);
      renderTask=page.render({canvas:element,viewport:view,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
      await renderTask.promise;
      if(!active)return;
      const {TextLayer}=await import('pdfjs-dist');const layer=text.current!;layer.replaceChildren();layer.style.setProperty('--total-scale-factor',String(scale));
      textTask=new TextLayer({textContentSource:await page.getTextContent(),container:layer,viewport:view});await textTask.render();if(active)callbacks.current.onRendered();
    }catch(failure){if(active){console.error('Proposal page could not be rendered',failure);callbacks.current.onError();}}}
    void render();return()=>{active=false;renderTask?.cancel();textTask?.cancel();};
  },[pdf,number,width,zoom]);
  return <figure className="ops-doc-page" style={{width:size.width}}><figcaption>Page {number}</figcaption><div className="ops-doc-paper" style={{width:size.width,height:size.height}}><canvas ref={canvas} role="img" aria-label={'Proposal page '+number} style={{width:size.width,height:size.height}}/><div ref={text} className="ops-doc-text-layer"/></div></figure>;
}
