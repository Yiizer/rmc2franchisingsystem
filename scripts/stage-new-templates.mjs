// Stages the November 2026 template versions on the online test version through Template admin (the same checks
// and converter as a manual upload), and saves each preview PDF for review. Nothing is published unless PUBLISH lists
// stage ids. Templates are replaced in place: same template id, family, variant, sector and warnings.
//   node scripts/stage-new-templates.mjs                       stage all, save previews
//   ONLY=d024,d054 node scripts/stage-new-templates.mjs        stage some
//   PUBLISH=<stageId>,<stageId> node scripts/stage-new-templates.mjs   publish reviewed stages
// Runs through `vercel curl` with the admin test account from the git-ignored credentials file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const deployment = 'https://rmc2-test-yiizer.vercel.app', out = 'test-results/template-update-2026-11';
const DL = 'D:/DOWNLOADS';
const source = {
  d024: 'BUREAUHEALTH PROPOSAL TEMPLATES-20261105T120647Z-1-001 NOV/BUREAUHEALTH PROPOSAL TEMPLATES/RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K - 001.docx',
  d025: 'BUREAUHEALTH PROPOSAL TEMPLATES-20261105T120647Z-1-001 NOV/BUREAUHEALTH PROPOSAL TEMPLATES/RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K PEC & DREADED COVERED - 001.docx',
  d026: 'BUREAUHEALTH PROPOSAL TEMPLATES-20261105T120647Z-1-001 NOV/BUREAUHEALTH PROPOSAL TEMPLATES/RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K PEC COVERED - 001.docx',
  d097: 'BUREAUHEALTH PROPOSAL TEMPLATES-20261105T120647Z-1-001 NOV/BUREAUHEALTH PROPOSAL TEMPLATES/RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K DEPED SEMI ANNUAL OP LIMIT - 001.docx',
  d054: 'TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES-20261105T120651Z-1-001 NOV/TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK - 001.docx',
  d055: 'TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES-20261105T120651Z-1-001 NOV/TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK PEC & DREADED COVERED - 001.docx',
  d056: 'TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES-20261105T120651Z-1-001 NOV/TOTAL CORPOHEALTHCHECK PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK PEC COVERED - 001.docx',
  d091: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/CORPOAIDE 2 TEMPLATES/RMC2 - PROPOSAL - CORPOAIDE 2 - 001.docx',
  d092: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/CORPOAIDE 2 TEMPLATES/RMC2 - PROPOSAL - CORPOAIDE 2 PEC AND DREADED COVERED - 001.docx',
  d093: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/CORPOAIDE 2 TEMPLATES/RMC2 - PROPOSAL - CORPOAIDE 2 PEC COVERED - 001.docx',
  d094: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOSHIELD - 001.docx',
  d095: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOSHIELD PEC & DREADED COVERED - 001.docx',
  d096: 'TOTAL CORPOSHIELD PROPOSAL TEMPLATES-20261105T120652Z-1-001 NOV/TOTAL CORPOSHIELD PROPOSAL TEMPLATES/RMC2 - PROPOSAL - TOTAL CORPOSHIELD PEC COVERED - 001.docx',
};
// A fixed copy (e.g. with the header signature moved) can be supplied per template: OVERRIDE_d094=path/to/file.docx
const fileFor = id => process.env['OVERRIDE_' + id] || path.join(DL, source[id]);

const passwords = Object.fromEntries((await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^(\S+@rmc2\.local)\s.*password:\s*(\S+)/)).filter(Boolean).map(m => [m[1].split('@')[0], m[2]]));
const vercelCli = path.join(path.dirname(spawnSync(process.platform === 'win32' ? 'where' : 'which', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
let cookie = '';
function vc(route, { json, form, file, expected = 200, binary = false } = {}) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', '--include', '--max-time', '280'];
  if (cookie) args.push('--header', 'Cookie: ' + cookie);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) for (const [key, value] of Object.entries(form)) args.push('--form-string', key + '=' + value);
  if (file) args.push('--form', 'file=@' + file);
  const result = spawnSync(process.execPath, [vercelCli, ...args], { input: json === undefined ? undefined : JSON.stringify(json), encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 << 20 });
  const raw = binary ? result.stdout : Buffer.from(result.stdout || ''), marker = raw.indexOf('\r\n\r\n%PDF') >= 0 ? raw.indexOf('\r\n\r\n%PDF') : -1;
  const text = raw.toString('latin1'), split = marker >= 0 ? marker : text.search(/\r?\n\r?\n(?!HTTP\/)/), head = text.slice(0, split);
  const status = Number([...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const setCookie = head.match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (setCookie) cookie = setCookie[1];
  if (binary) { assert.equal(status, expected, route); return raw.subarray(raw.indexOf('%PDF')); }
  const body = Buffer.from(text.slice(split), 'latin1').toString('utf8').trim(); let value = body; try { value = JSON.parse(body); } catch {}
  assert.equal(status, expected, route + ': ' + JSON.stringify(value).slice(0, 400));
  return value;
}

await mkdir(out, { recursive: true });
vc('login', { json: { email: 'admin@rmc2.local', password: passwords.admin } });
if (process.env.PUBLISH) {
  for (const id of process.env.PUBLISH.split(',').filter(Boolean)) { const r = vc('template-publish', { json: { id, reviewed: true } }); console.log('PUBLISHED', r.template.id, r.template.sourceHash.slice(0, 12)); }
  process.exit(0);
}
const { templates } = vc('bootstrap');
const wanted = (process.env.ONLY || Object.keys(source).join(',')).split(',');
const staged = [];
for (const id of wanted) {
  const current = templates.find(t => t.id === id); assert.ok(current, 'template ' + id + ' is not in the online catalog');
  try {
    const r = vc('template-upload', { expected: 201, file: fileFor(id), form: { templateId: id, expectedHash: current.sourceHash, family: current.family, variant: current.variant, sector: current.sector, annualOnly: String(current.annualOnly), warnings: (current.warnings || []).join('\n') } });
    const pdf = vc('template-stage/' + r.id, { binary: true });
    await writeFile(path.join(out, id + '-new.pdf'), pdf);
    staged.push({ id, stageId: r.id, pages: r.pages, hash: r.template.sourceHash });
    console.log('STAGED', id, r.pages + ' pages', 'stage ' + r.id);
  } catch (error) { console.log('FAILED', id, error.message.slice(0, 300)); }
}
await writeFile(path.join(out, 'staged.json'), JSON.stringify(staged, null, 2));
