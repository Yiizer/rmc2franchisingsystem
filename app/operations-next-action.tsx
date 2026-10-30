'use client';
import type {ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
// tone: 'action' = orange main step (default); 'start' = blue "available to pick up"; 'secondary' = navy outline.
export type PrimaryAction={label:string;disabled?:boolean;reason?:string;onClick?:()=>void|Promise<unknown>;href?:string;tone?:'action'|'start'|'secondary';forward?:boolean};
const toneClass={action:'primary',start:'ops-handling-start',secondary:'secondary'};
export default function NextAction({action,reason,status,children}:{action?:PrimaryAction;reason?:string;status?:ReactNode;children?:ReactNode}){
 const className='ops-btn ops-next-main '+toneClass[action?.tone||'action'];
 const label=<>{action?.label}{action?.forward&&<ArrowRight size={16} aria-hidden="true"/>}</>;
 return <section className="ops-next-action-panel" aria-label="Next action"><h2>Next action</h2>{status}
  {action&&(action.href?<a className={className} href={action.href}>{label}</a>:<button className={className} disabled={action.disabled} onClick={()=>void action.onClick?.()}>{label}</button>)}
  {(action?.reason||reason)&&<p className="ops-locked-reason" role="status">{action?.reason||reason}</p>}
  <div className="ops-next-secondary">{children}</div></section>;
}
