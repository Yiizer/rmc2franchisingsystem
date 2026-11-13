// Rehearses scripts/move-to-production.mjs on made-up data only, on the throwaway databases of scripts/pg-local.mjs:
// source = rmc2_qa (demo accounts plus the fictional inquiries test-workflow creates), target = rmc2_runbook (migrated with
// environment=production). Nothing real is read or written, and pg-local deletes both afterwards.
//   node scripts/pg-local.mjs --pg-dir <dir> -- node scripts/rehearse-move-local.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

for (const name of ['RMC2_LOCAL_OWNER_URL', 'RMC2_LOCAL_PROD_URL', 'RMC2_LOCAL_DATA_DIR', 'RMC2_TEST_URL']) assert.ok(process.env[name], name + ' missing: run this through scripts/pg-local.mjs');
const run = (script, args = [], extra = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...extra }, maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out };
};

// 1. Made-up work in the source: the full workflow (intake, generation, approval, sending to the local test mailbox).
const wf = run('scripts/test-workflow.mjs');
assert.equal(wf.code, 0, 'workflow failed: ' + wf.out.slice(-400));
console.log('Source filled: ' + (wf.out.match(/\d+ checks passed[^\n]*/) || [''])[0]);

// 2. Plan, then move everything (fictional and demo kept on purpose: it is all made up).
const env = { SRC_DB_URL: process.env.RMC2_LOCAL_OWNER_URL, SRC_STORAGE: 'local', SRC_FILES_DIR: process.env.RMC2_LOCAL_DATA_DIR, DST_DB_URL: process.env.RMC2_LOCAL_PROD_URL, DST_STORAGE: 'local', DST_FILES_DIR: path.join(process.env.RMC2_LOCAL_DATA_DIR, '..', path.basename(process.env.RMC2_LOCAL_DATA_DIR) + '-target') };
const planned = run('scripts/move-to-production.mjs', [], env);
console.log(planned.out.trim().split('\n').map(l => '  plan: ' + l).join('\n'));
assert.equal(planned.code, 0, 'plan failed');
const normal = run('scripts/move-to-production.mjs', [], env);
assert.match(normal.out, /left out/, 'the default plan leaves the fictional inquiries out');
const moved = run('scripts/move-to-production.mjs', ['--apply', '--keep-fictional', '--keep-demo-accounts'], env);
console.log(moved.out.trim().split('\n').map(l => '  move: ' + l).join('\n'));
assert.equal(moved.code, 0, 'move failed');
assert.match(moved.out, /MOVED and verified/);

// 3. A second move into the now non-empty target is refused.
const again = run('scripts/move-to-production.mjs', ['--apply', '--keep-fictional', '--keep-demo-accounts'], env);
assert.notEqual(again.code, 0); assert.match(again.out, /already holds inquiries/);
console.log('PASS Rehearsal: plan, move and verify on made-up data; a second move into a filled target is refused');
