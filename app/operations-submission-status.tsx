import { useId, type ReactNode } from 'react';
import { Check, CheckCircle2, CircleAlert, Clock3, Eye, Hourglass, Mail, MessageSquare, Bell } from 'lucide-react';
import './operations-submission-status.css';

export type SubmissionState='waiting'|'review'|'correction'|'sending'|'failed'|'uncertain'|'dryrun'|'sent';
type Tone='info'|'hold'|'error'|'done';
type StepMark='complete'|'current'|'pending';
type Props={state:SubmissionState;version:number;submittedAt:string;submittedBy:string;templateName?:string;agentEmail?:string;pageCount?:number;reviewers:string[];returnNote?:string;returnFlags?:string[];decidedBy?:string;decidedAt?:string;deliveryMode?:string;confirmedManually?:boolean;failureReason?:string;};

// Same layout for every state; only the chip, headline, body and flow marks change.
export default function SubmissionStatus({state,version,submittedAt,submittedBy,templateName,agentEmail,pageCount,reviewers,returnNote,returnFlags=[],decidedBy,decidedAt,deliveryMode,confirmedManually,failureReason}:Props){
  const titleId=useId();
  const names=reviewers.join(' or ')||'A supervisor';
  const content:Record<SubmissionState,{tone:Tone;chip:string;icon:ReactNode;headline:string;body:string;extra?:string;next:string;marks:[StepMark,StepMark,StepMark];tags:[string,string,string]}>={
    waiting:{tone:'info',chip:'Awaiting approval',icon:<Hourglass size={18}/>,headline:'Waiting for supervisor approval',body:'You’ll be notified.',next:names+' reviews this version, then the reply is emailed to the agent.',marks:['complete','current','pending'],tags:['Done','Waiting','After approval']},
    review:{tone:'hold',chip:'Awaiting your approval',icon:<Eye size={18}/>,headline:'Needs your review',body:'Review the saved version, or choose Edit before approval.',next:'Approve to email the agent, or return it to '+submittedBy+' for correction.',marks:['complete','current','pending'],tags:['Done','Your review','After approval']},
    correction:{tone:'hold',chip:'Needs correction',icon:<MessageSquare size={18}/>,headline:'Returned for correction',body:'The supervisor asked for changes before this can be sent.',next:'The employee updates the proposal and submits a new version.',marks:['complete','current','pending'],tags:['Done','Returned','After resubmission']},
    sending:{tone:'hold',chip:'Approved · sending',icon:<Clock3 size={18}/>,headline:'Approved reply is unfinished',body:'Use Retry approved reply in the action bar below to finish sending the saved package.',next:'The agent receives the approved PDF once delivery finishes.',marks:['complete','complete','current'],tags:['Done','Approved','Unfinished']},
    failed:{tone:'error',chip:'Email failed',icon:<CircleAlert size={18}/>,headline:'Email not delivered',body:'The approved reply could not be delivered. The approval is kept, so a second approval is not needed. Use Retry approved reply in the action bar below.',extra:failureReason,next:'Retry sends the same approved package to the agent.',marks:['complete','complete','current'],tags:['Done','Approved','Not delivered']},
    uncertain:{tone:'hold',chip:'Delivery unconfirmed',icon:<CircleAlert size={18}/>,headline:'Delivery unconfirmed',body:'Gmail may or may not have received this email. Check the sending account’s Sent folder before retrying.',next:'Retry is blocked so the agent is not emailed twice. An Admin can confirm it was sent once it is verified.',marks:['complete','complete','current'],tags:['Done','Approved','Unconfirmed']},
    dryrun:{tone:'hold',chip:'Dry run · not sent',icon:<Clock3 size={18}/>,headline:'Dry run complete — not sent',body:'The email was built and checked but not sent. Turn dry run off, then use Retry approved reply to send it for real.',next:'Nothing reached the agent or the test inbox. Use Download dry-run email in the action bar to inspect it.',marks:['complete','complete','current'],tags:['Done','Approved','Not sent']},
    sent:{tone:'done',chip:'Sent',icon:<CheckCircle2 size={18}/>,headline:deliveryMode==='smtp-redirected'&&!confirmedManually?'Reply sent to the test inbox':'Reply sent',body:(decidedBy?'Approved by '+decidedBy:'Approved')+(decidedAt?' · '+decidedAt:'')+(confirmedManually?'. Manually confirmed — not verified by Gmail.':(deliveryMode==='smtp-redirected'?'. Reply sent to the test inbox (redirected from '+(agentEmail||'the agent')+'). Use Download email in the action bar below.':deliveryMode==='smtp-live'?'. Reply sent. Use Download email in the action bar below.':'. Saved to the local test mailbox. Use Download email in the action bar below.')),next:confirmedManually?'An Admin confirmed delivery from the sending account’s Sent folder.':deliveryMode==='smtp-redirected'?'In test mode the agent is not emailed. Download a copy of the reply with its approved PDF.':deliveryMode==='smtp-live'?'The agent has the approved PDF. Download a copy of the reply if needed.':'Gmail is not connected. Download the reply with its approved PDF.',marks:['complete','complete','complete'],tags:['Done','Approved','Sent']}
  };
  const c=content[state],steps=[{label:'Submitted',icon:<Check size={20}/>},{label:'Supervisor review',icon:state==='correction'?<MessageSquare size={19}/>:<Clock3 size={20}/>},{label:'Reply to agent',icon:<Mail size={19}/>}];
  return <section role="region" className={'ops-card ops-submission-status tone-'+c.tone} aria-labelledby={titleId}>
    <div className="ops-submission-main">
      <div className="ops-submission-lead">
        <span className="ops-submission-chip">{c.icon}{c.chip}</span>
        <h2 id={titleId}>{c.headline}</h2>
        <p className="ops-submission-sub">Version {version} · submitted {submittedAt} by {submittedBy}</p>
        <p className="ops-submission-body">{c.body}</p>{c.extra&&<p className="ops-submission-reason">{c.extra}</p>}
        {state==='correction'&&returnNote&&<blockquote className="ops-submission-note"><b>Supervisor correction note</b><span>{returnNote}</span>{returnFlags.length>0&&<small>Flagged: {returnFlags.map(flag=>flag.replace(/^Custom edit [^:]+: /,'')).join(', ')}</small>}</blockquote>}
      </div>
      <dl className="ops-submission-meta">
        <div><dt>Template</dt><dd>{templateName||'Not recorded'}</dd></div>
        <div><dt>Agent email</dt><dd>{agentEmail||'Not supplied'}</dd></div>
        {!!pageCount&&<div><dt>Pages</dt><dd>{pageCount}</dd></div>}
      </dl>
    </div>
    <ol className="ops-submission-flow" aria-label="Approval progress">{steps.map((step,index)=><li key={step.label} className={c.marks[index]} aria-current={c.marks[index]==='current'?'step':undefined}><span className="ops-submission-step-icon" aria-hidden="true">{step.icon}</span><span className="ops-submission-step-text"><b>{step.label}</b><small>{c.tags[index]}</small></span></li>)}</ol>
    <p className="ops-submission-next"><Bell size={15} aria-hidden="true"/><span><b>What happens next</b> · {c.next}</span></p>
  </section>;
}
