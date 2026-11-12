// Phase 5 / pilot plan item 2: files over Vercel's 4.5 MB limit. Local only (harness, isolated SQLite and a throwaway
// file folder). Signed links are simulated by a store that writes to that folder, so nothing reaches Supabase.
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup } from './feedback-harness.mjs';

const t = await setup('large-files');
const [large, localStore, guard] = await Promise.all(['large-files', 'file-store-local', 'scope-guard'].map(t.load));
const cryssa = t.user('cryssa'), zeo = t.user('zeo'), dh = t.user('division-head');
const reject = async (promise, status, pattern) => { await assert.rejects(promise, error => (status ? error.status === status : true) && (!pattern || pattern.test(error.message))); };
const MB = 1024 * 1024, bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);
const local = localStore.createLocalStore({ root: path.join(t.out, 'files') });

// 1. This computer: no signed links, everything goes through the app as before.
globalThis.rmc2Files = local;
assert.deepEqual(await large.startUpload(cryssa, { name: 'form.pdf', size: 6 * MB, type: 'application/pdf' }), { mode: 'form' });
await local.put('inquiries/x/big.pdf', bytes(5 * MB), { contentType: 'application/pdf' });
assert.ok('bytes' in await large.openPrivateFile(cryssa, 'INQ-X', 'pdf', 'inquiries/x/big.pdf', 'big.pdf', false));
const plain = new FormData(); plain.append('file', new File([bytes(10)], 'a.pdf'));
assert.equal(await large.resolveUploads(cryssa, plain), plain);
t.pass('Local storage: uploads go with the form and downloads come back as bytes (no change on this computer)');

// 2. Online: a store with signed links (simulated).
const links = [];
const signed = { ...local, kind: 'supabase', async signedUploadUrl(key) { links.push(key); return 'https://storage.example.test/upload/' + key + '?token=t'; }, async signedDownloadUrl(key, seconds) { return 'https://storage.example.test/sign/' + key + '?token=t&expires=' + seconds; } };
globalThis.rmc2Files = signed;
const started = await large.startUpload(cryssa, { name: 'Submitted form (final).pdf', size: 6 * MB, type: 'application/pdf' });
assert.equal(started.mode, 'signed'); assert.match(started.id, /^\d{13}-[0-9a-f-]{36}\/Submitted_form_final_.pdf$/);
assert.equal(links.at(-1), 'transfer/up/cryssa/' + started.id);
await reject(large.startUpload(cryssa, { name: 'huge.docx', size: 16 * MB }), 413);
await reject(large.startUpload(cryssa, { name: 'x.pdf', size: 1, extra: 1 }));
t.pass('Online: a signed upload link is issued for the signed-in user only; over 15 MB and unknown fields are refused');

await local.put('transfer/up/cryssa/' + started.id, bytes(6 * MB, 3), { contentType: 'application/pdf' }); // the browser's PUT
const form = new FormData(); form.append('ownerId', 'dh-1'); form.append('file__upload', started.id); form.append('file__name', 'Submitted form (final).pdf');
const resolved = await large.resolveUploads(cryssa, form), file = resolved.get('file');
assert.ok(file instanceof File); assert.equal(file.name, 'Submitted form (final).pdf'); assert.equal(file.type, 'application/pdf'); assert.equal(file.size, 6 * MB);
assert.equal(new Uint8Array(await file.arrayBuffer())[0], 3); assert.equal(resolved.get('ownerId'), 'dh-1'); assert.equal(resolved.get('file__upload'), null);
assert.equal(await local.stat('transfer/up/cryssa/' + started.id), null);
t.pass('The route receives the uploaded file under its original name and type, other fields are kept, and the stored copy is deleted');

const second = await large.startUpload(cryssa, { name: 'b.pdf', size: 5 * MB });
await local.put('transfer/up/cryssa/' + second.id, bytes(5 * MB), { contentType: 'application/pdf' });
const stolen = new FormData(); stolen.append('file__upload', second.id);
await reject(large.resolveUploads(zeo, stolen), 400, /did not finish/);
for (const id of ['../cryssa/' + second.id, second.id.replace(/\/.*/, '/../../x.pdf'), 'x']) { const bad = new FormData(); bad.append('file__upload', id); await reject(large.resolveUploads(cryssa, bad), 400, /not valid/); }
const expired = new FormData(); expired.append('file__upload', String(Date.now() - 2 * 3600000) + second.id.slice(13)); await reject(large.resolveUploads(cryssa, expired), 410);
const missing = new FormData(); missing.append('file__upload', (await large.startUpload(cryssa, { name: 'c.pdf', size: 5 * MB })).id); await reject(large.resolveUploads(cryssa, missing), 400, /did not finish/);
t.pass("Someone else's upload id, malformed or path-like ids, expired uploads and uploads that never arrived are refused");

// Two requests with the same upload id at the same moment: exactly one gets the file, the other is refused (409).
const twice = await large.startUpload(cryssa, { name: 'twice.pdf', size: 5 * MB });
await local.put('transfer/up/cryssa/' + twice.id, bytes(5 * MB), { contentType: 'application/pdf' });
const use = () => { const f = new FormData(); f.append('file__upload', twice.id); return large.resolveUploads(cryssa, f).then(r => r.get('file') instanceof File ? 200 : 'no file', e => e.status); };
const outcomes = (await Promise.all([use(), use(), use()])).sort();
assert.deepEqual(outcomes, [200, 409, 409], 'one use wins: ' + outcomes);
assert.equal(await use(), 400, 'a later reuse is refused too (the used copy is already deleted)');
t.pass('The same upload id sent by parallel requests is used exactly once; the others get 409 "already used"');

const oversize = await large.startUpload(cryssa, { name: 'd.docx', size: 5 * MB });
await local.put('transfer/up/cryssa/' + oversize.id, bytes(16 * MB), { contentType: 'application/octet-stream' });
const tooBig = new FormData(); tooBig.append('file__upload', oversize.id); await reject(large.resolveUploads(cryssa, tooBig), 413);
assert.equal(await local.stat('transfer/up/cryssa/' + oversize.id), null);
t.pass('A file that turns out larger than 15 MB after upload is refused and deleted');

const old = 'transfer/up/zeo/' + (Date.now() - 2 * 3600000) + '-00000000-0000-4000-8000-000000000000/old.pdf';
await local.put(old, bytes(10), { contentType: 'application/pdf' });
for (let i = 0; i < large.MAX_PENDING_UPLOADS; i++) await large.startUpload(zeo, { name: 'z' + i + '.pdf', size: 5 * MB }).then(s => local.put('transfer/up/zeo/' + s.id, bytes(10), { contentType: 'application/pdf' }));
assert.equal(await local.stat(old), null);
await reject(large.startUpload(zeo, { name: 'one-more.pdf', size: 5 * MB }), 429);
t.pass('Abandoned uploads older than an hour are swept; each person can have at most ' + large.MAX_PENDING_UPLOADS + ' unfinished uploads');

for (let i = 0; i < large.UPLOAD_LINKS_PER_HOUR; i++) await large.startUpload(dh, { name: 'never-sent-' + i + '.pdf', size: 5 * MB });
await reject(large.startUpload(dh, { name: 'one-more.pdf', size: 5 * MB }), 429, /last hour/);
assert.equal(Number((await t.db.get("SELECT COUNT(*) AS n FROM file_access WHERE user_id=? AND kind='upload-start'", dh.id)).n), large.UPLOAD_LINKS_PER_HOUR);
t.pass('Upload links are counted when issued (logged in file_access): at most ' + large.UPLOAD_LINKS_PER_HOUR + ' an hour per person, even if no file is ever sent');

// 3. Downloads.
const before = Number((await t.db.get('SELECT COUNT(*) AS n FROM file_access')).n);
await local.put('inquiries/x/small.pdf', bytes(MB), { contentType: 'application/pdf' });
assert.ok('bytes' in await large.openPrivateFile(cryssa, 'INQ-X', 'source', 'inquiries/x/small.pdf', 'small.pdf', true));
const link = await large.openPrivateFile(cryssa, 'INQ-X', 'source', 'inquiries/x/big.pdf', 'Big form (v2).pdf', true);
assert.equal(link.url, 'https://storage.example.test/sign/inquiries/x/big.pdf?token=t&expires=60&download=Big_form_v2_.pdf');
assert.ok(!(await large.openPrivateFile(cryssa, 'INQ-X', 'pdf', 'inquiries/x/big.pdf', 'big.pdf', false)).url.includes('download='));
assert.equal(Number((await t.db.get('SELECT COUNT(*) AS n FROM file_access')).n), before + 3);
await reject(large.openPrivateFile(cryssa, 'INQ-X', 'pdf', 'inquiries/x/none.pdf', 'none.pdf', false));
t.pass('Downloads up to 4 MB come back as bytes; larger ones as a 60-second signed link (named for downloads); every access is logged; missing files fail');

assert.ok('bytes' in await large.bytesOrLink(Buffer.alloc(MB), 'application/pdf', 'a.pdf', true));
const parked = await large.bytesOrLink(Buffer.alloc(5 * MB), 'application/pdf', 'attachment.pdf', true);
assert.match(parked.url, /^https:\/\/storage\.example\.test\/sign\/transfer\/down\/\d{13}-[0-9a-f-]{36}\/attachment\.pdf\?token=t&expires=60&download=attachment\.pdf$/);
t.pass('Large email attachments are parked under transfer/down (swept after an hour) and linked');

assert.equal(guard.ownerRouteAllowed('POST', ['uploads', 'start']), true);
assert.equal(guard.ownerRouteAllowed('POST', ['uploads', 'finish']), false);
assert.ok(dh);
t.pass('Division Heads / SOAs may start an upload (they submit inquiries and progress reports); nothing else under uploads/ is open');

delete globalThis.rmc2Files;
console.log(t.checks.length + ' checks passed');
