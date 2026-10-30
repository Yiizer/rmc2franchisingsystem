'use client';
import { useEffect, useRef } from 'react';
import { Inbox, X } from 'lucide-react';
import type { Staff, WorkflowStatus } from '@/lib/operations/types';
export const endpoint='/api/operations';
export async function api<T>(path:string,body?:unknown):Promise<T>{
 let response:Response;try{response=await fetch(endpoint+'/'+path,{method:body===undefined?'GET':'POST',headers:body instanceof FormData?undefined:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),cache:'no-store'});}catch{throw new Error('We could not connect. Check your connection and try again.');}
 let result:T & {error?:string};try{result=await response.json();}catch{throw Object.assign(new Error('We could not read the response. Please try again.'),{status:response.status});}
 if(!response.ok)throw Object.assign(new Error(result.error||'We could not complete this request. Please try again.'),{status:response.status});return result;
}
export const staffName=(users:Staff[],id:string)=>users.find(u=>u.id===id)?.name||id;
export const initials=(name:string)=>name.split(' ').map(w=>w[0]).slice(0,2).join('');
export function Status({value}:{value:WorkflowStatus}){const tone=value==='Needs correction'?'red':value==='Preparing proposal'?'preparing':value==='New inquiry'?'blue':value==='Sent'?'green':['Awaiting approval','Supervisor editing'].includes(value)?'purple':value.includes('failed')||value==='Waiting for agent details'?'amber':'slate';return <span className={'ops-badge '+tone}><span className="ops-dot"/>{value}</span>;}
export function Modal({title,onClose,children,wide=false,drawer=false}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean;drawer?:boolean}){
  const dialog=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const focusable=()=>[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(element=>element.getClientRects().length>0);
    focusable()[0]?.focus();
    const handler=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close.current();}if(e.key==='Tab'){const items=focusable(),first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.current?.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.current?.contains(document.activeElement))){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className={'ops-modal-backdrop'+(drawer?' ops-drawer-backdrop':'')} onClick={onClose}><section ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={'ops-modal'+(wide?' ops-modal-wide':'')+(drawer?' ops-workspace-drawer':'')} onClick={e=>e.stopPropagation()}><div className="ops-card-head"><h2>{title}</h2><button className="ops-icon" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</section></div>;
}
export function Empty({text,hint='New inquiries and updates will appear here.'}:{text:string;hint?:string}){return <div className="ops-empty"><Inbox size={28}/><h3>{text}</h3><p>{hint}</p></div>;}

