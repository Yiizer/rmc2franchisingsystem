import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AppError } from './database';
import { restoreHeaderArtwork } from './office-artwork';

const execute = promisify(execFile);
let converterQueue = Promise.resolve();
let pending = 0;
const previews = new Map<string, { bytes: Buffer; pageCount: number; expires: number }>();
let previewBytes = 0;
// Reuse a private profile after its first initialization. A new profile for
// every keystroke forces expensive office/font setup on each preview.
let profileReady:Promise<string>|undefined;
function prepareProfile() {
  // A short temporary path also avoids Windows MAX_PATH failures inside the
  // office extension cache when the application checkout path is long.
  return profileReady ??= mkdtemp(path.join(tmpdir(),'rmc2-office-')).then(async profile=>{
    await writeFile(path.join(profile,'registrymodifications.xcu'),'<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>');
    return profile;
  });
}

function officePath() {
  return [process.env.RMC2_OFFICE_EXECUTABLE,
    path.join(process.cwd(), '../.rmc2-tools/office-extracted/SourceDir/LibreOffice/program/soffice.com'),
    path.join(process.cwd(), '.data/tools/office-extracted/SourceDir/LibreOffice/program/soffice.com'),
    path.join(process.cwd(), '.data/tools/libreoffice/program/soffice.com'),
    path.join(process.cwd(), '.data/tools/libreoffice/program/soffice.exe'),
    'C:/Program Files/LibreOffice/program/soffice.com',
    'C:/Program Files/LibreOffice/program/soffice.exe', '/usr/bin/libreoffice', '/usr/bin/soffice']
    .find((candidate): candidate is string => !!candidate && existsSync(candidate));
}
export const conversionName = () => officePath() ? 'LibreOffice · original Word layout' : 'Document converter needs setup';

async function convert(bytes: Buffer): Promise<{ bytes: Buffer; pageCount: number }> {
  const executable = officePath();
  if (!executable) throw new AppError('The proposal preview needs local LibreOffice to preserve the template layout. See LOCALHOST.md.', 503);
  const directory = await mkdtemp(path.join(tmpdir(), 'rmc2-document-'));
  let pdf: Buffer;
  try {
    // Use hash-checked supplied masters, disable macros and link updates,
    // and export PDF only. Never save back or reconstruct the source DOCX.
    const profile = await prepareProfile();
    await writeFile(path.join(directory, 'proposal.docx'), bytes);
    await execute(executable, ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', directory, path.join(directory, 'proposal.docx')], { timeout: 90000, windowsHide: true, maxBuffer: 1024 * 1024 });
    pdf = await restoreHeaderArtwork(bytes,await readFile(path.join(directory, 'proposal.pdf')));
  } catch(error) {
    console.error('Local document conversion failed:',error instanceof Error?error.message:String(error));
    throw new AppError('The document converter could not prepare the proposal. Your saved details are safe. Try again.', 503);
  } finally {
    // Only the unique temporary directory just created for this conversion.
    // Windows office processes can briefly retain an export scratch-file
    // handle after exit. Retry cleanup instead of losing a successful PDF.
    await rm(directory, { recursive: true, force: true, maxRetries:8, retryDelay:250 });
  }
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new AppError('The converter returned an invalid document.', 503);
  return { bytes: pdf, pageCount: pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length || 0 };
}

/** The editor and generated approval package use the same native renderer.
 * Source artwork is interpreted directly, with no HTML/logo recreation. */
export async function pdfFromDocx(bytes: Buffer, preview = false) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const cached = previews.get(hash);
  if (cached && cached.expires > Date.now()) return cached;
  if (pending >= 6) throw new AppError('The document preview is busy. Please try again shortly.', 429);
  pending++;
  const task = converterQueue.then(async () => {
    const ready = previews.get(hash);
    if (ready && ready.expires > Date.now()) return ready;
    const result = await convert(bytes);
    if (preview) {
      if (cached) { previewBytes -= cached.bytes.length; previews.delete(hash); }
      while (previews.size >= 24 || previewBytes + result.bytes.length > 32 * 1024 * 1024) {
        const first = previews.keys().next().value;
        if (!first) break;
        previewBytes -= previews.get(first)!.bytes.length; previews.delete(first);
      }
      if (result.bytes.length <= 32 * 1024 * 1024) {
        previews.set(hash, { ...result, expires: Date.now() + 15 * 60 * 1000 }); previewBytes += result.bytes.length;
      }
    }
    return result;
  });
  converterQueue = task.then(() => {}, () => {});
  try { return await task; } finally { pending--; }
}
