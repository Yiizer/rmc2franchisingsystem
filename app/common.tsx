"use client";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Inbox, CircleAlert, Clock3, CheckCircle2, FilePenLine, ClipboardCheck, Mail, XCircle } from 'lucide-react';
import type { TaskSignal } from './task-signals';
export function Pick({value,onChange,options,label}:{value:string;onChange:(v:string)=>void;options:string[];label:string}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>}
export function Badge({status}:{status:string}){const icons:Record<string,typeof Inbox>={'New inquiry':Inbox,'In progress':FilePenLine,'Draft':FilePenLine,'Awaiting approval':Clock3,'Needs revision':CircleAlert,'Approved':Mail,'Sent':CheckCircle2,'Rejected':XCircle,'Verified':CheckCircle2,'Review required':ClipboardCheck};const Icon=icons[status];return <span className={'badge status-'+status.toLowerCase().replaceAll(' ','-')}>{Icon&&<Icon size={14} aria-hidden="true"/>}{status}</span>}
export function TaskCue({signal}:{signal:TaskSignal}){const Icon=signal.tone==='critical'?CircleAlert:signal.tone==='warning'?ClipboardCheck:signal.tone==='ready'||signal.tone==='complete'?CheckCircle2:signal.tone==='waiting'?Clock3:FilePenLine;return <span className={'task-cue tone-'+signal.tone}><Icon size={14} aria-hidden="true"/>{signal.label}</span>}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
export function Empty({text}:{text:string}){return <div className="empty"><Inbox size={32}/><h3>{text}</h3><p>Try another filter or simulate a new inquiry.</p></div>}
export function Brand(){return <div className="brand"><img src="/rmc2-logo.png" alt="RMC2 Consultancy Corporation"/><div><b>RMC2</b><small>CONSULTANCY CORP.</small></div></div>}

