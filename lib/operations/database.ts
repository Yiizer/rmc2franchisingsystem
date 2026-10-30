import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import type { CatalogTemplate, InquiryRecord, Notice, Staff } from './types';
import { defaultEmail } from './types';
import { installWorkspaceIndexes } from './workspace-schema';
import { dataRoot, resourceFile, demoSeedAllowed } from './paths';

export { dataRoot };

export const LOCAL_PASSWORD='Rmc2Local!2026';
type DatabaseGlobal = typeof globalThis & { rmc2Database?: DatabaseSync };
export function db() {
  const shared=globalThis as DatabaseGlobal;
  if(shared.rmc2Database) return shared.rmc2Database;
  mkdirSync(dataRoot,{recursive:true});
  const database=new DatabaseSync(path.join(dataRoot,'rmc2.sqlite'));
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS security_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, actor_id TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS template_overrides (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiries (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiry_activity (session TEXT NOT NULL, tab TEXT NOT NULL, inquiry_id TEXT NOT NULL, user_id TEXT NOT NULL, started_at TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(session,tab));
    CREATE TABLE IF NOT EXISTS file_access (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, inquiry_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(inquiry_id,version,kind));`);
  shared.rmc2Database=database;
  if(!(database.prepare('SELECT id FROM users LIMIT 1').get())) { if(demoSeedAllowed())seed(database); else console.warn('[rmc2] Empty database and demo seed disabled: nobody can sign in. Set RMC2_SEED_DEMO=1 for test data.'); }
  installWorkspaceIndexes(database);
  return database;
}
export function passwordHash(password: string) { const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex'); }
export function passwordMatches(password: string, stored: string) { const [salt,hash]=stored.split(':');const actual=scryptSync(password,salt,64),expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected); }
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function allUsers():Staff[] { return (db().prepare('SELECT data FROM users').all() as {data:string}[]).map(r=>JSON.parse(r.data)); }
export function inquiries():InquiryRecord[] { return (db().prepare('SELECT data FROM inquiries').all() as {data:string}[]).map(r=>JSON.parse(r.data)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
export function inquiry(id:string):InquiryRecord { const row=db().prepare('SELECT data FROM inquiries WHERE id=?').get(id) as {data:string}|undefined;if(!row)throw new AppError('Inquiry not found',404);return JSON.parse(row.data); }
export function persist(record:InquiryRecord, expected?:number) {
  if(expected===undefined)db().prepare('INSERT INTO inquiries (id,revision,data) VALUES (?,?,?)').run(record.id,record.revision,JSON.stringify(record));
  else { const result=db().prepare('UPDATE inquiries SET revision=?,data=? WHERE id=? AND revision=?').run(record.revision,JSON.stringify(record),record.id,expected);if(!result.changes)throw new AppError('Another colleague updated this inquiry. Reload to review their changes before saving.',409); }
}
export function transaction<T>(run:()=>T):T { const database=db();database.exec('BEGIN IMMEDIATE');try{const result=run();database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;} }
export function audit(record:InquiryRecord, staff:Staff, action:string, changes?:{field:string;before:string;after:string}[]) { const at=new Date().toISOString();record.updatedAt=at;record.revision++;record.handledBy=[...new Set([...record.handledBy,staff.id])];record.history.push({id:randomUUID(),at,actorId:staff.id,actor:staff.name,action,changes}); }
export function notify(record:InquiryRecord,title:string,message:string,recipientIds:string[]) { const notice:Notice={id:randomUUID(),inquiryId:record.id,title,message,at:new Date().toISOString(),recipientIds:[...new Set(recipientIds)],readBy:[]};db().prepare('INSERT INTO notifications(id,data) VALUES (?,?)').run(notice.id,JSON.stringify(notice)); }
export function catalog():CatalogTemplate[] { const file=resourceFile('catalog.json');const base:CatalogTemplate[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
  const overrides=(db().prepare('SELECT data FROM template_overrides').all() as {data:string}[]).map(row=>JSON.parse(row.data) as CatalogTemplate);
  const merged=new Map(base.map(template=>[template.id,{...template,active:['D091','D092','D093'].includes(template.sourceId)?false:template.active}]));
  for(const template of overrides)merged.set(template.id,template);
  return [...merged.values()]; }
export function sourceFile(template:CatalogTemplate) { return template.storage?safeStorage(template.storage):resourceFile(path.basename(template.file)); }
export function safeStorage(relative:string) { const full=path.resolve(dataRoot,relative);if(!full.startsWith(dataRoot+path.sep))throw new AppError('Invalid stored file path',400);return full; }
export class AppError extends Error { constructor(message:string,public status=400){super(message);} }

function seed(database:DatabaseSync) {
  const people:Staff[]=[
    {id:'cryssa',name:'Cryssa Kate Aban',email:'cryssa@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 4–5',active:true,canApprove:false},
    {id:'jefferson',name:'Jefferson Silot',email:'jefferson@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 1–3',active:true,canApprove:false},
    {id:'judy',name:'Judy Villaruel',email:'judy@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 4–5',active:true,canApprove:false},
    {id:'emerson',name:'Emerson Dolf Fernandez',email:'emerson@rmc2.local',role:'Supervisor',position:'VP of Franchising and Underwriting',active:true,canApprove:true},
    {id:'zeo',name:'Zeo Enorasa',email:'zeo@rmc2.local',role:'Supervisor',position:'AfterSales Operations and Client Relations Supervisor',active:true,canApprove:true},
    {id:'admin',name:'System Administrator',email:'admin@rmc2.local',role:'Admin',position:'System Administrator',active:true,canApprove:false},
  ];
  for(const person of people)database.prepare('INSERT INTO users VALUES (?,?,?)').run(person.id,JSON.stringify(person),passwordHash(LOCAL_PASSWORD));
  const companies=['Sampaguita National High School','Harbor Logistics Corporation','Evergreen Services, Inc.','Meridian Packaging Co.'];
  companies.forEach((company,index)=>{
    const at=new Date(Date.now()-(index*6+1)*3600000).toISOString();
    const fields={company,sector:index===0?'DepEd':'Private',industry:index===0?'Education':'Services',address:'Antipolo City, Rizal',division:'Division '+(index+1),branch:'Antipolo',requestDate:new Date().toISOString().slice(0,10),agentName:'Andrea Mendoza',agentEmail:'agent'+(index+1)+'@example.com',agentPhone:'09171234567',contactName:'Ariana Santos',contactEmail:'contact'+(index+1)+'@example.com',contactPhone:'09981234567',contactPosition:'HR Manager',addressee:'Ariana Santos',addresseePosition:'HR Manager',requestedPlan:index===0?'DepEd plan':'Group healthcare',existingProvider:'None',payment:'Annual',employees:index===0?'10':'65',dependents:'0',employeeAges:index===2?'':'22–58',dependentAges:'',hospitals:'',dental:''};
    const record:InquiryRecord={id:'INQ-2026-'+String(129-index).padStart(5,'0'),revision:1,status:'New inquiry',createdAt:at,updatedAt:at,fields,source:{filename:'Sample franchise form.xlsx',storage:'',sheet:'Sheet1',cells:[],fields:{...fields},receivedAt:at},email:defaultEmail(fields),emailOverrides:[],templateId:'',submissions:[],handledBy:[],history:[{id:randomUUID(),at,actorId:'intake',actor:'Local intake',action:'Agent inquiry received. All active franchising staff notified.'}],chat:[],notes:'',returnNote:'',returnFlags:[],detailRequests:[]};
    database.prepare('INSERT INTO inquiries VALUES (?,?,?)').run(record.id,1,JSON.stringify(record));
    notify(record,'New inquiry',`${company} is ready for its first form review.`,people.filter(p=>p.active).map(p=>p.id));
  });
}
