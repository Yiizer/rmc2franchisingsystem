"use client";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Inbox } from 'lucide-react';
export function Pick({value,onChange,options,label}:{value:string;onChange:(v:string)=>void;options:string[];label:string}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>}
export function Badge({status}:{status:string}){return <span className={'badge status-'+status.toLowerCase().replaceAll(' ','-')}>{status}</span>}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
export function Empty({text}:{text:string}){return <div className="empty"><Inbox size={32}/><h3>{text}</h3><p>Try another filter or simulate a new inquiry.</p></div>}
export function Brand(){return <div className="brand"><img src="/rmc2-logo.png" alt="RMC2 Consultancy Corporation"/><div><b>RMC2</b><small>CONSULTANCY CORP.</small></div></div>}

