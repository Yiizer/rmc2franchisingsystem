import type { Inquiry, Role } from './model';

export type TaskTone = 'critical' | 'warning' | 'working' | 'ready' | 'waiting' | 'complete' | 'neutral';
export type TaskSignal = { tone:TaskTone; label:string; action:string; reason:string; actionable:boolean; urgent:boolean; rank:number };
export function taskSignal(x:Inquiry,role:Role):TaskSignal {
 const signal=(tone:TaskTone,label:string,action:string,reason:string,actionable:boolean,urgent=false,rank=50)=>({tone,label,action,reason,actionable,urgent,rank});
 if(x.status==='Sent')return signal('complete','Completed','View history','Sent and archived. No action needed.',false,false,90);
 if(x.status==='Rejected')return signal('neutral','Closed','View decision','Rejected by supervisor. No active task.',false,false,90);
 if(x.status==='Awaiting approval')return signal(role==='Supervisor'?'warning':'waiting',role==='Supervisor'?'Review required':'Waiting on supervisor',role==='Supervisor'?'Review proposal':'View proposal','Submitted for supervisor review.',role==='Supervisor',false,role==='Supervisor'?2:60);
 if(x.status==='Needs revision')return signal('warning','Revision required','Revise proposal','Address the supervisor feedback before resubmitting.',true,false,0);
 if(x.status==='Approved')return signal('ready','Ready to send','Preview email','Approved by supervisor. Prepare the final email.',role==='Employee',false,3);
 if(x.status==='New inquiry')return signal('working','First review needed','Review form','Anyone can pick up this inquiry.',true,false,1);
 if(!x.verified)return signal('working','Form review in progress','Review form','Check the submitted form.',true,false,4);
 return signal('working',x.approvedProposalSnapshot?'Draft in progress':'Proposal needed',x.approvedProposalSnapshot?'Continue proposal':'Prepare proposal','Use an approved proposal reference.',true,false,5);
}
export function taskTab(x:Inquiry){return x.status==='Awaiting approval'||x.status==='Needs revision'||x.status==='Approved'||x.product?'proposal':x.verified?'recommendations':'overview'}


