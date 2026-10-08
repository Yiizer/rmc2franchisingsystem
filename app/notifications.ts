import type {Inquiry,User} from './model';
export type TeamNotification={id:string;inquiryId:string;kind:'intake'|'update';title:string;message:string;at:string;recipientIds:string[];readBy:string[]};
export function intakeNotice(x:Inquiry,users:User[]):TeamNotification{return{id:x.id+':received',inquiryId:x.id,kind:'intake',title:'New inquiry received',message:'Agent inquiry received. All franchising staff have been notified.',at:x.received,recipientIds:users.filter(u=>u.active).map(u=>u.id),readBy:[]}}
export function initialNotices(items:Inquiry[],users:User[]){return items.map((x,i)=>({...intakeNotice(x,users),readBy:i<3?[]:users.map(u=>u.id)}))}
