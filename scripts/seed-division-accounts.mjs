// Phase 2 setup for the ONLINE TEST database (Supabase Postgres): makes Emerson the Head and creates the Division Head and SOA sample accounts
// (Division 4) with random passwords.
// Usage: node --env-file=.env.supabase.test scripts/seed-division-accounts.mjs --project-ref <ref>
//   --project-ref must match the project in RMC2_DATABASE_URL, so the script cannot hit another database by accident.
// Appends the two new logins to test-results/online-credentials/CREDENTIALS.txt (git-ignored, same line format as rotate-demo-passwords.mjs)
// and never prints passwords. Safe to run twice: an account that already exists is left alone (its password is NOT changed).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function fail(message) { console.error('seed-division-accounts: ' + message); process.exit(1); }

const url = process.env.RMC2_DATABASE_URL;
const ref = opt('--project-ref');
if (!url) fail('RMC2_DATABASE_URL is not set (run with --env-file=.env.supabase.test).');
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) fail('pass --project-ref <the 20-character Supabase project ref>.');
if (!url.includes(ref)) fail('RMC2_DATABASE_URL does not point at project ' + ref + '; refusing.');
if (ref !== 'pgoiqwixaeqbxlwbmren') fail('this script is only for the online TEST project; refusing project ' + ref + '.');
if (process.env.VERCEL_ENV === 'production' || process.env.RMC2_ENV === 'production') fail('refusing to run against production.');

const outDir = path.join(root, 'test-results', 'online-credentials');
const credFile = path.join(outDir, 'CREDENTIALS.txt');
mkdirSync(outDir, { recursive: true });
if (spawnSync('git', ['check-ignore', '-q', credFile], { cwd: root }).status !== 0) fail(credFile + ' is not git-ignored; refusing to write passwords there.');

// Same format as passwordHash() in lib/operations/database.ts.
const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); };
const newAccounts = [
  { id: 'division-head', name: 'Division Head', username: 'division-head', email: 'divisionhead@rmc2.local', role: 'DivisionHead', position: 'Division Head · Division 4', division: 'Division 4', phone: '09170000004', active: true, canApprove: false },
  { id: 'soa', name: 'SOA', username: 'soa', email: 'soa@rmc2.local', role: 'SOA', position: 'SOA · Division 4', division: 'Division 4', phone: '09170000005', active: true, canApprove: false },
];

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 15, onnotice: () => {} });
const lines = [];
try {
  const summary = await sql.begin(async tx => {
    const done = { head: 'unchanged', created: [], existing: [] };
    const [emerson] = await tx`SELECT data::text AS data FROM rmc2.users WHERE id = 'emerson'`;
    if (!emerson) fail('the user "emerson" does not exist in this database.');
    const person = JSON.parse(emerson.data);
    if (person.role !== 'Head') {
      await tx`UPDATE rmc2.users SET data = ${JSON.stringify({ ...person, role: 'Head', canApprove: true })}::jsonb WHERE id = 'emerson'`;
      await tx`DELETE FROM rmc2.sessions WHERE user_id = 'emerson'`; // the old role must not live on in a session
      done.head = 'set to Head';
    }
    for (const account of newAccounts) {
      const [existing] = await tx`SELECT id FROM rmc2.users WHERE id = ${account.id} OR data->>'email' = ${account.email}`;
      if (existing) { done.existing.push(account.id); continue; }
      const password = randomBytes(18).toString('base64url');
      await tx`INSERT INTO rmc2.users (id, data, password) VALUES (${account.id}, ${JSON.stringify(account)}::jsonb, ${hashPassword(password)})`;
      lines.push(`${account.email}   username: ${account.username}   role: ${account.role}   password: ${password}`);
      done.created.push(account.id);
    }
    return done;
  });
  if (lines.length) {
    if (!existsSync(credFile)) writeFileSync(credFile, ['RMC2 ONLINE TEST - credentials (made-up data only)', 'Project: ' + ref, 'Do not commit or paste into public channels. Sign in with the email or username below.', ''].join('\r\n') + '\r\n');
    appendFileSync(credFile, ['', 'Added by seed-division-accounts.mjs ' + new Date().toISOString(), ...lines].join('\r\n') + '\r\n');
  }
  console.log(`Emerson: ${summary.head}. Created: ${summary.created.join(', ') || 'none'}. Already present (left unchanged): ${summary.existing.join(', ') || 'none'}.`);
  if (lines.length) console.log('Credentials appended to ' + credFile);
} catch (error) {
  fail('failed, nothing changed (code ' + (error?.code || 'unknown') + ').');
} finally { await sql.end({ timeout: 5 }); }
