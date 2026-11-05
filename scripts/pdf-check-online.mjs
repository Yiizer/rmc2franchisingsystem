// Renders every active proposal template on the online test version through the transient preview (no inquiry is
// created, nothing is emailed), with deliberately long client details, and saves each PDF plus a page contact sheet.
// Automatic checks: unfilled [slots], the long name/address present, page count, BureauHealth flu-shot wording.
//   node scripts/pdf-check-online.mjs            (uses the Employee test account from the git-ignored credentials file)
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const deployment = 'https://rmc2-test-yiizer.vercel.app', out = path.resolve('test-results/pdf-check-online');
await mkdir(out, { recursive: true });
const cred = (await readFile('test-results/online-credentials/CREDENTIALS.txt', 'utf8')).split(/\r?\n/).map(l => l.match(/^(cryssa@rmc2\.local)\s.*password:\s*(\S+)/)).find(Boolean);
const cli = path.join(path.dirname(spawnSync('where', ['vercel'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]), 'node_modules/vercel/dist/vc.js');
let cookie = '';
function vc(route, json, binary = false) {
  const args = ['curl', '/api/operations/' + route, '--deployment', deployment, '--', '--silent', '--include', '--max-time', '280'];
  if (cookie) args.push('--header', 'Cookie: ' + cookie);
  if (json !== undefined) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
  const r = spawnSync(process.execPath, [cli, ...args], { input: json === undefined ? undefined : Buffer.from(JSON.stringify(json)), ...(binary ? {} : { encoding: 'utf8' }), maxBuffer: 96 << 20 });
  const raw = binary ? r.stdout : Buffer.from(r.stdout || ''), text = raw.toString('latin1');
  const status = Number([...text.slice(0, 4000).matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1]);
  const sc = text.slice(0, 4000).match(/^set-cookie:\s*(rmc2_session=[^;]+)/im); if (sc) cookie = sc[1];
  if (binary) { const i = raw.indexOf('%PDF'); return { status, bytes: i >= 0 ? raw.subarray(i) : null, text: text.slice(-300) }; }
  const body = text.slice(text.search(/\r?\n\r?\n(?!HTTP\/)/)).trim(); let v = body; try { v = JSON.parse(body); } catch {} return { status, v };
}
if (vc('login', { email: cred[1], password: cred[2] }).status !== 200) throw new Error('login failed');
const { templates } = vc('bootstrap').v;
const active = templates.filter(t => t.active).sort((a, b) => a.id.localeCompare(b.id));
const LONG = 'Philippine Long Distance Integrated Manufacturing and Logistics Cooperative of Southern Luzon, Inc.';
const ADDRESS = 'Unit 2405, 24th Floor, Tower 2, The Enterprise Center, 6766 Ayala Avenue corner Paseo de Roxas, Barangay San Lorenzo, Makati City, Metro Manila 1226';
const fields = { company: LONG, address: ADDRESS, addressee: 'Ma. Concepcion Dela Cruz-Villanueva', addresseePosition: 'Human Resources and Administrative Services Manager', addresseeTitle: 'Ms.', agentName: 'Juan Miguel Santos', agentPhone: '(+63) 9175553001', proposalDate: '2026-11-06' };

const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const { createCanvas } = require('@napi-rs/canvas'), sharp = require('sharp');
const report = [];
for (const t of active) {
  const started = Date.now(), r = vc('proposal-preview', { templateId: t.id, fields }, true);
  if (r.status !== 200 || !r.bytes) { report.push({ id: t.id, name: t.name, error: 'HTTP ' + r.status + ' ' + r.text }); console.log('FAIL', t.id, r.status); continue; }
  const file = path.join(out, t.id + '.pdf'); await writeFile(file, r.bytes);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(r.bytes), disableFontFace: true }).promise;
  let text = '', thumbs = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), tc = await page.getTextContent(); text += tc.items.map(i => i.str).join(' ') + '\n';
    const vp = page.getViewport({ scale: 0.5 }), canvas = createCanvas(vp.width, vp.height), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, vp.width, vp.height); await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    thumbs.push(await sharp(canvas.toBuffer('image/png')).resize({ width: 260 }).png().toBuffer());
  }
  const flat = text.replace(/\s+/g, ' ');
  const slots = [...new Set(flat.match(/\[[^\]]{2,60}\]/g) || [])];
  const checks = { pages: doc.numPages, unfilledSlots: slots, longName: flat.includes('Philippine Long Distance Integrated'), address: flat.includes('Ayala Avenue'), addressee: flat.includes('Dela Cruz-Villanueva') || flat.includes('Dela Cruz'), seconds: Math.round((Date.now() - started) / 1000) };
  if (/BureauHealth 7K/i.test(t.name)) checks.fluShot = /FREE for BureauHealth 7,000 only/i.test(flat);
  report.push({ id: t.id, name: t.name, ...checks });
  // contact sheet: 6 per row
  const meta = await sharp(thumbs[0]).metadata(), w = 260, h = meta.height, cols = 6, rows = Math.ceil(thumbs.length / cols);
  await sharp({ create: { width: cols * (w + 6), height: rows * (h + 6), channels: 3, background: '#777' } }).composite(thumbs.map((b, i) => ({ input: b, left: (i % cols) * (w + 6), top: Math.floor(i / cols) * (h + 6) }))).png().toFile(path.join(out, t.id + '-sheet.png'));
  console.log((slots.length || !checks.longName || !checks.address || checks.fluShot === false ? 'CHECK ' : 'OK    ') + t.id.padEnd(5) + ' ' + String(doc.numPages).padStart(2) + 'p ' + checks.seconds + 's  ' + t.name + (slots.length ? '  unfilled: ' + slots.join(', ') : '') + (checks.fluShot === false ? '  flu-shot wording missing' : '') + (!checks.longName ? '  long name missing' : ''));
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
