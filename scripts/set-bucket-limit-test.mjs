// Sets the TEST storage bucket's own file size limit (PO decision 2026-11-09: 25 MB) and proves it: a 26 MB object is
// refused, a small one is accepted, and both test objects are removed. TEST project only; the key is never printed.
// 25 MB = the largest saved email (15 MB of attachments, about a third larger once encoded) with room to spare;
// the app's own upload limit stays 15 MB (lib/operations/large-files.ts).
//   node --env-file=.env.supabase.test scripts/set-bucket-limit-test.mjs
import assert from 'node:assert/strict';

const TEST_REF = 'pgoiqwixaeqbxlwbmren', BUCKET = 'rmc2-test-files', LIMIT = 25 * 1024 * 1024;
const url = (process.env.RMC2_SUPABASE_URL || '').trim(), key = (process.env.RMC2_SUPABASE_SECRET_KEY || '').trim();
assert.ok(url.includes(TEST_REF) && key, 'Refusing: RMC2_SUPABASE_URL / RMC2_SUPABASE_SECRET_KEY are missing or not the test project.');
const api = url.replace(/\/+$/, '') + '/storage/v1', auth = { apikey: key, Authorization: 'Bearer ' + key };
const bucket = async () => (await fetch(api + '/bucket/' + BUCKET, { headers: auth })).json();

const before = await bucket();
assert.equal(before.public, false, 'The bucket must stay private.');
console.log('Before: public=' + before.public + ' file_size_limit=' + before.file_size_limit + ' allowed_mime_types=' + JSON.stringify(before.allowed_mime_types));
const update = await fetch(api + '/bucket/' + BUCKET, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ public: false, file_size_limit: LIMIT, allowed_mime_types: before.allowed_mime_types ?? null }) });
assert.ok(update.ok, 'Bucket update failed: HTTP ' + update.status);
const after = await bucket();
assert.equal(after.public, false); assert.equal(Number(after.file_size_limit), LIMIT);
console.log('After:  public=' + after.public + ' file_size_limit=' + after.file_size_limit + ' (25 MB)');

const probe = 'transfer/selftest/' + Date.now();
const put = (name, size) => fetch(api + '/object/' + BUCKET + '/' + probe + '-' + name, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(size) });
const big = await put('big.bin', LIMIT + 1024 * 1024), small = await put('small.bin', 1024);
await fetch(api + '/object/' + BUCKET, { method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [probe + '-big.bin', probe + '-small.bin'] }) });
assert.ok(!big.ok, 'A 26 MB object was accepted');
assert.ok(small.ok, 'A 1 KB object was refused: HTTP ' + small.status);
console.log('Check: 26 MB refused (HTTP ' + big.status + '), 1 KB accepted, both test objects removed.');
