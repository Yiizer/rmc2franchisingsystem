// Child process for the Phase 4 Postgres concurrency tests (scripts/test-pg-concurrency.mjs).
// One process = one pool = one more "instance" of the app talking to the same database.
// usage: node scripts/db-parity/worker.mjs <op> <startAtEpochMs> '<json args>'
// Ops: intake | touch | sync | holdlock
// Prints one line "RESULT {json}" and exits. The connection string is never printed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { databaseUrl, maskText, root } from './lib.mjs';

const [op, startAtText, jsonText = '{}'] = process.argv.slice(2);
const args = JSON.parse(jsonText);
const startAt = Number(startAtText) || 0;
Object.assign(process.env, {
  RMC2_DB: 'postgres', RMC2_DATABASE_URL: databaseUrl(), RMC2_SEED_DEMO: '1',
  RMC2_DATA_DIR: path.join(root, 'test-results', 'qa-phase4', 'worker-data', String(process.pid)),
  RMC2_STORAGE: 'local',
});
for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL_|SMTP_)/.test(key) || key === 'VERCEL') delete process.env[key];
register();
const imp = file => import(pathToFileURL(path.join(root, 'lib', 'operations', file)).href);
const out = value => console.log('RESULT ' + JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// startAt = 0: print READY and wait for "GO" on stdin (the parent releases all workers together once every pool is warm).
const waitFor = async () => {
  if (!startAt) { console.log('READY'); await new Promise(resolve => process.stdin.once('data', resolve)); return; }
  const left = startAt - Date.now(); if (left > 0) await sleep(left);
};

try {
  const database = await imp('database.ts');
  await database.ensureReady();
  await Promise.all([1, 2, 3].map(() => database.db.get('SELECT 1 AS x'))); // warm the pool before the barrier
  const users = await database.allUsers();
  const user = id => users.find(u => u.id === id);

  if (op === 'intake') {
    const svc = await imp('service.ts'), forms = await imp('forms.ts');
    const one = async (spec) => {
      const fields = { company: spec.company, sector: 'Private', agentName: spec.agent, agentEmail: spec.sender, agentPhone: '09171234567', contactName: 'Contact of ' + spec.company, addressee: 'Contact of ' + spec.company, contactEmail: 'contact@example.test', division: 'Division 1' };
      const bytes = await forms.sampleForm(fields);
      const started = Date.now();
      try {
        const record = await svc.intake(user(spec.user || 'cryssa'), new File([bytes], spec.agent.replace(/\W+/g, '-') + '.xlsx'), spec.sender);
        return { ok: true, id: record.id, state: record.clientReview?.state, matches: (record.clientReview?.matches || []).map(m => m.inquiryId), ms: Date.now() - started };
      } catch (error) { return { ok: false, status: error.status, message: String(error.message).slice(0, 200), ms: Date.now() - started }; }
    };
    await waitFor();
    if (args.serial) { const list = []; for (const s of args.specs) list.push(await one(s)); out(list); } else out(await Promise.all(args.specs.map(one)));
  } else if (op === 'touch') {
    // Concurrent writers: bump revision + note of the given inquiries through the app's persist().
    await waitFor();
    const end = Date.now() + args.ms; let writes = 0, conflicts = 0;
    while (Date.now() < end) {
      for (const id of args.ids) {
        try {
          await database.transaction(async () => {
            const record = await database.inquiry(id); const revision = record.revision;
            record.notes = `touch ${args.tag} ${writes}`; record.revision++; record.updatedAt = new Date().toISOString();
            await database.persist(record, revision);
          });
          writes++;
        } catch (error) { if (error.status === 409) conflicts++; else throw error; }
      }
    }
    out({ writes, conflicts });
  } else if (op === 'sync') {
    const index = await imp('inquiry-index.ts');
    await waitFor();
    const end = Date.now() + args.ms; let calls = 0, errors = [];
    while (Date.now() < end) { try { await index.synchronizeInquiryIndex(); calls++; } catch (error) { errors.push(String(error.status || '') + ' ' + String(error.message).slice(0, 80)); } await sleep(args.pause ?? 0); }
    out({ calls, errors: errors.slice(0, 5), errorCount: errors.length });
  } else if (op === 'holdlock') {
    // Holds advisory locks (transaction scoped) for args.ms so another process can hit a lock timeout.
    await waitFor();
    await database.transaction(async () => { await database.db.lock(...args.keys); out({ locked: true, at: Date.now() }); console.log(''); await sleep(args.ms); });
    out({ released: true });
  } else throw new Error('unknown op ' + op);
  await database.db.close?.();
  process.exit(0);
} catch (error) {
  console.log('RESULT ' + JSON.stringify({ fatal: maskText(error?.message || error).slice(0, 300), status: error?.status }));
  process.exit(3);
}
