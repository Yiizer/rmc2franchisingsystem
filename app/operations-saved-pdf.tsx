'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, FileText, RefreshCw } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { endpoint } from './operations-common';
import { DocumentPage } from './operations-document-editor';
import './operations-saved-pdf.css';
import { useProposalDetailCheck, ProposalCheckButton, ProposalCheckResults, type ProposalCheckInputs, type ProposalCheckState } from './operations-proposal-checks';

/** True at phone width (≤760px). Starts false so the server render and first paint match the desktop layout. */
const PHONE_QUERY='(max-width:760px)';
const subscribePhone=(change:()=>void)=>{const query=window.matchMedia(PHONE_QUERY);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);};
export function usePhoneWidth(){
  return useSyncExternalStore(subscribePhone,()=>window.matchMedia(PHONE_QUERY).matches,()=>false);
}

/** Phones: a sent proposal is final, so show a short file card instead of drawing every page with pdf.js. */
export function SentProposalCard({src,wordHref,filename,pageCount}:{src:string;wordHref:string;filename:string;pageCount?:number}){
  return <div className="ops-sent-file-card" role="region" aria-label="Sent proposal file">
    <div className="ops-sent-file-name"><FileText size={22} aria-hidden="true"/><span><b>{filename}.pdf</b><small>{pageCount?pageCount+' pages · ':''}Sent to the agent</small></span></div>
    <a className="ops-btn primary" href={src} target="_blank" rel="noreferrer">Open PDF</a>
    <a className="ops-btn secondary" href={wordHref}><Download size={15}/>Word</a>
  </div>;
}

export default function SavedProposalPdf({src,title,legacy=false,onCurrentLayout,checkInput,check,hideChecker=false,hideDownload=false}:{checkInput?:ProposalCheckInputs;check?:ProposalCheckState;hideChecker?:boolean;hideDownload?:boolean;src:string;title:string;legacy?:boolean;onCurrentLayout?:()=>void}){
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[zoom,setZoom]=useState('fit'),[width,setWidth]=useState(760);
  const ownCheck=useProposalDetailCheck(check?undefined:checkInput),detailCheck=check||ownCheck,hasCheck=!!check||!!checkInput;
  const viewport=useRef<HTMLDivElement>(null);
  useEffect(()=>{const element=viewport.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(160,entry.contentRect.width-40)));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let active=true,task:{destroy:()=>Promise<void>}|undefined;const controller=new AbortController();setPdf(null);setReady(false);setError('');
    void(async()=>{try{
      const response=await fetch(src,{cache:'no-store',signal:controller.signal});if(!response.ok){const failure=await response.json() as {error?:string};throw Error(failure.error||'The saved PDF could not be opened.');}
      const bytes=new Uint8Array(await response.arrayBuffer()),renderer=await import('pdfjs-dist');if(!active)return;renderer.GlobalWorkerOptions.workerSrc=endpoint+'/pdf-worker';
      const loading=renderer.getDocument({data:bytes,enableXfa:false});task=loading;const document=await loading.promise;if(active)setPdf(document);else void document.loadingTask.destroy();
    }catch(failure){if(active)setError("The preview couldn't load. Open the PDF, or try again.");}})();
    return()=>{active=false;controller.abort();void task?.destroy();};
  },[src,retry]);
  return <div className="ops-saved-pdf" role="region" aria-label={title}>
    <div className="ops-saved-pdf-toolbar"><span><FileText size={17}/>{legacy?'Earlier saved PDF':'Submitted PDF'}</span><div>{hasCheck&&!hideChecker&&<div className="ops-saved-check-control"><div className="ops-checker-label"><b>AI proposal checker</b><small>Simulated AI · staff review required</small></div><ProposalCheckButton check={detailCheck}/></div>}<label>Zoom<select aria-label="Proposal zoom" value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option></select></label>{!hideDownload&&<a className="ops-link" href={src} download><Download size={15}/>{legacy?'Download saved PDF':'Download PDF'}</a>}</div></div>
    {hasCheck&&<ProposalCheckResults check={detailCheck}/>}
    {legacy&&<div className="ops-saved-pdf-legacy" role="note"><span><b>Earlier PDF layout</b>Saved before the latest layout updates.</span>{onCurrentLayout&&<button className="ops-btn" onClick={onCurrentLayout}>Preview current layout</button>}</div>}
    <div className="ops-doc-preview ops-saved-pdf-pages" ref={viewport} role="region" aria-label="Scrollable proposal document" tabIndex={0} aria-busy={!ready&&!error}>
      <div className="ops-doc-preview-status" role="status">{error?<span role="alert">{error}<a className="ops-btn secondary" href={src} target="_blank" rel="noreferrer">Open PDF</a><button className="ops-btn secondary" onClick={()=>setRetry(value=>value+1)}>Retry preview</button></span>:ready?<><Check size={14}/>{legacy?'Earlier saved version':'Submitted version'} · {pdf?.numPages} pages</>:<><RefreshCw size={14} className="ops-spin"/>Opening saved PDF…</>}</div>
      {pdf&&Array.from({length:pdf.numPages},(_,index)=><DocumentPage key={index} pdf={pdf} number={index+1} width={width} zoom={zoom} onRendered={()=>{if(index===0)setReady(true);}} onError={()=>setError("The preview couldn't load. Open the PDF, or try again.")}/>)}
    </div>
  </div>;
}
