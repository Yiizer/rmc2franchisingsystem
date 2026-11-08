// REMAINING_WORK §2 data hygiene: READ-ONLY audit of the TEST storage bucket. Lists every stored file, checks each
// name passes assertKey, and reports files no database record refers to (orphans). Deletes nothing, writes nothing.
// Database reads run in a READ ONLY transaction. Connection details and keys are never printed.
//   node --env-file=.env.supabase.test scripts/storage-audit-test.mjs --project-ref pgoiqwixaeqbxlwbmren
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { register } from 'tsx/esm/api';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only (--project-ref ' + TEST_REF + ').');
const url = (process.env.RMC2_DATABASE_ADMIN_URL || '').trim();
assert.ok(url.includes(TEST_REF) && (process.env.RMC2_SUPABASE_URL || '').includes(TEST_REF), 'Refusing: env is not the TEST project.');

register();
const store = await import('../lib/operations/file-store.ts');
const bucket = process.env.RMC2_STORAGE_BUCKET?.trim() || 'rmc2-test-files', prefix = process.env.RMC2_STORAGE_PREFIX?.trim() || 'preview';
const files = store.createFileStore({ kind: 'supabase', url: process.env.RMC2_SUPABASE_URL.trim(), secretKey: process.env.RMC2_SUPABASE_SECRET_KEY.trim(), bucket, prefix });
const keys = await files.list('');

const invalid = keys.filter(key => { try { store.assertKey(key); return false; } catch { return true; } });

// Every place a record can name a stored file: the JSON of these tables, searched as text.
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });
let corpus = '';
try {
  await sql.begin('read only', async tx => {
    const tables = (await tx`select table_name from information_schema.columns where table_schema='rmc2' and column_name='data' and data_type in ('jsonb','json','text')`).map(r => r.table_name);
    for (const table of tables) for (const row of await tx.unsafe(`select data::text as t from rmc2.${table}`)) corpus += row.t + '\n';
  });
} finally { await sql.end({ timeout: 5 }); }

const byFolder = {};
for (const key of keys) { const top = key.split('/')[0]; byFolder[top] = (byFolder[top] || 0) + 1; }
const swept = new Set(['transfer']); // transfer/ is cleaned by its own sweep (phase 5 large files)
const orphans = keys.filter(key => !swept.has(key.split('/')[0]) && !corpus.includes(key));
const orphanFolders = {};
for (const key of orphans) { const top = key.split('/')[0]; orphanFolders[top] = (orphanFolders[top] || 0) + 1; }

console.log('Stored files: ' + keys.length + ' · by folder ' + JSON.stringify(byFolder));
console.log('Names failing assertKey: ' + invalid.length + (invalid.length ? ' · e.g. ' + JSON.stringify(invalid.slice(0, 3)) : ''));
console.log('Not referenced by any record (excluding transfer/): ' + orphans.length + ' · by folder ' + JSON.stringify(orphanFolders));
if (orphans.length) console.log('Examples: ' + JSON.stringify(Object.keys(orphanFolders).map(f => orphans.find(k => k.startsWith(f + '/')))));
const idOnly = orphans.filter(key => (key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).some(id => corpus.includes(id)));
console.log('Of those, whose id appears in a record (likely referenced by id, not orphaned): ' + idOnly.length);
