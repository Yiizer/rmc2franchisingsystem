// Prepares a TEST-ONLY data directory for the online staging instance.
// Usage: node scripts/staging-setup.mjs [--data-dir <dir>] [--rotate] [--port 5181]
// Seeds a fresh database through the app's own startup path, replaces every seeded
// password with a new random one and writes them to <data dir>/STAGING_CREDENTIALS.txt.
// Never prints passwords. Refuses to touch the real .data directory.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const rotate = args.includes('--rotate');
const port = Number(opt('--port', '5181'));
const rel = opt('--data-dir', path.join('test-results', 'staging-data'));
const dataDir = path.resolve(root, rel);
const LOCAL_PASSWORD = 'Rmc2Local!2026'; // documented shared local password; must never work on staging

function fail(message) { console.error('staging-setup: ' + message); process.exit(1); }

// ---- Safety guards ----
const inside = (child, parent) => { const r = path.relative(parent, child); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
const realData = path.join(root, '.data');
if (dataDir.toLowerCase() === realData.toLowerCase() || inside(dataDir, realData)) fail('refusing to run against the real .data directory.');
if (!inside(dataDir, root)) fail('data dir must be inside the repository checkout.');
const topLevel = path.relative(root, dataDir).split(path.sep)[0];
if (!['test-results', 'staging-data'].includes(topLevel)) fail('data dir must be under test-results/ or staging-data/.');
mkdirSync(dataDir, { recursive: true });
const ignored = spawnSync('git', ['check-ignore', '-q', path.join(dataDir, 'STAGING_CREDENTIALS.txt')], { cwd: root });
if (ignored.status !== 0) fail('data dir is not gitignored; add it to .gitignore first (credentials must never be committed).');

const dbFile = path.join(dataDir, 'rmc2.sqlite');
const credFile = path.join(dataDir, 'STAGING_CREDENTIALS.txt');
const matches = (password, stored) => { const [salt, hash] = stored.split(':'); const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); };
const hashPassword = (password) => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); };

// ---- 1. Seed through the app itself (first database access creates schema + seed) ----
async function seedViaApp() {
  const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) fail('no production build found; run "npm run build" first.');
  const child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { ...process.env, RMC2_DATA_DIR: dataDir }, stdio: 'ignore', windowsHide: true,
  });
  let ready = false;
  try {
    for (let i = 0; i < 60 && !ready; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        // Unknown login: touches the database (which seeds it) and answers 401. Same-origin header passes the origin check.
        const res = await fetch(`http://127.0.0.1:${port}/api/operations/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ email: 'staging-seed-probe', password: 'x' }) });
        ready = res.status === 401 || res.status === 429;
      } catch { /* server not up yet */ }
    }
  } finally { child.kill(); await new Promise(r => setTimeout(r, 1500)); }
  if (!ready) fail(`temporary server did not start on port ${port} (is it already in use?).`);
}

if (!existsSync(dbFile)) await seedViaApp();

// ---- 2. Inspect / rotate passwords ----
const database = new DatabaseSync(dbFile);
database.exec('PRAGMA busy_timeout=5000');
const users = database.prepare('SELECT id, data, password FROM users').all().map(row => ({ id: row.id, ...JSON.parse(row.data), password: row.password }));
if (!users.length) fail('database has no users; delete the data dir and rerun.');
const stillDefault = users.filter(u => matches(LOCAL_PASSWORD, u.password));

if (existsSync(credFile) && !rotate && !stillDefault.length) {
  database.close();
  console.log('Credentials already set. Use --rotate to issue new passwords.');
  console.log('Credentials file: ' + credFile);
  process.exit(0);
}

const lines = [
  'RMC2 STAGING (TEST DATA ONLY) - credentials',
  'Generated: ' + new Date().toISOString(),
  'Do not commit or paste into public channels. Log in with the email or username below.',
  '',
];
database.exec('BEGIN IMMEDIATE');
try {
  for (const user of users) {
    const password = randomBytes(18).toString('base64url');
    database.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password), user.id);
    lines.push(`${user.email}   role: ${user.role}   password: ${password}`);
  }
  database.exec('DELETE FROM sessions; DELETE FROM auth_attempts;'); // revoke sessions from old passwords, clear probe lockouts
  database.exec('COMMIT');
} catch (error) { database.exec('ROLLBACK'); throw error; }
database.close();
writeFileSync(credFile, lines.join('\r\n') + '\r\n');
console.log((rotate ? 'Rotated' : 'Set') + ` passwords for ${users.length} accounts.`);
console.log('Credentials file: ' + credFile);
