import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, audit, db, inquiry, persist, transaction, notify, allUsers } from './database';
import { clientIdentity, clientIdentityKeys, normalizeClient } from './client-rules';
import type { Staff, InquiryRecord } from './types';
import {projectHistorical,manilaToday,statusStyles,type RegisterEntry,type HistoricalData,type DirectoryListing} from './directory-model';
export function historicalIdentity(record:InquiryRecord){return JSON.stringify([clientIdentity(record),record.fields.agentName||'',record.fields.agentEmail||'',record.fields.agentPhone||'']);}
export async function historicalMatchCounts():Promise<Map<string,number>>{return new Map((await db.all("SELECT k.inquiry_id,count(DISTINCT h.id) n FROM inquiry_keys k JOIN historical_accounts h ON k.kind='company' AND k.value=h.account_key GROUP BY k.inquiry_id") as {inquiry_id:string;n:number}[]).map(row=>[row.inquiry_id,Number(row.n)]));}
type Row={id:string;batch:string;sheet:string;source_row:number;account:string;account_key:string;agent:string;branch:string;status:string;data:string};
// Historical source records are immutable outside the importer. Its report changes on re-import.
let directoryCache:{stamp:string;items:RegisterEntry[];sheets:string[]}|undefined;
export async function directoryRecords(){

 const imports=await db.all('SELECT id,report FROM historical_imports ORDER BY id') as {id:string;report:string}[];
 const stamp=manilaToday()+JSON.stringify(imports);
 if(!directoryCache||directoryCache.stamp!==stamp){
  const rows=await db.all('SELECT * FROM historical_accounts') as Row[];
  const sheets=new Set(rows.map(r=>r.sheet));
  for(const batch of imports){const report=JSON.parse(batch.report);for(const sheet of report.sheets||[])sheets.add(sheet.sheet);}
  directoryCache={stamp,items:rows.map(r=>projectHistorical(r)),sheets:[...sheets].sort()};
 }
 return directoryCache;
}
export async function directory(params:URLSearchParams):Promise<DirectoryListing>{
 const query=z.object({search:z.string().max(200).default(''),sheet:z.string().max(100).default(''),status:z.string().max(100).default(''),agent:z.string().max(500).default(''),branch:z.string().max(500).default(''),sort:z.enum(['account','date-new','date-old','age-old','age-new']).default('account'),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(Object.fromEntries(params));
 const source=await directoryRecords(),term=query.search.toLowerCase();
 const scoped=source.items.filter(r=>!query.sheet||r.sheet===query.sheet);
 const columns=new Map<string,string>();
 for(const row of scoped)for(const field of row.fields)columns.set(field.key,field.label);
 const filtered=scoped.filter(r=>(!query.agent||r.agent===query.agent)&&(!query.branch||r.branch===query.branch)&&(!term||[r.account,r.agent,r.branch,r.serial,r.remarks,r.plan].join(' ').toLowerCase().includes(term)));
 const counts=(Object.keys(statusStyles) as RegisterEntry['statusKey'][]).map(key=>({key,count:filtered.filter(r=>r.statusKey===key).length}));
 const matches=filtered.filter(r=>!query.status||r.statusKey===query.status||r.status===query.status);
 matches.sort((a,b)=>{
  if(query.sort==='account')return a.account.localeCompare(b.account)||a.id.localeCompare(b.id);
  const av=query.sort.startsWith('age')?(a.age??null):(a.dateISO?Date.parse(a.dateISO):null),bv=query.sort.startsWith('age')?(b.age??null):(b.dateISO?Date.parse(b.dateISO):null);
  if(av===null||bv===null)return av===bv?a.id.localeCompare(b.id):av===null?1:-1;
  const descending=query.sort==='date-new'||query.sort==='age-old';return (av-bv)*(descending?-1:1)||a.id.localeCompare(b.id);
 });
 const total=matches.length,pages=Math.max(1,Math.ceil(total/25)),page=Math.min(query.page,pages);
 return {items:matches.slice((page-1)*25,page*25),total,pages,page,sheets:source.sheets,agents:[...new Set(scoped.map(r=>r.agent).filter(Boolean))].sort(),branches:[...new Set(scoped.map(r=>r.branch).filter(Boolean))].sort(),counts,columns:[...columns].map(([key,label])=>({key,label})),asOf:manilaToday()};
}
export async function historicalDetail(id:string){
 const row=await db.get('SELECT * FROM historical_accounts WHERE id=?',id) as Row|undefined;
 if(!row)throw new AppError('Historical record not found.',404);
 return {...projectHistorical(row),data:JSON.parse(row.data) as HistoricalData,related:(await db.all('SELECT * FROM historical_accounts WHERE account_key=? ORDER BY sheet,source_row',row.account_key) as Row[]).map(r=>({id:r.id,account:r.account,agent:r.agent,sheet:r.sheet,source_row:r.source_row,statusKey:projectHistorical(r).statusKey}))};
}
export async function historicalMatches(record:InquiryRecord){
 const keys=clientIdentityKeys(record).filter(([kind])=>kind==='company').map(([,value])=>value);if(!keys.length)return [];
 const rows=await db.all('SELECT * FROM historical_accounts WHERE account_key IN ('+keys.map(()=>'?').join(',')+') ORDER BY sheet,source_row',...keys) as Row[];
 const identity=historicalIdentity(record);
  const result=[];
 for(const row of rows){const review=await db.get('SELECT identity,outcome,actor,at,reason FROM historical_reviews WHERE inquiry_id=? AND historical_id=? ORDER BY rowid DESC LIMIT 1',record.id,row.id) as {identity:string;outcome:string;actor:string;at:string;reason:string}|undefined;result.push({id:row.id,account:row.account,agent:row.agent,sheet:row.sheet,source_row:row.source_row,status:row.status,branch:row.branch,review:review?{...review,stale:review.identity!==identity}:null});}
 return result;
}
export async function historicalAgentChangeBlocked(record:InquiryRecord){return (await historicalMatches(record)).some(match=>['request-agent-change','reject-agent-change'].includes(String(match.review?.outcome))||match.review?.outcome==='approve-agent-change'&&match.review.stale);}
export async function withHistoricalHold(record:InquiryRecord){return {...record,historicalAgentChangeBlocked:await historicalAgentChangeBlocked(record)};}
export async function reviewHistorical(id:string,user:Staff,input:unknown){
 const body=z.object({revision:z.number().int(),historicalId:z.string(),action:z.enum(['distinct','same','verify','request-agent-change','approve-agent-change','reject-agent-change']),reason:z.string().trim().min(10).max(3000)}).strict().parse(input);
 return await transaction(async()=>{const record=await inquiry(id);if(record.revision!==body.revision)throw new AppError('Reload the inquiry before reviewing this match.',409);
 if(record.closure)throw new AppError('Archived requests are view only.',409);
 const match=(await historicalMatches(record)).find(row=>row.id===body.historicalId);if(!match)throw new AppError('The matching details changed. Reload.',409);
 const owner=await db.get('SELECT user_id FROM inquiry_activity WHERE inquiry_id=? AND seen_at>? AND user_id<>?',id,new Date(Date.now()-90000).toISOString(),user.id);if(owner)throw new AppError('A colleague is handling this inquiry.',423);
 if(body.action==='same'&&normalizeClient(match.agent)!==normalizeClient(record.fields.agentName))throw new AppError('For the same client with a different agent, request supervisor approval instead.',409);
 if(body.action==='approve-agent-change'||body.action==='reject-agent-change'){
  if(user.role!=='Supervisor'||!user.canApprove)throw new AppError('Only an approving supervisor can decide agent changes.',403);
  if(body.action==='approve-agent-change'&&match.review?.stale)throw new AppError('The client or incoming agent changed. Request a fresh review before approving.',409);
  if(match.review?.outcome!=='request-agent-change')throw new AppError('No pending agent-change request remains.',409);
 }
 if(match.review?.outcome==='request-agent-change'&&!(match.review.stale&&body.action==='request-agent-change')&&!['approve-agent-change','reject-agent-change'].includes(body.action))throw new AppError('A supervisor must decide the pending agent change.',409);
 await db.run('INSERT INTO historical_reviews VALUES (?,?,?,?,?,?,?,?)',randomUUID(),id,body.historicalId,historicalIdentity(record),body.action,user.id,new Date().toISOString(),body.reason);
 if(body.action==='request-agent-change')await db.run('DELETE FROM inquiry_activity WHERE inquiry_id=?',id);
 audit(record,user,'Historical client review ('+body.action+') '+match.sheet+' row '+match.source_row+': '+body.reason);await persist(record,body.revision);
 if(body.action==='request-agent-change')await notify(record,'Historical agent change awaiting approval',record.fields.company+' · review the historical record',(await allUsers()).filter(p=>p.active&&p.role==='Supervisor'&&p.canApprove).map(p=>p.id));
 return record;});
}
