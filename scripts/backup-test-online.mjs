// Nightly backup of the ONLINE TEST version while it holds real beta work (PO 2026-11-13: "Yes, set it up"). The free
// Supabase project has no backups we can restore, so until production exists this copies, READ-ONLY:
//   - every table in schema rmc2, from one consistent snapshot (REPEATABLE READ, READ ONLY), one JSON-lines file per table;
//   - every stored file under the app's prefix in the private bucket, byte for byte;
//   - a manifest with row counts and the SHA-256 of every file, checked again after writing.
// It writes outside the repo (default D:\Codes\coverdesk-backups\test-online\<time>\) and keeps the newest 14 backups.
// Nothing on TEST is changed. Keys and connection strings are never printed.
//   node --env-file=.env.supabase.test scripts/backup-test-online.mjs --project-ref pgoiqwixaeqbxlwbmren [--out <dir>] [--keep 14]
// Restore: see "Restoring a TEST backup" in PRODUCTION_RUNBOOK.md.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { register } from 'tsx/esm/api';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only (--project-ref ' + TEST_REF + ').');
const url = (process.env.RMC2_DATABASE_ADMIN_URL || '').trim();
assert.ok(url.includes(TEST_REF) && (process.env.RMC2_SUPABASE_URL || '').includes(TEST_REF), 'Refusing: env is not the TEST project.');
const root = path.resolve(arg('--out') || 'D:/Codes/coverdesk-backups/test-online');
assert.ok(!root.toLowerCase().startsWith(path.resolve('.').toLowerCase() + path.sep), 'Refusing: write backups outside the repository.');
const keep = Math.max(3, Number(arg('--keep') || 14));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), dir = path.join(root, stamp);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const started = Date.now();
await mkdir(path.join(dir, 'tables'), { recursive: true });

// ---- database: one snapshot ----
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {}, connect_timeout: 30 });
const manifest = { at: new Date().toISOString(), project: TEST_REF, schema: 'rmc2', tables: {}, files: {}, bucket: '', prefix: '' };
try {
  await sql.begin('isolation level repeatable read read only', async tx => {
    manifest.environment = (await tx`select value from rmc2.app_meta where key='environment'`)[0]?.value;
    const tables = (await tx`select table_name from information_schema.tables where table_schema='rmc2' and table_type='BASE TABLE' order by 1`).map(r => r.table_name);
    for (const table of tables) {
      const rows = await tx.unsafe(`select * from rmc2."${table.replace(/"/g, '""')}"`);
      const text = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
      await writeFile(path.join(dir, 'tables', table + '.jsonl'), text);
      manifest.tables[table] = { rows: rows.length, sha256: sha(Buffer.from(text)) };
    }
  });
} finally { await sql.end({ timeout: 5 }); }

// ---- stored files ----
register();
const store = await import('../lib/operations/file-store.ts');
manifest.bucket = process.env.RMC2_STORAGE_BUCKET?.trim() || 'rmc2-test-files';
manifest.prefix = process.env.RMC2_STORAGE_PREFIX?.trim() || 'preview';
const files = store.createFileStore({ kind: 'supabase', url: process.env.RMC2_SUPABASE_URL.trim(), secretKey: process.env.RMC2_SUPABASE_SECRET_KEY.trim(), bucket: manifest.bucket, prefix: manifest.prefix });
const keys = await files.list('');
let bytesTotal = 0;
for (const key of keys) {
  store.assertKey(key);
  const bytes = await files.get(key);
  const target = path.join(dir, 'files', ...key.split('/'));
  assert.ok(target.startsWith(path.join(dir, 'files') + path.sep), 'unsafe key ' + key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  manifest.files[key] = { size: bytes.length, sha256: sha(bytes) };
  bytesTotal += bytes.length;
}
await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));

// ---- verify what was written ----
for (const [table, info] of Object.entries(manifest.tables)) assert.equal(sha(await readFile(path.join(dir, 'tables', table + '.jsonl'))), info.sha256, 'table file ' + table);
for (const [key, info] of Object.entries(manifest.files)) assert.equal(sha(await readFile(path.join(dir, 'files', ...key.split('/')))), info.sha256, 'file ' + key);
await writeFile(path.join(dir, 'COMPLETE'), manifest.at + '\n');

// ---- keep the newest backups; only folders this script completed are ever removed ----
const done = [];
for (const name of (await readdir(root)).sort()) { try { await readFile(path.join(root, name, 'COMPLETE')); done.push(name); } catch { /* incomplete or foreign: left alone */ } }
const old = done.slice(0, Math.max(0, done.length - keep));
for (const name of old) await rm(path.join(root, name), { recursive: true, force: true });

const rows = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0);
const line = `${manifest.at} OK ${Object.keys(manifest.tables).length} tables, ${rows} rows (inquiries ${manifest.tables.inquiries?.rows ?? 0}, client directory ${manifest.tables.historical_accounts?.rows ?? 0}), ${keys.length} files, ${(bytesTotal / 1048576).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s -> ${dir}${old.length ? ' (removed ' + old.length + ' old)' : ''}`;
await writeFile(path.join(root, 'backup.log'), line + '\n', { flag: 'a' });
console.log(line);
