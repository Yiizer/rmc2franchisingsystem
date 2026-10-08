import type { Inquiry, Role } from './model';

export type TaskTone = 'critical' | 'warning' | 'working' | 'ready' | 'waiting' | 'complete' | 'neutral';
export type TaskSignal = { tone:TaskTone; label:string; action:string; reason:string; actionable:boolean; urgent:boolean; rank:number };
export function taskSignal(x:Inquiry,role:Role):TaskSignal {
 const signal=(tone:TaskTone,label:string,action:string,reason:string,actionable:boolean,urgent=false,rank=50)=>({tone,label,action,reason,actionable,urgent,rank});
 if(x.status==='Sent')return signal('complete','Completed','View history','Sent and archived. No action needed.',false,false,90);
 if(x.status==='Rejected')return signal('neutral','Closed','View decision','Rejected by supervisor. No active task.',false,false,90);
 if(role==='Supervisor'){
  if(x.status==='Awaiting approval')return signal('warning',x.priority==='High'?'High-priority review':'Review required','Review proposal','Your decision is needed before this proposal can be sent.',true,x.priority==='High',x.priority==='High'?1:2);
  if(!x.ownerId)return signal('warning','Assignment needed','Assign employee','This inquiry has no assigned employee.',true,false,3);
  return signal('waiting','With employee','View inquiry','The employee owns the next step.',false,false,60);
 }
 if(role==='Admin'){
  if(!x.ownerId)return signal('warning','Assignment needed','Assign employee','This inquiry has no assigned employee.',true,false,2);
  if(x.priority==='High')return signal('warning','High priority','Check progress','High-priority inquiry. Check the assigned team’s progress.',true,true,1);
  if(x.status==='Needs revision')return signal('critical','Revision blocked','Check progress','Supervisor returned the proposal. Follow up with the employee.',true,true,0);
  return signal('waiting','Assigned to team','View inquiry','The assigned employee or supervisor owns the next step.',false,false,60);
 }
 if(x.status==='Awaiting approval')return signal('waiting','Waiting on supervisor','View proposal','Submitted for review. No employee action needed yet.',false,false,60);
 if(x.status==='Needs revision')return signal('critical','Revision required','Revise proposal','Supervisor feedback must be addressed before resubmission.',true,true,0);
 if(x.priority==='High')return signal('warning','High priority',x.status==='Approved'?'Preview & send':!x.extracted?'Review inquiry':!x.verified?'Verify information':x.product?'Complete proposal':'Choose product','Marked high priority. Work on this before routine inquiries.',true,true,1);
 if(x.status==='Approved')return signal('ready','Ready to send','Preview & send','Approved by supervisor. Prepare the final client email.',true,false,3);
 if(!x.extracted)return signal('warning','Review needed','Review inquiry','Read the inquiry and extract information from the attachments.',true,false,4);
 if(!x.verified)return signal('warning',!x.effective?'Missing information':'Verification needed','Verify information',!x.effective?'Confirm the requested start date and verify the account profile.':'Verify the extracted fields before selecting a product.',true,false,2);
 if(!x.product)return signal('working','Product needed','Choose product','Information is verified. Select a suitable product.',true,false,5);
 return signal('working','Draft in progress','Complete proposal','Finish the draft and submit it for supervisor review.',true,false,6);
}
export function taskTab(x:Inquiry){return x.status==='Awaiting approval'||x.status==='Needs revision'||x.status==='Approved'||x.product?'proposal':x.verified?'recommendations':'overview'}


