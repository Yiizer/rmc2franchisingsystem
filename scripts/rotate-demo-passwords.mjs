// Replaces the shared demo password on an online TEST database (Supabase Postgres) with a random password per account.
// Usage: node --env-file=.env.supabase.test scripts/rotate-demo-passwords.mjs --project-ref <ref> [--easy]
//   --easy  easy-to-type passwords (Word-Word-NN, about 30 bits) for a small trusted group; default is 24 random characters.
//   --project-ref must match the project in RMC2_DATABASE_URL, so the script cannot hit another database by accident.
// Writes the new passwords to test-results/online-credentials/CREDENTIALS.txt (git-ignored) and never prints them.
// Every session and login-attempt record is cleared, so anyone signed in with the old password is signed out.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function fail(message) { console.error('rotate-demo-passwords: ' + message); process.exit(1); }

const url = process.env.RMC2_DATABASE_URL;
const ref = opt('--project-ref');
if (!url) fail('RMC2_DATABASE_URL is not set (run with --env-file=.env.supabase.test).');
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) fail('pass --project-ref <the 20-character Supabase project ref>.');
if (!url.includes(ref)) fail('RMC2_DATABASE_URL does not point at project ' + ref + '; refusing.');
if (process.env.VERCEL_ENV === 'production' || process.env.RMC2_ENV === 'production') fail('refusing to run against production.');

const outDir = path.join(root, 'test-results', 'online-credentials');
const credFile = path.join(outDir, 'CREDENTIALS.txt');
mkdirSync(outDir, { recursive: true });
if (spawnSync('git', ['check-ignore', '-q', credFile], { cwd: root }).status !== 0) fail(credFile + ' is not git-ignored; refusing to write passwords there.');

// Same format as passwordHash() in lib/operations/database.ts.
// Easy passwords: two everyday words and a two-digit number, e.g. Sunny-River-42 (about 28 bits; login attempts are rate limited).
const WORDS = ['Apple','Beach','Brave','Bright','Cloud','Coral','Daisy','Eagle','Field','Flame','Forest','Garden','Gold','Happy','Harbor','Honey','Island','Jolly','Lemon','Lucky','Mango','Maple','Meadow','Moon','Ocean','Olive','Pearl','Pine','Quiet','Rain','River','Rose','Silver','Sky','Snow','Spring','Star','Stone','Summer','Sunny','Swift','Tiger','Valley','Wave','Willow','Wind','Winter','Zebra'];
const pick = () => WORDS[randomBytes(2).readUInt16BE(0) % WORDS.length];
const easyPassword = () => { let a = pick(), b = pick(); while (b === a) b = pick(); return a + '-' + b + '-' + String(10 + (randomBytes(1)[0] % 90)); };
const easy = args.includes('--easy');
const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); };

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 15, onnotice: () => {} });
const lines = ['RMC2 ONLINE TEST - credentials (made-up data only)', 'Project: ' + ref, 'Generated: ' + new Date().toISOString(), 'Do not commit or paste into public channels. Sign in with the email or username below.', ''];
try {
  const count = await sql.begin(async tx => {
    const users = await tx`SELECT id, data::text AS data FROM rmc2.users ORDER BY id`;
    if (!users.length) fail('the database has no users.');
    for (const row of users) {
      const user = JSON.parse(row.data), password = easy ? easyPassword() : randomBytes(18).toString('base64url');
      await tx`UPDATE rmc2.users SET password = ${hashPassword(password)} WHERE id = ${row.id}`;
      lines.push(`${user.email}   username: ${user.username}   role: ${user.role}   password: ${password}`);
    }
    await tx`DELETE FROM rmc2.sessions`;
    await tx`DELETE FROM rmc2.auth_attempts`;
    return users.length;
  });
  writeFileSync(credFile, lines.join('\r\n') + '\r\n');
  console.log(`Rotated passwords for ${count} accounts and signed everyone out.`);
  console.log('Credentials file: ' + credFile);
} catch (error) {
  fail('failed, nothing changed (code ' + (error?.code || 'unknown') + ').');
} finally { await sql.end({ timeout: 5 }); }
