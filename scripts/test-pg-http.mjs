// Phase 4 QA: HTTP-level Postgres checks against TWO `next start` instances (5190 + 5191, same TEST database).
//   T3  parallel saves / approvals / retries across instances; the outbox is claimed once
//   T4  last-approver demotion race
//   T5  login rate limit under 100 parallel wrong passwords
//   T6h lock-timeout 503 reaches the user with no internal detail
//   T8  snapshot endpoints are not torn by concurrent writers
//   T10 cross-instance cache invalidation (workspace cursor / unchanged:true) and jsonb quirks (key order, NUL)
// Launch with the scratchpad runner so the servers exist: node run-pgn.mjs scripts/test-pg-http.mjs <runId> --n 2
// Needs RMC2_TEST_URL and RMC2_TEST_URL2 (both localhost 5190-5199) and the TEST database URL (env or .env.supabase.test).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { client, createChecks, databaseUrl, formBytes, intakeForm, maskText, require, root, sleep, uniq } from './db-parity/lib.mjs';

const urlA = process.env.RMC2_TEST_URL, urlB = process.env.RMC2_TEST_URL2;
for (const u of [urlA, urlB]) if (!/^http:\/\/127\.0\.0\.1:519\d$/.test(u || '')) throw new Error('Use isolated localhost QA instances on 5190-5199.');
assert.notEqual(urlA, urlB, 'This script needs two instances (run-pgn.mjs --n 2).');
const only = process.argv.slice(2).filter(a => /^T\d+h?$/.test(a));
const wants = id => !only.length || only.includes(id);
const A = client(urlA), B = client(urlB);
const { check, finish } = createChecks();
const run = uniq();
const pgmod = await import('file:///' + require.resolve('postgres').replace(/\\/g, '/'));
const postgres = pgmod.default ?? pgmod;
const sql = postgres(databaseUrl(), { ssl: 'require', max: 4, prepare: false, connect_timeout: 15, onnotice: () => {}, idle_timeout: 10 });
const who = ['admin', 'cryssa', 'jefferson', 'judy', 'emerson', 'zeo'];
const pw = 'Rmc2Local!2026';
const loginAll = async () => { for (const id of who) { const r = await A.login(id); assert.equal(r.status, 200, 'login ' + id + ' ' + r.status); B.sessions[id] = A.sessions[id]; } };
await loginAll();
const sides = [A, B];
const pick = i => sides[i % 2];

async function newInquiry(identity, by = 'cryssa', extra = {}) {
  const bytes = await formBytes(A.base, A.sessions[by], identity, extra);
  const r = await A.call(by, 'intake', intakeForm(bytes, `agent.${uniq()}@example.test`), 201);
  return r.value.inquiry;
}
const startHandling = (c, id, by, tab) => c.call(by, `inquiries/${id}/activity`, { tab, action: 'start' }, 200);
async function prepareSubmitted(identity) {
  let record = await newInquiry(identity);
  const tab = randomUUID();
  await startHandling(A, record.id, 'cryssa', tab);
  record = (await A.call('cryssa', `inquiries/${record.id}/save`, { revision: record.revision, fields: { ...record.fields, employeeAges: '25–58', dependents: '0', payment: 'Annual' }, templateId: 'd024', notes: '', email: record.email, emailOverrides: [] }, 200)).value.inquiry;
  record = (await A.call('cryssa', `inquiries/${record.id}/generate`, { revision: record.revision }, 200)).value.inquiry;
  record = (await A.call('cryssa', `inquiries/${record.id}/submit`, { revision: record.revision }, 200)).value.inquiry;
  assert.equal(record.status, 'Awaiting approval');
  return record;
}
const inquiryRow = async id => (await sql`select data from inquiries where id=${id}`)[0].data;
const tally = rs => rs.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});

// ================================================================== T3
if (wants('T3')) {
  await check('T3 parallel saves of one revision from both instances: one 200, the rest 409, revision +1', async () => {
    let record = await newInquiry('QA-PG T3 saves ' + run);
    const tab = randomUUID();
    await startHandling(A, record.id, 'cryssa', tab);
    const body = n => ({ revision: record.revision, fields: { ...record.fields, company: record.fields.company + ' v' + n }, templateId: record.templateId, notes: 'n' + n, email: record.email, emailOverrides: record.emailOverrides });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => pick(i).raw('cryssa', `inquiries/${record.id}/save`, body(i)).then(async r => ({ status: r.status, body: await r.json() }))));
    const t = tally(rs);
    assert.equal(t[200], 1, JSON.stringify(t)); assert.equal(t[409], 9, JSON.stringify(t));
    assert.equal((await inquiryRow(record.id)).revision, record.revision + 1);
    return JSON.stringify(t);
  });
  let sub1, sub2;
  await check('T3 prepare two submitted proposals through the real flow (generate PDF with LibreOffice, submit)', async () => {
    sub1 = await prepareSubmitted('QA-PG T3 approve ' + run);
    sub2 = await prepareSubmitted('QA-PG T3 retry ' + run);
    return sub1.id + ', ' + sub2.id;
  });
  await check('T3 10 parallel approvals (both supervisors, both instances): exactly one wins, delivery recorded once, one outbox row, one notice', async () => {
    const order = [['emerson', 0], ['zeo', 1], ['zeo', 0], ['emerson', 1], ['emerson', 0], ['zeo', 1], ['zeo', 0], ['emerson', 1], ['emerson', 0], ['zeo', 1]];
    const rs = await Promise.all(order.map(([user, side]) => sides[side].raw(user, `inquiries/${sub1.id}/decision`, { revision: sub1.revision, version: 1, action: 'approve', note: '', flags: [] }).then(async r => ({ status: r.status, body: await r.json() }))));
    const t = tally(rs);
    assert.equal(t[200], 1, JSON.stringify(t) + ' ' + JSON.stringify(rs.filter(r => r.status !== 200 && r.status !== 409).map(r => r.body)));
    assert.equal(t[409], 9, JSON.stringify(t));
    const data = await inquiryRow(sub1.id);
    assert.equal(data.status, 'Sent'); assert.ok(data.submissions[0].delivery, 'delivery recorded');
    const outbox = await sql`select id,status from outbox where inquiry_id=${sub1.id}`;
    assert.equal(outbox.length, 1); assert.equal(outbox[0].status, 'sent');
    const delivered = data.history.filter(h => /delivered to the local test mailbox/.test(h.action));
    assert.equal(delivered.length, 1, 'delivery history entries: ' + delivered.length);
    const notices = await sql`select count(*)::int n from notifications where data->>'inquiryId'=${sub1.id} and data->>'title'='Approved reply sent — local test'`;
    assert.equal(notices[0].n, 1);
    assert.equal(data.history.filter(h => /^Approved proposal v1 — automatic/.test(h.action)).length, 1, 'one approval audit entry');
    return JSON.stringify(t);
  });
  await check('T3 outbox claimed once: failed send, then 10 parallel Retry clicks from both instances -> one delivery', async () => {
    const approved = (await A.call('emerson', `inquiries/${sub2.id}/decision`, { revision: sub2.revision, version: 1, action: 'approve', note: '', flags: [], failSend: true }, 200)).value.inquiry;
    assert.equal(approved.status, 'Approved — email failed');
    const outboxBefore = await sql`select id,status from outbox where inquiry_id=${sub2.id}`;
    assert.deepEqual(outboxBefore.map(r => r.status), ['failed']);
    const users = ['jefferson', 'cryssa', 'emerson', 'zeo', 'judy'];
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => pick(i).raw(users[i % users.length], `inquiries/${sub2.id}/retry`, { revision: approved.revision }).then(async r => ({ status: r.status, body: await r.json() }))));
    const t = tally(rs);
    assert.equal(t[200], 1, JSON.stringify(t) + ' ' + JSON.stringify(rs.filter(r => r.status !== 200 && r.status !== 409).map(r => r.body)));
    assert.equal(t[409], 9, JSON.stringify(t));
    const data = await inquiryRow(sub2.id);
    assert.equal(data.status, 'Sent');
    const outbox = await sql`select id,status from outbox where inquiry_id=${sub2.id}`;
    assert.equal(outbox.length, 1); assert.equal(outbox[0].status, 'sent');
    assert.equal(data.history.filter(h => /delivered to the local test mailbox/.test(h.action)).length, 1);
    return JSON.stringify(t) + ' ' + JSON.stringify(rs.filter(r => r.status === 409).map(r => r.body.error.slice(0, 40)).filter((v, i, a) => a.indexOf(v) === i));
  });
}

// ================================================================== T4
if (wants('T4')) {
  const state = async () => (await sql`select id, data from users where id in ('emerson','zeo')`).map(r => ({ id: r.id, role: r.data.role, active: r.data.active, canApprove: r.data.canApprove }));
  const restore = async () => { for (const id of ['emerson', 'zeo']) await A.call('admin', 'users', { id, active: true, role: 'Supervisor', canApprove: true }, 200); };
  await check('T4 last-approver race: two admins demote the only two approving supervisors at the same time, 8 rounds x (both instances)', async () => {
    const outcomes = [];
    for (let round = 0; round < 8; round++) {
      await restore();
      const variants = [
        [{ id: 'emerson', active: true, role: 'Employee', canApprove: false }, { id: 'zeo', active: true, role: 'Employee', canApprove: false }],
        [{ id: 'emerson', active: false, role: 'Supervisor', canApprove: true }, { id: 'zeo', active: false, role: 'Supervisor', canApprove: true }],
        [{ id: 'emerson', active: true, role: 'Supervisor', canApprove: false }, { id: 'zeo', active: true, role: 'Employee', canApprove: false }],
        [{ id: 'emerson', active: true, role: 'Supervisor', canApprove: false }, { id: 'zeo', active: false, role: 'Supervisor', canApprove: true }],
      ][round % 4];
      const rs = await Promise.all(variants.map((v, i) => sides[(round + i) % 2].raw('admin', 'users', v).then(async r => ({ status: r.status, body: await r.json() }))));
      const t = tally(rs);
      assert.equal(t[200], 1, `round ${round}: ${JSON.stringify(t)} ${JSON.stringify(rs.map(r => r.body))}`);
      assert.equal(t[400], 1, `round ${round}: ${JSON.stringify(t)}`);
      assert.match(rs.find(r => r.status === 400).body.error, /at least one active approving supervisor/);
      const left = (await state()).filter(u => u.active && u.canApprove && u.role === 'Supervisor');
      assert.equal(left.length, 1, `round ${round}: approving supervisors left: ${left.length}`);
      outcomes.push('ok');
    }
    await restore();
    const after = await state(); assert.ok(after.every(u => u.active && u.canApprove));
    await loginAll();
    return outcomes.length + ' rounds, always exactly one approving supervisor left';
  });
}

// ================================================================== T5
if (wants('T5')) {
  const keyOf = email => 'login:' + createHash('sha256').update(email.toLowerCase()).digest('hex');
  const clearKey = async email => { await sql`delete from auth_attempts where key=${keyOf(email)}`; };
  const flood = async (email, n, password = 'definitely-wrong-' + uniq()) => {
    const started = Date.now();
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => fetch(pick(i).api + 'login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(async r => ({ status: r.status, ms: Date.now() - started, body: await r.json().catch(() => ({})) }))));
    return { rs, t: tally(rs), ms: Date.now() - started };
  };
  await check('T5 100 parallel wrong passwords for an unknown account across both instances: at most 8 verified (401), the rest 429', async () => {
    const email = `qa-nobody-${run}@rmc2.local`;
    const { t, ms } = await flood(email, 100);
    assert.ok((t[401] || 0) <= 8, 'verified attempts: ' + JSON.stringify(t));
    assert.equal((t[401] || 0) + (t[429] || 0), 100, JSON.stringify(t));
    assert.ok((t[429] || 0) >= 92);
    const row = (await sql`select failures, blocked_until from auth_attempts where key=${keyOf(email)}`)[0];
    assert.ok(row && Number(row.blocked_until) > Date.now(), 'the block is recorded');
    await clearKey(email);
    return JSON.stringify(t) + ' in ' + ms + ' ms';
  });
  await check('T5 real account: 100 parallel wrong passwords block it (even the right password gets 429), other accounts unaffected, unblocking restores sign-in', async () => {
    const { t } = await flood('judy@rmc2.local', 100);
    assert.ok((t[401] || 0) <= 8, JSON.stringify(t));
    const right = await A.login('judy'); assert.equal(right.status, 429, 'blocked account: right password still refused');
    assert.equal((await B.login('cryssa')).status, 200, 'another account can still sign in');
    await clearKey('judy@rmc2.local');
    assert.equal((await A.login('judy')).status, 200, 'works after the block is cleared');
    return JSON.stringify(t);
  });
  await check('T5 settings password check shares the limit: 40 parallel wrong "current password" attempts -> at most 8 reach the check', async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => pick(i).raw('jefferson', 'account-settings', { username: 'jefferson', currentPassword: 'wrong-' + uniq() }).then(r => ({ status: r.status }))));
    const t = tally(rs);
    assert.ok((t[403] || 0) <= 8, JSON.stringify(t)); assert.equal((t[403] || 0) + (t[429] || 0), 40, JSON.stringify(t));
    await sql`delete from auth_attempts where key='settings:jefferson'`;
    return JSON.stringify(t);
  });
  await check('T5 a successful sign-in clears the failure counter (7 wrong, then right, then 7 wrong again are all verified)', async () => {
    const email = 'zeo@rmc2.local';
    for (let i = 0; i < 7; i++) assert.equal((await A.raw('x', 'login', { email, password: 'bad' + i })).status, 401);
    assert.equal((await A.login('zeo')).status, 200);
    for (let i = 0; i < 7; i++) assert.equal((await B.raw('x', 'login', { email, password: 'bad' + i })).status, 401, 'attempt ' + i);
    assert.equal((await B.login('zeo')).status, 200); await clearKey(email);
  });
}

// ================================================================== T6h
if (wants('T6h')) {
  await check('T6h lock timeout while a client key is held elsewhere: HTTP 503, generic text, no connection/SQL detail, number given back', async () => {
    register();
    const { clientIdentityKeys } = await import(pathToFileURL(path.join(root, 'lib', 'operations', 'client-rules.ts')).href);
    const identity = 'QA-PG T6 held ' + run;
    const first = await newInquiry(identity);
    const keys = clientIdentityKeys(first).map(([k, v]) => `ck:${k}:${v}`).sort();
    assert.ok(keys.length);
    const counterBefore = Number((await sql`select n from counters where name='inquiry'`)[0].n);
    let release; const hold = new Promise(r => { release = r; });
    let locked; const lockedP = new Promise(r => { locked = r; });
    const holder = sql.begin(async tx => { for (const k of keys) await tx`select pg_advisory_xact_lock(hashtextextended(${k},0))`; locked(); await hold; });
    await lockedP;
    const bytes = await formBytes(A.base, A.sessions.jefferson, identity);
    const started = Date.now();
    const r = await A.raw('jefferson', 'intake', intakeForm(bytes, `agent.${uniq()}@example.test`));
    const ms = Date.now() - started; const text = await r.text();
    release(); await holder;
    assert.equal(r.status, 503, text); assert.ok(ms >= 4500 && ms < 9000, 'took ' + ms + ' ms');
    assert.ok(!/postgres|rmc2|pooler|supabase|6543|SQLSTATE|55P03|lock timeout|advisory|pg_|select |insert |at async|node_modules/i.test(text), 'leaked detail: ' + text);
    assert.equal(Number((await sql`select n from counters where name='inquiry'`)[0].n), counterBefore);
    const ok = await A.raw('jefferson', 'intake', intakeForm(bytes, `agent.${uniq()}@example.test`)); assert.equal(ok.status, 201, 'works again once the lock is free');
    return `503 after ${ms} ms, body ${JSON.stringify(JSON.parse(text))}`;
  });
  await check('T6h hostile text in a failing request never reveals internals (bad route, bad JSON, bad id)', async () => {
    for (const [route, body] of [['inquiries/%27%3B%20DROP%20TABLE%20inquiries--/save', { revision: 1 }], ['inquiries/INQ-0000-00000/activity', { tab: 'x', action: 'start' }], ['login', { email: "a' OR 1=1 --", password: 'x' }]]) {
      const r = await A.raw('cryssa', route, body); const text = await r.text();
      assert.ok(r.status >= 400 && r.status < 500, route + ' -> ' + r.status + ' ' + text.slice(0, 120));
      assert.ok(!/postgres|rmc2_app|syntax error|SQLSTATE|column|relation/i.test(text), route + ' leaked: ' + text.slice(0, 200));
    }
    assert.equal((await A.raw('cryssa', 'inquiries/%27%3B%20DROP%20TABLE%20inquiries--')).status, 404);
    assert.ok(Number((await sql`select count(*)::int n from inquiries`)[0].n) > 0, 'inquiries table still exists');
  });
}

// ================================================================== T8
if (wants('T8')) {
  await check('T8 snapshot endpoints under a concurrent two-table writer for 14 s (both instances): bootstrap and workspace never show a notice newer/older than the inquiry revision', async () => {
    const rec = await newInquiry('QA-PG T8b torn ' + run);
    const id = rec.id, baseRevision = Number((await sql`select revision from inquiries where id=${id}`)[0].revision);
    const baseTotal = (await A.call('admin', 'workspace?view=Notifications', undefined, 200)).value.noticePagination.total;
    let stop = false, writes = 0;
    const stats = { bootstrap: { n: 0, torn: 0, sample: '' }, workspace: { n: 0, torn: 0, sample: '' }, rawAuto: { n: 0, torn: 0 }, rawSnapshot: { n: 0, torn: 0 } };
    const writer = (async () => {
      while (!stop) {
        await sql.begin(async tx => {
          const [r] = await tx`update inquiries set revision=revision+1, data=jsonb_set(data,'{revision}',to_jsonb(revision+1)) where id=${id} returning revision`;
          const k = r.revision - baseRevision;
          await tx`insert into notifications(id,data) values (${'qa-torn-' + run + '-' + k}, ${sql.json({ id: 'qa-torn-' + run + '-' + k, inquiryId: id, title: 'qa-torn', message: 'k=' + k, at: new Date().toISOString(), recipientIds: ['admin'], readBy: [] })})`;
        });
        writes++; await sleep(40);
      }
    })();
    const reader = c => (async () => { while (!stop) {
      const b = (await c.call('admin', 'bootstrap', undefined, 200)).value;
      const r = b.inquiries.find(x => x.id === id); const ks = b.notifications.filter(n => n.inquiryId === id && n.title === 'qa-torn').map(n => Number(n.message.slice(2)));
      const maxK = ks.length ? Math.max(...ks) : 0; stats.bootstrap.n++;
      if (maxK !== r.revision - baseRevision) { stats.bootstrap.torn++; stats.bootstrap.sample ||= `rev ${r.revision - baseRevision} vs notice ${maxK}`; }
    } })();
    const readerW = c => (async () => { while (!stop) {
      const w = (await c.call('admin', 'workspace?view=Notifications', undefined, 200)).value;
      const ks = w.notifications.filter(n => n.inquiryId === id && n.title === 'qa-torn').map(n => Number(n.message.slice(2)));
      const maxK = ks.length ? Math.max(...ks) : 0; stats.workspace.n++;
      if (maxK !== w.noticePagination.total - baseTotal) { stats.workspace.torn++; stats.workspace.sample ||= `total-base ${w.noticePagination.total - baseTotal} vs list ${maxK}`; }
    } })();
    const rawAuto = (async () => { while (!stop) { const [r] = await sql`select revision from inquiries where id=${id}`; const [n] = await sql`select count(*)::int c from notifications where data->>'inquiryId'=${id} and data->>'title'='qa-torn'`; stats.rawAuto.n++; if (n.c !== r.revision - baseRevision) stats.rawAuto.torn++; } })();
    const rawSnap = (async () => { while (!stop) { await sql.begin('isolation level repeatable read read only', async tx => { const [r] = await tx`select revision from inquiries where id=${id}`; const [n] = await tx`select count(*)::int c from notifications where data->>'inquiryId'=${id} and data->>'title'='qa-torn'`; stats.rawSnapshot.n++; if (n.c !== r.revision - baseRevision) stats.rawSnapshot.torn++; }); } })();
    const readers = [reader(A), reader(B), readerW(A), readerW(B), rawAuto, rawSnap];
    await sleep(14000); stop = true;
    await Promise.all([writer, ...readers]);
    const summary = `writes ${writes}; bootstrap ${stats.bootstrap.torn}/${stats.bootstrap.n} torn; workspace ${stats.workspace.torn}/${stats.workspace.n} torn; control autocommit reader ${stats.rawAuto.torn}/${stats.rawAuto.n} torn; control repeatable-read reader ${stats.rawSnapshot.torn}/${stats.rawSnapshot.n} torn`;
    assert.ok(writes > 10, 'writer ran: ' + summary);
    assert.equal(stats.rawSnapshot.torn, 0, summary);
    assert.equal(stats.bootstrap.torn, 0, summary + ' ' + stats.bootstrap.sample);
    assert.equal(stats.workspace.torn, 0, summary + ' ' + stats.workspace.sample);
    return summary + (stats.rawAuto.torn === 0 ? ' (NOTE: the control autocommit reader saw no tearing, so test sensitivity is weak)' : '');
  });
}

// ================================================================== T10
if (wants('T10')) {
  const poll = (c, who, view = 'Inquiries', extra = '') => c.call(who, `workspace?view=${encodeURIComponent(view)}${extra}`, undefined, 200).then(r => r.value);
  const again = (c, who, w, view = 'Inquiries') => poll(c, who, view, `&cursor=${w.cursor}&metadataVersion=${encodeURIComponent(w.metadataVersion)}`);
  let w0;
  await check('T10 instance B: first poll, then the same cursor answers unchanged:true (shared deployment id => same cursor space)', async () => {
    w0 = await poll(B, 'admin');
    assert.ok(w0.cursor && w0.metadataVersion);
    const same = await again(B, 'admin', w0); assert.equal(same.unchanged, true);
    const cross = await again(A, 'admin', w0); assert.equal(cross.unchanged, true, 'instance A accepts the cursor B issued (same deployment id, same database stamps)');
  });
  let created;
  await check('T10 a write on A (new inquiry) is in B\'s very next poll; the old cursor is no longer "unchanged"; the new one is', async () => {
    created = await newInquiry('QA-PG T10 cache ' + run);
    const next = await again(B, 'admin', w0);
    assert.ok(!next.unchanged, 'B must not answer unchanged after A wrote');
    assert.ok(next.inquiries.some(r => r.id === created.id), 'B lists the inquiry A just created');
    const settled = await again(B, 'admin', next); assert.equal(settled.unchanged, true, 'quiet again -> unchanged');
    w0 = next;
  });
  await check('T10 20 alternating writes on A / reads on B: every write is visible at the next poll (zero staleness)', async () => {
    const tab = randomUUID(); await startHandling(A, created.id, 'cryssa', tab);
    let record = (await A.call('cryssa', `inquiries/${created.id}`, undefined, 200)).value.inquiry; const stale = [];
    for (let i = 0; i < 20; i++) {
      record = (await A.call('cryssa', `inquiries/${record.id}/save`, { revision: record.revision, fields: { ...record.fields, branch: 'Br' + i }, templateId: '', notes: 'n' + i, email: record.email, emailOverrides: record.emailOverrides }, 200)).value.inquiry;
      const w = await poll(B, 'admin', 'Inquiries'); const row = w.inquiries.find(r => r.id === record.id);
      const d = (await B.call('admin', `inquiries/${record.id}`, undefined, 200)).value.inquiry;
      if (row?.revision !== record.revision || d.revision !== record.revision || d.fields.branch !== 'Br' + i) stale.push(`${i}: list ${row?.revision} detail ${d.revision} expected ${record.revision}`);
    }
    await A.call('cryssa', `inquiries/${record.id}/activity`, { tab, action: 'leave' }, 200);
    assert.deepEqual(stale, []);
  });
  await check('T10 notifications: marking read on A shows on B\'s next poll (unreadCount drops)', async () => {
    const before = await poll(B, 'cryssa', 'Notifications'); assert.ok(before.unreadCount > 0);
    await A.call('cryssa', 'notifications', { all: true }, 200);
    const after = await poll(B, 'cryssa', 'Notifications'); assert.equal(after.unreadCount, 0);
    assert.ok(after.notifications.every(n => n.readBy.includes('cryssa')));
  });
  await check('T10 notifications mark-read does not duplicate readBy (repeat, parallel from both instances)', async () => {
    await newInquiry('QA-PG T10 notices ' + run);
    await Promise.all(Array.from({ length: 6 }, (_, i) => pick(i).call('judy', 'notifications', { all: true }, 200)));
    const dup = await sql`select id from notifications where jsonb_array_length(data->'readBy') <> (select count(distinct v) from jsonb_array_elements_text(data->'readBy') v)`;
    assert.deepEqual(dup.map(r => r.id), []);
  });
  await check('T10 metadata change on A (staff list) invalidates B\'s metadataVersion and ships the new users', async () => {
    const wm = await poll(B, 'admin'); const m1 = wm.metadataVersion;
    await A.call('admin', 'users', { id: 'jefferson', active: true, role: 'Employee', canApprove: false }, 200);
    B.sessions.jefferson = (await A.login('jefferson')) && A.sessions.jefferson;
    const next = await again(B, 'admin', wm);
    assert.ok(!next.unchanged); assert.notEqual(next.metadataVersion, m1); assert.ok(Array.isArray(next.users) && next.users.length === 6);
  });
  await check('T10 jsonb quirk: key order of stored fields is normalised (record it) and the app does not depend on it for the fingerprint', async () => {
    const api = (await A.call('admin', `inquiries/${created.id}`, undefined, 200)).value.inquiry;
    const fromDb = (await sql`select data->'fields' as f from inquiries where id=${created.id}`)[0].f;
    const apiKeys = Object.keys(api.fields), createKeys = Object.keys(created.fields);
    const sortedByLen = [...apiKeys].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    assert.deepEqual(apiKeys, Object.keys(fromDb));
    const reordered = JSON.stringify(apiKeys) !== JSON.stringify(createKeys);
    return `intake-time order ${createKeys.slice(0, 4).join(',')}…; stored order ${apiKeys.slice(0, 4).join(',')}…; reordered=${reordered}; stored order is jsonb canonical (length, then bytes)=${JSON.stringify(apiKeys) === JSON.stringify(sortedByLen)}`;
  });
  await check('T10 jsonb quirk: NUL (\\u0000) in free text is accepted and stripped, not a 500 (save notes, chat question, decline reason)', async () => {
    const rec = await newInquiry('QA-PG T10 nul ' + run); const tab = randomUUID();
    await startHandling(A, rec.id, 'cryssa', tab);
    const saved = (await A.call('cryssa', `inquiries/${rec.id}/save`, { revision: rec.revision, fields: { ...rec.fields, branch: 'Br\u0000anch' }, templateId: '', notes: 'a\u0000b', email: rec.email, emailOverrides: [] }, 200)).value.inquiry;
    const stored = (await A.call('cryssa', `inquiries/${rec.id}`, undefined, 200)).value.inquiry;
    const responseDiffers = saved.notes !== 'ab';
    assert.equal(stored.notes, 'ab', 'stored notes'); assert.equal(stored.fields.branch, 'Branch', 'stored field');
    const chat = await A.raw('cryssa', `inquiries/${rec.id}/chat`, { revision: saved.revision, question: 'hello\u0000 world' });
    assert.ok(chat.status < 500, 'chat with NUL -> ' + chat.status + ' ' + (await chat.text()).slice(0, 120));
    return 'save ok (stored without NUL; save response itself ' + (responseDiffers ? 'still carries the NUL' : 'is also stripped') + '), chat ' + chat.status;
  });
  await check('T10 NUL in every free-text writer I could reach (JSON.stringify / text columns without the NUL strip) must not be a 500', async () => {
    const results = {}, bad = [];
    const probe = async (name, make) => { try { const r = await make(); const text = await r.text(); results[name] = r.status; if (r.status >= 500) bad.push(`${name}=${r.status}`); } catch (e) { results[name] = 'ERR ' + e.message; bad.push(name); } };
    const fresh = async label => { const rec = await newInquiry(`QA-PG T10 nul ${label} ${run}`); await startHandling(A, rec.id, 'cryssa', randomUUID()); return rec; };
    await probe('create-account name+position', () => A.raw('admin', 'create-account', { name: 'QA Nul\u0000 Person', username: 'qa.nul.' + run, email: `qa.nul.${run}@rmc2.local`, role: 'Employee', position: 'Tester\u0000', canApprove: false, currentPassword: pw }));
    { const rec = await fresh('details'); await probe('request-details body', () => A.raw('cryssa', `inquiries/${rec.id}/request-details`, { revision: rec.revision, body: 'Please send\u0000 the ages' })); }
    { const rec = await fresh('decline'); await probe('decline reason', () => A.raw('cryssa', `inquiries/${rec.id}/decline`, { revision: rec.revision, reason: 'Not eligible\u0000 for this plan' })); }
    { const rec = await fresh('recheck'); await probe('review-client note', () => A.raw('cryssa', `inquiries/${rec.id}/review-client`, { revision: rec.revision, action: 'recheck', note: 'checked\u0000 again' })); }
    { const rec = await fresh('chat'); await probe('chat question', () => A.raw('cryssa', `inquiries/${rec.id}/chat`, { revision: rec.revision, question: 'Compare\u0000 alternatives' })); }
    assert.deepEqual(bad, [], 'writers that return 500 for a NUL character (SQLite accepts it): ' + JSON.stringify(results));
    return JSON.stringify(results);
  });
}

await sql.end({ timeout: 5 });
process.exit(finish('Phase 4 Postgres HTTP checks (T3 T4 T5 T6h T8 T10)') ? 0 : 1);
