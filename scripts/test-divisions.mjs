// Unit checks for the branch → division classifier (lib/operations/divisions.ts), plus an optional read-only tally of
// the local historical register:   node scripts/test-divisions.mjs            unit checks only
//                                   node scripts/test-divisions.mjs --local    also tally .data/rmc2.sqlite (read-only)
// The tally prints only place names and counts, never client or agent names.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = path.resolve('test-results/divisions'); await mkdir(out, { recursive: true });
const src = await readFile('lib/operations/divisions.ts', 'utf8');
await writeFile(path.join(out, 'divisions.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { classifyBranch, categoryForSheet, divisionTableProblems, DEFAULT_DIVISION_TABLE, UNASSIGNED } = await import(pathToFileURL(path.join(out, 'divisions.mjs')).href);

const cases = [
  ['Antipolo', 'Division 4', 'Antipolo'], ['DIV IV/ ANTIPOLO', 'Division 4', 'Antipolo'], ['Div IV / Antipolo', 'Division 4', 'Antipolo'],
  ['La Union | Division 4', 'Division 4', 'La Union'], ['La-Union', 'Division 4', 'La Union'], ['lipa 2', 'Division 4', 'Lipa 2'], ['Lipa', 'Division 4', null],
  ['Cebu', 'Division 1', null], ['Cebu-Tanauan', 'Division 1', 'Tanauan'], ['Div II / Baliuag | Valenzuela', 'Division 2', null], ['Baliuag', 'Division 2', 'Baliwag Bulacan'],
  ['QC', 'Division 5', 'Quezon City'], ['Q.C.', 'Division 5', 'Quezon City'], ['Cubao', 'Division 5', 'Cubao'], ['Bicol Branch', 'Division 7', 'Bicol Region'],
  ['Division 6', 'Division 6', null], ['DIV - 6', 'Division 6', null], ['Div VI', 'Division 6', null],
  ['Tacloban', UNASSIGNED, null], ['Gensan', UNASSIGNED, null], ['Bulacan', UNASSIGNED, null], ['T1', UNASSIGNED, null], ['', UNASSIGNED, null],
  ['Tanauan Branch and Lipa 1', UNASSIGNED, null], ['Qc (Cainta)', UNASSIGNED, null], ['IloIlo City | Division 1', UNASSIGNED, null],
];
for (const [text, division, branch] of cases) {
  const got = classifyBranch(text);
  assert.equal(got.division, division, JSON.stringify(text) + ' division: ' + JSON.stringify(got));
  assert.equal(got.branch, branch, JSON.stringify(text) + ' branch: ' + JSON.stringify(got));
}
console.log('PASS ' + cases.length + ' branch spellings map to today\'s table; unknown or mixed-division text stays Unassigned');
const mismatch = classifyBranch('DIV 6 / ANTIPOLO');
assert.equal(mismatch.division, 'Division 4'); assert.equal(mismatch.labelMismatch, true);
console.log('PASS An old division label that disagrees with the branch follows today\'s table and is flagged');
assert.deepEqual(classifyBranch('DIV I / Tanauan-Laguna').unknownPlaces, ['laguna']);
console.log('PASS Unrecognised words inside a known branch are reported for review');
assert.equal(categoryForSheet('SOAMOAAMAPHIL (GOVERNMENT) TEAC'), 'SOA / MOA'); assert.equal(categoryForSheet('DIVISION IV'), 'Division sheets');
assert.equal(categoryForSheet('LIST OF COMPLETED ACCOUNTS (AMA'), 'Completed accounts'); assert.equal(categoryForSheet('AMAPHIL'), 'AMAPHIL');
console.log('PASS Register sheets map to directory categories');
assert.deepEqual(divisionTableProblems(DEFAULT_DIVISION_TABLE), []);
const broken = structuredClone(DEFAULT_DIVISION_TABLE); broken.divisions[1].branches.push({ name: 'Antipolo', aliases: [] });
assert.ok(divisionTableProblems(broken).length > 0);
console.log('PASS The default table is consistent; a duplicate branch is rejected');

if (process.argv.includes('--local')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.resolve('.data/rmc2.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT branch, sheet, COUNT(*) n FROM historical_accounts GROUP BY branch, sheet').all();
  const perDivision = new Map(), unassigned = new Map(), mismatches = new Map();
  for (const row of rows) {
    const c = classifyBranch(row.branch || '');
    perDivision.set(c.division, (perDivision.get(c.division) || 0) + row.n);
    if (c.division === UNASSIGNED) { const key = (row.branch || '(blank)') + ' [' + c.basis + ']'; unassigned.set(key, (unassigned.get(key) || 0) + row.n); }
    if (c.labelMismatch) mismatches.set(row.branch, (mismatches.get(row.branch) || 0) + row.n);
  }
  console.log('\nRecords per division:'); for (const [d, n] of [...perDivision].sort()) console.log('  ' + d.padEnd(12) + n);
  console.log('\nUnassigned spellings (top 40):'); for (const [k, n] of [...unassigned].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log('  ' + String(n).padStart(4) + '  ' + k);
  console.log('\nLabel disagrees with branch (today\'s table used):'); for (const [k, n] of [...mismatches].sort((a, b) => b[1] - a[1])) console.log('  ' + String(n).padStart(4) + '  ' + k);
}
