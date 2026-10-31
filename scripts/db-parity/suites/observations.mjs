// Parity suite: runs one scripted scenario through the real service/query functions and prints what it observed as
// "OBS name {json}" lines. scripts/db-parity/run.mjs --compare diffs the SQLite and Postgres observations.
// Everything is scoped by a per-run token in the company names so a shared Postgres database does not change the answers.
// Cleans up what it inserted into historical_accounts; inquiries/notifications stay (the Postgres cleanup script removes them).
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
register();
const imp = file => import(pathToFileURL(path.join(root, 'lib', 'operations', file)).href);
const database = await imp('database.ts');
await database.ensureReady();
const { db } = database;
const svc = await imp('service.ts'), forms = await imp('forms.ts'), query = await imp('workspace-query.ts'), hist = await imp('historical.ts'), rules = await imp('client-rules.ts'), index = await imp('inquiry-index.ts');
const token = 'Qa' + randomBytes(3).toString('hex').replace(/\d/g, c => 'ghijklmnop'[c]);
const strip = value => JSON.parse(JSON.stringify(value).split(token).join('~'));
const out = (name, value) => console.log('OBS ' + encodeURIComponent(name) + ' ' + JSON.stringify(strip(value)));
const users = await database.allUsers();
const cryssa = users.find(u => u.id === 'cryssa'), admin = users.find(u => u.id === 'admin');

// ---- 1. imports (serial, deterministic): case, punctuation, accent, apostrophe, LIKE metacharacters
const specs = [
  ['A1', `Parity Alpha ${token} Corp`, 'Agent One'], ['A2', `PARITY ALPHA ${token} CORP`, 'Agent Two'], ['A3', `Parity Alpha ${token} Corp.`, 'Agent Three'],
  ['B1', `CafÃ© Ã‘andÃº ${token} Ltd`, 'Agent Four'], ['B2', `cafe nandu ${token} ltd`, 'Agent Five'],
  ['C1', `O'Brien & Sons ${token}, Inc.`, 'Agent Six'], ['D1', `100%_Done ${token} Co`, 'Agent Seven'], ['E1', `Parity Unrelated ${token}`, 'Agent Eight'],
];
const created = {};
for (const [label, company, agent] of specs) {
  const fields = { company, sector: 'Private', agentName: agent, agentEmail: label.toLowerCase() + '.' + token.toLowerCase() + '@example.test', agentPhone: '09171234567', contactName: 'Contact of ' + company, addressee: 'Contact of ' + company, contactEmail: 'c@example.test', division: 'Division ' + (label.charCodeAt(0) % 3 + 1) };
  const record = await svc.intake(cryssa, new File([await forms.sampleForm(fields)], label + '.xlsx'), fields.agentEmail);
  created[label] = record;
}
out('intake.states', Object.fromEntries(Object.entries(created).map(([label, r]) => [label, { state: r.clientReview?.state, matches: (r.clientReview?.matches || []).map(m => Object.entries(created).find(([, c]) => c.id === m.inquiryId)?.[0]) }])));
const ordinal = id => Object.entries(created).find(([, r]) => r.id === id)?.[0] ?? id;
out('intake.numbers', Object.values(created).map(r => Number(r.id.split('-').at(-1))).map((n, i, all) => n - all[0]));

// ---- 2. stored shape: types, key order, timestamps
const stored = await database.inquiry(created.A1.id);
out('stored.shape', { revisionType: typeof stored.revision, createdAtType: typeof stored.createdAt, createdAtIso: /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(stored.createdAt), historyIsArray: Array.isArray(stored.history), fieldsCount: Object.keys(stored.fields).length });
out('stored.fieldKeyOrder(EXPECTED_DIFFERENCE_jsonb)', Object.keys(stored.fields).slice(0, 6));
const counts = await db.get("SELECT COUNT(*) AS n, MAX(revision) AS r FROM inquiries WHERE id=?", created.A1.id);
out('sql.numbers', { nType: typeof counts.n, rType: typeof counts.r, n: Number(counts.n), r: Number(counts.r) });

// ---- 3. workspace listing, sorting, search (SQL paged + JS filters) scoped by the token
const view = async (params, user = admin) => query.workspaceView(user, new URLSearchParams({ search: token, ...params }));
for (const [name, params] of [['inquiries.newest', { view: 'Inquiries' }], ['inquiries.oldest', { view: 'Inquiries', sort: 'oldest' }], ['inquiries.account', { view: 'Inquiries', sort: 'account' }], ['inquiries.updated', { view: 'Inquiries', sort: 'updated' }], ['inquiries.onhold', { view: 'Inquiries', filter: 'Duplicate client' }], ['inquiries.toprepare', { view: 'Inquiries', filter: 'To prepare' }], ['archives', { view: 'Archives' }]]) {
  const w = await view(params);
  out('workspace.' + name, { items: w.inquiries.map(r => ordinal(r.id)), total: w.pagination.total, states: Object.fromEntries(Object.entries(w.clientStates).map(([id, s]) => [ordinal(id), s.state])), tabCounts: w.tabCounts && { all: w.tabCounts.all, onHold: w.tabCounts.onHold, toPrepare: w.tabCounts.toPrepare } });
}
for (const search of ['cafÃ©', 'CAFE', 'nandu', "o'brien", '100%', '_Done', 'parity']) {
  const w = await query.workspaceView(admin, new URLSearchParams({ view: 'Inquiries', search: search + ' ' + token.slice(0, 0) }));
  out('search.' + search, w.inquiries.filter(r => r.fields.company.includes(token)).map(r => ordinal(r.id)));
}

// ---- 4. notifications ordering and counts for one user (all created in the same second)
const notices = await query.workspaceView(cryssa, new URLSearchParams({ view: 'Notifications', search: '' }));
const mine = notices.notifications.filter(n => n.message.includes(token)).map(n => ({ title: n.title, inq: ordinal(n.inquiryId) }));
out('notifications.order', mine);

// ---- 5. historical register: LIKE-free matching, collation of ORDER BY sheet, directory search/sort
const batch = 'qa-parity-' + token;
const accounts = [['Sheet B', 2, `Parity Alpha ${token} Corp`], ['sheet a', 1, `Parity Alpha ${token} Corp`], ['Sheet A', 3, `Parity Alpha ${token} Corp`], ['Ã‰cole ${token}'.replace('${token}', token), 4, `CafÃ© Ã‘andÃº ${token} Ltd`], ['Zeta', 5, `O'Brien & Sons ${token}, Inc.`], ['1 First', 6, `100%_Done ${token} Co`]];
for (const [sheet, row, account] of accounts) {
  await db.run('INSERT INTO historical_accounts (id,batch,sheet,source_row,account,account_key,agent,branch,status,data) VALUES (?,?,?,?,?,?,?,?,?,?)',
    `qa-${token}-${sheet}-${row}`, batch, sheet, row, account, rules.normalizeClient(account), 'QA Agent', 'QA Branch', 'Closed', database.jsonParam({ source: 'qa', plan: '', statusText: 'Closed', remarks: '', dates: [], cells: [] }));
}
try {
  await index.synchronizeInquiryIndex();
  const rows = await db.all('SELECT sheet FROM historical_accounts WHERE batch=? ORDER BY sheet', batch);
  out('hist.sql.order_by_sheet(collation)', rows.map(r => r.sheet.replace(token, '~')));
  const matches = await hist.historicalMatches(await database.inquiry(created.A1.id));
  out('hist.matches.A1', matches.map(m => [m.sheet, m.source_row]));
  const counts2 = await hist.historicalMatchCounts();
  out('hist.matchCounts', Object.fromEntries(Object.entries(created).map(([label, r]) => [label, counts2.get(r.id) || 0])));
  for (const params of [{ search: token }, { search: 'cafÃ© ' + token }, { search: token, sort: 'account' }, { search: token, sheet: 'Sheet A' }]) {
    const d = await hist.directory(new URLSearchParams({ sort: 'account', ...params }));
    out('hist.directory ' + JSON.stringify(params).replace(token, '~'), { total: d.total, items: d.items.map(i => [i.sheet, i.account.replace(token, '~')]), sheets: d.sheets.filter(s => accounts.some(a => a[0] === s)) });
  }
  const first = await db.get('SELECT id FROM historical_accounts WHERE batch=? AND source_row=1', batch);
  out('hist.related.order', (await hist.historicalDetail(first.id)).related.map(r => [r.sheet, r.source_row]));
} finally {
  await db.run('DELETE FROM historical_accounts WHERE batch=?', batch);
}
await db.close?.();
process.exit(0);

