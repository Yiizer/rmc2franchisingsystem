import {profile,type Inquiry,type User} from './model';

export function parseTimestamp(value:string|undefined):string|undefined{
 if(!value)return;
 if(/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
 const m=value.match(/^([A-Za-z]{3}) (\d{1,2}),? (\d{1,2}):(\d{2})\s*(AM|PM)/i);
 if(!m)return;
 const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].findIndex(x=>x.toLowerCase()===m[1].toLowerCase());
 if(month<0)return;
 const hour=Number(m[3])%12+(m[5].toUpperCase()==='PM'?12:0);
 return new Date(Date.UTC(2026,month,Number(m[2]),hour-8,Number(m[4]))).toISOString();
}
export function normalizeInquiry(x:Inquiry,users:User[]):Inquiry{
 const createdAt=x.createdAt||parseTimestamp(x.received)||parseTimestamp(x.events[0]?.at);
 const events=x.events.map(e=>({...e,at:parseTimestamp(e.at)||e.at,actorId:e.actorId||users.find(u=>u.name===e.actor)?.id}));
 const handledBy=[...new Set([...(x.handledBy||[]),...events.flatMap(e=>e.actorId?[e.actorId]:[])])];
 return {...x,ownerId:null,createdAt,updatedAt:x.updatedAt||parseTimestamp(events.at(-1)?.at)||createdAt,handledBy,events};
}
export function handledNames(x:Inquiry,users:User[]):string{return (x.handledBy||[]).map(id=>users.find(u=>u.id===id)?.name||'Former staff member').join(', ')||'Not started';}
export function timestamp(value:string|undefined):string{if(!value)return 'Time not recorded';const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(d):value;}
export function elapsed(value:string|undefined,now:number):string{if(!value)return 'Time not recorded';const start=Date.parse(value);if(!Number.isFinite(start))return 'Time not recorded';const minutes=Math.max(0,Math.floor((now-start)/60000));if(minutes<1)return 'Less than a minute';if(minutes<60)return minutes+' min';const hours=Math.floor(minutes/60);if(hours<24)return hours+' hr'+(minutes%60?' '+minutes%60+' min':'');const days=Math.floor(hours/24);return days+' day'+(days===1?'':'s')+(hours%24?' '+hours%24+' hr':'');}
export function receivedAgo(x:Inquiry,now:number):string{if(!now)return '…';const age=elapsed(x.createdAt,now);return age==='Time not recorded'?age:age==='Less than a minute'?'Just received':age+' ago';}
export function inquiryAge(x:Inquiry,now:number):string{if(!now)return '…';return elapsed(x.createdAt,['Sent','Rejected'].includes(x.status)&&x.updatedAt?Date.parse(x.updatedAt):now);}
export function editDescription(x:Inquiry,c:Partial<Inquiry>):string{
 const labels:Record<string,string>={company:'account name',contact:'contact person',email:'proposal email',lives:'regular employees',effective:'start date',notes:'coordinator notes',agent:'agent name',agentPhone:'agent telephone',clientBusiness:'client business',companyBusiness:'company business',deployedManpower:'deployed manpower',branch:'branch',division:'division',sector:'client sector',address:'address',phone:'contact telephone',contactPosition:'contact position',addressee:'proposal addressee',addresseePosition:'addressee position',existingProvider:'existing provider',requestedPlan:'requested plan',payment:'payment schedule',dependents:'dependents',employeeAges:'employee age range',dependentAges:'dependent age range',hospitals:'preferred hospitals / clinics',dental:'preferred dental clinics',requestDate:'request date',availability:'account availability'};
 const changed=Object.keys(c).filter(k=>k in labels&&JSON.stringify(x[k as keyof Inquiry])!==JSON.stringify(c[k as keyof Inquiry]));
 if(c.franchise){const f=profile(x);changed.push(...Object.keys(c.franchise).filter(k=>k in labels&&f[k as keyof typeof f]!==c.franchise![k as keyof typeof f]));}
 return 'Updated '+(changed.length?changed.map(k=>labels[k]).join(', '):'inquiry details')+'.';
}
