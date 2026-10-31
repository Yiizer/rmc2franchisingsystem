// node:sqlite is a type-only import here: the value is loaded lazily inside openDatabase(), so a Postgres
// deployment never loads it and never touches the .data directory.
import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import type { CatalogTemplate, InquiryRecord, Notice, Staff } from './types';
import { defaultEmail } from './types';
import { installWorkspaceIndexes } from './workspace-schema';
import { createSqliteStore } from './store';
import { createPostgresStore } from './store-postgres';
import type { Store } from './store';
import { forUpdate } from './sql-dialect';
import { AppError } from './errors';
import { dataRoot, resourceFile, demoSeedAllowed, historicalSchemaFile } from './paths';

// AppError lives in errors.ts so storage code can throw it without opening the database; re-exported for callers.
export { dataRoot, AppError };

export const LOCAL_PASSWORD='Rmc2Local!2026';
// The only synchronous SQLite access: opens the file, creates the schema and seeds once per process.
function openDatabase() {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
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
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(inquiry_id,version,kind));
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_sends (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, outbox_id TEXT NOT NULL);`);
  if(!(database.prepare('SELECT id FROM users LIMIT 1').get())) { if(demoSeedAllowed())seedSqlite(database); else console.warn('[rmc2] Empty database and demo seed disabled: nobody can sign in. Set RMC2_SEED_DEMO=1 for test data.'); }
  installWorkspaceIndexes(database);
  // Inquiry numbers come from this counter (same statement on Postgres). Never below the highest number already issued.
  const highest=Math.max(129,...(database.prepare('SELECT id FROM inquiries').all() as {id:string}[]).map(row=>Number(row.id.split('-').at(-1))||0));
  database.prepare("INSERT INTO counters(name,n) VALUES ('inquiry',?) ON CONFLICT(name) DO UPDATE SET n=MAX(n,excluded.n)").run(highest);
  // Created here, not lazily per request: a lazy install inside a request's transaction could roll back
  // while its "installed" flag stayed set (two first-ever requests both got "no such table").
  database.exec(readFileSync(historicalSchemaFile(),'utf8'));
  return database;
}
export type DatabaseSelection = { kind: 'sqlite' } | { kind: 'postgres'; url: string };
/** RMC2_DB=sqlite|postgres (default sqlite). Postgres needs RMC2_DATABASE_URL; Vercel must use Postgres. Messages name variables only, never values. */
export function selectDatabase(env: NodeJS.ProcessEnv = process.env): DatabaseSelection {
  const kind = (env.RMC2_DB ?? '').trim().toLowerCase() || 'sqlite';
  if (kind !== 'sqlite' && kind !== 'postgres') throw new Error('RMC2_DB must be "sqlite" or "postgres".');
  // `next build` only collects page data and never queries; the guard applies to the running app.
  if (env.VERCEL && kind !== 'postgres' && env.NEXT_PHASE !== 'phase-production-build') throw new Error('RMC2_DB=postgres is required on Vercel: SQLite files do not persist there.');
  if (kind === 'sqlite') return { kind };
  const url = (env.RMC2_DATABASE_URL ?? '').trim();
  if (!url) throw new Error('RMC2_DB=postgres requires RMC2_DATABASE_URL.');
  return { kind, url };
}
function createStore(): Store {
  const selected = selectDatabase();
  return selected.kind === 'postgres' ? createPostgresStore(selected.url) : createSqliteStore(openDatabase);
}
// One store (and one mutex/pool) per process, shared by every module copy and hot reload.
type StoreGlobal = typeof globalThis & { rmc2Store?: Store; rmc2Ready?: Promise<void> };
const shared=globalThis as StoreGlobal;
export const db:Store=shared.rmc2Store??(shared.rmc2Store=createStore());
export const transaction:Store['transaction']=(run,opts)=>db.transaction(run,opts);

/** Schema version the code expects in app_meta (supabase/migrations). A different version means the migrations and the app are out of step. */
export const EXPECTED_SCHEMA_VERSION = '1';
/** Bump when inquiry-index.ts changes what inquiry_summaries / inquiry_keys hold; a mismatch with app_meta re-queues every inquiry. */
export const PROJECTION_VERSION = '1';
/** Queues every inquiry for re-projection (the next synchronizeInquiryIndex rebuilds summaries and keys). Safe to repeat. */
export async function enqueueFullReindex() {
  await db.transaction(async()=>{
    await db.lock('idx-sync');
    await db.run('INSERT INTO inquiry_index_pending(id) SELECT id FROM inquiries WHERE true ON CONFLICT DO NOTHING');
    if(db.dialect==='postgres')await db.run("INSERT INTO app_meta(key,value) VALUES ('projection_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",PROJECTION_VERSION);
  });
}
/**
 * Postgres: call before serving requests (route.ts does). Creates no tables: the schema comes from migrations.
 *  1. Fails closed when app_meta.schema_version is missing or different.
 *  2. Seeds the demo staff/inquiries when users is empty and demoSeedAllowed(), under the "seed" advisory lock.
 *  3. Re-queues every inquiry for projection when app_meta.projection_version differs from PROJECTION_VERSION.
 * SQLite builds its schema and seed when it opens, so this is a no-op there. Memoised per process; a failure is not
 * cached, so the next call checks again (e.g. after a paused project resumes).
 */
export function ensureReady():Promise<void> {
  if (db.dialect!=='postgres') return Promise.resolve();
  return shared.rmc2Ready??(shared.rmc2Ready=(async()=>{
    const row=await db.get<{value:string}>("SELECT value FROM app_meta WHERE key='schema_version'");
    if(row?.value!==EXPECTED_SCHEMA_VERSION)throw new Error('Database schema is not at the version this app expects. Apply the migrations, then restart.');
    await seedPostgres();
    const projection=await db.get<{value:string}>("SELECT value FROM app_meta WHERE key='projection_version'");
    if(projection?.value!==PROJECTION_VERSION)await enqueueFullReindex();
  })().catch(error=>{shared.rmc2Ready=undefined;throw error;}));
}
/** Label for the UI/monitoring ("which database am I on"). */
export const databaseLabel=()=>db.dialect==='postgres'?'PostgreSQL · shared server database':'SQLite · shared server storage';
/** Row locks on the given inquiries, in sorted id order (Postgres; no-op on SQLite, whose write lock is global). Call inside transaction(). */
export async function lockInquiryRows(ids:string[]) {
  const sorted=[...new Set(ids)].sort();
  if(db.dialect!=='postgres'||!sorted.length)return;
  await db.all('SELECT id FROM inquiries WHERE id IN ('+sorted.map(()=>'?').join(',')+') ORDER BY id'+forUpdate(db),...sorted);
}
/** JSON text for a jsonb column. Postgres jsonb rejects U+0000, so it is removed there; SQLite text is written unchanged. */
export function jsonParam(value:unknown):string { return db.dialect==='postgres'?JSON.stringify(value,(_key,item)=>typeof item==='string'?item.replace(/\u0000/g,''):item):JSON.stringify(value); }
export function passwordHash(password: string) { const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex'); }
export function passwordMatches(password: string, stored: string) { const [salt,hash]=stored.split(':');const actual=scryptSync(password,salt,64),expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected); }
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function allUsers():Promise<Staff[]> { return (await db.all<{data:string}>('SELECT data FROM users')).map(r=>JSON.parse(r.data)); }
export async function inquiries():Promise<InquiryRecord[]> { return (await db.all<{data:string}>('SELECT data FROM inquiries')).map(r=>JSON.parse(r.data) as InquiryRecord).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
export async function inquiry(id:string):Promise<InquiryRecord> { const row=await db.get<{data:string}>('SELECT data FROM inquiries WHERE id=?',id);if(!row)throw new AppError('Inquiry not found',404);return JSON.parse(row.data); }
export async function persist(record:InquiryRecord, expected?:number) {
  if(expected===undefined)await db.run('INSERT INTO inquiries (id,revision,data) VALUES (?,?,?)',record.id,record.revision,jsonParam(record));
  else { const result=await db.run('UPDATE inquiries SET revision=?,data=? WHERE id=? AND revision=?',record.revision,jsonParam(record),record.id,expected);if(!result.changes)throw new AppError('Another colleague updated this inquiry. Reload to review their changes before saving.',409); }
}
export function audit(record:InquiryRecord, staff:Staff, action:string, changes?:{field:string;before:string;after:string}[]) { const at=new Date().toISOString();record.updatedAt=at;record.revision++;record.handledBy=[...new Set([...record.handledBy,staff.id])];record.history.push({id:randomUUID(),at,actorId:staff.id,actor:staff.name,action,changes}); }
function newNotice(record:InquiryRecord,title:string,message:string,recipientIds:string[]):Notice { return {id:randomUUID(),inquiryId:record.id,title,message,at:new Date().toISOString(),recipientIds:[...new Set(recipientIds)],readBy:[]}; }
export async function notify(record:InquiryRecord,title:string,message:string,recipientIds:string[]) { const notice=newNotice(record,title,message,recipientIds);await db.run('INSERT INTO notifications(id,data) VALUES (?,?)',notice.id,jsonParam(notice)); }
export async function catalog():Promise<CatalogTemplate[]> { const file=resourceFile('catalog.json');const base:CatalogTemplate[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
  const overrides=(await db.all<{data:string}>('SELECT data FROM template_overrides')).map(row=>JSON.parse(row.data) as CatalogTemplate);
  const merged=new Map(base.map(template=>[template.id,{...template,active:['D091','D092','D093'].includes(template.sourceId)?false:template.active}]));
  for(const template of overrides)merged.set(template.id,template);
  return [...merged.values()]; }

// Demo staff and sample inquiries. Pure data: the SQLite (sync, at open) and Postgres (async, ensureReady) writers below share it.
function seedData() {
  const people:Staff[]=[
    {id:'cryssa',name:'Cryssa Kate Aban',email:'cryssa@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 4–5',active:true,canApprove:false},
    {id:'jefferson',name:'Jefferson Silot',email:'jefferson@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 1–3',active:true,canApprove:false},
    {id:'judy',name:'Judy Villaruel',email:'judy@rmc2.local',role:'Employee',position:'Franchising Coordinator · Divisions 4–5',active:true,canApprove:false},
    {id:'emerson',name:'Emerson Dolf Fernandez',email:'emerson@rmc2.local',role:'Supervisor',position:'VP of Franchising and Underwriting',active:true,canApprove:true},
    {id:'zeo',name:'Zeo Enorasa',email:'zeo@rmc2.local',role:'Supervisor',position:'AfterSales Operations and Client Relations Supervisor',active:true,canApprove:true},
    {id:'admin',name:'System Administrator',email:'admin@rmc2.local',role:'Admin',position:'System Administrator',active:true,canApprove:false},
  ];
  const users=people.map(person=>({id:person.id,data:JSON.stringify(person),password:passwordHash(LOCAL_PASSWORD)}));
  const records:InquiryRecord[]=[],notices:Notice[]=[];
  const companies=['Sampaguita National High School','Harbor Logistics Corporation','Evergreen Services, Inc.','Meridian Packaging Co.'];
  companies.forEach((company,index)=>{
    const at=new Date(Date.now()-(index*6+1)*3600000).toISOString();
    const fields={company,sector:index===0?'DepEd':'Private',industry:index===0?'Education':'Services',address:'Antipolo City, Rizal',division:'Division '+(index+1),branch:'Antipolo',requestDate:new Date().toISOString().slice(0,10),agentName:'Andrea Mendoza',agentEmail:'agent'+(index+1)+'@example.com',agentPhone:'09171234567',contactName:'Ariana Santos',contactEmail:'contact'+(index+1)+'@example.com',contactPhone:'09981234567',contactPosition:'HR Manager',addressee:'Ariana Santos',addresseePosition:'HR Manager',requestedPlan:index===0?'DepEd plan':'Group healthcare',existingProvider:'None',payment:'Annual',employees:index===0?'10':'65',dependents:'0',employeeAges:index===2?'':'22–58',dependentAges:'',hospitals:'',dental:''};
    const record:InquiryRecord={id:'INQ-2026-'+String(129-index).padStart(5,'0'),revision:1,status:'New inquiry',createdAt:at,updatedAt:at,fields,source:{filename:'Sample franchise form.xlsx',storage:'',sheet:'Sheet1',cells:[],fields:{...fields},receivedAt:at},email:defaultEmail(fields),emailOverrides:[],templateId:'',submissions:[],handledBy:[],history:[{id:randomUUID(),at,actorId:'intake',actor:'Local intake',action:'Agent inquiry received. All active franchising staff notified.'}],chat:[],notes:'',returnNote:'',returnFlags:[],detailRequests:[]};
    records.push(record);
    notices.push(newNotice(record,'New inquiry',`${company} is ready for its first form review.`,people.filter(p=>p.active).map(p=>p.id)));
  });
  return {users,records,notices};
}
function seedSqlite(database:DatabaseSync) {
  const {users,records,notices}=seedData();
  for(const user of users)database.prepare('INSERT INTO users(id,data,password) VALUES (?,?,?)').run(user.id,user.data,user.password);
  for(const record of records)database.prepare('INSERT INTO inquiries(id,revision,data) VALUES (?,?,?)').run(record.id,1,JSON.stringify(record));
  for(const notice of notices)database.prepare('INSERT INTO notifications(id,data) VALUES (?,?)').run(notice.id,JSON.stringify(notice));
}
async function seedPostgres() {
  if(await db.get('SELECT id FROM users LIMIT 1'))return;
  if(!demoSeedAllowed()){console.warn('[rmc2] Empty database and demo seed disabled: nobody can sign in. Set RMC2_SEED_DEMO=1 for test data.');return;}
  await db.transaction(async()=>{
    await db.lock('seed'); // two instances starting together: the second finds users already there
    if(await db.get('SELECT id FROM users LIMIT 1'))return;
    const {users,records,notices}=seedData();
    for(const user of users)await db.run('INSERT INTO users(id,data,password) VALUES (?,?,?)',user.id,user.data,user.password);
    for(const record of records)await db.run('INSERT INTO inquiries(id,revision,data) VALUES (?,?,?)',record.id,1,jsonParam(record));
    for(const notice of notices)await db.run('INSERT INTO notifications(id,data) VALUES (?,?)',notice.id,jsonParam(notice));
  });
}