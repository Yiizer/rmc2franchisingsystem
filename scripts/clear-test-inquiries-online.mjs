// Clears the fictional test inquiries from the ONLINE TEST version before the real beta (PO 2026-11-13: "Yes, delete them").
// Staff start real work there on 2026-11-16, so they must not see test records. Kept: the historical client directory,
// accounts, settings, active templates, email send counts and the append-only audit tables (file_access, security_events,
// historical_*). Stored files are left; the Admin's "Unused stored files" sweep removes them after its 24-hour wait.
//   node --env-file=.env.supabase.test scripts/clear-test-inquiries-online.mjs --project-ref pgoiqwixaeqbxlwbmren          list only
//   node --env-file=.env.supabase.test scripts/clear-test-inquiries-online.mjs --project-ref pgoiqwixaeqbxlwbmren --apply  back up, delete
// --apply refuses if any inquiry does not look fictional (listed as REVIEW), unless its id is passed with --also <id,...>.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes('--apply'), also = new Set((arg('--also') || '').split(',').filter(Boolean));
const url = (process.env.RMC2_DATABASE_ADMIN_URL || '').trim();
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only.');
assert.ok(url.includes(TEST_REF), 'Refusing: RMC2_DATABASE_ADMIN_URL is not the test project.');
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });

// Names used by every test script and demo seed so far. Anything else is listed for a person to look at.
const FICTIONAL = /\b(QA-PG|Pilot Check|Edge Check|Online Check|Large File Check|Check\b|\[TEST\]|Sample|demo|Sampaguita|Meridian Packaging|Harbor Logistics|Evergreen Services|Pacific Green|Workflow|Storage|Cap \d)/i;
const FICTIONAL_MAIL = /@(?:[\w.-]+\.)?example\.(?:test|com)$|\.example\.test$|@rmc2\.local$/i;

try {
  const env = (await sql`select value from rmc2.app_meta where key='environment'`)[0]?.value;
  assert.equal(env, 'test', 'Refusing: the database is not marked test');
  const rows = await sql`select id, data->'fields'->>'company' company, data->'fields'->>'agentEmail' agent, data->>'status' status, data->>'createdAt' created, data->'source'->>'origin' origin from rmc2.inquiries order by id`;
  const verdict = r => FICTIONAL.test(r.company || '') || FICTIONAL_MAIL.test(r.agent || '') ? 'fictional' : also.has(r.id) ? 'fictional (--also)' : 'REVIEW';
  for (const r of rows) console.log(`${r.id} | ${(r.company || '').slice(0, 44).padEnd(44)} | ${(r.status || '').padEnd(26)} | ${String(r.created).slice(0, 10)} | ${r.origin || ''} | ${verdict(r)}`);
  const review = rows.filter(r => verdict(r) === 'REVIEW');
  const retired = await sql`select id, data->>'name' as name, data->>'active' active from rmc2.template_overrides where coalesce(data->>'active','true')='false' and data->>'name' ilike '%check%'`;
  console.log(`\n${rows.length} inquiries, ${rows.length - review.length} fictional, ${review.length} to review` + (review.length ? ': ' + review.map(r => r.id).join(', ') : ''));
  console.log('Retired check templates: ' + (retired.map(t => t.name + ' (' + t.id + ')').join(', ') || 'none'));
  const inbound = (await sql`select count(*)::int n from rmc2.inbound_messages`)[0].n;
  console.log('Requests (inbound emails) on TEST: ' + inbound + ' (not touched by this script)');
  if (!apply) { console.log('List only: nothing deleted. Add --apply.'); process.exit(0); }
  assert.equal(review.length, 0, 'Refusing: some inquiries do not look fictional; check them, then pass --also <ids>');

  const ids = rows.map(r => r.id);
  const backup = { at: new Date().toISOString(), inquiries: [], notifications: [], templates: [] };
  backup.inquiries = (await sql`select id, revision, data from rmc2.inquiries where id = any(${ids})`);
  backup.notifications = (await sql`select id, data from rmc2.notifications where data->>'inquiryId' = any(${ids})`);
  backup.templates = (await sql`select id, data from rmc2.template_overrides where id = any(${retired.map(t => t.id)})`);
  await mkdir('test-results/clear-test-inquiries', { recursive: true });
  const file = 'test-results/clear-test-inquiries/backup-' + backup.at.replace(/[:.]/g, '-') + '.json';
  await writeFile(file, JSON.stringify(backup));
  console.log('Backed up ' + backup.inquiries.length + ' inquiries, ' + backup.notifications.length + ' notifications, ' + backup.templates.length + ' templates to ' + file + ' (git-ignored)');

  const counts = await sql.begin(async tx => {
    const n = {};
    const noticeIds = (await tx`select id from rmc2.notifications where data->>'inquiryId' = any(${ids})`).map(r => r.id);
    n.notice_recipients = (await tx`delete from rmc2.notice_recipients where notice_id = any(${noticeIds})`).count;
    n.notifications = (await tx`delete from rmc2.notifications where id = any(${noticeIds})`).count;
    for (const [table, column] of [['inquiry_activity', 'inquiry_id'], ['inquiry_handover', 'inquiry_id'], ['inquiry_keys', 'inquiry_id'], ['outbox', 'inquiry_id'], ['inquiry_summaries', 'id'], ['inquiry_index_pending', 'id']])
      n[table] = (await tx.unsafe(`delete from rmc2.${table} where ${column} = any($1)`, [ids])).count;
    n.inquiries = (await tx`delete from rmc2.inquiries where id = any(${ids})`).count;
    n.template_overrides = (await tx`delete from rmc2.template_overrides where id = any(${retired.map(t => t.id)})`).count;
    assert.equal(n.inquiries, ids.length, 'every listed inquiry deleted');
    assert.equal(n.notifications, noticeIds.length, 'every linked notification deleted');
    const left = (await tx`select count(*)::int n from rmc2.inquiries`)[0].n;
    assert.equal(left, 0, 'no inquiries left');
    return n;
  });
  console.log('Deleted in one transaction: ' + JSON.stringify(counts));
} finally { await sql.end({ timeout: 5 }); }
