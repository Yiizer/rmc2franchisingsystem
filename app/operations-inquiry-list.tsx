'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,SlidersHorizontal,Columns3,X,ChevronLeft,ChevronRight,ArrowUp,ArrowDown,Upload,Info,CheckCircle2,LockKeyhole,Users,Archive,ArrowRight,PanelRight} from 'lucide-react';
import type {InquirySummary,Staff,WorkspaceData,WorkspaceView} from '@/lib/operations/types';
import {ageLabel,manilaTime} from '@/lib/operations/types';
import {Status,initials,staffName} from './operations-common';
import {HandlingBadge} from './operations-activity';
import {ProtectionIndicator} from './operations-client-protection';
import './operations-directory.css';
import './operations-inquiry-list.css';

type Tab={label:string;view:string;filter:string;count:number};
type Column={key:string;label:string};
export type ListSort='newest'|'oldest'|'updated'|'account';
const columnSets:Record<string,{all:Column[];defaults:string[]}>={
 inquiries:{all:[{key:'status',label:'Status'},{key:'handler',label:'Handler'},{key:'agent',label:'Agent'},{key:'protection',label:'Protection'},{key:'received',label:'Received'},{key:'updated',label:'Updated'},{key:'division',label:'Division'}],defaults:['status','handler','agent','protection','updated']},
 closed:{all:[{key:'status',label:'Status'},{key:'agent',label:'Agent'},{key:'protection',label:'Protection'},{key:'sent',label:'Sent by'},{key:'received',label:'Received'},{key:'updated',label:'Updated'},{key:'division',label:'Division'}],defaults:['status','agent','protection','updated']},
 queue:{all:[{key:'status',label:'Status'},{key:'prepared',label:'Prepared by'},{key:'agent',label:'Agent'},{key:'waiting',label:'Waiting'},{key:'protection',label:'Protection'},{key:'received',label:'Received'},{key:'division',label:'Division'}],defaults:['status','agent','waiting','protection']},
};
export const listGroup=(view:string)=>['History','Archives'].includes(view)?'closed':['Approval Queue','Returned Proposals'].includes(view)?'queue':'inquiries';
const tabStatus=new Set(['To prepare','Awaiting approval','Duplicate client','Needs correction']);
function readColumns(group:string){try{const v=JSON.parse(window.localStorage.getItem('rmc2.columns.'+group)||'null');if(Array.isArray(v))return v as string[];}catch{/* storage blocked */}return columnSets[group].defaults;}

export function nextStepLabel(record:InquirySummary,state:WorkspaceData['clientStates'][string]|undefined,canApprove:boolean){
 return state?.state==='archived'?'View archived inquiry':state?.state==='duplicate'?'Review the client match':state?.state==='identify'?'Identify the client':record.status==='Awaiting approval'?(canApprove?'Review submitted proposal':'Waiting for supervisor'):record.status==='Sent'?'View sent proposal':record.status==='Needs correction'?'Review correction note':record.status==='New inquiry'?'Review the submitted form':'Continue the proposal';
}

export default function InquiryList({view,filter,data,user,search,searching,loading,division,sort,onSearch,onFilter,onDivision,onSort,onPage,onGo,onOpen,onImport,now}:{view:string;filter:string;data:WorkspaceView;user:Staff;search:string;searching:boolean;loading:boolean;division:string;sort:ListSort;onSearch:(v:string)=>void;onFilter:(v:string)=>void;onDivision:(v:string)=>void;onSort:(v:ListSort)=>void;onPage:(page:number)=>void;onGo:(view:string,filter?:string)=>void;onOpen:(record:InquirySummary)=>void;onImport:()=>void;now:number}){
 const group=listGroup(view),counts=data.tabCounts,records=data.inquiries,info=data.pagination;
 const [columnMap,setColumnMap]=useState<Record<string,string[]>>(()=>Object.fromEntries(Object.keys(columnSets).map(g=>[g,typeof window==='undefined'?columnSets[g].defaults:readColumns(g)])));
 const columns=columnMap[group];
 // The preview closes when the tab or view changes.
 const [preview,setPreview]=useState<{scope:string;id:string}|null>(null),scope=view+'|'+filter,detail=preview?.scope===scope?preview.id:'';
 const setDetail=(id:string)=>setPreview(id?{scope,id}:null);
 const saveColumns=(next:string[])=>{setColumnMap(m=>({...m,[group]:next}));try{window.localStorage.setItem('rmc2.columns.'+group,JSON.stringify(next));}catch{/* not persisted */}};
 const tabs:Tab[]=group==='closed'?[{label:'Sent',view:'History',filter:'All statuses',count:counts?.sent??0},{label:'Archived',view:'Archives',filter:'All statuses',count:counts?.archived??0}]
  :group==='queue'?[{label:'Waiting',view:'Approval Queue',filter:'All statuses',count:counts?.waiting??0},{label:'Returned for correction',view:'Returned Proposals',filter:'All statuses',count:counts?.returned??0}]
  :[{label:'Mine',view:'My Inquiries',filter:'All statuses',count:counts?.mine??0},{label:'All',view:'Inquiries',filter:'All statuses',count:counts?.all??0},{label:'To prepare',view:'Inquiries',filter:'To prepare',count:counts?.toPrepare??0},{label:'Awaiting approval',view:'Inquiries',filter:'Awaiting approval',count:counts?.awaiting??0},{label:'On hold',view:'Inquiries',filter:'Duplicate client',count:counts?.onHold??0}];
 const tabFilter=view==='Inquiries'&&tabStatus.has(filter);
 const activeTab=(t:Tab)=>t.view===view&&(t.filter===filter||(!tabFilter&&t.filter==='All statuses'));
 const statusChoices=group==='closed'?(view==='Archives'?['Expired','Declined','Transferred']:[]):group==='queue'?[]:['New inquiry','Preparing proposal','Waiting for agent details','Needs correction','Supervisor editing','Approved — email failed','Sent','Sent today','Expiring protection'];
 const statusFilter=!tabFilter&&filter!=='All statuses'?filter:'';
 const filterCount=(statusFilter?1:0)+(division!=='All divisions'?1:0);
 const all=columnSets[group].all,visible=all.filter(c=>columns.includes(c.key));
 const index=records.findIndex(r=>r.id===detail),selected=index>=0?records[index]:undefined;
 const busy=loading||searching;
 const title=group==='closed'?'Closed':group==='queue'?'Approval Queue':'Inquiries';
 const subtitle=group==='closed'?(view==='Archives'?'Expired, declined and transferred registrations, with their original files and history.':'Approved replies and their retained proposal versions.'):group==='queue'?'Submitted proposals waiting for a decision, oldest first.':view==='My Inquiries'?'Inquiries you have started, edited or are handling.':'Every inquiry and its current handler.';
 const empty:Record<string,string>={'My Inquiries':'Inquiries you start or edit will show here.',Inquiries:'No inquiries match this view.','Approval Queue':'Nothing waiting for approval.','Returned Proposals':'No proposals are waiting for corrections.',History:'Sent proposals will show here.',Archives:'Expired, declined and transferred requests will show here.'};
 return <div className="dir-page dir-full-page ops-inquiry-list">
  <header className="dir-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{group==='inquiries'&&user.role!=='Supervisor'&&<button className="ops-btn primary" onClick={onImport}><Upload size={16}/>Import agent form</button>}</header>
  <section className="dir-register" aria-label={title} aria-busy={busy}>
   <div className="dir-toolbar">
    <label className="dir-search"><Search size={17}/><input aria-label="Search inquiries" placeholder="Search account, agent, handler or inquiry…" value={search} onChange={e=>onSearch(e.target.value)}/></label>
    {(statusChoices.length>0||data.divisions.length>1)&&<details className="dir-filter-menu dir-columns"><summary><SlidersHorizontal size={15}/>Filters <b>{filterCount}</b></summary><div>
     {statusChoices.length>0&&<label>{view==='Archives'?'Reason':'Status'}<select aria-label={view==='Archives'?'Filter reason':'Filter status'} value={statusFilter||'All statuses'} onChange={e=>onFilter(e.target.value)}><option value="All statuses">{view==='Archives'?'All reasons':'All statuses'}</option>{statusChoices.map(s=><option key={s}>{s}</option>)}</select></label>}
     <label>Division<select aria-label="Filter division" value={division} onChange={e=>onDivision(e.target.value)}><option>All divisions</option>{data.divisions.map(d=><option key={d}>{d}</option>)}</select></label>
     <button className="ops-btn" onClick={()=>{onDivision('All divisions');if(statusFilter)onFilter('All statuses');}}>Reset filters</button></div></details>}
    <label className="dir-sort-control"><span className="sr-only">Sort inquiries</span><select aria-label="Sort" value={sort} onChange={e=>onSort(e.target.value as ListSort)}><option value="newest">{group==='queue'?'Sort: Oldest submitted':'Sort: Newest received'}</option>{group!=='queue'&&<option value="oldest">Oldest received</option>}<option value="updated">Recently updated</option><option value="account">Account A–Z</option></select></label>
    <details className="dir-columns"><summary><Columns3 size={16}/>Columns</summary><div>{all.map(c=><label key={c.key}><input type="checkbox" checked={columns.includes(c.key)} onChange={e=>saveColumns(e.target.checked?[...columns,c.key]:columns.filter(k=>k!==c.key))}/>{c.label}</label>)}<button className="ops-btn" onClick={()=>saveColumns(columnSets[group].defaults)}>Reset columns</button></div></details>
    <ColorLegend/>
   </div>
   {(statusFilter||division!=='All divisions'||search)&&<div className="dir-active-filters">{search&&<button onClick={()=>onSearch('')}>search: {search}<X size={13}/></button>}{statusFilter&&<button onClick={()=>onFilter('All statuses')}>{view==='Archives'?'reason':'status'}: {statusFilter}<X size={13}/></button>}{division!=='All divisions'&&<button onClick={()=>onDivision('All divisions')}>division: {division}<X size={13}/></button>}<button onClick={()=>{onSearch('');onDivision('All divisions');if(statusFilter)onFilter('All statuses');}}>Clear all</button></div>}
   <nav className="dir-status-filters" aria-label={title+' views'}>{tabs.map(t=><button key={t.label} className={'dir-filter'+(activeTab(t)?' is-active':'')} aria-pressed={activeTab(t)} onClick={()=>onGo(t.view,t.filter)}>{t.label} <b>{t.count}</b></button>)}</nav>
   {view==='Archives'&&<p className="ops-list-note"><Archive size={16}/>Declined and expired requests stay here. A previous agent cannot restart an expired client registration. Verified BOR transfers link to the new registration.</p>}
   <div className="dir-table-scroll" tabIndex={0} role="region" aria-label={title+' list, scroll for more columns'}>
    {busy?<div className="ops-list-loading" role="status">Loading inquiries…</div>:records.length?<table className="dir-table ops-inq-table"><thead><tr><th>Account</th>{visible.map(c=><th key={c.key}>{c.label}</th>)}<th className="dir-open-column"><span className="sr-only">Preview</span></th></tr></thead>
     <tbody>{records.map(record=>{const state=data.clientStates[record.id];return <tr key={record.id} className={detail===record.id?'is-selected':''} tabIndex={0} role="link" aria-label={'Open '+(record.fields.company||record.id)} onClick={()=>onOpen(record)} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'){e.preventDefault();onOpen(record);}if(e.key===' '){e.preventDefault();setDetail(record.id);}}}>
      <th scope="row"><b className="dir-client-name" title={record.fields.company}>{record.fields.company||'Account name missing'}</b><small>{record.id}{record.customized?' · Customized':''}{record.historicalMatchCount?' · Historical match':''}</small></th>
      {visible.map(c=><td key={c.key} data-label={c.label} className={'dir-cell-'+c.key}><Cell column={c.key} record={record} data={data} user={user} now={now}/></td>)}
      <td className="dir-open-column"><button className="ops-preview-btn" aria-label={'Preview '+(record.fields.company||record.id)} data-tip="Preview" onClick={e=>{e.stopPropagation();setDetail(record.id);}}><PanelRight size={16}/></button></td></tr>;})}</tbody></table>
     :<div className="dir-empty"><h3>No inquiries in this view</h3><p>{empty[view]||'Try changing your search or filters.'}</p>{view==='My Inquiries'&&!search&&(counts?.all??0)>0&&<button className="ops-btn primary" onClick={()=>onGo('Inquiries','All statuses')}>View all {counts?.all} inquiries</button>}{(statusFilter||division!=='All divisions'||search)&&<button className="ops-btn" onClick={()=>{onSearch('');onDivision('All divisions');if(statusFilter)onFilter('All statuses');}}>Clear filters</button>}</div>}
   </div>
   <footer className="dir-bottom"><span><span>{info.total?((info.page-1)*info.pageSize+1).toLocaleString()+'–'+Math.min(info.page*info.pageSize,info.total).toLocaleString():'0'} of {info.total.toLocaleString()}</span> inquiries</span><div><button className="ops-btn" disabled={busy||info.page<=1} onClick={()=>onPage(info.page-1)}><ChevronLeft size={16}/>Previous</button><span>Page {info.page} of {info.pages}</span><button className="ops-btn" disabled={busy||info.page>=info.pages} onClick={()=>onPage(info.page+1)}>Next<ChevronRight size={16}/></button></div></footer>
  </section>
  {selected&&<InquiryPreview record={selected} data={data} user={user} now={now} onClose={()=>setDetail('')} onOpen={()=>onOpen(selected)} onPrevious={index>0?()=>setDetail(records[index-1].id):undefined} onNext={index<records.length-1?()=>setDetail(records[index+1].id):undefined}/>}
 </div>;
}

function Cell({column,record,data,user,now}:{column:string;record:InquirySummary;data:WorkspaceView;user:Staff;now:number}){
 const state=data.clientStates[record.id];
 if(column==='status')return <><Status value={record.status}/><small>{nextStepLabel(record,state,user.canApprove)}</small></>;
 if(column==='handler'){const handler=data.activity.find(a=>a.inquiryId===record.id),person=data.users.find(u=>u.id===handler?.userId);return handler?<div className="ops-handler-cell"><span className="ops-avatar small">{initials(person?.name||handler.userId)}</span><HandlingBadge activity={[handler]} users={data.users} currentUserId={user.id}/></div>:<HandlerFree record={record} state={state}/>;}
 if(column==='agent')return <>{record.fields.agentName||'Not recorded'}<small>{record.fields.branch||''}</small></>;
 if(column==='protection')return <ProtectionIndicator state={state} now={now}/>;
 if(column==='received')return <>{manilaTime(record.createdAt)}<small>{ageLabel(record.createdAt,now)}</small></>;
 if(column==='updated')return <span title={manilaTime(record.updatedAt)}>{ageLabel(record.updatedAt,now)}</span>;
 if(column==='division')return <>{record.fields.division||'Unconfirmed'}</>;
 if(column==='sent')return <>{record.sentBy?staffName(data.users,record.sentBy):'—'}<small>{record.deliveredAt?manilaTime(record.deliveredAt):''}</small></>;
 if(column==='prepared')return record.preparedBy?<>{staffName(data.users,record.preparedBy)}</>:<span className="ops-muted">Not recorded</span>;
 if(column==='waiting'){const overdue=!!record.submittedAt&&now-Date.parse(record.submittedAt)>=86400000;return <span className={overdue?'ops-wait-overdue':''}>{record.submittedAt?ageLabel(record.submittedAt,now):'Not recorded'}</span>;}
 return null;
}
function HandlerFree({record,state}:{record:InquirySummary;state?:WorkspaceData['clientStates'][string]}){
 if(state?.state==='archived')return <span className="ops-muted">View only</span>;
 if(state?.state==='duplicate')return <span className="ops-handler-free other">On hold</span>;
 return ['New inquiry','Preparing proposal','Waiting for agent details','Needs correction'].includes(record.status)?<span className="ops-handler-free">Available</span>:<span className="ops-muted">—</span>;
}

export function ColorLegend(){
 return <details className="ops-legend"><summary aria-label="What the colors mean"><Info size={15}/>Colors</summary><div>
  <section><h3>Buttons</h3><ul><li className="lg-action">Orange · your next step</li><li className="lg-avail">Blue · available to pick up</li></ul></section>
  <section><h3>Who is handling</h3><ul><li className="lg-avail"><Users size={13}/>Available</li><li className="lg-mine"><CheckCircle2 size={13}/>You</li><li className="lg-other"><LockKeyhole size={13}/>A colleague · view only</li></ul></section>
  <section><h3>Status</h3><ul><li className="ops-badge blue">New inquiry</li><li className="ops-badge amber">Preparing</li><li className="ops-badge purple">Awaiting approval</li><li className="ops-badge red">Needs correction</li><li className="ops-badge green">Sent</li><li className="ops-badge slate">Closed</li></ul></section>
  <section><h3>Protection countdown</h3><ul><li className="ops-client-pill protected">More than 7 days</li><li className="ops-client-pill warning">7 days or less</li><li className="ops-client-pill duplicate">Expired or on hold</li><li className="ops-client-pill neutral">Not started</li></ul></section>
 </div></details>;
}

function InquiryPreview({record,data,user,now,onClose,onOpen,onPrevious,onNext}:{record:InquirySummary;data:WorkspaceView;user:Staff;now:number;onClose:()=>void;onOpen:()=>void;onPrevious?:()=>void;onNext?:()=>void}){
 const panel=useRef<HTMLElement>(null),state=data.clientStates[record.id],f=record.fields;
 useEffect(()=>{panel.current?.focus();},[record.id]);
 const handler=data.activity.find(a=>a.inquiryId===record.id),mine=handler?.userId===user.id;
 const tone=handler?(mine?'mine':'other'):state?.state==='clear'&&['New inquiry','Preparing proposal','Waiting for agent details','Needs correction'].includes(record.status)?'avail':'';
 const review=user.canApprove&&['Awaiting approval','Supervisor editing'].includes(record.status);
 const label=review?'Review proposal':mine?'Continue':'Open inquiry';
 const facts:[string,string|undefined][]=useMemo(()=>[['Agent',f.agentName],['Agent email',f.agentEmail],['Client contact',f.contactName||f.addressee],['Division',f.division||'Unconfirmed'],['Requested plan',f.requestedPlan],['Employees',f.employees],['Received',manilaTime(record.createdAt)],['Last updated',ageLabel(record.updatedAt,now)]],[f,record.createdAt,record.updatedAt,now]);
 return <aside ref={panel} className="dir-side-panel ops-inquiry-preview" role="dialog" aria-modal="false" aria-label="Inquiry preview" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.target===panel.current&&e.key==='ArrowUp')onPrevious?.();if(e.target===panel.current&&e.key==='ArrowDown')onNext?.();}}>
  <div className="dir-panel-controls"><span>INQUIRY PREVIEW</span><div><button className="ops-btn" aria-label="Previous inquiry" disabled={!onPrevious} onClick={onPrevious}><ArrowUp size={17}/></button><button className="ops-btn" aria-label="Next inquiry" disabled={!onNext} onClick={onNext}><ArrowDown size={17}/></button><button className="ops-btn" aria-label="Close inquiry preview" onClick={onClose}><X size={18}/></button></div></div>
  <div className="dir-panel-heading"><h2>{f.company||'Account name missing'}</h2><div className="ops-preview-status"><Status value={record.status}/><span>{record.id}</span></div></div>
  <div className="dir-panel-body">
   {tone&&<div className={'ops-handling-card '+tone}><div>{tone==='mine'?<CheckCircle2 size={18}/>:tone==='other'?<LockKeyhole size={18}/>:<Users size={18}/>}<span><b>{tone==='mine'?'You’re handling this':tone==='other'?staffName(data.users,handler!.userId)+' is handling this':'Available to pick up'}</b><small>{tone==='other'?'View only until they release it.':tone==='mine'?'Continue where you left off.':'Open it and choose Start handling.'}</small></span></div></div>}
   <div className="ops-preview-row"><span>Next step</span><b>{nextStepLabel(record,state,user.canApprove)}</b></div>
   <div className="ops-preview-row"><span>Protection</span><ProtectionIndicator state={state} now={now}/></div>
   <dl className="dir-facts">{facts.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||'Not recorded'}</dd></div>)}</dl>
  </div>
  <div className="ops-preview-actions"><button className={'ops-btn '+(tone==='other'||state?.state==='archived'?'secondary':'primary')} onClick={onOpen}>{tone==='other'?'View inquiry':label}<ArrowRight size={16}/></button></div>
 </aside>;
}
