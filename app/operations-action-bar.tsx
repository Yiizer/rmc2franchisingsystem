'use client';
import type {ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
import type {PrimaryAction} from './operations-next-action';

const toneClass={action:'primary',start:'primary',secondary:'secondary'};

// Handling and save controls stay left; the workflow action stays right.
export default function ActionBar({action,reason,left,right}:{action?:PrimaryAction;reason?:string;left?:ReactNode;right?:ReactNode}){
 const className='ops-btn ops-next-main '+toneClass[action?.tone||'action'];
 const label=<>{action?.label}{action?.forward&&<ArrowRight size={16} aria-hidden="true"/>}</>;
 const hint=action?.reason||reason;
 return <section className="ops-action-bar" aria-label="Next action">
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
