import {historicalMatchCounts,withHistoricalHold} from './historical';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { allUsers, AppError, catalog, db, inquiry } from './database';
import { activeInquiryActivity } from './activity';
import { clientStates, protectionDaysLeft } from './client-rules';
import { synchronizeInquiryIndex, matchingInquiries } from './inquiry-index';
import { clientState } from './client-rules';
import { packageRenderers } from './package-rendering';
import { conversionName } from './document-renderer';
import { mailStatus } from './mail-config';
import { recoverStuckMail } from './service';
import { nextWorkAction, unfinishedWork } from './work-progress';
import type { InquiryRecord, InquirySummary, Notice, PageInfo, Staff, WorkspaceUpdate } from './types';

const epoch = randomUUID();
const day = (value: string | number) => new Date(value).toLocaleDateString('en-CA', {timeZone: 'Asia/Manila'});
const querySchema = z.object({
  view: z.string().max(60).default('Dashboard'), search: z.string().max(200).default(''),
  filter: z.string().max(60).default('All statuses'), division: z.string().max(200).default('All divisions'),
  sort: z.enum(['newest','oldest','updated','account']).default('newest'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  noticePage: z.coerce.number().int().min(1).max(1000000).default(1),
  selected: z.string().max(100).default(''), knownRevision: z.coerce.number().int().min(0).optional(),
  cursor: z.string().max(1000).optional(), metadataVersion: z.string().max(100).optional(),
});
const preparing = ['Preparing proposal', 'Needs correction', 'Waiting for agent details'];
const reviewing = ['Awaiting approval', 'Supervisor editing'];
const versions = () => Object.fromEntries((db().prepare('SELECT scope,version FROM workspace_versions').all() as {scope:string;version:number}[]).map(row => [row.scope,row.version]));
let cache: {version:number; until:number; today:string; summaries:InquirySummary[]; states:ReturnType<typeof clientStates>} | undefined;

function collection(version: number, now: number) {
  if (cache?.version === version && now < cache.until && cache.today === day(now)) return cache;
  synchronizeInquiryIndex();
  const rows = db().prepare('SELECT data,summary FROM inquiry_summaries').all() as {data:string;summary:string}[];
  const records: InquiryRecord[] = rows.map(row => JSON.parse(row.data));
  const historicalCounts=historicalMatchCounts();
  const summaries: InquirySummary[] = rows.map(row => {const summary=JSON.parse(row.summary);return {...summary,historicalMatchCount:historicalCounts.get(summary.id)||0};});
  summaries.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const states = clientStates(records, now);
  let until = Infinity;
  for (const state of Object.values(states)) if (state.protection) {
    for (const deadline of [Date.parse(state.protection.expiresAt), Date.parse(state.protection.expiresAt) - 7 * 86400000]) {
      if (deadline > now) until = Math.min(until, deadline);
    }
  }
  cache = {version, until, today:day(now), summaries, states};
  return cache;
}

function paginate<T>(items:T[], requested:number, pageSize=25): {items:T[]; pagination:PageInfo} {
  const pages = Math.max(1, Math.ceil(items.length / pageSize)), page = Math.min(requested, pages);
  return {items:items.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:items.length,pages}};
}

export function inquiryDetails(id:string) {
  const record = withHistoricalHold(inquiry(id));
  return {inquiry:record, clientState:clientState(record,matchingInquiries(record)), packageRenderers:packageRenderers([record])};
}

export function workspaceView(user: Staff, params: URLSearchParams): WorkspaceUpdate | {unchanged:true;cursor:string} {
  const query = querySchema.parse(Object.fromEntries(params));
  const emptyPage = {page:1,pageSize:25,total:0,pages:1};
  const mail = mailStatus();
  if (user.mustChangePassword) return {
    mail, user, users:[user], templates:[], integrations:{database:'',gmail:'',ai:'',documents:''},
    inquiries:[],clientStates:{},packageRenderers:{},activity:[],notifications:[],
    cursor:'activate:'+user.id, metadataVersion:'activate', pagination:emptyPage,noticePagination:emptyPage,
    unreadCount:0,pendingCount:0,divisions:[],stats:{},attention:[],attentionCount:0,resume:[],
  };
  recoverStuckMail();
  const now = Date.now(), revision = versions(), data = collection(revision.inquiries, now);
  const activity = activeInquiryActivity();
  const metadataVersion = epoch + ':' + revision.metadata;
  // Lease heartbeat timestamps do not invalidate document/list payloads, while
  // ownership changes and expiry do. Time boundaries also invalidate idle views.
  const cursor = createHash('sha256').update(JSON.stringify([epoch,user.id,revision,query.view,query.search,query.filter,query.division,query.sort,query.page,query.noticePage,query.selected,data.until,data.today,activity.map(a=>[a.inquiryId,a.userId,a.startedAt])])).digest('hex');
  if (query.cursor === cursor && query.metadataVersion === metadataVersion) return {unchanged:true,cursor};
  const users = allUsers(), names = new Map(users.map(person=>[person.id,person.name]));
  const active = data.summaries.filter(record=>data.states[record.id].state!=='archived');
  const pending = active.filter(record=>reviewing.includes(record.status)&&data.states[record.id].state==='clear');
  let records = query.view==='Archives' ? data.summaries.filter(record=>data.states[record.id].state==='archived')
    : query.view==='History' ? active.filter(record=>record.status==='Sent')
    : query.view==='Returned Proposals' ? active.filter(record=>record.status==='Needs correction')
    : query.view==='Approval Queue' ? (user.canApprove?pending.slice().sort((a,b)=>(a.submittedAt||a.createdAt).localeCompare(b.submittedAt||b.createdAt)||a.id.localeCompare(b.id)):[])
    : query.view==='My Inquiries' ? active.filter(record=>record.handledBy.includes(user.id)||activity.some(a=>a.inquiryId===record.id&&a.userId===user.id)) : active;
  const search = query.search.trim().toLowerCase();
  records = records.filter(record=>{
    const state = data.states[record.id];
    return (query.filter==='All statuses'||query.view==='Archives'&&query.filter==='Expired'&&!['Declined','Transferred'].includes(record.status)&&!!state.protection&&Date.parse(state.protection.expiresAt)<=now||query.filter==='To prepare'&&preparing.includes(record.status)&&state.state==='clear'||query.filter==='Sent today'&&record.status==='Sent'&&day(record.deliveredAt||record.updatedAt)===data.today||query.filter==='Duplicate client'&&state.state==='duplicate'||query.filter==='Expiring protection'&&!!state.protection&&protectionDaysLeft(state.protection,now)<=7||record.status===query.filter)
      && (query.division==='All divisions'||(record.fields.division||'Unconfirmed')===query.division)
      && (!search || [record.id,record.fields.company,record.fields.contactName,record.fields.addressee,record.fields.agentName,...record.handledBy.map(id=>names.get(id)||id)].join(' ').toLowerCase().includes(search));
  });
  // Optional list sort. The Approval Queue keeps its oldest-submitted order unless another sort is chosen.
  if (query.sort!=='newest' && query.view!=='Approval Queue' || query.view==='Approval Queue' && ['updated','account'].includes(query.sort)) {
    const by:Record<string,(a:InquirySummary,b:InquirySummary)=>number>={oldest:(a,b)=>a.createdAt.localeCompare(b.createdAt),updated:(a,b)=>b.updatedAt.localeCompare(a.updatedAt),account:(a,b)=>(a.fields.company||'').localeCompare(b.fields.company||'',undefined,{sensitivity:'base'})};
    records = records.slice().sort((a,b)=>by[query.sort](a,b)||a.id.localeCompare(b.id));
  }
  const listViews = ['My Inquiries','Inquiries','History','Archives','Approval Queue','Returned Proposals'];
  // Tab counts for the list pages (whole view, before search/division filters).
  const mine = active.filter(record=>record.handledBy.includes(user.id)||activity.some(a=>a.inquiryId===record.id&&a.userId===user.id));
  const tabCounts = listViews.includes(query.view) ? {
    mine:mine.length, all:active.length,
    toPrepare:active.filter(record=>preparing.includes(record.status)&&data.states[record.id].state==='clear').length,
    awaiting:active.filter(record=>record.status==='Awaiting approval').length,
    onHold:active.filter(record=>data.states[record.id].state==='duplicate').length,
    sent:active.filter(record=>record.status==='Sent').length,
    archived:data.summaries.length-active.length,
    waiting:user.canApprove?pending.length:0,
    returned:active.filter(record=>record.status==='Needs correction').length,
  } : undefined;
  const listing = paginate(listViews.includes(query.view)?records:[],query.page);
  const urgency:Record<string,number>={'Needs correction':0,'Approved — email failed':1,'New inquiry':2};
  const needsAttention = active.filter(record=>record.status!=='Sent'&&(record.status!=='Awaiting approval'||user.canApprove));
  const attention = query.view==='Dashboard'?needsAttention.slice().sort((a,b)=>(urgency[a.status]??3)-(urgency[b.status]??3)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,7):[];
  const resume = query.view==='Dashboard'?active.filter(record=>['New inquiry',...preparing].includes(record.status)&&(record.workProgress?.[user.id]||record.handledBy.includes(user.id))&&data.states[record.id].state==='clear').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).slice(0,4).map(record=>({...record})):[];
  const templates = catalog();
  for (const record of resume) {
    const full = inquiry(record.id);
    // A fresh object avoids changing cached list summaries for another session.
    record.nextAction = unfinishedWork(full,user.id)?nextWorkAction(full,templates.find(t=>t.id===full.templateId)):'Open inquiry';
  }
  const noticeCounts = db().prepare('SELECT COUNT(*) AS total,COALESCE(SUM(1-is_read),0) AS unread FROM notice_recipients WHERE user_id=?').get(user.id) as {total:number;unread:number};
  const noticePages = Math.max(1,Math.ceil(noticeCounts.total/25)), noticePage = Math.min(query.noticePage,noticePages);
  const notifications = query.view==='Notifications'?(db().prepare('SELECT n.data FROM notice_recipients r JOIN notifications n ON n.id=r.notice_id WHERE r.user_id=? ORDER BY r.at DESC,r.notice_id DESC LIMIT 25 OFFSET ?').all(user.id,(noticePage-1)*25) as {data:string}[]).map(row=>JSON.parse(row.data) as Notice):[];
  const visibleIds = new Set([...listing.items,...attention,...resume].map(record=>record.id));
  const selected = ['Inquiry Workspace','Supervisor Review'].includes(query.view)?query.selected:'';
  let current:InquiryRecord|undefined, renderers = {};
  if (selected) {
    const row = db().prepare('SELECT revision FROM inquiries WHERE id=?').get(selected) as {revision:number}|undefined;
    if (!row) throw new AppError('Inquiry not found',404);
    visibleIds.add(selected);
    if (row.revision!==query.knownRevision) {
      current=withHistoricalHold(inquiry(selected));
      renderers=packageRenderers([current]);
    }
  }
  return {
    mail, user, ...(query.metadataVersion===metadataVersion?{}:{users,templates:templates.map(template=>({...template,file:''})),integrations:{database:'SQLite · shared server storage',gmail:mail.mode==='local'?'Local test mailbox · no real Gmail sends':mail.label,ai:'Simulated · supplied proposal sources only',documents:conversionName()}}),
    cursor, metadataVersion, inquiries:listing.items, pagination:listing.pagination,
    ...(current?{current}:{}), packageRenderers:renderers,
    clientStates:Object.fromEntries([...visibleIds].filter(id=>data.states[id]).map(id=>[id,data.states[id]])),
    activity, notifications, noticePagination:{page:noticePage,pageSize:25,total:noticeCounts.total,pages:noticePages},
    unreadCount:noticeCounts.unread, pendingCount:pending.length,
    divisions:[...new Set(data.summaries.map(record=>record.fields.division||'Unconfirmed'))].sort(),
    stats:{'New inquiry':active.filter(record=>record.status==='New inquiry').length,'To prepare':active.filter(record=>preparing.includes(record.status)&&data.states[record.id].state==='clear').length,'Awaiting approval':active.filter(record=>record.status==='Awaiting approval').length,'Sent':active.filter(record=>record.status==='Sent'&&day(record.deliveredAt||record.updatedAt)===data.today).length},
    attention, attentionCount:needsAttention.length, resume, ...(tabCounts?{tabCounts}:{}),
  };
}
