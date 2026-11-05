'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Users, CheckCircle2, RefreshCw, LockKeyhole, Lock, BellRing } from 'lucide-react';
import { canPrepareProposal, canTakeOver } from '@/lib/operations/types';
import type { HandoverRequest, InquiryActivity, Staff } from '@/lib/operations/types';
import { endpoint, staffName, Modal } from './operations-common';
import './operations-activity.css';

type ActivityResponse={activity:InquiryActivity[];handling:boolean;handover?:HandoverRequest|null};
export type ActivityNotice={kind:'inactive'}|{kind:'taken';by:string};
type Command='request-handover'|'dismiss-handover'|'take-over';
// Hidden tabs are throttled by the browser (about once a minute); the server keeps a lease for 3 minutes, so that still holds the lock.
const POLL_MS=10000,IDLE_MS=15*60000;
const INPUT_EVENTS=['keydown','pointerdown','mousemove','touchstart','scroll','wheel'] as const;

/** How long a lock has been held, e.g. "4m" or "1h 5m". */
export const heldFor=(startedAt:string,now=Date.now())=>{const minutes=Math.max(0,Math.floor((now-Date.parse(startedAt))/60000));if(minutes<1)return '<1m';if(minutes<60)return minutes+'m';const h=Math.floor(minutes/60),m=minutes%60;return m?h+'h '+m+'m':h+'h';};
export const lockText=(handler:InquiryActivity,name:string)=>handler.reserved?name+' · reserved':name+' · '+heldFor(handler.startedAt);

export function HandlingBadge({activity,users,currentUserId}:{activity:InquiryActivity[];users:Staff[];currentUserId?:string}){
  const handler=activity[0];if(!handler)return null;
  const own=handler.userId===currentUserId,name=own?'You':staffName(users,handler.userId);
  const note=handler.reserved?own?'Assigned to you':'Reserved':own?'Handling now':'View only';
  return <span className={'ops-handling-badge'+(own?' own':'')} title={'Current handler: '+(own?'you':name)}>{own&&!handler.reserved?<Users size={13}/>:<Lock size={13}/>}<span>{lockText(handler,name)}<small>{note}</small></span></span>;
}

export function useInquiryActivity(inquiryId:string,enabled:boolean){
  const [state,setState]=useState<ActivityResponse|null>(null),[error,setError]=useState(false),[pending,setPending]=useState(false),[notice,setNotice]=useState<ActivityNotice|null>(null);
  const control=useRef<{start:()=>Promise<void>;poll:()=>Promise<void>;release:()=>Promise<void>;command:(action:Command,extra?:object)=>Promise<string|null>}|null>(null);
  useEffect(()=>{
    if(!enabled){setState(null);setNotice(null);return;}
    const tab=crypto.randomUUID(),url=endpoint+'/inquiries/'+inquiryId+'/activity';let alive=true,handling=false,queue:Promise<unknown>=Promise.resolve(),lastInput=Date.now();
    const send=(action:'poll'|'start'|'heartbeat'|'leave')=>{
      const run=queue.then(async()=>{
        if(!alive&&action!=='leave')return;
        const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),8000);
        try{
          const request=(action:string)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,action}),cache:'no-store',keepalive:true,signal:abort.signal});
          let response=await request(action);
          // A colleague may win the start race. Load their lock instead of retrying a claim.
          if(response.status===423)response=await request('poll');
          if(!response.ok)throw new Error('Handling check failed');
          const result=await response.json() as ActivityResponse,was=handling;
          handling=result.handling;
          if(alive){
            setState(result);setError(false);
            // Lost without releasing it ourselves: a supervisor took it over.
            // A reservation names the colleague it was assigned to; the person who took it over is reservedBy.
            const holder=result.activity[0];
            if(result.handling)setNotice(null);else if(was&&action!=='leave'&&holder)setNotice({kind:'taken',by:holder.reserved&&holder.reservedBy?holder.reservedBy:holder.userId});
          }
        }catch{handling=false;if(alive){setError(true);setState(previous=>previous?{...previous,handling:false}:previous);}}
        finally{clearTimeout(timeout);if(alive&&action==='start')setPending(false);}
      });
      queue=run;
      return run;
    };
    // Handover requests, take-overs and "keep working" report their error text to the caller instead of marking the status unavailable.
    const command=(action:Command,extra?:object)=>{
      const run=queue.then(async():Promise<string|null>=>{
        try{
          const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,action,...extra}),cache:'no-store'});
          const result=await response.json().catch(()=>({})) as ActivityResponse&{error?:string};
          if(!response.ok)return result.error||'We could not complete that request. Please try again.';
          handling=result.handling;if(alive){setState(result);setError(false);setNotice(null);}
          return null;
        }catch{return 'We could not connect. Check your connection and try again.';}
      });
      queue=run.then(()=>undefined);
      return run;
    };
    const start=()=>{lastInput=Date.now();setPending(true);return send('start');};
    // Expired leases require an explicit Start handling; never silently take a released lock.
    const poll=()=>send(handling?'heartbeat':'poll');
    control.current={start,poll,release:()=>send('leave'),command};void send('poll');
    // The interval keeps running in hidden tabs. After 15 minutes without input in this tab, the lock is released.
    const tick=()=>{
      if(handling&&Date.now()-lastInput>=IDLE_MS){handling=false;setNotice({kind:'inactive'});setState(previous=>previous?{...previous,handling:false}:previous);void send('leave');return;}
      void poll();
    };
    const timer=setInterval(tick,POLL_MS);
    const touch=()=>{lastInput=Date.now();};
    for(const name of INPUT_EVENTS)window.addEventListener(name,touch,{passive:true,capture:true});
    const visible=()=>{if(document.visibilityState==='visible')tick();};
    document.addEventListener('visibilitychange',visible);
    // Closing the tab or browser never unmounts React: release the lock directly so colleagues do not wait for the TTL.
    const gone=()=>{if(handling)void fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,action:'leave'}),keepalive:true}).catch(()=>undefined);};
    window.addEventListener('pagehide',gone);
    return()=>{alive=false;clearInterval(timer);control.current=null;void send('leave');document.removeEventListener('visibilitychange',visible);window.removeEventListener('pagehide',gone);for(const name of INPUT_EVENTS)window.removeEventListener(name,touch,{capture:true});};
  },[inquiryId,enabled]);
  const refuse=()=>Promise.resolve<string|null>('Handling status is not ready yet.');
  return {state,error,pending,notice,canEdit:enabled&&!!state?.handling&&!error&&!pending,start:()=>control.current?.start()||Promise.resolve(),poll:()=>control.current?.poll()||Promise.resolve(),release:()=>control.current?.release()||Promise.resolve(),
    requestHandover:()=>control.current?.command('request-handover')||refuse(),keepWorking:()=>control.current?.command('dismiss-handover')||refuse(),takeOver:(targetUserId?:string)=>control.current?.command('take-over',targetUserId?{targetUserId}:undefined)||refuse()};
}


export default function InquiryActivityNotice({activity,user,users,enabled,busy,onDone,compact=false,editingVersion,hideStart=false}:{activity:ReturnType<typeof useInquiryActivity>;user:Staff;users:Staff[];enabled:boolean;busy:boolean;onDone:()=>void;compact?:boolean;editingVersion?:number;hideStart?:boolean}){
  if(!enabled)return null;
  const {state,error,pending}=activity,owner=state?.activity[0],other=owner&&owner.userId!==user.id,ownElsewhere=!state?.handling&&owner?.userId===user.id&&!owner.reserved;
  const title=error?'Handling status unavailable':!state?'Checking who is handling this…':other?staffName(users,owner.userId)+' is handling this inquiry':state.handling?'You’re handling this inquiry':ownElsewhere?'You’re handling this in another tab':'Available to pick up';
  if(compact){
    // Colored handling card: blue = available, green = you, amber = a colleague. The main button sits below it.
    const tone=error||other?'other':state?.handling?'mine':'avail';
    const Icon=state?.handling?CheckCircle2:other||error?LockKeyhole:Users;
    const heading=error?'Handling status unavailable':!state?'Checking availability…':state.handling?'You’re handling this inquiry':other?staffName(users,owner.userId)+' is handling this inquiry':ownElsewhere?'Open in your other tab':'Available to pick up';
    const detail=error?'View only until the status can be checked.':!state?'':state.handling?(editingVersion?'Editing a copy of version '+editingVersion+'. Others can view only.':'Your draft saves when you release it. Others can view only.'):other?'View only until they release it.':ownElsewhere?'You’re handling it in another tab. Continue here instead?':'No one is handling this yet.';
    return <section className={'ops-handling-card '+tone} aria-label="Inquiry activity">
      <div role="status"><Icon size={18} aria-hidden="true"/><span><b>{heading}</b>{detail&&<small>{detail}</small>}</span></div>
      {error?<button className="ops-btn secondary" onClick={()=>void activity.poll()}><RefreshCw size={14}/>Check again</button>:state?.handling?<button className="ops-btn ops-handling-done" disabled={busy} onClick={onDone}>Release to queue</button>:other?null:hideStart&&!ownElsewhere?null:<button className="ops-btn ops-handling-start" disabled={!state||pending||busy} onClick={()=>void activity.start()}>{pending?'Starting…':ownElsewhere?'Continue in this tab':'Start handling'}</button>}
    </section>;
  }
  return <section className={'ops-activity-notice '+(error||other||ownElsewhere?'occupied':state?.handling?'handling':'available')} aria-label="Inquiry activity">
    {state?.handling?<CheckCircle2 size={19}/>:other?<LockKeyhole size={19}/>:<Users size={19}/>}
    <div role="status"><b>{title}</b><p>{error?'View only until the handling status can be checked.':other?'View only. Editing unlocks when they finish or their session expires.':state?.handling?'Only you can edit. Others can view the inquiry and its saved proposal.':ownElsewhere?'Use that tab, or continue here with the same account.':'Start handling to unlock editing. Others will have view-only access.'}</p></div>
    {error?<button className="ops-btn" onClick={()=>void activity.poll()}><RefreshCw size={14}/>Check again</button>:state?.handling?<button className="ops-btn ops-handling-done" disabled={busy} onClick={onDone}>Release to queue</button>:other?<span className="ops-badge amber"><LockKeyhole size={13}/>View only</span>:<button className="ops-btn ops-handling-start" disabled={!state||pending||busy} onClick={()=>void activity.start()}>{pending?'Starting…':ownElsewhere?'Continue in this tab':'Start handling'}</button>}
  </section>;
}

// Inquiry page (mockup layout): a full-width banner while you're not the handler,
// and a compact "Handling: you · Release to queue" pair in the page header while you are.
function TakeOverDialog({user,users,ownerId,onClose,onConfirm}:{user:Staff;users:Staff[];ownerId:string;onClose:()=>void;onConfirm:(targetUserId?:string)=>Promise<string|null>}){
  const candidates=users.filter(person=>person.active&&person.id!==user.id&&person.id!==ownerId&&canPrepareProposal(person)).sort((a,b)=>(a.role===b.role?0:a.role==='Employee'?-1:1)||a.name.localeCompare(b.name));
  const [mode,setMode]=useState<'self'|'other'>('self'),[target,setTarget]=useState(candidates[0]?.id||''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function confirm(){
    setBusy(true);setMessage('');
    const failure=await onConfirm(mode==='other'?target:undefined);
    setBusy(false);
    if(failure)setMessage(failure);else{toast.success(mode==='other'?'Reserved for '+staffName(users,target)+'. They have 15 minutes to start.':'You now hold this inquiry.');onClose();}
  }
  return <Modal title="Take over this inquiry" onClose={onClose}><div className="ops-pad ops-takeover">
    <p>{staffName(users,ownerId)} will be switched to view only and told you took it over.</p>
    <label className="ops-takeover-option"><input type="radio" name="takeover-mode" checked={mode==='self'} onChange={()=>setMode('self')}/>Take it myself</label>
    <label className="ops-takeover-option"><input type="radio" name="takeover-mode" checked={mode==='other'} onChange={()=>setMode('other')} disabled={!candidates.length}/>Assign to a colleague</label>
    <select aria-label="Assign to" value={target} disabled={mode!=='other'} onChange={event=>setTarget(event.target.value)}>{candidates.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select>
    {message&&<p role="alert" className="ops-takeover-error">{message}</p>}
    <div className="ops-actions"><button className="ops-btn secondary" onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy||mode==='other'&&!target} onClick={()=>void confirm()}>{busy?'Taking over…':'Take over'}</button></div>
  </div></Modal>;
}
export function HandlingBanner({activity,user,users,enabled,busy,showAction=true}:{activity:ReturnType<typeof useInquiryActivity>;user:Staff;users:Staff[];enabled:boolean;busy:boolean;showAction?:boolean}){
  const {state,error,pending,notice}=activity,[dialog,setDialog]=useState(false),[asking,setAsking]=useState(false);
  const noticeText=notice?.kind==='inactive'?'You were released after 15 minutes without activity. Choose Start handling to continue.':notice?.kind==='taken'?staffName(users,notice.by)+' took over this inquiry. It is now view only for you.':'';
  useEffect(()=>{if(noticeText)toast.info(noticeText);},[noticeText]);
  if(!enabled)return null;
  const owner=state?.activity[0],other=owner&&owner.userId!==user.id,ownElsewhere=!state?.handling&&owner?.userId===user.id&&!owner.reserved,reservedForMe=!!owner?.reserved&&owner.userId===user.id;
  if(state?.handling)return null;
  const name=owner?staffName(users,owner.userId):'';
  const title=error?'Handling status unavailable':!state?'Checking who is handling this inquiry…':other?owner.reserved?'Reserved for '+name:name+' is handling this inquiry':reservedForMe?'This inquiry was assigned to you':ownElsewhere?'You’re handling this in another tab':'Nobody is handling this inquiry';
  const detail=noticeText||(error?'View only until the handling status can be checked.':!state?'':other?owner.reserved?(owner.reservedBy?staffName(users,owner.reservedBy)+' assigned it. ':'')+'View only until they start handling.':'Locked for '+heldFor(owner.startedAt)+'. View only until they release it to the queue.':reservedForMe?'Start handling to begin editing.':ownElsewhere?'Use that tab, or continue here with the same account.':'Start handling to edit. Everyone else can still view it.');
  async function ask(){setAsking(true);const failure=await activity.requestHandover();setAsking(false);if(failure)toast.error(failure);else toast.success('Request sent to '+name+'.');}
  return <section className={'ops-handling-banner'+(other||error?' other':'')} aria-label="Inquiry activity">
    {other||error?<Lock size={18} aria-hidden="true"/>:<Users size={18} aria-hidden="true"/>}
    <div role="status"><b>{title}</b>{detail&&<p>{detail}</p>}</div>
    {other&&!error&&canPrepareProposal(user)&&!owner.reserved&&<button className="ops-btn secondary" disabled={asking||busy} onClick={()=>void ask()}>{asking?'Sending…':'Request handover'}</button>}
    {other&&!error&&canTakeOver(user)&&<button className="ops-btn primary" disabled={busy} onClick={()=>setDialog(true)}>Take over</button>}
    {showAction&&(error?<button className="ops-btn secondary" onClick={()=>void activity.poll()}><RefreshCw size={14}/>Check again</button>:other||!state?null:<button className="ops-btn primary" disabled={pending||busy} onClick={()=>void activity.start()}>{pending?'Starting…':ownElsewhere?'Continue in this tab':'Start handling'}</button>)}
    {dialog&&owner&&<TakeOverDialog user={user} users={users} ownerId={owner.userId} onClose={()=>setDialog(false)} onConfirm={target=>activity.takeOver(target)}/>}
  </section>;
}
/** Shown to the person handling the inquiry when a colleague asks to take over. */
export function HandoverBanner({activity,users,enabled,busy,onRelease}:{activity:ReturnType<typeof useInquiryActivity>;users:Staff[];enabled:boolean;busy:boolean;onRelease:()=>void}){
  const handover=activity.state?.handover;
  if(!enabled||!activity.state?.handling||!handover)return null;
  return <section className="ops-handling-banner other ops-handover-banner" role="alert" aria-label="Handover request">
    <BellRing size={18} aria-hidden="true"/>
    <div><b>{staffName(users,handover.requesterId)} asked to take over this inquiry</b><p>Release it to the queue if you are done, or keep working.</p></div>
    <button className="ops-btn secondary" disabled={busy} onClick={onRelease}>Release</button>
    <button className="ops-btn primary" disabled={busy} onClick={()=>void activity.keepWorking().then(failure=>{if(failure)toast.error(failure);})}>Keep working</button>
  </section>;
}
export function HandlingHeader({activity,enabled,busy,onRelease,editingVersion,showRelease=true}:{activity:ReturnType<typeof useInquiryActivity>;enabled:boolean;busy:boolean;onRelease:()=>void;editingVersion?:number;showRelease?:boolean}){
  if(!enabled||!activity.state?.handling||activity.error)return null;
  const since=activity.state.activity[0]?.startedAt;
  return <div className="ops-handling-header" aria-label="Your handling status">
    <span className="ops-handling-pill" title={editingVersion?'Editing a copy of version '+editingVersion:undefined}><span className="ops-dot" aria-hidden="true"/>Handling: <strong className="ops-handling-you">you</strong>{since&&<span> · {heldFor(since)}</span>}</span>
    {showRelease&&<button className="ops-btn secondary" disabled={busy} onClick={onRelease}>Release to queue</button>}
  </div>;
}

// The footer is the single place to claim or release editing; the banner explains the state.
export function HandlingControl({activity,user,enabled,busy,onRelease}:{activity:ReturnType<typeof useInquiryActivity>;user:Staff;enabled:boolean;busy:boolean;onRelease:()=>void}){
  if(!enabled)return null;
  const {state,error,pending}=activity,owner=state?.activity[0];
  if(error)return <button className="ops-btn secondary" disabled={busy} onClick={()=>void activity.poll()}><RefreshCw size={15}/>Check handling status</button>;
  if(state?.handling)return <button className="ops-btn ops-handling-done" disabled={busy} onClick={onRelease}>Release to queue</button>;
  if(owner&&owner.userId!==user.id)return <span className="ops-footer-viewonly"><LockKeyhole size={15}/>View only · handled by a colleague</span>;
  return <button className="ops-btn primary ops-footer-handle-start" disabled={!state||pending||busy} onClick={()=>void activity.start()}>{pending?'Starting…':owner?.userId===user.id&&!owner.reserved?'Continue in this tab':'Start handling'}</button>;
}

