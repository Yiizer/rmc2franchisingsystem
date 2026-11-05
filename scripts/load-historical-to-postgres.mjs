// Copies the historical client register (historical_accounts + historical_imports) from the local SQLite database
// (.data/rmc2.sqlite, opened READ-ONLY) into the Postgres TEST project. PO decision 2026-11-05: the client wants to see
// the real directory on the test version before the final security check, and accepts that risk.
//   node --env-file=.env.supabase.test scripts/load-historical-to-postgres.mjs --project-ref pgoiqwixaeqbxlwbmren          dry run
//   node --env-file=.env.supabase.test scripts/load-historical-to-postgres.mjs --project-ref pgoiqwixaeqbxlwbmren --apply  write
// Existing rows are left alone (ON CONFLICT DO NOTHING), so it is safe to rerun. Prints counts only, never names.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import postgres from 'postgres';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const ref = arg('--project-ref'), apply = process.argv.includes('--apply');
const url = (process.env.RMC2_DATABASE_URL || '').trim();
assert.equal(ref, TEST_REF, 'Refusing: this script only loads the TEST project (--project-ref ' + TEST_REF + ').');
assert.ok(url.includes(TEST_REF), 'Refusing: RMC2_DATABASE_URL is not the test project.');

// --source <sqlite> reads another register copy, e.g. a scratch import made with the fixed importer (test-results/importer-check/data/rmc2.sqlite).
const local = new DatabaseSync(path.resolve(arg('--source') || '.data/rmc2.sqlite'), { readOnly: true });
const clean = value => typeof value === 'string' ? value.replace(/\u0000/g, '') : value;
const accounts = local.prepare('SELECT id,batch,sheet,source_row,account,account_key,agent,branch,status,data FROM historical_accounts ORDER BY id').all()
  .map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k === 'data' ? clean(String(v)).replace(/\\u0000/g, '') : clean(v)])));
const imports = local.prepare('SELECT id,at,source,report FROM historical_imports').all().map(row => ({ ...row, report: clean(String(row.report)).replace(/\\u0000/g, '') }));
for (const row of accounts) JSON.parse(row.data);
for (const row of imports) JSON.parse(row.report);
const sheets = new Map(); for (const row of accounts) sheets.set(row.sheet, (sheets.get(row.sheet) || 0) + 1);
console.log('Local register:', accounts.length, 'rows,', sheets.size, 'sheets,', imports.length, 'import batch(es).');

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });
try {
  const [{ n: before }] = await sql`select count(*)::int n from rmc2.historical_accounts`;
  console.log('Test project before:', before, 'rows.');
  if (!apply) { console.log('Dry run: nothing written. Add --apply to load.'); process.exit(0); }
  await sql.begin(async tx => {
    for (const row of imports) await tx`insert into rmc2.historical_imports (id,at,source,report) values (${row.id},${row.at},${row.source},${row.report}::jsonb) on conflict (id) do nothing`;
    for (let i = 0; i < accounts.length; i += 250) {
      const chunk = accounts.slice(i, i + 250);
      await tx`insert into rmc2.historical_accounts ${tx(chunk.map(r => ({ ...r, data: tx.json(JSON.parse(r.data)) })), 'id', 'batch', 'sheet', 'source_row', 'account', 'account_key', 'agent', 'branch', 'status', 'data')} on conflict (id) do nothing`;
    }
  });
  const [{ n: after }] = await sql`select count(*)::int n from rmc2.historical_accounts`;
  console.log('Test project after:', after, 'rows (' + (after - before) + ' added).');
} finally { await sql.end(); }
