'use client';
import { useEffect, useRef, useState } from 'react';
import { Users, CheckCircle2, RefreshCw, LockKeyhole } from 'lucide-react';
import type { InquiryActivity, Staff } from '@/lib/operations/types';
import { endpoint, staffName } from './operations-common';
import './operations-activity.css';

type ActivityResponse={activity:InquiryActivity[];handling:boolean};
export function HandlingBadge({activity,users,currentUserId}:{activity:InquiryActivity[];users:Staff[];currentUserId?:string}){
  const handler=activity[0];if(!handler)return null;
  const own=handler.userId===currentUserId,name=own?'You':staffName(users,handler.userId);
  return <span className={'ops-handling-badge'+(own?' own':'')} title={'Current handler: '+name}>{own?<Users size={13}/>:<LockKeyhole size={13}/>}<span>{name}<small>{own?'Handling now':'View only'}</small></span></span>;
}

export function useInquiryActivity(inquiryId:string,enabled:boolean){
  const [state,setState]=useState<ActivityResponse|null>(null),[error,setError]=useState(false),[pending,setPending]=useState(false);
  const control=useRef<{start:()=>Promise<void>;poll:()=>Promise<void>;release:()=>Promise<void>}|null>(null);
  useEffect(()=>{
    if(!enabled){setState(null);return;}
    const tab=crypto.randomUUID();let alive=true,handling=false,queue=Promise.resolve();
    const send=(action:'poll'|'start'|'heartbeat'|'leave')=>{
      queue=queue.then(async()=>{
        if(!alive&&action!=='leave')return;
        const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),8000);
        try{
          const request=(action:string)=>fetch(endpoint+'/inquiries/'+inquiryId+'/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,action}),cache:'no-store',keepalive:true,signal:abort.signal});
          let response=await request(action);
          // A colleague may win the start race. Load their lock instead of retrying a claim.
          if(response.status===423)response=await request('poll');
          if(!response.ok)throw new Error('Handling check failed');
          const result=await response.json() as ActivityResponse;
          handling=result.handling;
          if(alive){setState(result);setError(false);}
        }catch{handling=false;if(alive){setError(true);setState(previous=>previous?{...previous,handling:false}:previous);}}
        finally{clearTimeout(timeout);if(alive&&action==='start')setPending(false);}
      });
      return queue;
    };
    const start=()=>{setPending(true);return send('start');};
    // Expired leases require an explicit Start handling; never silently take a released lock.
    const poll=()=>send(handling?'heartbeat':'poll');
    control.current={start,poll,release:()=>send('leave')};void send('poll');
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void poll();},10000);
    const visible=()=>{if(document.visibilityState==='visible')void poll();else {setState(previous=>previous?{...previous,handling:false}:previous);}};
    document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);control.current=null;void send('leave');document.removeEventListener('visibilitychange',visible);};
  },[inquiryId,enabled]);
  return {state,error,pending,canEdit:enabled&&!!state?.handling&&!error&&!pending,start:()=>control.current?.start()||Promise.resolve(),poll:()=>control.current?.poll()||Promise.resolve(),release:()=>control.current?.release()||Promise.resolve()};
}

export default function InquiryActivityNotice({activity,user,users,enabled,busy,onDone}:{activity:ReturnType<typeof useInquiryActivity>;user:Staff;users:Staff[];enabled:boolean;busy:boolean;onDone:()=>void}){
  if(!enabled)return null;
  const {state,error,pending}=activity,owner=state?.activity[0],other=owner&&owner.userId!==user.id,ownElsewhere=!state?.handling&&owner?.userId===user.id;
  const title=error?'Handling status unavailable':!state?'Checking who is handling this…':other?staffName(users,owner.userId)+' is handling this inquiry':state.handling?'You’re handling this inquiry':ownElsewhere?'You’re handling this in another tab':'Available to pick up';
  return <section className={'ops-activity-notice '+(error||other||ownElsewhere?'occupied':state?.handling?'handling':'available')} aria-label="Inquiry activity">
    {state?.handling?<CheckCircle2 size={19}/>:other?<LockKeyhole size={19}/>:<Users size={19}/>}
    <div role="status"><b>{title}</b><p>{error?'View only until the handling status can be checked.':other?'View only. Editing unlocks when they finish or their session expires.':state?.handling?'Only you can edit. Others can view the inquiry and its saved proposal.':ownElsewhere?'Use that tab, or continue here with the same account.':'Start handling to unlock editing. Others will have view-only access.'}</p></div>
    {error?<button className="ops-btn" onClick={()=>void activity.poll()}><RefreshCw size={14}/>Check again</button>:state?.handling?<button className="ops-btn" disabled={busy} onClick={onDone}>Done for now</button>:other?<span className="ops-badge amber"><LockKeyhole size={13}/>View only</span>:<button className="ops-btn" disabled={!state||pending||busy} onClick={()=>void activity.start()}>{pending?'Starting…':ownElsewhere?'Continue in this tab':'Start handling'}</button>}
  </section>;
}
