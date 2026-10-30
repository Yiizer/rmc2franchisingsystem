'use client';
import {ChevronRight} from 'lucide-react';
import type {InquirySummary,Staff,WorkspaceData} from '@/lib/operations/types';
import {ageLabel,manilaTime} from '@/lib/operations/types';
import {protectionDaysLeft} from '@/lib/operations/client-rules';
import {Empty,Status} from './operations-common';

// Plain-text protection note under the agent name (the full chip lives on the Inquiries list).
function protectionNote(state:WorkspaceData['clientStates'][string]|undefined,now:number){
 if(!state)return 'Protection not started';
 if(state.state==='duplicate')return 'On hold · duplicate client';
 if(state.state==='archived')return 'Archived';
 if(state.state==='identify')return 'Client check needed';
 if(!state.protection)return 'Protection not started';
 const days=protectionDaysLeft(state.protection,now);
 return days===0?'Protection expired':'Protection '+days+'d left';
}

// Each row is the link: no buttons. The chevron and hover state show it opens the inquiry.
export default function DashboardQueue({records,user,users,activity,clientStates,now,onOpen}:{records:InquirySummary[];user:Staff;users:Staff[];activity:WorkspaceData['activity'];clientStates:WorkspaceData['clientStates'];now:number;onOpen:(record:InquirySummary)=>void}){
 if(!records.length)return <Empty text="Your inquiry queue is clear"/>;
 return <div className="dash-queue-scroll"><table className="dash-queue"><thead><tr><th>Inquiry</th><th>Status</th><th>Agent</th><th>Received</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{records.map(record=>{
 const handler=activity.find(a=>a.inquiryId===record.id),own=handler?.userId===user.id,state=clientStates[record.id],blocked=state?.state!=='clear',other=handler&&!own;
 const review=user.canApprove&&['Awaiting approval','Supervisor editing'].includes(record.status);
 const action=other||blocked?'View':review?'Review':own||record.handledBy.includes(user.id)?'Continue':'Pick up';
 const company=record.fields.company||'Account name missing';
 return <tr key={record.id} className="dash-row" tabIndex={0} role="link" aria-label={action+' '+company} title={action} onClick={()=>onOpen(record)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onOpen(record);}}}>
  <td><span className="dash-account" title={company}>{company}</span>{own&&<span className="dash-yours">Yours</span>}<small>{record.id}</small>{!!record.historicalMatchCount&&<small className="dash-attention">Historical account found · review needed</small>}{record.customized&&<small>Customized proposal</small>}</td>
  <td data-label="Status"><Status value={record.status}/>{other&&<small>Handled by {users.find(u=>u.id===handler.userId)?.name||'a colleague'} · View only</small>}</td>
  <td data-label="Agent">{record.fields.agentName||'Not recorded'}<small className={state?.state==='duplicate'?'dash-attention':''}>{protectionNote(state,now)}</small></td>
  <td data-label="Received"><span title={manilaTime(record.createdAt)}>{ageLabel(record.createdAt,now)}</span><small>Updated {ageLabel(record.updatedAt,now)}</small></td>
  <td className="dash-chevron"><span className="sr-only">{action}</span><ChevronRight size={18} aria-hidden="true"/></td></tr>;
 })}</tbody></table></div>;
}
