// Compares table, column and (explicit) index names between
//   A) a throwaway SQLite database created by openDatabase (lib/operations/database.ts), and
//   B) the Postgres schema `rmc2`: a static parse of supabase/migrations/*.sql, or, when
//      RMC2_DATABASE_ADMIN_URL is set, read-only introspection of the live schema.
// Differences that the design makes on purpose are listed in EXPECTED and reported separately.
// Exit code 1 if there is any unexpected difference. Never touches .data.
//
// Usage: node scripts/db-schema-parity.mjs [--static]     (--static ignores RMC2_DATABASE_ADMIN_URL)
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '..');
const forceStatic = process.argv.includes('--static');

// Intentional differences (design: phase4-design.md). Format: table, table.column, index name.
const EXPECTED = {
  pgOnlyTables: {
    counters: 'atomic counters (inquiry numbering)',
    app_meta: 'schema_version / projection_version',
    mail_sends: 'SQLite creates it lazily on first mail send (service.ts); in Postgres it is in the migration',
  },
  pgOnlyColumns: {
    'historical_reviews.seq': 'identity column replacing rowid',
    'historical_edits.seq': 'identity column replacing rowid',
  },
  pgOnlyIndexes: {
    mail_sends_at: 'mail caps count recent sends',
    historical_review_seq: 'ordered reads by seq',
    historical_edit_seq: 'ordered reads by seq',
  },
};

// ---- SQLite side ------------------------------------------------------------------------------
async function readSqlite() {
  const dir = path.join(root, 'test-results', 'schema-parity', String(Date.now()), 'app-data');
  if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to use .data');
  mkdirSync(dir, { recursive: true });
  process.env.RMC2_DATA_DIR = dir;
  delete process.env.RMC2_SEED_DEMO; // schema only; the demo seed adds rows, not structure
  process.env.RMC2_DB = 'sqlite';
  register();
  const { db } = await import(pathToFileURL(path.join(root, 'lib/operations/database.ts')).href);
  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
  const result = { tables: {}, indexes: new Set() };
  for (const { name } of tables) {
    const cols = await db.all('SELECT name FROM pragma_table_info(?)', name);
    result.tables[name] = new Set(cols.map(c => c.name));
  }
  const idx = await db.all("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL");
  for (const { name } of idx) result.indexes.add(name);
  return result;
}

// ---- Postgres, static ---------------------------------------------------------------------------
function stripComments(sql) { return sql.replace(/--[^\n]*/g, ''); }

function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function readPostgresStatic() {
  const dir = path.join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const result = { tables: {}, indexes: new Set(), source: files.join(', ') };
  for (const file of files) {
    const sql = stripComments(readFileSync(path.join(dir, file), 'utf8'));
    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?rmc2\.(\w+)\s*\(/gi;
    for (let m; (m = tableRe.exec(sql));) {
      let depth = 1, i = tableRe.lastIndex;
      while (i < sql.length && depth > 0) { if (sql[i] === '(') depth++; else if (sql[i] === ')') depth--; i++; }
      const body = sql.slice(tableRe.lastIndex, i - 1);
      const cols = new Set();
      for (const item of splitTopLevel(body)) {
        const first = item.trim().split(/\s+/)[0].replace(/"/g, '').toLowerCase();
        if (!first || ['primary', 'unique', 'constraint', 'foreign', 'check', 'exclude', 'like'].includes(first)) continue;
        cols.add(first);
      }
      result.tables[m[1].toLowerCase()] = cols;
    }
    const idxRe = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+rmc2\.(\w+)/gi;
    for (let m; (m = idxRe.exec(sql));) result.indexes.add(m[1].toLowerCase());
  }
  return result;
}

// ---- Postgres, live (read-only catalog queries) -------------------------------------------------------
async function readPostgresLive(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, ssl: 'require', prepare: false, fetch_types: false, connect_timeout: 10 });
  try {
    const cols = await sql`select table_name, column_name from information_schema.columns where table_schema = 'rmc2' order by 1, ordinal_position`;
    const idx = await sql`select indexname from pg_indexes where schemaname = 'rmc2'
      and indexname not in (select conname from pg_constraint where connamespace = 'rmc2'::regnamespace)`;
    const result = { tables: {}, indexes: new Set(idx.map(r => r.indexname)), source: 'live rmc2 schema' };
    for (const r of cols) (result.tables[r.table_name] ??= new Set()).add(r.column_name);
    return result;
  } finally { await sql.end({ timeout: 5 }); }
}

// ---- Compare ---------------------------------------------------------------------------------------------
const lite = await readSqlite();
const adminUrl = forceStatic ? '' : (process.env.RMC2_DATABASE_ADMIN_URL || '');
const pg = adminUrl ? await readPostgresLive(adminUrl) : readPostgresStatic();

const expected = [], unexpected = [];
const note = (list, text) => list.push(text);

for (const t of Object.keys(lite.tables)) {
  if (!pg.tables[t]) { note(unexpected, `table ${t}: in SQLite, missing in Postgres`); continue; }
  for (const c of lite.tables[t]) if (!pg.tables[t].has(c)) note(unexpected, `column ${t}.${c}: in SQLite, missing in Postgres`);
  for (const c of pg.tables[t]) if (!lite.tables[t].has(c)) {
    const why = EXPECTED.pgOnlyColumns[`${t}.${c}`];
    note(why ? expected : unexpected, `column ${t}.${c}: Postgres only${why ? ' (' + why + ')' : ''}`);
  }
}
for (const t of Object.keys(pg.tables)) if (!lite.tables[t]) {
  const why = EXPECTED.pgOnlyTables[t];
  note(why ? expected : unexpected, `table ${t}: Postgres only${why ? ' (' + why + ')' : ''}`);
}
for (const i of lite.indexes) if (!pg.indexes.has(i)) note(unexpected, `index ${i}: in SQLite, missing in Postgres`);
for (const i of pg.indexes) if (!lite.indexes.has(i)) {
  const why = EXPECTED.pgOnlyIndexes[i];
  note(why ? expected : unexpected, `index ${i}: Postgres only${why ? ' (' + why + ')' : ''}`);
}
// An EXPECTED entry that no longer applies is also a difference worth knowing about.
for (const t of Object.keys(EXPECTED.pgOnlyTables)) if (!pg.tables[t]) note(unexpected, `expected Postgres-only table ${t} not found in Postgres`);
for (const i of Object.keys(EXPECTED.pgOnlyIndexes)) if (!pg.indexes.has(i)) note(unexpected, `expected Postgres-only index ${i} not found in Postgres`);

const count = o => Object.keys(o).length;
console.log(`SQLite: ${count(lite.tables)} tables, ${lite.indexes.size} explicit indexes (openDatabase)`);
console.log(`Postgres (${pg.source}): ${count(pg.tables)} tables, ${pg.indexes.size} explicit indexes`);
console.log(`\nExpected differences (${expected.length}):`); for (const l of expected) console.log('  ~ ' + l);
console.log(`\nUnexpected differences (${unexpected.length}):`); for (const l of unexpected) console.log('  ! ' + l);
if (unexpected.length) { console.log('\nPARITY FAILED'); process.exit(1); }
console.log('\nPARITY OK (table, column and index names match apart from the expected differences)');
