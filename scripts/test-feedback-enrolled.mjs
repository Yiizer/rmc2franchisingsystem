// Feedback item 1 ("Won" becomes "Enrolled", label only). Pure model checks, no browser and no database:
//   node scripts/test-feedback-enrolled.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
const load = async p => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64'));
const { directoryGroups, statusGroup, statusStyles } = await load('lib/operations/directory-model.ts');
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };

await check('The group keeps its key (saved filters and URLs) but reads "Enrolled"', () => {
  assert.ok(Object.hasOwn(directoryGroups, 'won'));
  assert.equal(directoryGroups.won.label, 'Enrolled');
  assert.deepEqual(Object.keys(directoryGroups), ['active', 'won', 'lost', 'notStarted', 'review']);
  assert.ok(!Object.values(directoryGroups).some(group => /\bwon\b/i.test(group.label)), 'no group label says Won');
});

await check('Every source status that maps to the won group is labelled Enrolled', () => {
  const won = Object.keys(statusStyles).filter(key => statusGroup(key) === 'won');
  assert.deepEqual(won.sort(), ['closed', 'sent'], 'closed deal and sent / done are the won statuses');
  for (const key of won) assert.equal(directoryGroups[statusGroup(key)].label, 'Enrolled', key);
  // The other groups are unchanged.
  assert.equal(statusGroup('expired'), 'lost'); assert.equal(statusGroup('disapproved'), 'lost');
  assert.equal(statusGroup('todo'), 'notStarted'); assert.equal(statusGroup('unknown'), 'notStarted');
  assert.equal(statusGroup('review'), 'review'); assert.equal(statusGroup('pending'), 'active');
});

await check('Group counts add up to the total on a seeded mix (counts are unchanged by the rename)', () => {
  const keys = Object.keys(statusStyles), rows = [];
  keys.forEach((key, index) => { for (let i = 0; i <= index; i++) rows.push({ statusKey: key }); }); // 1 of the first status, 2 of the next, ...
  const counts = Object.fromEntries(Object.keys(directoryGroups).map(group => [group, rows.filter(row => statusGroup(row.statusKey) === group).length]));
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
  const expectedWon = rows.filter(row => ['closed', 'sent'].includes(row.statusKey)).length;
  assert.equal(counts.won, expectedWon);
  assert.ok(counts.won > 0);
});

const read = p => readFile(p, 'utf8');
const clients = await read('lib/operations/directory-clients.ts');
await check('Directory rows: historical won statuses and live Sent use the group label', () => {
  assert.match(clients, /statusGroup\(latest\.statusKey\)==='won'\?directoryGroups\.won\.label:statusStyles\[latest\.statusKey\]\.label/);
  assert.match(clients, /r\.status==='Sent'\?directoryGroups\.won\.label:r\.status/);
  assert.match(clients, /statusEvidence/, 'the original status evidence is still carried');
});

await check('Owner status table: a sent proposal reads Enrolled and "Proposal sent" is gone from owner-view', async () => {
  const view = await read('lib/operations/owner-view.ts');
  assert.match(view, /case 'Sent':return 'Enrolled';/);
  assert.ok(!view.includes("'Proposal sent'"));
});

// No screen may still say Won, and Sent must display as Enrolled in the shared status pill and the History tab.
const appFiles = (await readdir('app')).filter(name => /^operations-.*\.tsx$/.test(name));
const sources = Object.fromEntries(await Promise.all(appFiles.map(async name => [name, await read('app/' + name)])));
await check('No operations screen renders the word "Won"', () => {
  for (const [name, text] of Object.entries(sources)) assert.ok(!/>[^<{]*\bWon\b[^<]*</.test(text) && !/['"`]Won['"`]/.test(text), name + ' mentions Won');
});
await check('The status pill, History tab, status filter and owner status colours say Enrolled', () => {
  assert.match(sources['operations-common.tsx'], /statusLabel=\(value:string\)=>value==='Sent'\?'Enrolled':value/);
  assert.match(sources['operations-inquiry-list.tsx'], /label:'Enrolled',view:'History'/);
  assert.match(sources['operations-inquiry-list.tsx'], /statusLabel\(s\)/);
  assert.match(sources['operations-owner-chip.tsx'], /'Enrolled': 'green'/);
});
console.log(checks.length + ' checks passed');
