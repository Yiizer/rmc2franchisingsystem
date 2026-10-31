// Phase 4 QA: Postgres-only checks that need several processes (each its own pool, like separate app instances).
//   T1 pooler / role defaults / advisory locks across processes / pool saturation / server timeouts
//   T2 parallel intakes of one client from separate processes: exactly one clear, the rest held, distinct numbers
//   T6 deadlock retry and lock-timeout 503 (no partial writes, no leak)
//   T7 no lost index enqueues under concurrent writers and index syncs
// Live: runs against the Supabase TEST project (RMC2_DATABASE_URL via .env.supabase.test). Writes test data
// (inquiries named "QA-PG ..."); the cleanup script removes it. Never prints connection details.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { createChecks, databaseUrl, maskText, root, sleep, uniq } from './db-parity/lib.mjs';

const url = databaseUrl();
Object.assign(process.env, { RMC2_DB: 'postgres', RMC2_DATABASE_URL: url, RMC2_SEED_DEMO: '1', RMC2_STORAGE: 'local', RMC2_DATA_DIR: path.join(root, 'test-results', 'qa-phase4', 'concurrency-data') });
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_)/.test(key) || key === 'VERCEL') delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.join(root, 'lib', 'operations', file)).href);
const database = await imp('database.ts');
const { createPostgresStore } = await imp('store-postgres.ts');
const index = await imp('inquiry-index.ts');
await database.ensureReady();
const { db } = database;
const { check, finish } = createChecks();
const only = process.argv.slice(2).filter(a => /^T\d+$/.test(a));
const wants = id => !only.length || only.includes(id);
const run = uniq();

// ------------------------------------------------------------------ worker processes
function startWorker(op, args, { waitForGo = true } = {}) {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'db-parity', 'worker.mjs'), op, waitForGo ? '0' : String(Date.now() + 1000), JSON.stringify(args)], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; let buffer = ''; let readyResolve; let stderr = '';
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const results = [];
  const done = new Promise(resolve => child.on('close', code => resolve({ code })));
  child.stdout.on('data', chunk => {
    buffer += chunk; const parts = buffer.split('\n'); buffer = parts.pop();
    for (const line of parts) { lines.push(line); if (line === 'READY') readyResolve(); if (line.startsWith('RESULT ')) results.push(JSON.parse(line.slice(7))); }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', () => readyResolve());
  return { child, ready, done, results, go: () => child.stdin.write('GO\n'), stderr: () => maskText(stderr).slice(-400) };
}
async function runWorkers(op, argsList, { timeoutMs = 240000 } = {}) {
  const workers = argsList.map(args => startWorker(op, args));
  const watchdog = setTimeout(() => workers.forEach(w => w.child.kill()), timeoutMs);
  await Promise.all(workers.map(w => w.ready));
  workers.forEach(w => w.go());
  await Promise.all(workers.map(w => w.done));
  clearTimeout(watchdog);
  return workers.map(w => { const fatal = w.results.find(r => r.fatal); if (fatal) throw new Error('worker failed: ' + fatal.fatal + ' ' + w.stderr()); if (!w.results.length) throw new Error('worker produced no result: ' + w.stderr()); return w.results[0]; });
}

const counter = async () => Number((await db.get("SELECT n FROM counters WHERE name='inquiry'")).n);
const spec = (company, i, user = 'cryssa') => ({ company, agent: `Agent ${company.slice(-4)} ${i}`, sender: `agent${i}.${run}@example.test`, user });
const seen = { ids: [] };

// ================================================================== T1
if (wants('T1')) {
  await check('T1 app role: transaction pooler (6543), search_path rmc2, timeouts 15s/5s/30s, not superuser/bypassrls', async () => {
    const u = new URL(url);
    assert.equal(u.port, '6543', 'app URL must use the transaction pooler port');
    assert.ok(/pooler/.test(u.hostname), 'host is a pooler host');
    const row = await db.get(`SELECT current_user AS u, current_setting('search_path') AS sp, current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt, current_setting('idle_in_transaction_session_timeout') AS it,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS su, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass, (SELECT rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname=current_user) AS create_stuff`);
    assert.match(row.u, /^rmc2_app/); assert.equal(row.sp, 'rmc2'); assert.equal(row.st, '15s'); assert.equal(row.lt, '5s'); assert.equal(row.it, '30s');
    assert.equal(row.su, false); assert.equal(row.bypass, false); assert.equal(row.create_stuff, false);
    return `user ${row.u.split('.')[0]}, search_path ${row.sp}, timeouts ${row.st}/${row.lt}/${row.it}`;
  });
  await check('T1 DDL and other schemas are denied to the app role', async () => {
    for (const statement of ['CREATE TABLE rmc2.qa_should_fail(x int)', 'DROP TABLE rmc2.users', 'ALTER TABLE rmc2.users ADD COLUMN qa int', 'TRUNCATE rmc2.app_meta_does_not_matter', 'CREATE TABLE public.qa_should_fail(x int)', 'SELECT * FROM auth.users LIMIT 1', 'SELECT * FROM storage.objects LIMIT 1'])
      await assert.rejects(db.exec(statement), e => ['42501', '42P01', '3F000'].includes(e.code || e.pgCode) || /permission denied|does not exist/.test(e.message), statement);
  });
  await check('T1 advisory locks exclude each other across processes through the pooler', async () => {
    const holder = startWorker('holdlock', { keys: ['qa:t1:' + run], ms: 3500 });
    await holder.ready; holder.go();
    for (let i = 0; i < 100 && !holder.results.some(r => r.locked); i++) await sleep(100);
    assert.ok(holder.results.some(r => r.locked), 'holder did not lock');
    const started = Date.now();
    await db.transaction(async () => { await db.lock('qa:t1:' + run); });
    const waited = Date.now() - started;
    assert.ok(waited >= 1500, 'second locker should have waited for the holder, waited ' + waited + ' ms');
    await holder.done;
    // tryLock must say no while another process holds it
    const holder2 = startWorker('holdlock', { keys: ['qa:t1b:' + run], ms: 2500 }); await holder2.ready; holder2.go();
    for (let i = 0; i < 100 && !holder2.results.some(r => r.locked); i++) await sleep(100);
    const got = await db.transaction(async () => db.tryLock('qa:t1b:' + run));
    assert.equal(got, false, 'tryLock must fail while held elsewhere');
    await holder2.done;
    assert.equal(await db.transaction(async () => db.tryLock('qa:t1b:' + run)), true, 'tryLock succeeds once released');
    return `second locker waited ${waited} ms`;
  });
  await check('T1 more parallel statements/transactions than pool connections (3) complete, no hang', async () => {
    const started = Date.now();
    const reads = Array.from({ length: 60 }, () => db.get('SELECT 1 AS x'));
    const txs = Array.from({ length: 12 }, (_, i) => db.transaction(async () => { await db.get('SELECT pg_sleep(0.15)'); const r = await db.get('SELECT ?::int AS v', i); await db.get('SELECT 1'); return r.v; }));
    const result = await Promise.race([Promise.all([...reads, ...txs]), sleep(40000).then(() => { throw new Error('HUNG: parallel load did not finish in 40 s'); })]);
    assert.deepEqual(result.slice(60), Array.from({ length: 12 }, (_, i) => i));
    return `72 operations in ${Date.now() - started} ms`;
  });
  await check('T1 statement_timeout (15 s) inside a transaction -> 503 colleague message, nothing leaks, pool usable', async () => {
    const started = Date.now();
    const error = await db.transaction(async () => { await db.get('SELECT pg_sleep(17)'); }).then(() => null, e => e);
    assert.ok(error, 'pg_sleep(17) must be cancelled');
    assert.equal(error.status, 503); assert.equal(error.message, 'Another colleague is working on this client, try again');
    assert.ok(Date.now() - started < 20000);
    assert.ok(!/pg_sleep|57014|rmc2/.test(error.message));
    assert.equal((await db.get('SELECT 1 AS x')).x, 1, 'pool still usable');
  });
  await check('T1 a pool statement slower than 15 s is bounded (client wait bound races the server timeout): 503, fixed text, pool recovers', async () => {
    const error = await db.get('SELECT pg_sleep(17)').then(() => null, e => e);
    assert.ok(error); assert.equal(error.status, 503);
    assert.ok(['Another colleague is working on this client, try again', 'Database busy. Try again.'].includes(error.message), error.message);
    await sleep(3000); // the abandoned statement is ended by the server's statement_timeout
    assert.equal((await db.get('SELECT 1 AS x')).x, 1);
    return 'message: ' + error.message;
  });
  await check('T1 idle_in_transaction_session_timeout (30 s) ends an abandoned transaction; the pool recovers', async () => {
    const error = await db.transaction(async () => { await db.get('SELECT 1'); await sleep(33000); await db.get('SELECT 2'); }).then(() => null, e => e);
    assert.ok(error, 'the transaction must be terminated by the server');
    assert.ok(!/postgres:\/\/|rmc2_app|pooler/.test(String(error.message)), 'error text carries no connection details');
    assert.equal((await db.get('SELECT 1 AS x')).x, 1);
    return 'error status ' + (error.status ?? 'plain') + ', code ' + (error.pgCode || error.code || '?');
  });
}

// ================================================================== T2
if (wants('T2')) {
  const CONTENDED = 'Another colleague is working on this client, try again';
  const rounds = [];
  const runRound = async (label, groups, processes) => {
    const specs = [];
    groups.forEach(g => { for (let i = 0; i < g.count; i++) specs.push({ ...spec(g.company, specs.length + 1), company: g.company }); });
    const before = await counter();
    const buckets = Array.from({ length: processes }, () => []);
    specs.forEach((s, i) => buckets[i % processes].push(s));
    const started = Date.now();
    const results = await runWorkers('intake', buckets.map(list => ({ specs: list })));
    const flat = []; const cursors = buckets.map(() => 0);
    specs.forEach((s, i) => { const b = i % processes; flat.push(results[b][cursors[b]++]); });
    const firstMs = Date.now() - started;
    // Hard invariants of the first pass (these must hold whatever the latency): failures are only the safe 503, nothing half-written.
    const okFirst = flat.filter(r => r.ok), failed = flat.map((r, i) => ({ r, s: specs[i] })).filter(x => !x.r.ok);
    for (const x of failed) { assert.equal(x.r.status, 503, label + ': unexpected failure ' + JSON.stringify(x.r)); assert.equal(x.r.message, CONTENDED); }
    assert.equal((await counter()) - before, okFirst.length, label + ': counter advanced only for imports that succeeded (numbers of failed imports were given back)');
    // Retry the 503s one at a time (what a user clicking again would do): all must succeed.
    let retried = [];
    if (failed.length) { retried = (await runWorkers('intake', [{ specs: failed.map(x => x.s), serial: true }]))[0]; for (const r of retried) assert.ok(r.ok, label + ': retry failed ' + JSON.stringify(r)); }
    const all = [...okFirst, ...retried];
    const ids = all.map(r => r.id); seen.ids.push(...ids);
    assert.equal(new Set(ids).size, ids.length, label + ': inquiry numbers must be distinct');
    for (const g of groups) {
      const rows = await db.all("SELECT id, data->'clientReview'->>'state' AS state FROM inquiries WHERE data->'fields'->>'company'=?", g.company);
      assert.equal(rows.length, g.count, label + ' ' + g.company + ': rows in the database');
      const clear = rows.filter(r => r.state === 'clear'), held = rows.filter(r => r.state === 'duplicate');
      assert.equal(clear.length, 1, label + ' ' + g.company + ': exactly one clear, got ' + rows.map(r => r.state).join(','));
      assert.equal(held.length, g.count - 1, label + ' ' + g.company + ': the rest are held');
    }
    for (const g of groups.filter(g => g.mustAcceptAtOnce)) {
      const lost = failed.filter(x => x.s.company === g.company);
      assert.equal(lost.length, 0, label + ' ' + g.company + ': an unrelated client was refused (' + lost.length + ' x 503) while another client was busy');
    }
    rounds.push({ label, total: specs.length, firstPass: okFirst.length, retried: failed.length });
    return label + ': ' + okFirst.length + '/' + specs.length + ' accepted at once (' + failed.length + ' got the safe 503, then succeeded on retry), first pass ' + firstMs + ' ms';
  };
  await check('T2 8 processes x 1 intake of one client: never two clear; 503s are safe; after retry exactly one clear, 7 held', () => runRound('R1', [{ company: 'QA-PG Alpha ' + run, count: 8 }], 8));
  await check('T2 16 processes: 12 of one client + 4 unrelated: unrelated clients stay clear', () => runRound('R2', [{ company: 'QA-PG Beta ' + run, count: 12 }, ...[1, 2, 3, 4].map(n => ({ company: 'QA-PG Solo' + n + ' ' + run, count: 1, mustAcceptAtOnce: true }))], 16));
  await check('T2 10 processes x 3 concurrent intakes (30 in flight): 28 of one client + 2 others', () => runRound('R3', [{ company: 'QA-PG Gamma ' + run, count: 28 }, { company: 'QA-PG Delta ' + run, count: 2, mustAcceptAtOnce: false }], 10));
  await check('T2 two different clients interleaved across processes (6 + 6)', () => runRound('R4', [{ company: 'QA-PG Eps ' + run, count: 6 }, { company: 'QA-PG Zeta ' + run, count: 6 }], 6));
  await check('T2 INFORMATION: how many simultaneous intakes of one client are accepted at once with the 5 s lock_timeout', async () => {
    const out = [];
    for (const n of [3, 4, 5, 6]) { const company = 'QA-PG Cap' + n + ' ' + run; const r = await runWorkers('intake', Array.from({ length: n }, (_, i) => ({ specs: [{ ...spec(company, i + 1), company }] }))); const flat = r.flat(); out.push(n + ' at once -> ' + flat.filter(x => x.ok).length + ' accepted'); seen.ids.push(...flat.filter(x => x.ok).map(x => x.id)); }
    return out.join('; ');
  });
  await check('T2 projection after the storm: every inquiry has a summary row once synced, nothing left queued', async () => {
    await index.synchronizeInquiryIndex();
    const bad = await db.all("SELECT i.id FROM inquiries i LEFT JOIN inquiry_summaries s ON s.id=i.id WHERE s.id IS NULL OR (s.summary->>'revision')::int<>i.revision");
    assert.deepEqual(bad.map(r => r.id), []);
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM inquiry_index_pending')).n, 0);
  });
}

// ================================================================== T6
if (wants('T6')) {
  await check('T6 deadlock (opposite advisory-lock order, two pools): server aborts one, the store retries it, both finish', async () => {
    const a = createPostgresStore(url), b = createPostgresStore(url);
    let attemptsA = 0, attemptsB = 0;
    try {
      const k1 = 'qa:dl1:' + run, k2 = 'qa:dl2:' + run;
      const pa = a.transaction(async () => { attemptsA++; await a.lock(k1); await sleep(500); await a.lock(k2); return 'a'; });
      const pb = b.transaction(async () => { attemptsB++; await b.lock(k2); await sleep(500); await b.lock(k1); return 'b'; });
      const settled = await Promise.race([Promise.allSettled([pa, pb]), sleep(30000).then(() => { throw new Error('HUNG'); })]);
      assert.deepEqual(settled.map(s => s.status), ['fulfilled', 'fulfilled'], JSON.stringify(settled.map(s => s.reason?.message)));
      assert.equal(attemptsA + attemptsB, 3, `exactly one transaction was retried once (attempts ${attemptsA}+${attemptsB})`);
      return `attempts ${attemptsA}+${attemptsB}`;
    } finally { await a.close(); await b.close(); }
  });
  await check('T6 lock timeout: intake of a client whose identity key is held elsewhere -> 503 after ~5 s, nothing written, counter unchanged', async () => {
    const company = 'QA-PG Locked ' + run;
    const first = (await runWorkers('intake', [{ specs: [spec(company, 1)] }]))[0][0];
    assert.ok(first.ok && first.state === 'clear', JSON.stringify(first));
    seen.ids.push(first.id);
    const record = await database.inquiry(first.id);
    const keys = index.registryLockKeys(record);
    assert.ok(keys.length > 0, 'identity keys exist');
    const holder = startWorker('holdlock', { keys, ms: 9000 }); await holder.ready; holder.go();
    for (let i = 0; i < 150 && !holder.results.some(r => r.locked); i++) await sleep(100);
    assert.ok(holder.results.some(r => r.locked), 'holder locked');
    const before = await counter(), rowsBefore = (await db.get("SELECT COUNT(*)::int AS n FROM inquiries WHERE data->'fields'->>'company'=?", company)).n;
    const second = await runWorkers('intake', [{ specs: [spec(company, 2)] }]);
    await holder.done;
    const r = second[0][0];
    assert.equal(r.ok, false, 'the blocked intake must fail'); assert.equal(r.status, 503, JSON.stringify(r));
    assert.equal(r.message, 'Another colleague is working on this client, try again');
    assert.ok(r.ms >= 4000 && r.ms <= 9500, 'failed after about lock_timeout (5 s), took ' + r.ms);
    assert.equal(await counter(), before, 'the inquiry number was given back');
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM inquiries WHERE data->'fields'->>'company'=?", company)).n, rowsBefore);
    // and once the lock is free the same intake succeeds and is held (the first registration is clear)
    const third = (await runWorkers('intake', [{ specs: [spec(company, 3)] }]))[0][0];
    assert.ok(third.ok && third.state === 'duplicate', JSON.stringify(third)); seen.ids.push(third.id);
    return `503 after ${r.ms} ms`;
  });
}

// ================================================================== T7
if (wants('T7')) {
  await check('T7 no lost index enqueues: 4 writers + 3 index syncs + new imports for 20 s, then every projection matches its inquiry', async () => {
    const targets = (await db.all("SELECT id FROM inquiries WHERE id LIKE 'INQ-%' ORDER BY id DESC LIMIT 8")).map(r => r.id);
    assert.equal(targets.length, 8);
    const newClients = Array.from({ length: 4 }, (_, i) => spec('QA-PG Index ' + i + ' ' + run, i + 1));
    const argsList = [
      ...[0, 1, 2, 3].map(w => ({ kind: 'touch', ids: targets.slice(w * 2, w * 2 + 2), ms: 20000, tag: 'w' + w })),
      { kind: 'touch', ids: [targets[0], targets[2]], ms: 20000, tag: 'contender' }, // contends with writers 0 and 1
      ...[0, 1, 2].map(() => ({ kind: 'sync', ms: 20000, pause: 5 })),
      { kind: 'intake', specs: newClients },
    ];
    const workers = argsList.map(a => startWorker(a.kind, a));
    await Promise.all(workers.map(w => w.ready)); workers.forEach(w => w.go());
    await Promise.all(workers.map(w => w.done));
    const results = workers.map(w => { const f = w.results.find(r => r.fatal); if (f) throw new Error('worker failed: ' + f.fatal); return w.results[0]; });
    const writes = results.filter(r => r.writes !== undefined).reduce((n, r) => n + r.writes, 0);
    const syncs = results.filter(r => r.calls !== undefined);
    assert.ok(writes > 50, 'writers actually ran (' + writes + ' writes)');
    // Under this storm a sync may wait longer than lock_timeout for the idx-sync lock: that is a safe 503 (the claim rolls back, the
    // ids stay queued). Anything other than that 503 is a failure; the 503 count is reported.
    for (const s of syncs) for (const e of s.errors) assert.ok(/^503 (Another colleague is working on this client, try again|Database busy)/.test(e), 'unexpected index sync error: ' + e);
    const syncErrors = syncs.reduce((n, s) => n + s.errorCount, 0);
    seen.ids.push(...results.at(-1).map(r => r.id));
    // The index must catch up to the LAST write of every inquiry: one final sync, then compare.
    await index.synchronizeInquiryIndex();
    const pending = await db.get('SELECT COUNT(*)::int AS n FROM inquiry_index_pending');
    assert.equal(pending.n, 0, 'nothing left queued after a final sync');
    const stale = await db.all("SELECT i.id, i.revision, (s.summary->>'revision')::int AS projected FROM inquiries i LEFT JOIN inquiry_summaries s ON s.id=i.id WHERE s.id IS NULL OR (s.summary->>'revision')::int<>i.revision");
    assert.deepEqual(stale, [], 'a projection is older than its inquiry (lost enqueue)');
    const noKeys = await db.all("SELECT i.id FROM inquiries i WHERE i.data->'source'->>'kind' IS DISTINCT FROM 'sample' AND NOT EXISTS (SELECT 1 FROM inquiry_keys k WHERE k.inquiry_id=i.id) AND i.id LIKE 'INQ-%' AND i.data->'fields'->>'company' LIKE 'QA-PG%'");
    assert.deepEqual(noKeys, [], 'identity keys exist for every QA inquiry');
    const delta = await db.get('SELECT COUNT(*)::int AS n FROM inquiries i WHERE (SELECT COUNT(*) FROM inquiry_summaries s WHERE s.id=i.id)<>1');
    assert.equal(delta.n, 0);
    return `${writes} writes, ${syncs.reduce((n, s) => n + s.calls, 0)} sync calls (${syncErrors} safe 503s from idx-sync lock waits), 0 stale projections`;
  });
}

await db.close?.();
const ok = finish('Phase 4 Postgres concurrency (T1, T2, T6, T7)');
console.log('INQUIRY_IDS ' + seen.ids.length);
process.exit(ok ? 0 : 1);
