// Clears the test emails from the Requests page on the ONLINE TEST version before the real beta (PO 2026-11-13: "yes clear
// the 13 test emails too"). Only the app's own copies (inbound_messages) go; the originals stay in the test mailbox, which the
// app only reads. The inbox cursor is kept, so these emails are never read in again. Their stored attachments go through the
// Admin's "Unused stored files" sweep after its 24-hour wait.
//   node --env-file=.env.supabase.test scripts/clear-test-emails-online.mjs --project-ref pgoiqwixaeqbxlwbmren          list only
//   node --env-file=.env.supabase.test scripts/clear-test-emails-online.mjs --project-ref pgoiqwixaeqbxlwbmren --apply  back up, delete
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const TEST_REF = 'pgoiqwixaeqbxlwbmren';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes('--apply'), url = (process.env.RMC2_DATABASE_ADMIN_URL || '').trim();
assert.equal(arg('--project-ref'), TEST_REF, 'Refusing: test project only.');
assert.ok(url.includes(TEST_REF), 'Refusing: RMC2_DATABASE_ADMIN_URL is not the test project.');
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} });
try {
  assert.equal((await sql`select value from rmc2.app_meta where key='environment'`)[0]?.value, 'test', 'Refusing: the database is not marked test');
  const rows = await sql`select id, received_at, state, data from rmc2.inbound_messages order by received_at`;
  for (const r of rows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    console.log(`${String(r.received_at).slice(0, 16)} | ${(r.state || '').padEnd(9)} | from @${(d.from || '').split('@')[1] || '?'} | ${(d.attachments || []).length} file(s) | ${(d.subject || '').slice(0, 60)}`);
  }
  console.log(`\n${rows.length} emails on Requests`);
  if (!apply) { console.log('List only: nothing deleted. Add --apply.'); process.exit(0); }
  await mkdir('test-results/clear-test-emails', { recursive: true });
  const file = 'test-results/clear-test-emails/backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), inbound: rows }));
  console.log('Backed up ' + rows.length + ' emails to ' + file + ' (git-ignored)');
  const ids = rows.map(r => r.id);
  const deleted = await sql.begin(async tx => {
    const n = (await tx`delete from rmc2.inbound_messages where id = any(${ids})`).count;
    assert.equal(n, ids.length, 'every listed email deleted');
    return n;
  });
  console.log('Deleted ' + deleted + ' emails in one transaction; the inbox cursor is kept.');
} finally { await sql.end({ timeout: 5 }); }
