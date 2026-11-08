// Applies ONE migration file to the Supabase TEST project, inside a transaction, then lists what the file created.
// Test project only; never db push, never production. The connection string is read from env and never printed.
//   node --env-file=.env.supabase.test scripts/apply-migration-test.mjs --project-ref pgoiqwixaeqbxlwbmren supabase/migrations/<file>.sql
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only (--project-ref ' + TEST_REF + ').');
const file = process.argv.slice(2).find(a => a.endsWith('.sql'));
assert.ok(file && path.resolve(file).startsWith(path.resolve('supabase/migrations') + path.sep), 'Pass one file from supabase/migrations/.');
const url = (process.env.RMC2_DATABASE_ADMIN_URL || '').trim();
assert.ok(url && url.includes(TEST_REF), 'Refusing: RMC2_DATABASE_ADMIN_URL is missing or not the test project.');
assert.ok(!url.includes('[YOUR-PASSWORD]'), 'RMC2_DATABASE_ADMIN_URL still has the [YOUR-PASSWORD] placeholder.');

const text = await readFile(file, 'utf8');
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.begin(async tx => { await tx.unsafe(text); });
  console.log('Applied ' + path.basename(file) + ' to the TEST project.');
  const tables = [...text.matchAll(/create table if not exists rmc2\.(\w+)/gi)].map(m => m[1]);
  for (const table of tables) {
    const columns = await sql`select column_name, data_type from information_schema.columns where table_schema = 'rmc2' and table_name = ${table} order by ordinal_position`;
    const indexes = await sql`select indexname from pg_indexes where schemaname = 'rmc2' and tablename = ${table} order by indexname`;
    const grants = await sql`select privilege_type from information_schema.role_table_grants where table_schema = 'rmc2' and table_name = ${table} and grantee = 'rmc2_app' order by privilege_type`;
    const rls = await sql`select relrowsecurity from pg_class where oid = ${'rmc2.' + table}::regclass`;
    console.log(table + ': columns ' + columns.map(c => c.column_name + ' ' + c.data_type).join(', '));
    console.log(table + ': indexes ' + indexes.map(i => i.indexname).join(', '));
    console.log(table + ': rmc2_app grants ' + grants.map(g => g.privilege_type).join(', ') + ' · row level security ' + (rls[0]?.relrowsecurity ? 'on' : 'OFF'));
  }
} finally { await sql.end({ timeout: 5 }); }
