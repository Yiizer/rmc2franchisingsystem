// Phase 3 file-storage tests: one contract suite run against the local adapter and (when .env.supabase.test exists
// and the project is reachable) the Supabase TEST bucket, then failure injection through the real service functions.
// Throwaway data dir under test-results/storage, no server. Credentials are read with util.parseEnv and never printed.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const run = String(Date.now());
const dir = path.resolve('test-results', 'storage', run);
if (/[\\/]\.data([\\/]|$)/.test(dir)) throw new Error('refusing to run against .data');
mkdirSync(dir, { recursive: true });
process.env.RMC2_DATA_DIR = path.join(dir, 'app-data');
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_|STORAGE|SUPABASE_)/.test(key) || key === 'VERCEL') delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const fs = await imp('file-store.ts');
const { StorageError, assertKey, createFileStore, putContentAddressed, storageConfigFromEnv } = fs;

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const code = async promise => { try { await promise; } catch (error) { assert.ok(error instanceof StorageError, 'expected a StorageError, got ' + error); return error.code; } throw new Error('expected a StorageError but the call succeeded'); };
let fetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => { fetches++; return realFetch(...args); };

// ---------------------------------------------------------------- configuration
await check('configuration: defaults to local, fails closed on Vercel, names variables but never values', () => {
  assert.deepEqual(storageConfigFromEnv({}, '/data'), { kind: 'local', root: '/data' });
  assert.throws(() => storageConfigFromEnv({ VERCEL: '1' }, '/data'), /RMC2_STORAGE=supabase is required on Vercel/);
  assert.equal(storageConfigFromEnv({ VERCEL: '1', RMC2_STORAGE: 'supabase', RMC2_SUPABASE_URL: 'https://x.example', RMC2_SUPABASE_SECRET_KEY: 'sb_secret_value', RMC2_STORAGE_BUCKET: 'b' }).kind, 'supabase');
  try { storageConfigFromEnv({ RMC2_STORAGE: 'supabase', RMC2_SUPABASE_SECRET_KEY: 'sb_secret_value' }); assert.fail('should throw'); }
  catch (error) { assert.match(error.message, /RMC2_SUPABASE_URL, RMC2_STORAGE_BUCKET/); assert.ok(!error.message.includes('sb_secret_value')); }
  assert.throws(() => storageConfigFromEnv({ RMC2_STORAGE: 's3-secret-value' }), error => /RMC2_STORAGE must be/.test(error.message) && !error.message.includes('s3-secret-value'));
});

// ---------------------------------------------------------------- contract
const BAD_KEYS = ['../x', 'a/../b', '/a', 'a/', 'a\\b', 'a//b', '', './a', 'a/./b', 'C:/x', 'a\u0000b', 'a\nb', 'x'.repeat(513),
  // Windows aliases: reserved device names (any case, with or without extension) and trailing dot/space segments
  'CON', 'con.txt', 'a/NUL.docx', 'a/com1', 'LPT9.x', 'Aux', 'a./b', 'a/b.', 'a/b ', 'PRN.tar.gz'];
const GOOD_KEYS = ['console.txt', 'a/com10.txt', 'a/lpt.txt', 'x/.hidden', 'attachments/0e3b6f4a-1111-4222-8333-444455556666.xlsx', 'outbox/id.dry-run.eml'];
async function contract(label, store, { cfg }) {
  const c = (name, fn) => check(label + ': ' + name, fn);
  const key = name => 'contract/' + name;
  await c('binary roundtrip: 0 bytes, all 256 byte values, 3 MB', async () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i)), big = randomBytes(3 * 1024 * 1024);
    for (const [name, bytes] of [['empty.bin', Buffer.alloc(0)], ['all.bin', all], ['big.bin', big]]) {
      await store.put(key(name), bytes, { contentType: 'application/octet-stream' });
      const back = await store.get(key(name));
      assert.ok(Buffer.isBuffer(back));
      assert.equal(sha(back), sha(bytes), name);
      assert.equal((await store.stat(key(name))).size, bytes.length, name + ' size');
    }
  });
  await c('create on an existing key is 409 and keeps the original; replace overwrites', async () => {
    await store.put(key('twice.txt'), Buffer.from('one'), { contentType: 'text/plain' });
    assert.equal(await code(store.put(key('twice.txt'), Buffer.from('two'), { contentType: 'text/plain', mode: 'create' })), 'exists');
    assert.equal((await store.get(key('twice.txt'))).toString(), 'one');
    await store.put(key('twice.txt'), Buffer.from('three'), { contentType: 'text/plain', mode: 'replace' });
    assert.equal((await store.get(key('twice.txt'))).toString(), 'three');
    await store.put(key('fresh-replace.txt'), Buffer.from('x'), { contentType: 'text/plain', mode: 'replace' });
    assert.equal((await store.get(key('fresh-replace.txt'))).toString(), 'x');
    assert.equal((await code(store.put(key('twice.txt'), Buffer.from('z'), { contentType: 'text/plain' }))), 'exists');
  });
  await c('get of a missing key is not_found with a safe 404 message', async () => {
    const error = await store.get(key('nope.bin')).catch(e => e);
    assert.ok(error instanceof StorageError && error.code === 'not_found' && error.status === 404);
    assert.equal(error.message, 'The stored file is missing. Contact your administrator.');
    assert.ok(!error.message.includes('nope.bin'));
  });
  await c('stat: size when present, null when missing', async () => {
    await store.put(key('stat.txt'), Buffer.from('12345'), { contentType: 'text/plain' });
    assert.equal((await store.stat(key('stat.txt'))).size, 5);
    assert.equal(await store.stat(key('never.txt')), null);
  });
  await c('delete is idempotent', async () => {
    await store.put(key('gone.txt'), Buffer.from('x'), { contentType: 'text/plain' });
    await store.delete(key('gone.txt'));
    await store.delete(key('gone.txt'));
    await store.delete(key('never-existed.txt'));
    assert.equal(await store.stat(key('gone.txt')), null);
    assert.equal(await code(store.get(key('gone.txt'))), 'not_found');
  });
  await c('list is recursive, returns keys relative to the store, and tolerates an empty or missing folder', async () => {
    for (const name of ['list/a.txt', 'list/sub/b.txt', 'list/sub/deeper/c.txt']) await store.put(name, Buffer.from(name), { contentType: 'text/plain' });
    assert.deepEqual(await store.list('list'), ['list/a.txt', 'list/sub/b.txt', 'list/sub/deeper/c.txt']);
    assert.deepEqual(await store.list('list/'), ['list/a.txt', 'list/sub/b.txt', 'list/sub/deeper/c.txt']);
    assert.deepEqual(await store.list('list/sub'), ['list/sub/b.txt', 'list/sub/deeper/c.txt']);
    assert.deepEqual(await store.list('no-such-folder'), []);
    assert.ok((await store.list('')).includes('list/a.txt'));
  });
  await c('invalid keys are rejected with 400 before any network call', async () => {
    const before = fetches;
    for (const bad of BAD_KEYS) {
      assert.equal(await code(store.put(bad, Buffer.from('x'), { contentType: 'text/plain' })), 'invalid_key', JSON.stringify(bad));
      assert.equal(await code(store.get(bad)), 'invalid_key');
      assert.equal(await code(store.stat(bad)), 'invalid_key');
      assert.equal(await code(store.delete(bad)), 'invalid_key');
    }
    assert.equal(await code(store.list('../x')), 'invalid_key');
    assert.equal(fetches, before, 'no request may be made for an invalid key');
    assert.throws(() => assertKey('a/../b'), error => error.status === 400 && error.message === 'Invalid stored file path');
    for (const good of GOOD_KEYS) assert.equal(assertKey(good), good);
  });
  await c('a key with dots and extra extensions round-trips (outbox/x.dry-run.eml)', async () => {
    await store.put('outbox/abc.dry-run.eml', Buffer.from('mail'), { contentType: 'message/rfc822', mode: 'replace' });
    assert.equal((await store.get('outbox/abc.dry-run.eml')).toString(), 'mail');
    assert.ok((await store.list('outbox')).includes('outbox/abc.dry-run.eml'));
  });
  await c('10 parallel puts to different keys all land intact', async () => {
    const bodies = Array.from({ length: 10 }, (_, i) => randomBytes(1000 + i));
    await Promise.all(bodies.map((body, i) => store.put(key('par-' + i + '.bin'), body, { contentType: 'application/octet-stream' })));
    for (let i = 0; i < 10; i++) assert.equal(sha(await store.get(key('par-' + i + '.bin'))), sha(bodies[i]));
  });
  await c('10 parallel creates of the same key: exactly one wins, the rest are exists', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => store.put(key('race.txt'), Buffer.from('writer-' + i), { contentType: 'text/plain' })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason instanceof StorageError && r.reason.code === 'exists'));
  });
  await c('content-addressed put: same hash is fine twice, a different payload under the same key is 409', async () => {
    const bytes = randomBytes(2048), hash = sha(bytes), addressed = 'sources/' + hash + '.docx';
    await putContentAddressed(addressed, bytes, hash, 'application/octet-stream', 'mismatch', store);
    await putContentAddressed(addressed, bytes, hash, 'application/octet-stream', 'mismatch', store);
    await store.put('sources/tampered.docx', Buffer.from('not the bytes'), { contentType: 'application/octet-stream' });
    await assert.rejects(putContentAddressed('sources/tampered.docx', bytes, hash, 'application/octet-stream', 'The archived proposal source could not be verified.', store), error => error.status === 409 && error.message === 'The archived proposal source could not be verified.');
  });
  await c('a store with a small maxBytes rejects larger objects (413) without a network call', async () => {
    const small = label === 'local' ? createFileStore({ kind: 'local', root: path.join(dir, 'small'), maxBytes: 100 }) : createFileStore({ ...cfg, maxBytes: 100 });
    const before = fetches;
    await small.put(key('ok-100.bin'), Buffer.alloc(100), { contentType: 'application/octet-stream' });
    assert.equal(await code(small.put(key('big-101.bin'), Buffer.alloc(101), { contentType: 'application/octet-stream' })), 'too_large');
    assert.equal(await small.stat(key('big-101.bin')), null);
    if (label === 'local') assert.equal(fetches, before);
  });
}

// local leg
const localRoot = path.join(dir, 'local-store');
await contract('local', createFileStore({ kind: 'local', root: localRoot }), {});
await check('local: keys cannot escape the root even via a symlink-free traversal attempt', async () => {
  const store = createFileStore({ kind: 'local', root: localRoot });
  for (const bad of ['../outside.txt', '..\\outside.txt', 'a/../../outside.txt']) assert.equal(await code(store.put(bad, Buffer.from('x'), { contentType: 'text/plain' })), 'invalid_key');
  assert.ok(!existsSync(path.join(dir, 'outside.txt')));
});

await check('local: put is atomic: failures and existing keys leave no temp file and never disturb the original', async () => {
  const root = path.join(dir, 'partial'), s = createFileStore({ kind: 'local', root });
  await s.put('d/a.txt', Buffer.from('x'), { contentType: 'text/plain' });
  await s.put('d/sub/inner.txt', Buffer.from('i'), { contentType: 'text/plain' });
  assert.equal(await code(s.put('d/a.txt', Buffer.from('y'), { contentType: 'text/plain' })), 'exists');
  assert.equal(await code(s.put('d/a.txt/child', Buffer.from('y'), { contentType: 'text/plain' })), 'unavailable', 'parent is a file');
  assert.equal(await code(s.put('d/sub', Buffer.from('y'), { contentType: 'text/plain', mode: 'replace' })), 'unavailable', 'target is a directory');
  assert.deepEqual(readdirSync(path.join(root, 'd')).sort(), ['a.txt', 'sub']);
  assert.deepEqual(readdirSync(path.join(root, 'd', 'sub')), ['inner.txt']);
  assert.equal((await s.get('d/a.txt')).toString(), 'x');
  assert.deepEqual(await s.list('d'), ['d/a.txt', 'd/sub/inner.txt']);
  // a reader racing repeated replaces only ever sees one complete version
  const a = Buffer.alloc(2 * 1024 * 1024, 'a'), b = Buffer.alloc(2 * 1024 * 1024, 'b');
  await s.put('d/race.bin', a, { contentType: 'application/octet-stream', mode: 'replace' });
  let writing = true;
  const writer = (async () => { for (let i = 0; i < 15; i++) await s.put('d/race.bin', i % 2 ? a : b, { contentType: 'application/octet-stream', mode: 'replace' }); writing = false; })();
  while (writing) { const seen = await s.get('d/race.bin'); assert.ok(seen.equals(a) || seen.equals(b), 'a reader saw a partial or mixed file'); }
  await writer;
  assert.deepEqual(readdirSync(path.join(root, 'd')).sort(), ['a.txt', 'race.bin', 'sub']);
});

// ---------------------------------------------------------------- Supabase adapter against a scripted fetch (no network)
const countingFetch = globalThis.fetch;
const reply = (body, status = 200) => new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), { status });
// AbortSignal.timeout timers are unref'd, so hold the event loop open while the scripted request waits to be aborted.
const waitForAbort = init => new Promise((_, reject) => { const hold = setTimeout(() => {}, 5000); init.signal.addEventListener('abort', () => { clearTimeout(hold); reject(init.signal.reason); }); });
async function scripted(steps, fn) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const step = steps.shift();
    if (step === undefined) throw new Error('unexpected extra request');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(init) : step;
  };
  try { await fn(calls); } finally { globalThis.fetch = countingFetch; }
}
const mockCfg = { kind: 'supabase', url: 'https://mock.example', secretKey: 'sb_secret_mock_value', bucket: 'b', prefix: 'p', timeoutMs: 60 };
const notFoundBody = { statusCode: '404', error: 'not_found', message: 'Object not found' };
const duplicateBody = { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' };
await check('supabase mock: a 5xx is retried once and then succeeds; a second 5xx is unavailable', async () => {
  const s = createFileStore(mockCfg);
  await scripted([reply('oops', 503), reply('hello')], async calls => { assert.equal((await s.get('k.txt')).toString(), 'hello'); assert.equal(calls.length, 2); assert.ok(calls[0].url.endsWith('/storage/v1/object/authenticated/b/p/k.txt')); });
  await scripted([reply('oops', 502), reply('oops', 500)], async calls => { assert.equal(await code(s.get('k.txt')), 'unavailable'); assert.equal(calls.length, 2); });
});
await check('supabase mock: a request timeout is unavailable (after one retry) and a network error too', async () => {
  const s = createFileStore(mockCfg);
  await scripted([waitForAbort, waitForAbort], async calls => { assert.equal(await code(s.get('k.txt')), 'unavailable'); assert.equal(calls.length, 2); });
  await scripted([new Error('socket hang up'), new Error('socket hang up')], async () => { assert.equal(await code(s.stat('k.txt')), 'unavailable'); });
  await scripted([waitForAbort, reply('late but fine')], async () => { assert.equal((await s.get('k.txt', { timeoutMs: 30 })).toString(), 'late but fine'); });
});
await check('supabase mock: create retried after a lost response: exists with identical bytes is success, different bytes is exists', async () => {
  const s = createFileStore(mockCfg), bytes = Buffer.from('payload');
  await scripted([new Error('connection reset'), reply(duplicateBody, 400), reply(bytes)], async calls => { await s.put('k.bin', bytes, { contentType: 'application/octet-stream' }); assert.equal(calls.length, 3); assert.equal(calls[2].method, 'GET'); });
  await scripted([new Error('connection reset'), reply(duplicateBody, 400), reply('other')], async () => { assert.equal(await code(s.put('k.bin', bytes, { contentType: 'application/octet-stream' })), 'exists'); });
  await scripted([reply(duplicateBody, 400)], async calls => { assert.equal(await code(s.put('k.bin', bytes, { contentType: 'application/octet-stream' })), 'exists'); assert.equal(calls.length, 1, 'a first-attempt exists is genuine; no comparison'); });
});
await check('supabase mock: only Supabase\'s object-not-found body is not_found; a bare gateway 404 is unavailable', async () => {
  const s = createFileStore(mockCfg);
  await scripted([reply(notFoundBody, 400)], async () => { assert.equal(await code(s.get('k.txt')), 'not_found'); });
  await scripted([reply(notFoundBody, 404)], async () => { assert.equal(await code(s.get('k.txt')), 'not_found'); });
  await scripted([reply(notFoundBody, 400)], async () => { assert.equal(await s.stat('k.txt'), null); });
  await scripted([reply('<html>404 Not Found</html>', 404)], async () => { assert.equal(await code(s.get('k.txt')), 'unavailable'); });
  await scripted([reply('', 404)], async () => { assert.equal(await s.stat('k.txt').catch(e => e.code), 'unavailable'); });
  await scripted([reply({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }, 404)], async () => { assert.equal(await code(s.get('k.txt')), 'unavailable'); });
  await scripted([reply({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400)], async () => { await s.delete('k.txt'); });
});
await check('supabase mock: invalid JSON from list or stat is unavailable', async () => {
  const s = createFileStore(mockCfg);
  await scripted([reply('<<not json>>')], async () => { assert.equal(await code(s.list('')), 'unavailable'); });
  await scripted([reply('<<not json>>')], async () => { assert.equal(await code(s.stat('k.txt')), 'unavailable'); });
});
await check('supabase mock: the secret key is only sent in headers, never in the URL or an error', async () => {
  const s = createFileStore(mockCfg);
  await scripted([step => { assert.equal(step.headers.apikey, mockCfg.secretKey); return reply('x'); }], async calls => { await s.get('k.txt'); assert.ok(!calls[0].url.includes(mockCfg.secretKey)); });
  await scripted([reply({ error: 'Unauthorized', message: 'bad key ' + mockCfg.secretKey }, 401)], async () => { const e = await s.get('k.txt').catch(error => error); assert.equal(e.code, 'unavailable'); assert.ok(!e.message.includes('sb_secret')); });
});
await check('supabase config: http is rejected except localhost; a bad prefix or URL is a configuration error', () => {
  assert.throws(() => createFileStore({ ...mockCfg, url: 'http://evil.example' }), error => !(error instanceof StorageError) && /RMC2_SUPABASE_URL must use https/.test(error.message));
  assert.throws(() => createFileStore({ ...mockCfg, url: 'not a url' }), /RMC2_SUPABASE_URL/);
  createFileStore({ ...mockCfg, url: 'http://localhost:54321' });
  createFileStore({ ...mockCfg, url: 'http://127.0.0.1:54321' });
  for (const badPrefix of ['../x', 'a//b', 'CON']) assert.throws(() => createFileStore({ ...mockCfg, prefix: badPrefix }), error => !(error instanceof StorageError) && error.status === undefined && /RMC2_STORAGE_PREFIX/.test(error.message) && !error.message.includes(badPrefix));
});

// Supabase leg
const envFile = path.resolve('.env.supabase.test');
let supabaseNote = 'SKIPPED Supabase leg (no .env.supabase.test)';
if (existsSync(envFile)) {
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  const bucket = 'rmc2-test-files', prefix = 'selftest/' + run;
  if (!bucket.includes('test') || !prefix.startsWith('selftest/')) throw new Error('refusing to run against a non-test bucket or prefix');
  if (!env.RMC2_SUPABASE_URL || !env.RMC2_SUPABASE_SECRET_KEY) supabaseNote = 'SKIPPED Supabase leg (.env.supabase.test lacks the URL or secret key)';
  else {
    const cfg = { kind: 'supabase', url: env.RMC2_SUPABASE_URL, secretKey: env.RMC2_SUPABASE_SECRET_KEY, bucket, prefix, timeoutMs: 20000 };
    const store = createFileStore(cfg);
    let reachable = true;
    try { await store.list(''); } catch (error) { if (error instanceof StorageError && error.code === 'unavailable') reachable = false; else throw error; }
    if (!reachable) supabaseNote = 'SKIPPED Supabase leg (project unreachable or paused; the local leg is unaffected)';
    else {
      try {
        await contract('supabase', store, { cfg });
        await check('supabase: a wrong secret key is reported as unavailable, never leaked', async () => {
          const bad = createFileStore({ ...cfg, secretKey: 'sb_secret_not_a_real_key_0000000000' });
          const error = await bad.get('contract/big.bin').catch(e => e);
          assert.ok(error instanceof StorageError && error.code === 'unavailable' && error.status === 503, String(error?.code));
          assert.ok(!error.message.includes('sb_secret'));
        });
        await check('supabase: an unreachable host is unavailable (after one retry), not a hang', async () => {
          const dead = createFileStore({ ...cfg, url: 'http://127.0.0.1:9', timeoutMs: 2000 });
          assert.equal(await code(dead.get('contract/big.bin')), 'unavailable');
        });
        await check('supabase: the prefix isolates runs from each other', async () => {
          const other = createFileStore({ ...cfg, prefix: prefix + '-other' });
          assert.equal(await other.stat('contract/big.bin'), null);
          assert.deepEqual(await other.list(''), []);
        });
        supabaseNote = 'PASS Supabase leg ran against bucket ' + bucket + ' under ' + prefix + '/';
      } finally {
        let left = [];
        try {
          for (const key of await store.list('')) await store.delete(key);
          left = await store.list('');
        } catch (error) { console.error('Supabase cleanup problem: ' + (error instanceof StorageError ? error.code : error?.constructor?.name)); }
        if (left.length) { console.error('Supabase cleanup left ' + left.length + ' objects under ' + prefix); process.exitCode = 1; }
      }
    }
  }
}
console.log(supabaseNote);

// ---------------------------------------------------------------- failure injection through the real service functions
const database = await imp('database.ts'), svc = await imp('service.ts'), forms = await imp('forms.ts'), clientService = await imp('client-service.ts'), registration = await imp('registration-actions.ts');
const store = fs.files();
assert.equal(store.kind, 'local');
const employee = (await database.allUsers()).find(user => user.id === 'cryssa');
const importForm = async (company, agent) => {
  const fields = { company, sector: 'Private', agentName: agent, agentEmail: agent.toLowerCase().replace(/\s+/g, '.') + '@example.test', agentPhone: '09171234567', contactName: 'Contact of ' + company, addressee: 'Contact of ' + company, contactEmail: 'contact@example.test', division: 'Division 1' };
  return svc.intake(employee, new File([await forms.sampleForm(fields)], company.replace(/\W+/g, '-') + '.xlsx'), fields.agentEmail);
};
const pdfFile = name => new File([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], name, { type: 'application/pdf' });
const reportBody = (record, extra = {}) => ({ revision: record.revision, requestId: randomUUID(), sender: record.fields.agentEmail, sentAt: new Date(Date.now() - 12 * 3600000).toISOString(), summary: 'Agent confirmed the proposal was presented.', reference: 'REF-' + run, ...extra });

await check('intake stores the original under attachments/ and the file is readable through the store', async () => {
  const record = await importForm('Storage Intake Corp', 'Agent Intake');
  assert.match(record.source.storage, /^attachments\/[0-9a-f-]{36}\.xlsx$/);
  assert.ok((await store.get(record.source.storage)).length > 1000);
});
await check('progress report with a stale revision leaves no new file', async () => {
  const record = await importForm('Stale Report Corp', 'Agent Stale');
  const before = (await store.list('progress-reports')).length;
  await assert.rejects(clientService.addProgressReport(record.id, employee, reportBody(record, { revision: record.revision + 50 }), pdfFile('report.pdf')), error => error.status === 409);
  assert.equal((await store.list('progress-reports')).length, before);
});
await check('progress report: success stores one file; repeating the same requestId leaves no orphan', async () => {
  let record = await importForm('Repeat Report Corp', 'Agent Repeat');
  clientService.startClientProtection(record, new Date(Date.now() - 86400000).toISOString(), 'proposal');
  await database.persist(record, record.revision);
  record = await database.inquiry(record.id);
  const before = (await store.list('progress-reports')).length;
  const body = reportBody(record);
  const saved = await clientService.addProgressReport(record.id, employee, body, pdfFile('report.pdf'));
  assert.equal(saved.progressReports.length, 1);
  assert.equal((await store.list('progress-reports')).length, before + 1);
  assert.ok(await store.stat(saved.progressReports[0].attachment.storage), 'the referenced key exists');
  const again = await clientService.addProgressReport(record.id, employee, body, pdfFile('report.pdf'));
  assert.equal(again.progressReports.length, 1, 'idempotent');
  assert.equal((await store.list('progress-reports')).length, before + 1, 'the duplicate request must not leave a second file');
  await assert.rejects(clientService.addProgressReport(record.id, employee, reportBody(saved, { sender: 'someone.else@example.test' }), pdfFile('report2.pdf')), error => error.status === 409);
  assert.equal((await store.list('progress-reports')).length, before + 1, 'a rejected report must not leave a file');
});
await check('a BOR transfer that fails its checks leaves no file in bor/', async () => {
  const record = await importForm('Bor Check Corp', 'Agent Bor'), other = await importForm('Bor Other Corp', 'Agent Other');
  const before = (await store.list('bor')).length;
  const form = new FormData();
  Object.entries({ revision: String(record.revision + 9), previousId: other.id, previousRevision: String(other.revision), reference: 'BOR-1', note: 'Verified by phone with the previous agent.', verified: 'true' }).forEach(([k, v]) => form.set(k, v));
  form.set('file', pdfFile('bor.pdf'));
  await assert.rejects(registration.transferWithBor(record.id, employee, form), error => error.status === 409);
  const missingPrevious = new FormData();
  Object.entries({ revision: String(record.revision), previousId: 'INQ-0000-00000', previousRevision: '1', reference: 'BOR-2', note: 'Verified by phone with the previous agent.', verified: 'true' }).forEach(([k, v]) => missingPrevious.set(k, v));
  missingPrevious.set('file', pdfFile('bor.pdf'));
  await assert.rejects(registration.transferWithBor(record.id, employee, missingPrevious), error => error.status === 404);
  assert.equal((await store.list('bor')).length, before);
});
await check('a missing stored file surfaces as a safe 404, not a 500', async () => {
  const { privateFile } = await imp('file-privacy.ts');
  const error = await privateFile(employee, 'INQ-x', 'source', 'attachments/' + randomUUID() + '.pdf').catch(e => e);
  assert.ok(error.status === 404 && error.message === 'The stored file is missing. Contact your administrator.', String(error.message));
  const bad = await privateFile(employee, 'INQ-x', 'source', '../rmc2.sqlite').catch(e => e);
  assert.equal(bad.status, 400);
});

await check('intake: a transaction failure removes the stored original (no attachments orphan)', async () => {
  const before = await store.list('attachments');
  const original = database.db.run;
  database.db.run = (sql, ...args) => /INSERT INTO notifications/i.test(sql) ? Promise.reject(new Error('injected')) : original.call(database.db, sql, ...args);
  try { await assert.rejects(importForm('Orphan Test Corp', 'Agent Orphan'), /injected/); } finally { database.db.run = original; }
  assert.deepEqual(await store.list('attachments'), before);
  assert.ok((await database.inquiries()).every(r => r.fields.company !== 'Orphan Test Corp'), 'the row was rolled back too');
});
await check('saveDraft: a customization whose master changed underneath is a 409 "reload" and nothing is saved', async () => {
  const { LABELS } = await imp('types.ts');
  const template = (await database.catalog()).find(t => t.active);
  let record = await importForm('Draft Stale Corp', 'Agent Draft');
  const now = new Date().toISOString();
  await database.db.run('INSERT INTO sessions VALUES (?,?,?)', 's-draft', employee.id, new Date(Date.now() + 3600000).toISOString());
  await database.db.run('INSERT INTO inquiry_activity(session,tab,inquiry_id,user_id,started_at,seen_at) VALUES (?,?,?,?,?,?)', 's-draft', 't1', record.id, employee.id, now, now);
  record = await svc.customize(record.id, employee, { revision: record.revision, templateId: template.id });
  assert.ok(record.customization);
  const draft = () => ({ customization: { id: record.customization.id, edits: {} }, revision: record.revision, fields: Object.fromEntries(Object.entries(record.fields).filter(([k, v]) => k in LABELS && typeof v === 'string')), templateId: template.id, notes: '', email: record.email, emailOverrides: [] });
  const saved = await svc.saveDraft(record.id, employee, draft());
  assert.equal(saved.revision, record.revision + 1, 'baseline: an unchanged master saves');
  record = saved;
  const original = database.db.all;
  let overrideReads = 0;
  database.db.all = (sql, ...args) => { if (/template_overrides/.test(sql) && ++overrideReads > 1) return Promise.resolve([{ data: JSON.stringify({ ...template, sourceHash: 'f'.repeat(64) }) }]); return original.call(database.db, sql, ...args); };
  try { await assert.rejects(svc.saveDraft(record.id, employee, draft()), error => error.status === 409 && /Reload the customized copy/.test(error.message)); } finally { database.db.all = original; }
  assert.equal((await database.inquiry(record.id)).revision, record.revision, 'nothing was saved');
});
await check('submit: a transient storage error on a legacy package is a safe 503 before any transaction; a retry then proceeds', async () => {
  const { cachedRenderer } = await imp('package-rendering.ts');
  const record = await importForm('Submit Outage Corp', 'Agent Outage');
  const id = randomUUID();
  const generated = { id, templateId: 'x', sourceHash: '0', pdf: 'generated/' + id + '.pdf', docx: 'generated/' + id + '.docx' };
  await store.put(generated.pdf, Buffer.from('%PDF-1.4 produced by Skia/PDF m120'), { contentType: 'application/pdf' });
  record.generated = generated;
  await database.persist(record, record.revision);
  const realGet = store.get;
  store.get = async () => { throw new StorageError('unavailable'); };
  let outage;
  try { outage = await svc.submit(record.id, employee, record.revision).catch(e => e); } finally { store.get = realGet; }
  assert.equal(outage.status, 503);
  assert.equal(outage.message, 'File storage is unavailable. Try again.');
  assert.equal(cachedRenderer(generated), undefined, 'a transient failure is not cached');
  const retry = await svc.submit(record.id, employee, record.revision).catch(e => e);
  assert.notEqual(retry.status, 503, 'storage is back; any remaining error is a normal business rule');
  assert.ok(!/files changed/.test(retry.message), retry.message);
  assert.equal(cachedRenderer(generated), 'browser-print', 'the retry inspected the stored PDF before the transaction');
  // a permanently missing PDF is remembered as unknown and does not block submission with a storage error
  const missing = { ...generated, id: randomUUID(), pdf: 'generated/gone-' + id + '.pdf' };
  assert.equal(await (await imp('package-rendering.ts')).packageRenderer(missing, { rethrowTransient: true }), 'unknown');
  assert.equal(cachedRenderer(missing), 'unknown');
});

globalThis.fetch = realFetch;
console.log('\n' + passed + ' storage checks passed. ' + supabaseNote);

