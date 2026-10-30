'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
import type {PrimaryAction} from './operations-next-action';

const toneClass={action:'primary',start:'primary',secondary:'secondary'};

// Handling and save controls stay left; the workflow action stays right.
export default function ActionBar({action,reason,left,right}:{action?:PrimaryAction;reason?:string;left?:ReactNode;right?:ReactNode}){
 const bar=useRef<HTMLElement>(null);
 // Publish the bar's real height so the page can always clear it, however many rows it wraps to.
 useLayoutEffect(()=>{const element=bar.current,host=element?.closest<HTMLElement>('.ops-workspace-redesign');if(!element||!host)return;const root=document.documentElement,set=()=>{const height=Math.ceil(element.offsetHeight)+'px';host.style.setProperty('--ops-action-bar-h',height);root.style.setProperty('--ops-action-bar-h',height);};set();const observer=new ResizeObserver(set);observer.observe(element);return()=>{observer.disconnect();host.style.removeProperty('--ops-action-bar-h');root.style.removeProperty('--ops-action-bar-h');};},[]);
 const className='ops-btn ops-next-main '+toneClass[action?.tone||'action'];
 const label=<>{action?.label}{action?.forward&&<ArrowRight size={16} aria-hidden="true"/>}</>;
 const hint=action?.reason||reason;
 return <section ref={bar} className="ops-action-bar" aria-label="Next action">
  <div className="ops-action-bar-left">
   {left}
  </div>
  <div className="ops-action-bar-right">
   {hint&&<p className="ops-locked-reason" role="status">{hint}</p>}
   {right}
   {action&&(action.href?<a className={className} href={action.href}>{label}</a>:<button className={className} disabled={action.disabled} title={action.disabled?hint:undefined} onClick={()=>void action.onClick?.()}>{label}</button>)}
  </div>
 </section>;
}
