// Phase 4 QA cleanup for the shared Postgres TEST database: leaves ONLY the demo seed.
//   * keeps the schema, app_meta and workspace_versions, and keeps the 6 demo users exactly as they are (data + password hash)
//   * removes everything else (inquiries, notices, sessions, outbox, files log, rate-limit rows, historical, templates, ...)
//   * re-creates the 4 demo inquiries and their notices through the app's own seed, resets the inquiry counter to 129,
//     and re-projects the index.
// Uses the app role (RMC2_DATABASE_URL) only: no DDL, no admin connection. Refuses to run unless the URL looks like the TEST project's pooler.
// usage: node scripts/db-parity/cleanup-pg.mjs [--dry-run]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { databaseUrl, maskText, root } from './lib.mjs';

const dry = process.argv.includes('--dry-run');
const url = databaseUrl();
const ref = (process.env.RMC2_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\./)?.[1];
if (!/pooler\.supabase\.com/.test(url)) throw new Error('Refusing: the database URL is not a Supabase pooler URL.');
Object.assign(process.env, { RMC2_DB: 'postgres', RMC2_DATABASE_URL: url, RMC2_SEED_DEMO: '1', RMC2_STORAGE: 'local', RMC2_DATA_DIR: path.join(root, 'test-results', 'qa-phase4', 'cleanup-data') });
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_)/.test(key) || key === 'VERCEL') delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.join(root, 'lib', 'operations', file)).href);
const database = await imp('database.ts');
const { db } = database;
// NOT ensureReady() here: it is memoised per process, and the reseed below must run it for the first time after the delete.
const schema = await db.get("SELECT value FROM app_meta WHERE key='schema_version'");
if (schema?.value !== database.EXPECTED_SCHEMA_VERSION) throw new Error('Schema version mismatch; not touching anything.');

// children first
const ORDER = ['notice_recipients', 'inquiry_keys', 'inquiry_summaries', 'inquiry_index_pending', 'inquiry_activity', 'sessions', 'auth_attempts', 'file_access', 'security_events', 'outbox', 'mail_sends', 'ai_usage', 'template_versions', 'template_overrides', 'historical_reviews', 'historical_edits', 'historical_accounts', 'historical_imports', 'notifications', 'inquiries'];
const before = {};
for (const table of [...ORDER, 'users']) before[table] = Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n);
console.log('before:', JSON.stringify(before));
if (dry) { console.log('dry run: nothing changed'); await db.close(); process.exit(0); }

const users = await db.all('SELECT id, data, password FROM users ORDER BY id');
if (users.length !== 6 && users.length !== 0) throw new Error('Expected the 6 demo users (or none, to re-seed), found ' + users.length + '. Not touching anything.');
await db.transaction(async () => {
  await db.lock('seed', 'idx-sync');
  for (const table of ORDER) await db.run(`DELETE FROM ${table}`);
  await db.run('DELETE FROM users');
});
// The app's own seed: users, 4 demo inquiries, 4 notices (only when users is empty).
await database.ensureReady();
const seededUsers = Number((await db.get('SELECT COUNT(*) AS n FROM users')).n);
if (seededUsers !== 6) throw new Error('Reseed did not recreate 6 users (' + seededUsers + ').');
await db.transaction(async () => {
  for (const u of users) await db.run('UPDATE users SET data=?, password=? WHERE id=?', u.data, u.password, u.id); // the original rows, byte for byte (none when recovering from an empty users table)
  await db.run("UPDATE counters SET n=129 WHERE name='inquiry'");
});
const index = await imp('inquiry-index.ts');
await index.synchronizeInquiryIndex();
const after = {};
for (const table of [...ORDER, 'users']) after[table] = Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n);
const counter = Number((await db.get("SELECT n FROM counters WHERE name='inquiry'")).n);
const ids = (await db.all('SELECT id FROM inquiries ORDER BY id')).map(r => r.id);
const pending = Number((await db.get('SELECT COUNT(*) AS n FROM inquiry_index_pending')).n);
console.log('after :', JSON.stringify(after), 'counter', counter, 'inquiries', ids.join(','), 'pending', pending);
const ok = after.users === 6 && after.inquiries === 4 && after.notifications === 4 && after.inquiry_summaries === 4 && counter === 129 && pending === 0 && ORDER.filter(t => !['notifications', 'inquiries', 'inquiry_summaries', 'notice_recipients', 'inquiry_keys'].includes(t)).every(t => after[t] === 0);
console.log(ok ? 'CLEAN: only the demo seed remains' : 'UNEXPECTED STATE');
await db.close();
process.exit(ok ? 0 : 1);

