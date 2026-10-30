'use client';
import type {ReactNode} from 'react';
import {TriangleAlert,Check} from 'lucide-react';
import './operations-conflict.css';
export default function ConflictCard({title,subtitle,matches,selected,onSelect,children,actions,label='Duplicate client review'}:{title:string;subtitle?:string;matches:{id:string;label:string;resolved?:boolean}[];selected:string;onSelect:(id:string)=>void;children:ReactNode;actions?:ReactNode;label?:string}){
 return <section className="ops-conflict-card" aria-label={label}><header><TriangleAlert size={21}/><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div></header>{matches.length>1&&<div className="ops-match-chips" aria-label="Matching registrations">{matches.map((m,i)=><button key={m.id} aria-pressed={m.id===selected} onClick={()=>onSelect(m.id)}>{m.resolved?<Check size={14}/>:<span aria-hidden="true">●</span>}Match {i+1} · {m.label}{m.resolved?' · Resolved':''}</button>)}</div>}<div className="ops-conflict-content">{children}</div>{actions&&<div className="ops-conflict-actions"><h3>What do you want to do?</h3>{actions}</div>}</section>;
}
