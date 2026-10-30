import { isSampleForm } from './types';
import type { ClientProtection, ClientReview, ClientState, DuplicateClientMatch, FormFields, InquiryRecord } from './types';

export const CLIENT_PROTECTION_DAYS=30;
export const CLIENT_PROTECTION_MS=CLIENT_PROTECTION_DAYS*24*60*60*1000;
const blank=/^(?:na|none|unknown|notprovided|notsupplied|unconfirmed)$/;
export function normalizeClient(value:string=''){
  const result=value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  return blank.test(result.replaceAll(' ',''))?'':result;
}
function person(value:string=''){return normalizeClient(value).replace(/^(?:(?:dr|doctor|engr|engineer|atty|attorney|prof|professor|mr|mrs|ms|miss|hon)\s+)+/,'');}
function company(value:string=''){return normalizeClient(value).replace(/\bcorp\b/g,'corporation').replace(/\binc\b/g,'incorporated').replace(/\bco\b/g,'company');}
function companyKeys(record:Pick<InquiryRecord,'fields'|'source'>){return [...new Set([company(record.fields.company),company(record.source.fields.company)].filter(Boolean))].sort();}
function personKeys(record:Pick<InquiryRecord,'fields'|'source'>){return [...new Set([person(record.fields.contactName),person(record.fields.addressee),person(record.source.fields.contactName),person(record.source.fields.addressee)].filter(Boolean))].sort();}
export function clientIdentity(record:Pick<InquiryRecord,'fields'|'source'>){return JSON.stringify({companies:companyKeys(record),people:personKeys(record),file:record.source.sourceHash||''});}
export function clientIdentityKeys(record:Pick<InquiryRecord,'fields'|'source'>):[string,string][]{
  return [...companyKeys(record).map(value=>['company',value] as [string,string]),...personKeys(record).map(value=>['person',value] as [string,string]),...(record.source.sourceHash?[['file',record.source.sourceHash] as [string,string]]:[])];
}
// The protected agent is the one on the original submitted form; working fields are only a fallback (e.g. PDF intake).
export function protectedAgent(record:Pick<InquiryRecord,'source'>,fields:FormFields){const src=record.source.fields;return {agentName:src.agentName?.trim()||fields.agentName||'Agent',agentEmail:src.agentEmail?.trim()||fields.agentEmail||'',agentPhone:src.agentPhone?.trim()||fields.agentPhone||''};}
export function protectionFor(record:InquiryRecord):ClientProtection|null {
  if(record.protection)return record.protection;
  const contacts=[...record.detailRequests.map(item=>({at:item.at,fields:record.fields,kind:'details' as const})),...record.submissions.filter(item=>item.delivery).map(item=>({at:item.delivery!.at,fields:item.fields,kind:'proposal' as const}))].filter(item=>Number.isFinite(Date.parse(item.at))).sort((a,b)=>a.at.localeCompare(b.at));
  const first=contacts[0];
  return first?{startedAt:first.at,activityAt:first.at,expiresAt:new Date(Date.parse(first.at)+CLIENT_PROTECTION_MS).toISOString(),...protectedAgent(record,first.fields),activityKind:first.kind}:null;
}
export function isClientArchived(record:InquiryRecord,now=Date.now()){const protection=protectionFor(record);return !!record.closure||!!protection&&Date.parse(protection.expiresAt)<=now;}
export function protectionDaysLeft(protection:ClientProtection,now=Date.now()){return Math.max(0,Math.ceil((Date.parse(protection.expiresAt)-now)/86400000));}
export function sameAgent(a:FormFields,b:FormFields){
  if(a.agentEmail?.trim()&&b.agentEmail?.trim())return a.agentEmail.trim().toLowerCase()===b.agentEmail.trim().toLowerCase();
  const phone=(value:string='')=>value.replace(/\D/g,'').replace(/^(?:0063|63|0)/,'');
  return !!phone(a.agentPhone)&&phone(a.agentPhone)===phone(b.agentPhone)&&!!person(a.agentName)&&person(a.agentName)===person(b.agentName);
}
function precedes(a:InquiryRecord,b:InquiryRecord){return a.createdAt<b.createdAt||(a.createdAt===b.createdAt&&a.id<b.id);}
export function duplicateClients(record:InquiryRecord,records:InquiryRecord[],now=Date.now()):DuplicateClientMatch[]{
  if(isSampleForm(record.source))return [];
  const identity=clientIdentity(record),exceptions=record.clientReview?.identity===identity?record.clientReview.exceptions||[]:[];
  const ownCompanies=companyKeys(record),people=personKeys(record);
  return records.filter(other=>{
    if(other.id===record.id||isSampleForm(other.source))return false;
    // A completed handover must not block later transfers to new agents. Keep
    // an expired former agent's registration as evidence for their own repeats.
    // A declined request whose protection is still active keeps its claim; only expiry releases it.
    if(other.closure){const oldProtection=protectionFor(other);if(other.closure.kind==='declined'&&oldProtection&&Date.parse(oldProtection.expiresAt)>now){/* still protected: remains a blocker */}else if(other.closure.kind!=='transferred'||!oldProtection||Date.parse(oldProtection.expiresAt)>now||!sameAgent(record.source.fields,other.source.fields))return false;}
    if(other.clientReview?.state==='duplicate'&&!isRegistered(other))return false;
    if(other.clientReview?.state==='identify'&&record.source.sourceHash!==other.source.sourceHash&&!protectionFor(other))return false;
    // New registrations reserve a client atomically. For legacy rows without a
    // check, the oldest inquiry wins instead of two rows blocking each other.
    if(!precedes(other,record))return false;
    if(exceptions.some(item=>item.inquiryId===other.id&&item.identity===clientIdentity(other)))return false;
    // A supervisor's different-client decision applies to both sides, while
    // remaining invalid if either client's identifying details later change.
    return !(other.clientReview?.identity===clientIdentity(other)&&other.clientReview.exceptions?.some(item=>item.inquiryId===record.id&&item.identity===identity));
  }).sort((a,b)=>Number(!!protectionFor(b))-Number(!!protectionFor(a))||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).flatMap(other=>{
    const reasons:string[]=[];
    if(ownCompanies.some(value=>companyKeys(other).includes(value)))reasons.push('Same account / company');
    if(people.some(name=>personKeys(other).includes(name)))reasons.push('Same client / addressee name');
    if(record.source.sourceHash&&record.source.sourceHash===other.source.sourceHash)reasons.push('Same submitted file');
    const otherProtection=protectionFor(other),expired=otherProtection?Date.parse(otherProtection.expiresAt)<=now:isClientArchived(other,now),agentMatches=sameAgent(record.source.fields,other.source.fields),expiredSameAgent=expired&&agentMatches;
    if(reasons.length&&expired)reasons.push(expiredSameAgent?'Same agent’s previous registration expired':'Expired registration — supervisor approval required');
    return reasons.length?[{expired,expiredSameAgent,inquiryId:other.id,company:other.fields.company||'Client details pending',agentName:protectionFor(other)?.agentName||other.fields.agentName||'Agent',sameAgent:agentMatches,reasons}]:[];
  });
}
export function reviewClient(record:InquiryRecord,records:InquiryRecord[],now=Date.now()):ClientReview {
  const identity=clientIdentity(record),previous=record.clientReview?.identity===identity?record.clientReview:undefined;
  const matches=duplicateClients(record,records,now);
  return {...previous,identity,matches,state:matches.length?'duplicate':!normalizeClient(record.fields.company)&&!person(record.fields.contactName)&&!person(record.fields.addressee)?'identify':'clear'};
}
// Completed work: an outbound reply started protection, or a supervisor approved a submission
// (Approved — sending / email failed / Sent). Such a record has already claimed its client.
export function isRegistered(record:InquiryRecord):boolean{return protectionFor(record)!=null||record.submissions.some(item=>item.decision?.action==='approve');}
export function clientState(record:InquiryRecord,records:InquiryRecord[],now=Date.now()):ClientState {
  const protection=protectionFor(record);
  if(isClientArchived(record,now))return {state:'archived',matches:record.clientReview?.matches||[],protection};
  // A registered record is never held; any remaining matches are informational overlaps only.
  if(isRegistered(record)){const overlaps=reviewClient(record,records,now).matches;return {state:'clear',matches:[],protection,...(overlaps.length?{overlaps}:{})};}
  const fresh=reviewClient(record,records,now);
  // A flagged import remains held until an explicit recheck/review; expiry
  // must not silently activate previously rejected agents' submissions.
  const retained=record.clientReview?.matches.filter(match=>{const other=records.find(item=>item.id===match.inquiryId);return !other||precedes(other,record);})||[];
  if(record.clientReview?.state==='duplicate'&&record.clientReview.identity===clientIdentity(record)&&retained.length)return {state:'duplicate',matches:fresh.matches.length?fresh.matches:retained,protection};
  return {state:fresh.state,matches:fresh.matches,protection};
}
export function clientStates(records:InquiryRecord[],now=Date.now()){
  const index=new Map<string,InquiryRecord[]>();
  for(const record of records)if(!isSampleForm(record.source))for(const key of clientIdentityKeys(record)){
    const encoded=JSON.stringify(key),matches=index.get(encoded)||[];matches.push(record);index.set(encoded,matches);
  }
  return Object.fromEntries(records.map(record=>{
    const candidates=new Map<string,InquiryRecord>();
    for(const key of clientIdentityKeys(record))for(const match of index.get(JSON.stringify(key))||[])candidates.set(match.id,match);
    return [record.id,clientState(record,[...candidates.values()],now)];
  }));
}
