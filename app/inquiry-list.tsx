"use client";
import {Inbox} from 'lucide-react';
import {Badge} from './common';
import {handledNames,timestamp,inquiryAge,receivedAgo} from './inquiry-history';
import type {Inquiry,User} from './model';
export default function InquiryList({items,users,now,onOpen}:{items:Inquiry[];users:User[];now:number;onOpen:(x:Inquiry)=>void}){
 return items.length?<div className="inquiry-history-table-wrap"><table className="inquiry-history-table"><thead><tr><th>Inquiry / account</th><th>Division</th><th>Status</th><th>Handled by</th><th>Received</th><th>Inquiry age</th><th>Last updated</th></tr></thead><tbody>{items.map(x=><tr key={x.id} tabIndex={0} role="button" aria-label={'Open '+x.company} onClick={()=>onOpen(x)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(x)}}}><td><b>{x.company}</b><small>{x.id}</small></td><td>{x.franchise?.division||'Unconfirmed'}</td><td><Badge status={x.status}/></td><td>{handledNames(x,users)}</td><td><time dateTime={x.createdAt}>{timestamp(x.createdAt)}</time><small>{receivedAgo(x,now)}</small></td><td>{inquiryAge(x,now)}<small>{['Sent','Rejected'].includes(x.status)?'Until closure':'Since received'}</small></td><td><time dateTime={x.updatedAt}>{timestamp(x.updatedAt)}</time><small>{x.events.at(-1)?.actor||'Gmail simulator'}</small></td></tr>)}</tbody></table></div>:<div className="library-empty"><Inbox size={28}/><h3>No matching inquiries</h3><p>Open Inquiries to start working on a shared record.</p></div>;
}
