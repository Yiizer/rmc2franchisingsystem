// Moves the real work from the TEST project to the production project at go-live (PRODUCTION_RUNBOOK.md §4).
// The source is read from ONE read-only snapshot; nothing on the source is changed. The target must be freshly migrated,
// marked environment='production', and hold no inquiries yet.
//
// Left out: fictional inquiries (the same name rules as clear-test-inquiries-online.mjs; anything unclear is listed and
// must be decided with --include/--exclude), demo and check. accounts (@rmc2.local, check.*), sessions, sign-in counters,
// the inbox cursor (a new mailbox starts its own), the index queue (rebuilt), and housekeeping settings. Rows that belong
// to a left-out inquiry or account are left out with it. The audit tables are copied whole.
// Stored files: every file a kept row names (by key, id or hash, as the Admin's sweep decides), copied under the same key
// and checked by SHA-256.
//
// Configuration (env, never printed):
//   SRC_DB_URL                 owner connection to the source
//   SRC_STORAGE=local|supabase with SRC_FILES_DIR, or SRC_SUPABASE_URL, SRC_SUPABASE_KEY, SRC_BUCKET, SRC_PREFIX
//   DST_DB_URL, DST_STORAGE ... the same for the target
// Usage:
//   node scripts/move-to-production.mjs                       plan only: what would be moved and what needs a decision
//   node scripts/move-to-production.mjs --apply [--include INQ-..,..] [--exclude INQ-..,..]
//   rehearsal only: --keep-fictional --keep-demo-accounts (copy everything, to exercise the move on made-up data)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { register } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '..');
const flag = name => process.argv.includes(name), arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const apply = flag('--apply'), keepFictional = flag('--keep-fictional'), keepDemo = flag('--keep-demo-accounts');
const include = new Set(arg('--include').split(',').filter(Boolean)), exclude = new Set(arg('--exclude').split(',').filter(Boolean));
const env = name => (process.env[name] || '').trim();
for (const name of ['SRC_DB_URL', 'DST_DB_URL']) assert.ok(env(name), name + ' is not set');
assert.notEqual(env('SRC_DB_URL'), env('DST_DB_URL'), 'Source and target are the same database');
const local = url => ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
const open = url => postgres(url, { ssl: local(url) ? false : 'require', max: 1, prepare: false, onnotice: () => {}, connect_timeout: 30 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

register();
const store = await import(pathToFileURL(path.join(root, 'lib', 'operations', 'file-store.ts')).href);
const sweep = await import(pathToFileURL(path.join(root, 'lib', 'operations', 'file-sweep.ts')).href);
const storeFor = side => env(side + '_STORAGE') === 'supabase'
  ? store.createFileStore({ kind: 'supabase', url: env(side + '_SUPABASE_URL'), secretKey: env(side + '_SUPABASE_KEY'), bucket: env(side + '_BUCKET'), prefix: env(side + '_PREFIX') || undefined })
  : store.createFileStore({ kind: 'local', root: path.resolve(env(side + '_FILES_DIR') || assert.fail(side + '_FILES_DIR is not set')) });
const srcFiles = storeFor('SRC'), dstFiles = storeFor('DST');

// The same name rules as scripts/clear-test-inquiries-online.mjs.
const FICTIONAL = /\b(QA-PG|Pilot Check|Edge Check|Online Check|Large File Check|Check\b|\[TEST\]|Sample|demo|Sampaguita|Meridian Packaging|Harbor Logistics|Evergreen Services|Pacific Green|Workflow|Storage|Cap \d)/i;
const FICTIONAL_MAIL = /@(?:[\w.-]+\.)?example\.(?:test|com)$|\.example\.test$|@rmc2\.local$/i;
const demoAccount = user => /@rmc2\.local$/i.test(user.email || '') || /^check\./i.test(user.username || user.id || '');
const SKIP_TABLES = new Set(['sessions', 'auth_attempts', 'app_meta', 'inbound_cursor', 'inquiry_index_pending']);
const SKIP_SETTINGS = /^(file-sweep|inbound-health|upload-used:|intake_key:|protection-reminder-slot:)/;
const FIRST = ['users', 'settings', 'counters', 'template_overrides', 'historical_imports', 'historical_accounts', 'inquiries', 'inquiry_summaries', 'inquiry_keys', 'notifications', 'notice_recipients'];
const parse = v => typeof v === 'string' ? JSON.parse(v) : v;

const src = open(env('SRC_DB_URL')), dst = open(env('DST_DB_URL'));
try {
  // ---- target guards ----
  assert.equal((await dst`select value from rmc2.app_meta where key='environment'`)[0]?.value, 'production', 'Refusing: the target is not marked environment=production');
  assert.equal((await dst`select count(*)::int n from rmc2.inquiries`)[0].n, 0, 'Refusing: the target already holds inquiries');

  // ---- read the source from one snapshot ----
  const data = {};
  await src.begin('isolation level repeatable read read only', async tx => {
    for (const { table_name: t } of await tx`select table_name from information_schema.tables where table_schema='rmc2' and table_type='BASE TABLE' order by 1`)
      if (!SKIP_TABLES.has(t)) data[t] = await tx.unsafe(`select * from rmc2."${t}"`);
  });

  // ---- decide what is kept ----
  const inquiries = data.inquiries.map(r => ({ row: r, rec: parse(r.data) }));
  const verdict = ({ rec }) => exclude.has(rec.id) ? 'excluded' : include.has(rec.id) || keepFictional ? 'kept'
    : FICTIONAL.test(rec.fields?.company || '') || FICTIONAL_MAIL.test(rec.fields?.agentEmail || '') ? 'fictional' : 'kept';
  const review = inquiries.filter(i => verdict(i) === 'kept' && !include.has(i.rec.id) && !keepFictional && !(i.rec.fields?.company || '').trim());
  const keptIds = new Set(inquiries.filter(i => verdict(i) === 'kept').map(i => i.rec.id));
  const users = data.users.map(r => ({ row: r, u: parse(r.data) }));
  const keptUsers = new Set(users.filter(x => keepDemo || !demoAccount(x.u)).map(x => x.u.id));
  const byInquiry = (t, col) => (data[t] || []).filter(r => keptIds.has(r[col]));
  const noticeIds = new Set((data.notifications || []).filter(r => keptIds.has(parse(r.data).inquiryId)).map(r => r.id));
  const plan = {
    users: data.users.filter(r => keptUsers.has(r.id)),
    settings: (data.settings || []).filter(r => !SKIP_SETTINGS.test(r.key)),
    inquiries: data.inquiries.filter(r => keptIds.has(r.id)),
    inquiry_summaries: byInquiry('inquiry_summaries', 'id'), inquiry_keys: byInquiry('inquiry_keys', 'inquiry_id'),
    inquiry_activity: byInquiry('inquiry_activity', 'inquiry_id'), inquiry_handover: byInquiry('inquiry_handover', 'inquiry_id'), outbox: byInquiry('outbox', 'inquiry_id'),
    notifications: (data.notifications || []).filter(r => noticeIds.has(r.id)),
    notice_recipients: (data.notice_recipients || []).filter(r => noticeIds.has(r.notice_id) && keptUsers.has(r.user_id)),
    push_subscriptions: (data.push_subscriptions || []).filter(r => keptUsers.has(r.user_id)),
    problem_reports: (data.problem_reports || []).filter(r => keptUsers.has(r.user_id)),
    inbound_messages: (data.inbound_messages || []).filter(r => { const m = parse(r.data); return !m.inquiryId || keptIds.has(m.inquiryId); }),
  };
  for (const t of Object.keys(data)) if (!(t in plan)) plan[t] = data[t]; // counters, templates, the directory, the audit tables, mail_sends …
  const order = [...FIRST.filter(t => t in plan), ...Object.keys(plan).filter(t => !FIRST.includes(t)).sort()];

  // ---- stored files: everything a kept row names ----
  const corpus = order.flatMap(t => plan[t].map(r => JSON.stringify(r))).join('\n').toLowerCase();
  const allKeys = await srcFiles.list('');
  const keys = allKeys.filter(k => k.includes('/') && sweep.SWEPT_FOLDERS.has(k.split('/')[0]) && sweep.isReferenced(k, corpus));
  const plain = keys.concat(allKeys.filter(k => k.startsWith('progress-reports/') && sweep.isReferenced(k, corpus)));

  console.log(`Source: ${data.inquiries.length} inquiries (${keptIds.size} kept, ${data.inquiries.length - keptIds.size} left out), ${data.users.length} accounts (${keptUsers.size} kept), ${plain.length} of ${allKeys.length} stored files`);
  console.log('Tables: ' + order.map(t => `${t} ${plan[t].length}${data[t] && data[t].length !== plan[t].length ? '/' + data[t].length : ''}`).join(', '));
  console.log('Left-out accounts: ' + (users.filter(x => !keptUsers.has(x.u.id)).map(x => x.u.username || x.u.id).join(', ') || 'none'));
  if (review.length) { console.log('NEEDS A DECISION (no company name): ' + review.map(i => i.rec.id).join(', ') + ' — pass --include or --exclude'); }
  if (!apply) { console.log('Plan only: nothing written. Add --apply.'); process.exit(0); }
  assert.equal(review.length, 0, 'Refusing: decide the inquiries listed above first');

  // ---- write the target, in one transaction ----
  await dst.begin(async tx => {
    for (const t of order) for (let i = 0; i < plan[t].length; i += 500)
      await tx.unsafe(`insert into rmc2."${t}" select * from json_populate_recordset(null::rmc2."${t}", $1::text::json) on conflict do nothing`, [JSON.stringify(plan[t].slice(i, i + 500))]);
    // Every kept inquiry is re-indexed by the app on its first index sync (the projection is rebuilt from the rows).
    await tx.unsafe('insert into rmc2.inquiry_index_pending (id) select id from rmc2.inquiries on conflict do nothing');
  });
  for (const key of plain) { const bytes = await srcFiles.get(key); await dstFiles.put(key, bytes, { contentType: 'application/octet-stream', mode: 'replace' }); }

  // ---- verify ----
  const diff = [];
  for (const t of order) { const n = (await dst.unsafe(`select count(*)::int n from rmc2."${t}"`))[0].n; if (n < plan[t].length) diff.push(`${t} ${n}/${plan[t].length}`); }
  assert.deepEqual(diff, [], 'rows missing on the target');
  for (const key of plain) assert.equal(sha(await dstFiles.get(key)), sha(await srcFiles.get(key)), 'file changed in transit: ' + key);
  assert.equal((await dst`select value from rmc2.app_meta where key='environment'`)[0]?.value, 'production');
  console.log(`MOVED and verified: ${order.length} tables (every count at least the plan), ${plain.length} files (every SHA-256 matches); target still environment=production`);
} finally { await src.end({ timeout: 5 }); await dst.end({ timeout: 5 }); }
