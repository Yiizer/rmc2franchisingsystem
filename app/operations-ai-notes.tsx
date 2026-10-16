'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';

export default function ProposalAiNotes({children,onClose,title='AI proposal notes',context='Form + supplied templates'}:{children:ReactNode;onClose:()=>void;title?:string;context?:string}){
  const panel=useRef<HTMLElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const [overflow,setOverflow]=useState(0);
  useEffect(()=>{
    const element=panel.current;if(!element)return;
    returnFocus.current=document.activeElement as HTMLElement|null;
    const editor=element.closest('.ops-doc-editor');
    const measure=()=>{
      const style=getComputedStyle(element),top=Number.parseFloat(style.getPropertyValue('--ops-doc-sticky-top'))||80;
      const available=Number.parseFloat(style.getPropertyValue('--ops-doc-available-height'))||window.innerHeight-top-24;
      setOverflow(Math.max(0,element.getBoundingClientRect().height-available));
    };
    const observer=new ResizeObserver(measure);observer.observe(element);if(editor)observer.observe(editor);
    window.addEventListener('resize',measure);measure();
    if(window.matchMedia(element.closest('.ops-review-stage')?'(max-width:1200px)':'(max-width:760px)').matches)element.scrollIntoView({behavior:'smooth',block:'start'});
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  function close(){onClose();requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});});}
  return <aside ref={panel} className="ops-ai-notes" aria-label={title} style={{'--ops-ai-overflow':overflow+'px'} as CSSProperties}>
    <div className="ops-ai-notes-header"><h3><Sparkles size={16}/>{title}</h3><button className="ops-icon" aria-label="Close AI notes" onClick={close}><X size={17}/></button></div>
    <div className="ops-ai-notes-meta"><span className="ops-badge slate">AI simulated</span><span>{context}</span></div>
    <div className="ops-ai-notes-body" aria-live="polite">{children}</div>
  </aside>;
}
