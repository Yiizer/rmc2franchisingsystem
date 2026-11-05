'use client';

import { useEffect, useState } from 'react';

import { Archive, ArrowUpRight, Clock3, Info, ShieldCheck, TriangleAlert } from 'lucide-react';

import { toast } from 'sonner';

import { manilaTime, reportStatus } from '@/lib/operations/types';

import type { ClientState, InquiryRecord, Staff } from '@/lib/operations/types';

import { protectionDaysLeft } from '@/lib/operations/client-rules';

import { canApproveProposal, canDecideProgressReport } from '@/lib/operations/permissions';
import { api, endpoint, Modal, staffName } from './operations-common';

import { ApproveReportModal, RejectReportModal, type DecisionTarget } from './operations-report-queue';
import RegistrationActions from './operations-registration-actions';

import ConflictCard from './operations-conflict-card';
import ClientComparison from './operations-client-comparison';

import './operations-client-protection.css';



export function ProtectionIndicator({state,now}:{state?:ClientState;now:number}){

  if(state?.state==='archived')return <span className="ops-client-pill expired"><Archive size={14}/>Archived</span>;

  if(state?.held)return <span className="ops-client-pill warning"><TriangleAlert size={14}/>Held · report under review</span>;

  if(state?.state==='duplicate')return <span className="ops-client-pill duplicate"><TriangleAlert size={14}/>Duplicate · on hold</span>;

  if(state?.state==='identify')return <span className="ops-client-pill warning"><TriangleAlert size={14}/>Client check needed</span>;

  const protection=state?.protection;

  if(!protection)return <span className="ops-client-pill neutral"><Clock3 size={14}/>Not started</span>;

  const days=protectionDaysLeft(protection,now),expired=days===0;

  return <span className={'ops-client-pill '+(expired?'expired':days<=7?'warning':'protected')} title={protection.agentName+' · '+manilaTime(protection.expiresAt)}><Clock3 size={14}/>{expired?'Expired · archived':days+'d left'}<span className="ops-client-mini-meter" aria-hidden="true"><i style={{width:Math.min(100,days/30*100)+'%'}}/></span></span>;

}




export function ClientProtectionSummary({state,onOpen}:{state:ClientState;onOpen:()=>void}){

  const [now,setNow]=useState(()=>Date.now());

  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);

  return <button className="ops-protection-summary" onClick={onOpen} aria-label="View client protection and progress reports"><ProtectionIndicator state={state} now={now}/><span>Client protection & reports</span><ArrowUpRight size={14}/></button>;

}



// Informational, non-blocking note for registrations that overlap another one. Always visible to all staff; mount it outside any collapsed protection body.
export function ClientOverlapNote({state,onOpenRelated}:{state:ClientState;onOpenRelated:(id:string)=>void}){
  if(!state.overlaps?.length)return null;
  return <section className="ops-client-overlap" role="note" aria-label="Also registered"><Info size={18} aria-hidden="true"/><div><b>Also registered on {state.overlaps.map((o,i)=><span key={o.inquiryId}>{i>0&&', '}<button className="ops-link" onClick={()=>onOpenRelated(o.inquiryId)}>{o.inquiryId}<ArrowUpRight size={13}/></button></span>)}</b><p>For information only. Nothing is blocked. {state.overlaps.map(o=>o.company+' · '+o.agentName).join('; ')}</p></div></section>;
}

export default function ClientProtectionPanel({record,state,user,users,locked,onChange,onRefresh,onOpenRelated}:{record:InquiryRecord;state:ClientState;user:Staff;users:Staff[];locked:boolean;onChange:(record:InquiryRecord)=>void;onRefresh:()=>Promise<void>;onOpenRelated:(id:string)=>void}){

  const [now,setNow]=useState(()=>Date.now()),[decide,setDecide]=useState<{kind:'approve'|'reject';target:DecisionTarget}|null>(null),[reviewOpen,setReviewOpen]=useState(false),[reviewKind,setReviewKind]=useState<'distinct'|'reassign-expired'>('distinct'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);

  const [matchId,setMatchId]=useState('');
  const [selectedMatch,setSelectedMatch]=useState('');
  const [seenMatches,setSeenMatches]=useState(state.matches);
  useEffect(()=>{setSeenMatches(previous=>[...previous,...state.matches.filter(m=>!previous.some(p=>p.inquiryId===m.inquiryId))]);},[state.matches]);
  const selected=seenMatches.find(m=>m.inquiryId===selectedMatch)||state.matches[0]||seenMatches[0];
  const resolved=!!selected&&!state.matches.some(m=>m.inquiryId===selected.inquiryId);
  const openDistinct=()=>{setReviewKind('distinct');setMatchId(selected?.inquiryId||'');setNote('');setConfirmed(false);setError('');setReviewOpen(true);};
  const openExpiry=()=>{setReviewKind('reassign-expired');setNote('');setConfirmed(false);setError('');setReviewOpen(true);};

  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);

  const held=!!state.held||(record.progressReports||[]).some(r=>reportStatus(r)==='pending'),protection=state.protection,days=protection?protectionDaysLeft(protection,now):0,archived=state.state==='archived'||!!protection&&days===0;

  const canReview=true;

  async function review(action:'recheck'|'distinct'|'reassign-expired'){

    setBusy(true);setError('');try{const result=await api<{inquiry:InquiryRecord}>('inquiries/'+record.id+'/review-client',{revision:record.revision,action,...(action==='distinct'?{matchId}:{}),note:action!=='recheck'?note:''});onChange(result.inquiry);await onRefresh();setReviewOpen(false);toast[result.inquiry.clientReview?.state==='clear'?'success':'info'](result.inquiry.clientReview?.state==='clear'?'Client check cleared':'This submission is still on hold');}catch(e){setError((e as Error).message);}finally{setBusy(false);}

  }

  return <>

    <ClientOverlapNote state={state} onOpenRelated={onOpenRelated}/>
    {record.closure?<section className="ops-card ops-archive-reason"><h2><Archive size={18}/> {record.closure.kind==='declined'?'Request declined':'Client transferred'} · Archived</h2><p>{record.closure.reason}</p><small>{manilaTime(record.closure.at)} · {staffName(users,record.closure.by)}</small>{record.closure.relatedId&&<button className="ops-link" onClick={()=>onOpenRelated(record.closure!.relatedId!)}>Open related inquiry <ArrowUpRight size={15}/></button>}</section>:state.state==='duplicate'?<ConflictCard title={resolved?'Match resolved':'On hold · Already registered to '+(selected?.agentName||'another agent')} subtitle={selected?.inquiryId} matches={seenMatches.map(m=>({id:m.inquiryId,label:m.inquiryId+' · '+m.agentName,resolved:!state.matches.some(active=>active.inquiryId===m.inquiryId)}))} selected={selected?.inquiryId||''} onSelect={setSelectedMatch} actions={!resolved&&selected?<RegistrationActions record={record} state={state} user={user} selectedMatchId={selected.inquiryId} locked={locked||busy} onChange={onChange} onRefresh={onRefresh} renderActions={actions=>{
 const canApproveExpiry=canApproveProposal(user)&&state.matches.length>0&&state.matches.every(m=>m.expired&&!m.sameAgent);
 const suggested=selected.sameAgent?'existing':selected.expired?(canApproveExpiry?'approve-expiry':actions.some(a=>a.id==='expiry')?'expiry':'existing'):'decline';
 const all=[{id:'existing',label:'Open existing inquiry',run:()=>onOpenRelated(selected.inquiryId),tone:'primary',disabled:false},...actions,...(canApproveExpiry?[{id:'approve-expiry',label:'Approve new agent after expiry',run:openExpiry,tone:'primary',disabled:locked||busy}]:[])];
 const primary=all.find(a=>a.id===suggested)!;
 return <><div className="ops-conflict-options"><button className={'ops-conflict-suggested '+(suggested==='decline'?'danger':'')} disabled={primary.disabled} onClick={primary.run}><small>Suggested step</small><b>{primary.label}</b></button>{all.filter(a=>a.id!==suggested&&a.id!=='existing'&&a.id!=='decline').map(a=><button className="ops-btn" key={a.id} disabled={a.disabled} onClick={a.run}>{a.label}</button>)}</div><div className="ops-conflict-secondary"><button className="ops-btn" disabled={busy||locked||(!(canApproveProposal(user))&&state.matches.some(m=>!m.expired))} title={!(canApproveProposal(user))&&state.matches.some(m=>!m.expired)?'An approving supervisor must confirm different clients while the existing registration is active.':undefined} onClick={openDistinct}>Confirm different clients</button>{suggested!=='decline'&&actions.filter(a=>a.id==='decline').map(a=><button className="ops-conflict-decline" key={a.id} disabled={a.disabled} onClick={a.run}>Decline request</button>)}</div>{state.matches.length>1&&<p className="ops-conflict-hint">Review the other matches before requesting a transfer.</p>}</>;
 }}/>:undefined}>
 {selected&&<ClientComparison record={record} match={selected} onOpen={onOpenRelated} busy={busy||locked} onRecheck={()=>{void review('recheck');}}/>}

 {resolved&&<p role="status">✓ This match is resolved. Select another match to continue.</p>}
 {error&&!reviewOpen&&<p role="alert">{error}</p>}
 </ConflictCard>:state.state==='identify'?<div className="ops-client-identify" role="status"><TriangleAlert size={20}/><div><b>Client check needs the client’s name</b><p>Enter the account/company or client name in Edit details and save before choosing a proposal.</p></div></div>:<section className={'ops-card ops-client-protection '+(archived?'archived':protection&&days<=7?'due':'')} aria-label="Client protection">

      <div className="ops-client-protection-main"><span className="ops-client-shield" aria-hidden="true">{archived?<Archive size={25}/>:<ShieldCheck size={25}/>}</span><div className="ops-client-agent"><span>{record.ownerId?'Client protection':'Agent client protection'}</span><b>{protection?.agentName||record.fields.agentName||'Agent'}</b><small>{archived?'New agent requires supervisor approval':held?'Held — report under review':protection?'Until '+manilaTime(protection.expiresAt):'30 days starts after a reply or proposal is sent'}</small></div>{protection&&<div className="ops-client-countdown" role="timer" aria-label={archived?'Client protection expired':days+' days of client protection remaining'}><strong>{archived?'0':days}</strong><span>{archived?'Expired':'days left'}</span></div>}</div>

      {protection&&<div className="ops-client-meter" role="progressbar" aria-label="Remaining agent protection" aria-valuemin={0} aria-valuemax={30} aria-valuenow={days}><i style={{width:Math.min(100,days/30*100)+'%'}}/></div>}

      {archived&&<p className="ops-client-archive-note">Archived automatically. The original form, reports and proposal versions remain available to view.</p>}

      <div className="ops-client-reports ops-report-status-list"><b>{record.progressReports?.length?record.progressReports.length+' progress report'+(record.progressReports.length===1?'':'s'):'No progress reports yet.'}</b>{record.progressReports?.slice().reverse().map(report=>{const status=reportStatus(report);return <article key={report.id} className={'ops-report-row '+status}><div><b>{report.reference}</b> <span className={'ops-client-pill '+(status==='approved'?'protected':status==='rejected'?'duplicate':'warning')}>{status==='approved'?'Approved':status==='rejected'?'Rejected':'Pending'}</span><small>{status==='pending'?'Filed':status==='approved'?'Approved by '+staffName(users,report.decidedBy||'')+' on '+manilaTime(report.decidedAt||report.recordedAt)+' · Filed':'Rejected by '+staffName(users,report.decidedBy||'')+' on '+manilaTime(report.decidedAt||report.recordedAt)+' · Filed'}{status==='pending'?' by '+staffName(users,report.submittedBy||report.recordedBy)+' on '+manilaTime(report.recordedAt):' by '+staffName(users,report.submittedBy||report.recordedBy)+' on '+manilaTime(report.recordedAt)}</small><p>{report.summary}</p>{status==='rejected'&&<small>Reason: {report.rejectReason}</small>}{status==='pending'&&<small>Held — report under review</small>}</div>{report.attachment&&<a className="ops-link" href={endpoint+'/file/'+record.id+'/progress?report='+report.id}>View report<ArrowUpRight size={14}/></a>}{status==='pending'&&canDecideProgressReport(user)&&<div className="ops-report-actions"><button className="ops-btn primary" disabled={locked||busy} onClick={()=>setDecide({kind:'approve',target:{inquiryId:record.id,reportId:report.id,client:record.fields.company||record.id,ownerName:staffName(users,report.submittedBy||report.recordedBy)}})}>Approve</button><button className="ops-btn danger" disabled={locked||busy} onClick={()=>setDecide({kind:'reject',target:{inquiryId:record.id,reportId:report.id,client:record.fields.company||record.id,ownerName:staffName(users,report.submittedBy||report.recordedBy)}})}>Reject</button></div>}</article>;})}</div>



    </section>}

    {record.bor&&<div className="ops-message green"><ShieldCheck size={21}/><div><b>Client assigned by verified BOR</b><p>{record.bor.reference} · Verified by {staffName(users,record.bor.by)}</p></div><a className="ops-link" href={endpoint+'/file/'+record.id+'/bor'}>View BOR</a><button className="ops-link" onClick={()=>onOpenRelated(record.bor!.fromInquiryId)}>Previous registration</button></div>}

    {decide?.kind==='approve'&&<ApproveReportModal target={decide.target} onClose={()=>setDecide(null)} onDone={async inquiry=>{setDecide(null);if(inquiry)onChange(inquiry);await onRefresh();}}/>}
    {decide?.kind==='reject'&&<RejectReportModal target={decide.target} onClose={()=>setDecide(null)} onDone={async inquiry=>{setDecide(null);if(inquiry)onChange(inquiry);await onRefresh();}}/>}

    {reviewOpen&&<Modal title={reviewKind==='distinct'?'Review matching client details':'Approve new agent after expiry'} onClose={()=>{if(!busy)setReviewOpen(false);}}><form className="ops-pad ops-client-report-form" onSubmit={event=>{event.preventDefault();void review(reviewKind);}}><p>{reviewKind==='distinct'?'Use this only when the matching names or accounts refer to different clients. For the same client, continue in the existing inquiry.':'Check the previous registration and incoming agent. Approval opens this request and leaves the expired record in Archives.'}</p>{reviewKind==='distinct'&&<label>Match being reviewed<select value={matchId} onChange={event=>setMatchId(event.target.value)} required>{state.matches.map(match=><option key={match.inquiryId} value={match.inquiryId}>{match.company} · {match.inquiryId}</option>)}</select></label>}<label>{reviewKind==='distinct'?'Reason these are different clients':'Reason for approving the new agent'}<textarea value={note} onChange={event=>setNote(event.target.value)} minLength={10} maxLength={3000} rows={4} required/></label><label className="ops-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required/>{reviewKind==='distinct'?'I checked the original forms and confirmed these are different clients.':'I verified the previous protection expired and this request is from a different agent.'}</label>{error&&<p className="ops-client-error" role="alert">{error}</p>}<div className="ops-actions"><button className="ops-btn primary" disabled={busy||locked||!confirmed}>{reviewKind==='distinct'?'Confirm different clients':'Approve new agent'}</button></div></form></Modal>}

  </>;

}

