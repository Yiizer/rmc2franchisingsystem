'use client';

import { useState, type ReactNode } from 'react';

import { Archive, FileCheck2, XCircle } from 'lucide-react';

import { toast } from 'sonner';

import type { ClientState, InquiryRecord, Staff } from '@/lib/operations/types';

import { canApproveProposal } from '@/lib/operations/permissions';
import { api, Modal } from './operations-common';
import { replyAddress } from '@/lib/operations/reply-address';
import { fillTemplate, loadEmailTemplates, SaveAsTemplate, templateText, PLACEHOLDER_HINT } from './operations-email-templates';



export type RegistrationAction={id:string;label:string;run:()=>void;tone:'danger'|'primary'|'secondary';disabled:boolean};

export default function RegistrationActions({record,state,user,locked,lockedReason,onChange,onRefresh,children,selectedMatchId,renderActions,templateName}:{templateName?:string;record:InquiryRecord;state:ClientState;user:Staff;locked:boolean;lockedReason?:string;onChange:(record:InquiryRecord)=>void;onRefresh:()=>Promise<void>;children?:ReactNode;selectedMatchId?:string;renderActions?:(actions:RegistrationAction[])=>ReactNode}){

  const [mode,setMode]=useState<'decline'|'bor'|'expiry'|null>(null),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[file,setFile]=useState<File|null>(null),[confirmed,setConfirmed]=useState(false),[previous,setPrevious]=useState<InquiryRecord|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[emailSend,setEmailSend]=useState(true),[emailBody,setEmailBody]=useState('');

  if(record.closure||state.state==='archived'||record.status==='Awaiting approval'&&!(canApproveProposal(user))||['Sent','Approved — sending','Approved — email failed','Supervisor editing'].includes(record.status))return children?<div className="ops-resolution-options">{children}</div>:null;

  async function open(mode:'decline'|'bor'|'expiry'){

    setError('');setReason('');setReference('');setFile(null);setConfirmed(false);setMode(mode);
    if(mode==='decline')prefillDecline();

    if(mode==='bor'){setPrevious(null);setBusy(true);try{const id=state.matches.find(m=>m.inquiryId===selectedMatchId)?.inquiryId||(!selectedMatchId?state.matches[0]?.inquiryId:undefined);if(!id)throw Error('The existing registration is no longer available. Recheck the client first.');const data=await api<{inquiry:InquiryRecord}>('inquiries/'+encodeURIComponent(id));setPrevious(data.inquiry);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}

  }

  // The decline email starts from the user's own template (item 10), else the built-in default. Typing in the box wins over a late reply.
  const values={agentName:record.fields.agentName||'Agent',company:record.fields.company||'your account',proposalName:templateName||'',myName:user.name};
  function prefillDecline(){
    const fallback=fillTemplate(`Dear {agentName},\n\nThank you for your inquiry about {company}. We are unable to proceed with this request.\n\nBest regards,\n{myName}\nRMC2 Franchising`,values);
    setEmailSend(true);setEmailBody(fallback);
    void loadEmailTemplates().then(data=>{const text=templateText(data,'decline');if(text)setEmailBody(current=>current===fallback?fillTemplate(text,values):current);}).catch(()=>{});
  }

  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{

    let body:unknown=mode==='expiry'?{revision:record.revision,note:reason}:{revision:record.revision,reason,...(mode==='decline'?{email:{send:emailSend,body:emailBody}}:{})};

    if(mode==='bor'){if(!previous||!file)throw Error('Choose the BOR document and confirm the existing registration.');const form=new FormData();Object.entries({revision:String(record.revision),previousId:previous.id,previousRevision:String(previous.revision),reference,note:reason,verified:String(confirmed)}).forEach(([key,value])=>form.set(key,value));form.set('file',file);body=form;}

    const result=await api<{inquiry:InquiryRecord}>('inquiries/'+record.id+'/'+(mode==='bor'?'bor-transfer':mode==='expiry'?'request-expired-transfer':'decline'),body);onChange(result.inquiry);await onRefresh();
    // Dry-run mail mode builds the email but declines nothing: keep the dialog open and say so.
    if(mode==='decline'&&!result.inquiry.closure){setError('Email built but not sent (dry run). The request was not declined — untick Email the agent to decline without an email.');return;}
    setMode(null);toast.success(mode==='expiry'?'Agent change sent for supervisor approval':mode==='bor'?(supervisor?'Client transferred with verified BOR':'Agent change sent for supervisor approval'):emailSend?'Request declined and archived. The agent was emailed.':'Request declined and archived');

  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}

  const supervisor=canApproveProposal(user);

  const pending=record.agentTransferRequest&&!record.agentTransferRequest.decision?record.agentTransferRequest:null;

  async function decideTransfer(action:'approve'|'reject'){if(!pending)return;setBusy(true);setError('');try{const result=await api<{inquiry:InquiryRecord}>('inquiries/'+record.id+'/agent-transfer-decision',{revision:record.revision,requestId:pending.id,action,note:reason});onChange(result.inquiry);await onRefresh();toast.success(action==='approve'?'Agent transfer approved':'Agent change rejected');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}

  const decline=<div className="ops-resolution-option close-request"><span className="ops-resolution-icon"><Archive size={19}/></span><div><h3>Close this request</h3><p>Stop processing and move it to Archives.</p><button className="ops-btn danger" disabled={locked||busy} onClick={()=>open('decline')}><XCircle size={15}/>Decline request</button>{locked&&lockedReason&&<small className="ops-locked-reason">{lockedReason}</small>}</div></div>;

  return <>{pending&&<section className="ops-transfer-request ops-pad"><h3>Agent change awaiting supervisor approval</h3><p>{pending.reference} · {pending.note}</p>{pending.attachment&&<a className="ops-btn" href={'/api/operations/file/'+record.id+'/pending-bor'}>View BOR document</a>}{supervisor&&<><label>Supervisor decision reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} required/></label><div className="ops-actions"><button className="ops-btn secondary" disabled={busy||locked||reason.trim().length<10} onClick={()=>decideTransfer('approve')}>Approve agent change</button><button className="ops-btn danger" disabled={busy||locked||reason.trim().length<10} onClick={()=>decideTransfer('reject')}>Reject agent change</button></div></>}{error&&<p role="alert">{error}</p>}</section>}{renderActions?(!pending&&renderActions([
 {id:'decline',label:'Decline request',run:()=>{void open('decline');},tone:'danger',disabled:locked||busy},
 ...(state.matches.length===1&&!state.matches[0].sameAgent?[{id:'bor',label:'Transfer with BOR',run:()=>{void open('bor');},tone:'secondary' as const,disabled:locked||busy}]:[]),
 ...(state.matches.length===1&&state.matches[0].expired&&!state.matches[0].sameAgent&&!supervisor?[{id:'expiry',label:'Request new agent after expiry',run:()=>{void open('expiry');},tone:'primary' as const,disabled:locked||busy}]:[])
 ])):state.state==='duplicate'?<div className="ops-resolution-options" aria-label="Resolve the duplicate request">{children}{!pending&&state.matches.length===1&&state.matches[0].expired&&!state.matches[0].sameAgent&&!supervisor&&<div className="ops-resolution-option"><div><h3>Previous protection expired</h3><p>A supervisor must approve the new agent.</p><button className="ops-btn" disabled={busy||locked} onClick={()=>open('expiry')}>Request new agent after expiry</button></div></div>}{!pending&&state.matches.length===1&&!state.matches[0].sameAgent&&<div className="ops-resolution-option"><span className="ops-resolution-icon"><FileCheck2 size={19}/></span><div><h3>Transfer with a BOR</h3><p>Verify the BOR and request supervisor approval before changing the agent.</p><button className="ops-btn" disabled={locked||busy} onClick={()=>open('bor')}><FileCheck2 size={15}/>{supervisor?'Verify BOR & approve transfer':'Request agent change with BOR'}</button></div></div>}{decline}</div>:<div className="ops-close-request">{decline}</div>}

    {mode&&<Modal title={mode==='expiry'?'Request new agent after expiry':mode==='bor'?'Verify BOR and transfer client':'Decline and archive request'} onClose={()=>{if(!busy)setMode(null);}}><form className="ops-pad" onSubmit={submit}>

      {mode==='bor'?<><div className="ops-message amber"><FileCheck2 size={24}/><div><b>{previous?.fields.agentName||'Loading existing agent…'} → {record.fields.agentName}</b><p>{record.fields.company}. The previous registration will move to Archives.</p></div></div><label>BOR reference<input required minLength={3} maxLength={300} value={reference} onChange={e=>setReference(e.target.value)}/></label><label>BOR document<input required type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFile(e.target.files?.[0]||null)}/></label></>:mode==='expiry'?<p>Explain why the new agent should handle this client. Ownership stays unchanged until a supervisor approves.</p>:<p>This request will stop processing and move to Archives. Its original files and history remain available.</p>}

      <label>{mode==='bor'?'Verification notes':mode==='expiry'?'Reason for agent change':'Reason for declining'}<textarea required minLength={10} maxLength={3000} rows={4} value={reason} onChange={e=>setReason(e.target.value)}/></label>

      {mode==='decline'&&<div className="ops-mail-form"><label className="ops-check"><input type="checkbox" checked={emailSend} onChange={e=>setEmailSend(e.target.checked)}/>Email the agent</label>{emailSend&&<><div className="ops-mail-to"><span>To — the agent who sent the request</span><output aria-label="Decline email recipient">{replyAddress(record)||'No reply address on this inquiry'}</output></div><label>Message to the agent<textarea aria-label="Decline email message" rows={8} maxLength={10000} value={emailBody} onChange={e=>setEmailBody(e.target.value)} required/></label><SaveAsTemplate kind="decline" body={emailBody} values={values} disabled={busy}/><small className="ops-muted">{PLACEHOLDER_HINT}</small></>}</div>}
      {mode==='bor'&&<label className="ops-check"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked the BOR’s authenticity, client identity and authorization for this agent.</label>}

      {error&&<p className="ops-client-error" role="alert">{error}</p>}<div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={()=>setMode(null)}>Cancel</button><button className="ops-btn primary" disabled={busy||locked||mode==='bor'&&(!confirmed||!previous)||mode==='decline'&&emailSend&&!emailBody.trim()}>{mode==='bor'?<FileCheck2 size={16}/>:<Archive size={16}/>} {busy?'Saving…':mode==='expiry'?'Request supervisor approval':mode==='bor'?(supervisor?'Approve transfer':'Request supervisor approval'):'Decline & archive'}</button></div>

    </form></Modal>}

  </>;

}

