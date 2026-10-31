// Config tests: resource paths, RMC2_RESOURCES_DIR override, demo-seed gating. Pure; throwaway dirs under test-results/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = process.cwd();
const base = path.resolve('test-results', 'config', String(Date.now()));
if (/[\/]\.data([\/]|$)/.test(base)) throw new Error('refusing to run against .data');
mkdirSync(base, { recursive: true });

// 1. paths (in-process)
for (const key of ['RMC2_RESOURCES_DIR', 'RMC2_SEED_DEMO']) delete process.env[key];
process.env.RMC2_DATA_DIR = path.join(base, 'paths-data');
register();
const paths = await import(pathToFileURL(path.resolve('lib/operations/paths.ts')).href);
assert.equal(paths.resourcesRoot(), path.join(root, 'resources', 'private'), 'default resources dir equals today');
assert.equal(paths.resourceFile('catalog.json'), path.join(root, 'resources', 'private', 'catalog.json'));
assert.equal(paths.dataRoot, path.resolve(base, 'paths-data'));
assert.equal(paths.historicalSchemaFile(), path.join(root, 'lib', 'operations', 'historical-schema.sql'));
const custom = path.join(base, 'custom-resources');
process.env.RMC2_RESOURCES_DIR = custom;
assert.equal(paths.resourcesRoot(), custom, 'override works');
delete process.env.RMC2_RESOURCES_DIR;
const env = (o) => { const e = { ...process.env, ...o }; for (const k of Object.keys(o)) if (o[k] === undefined) delete e[k]; return e; };
const seedAllowed = (nodeEnv, flag) => { const e = env({ NODE_ENV: nodeEnv, RMC2_SEED_DEMO: flag }); return spawnSync(process.execPath, ['--import', 'tsx', '-e', `import('./lib/operations/paths.ts').then(m=>console.log(m.demoSeedAllowed()))`], { cwd: root, env: e, encoding: 'utf8' }).stdout.trim() === 'true'; };
assert.equal(seedAllowed('development', undefined), true, 'dev default seeds');
assert.equal(seedAllowed('test', undefined), true);
assert.equal(seedAllowed('development', '0'), false);
assert.equal(seedAllowed('production', undefined), false, 'production default does not seed');
assert.equal(seedAllowed('production', '0'), false);
assert.equal(seedAllowed('production', '1'), true, 'production explicit seeds');

// 2. real database in child processes (the store is a per-process singleton)
function run(name, o) {
  const data = path.join(base, name);
  const script = `import('./lib/operations/database.ts').then(async m=>{const u=(await m.db.get('SELECT count(*) n FROM users')).n,i=(await m.db.get('SELECT count(*) n FROM inquiries')).n;console.log(JSON.stringify({u,i,cat:(await m.catalog()).length}))})`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: root, env: env({ RMC2_DATA_DIR: data, RMC2_RESOURCES_DIR: path.join(base, 'res-' + name), ...o }), encoding: 'utf8' });
  assert.equal(r.status, 0, name + ': ' + r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
mkdirSync(path.join(base, 'res-prod-none'), { recursive: true });
writeFileSync(path.join(base, 'res-prod-none', 'catalog.json'), JSON.stringify([{ id: 'T1', sourceId: 'X1', file: 'a.docx', active: true }]));
const prodNone = run('prod-none', { NODE_ENV: 'production', RMC2_SEED_DEMO: undefined });
assert.deepEqual([prodNone.u, prodNone.i], [0, 0], 'production without flag creates no demo users/inquiries');
assert.equal(prodNone.cat, 1, 'RMC2_RESOURCES_DIR catalog is read');
const prodSeed = run('prod-seed', { NODE_ENV: 'production', RMC2_SEED_DEMO: '1' });
assert.deepEqual([prodSeed.u, prodSeed.i], [6, 4], 'production with flag seeds as before');
const dev = run('dev', { NODE_ENV: 'development', RMC2_SEED_DEMO: undefined });
assert.deepEqual([dev.u, dev.i], [6, 4], 'dev default seeds as before');
console.log('config tests passed');
rmSync(base, { recursive: true, force: true });
