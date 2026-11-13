// Throwaway local PostgreSQL for the Postgres stress tests (PO 2026-11-12: T4, T5 and T10 never run against the TEST
// database the staff dry runs use). Starts PostgreSQL on 127.0.0.1, creates the three Supabase roles the migrations
// expect, applies every migration in order, starts two `next start` instances (5190, 5191) on it with demo accounts,
// runs the given command with RMC2_TEST_URL / RMC2_TEST_URL2 / RMC2_DATABASE_URL set, then stops everything and deletes
// the data. It also checks the production runbook order (PRODUCTION_RUNBOOK.md §1): on a second database, the
// environment marker set right after the first migration is still 'production' after all 13, and the app role cannot
// change it.
//
// Needs `embedded-postgres` installed OUTSIDE the repo (it is not a project dependency), and a fresh `npm run build`:
//   npm install embedded-postgres@17.10.0-beta.17 --prefix <dir>
//   node scripts/pg-local.mjs --pg-dir <dir> -- node scripts/test-pg-http.mjs T4 T5 T10
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const pgDir = arg('--pg-dir'), dash = process.argv.indexOf('--'), command = dash > 0 ? process.argv.slice(dash + 1) : [];
assert.ok(pgDir && existsSync(path.join(pgDir, 'node_modules', 'embedded-postgres')), 'Pass --pg-dir <folder where embedded-postgres is installed>.');
assert.ok(!path.resolve(pgDir).startsWith(root + path.sep), 'Install embedded-postgres outside the repository.');
assert.ok(existsSync(path.join(root, '.next', 'BUILD_ID')), 'Run npm run build first.');
const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(pgDir, 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href);
const postgres = (m => m.default ?? m)(await import(pathToFileURL(createRequire(path.join(root, 'package.json')).resolve('postgres')).href));

const PORT = 54329, stamp = Date.now(), superPw = randomBytes(18).toString('hex'), appPw = randomBytes(18).toString('hex');
const dataDir = path.join(pgDir, 'data-' + stamp), appData = path.join(root, 'test-results', 'pg-local', String(stamp));
mkdirSync(appData, { recursive: true });
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: superPw, port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] /* like Supabase; Windows would pick its code page */, onLog: () => {}, onError: () => {} });
const url = (user, pw, db) => `postgres://${user}:${pw}@127.0.0.1:${PORT}/${db}`;
const migrations = readdirSync(path.join(root, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort();
const children = [];
let exitCode = 1;

async function prepare(db, between) {
  await pg.createDatabase(db);
  const sql = postgres(url('postgres', superPw, db), { ssl: false, max: 1, prepare: false, onnotice: () => {} });
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) await sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then create role ${role} nologin; end if; end $$`);
    for (const [i, file] of migrations.entries()) {
      await sql.begin(async tx => { await tx.unsafe(readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8')); });
      if (i === 0 && between) await between(sql);
    }
    await sql.unsafe(`alter role rmc2_app password '${appPw}'`); // throwaway local value, never printed
    return (await sql`select value from rmc2.app_meta where key='environment'`)[0]?.value;
  } finally { await sql.end({ timeout: 5 }); }
}

try {
  await pg.initialise();
  await pg.start();
  console.log('Local PostgreSQL started on 127.0.0.1:' + PORT);
  { const c = postgres(url('postgres', superPw, 'postgres'), { ssl: false, max: 1, onnotice: () => {} }); const [{ server_encoding: e }] = await c`show server_encoding`; await c.end(); assert.equal(e, 'UTF8', 'server encoding'); }

  // The runbook order, on its own database.
  const marker = await prepare('rmc2_runbook', sql => sql`insert into rmc2.app_meta (key, value) values ('environment', 'production')`);
  assert.equal(marker, 'production', 'runbook order: marker after all migrations');
  const app = postgres(url('rmc2_app', appPw, 'rmc2_runbook'), { ssl: false, max: 1, prepare: false, onnotice: () => {} });
  const refused = await app`update rmc2.app_meta set value='test' where key='environment'`.then(() => 'changed', e => e.code);
  await app.end({ timeout: 5 });
  assert.equal(refused, '42501', 'the app role cannot change the marker');
  console.log(`PASS Runbook order: ${migrations.length} migrations applied one by one with the marker set after the first; environment stays 'production' and rmc2_app is refused (42501)`);

  // The QA database the stress tests run on.
  assert.equal(await prepare('rmc2_qa'), 'test');
  console.log(`PASS All ${migrations.length} migrations apply in order on PostgreSQL 17 (self-checks in 200 and 500 passed); environment 'test'`);
  const env = { ...process.env, RMC2_DB: 'postgres', RMC2_DATABASE_URL: url('rmc2_app', appPw, 'rmc2_qa'), RMC2_DATABASE_SSL: 'disable', RMC2_SEED_DEMO: '1', RMC2_STORAGE: 'local', RMC2_DATA_DIR: appData, RMC2_QA_LOCAL_PASSWORDS: '1', VERCEL_DEPLOYMENT_ID: 'pg-local-' + stamp /* one deployment, like Vercel's instances */ };
  for (const key of Object.keys(env)) if (/^RMC2_(MAIL_|SMTP_|SUPABASE_|STORAGE_BUCKET|DATABASE_ADMIN|DATABASE_CA)/.test(key) || key === 'VERCEL') delete env[key];
  const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  // Another server on these ports would answer the readiness check and the tests would run against IT (seen 2026-11-13).
  for (const port of [5190, 5191]) { const busy = await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false); assert.ok(!busy, 'Port ' + port + ' is already in use: stop that server first.'); }
  for (const port of [5190, 5191]) {
    const child = spawn(process.execPath, [next, 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(path.join(appData, 'server-' + port + '.log')); // kept under test-results/pg-local/ for diagnosis
    child.stdout.pipe(log); child.stderr.pipe(log);
    children.push(child);
  }
  for (const port of [5190, 5191]) {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/operations/session`)).status > 0; } catch { await new Promise(r => setTimeout(r, 1000)); } }
    assert.ok(up, 'server ' + port + ' did not start');
  }
  console.log('Two app instances on 127.0.0.1:5190 and :5191, sharing the local database');
  if (command.length) {
    const run = spawn(command[0], command.slice(1), { cwd: root, env: { ...env, RMC2_TEST_URL: 'http://127.0.0.1:5190', RMC2_TEST_URL2: 'http://127.0.0.1:5191', RMC2_LOCAL_OWNER_URL: url('postgres', superPw, 'rmc2_qa'), RMC2_LOCAL_PROD_URL: url('postgres', superPw, 'rmc2_runbook'), RMC2_LOCAL_DATA_DIR: appData /* rehearsals: scripts/rehearse-move-local.mjs */ }, stdio: 'inherit', shell: process.platform === 'win32' && command[0] !== process.execPath });
    exitCode = await new Promise(resolve => run.on('exit', code => resolve(code ?? 1)));
  } else exitCode = 0;
} finally {
  for (const child of children) child.kill();
  await pg.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  console.log('Local PostgreSQL stopped and its data deleted');
}
process.exit(exitCode);
