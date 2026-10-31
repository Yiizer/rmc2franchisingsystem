// Phase 4 parity harness: runs the dialect-neutral suites against SQLite or Postgres (the TEST project) and compares observations.
//   node scripts/db-parity/run.mjs --db=sqlite
//   node scripts/db-parity/run.mjs --db=postgres [--suite=name,name]
//   node scripts/db-parity/run.mjs --compare            (diffs the last sqlite and postgres observation runs)
// Each suite is a child process with its own throwaway RMC2_DATA_DIR under test-results/qa-phase4/parity/. For Postgres the
// URL comes from RMC2_DATABASE_URL or the git-ignored .env.supabase.test and is never printed (output is masked).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { databaseUrl, maskText, root } from './lib.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.split('=')[1];
const outDir = path.join(root, 'test-results', 'qa-phase4', 'parity');
mkdirSync(outDir, { recursive: true });

const SUITES = [
  { name: 'app-duplicates', file: 'scripts/db-parity/suites/app-duplicates.mjs', note: 'split out of test-async-db: duplicate client, revision CAS, numbering, round-trip' },
  { name: 'observations', file: 'scripts/db-parity/suites/observations.mjs', note: 'scripted scenario; observations compared across databases', observations: true },
  { name: 'storage', file: 'scripts/test-storage.mjs', note: 'file storage contract + failure injection through the real service functions' },
  { name: 'workspace-scaling', file: 'scripts/db-parity/suites/workspace-scaling.mjs', note: 'index projection, paging and cache behaviour (QA_SCALE fixtures: 5000 on SQLite, 300 on Postgres)' },
  { name: 'phase4-callsites', file: 'scripts/test-phase4-callsites.mjs', note: 'static: SQL call sites use the portable subset', db: false },
  { name: 'phase4-pg-sql', file: 'scripts/test-phase4-pg-sql.mjs', note: 'static: Postgres SQL rules', db: false },
  { name: 'schema-parity', file: 'scripts/db-schema-parity.mjs', note: 'table/column/index parity SQLite vs migrations', db: false },
];

function compare() {
  const read = db => existsSync(path.join(outDir, db + '.json')) ? JSON.parse(readFileSync(path.join(outDir, db + '.json'), 'utf8')) : null;
  const a = read('sqlite'), b = read('postgres');
  if (!a || !b) { console.log('Run both --db=sqlite and --db=postgres first.'); process.exit(2); }
  const obs = r => Object.fromEntries((r.suites.observations?.obs || []).map(o => [o.name, o.value]));
  const oa = obs(a), ob = obs(b); let diffs = 0, same = 0;
  for (const name of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
    const x = JSON.stringify(oa[name]), y = JSON.stringify(ob[name]);
    if (x === y) { same++; continue; }
    const expected = /EXPECTED_DIFFERENCE/.test(name);
    if (!expected) diffs++;
    console.log(`${expected ? 'EXPECTED DIFF' : 'DIFF'} ${name}\n   sqlite   : ${x}\n   postgres : ${y}`);
  }
  console.log(`\nobservations: ${same} identical, ${diffs} unexpected differences`);
  for (const s of SUITES) {
    const ra = a.suites[s.name], rb = b.suites[s.name];
    console.log(`${s.name.padEnd(18)} sqlite ${ra ? (ra.exit === 0 ? 'pass ' + ra.pass : 'FAIL') : '-'}   postgres ${rb ? (rb.exit === 0 ? 'pass ' + rb.pass : 'FAIL') : '-'}`);
  }
  process.exit(diffs ? 1 : 0);
}
if (process.argv.includes('--compare')) compare();

const db = arg('db');
if (!['sqlite', 'postgres'].includes(db)) { console.log('usage: run.mjs --db=sqlite|postgres [--suite=a,b]  |  --compare'); process.exit(2); }
const wanted = arg('suite')?.split(',');
const stamp = String(Date.now());
const results = { db, at: new Date().toISOString(), suites: {} };
if (db === 'postgres') databaseUrl(); // fail early, without printing

function runSuite(suite) {
  return new Promise(resolve => {
    const dataDir = path.join(outDir, `${db}-${suite.name}-${stamp}`, 'data');
    const env = { ...process.env, RMC2_DATA_DIR: dataDir, RMC2_SEED_DEMO: '1', RMC2_MAIL_MODE: 'local', RMC2_MAIL_ENV: 'local' };
    for (const key of ['RMC2_STORAGE', 'RMC2_STORAGE_BUCKET', 'RMC2_STORAGE_PREFIX', 'RMC2_DB', 'RMC2_DATABASE_URL', 'VERCEL']) delete env[key];
    env.QA_EXPIRY_MS = process.env.QA_EXPIRY_MS || (db === 'postgres' ? '6000' : '300');
    env.QA_SCALE = process.env.QA_SCALE || (db === 'postgres' ? '300' : '5000');
    if (db === 'postgres' && suite.db !== false) { env.RMC2_DB = 'postgres'; env.RMC2_DATABASE_URL = databaseUrl(); }
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(root, suite.file)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    const timer = setTimeout(() => child.kill(), 15 * 60000);
    child.on('close', code => {
      clearTimeout(timer);
      const clean = maskText(text);
      const lines = clean.split(/\r?\n/);
      const obs = lines.filter(l => l.startsWith('OBS ')).map(l => { const i = l.indexOf(' ', 4); return { name: l.slice(4, i), value: JSON.parse(l.slice(i + 1)) }; });
      const entry = { exit: code, seconds: Math.round((Date.now() - started) / 1000), pass: lines.filter(l => /^PASS /.test(l)).length, fail: lines.filter(l => /^FAIL /.test(l)).length, tail: lines.filter(l => l.trim() && !l.startsWith('OBS ')).slice(-6), obs };
      writeFileSync(path.join(outDir, `${db}-${suite.name}.log`), clean);
      resolve(entry);
    });
  });
}
for (const suite of SUITES) {
  if (wanted && !wanted.includes(suite.name)) continue;
  if (db === 'postgres' && suite.db === false && false) continue;
  const entry = await runSuite(suite);
  results.suites[suite.name] = entry;
  console.log(`${entry.exit === 0 ? 'PASS' : 'FAIL'} [${db}] ${suite.name} (${entry.pass} checks, ${entry.seconds}s) ${entry.exit === 0 ? '' : entry.tail.join(' | ').slice(0, 300)}`);
}
writeFileSync(path.join(outDir, db + '.json'), JSON.stringify(results, null, 1));
const failed = Object.entries(results.suites).filter(([, r]) => r.exit !== 0);
console.log(`\n${db}: ${Object.keys(results.suites).length - failed.length}/${Object.keys(results.suites).length} suites passed`);
process.exit(failed.length ? 1 : 0);



