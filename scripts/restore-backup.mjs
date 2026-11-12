// Restores a backup made by scripts/backup-test-online.mjs, so the nightly copy is proven usable, and as the core of the
// TEST -> production move (PRODUCTION_RUNBOOK.md §4). For now it restores ONLY into a throwaway LOCAL database started by
// scripts/pg-local.mjs (owner URL on 127.0.0.1); any other target is refused. A production target is added with the move
// script, with its own guards.
//   node scripts/pg-local.mjs --pg-dir <dir> -- node scripts/restore-backup.mjs --backup <backup dir>
// Steps: verify every checksum in the backup; in one transaction (triggers off, so the restored index, versions and audit
// rows are taken as they are) empty every table except app_meta (the target keeps its own environment marker) and insert
// the backup's rows; write the stored files under the same keys into the local data directory; then check every count.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = path.resolve(arg('--backup') || '');
const ownerUrl = process.env.RMC2_LOCAL_OWNER_URL || '', dataDir = process.env.RMC2_LOCAL_DATA_DIR || '';
assert.ok(ownerUrl && ['127.0.0.1', 'localhost'].includes(new URL(ownerUrl).hostname), 'Refusing: restore only into the local database from scripts/pg-local.mjs.');
assert.ok(dataDir && path.resolve(dataDir).includes(path.join('test-results', 'pg-local')), 'Refusing: files go only into the pg-local data directory.');
await readFile(path.join(dir, 'COMPLETE')).catch(() => { throw new Error('Not a complete backup: ' + dir); });
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// 1. The backup is intact.
const tables = {};
for (const [table, info] of Object.entries(manifest.tables)) {
  const text = await readFile(path.join(dir, 'tables', table + '.jsonl'));
  assert.equal(sha(text), info.sha256, 'backup table file changed: ' + table);
  tables[table] = text.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(tables[table].length, info.rows, 'rows in ' + table);
}
for (const [key, info] of Object.entries(manifest.files)) assert.equal(sha(await readFile(path.join(dir, 'files', ...key.split('/')))), info.sha256, 'backup file changed: ' + key);
console.log(`Backup ${path.basename(dir)} intact: ${Object.keys(tables).length} tables, ${Object.keys(manifest.files).length} files`);

// 2. Database, in one transaction.
const sql = postgres(ownerUrl, { ssl: false, max: 1, prepare: false, onnotice: () => {} });
const restored = Object.keys(tables).filter(table => table !== 'app_meta');
try {
  await sql.begin(async tx => {
    await tx`set local session_replication_role = replica`;
    const targetTables = new Set((await tx`select table_name from information_schema.tables where table_schema='rmc2' and table_type='BASE TABLE'`).map(r => r.table_name));
    for (const table of restored) assert.ok(targetTables.has(table), 'the target has no table ' + table + ' (apply the same migrations first)');
    await tx.unsafe('truncate ' + restored.map(t => `rmc2."${t}"`).join(', '));
    for (const table of restored) for (let i = 0; i < tables[table].length; i += 500)
      await tx.unsafe(`insert into rmc2."${table}" select * from json_populate_recordset(null::rmc2."${table}", $1::text::json)`, [JSON.stringify(tables[table].slice(i, i + 500))]);
  });
  const diff = [];
  for (const table of restored) { const n = (await sql.unsafe(`select count(*)::int n from rmc2."${table}"`))[0].n; if (n !== manifest.tables[table].rows) diff.push(`${table} ${n}/${manifest.tables[table].rows}`); }
  assert.deepEqual(diff, [], 'row counts after the restore');
  const env = (await sql`select value from rmc2.app_meta where key='environment'`)[0]?.value;
  console.log(`Database restored: ${restored.length} tables, every count matches; app_meta kept (environment '${env}')`);
} finally { await sql.end({ timeout: 5 }); }

// 3. Stored files, same keys, into the local file store.
for (const key of Object.keys(manifest.files)) {
  const target = path.join(dataDir, ...key.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(path.join(dir, 'files', ...key.split('/'))));
  assert.equal(sha(await readFile(target)), manifest.files[key].sha256, 'restored file ' + key);
}
console.log(`Files restored: ${Object.keys(manifest.files).length}, every SHA-256 matches`);
