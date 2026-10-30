export type SourceCell = {column:string;label:string;value:string;fill:string;fillType:string;color?:string;format?:string;formula?:string;role?:string};
export type HistoricalData = {source:string;plan:string;statusText:string;remarks:string;dates:{label:string;value:string}[];cells:SourceCell[];headers?:{column:string;label:string}[]};
export type HistoricalRow = {id:string;account:string;agent:string;branch:string;status:string;sheet:string;source_row:number;data:string};
export const statusStyles = {
 closed:{label:'Closed deal',tone:'purple',icon:'check'}, expired:{label:'Expired',tone:'red',icon:'clock'},
 disapproved:{label:'Disapproved',tone:'red',icon:'cross'}, hold:{label:'On hold',tone:'amber',icon:'pause'},
 pending:{label:'Pending',tone:'amber',icon:'clock'}, processing:{label:'Processing',tone:'blue',icon:'clock'},
 waiting:{label:'Waiting for presentation',tone:'teal',icon:'clock'}, sent:{label:'Sent / Done',tone:'green',icon:'check'},
 todo:{label:'To do',tone:'gray',icon:'clock'}, unknown:{label:'Not recorded',tone:'gray',icon:'minus'},
 review:{label:'Needs review',tone:'amber',icon:'alert'},
} as const;
export type StatusKey = keyof typeof statusStyles;
export type RegisterField = {key:string;label:string;value:string;display:string;section:string;column:string};
export type RegisterEntry = Omit<HistoricalRow,'data'> & {plan:string;remarks:string;serial:string;recordedDate:string;recordedLabel:string;dateISO:string;dateIssue:string;savedAge:string;age:number|null;statusKey:StatusKey;statusEvidence:string;fields:RegisterField[]};
const clean=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const people='Account and people',documents='Documents and requirements',payments='Payments and enrollment',dates='Dates and delivery';
const mappings:Record<string,[string,string,string]>={
 serial:['serial','Serial number',people],preparedby:['preparedBy','Prepared by',people],plantype:['plan','Plan',people],
 agent:['agent','Agent',people],agentname:['agent','Agent',people],branch:['branch','Branch / division',people],branchdivision:['branch','Branch / division',people],areabranch:['branch','Branch / division',people],
 companysentto:['recipient','Company sent to',people],ageofaccount:['savedAge','Saved Excel age',dates],
 proposal:['proposal','Proposal',documents],soamasterlist:['soa','SOA / masterlist',documents],moa:['moa','MOA',documents],notarizedmoa:['notarized','Notarized MOA',documents],lackingrequirements:['requirements','Lacking requirements',documents],
 certificateofcoverage:['coc','Certificate of coverage',documents],serviceinvoice:['invoice','Service invoice',documents],cards:['cards','Cards',documents],
 paymenttcp:['payment','Payment & TCP',payments],totalcontractprice:['contract','Total contract price',payments],totalcon:['contract','Total contract price',payments],modeofpayment:['paymentMode','Mode of payment',payments],enrollees:['enrollees','Enrollees',payments],nop:['nop','Number of persons (NOP)',payments],
 date:['recorded','Recorded date',dates],datesent:['dateSent','Date sent',dates],dateclosed:['dateClosed','Date closed',dates],dateenrolled:['dateEnrolled','Date enrolled',dates],
 moadate:['moaDate','MOA date',dates],soadate:['soaDate','SOA date',dates],datereceivedofmoa:['moaReceived','MOA received',dates],datereceivedofsoa:['soaReceived','SOA received',dates],depositdate:['depositDate','Deposit date',dates],
 datedelivered:['delivered','Date delivered',dates],datecarddelivered:['cardsDelivered','Cards delivered',dates],datecocdelivered:['cocDelivered','COC delivered',dates],dateserviceinvoicedelivered:['invoiceDelivered','Service invoice delivered',dates],effectivity:['effectivity','Coverage effectivity',dates],expiry:['expiry','Coverage expiry',dates],
 status:['originalStatus','Original status','Status and remarks'],remarks:['remarks','Remarks','Status and remarks'],
};
export function manilaToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function parseSourceDate(value:string):string {
 const v=value.trim();let y:number,m:number,d:number;let match=v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
 if(match){[,y,m,d]=match.map(Number);}else{
  match=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // Do not guess whether an ambiguous numeric source date is month-first or day-first.
  if(match){const a=Number(match[1]),b=Number(match[2]);if(a<=12&&b<=12&&a!==b)return '';y=Number(match[3]);m=a>12?b:a;d=a>12?a:b;}
  else{match=v.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);if(!match)return '';m=['january','february','march','april','may','june','july','august','september','october','november','december'].findIndex(n=>n===match![1].toLowerCase()||n.slice(0,3)===match![1].toLowerCase())+1;d=Number(match[2]);y=Number(match[3]);}
 }
 const date=new Date(Date.UTC(y,m-1,d));return y>=1900&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):'';
}
export const displayDate=(iso:string)=>iso?`${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}`:'';
function isLegend(cell:SourceCell,sheet:string){return cell.role==='legend'||(['GENERATED MOAs','IWC'].includes(sheet)&&cell.column==='I'&&/content\s*meaning|pending.*yellow|disapproved.*red|proposal sent.*green|processing.*blue|not yet done.*(?:gray|white|clear)/i.test(cell.value));}
export function sourceColor(cell:SourceCell){return cell.color|| (cell.fillType==='rgb'&&/^[0-9a-f]{8}$/i.test(cell.fill)&&cell.fill!=='00000000'?'#'+cell.fill.slice(-6):'');}
export function classifyStatus(data:HistoricalData,sheet:string):{key:StatusKey;evidence:string}{
 const original=[data.statusText,data.remarks].filter(Boolean).join(' · ');const text=original.toLowerCase();
 const rules:[StatusKey,RegExp][]=[['closed',/\bclosed\s*deal\b/],['expired',/\bexpired\b/],['disapproved',/\b(?:denied|disapproved|declined)\b/],['hold',/\bon\s*hold\b/],['pending',/\bpending\b/],['processing',/\bprocessing\b/],['waiting',/\bwaiting\s+for\s+(?:a\s+)?presentation\b/],['sent',/^(?:sent|done|done\/sent|proposal sent(?:\s*(?:&|and)\s*done)?)\s*[.!]?$/],['todo',/\b(?:to do|not yet done)\b/]];
 const found=rules.filter(([key,re])=>(key==='sent'?[data.statusText,data.remarks].some(value=>re.test(value.toLowerCase())):re.test(text))).map(([key])=>key);
 if(found.length>1||/\b(?:not|never)\s+(?:expired|closed|disapproved|sent|done)\b/.test(text))return {key:'review',evidence:'Conflicting or qualified source text: '+original};
 if(found.length===1)return {key:found[0],evidence:'From original status / remarks: '+original};
 // A legend applies only to its own sheet and status column, never to row fills.
 const statusCell=data.cells.find(c=>clean(c.label)==='status');const color=statusCell?sourceColor(statusCell).toUpperCase():'';
 if(['GENERATED MOAs','IWC'].includes(sheet)&&!original.trim()){
  const colors:Record<string,StatusKey>={'#FFFF00':'pending','#00FF00':'sent','#00B050':'sent','#0000FF':'processing','#0070C0':'processing'};
  if(colors[color])return {key:colors[color],evidence:`From the ${sheet} status-color legend (${color}).`};
  if(color==='#FF0000')return sheet==='IWC'?{key:'disapproved',evidence:'From the IWC legend: red means Disapproved.'}:{key:'review',evidence:'The source legend combines Disapproved / Expired; the exact outcome is not recorded.'};
  if(['#D9D9D9','#FFFFFF'].includes(color))return {key:'todo',evidence:'From the source status-color legend.'};
 }
 return original.trim()||color&&!['#FFFFFF','#D9D9D9','#000000'].includes(color)?{key:'review',evidence:original?'Source wording needs review: '+original:'The status color has no verified meaning for this sheet.'}:{key:'unknown',evidence:'No explicit account status is recorded.'};
}
export function projectHistorical(row:HistoricalRow,today=manilaToday()):RegisterEntry{
 const data=JSON.parse(row.data) as HistoricalData;const fields:RegisterField[]=[];
 for(const cell of data.cells){
  if(cell.column==='A'||isLegend(cell,row.sheet)||!cell.value.trim())continue;
  const map=mappings[clean(cell.label)];const [key,label,section]=map||['source_'+cell.column,cell.label==='Unnamed column'||/^Column \d+$/.test(cell.label)?'Additional information · '+cell.column:cell.label,'Additional source information'];
  let display=cell.value;
  if(section===dates&&key!=='savedAge'){const iso=parseSourceDate(cell.value);if(iso)display=displayDate(iso);}
  if(['contract','payment'].includes(key)&&/^\s*[₱]?\s*-?[\d,]+(?:\.\d+)?\s*$/.test(cell.value))display=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(cell.value.replace(/[₱,\s]/g,'')));
  fields.push({key,label,value:cell.value,display,section,column:cell.column});
 }
 const value=(key:string)=>fields.find(f=>f.key===key)?.value||'';
 const recorded=fields.find(f=>f.key==='recorded')||fields.find(f=>f.key==='dateSent')||fields.find(f=>f.key==='dateEnrolled');
 const dateISO=parseSourceDate(recorded?.value||'');const elapsed=dateISO?Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(dateISO+'T00:00:00Z'))/86400000):null;
 const status=classifyStatus(data,row.sheet);
 const {data:omit,...base}=row;void omit;
 return {...base,plan:value('plan')||data.plan,remarks:data.remarks,serial:value('serial'),recordedDate:dateISO?displayDate(dateISO):recorded?.value||'',recordedLabel:recorded?.label||'Recorded date',dateISO,dateIssue:elapsed!==null&&elapsed<0?'Future date':recorded&&!dateISO?'Date needs review':!recorded?'Not recorded':'',age:elapsed!==null&&elapsed>=0?elapsed:null,savedAge:value('savedAge'),statusKey:status.key,statusEvidence:status.evidence,fields};
}
export type DirectoryListing={items:RegisterEntry[];total:number;page:number;pages:number;sheets:string[];agents:string[];branches:string[];counts:{key:StatusKey;count:number}[];columns:{key:string;label:string}[];asOf:string};


export const directoryGroups = {active:{label:'Active',tone:'blue'},won:{label:'Won',tone:'green'},lost:{label:'Lost',tone:'red'},notStarted:{label:'Not started',tone:'gray'},review:{label:'Needs review',tone:'amber'}} as const;
export type DirectoryGroup=keyof typeof directoryGroups;
export function statusGroup(key:StatusKey):DirectoryGroup {return ['closed','sent'].includes(key)?'won':['expired','disapproved'].includes(key)?'lost':['todo','unknown'].includes(key)?'notStarted':key==='review'?'review':'active';}
export type DirectoryEdit={id:string;historical_id:string;field:string;old_value:string;new_value:string;actor:string;at:string;reason:string};
export type DirectoryClient=RegisterEntry&{key:string;source:'live'|'historical'|'both';recordCount:number;agents:string[];group:DirectoryGroup;statusLabel:string;protectionDays:number|null;inquiryId?:string;possibleMatch?:string;historicalIds:string[]};
export type ClientListing=Omit<DirectoryListing,'items'|'counts'>&{items:DirectoryClient[];counts:{key:DirectoryGroup;count:number}[];pageSize:number};
export type ClientDetail={client:DirectoryClient;records:(RegisterEntry&{data:HistoricalData;edits:DirectoryEdit[];editAt:string})[];inquiries:{id:string;account:string;agent:string;status:string;at:string}[]};
