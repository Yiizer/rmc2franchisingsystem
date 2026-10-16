import { Bell, Check, Clock3, Hourglass, Mail } from 'lucide-react';

export default function ApprovalWaiting({submittedBy,submittedAt}:{submittedBy:string;submittedAt:string}){
  return <section className="ops-card ops-approval-wait" aria-label="Proposal approval status">
    <div className="ops-approval-wait-heading">
      <span className="ops-approval-wait-symbol" aria-hidden="true"><Hourglass size={26}/></span>
      <div><h2>Waiting for approval</h2><p>Emerson or Zeo will review it.</p></div>
    </div>
    <ol className="ops-approval-flow" aria-label="Approval progress">
      <li className="complete"><span className="ops-approval-step-icon" aria-hidden="true"><Check size={22}/></span><b>Submitted</b></li>
      <li className="current" aria-current="step"><span className="ops-approval-step-icon" aria-hidden="true"><Clock3 size={23}/></span><b>Supervisor review</b><span className="ops-approval-wait-tag">Waiting</span></li>
      <li className="pending"><span className="ops-approval-step-icon" aria-hidden="true"><Mail size={21}/></span><b>Reply to agent</b><small>After approval</small></li>
    </ol>
    <div className="ops-approval-wait-footer"><span><Bell size={15} aria-hidden="true"/>You’ll be notified.</span><small>{submittedBy} · {submittedAt}</small></div>
  </section>;
}
