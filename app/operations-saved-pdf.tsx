'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileText, RefreshCw } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { endpoint } from './operations-common';
import { DocumentPage } from './operations-document-editor';
import './operations-saved-pdf.css';

export default function SavedProposalPdf({src,title,legacy=false,onCurrentLayout}:{src:string;title:string;legacy?:boolean;onCurrentLayout?:()=>void}){
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[zoom,setZoom]=useState('fit'),[width,setWidth]=useState(760);
  const viewport=useRef<HTMLDivElement>(null);
  useEffect(()=>{const element=viewport.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(160,entry.contentRect.width-40)));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let active=true,task:{destroy:()=>Promise<void>}|undefined;const controller=new AbortController();setPdf(null);setReady(false);setError('');
    void(async()=>{try{
      const response=await fetch(src,{cache:'no-store',signal:controller.signal});if(!response.ok){const failure=await response.json() as {error?:string};throw Error(failure.error||'The saved PDF could not be opened.');}
      const bytes=new Uint8Array(await response.arrayBuffer()),renderer=await import('pdfjs-dist');if(!active)return;renderer.GlobalWorkerOptions.workerSrc=endpoint+'/pdf-worker';
      const loading=renderer.getDocument({data:bytes,enableXfa:false});task=loading;const document=await loading.promise;if(active)setPdf(document);else void document.loadingTask.destroy();
    }catch(failure){if(active)setError((failure as Error).message);}})();
    return()=>{active=false;controller.abort();void task?.destroy();};
  },[src,retry]);
  return <div className="ops-saved-pdf" role="region" aria-label={title}>
    <div className="ops-saved-pdf-toolbar"><span><FileText size={17}/>{legacy?'Earlier saved PDF':'Submitted PDF'}</span><div><label>Zoom<select aria-label="Proposal zoom" value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option></select></label><a className="ops-link" href={src} download><Download size={15}/>{legacy?'Download saved PDF':'Download PDF'}</a></div></div>
    {legacy&&<div className="ops-saved-pdf-legacy" role="note"><span><b>Earlier PDF layout</b>Saved before the latest layout updates.</span>{onCurrentLayout&&<button className="ops-btn" onClick={onCurrentLayout}>Preview current layout</button>}</div>}
    <div className="ops-doc-preview ops-saved-pdf-pages" ref={viewport} role="region" aria-label="Scrollable proposal document" tabIndex={0} aria-busy={!ready&&!error}>
      <div className="ops-doc-preview-status" role="status">{error?<span role="alert">{error}<button className="ops-link" onClick={()=>setRetry(value=>value+1)}>Retry preview</button></span>:ready?<><Check size={14}/>{legacy?'Earlier saved version':'Submitted version'} · {pdf?.numPages} pages</>:<><RefreshCw size={14} className="ops-spin"/>Opening saved PDF…</>}</div>
      {pdf&&Array.from({length:pdf.numPages},(_,index)=><DocumentPage key={index} pdf={pdf} number={index+1} width={width} zoom={zoom} onRendered={()=>{if(index===0)setReady(true);}} onError={()=>setError('A proposal page could not be displayed. Retry the preview.')}/>)}
    </div>
  </div>;
}
