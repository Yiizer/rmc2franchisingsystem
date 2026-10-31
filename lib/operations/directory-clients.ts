import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db,AppError,transaction} from './database';
import {directoryRecords,historicalIdentity,historicalDetail} from './historical';
import {normalizeClient,clientStates,protectionDaysLeft} from './client-rules';
import {synchronizeInquiryIndex} from './inquiry-index';
import {directoryGroups,statusGroup,statusStyles,manilaToday,displayDate,type DirectoryClient,type ClientListing,type ClientDetail,type DirectoryEdit,type RegisterEntry,type StatusKey} from './directory-model';
import type {InquiryRecord,Staff} from './types';
export const editableDirectoryFields=['status','remarks','agent','branch','plan','account'] as const;
async function editsFor(id:string){return await db.all('SELECT * FROM historical_edits WHERE historical_id=? ORDER BY rowid',id) as DirectoryEdit[];}
function overlay(record:RegisterEntry,edits:DirectoryEdit[]):RegisterEntry {
 const result={...record,fields:record.fields.map(f=>({...f}))};
 for(const edit of edits){
  if(edit.field==='status'){result.statusKey=edit.new_value as StatusKey;result.statusEvidence='Staff display correction: '+edit.reason;}
  else if(['account','agent','branch','plan','remarks'].includes(edit.field))Object.assign(result,{[edit.field]:edit.new_value});
  for(const field of result.fields)if(field.key===edit.field){field.value=edit.new_value;field.display=edit.new_value;}
 }
 return result;
}
export async function directoryRecord(id:string){const record=await historicalDetail(id),edits=await editsFor(id);return {...overlay(record,edits),data:record.data,related:record.related,edits,editAt:edits.at(-1)?.at||''};}
export async function editDirectoryRecord(id:string,user:Staff,input:unknown){
 const body=z.object({field:z.enum(editableDirectoryFields),value:z.string().trim().max(5000),reason:z.string().trim().min(10).max(3000),expectedAt:z.string().max(100)}).strict().parse(input);
 if(!user.active)throw new AppError('Active staff access required.',403);
 if(body.field==='status'&&!Object.hasOwn(statusStyles,body.value))throw new AppError('Choose a supported status.');
 if(body.field==='account'&&!body.value)throw new AppError('Account name is required.');
 return await transaction(async()=>{const record=await directoryRecord(id);if(record.editAt!==body.expectedAt)throw new AppError('A colleague edited this record. Reload before saving.',409);
 const old=body.field==='status'?record.statusKey:record[body.field];
 const at=new Date(Math.max(Date.now(),record.editAt?Date.parse(record.editAt)+1:0)).toISOString();
 await db.run('INSERT INTO historical_edits VALUES (?,?,?,?,?,?,?,?)',randomUUID(),id,body.field,old,body.value,user.name+' ('+user.id+')',at,body.reason);
 cache=undefined;return await directoryRecord(id);});
}
type Collection={projected:Map<string,RegisterEntry>;clients:DirectoryClient[];members:Map<string,string[]>;live:Map<string,ClientDetail['inquiries']>;sheets:string[]};
let cache:{stamp:string;value:Collection}|undefined;
async function collection():Promise<Collection>{
 await synchronizeInquiryIndex();const original=await directoryRecords();
 const stamp=original.stamp+JSON.stringify(await db.all('SELECT * FROM workspace_versions'))+JSON.stringify(await db.get('SELECT count(*) n,max(rowid) last FROM historical_reviews'))+JSON.stringify(await db.get('SELECT count(*) n,max(rowid) last FROM historical_edits'))+Math.floor(Date.now()/60000);
 if(cache?.stamp===stamp)return cache.value;
 const edits=await db.all('SELECT * FROM historical_edits ORDER BY rowid') as DirectoryEdit[],byEdit=new Map<string,DirectoryEdit[]>();
 for(const edit of edits)byEdit.set(edit.historical_id,[...(byEdit.get(edit.historical_id)||[]),edit]);
 const buckets=new Map<string,RegisterEntry[]>(),idKey=new Map<string,string>();
 for(const r of original.items){const key='historical:'+((r as RegisterEntry&{account_key?:string}).account_key||normalizeClient(r.account)||r.id);idKey.set(r.id,key);buckets.set(key,[...(buckets.get(key)||[]),overlay(r,byEdit.get(r.id)||[])]);}
 const clients=new Map<string,DirectoryClient>(),members=new Map<string,string[]>(),live=new Map<string,ClientDetail['inquiries']>();
 const distinctAgents=(names:string[])=>[...new Map(names.filter(Boolean).map(n=>[normalizeClient(n),n])).values()];
 for(const [key,rows] of buckets){rows.sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||'')||b.source_row-a.source_row||a.id.localeCompare(b.id));const latest=rows[0];members.set(key,rows.map(r=>r.id));clients.set(key,{...latest,key,source:'historical',recordCount:rows.length,agents:distinctAgents(rows.map(r=>r.agent)),group:statusGroup(latest.statusKey),statusLabel:statusStyles[latest.statusKey].label,protectionDays:null,historicalIds:rows.map(r=>r.id)});}
 const indexed=await db.all("SELECT s.data,json_extract(i.data,'$.fields') fields,json_extract(i.data,'$.notes') notes FROM inquiry_summaries s JOIN inquiries i ON i.id=s.id") as {data:string;fields:string;notes:string}[];
 const records=indexed.map(r=>({...JSON.parse(r.data),fields:JSON.parse(r.fields),notes:r.notes||''})) as InquiryRecord[];const states=clientStates(records);
 const reviews=await db.all('SELECT inquiry_id,historical_id,identity,outcome FROM historical_reviews ORDER BY rowid') as {inquiry_id:string;historical_id:string;identity:string;outcome:string}[];
 const reviewMap=new Map(reviews.map(r=>[r.inquiry_id+'|'+r.historical_id,r]));
 const liveBuckets=new Map<string,InquiryRecord[]>();
 for(const r of records){const key=normalizeClient(r.fields.company)||r.id;liveBuckets.set(key,[...(liveBuckets.get(key)||[]),r]);}
 for(const [accountKey,rows] of liveBuckets){
  rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));const r=rows[0],state=states[r.id];
  const valid=rows.flatMap(item=>reviews.filter(v=>v.inquiry_id===item.id&&reviewMap.get(v.inquiry_id+'|'+v.historical_id)===v&&v.identity===historicalIdentity(item)));
  const confirmed=[...new Set(valid.filter(v=>v.outcome==='same').map(v=>idKey.get(v.historical_id)).filter(Boolean))] as string[];
  const key=confirmed.length===1?confirmed[0]:'live:'+accountKey,history=clients.get(key),histKey='historical:'+accountKey;
  const historicalRows=buckets.get(histKey)||[];
  const possible=confirmed.length!==1&&historicalRows.some(h=>rows.some(item=>{const v=reviewMap.get(item.id+'|'+h.id);return !v||v.identity!==historicalIdentity(item)||v.outcome!=='distinct';}));
  const dateISO=manilaToday(new Date(r.updatedAt)),age=Math.max(0,Math.round((Date.parse(manilaToday())-Date.parse(dateISO))/86400000));
  const group=r.closure||state?.state==='archived'?'lost':state?.state==='duplicate'||state?.state==='identify'?'review':r.status==='Sent'?'won':'active';
  const statusLabel=r.closure?(r.closure.kind==='declined'?'Declined':'Archived'):state?.state==='archived'?'Archived':state?.state==='duplicate'?'Duplicate on hold':state?.state==='identify'?'Client check needed':r.status;
  clients.set(key,{id:r.id,account:r.fields.company||'Unnamed client',agent:r.fields.agentName||'',branch:r.fields.branch||r.fields.division||'',status:r.status,sheet:history?.sheet||'',source_row:0,plan:r.fields.requestedPlan||'',remarks:r.notes||'',serial:'',recordedDate:displayDate(dateISO),recordedLabel:'Last activity',dateISO,dateIssue:'',savedAge:'',age,statusKey:group==='won'?'sent':group==='lost'?'expired':group==='review'?'review':'processing',statusEvidence:'Current inquiry processing status',fields:history?.fields||[],key,source:history?'both':'live',recordCount:rows.length+(history?.recordCount||0),agents:distinctAgents([...rows.map(x=>x.fields.agentName),...(history?.agents||[])]),group,statusLabel,protectionDays:state?.protection?protectionDaysLeft(state.protection,Date.now()):null,inquiryId:r.id,possibleMatch:possible?r.id:undefined,historicalIds:members.get(key)||[]});
  live.set(key,rows.map(x=>({id:x.id,account:x.fields.company,agent:x.fields.agentName,status:x.status,at:x.updatedAt})));
  if(possible){const h=clients.get(histKey);if(h)h.possibleMatch=r.id;}
 }
 const value={projected:new Map([...buckets.values()].flat().map(r=>[r.id,r])),clients:[...clients.values()],members,live,sheets:original.sheets};cache={stamp,value};return value;
}
export async function clientDirectory(params:URLSearchParams):Promise<ClientListing>{
 const q=z.object({search:z.string().max(200).default(''),source:z.enum(['all','live','historical']).default('all'),group:z.enum(['','active','won','lost','notStarted','review']).default(''),sheet:z.string().max(100).default(''),agent:z.string().max(500).default(''),branch:z.string().max(500).default(''),sort:z.enum(['account','date-new','date-old','age-old','age-new']).default('account'),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(Object.fromEntries(params));
 const all=await collection(),term=q.search.toLowerCase();
 const byId=all.projected;
 const scoped=all.clients.filter(c=>(q.source==='all'||c.source===q.source||c.source==='both')&&(!q.sheet||c.historicalIds.some(id=>byId.get(id)?.sheet===q.sheet)));
 const filtered=scoped.filter(c=>(!q.agent||c.agents.includes(q.agent))&&(!q.branch||c.branch===q.branch)&&(!term||[c.account,c.agents.join(' '),c.branch,c.remarks,c.plan,c.serial,...c.historicalIds.map(id=>{const r=byId.get(id);return r?[r.account,r.agent,r.serial,r.remarks,r.plan].join(' '):'';})].join(' ').toLowerCase().includes(term)));
 const counts=(Object.keys(directoryGroups) as DirectoryClient['group'][]).map(key=>({key,count:filtered.filter(c=>c.group===key).length}));
 const matches=filtered.filter(c=>!q.group||c.group===q.group).sort((a,b)=>{if(q.sort==='account')return a.account.localeCompare(b.account)||a.key.localeCompare(b.key);const av=q.sort.startsWith('age')?a.age:a.dateISO?Date.parse(a.dateISO):null,bv=q.sort.startsWith('age')?b.age:b.dateISO?Date.parse(b.dateISO):null;return av===null||bv===null?av===bv?a.key.localeCompare(b.key):av===null?1:-1:(av-bv)*(q.sort==='date-new'||q.sort==='age-old'?-1:1)||a.key.localeCompare(b.key);});
 const pages=Math.max(1,Math.ceil(matches.length/50)),page=Math.min(q.page,pages),columns=new Map<string,string>();
 for(const c of scoped)for(const id of c.historicalIds){const r=byId.get(id);if(r&&(!q.sheet||r.sheet===q.sheet))for(const f of r.fields)columns.set(f.key,f.label);}
 return {items:matches.slice((page-1)*50,page*50).map(c=>q.sheet?{...c,fields:c.historicalIds.map(id=>byId.get(id)).filter((r):r is RegisterEntry=>!!r&&r.sheet===q.sheet).sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||'')||b.source_row-a.source_row)[0]?.fields||c.fields}:c),total:matches.length,page,pages,pageSize:50,counts,sheets:all.sheets,agents:[...new Set(scoped.flatMap(c=>c.agents))].sort(),branches:[...new Set(scoped.map(c=>c.branch).filter(Boolean))].sort(),columns:[...columns].map(([key,label])=>({key,label})),asOf:manilaToday()};
}
export async function directoryClient(key:string):Promise<ClientDetail>{
 const all=await collection();let client=all.clients.find(c=>c.key===key);
 if(!client){const r=await directoryRecord(key);client=all.clients.find(c=>c.historicalIds.includes(r.id));}
 if(!client)throw new AppError('Client not found.',404);
 return {client,records:await Promise.all(client.historicalIds.map(id=>directoryRecord(id))),inquiries:all.live.get(client.key)||[]};
}
