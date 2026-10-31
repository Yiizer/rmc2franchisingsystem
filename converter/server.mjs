// RMC2 document converter. POST /convert with a DOCX body and the x-converter-secret header; returns the PDF.
// Holds no data: each request uses its own temporary folder, removed afterwards. Macros and links are disabled
// (same profile as lib/operations/document-renderer.ts). One conversion at a time per instance.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const SECRET = (process.env.RMC2_CONVERTER_SECRET || '').trim();
const MAX_BYTES = 4 * 1024 * 1024; // Vercel request bodies are capped at 4.5 MB
let profileReady, queue = Promise.resolve(), waiting = 0;

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const authed = req => SECRET.length >= 32 && same(String(req.headers['x-converter-secret'] || ''), SECRET);
const profile = () => profileReady ??= mkdtemp(path.join(tmpdir(), 'rmc2-office-')).then(async dir => {
  await writeFile(path.join(dir, 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>');
  return dir;
});

async function convert(docx) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rmc2-document-'));
  try {
    const prof = await profile();
    await writeFile(path.join(dir, 'proposal.docx'), docx);
    await run('soffice', ['-env:UserInstallation=' + pathToFileURL(prof).href, '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', dir, path.join(dir, 'proposal.docx')], { timeout: 120000, maxBuffer: 1024 * 1024 });
    return await readFile(path.join(dir, 'proposal.pdf'));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const body = req => new Promise((resolve, reject) => {
  const parts = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject);
});

http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (!authed(req)) return reply(401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health' && req.method === 'GET') return reply(200, { ok: true, libreoffice: (await run('soffice', ['--version'])).stdout.trim() });
    if (url.pathname !== '/convert' || req.method !== 'POST') return reply(404, { error: 'not found' });
    const docx = await body(req);
    if (docx.subarray(0, 2).toString() !== 'PK') return reply(400, { error: 'not a docx' });
    if (waiting >= 4) return reply(429, { error: 'busy' });
    waiting++;
    const task = queue.then(() => convert(docx));
    queue = task.then(() => {}, () => {});
    let pdf; try { pdf = await task; } finally { waiting--; }
    if (pdf.subarray(0, 5).toString() !== '%PDF-') return reply(502, { error: 'conversion produced no pdf' });
    res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
    res.end(pdf);
  } catch (e) {
    console.error('convert failed:', e?.status || '', String(e?.message || e).slice(0, 200));
    reply(e?.status || 500, { error: e?.status === 413 ? 'too large' : 'conversion failed' });
  }
}).listen(Number(process.env.PORT) || 80, () => console.log('converter up'));
