import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './database';
import { AppError } from './errors';
import { deleteQuietly, files, type FileStore } from './file-store';
import { logFileAccess } from './file-privacy';
import type { Staff } from './types';

// Files over Vercel's 4.5 MB request/response limit (pilot plan item 2, migration phase 5).
//
// Uploads: the browser asks for a signed upload link (startUpload), sends the file straight to private storage, then
// calls the normal route with "<field>__upload" = the upload id instead of the file. resolveUploads swaps the id back
// for the real file before any existing check runs, so every size, type and content check stays where it is.
// Downloads: after the usual permission check and access log, files over DIRECT_LIMIT are served through a 60-second
// signed link instead of the function body (openPrivateFile).
// On this computer (local storage) neither applies: the store has no signed links and files go through the app.
export const DIRECT_LIMIT = 4 * 1024 * 1024; // headroom under 4.5 MB for form fields and headers
/** The largest upload any route accepts (templates, 15 MB). Routes keep their own smaller limits. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
export const MAX_PENDING_UPLOADS = 10;
/** Signed upload links one person can ask for in an hour (each is logged in file_access as 'upload-start'). */
export const UPLOAD_LINKS_PER_HOUR = 20;
const ROOT = 'transfer', UP = ROOT + '/up';
const SIGNED_SECONDS = 60;

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim();
/** Storage-safe file name that keeps the extension (the routes check it). */
const safeName = (name: string) => clean(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-100).replace(/[. ]+$/, '') || 'file';
const UPLOAD_ID = /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([A-Za-z0-9._-]{1,100})$/;
const userFolder = (user: Staff) => UP + '/' + user.id;
const TYPES: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', eml: 'message/rfc822' };
/** The type the route sees comes from the extension, never from what the browser declared; routes still check the bytes. */
const typeFromName = (name: string) => TYPES[name.split('.').pop()!.toLowerCase()] || 'application/octet-stream';

const startSchema = z.object({
  name: z.string().min(1).max(400),
  size: z.number().int().positive(),
  type: z.string().max(200).optional(),
}).strict();

/** Removes transfer files older than an hour (abandoned uploads, parked attachments). Never throws. */
async function sweep(store: FileStore, now: number) {
  let keys: string[] = [];
  try { keys = await store.list(ROOT); } catch { return keys; }
  const stale = keys.filter(key => { const stamp = /\/(\d{13})-/.exec(key); return !stamp || now - Number(stamp[1]) > UPLOAD_TTL_MS; });
  await deleteQuietly(...stale);
  return keys.filter(key => !stale.includes(key));
}

let lastSweep = 0;
/** Called after workspace responses; runs at most every 10 minutes per server instance. */
export async function sweepTransfers(store: FileStore = files()) {
  const now = Date.now();
  if (!store.signedUploadUrl || now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now; await sweep(store, now);
}

export async function startUpload(user: Staff, input: unknown): Promise<{ mode: 'form' } | { mode: 'signed'; id: string; url: string }> {
  const body = startSchema.parse(input);
  if (body.size > MAX_UPLOAD_BYTES) throw new AppError('Files must be smaller than 15 MB.', 413);
  const store = files();
  if (!store.signedUploadUrl) return { mode: 'form' };
  const now = Date.now(), live = await sweep(store, now);
  if (live.filter(key => key.startsWith(userFolder(user) + '/')).length >= MAX_PENDING_UPLOADS) throw new AppError('Too many uploads are in progress. Wait a minute and try again.', 429);
  // Links are counted when issued, not when a file arrives, so nobody can collect links and fill storage later.
  const issued = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM file_access WHERE user_id=? AND kind='upload-start' AND at>?", user.id, new Date(now - UPLOAD_TTL_MS).toISOString());
  if (Number(issued?.n || 0) >= UPLOAD_LINKS_PER_HOUR) throw new AppError('Too many large uploads in the last hour. Try again later.', 429);
  const id = now + '-' + randomUUID() + '/' + safeName(body.name);
  const url = await store.signedUploadUrl(userFolder(user) + '/' + id);
  await logFileAccess(user, 'upload', 'upload-start');
  return { mode: 'signed', id, url };
}

/** Replaces each "<field>__upload" id with the uploaded file (named from "<field>__name"), and deletes the stored copy. */
export async function resolveUploads(user: Staff, form: FormData): Promise<FormData> {
  const entries = [...form.entries()];
  if (!entries.some(([name]) => name.endsWith('__upload'))) return form;
  const out = new FormData(), store = files();
  for (const [name, value] of entries) {
    if (name.endsWith('__name')) continue;
    const field = /^([A-Za-z][A-Za-z0-9_-]{0,40})__upload$/.exec(name)?.[1];
    if (!field) { out.append(name, value); continue; }
    const match = typeof value === 'string' ? UPLOAD_ID.exec(value) : null;
    if (!match) throw new AppError('The uploaded file reference is not valid. Choose the file again.', 400);
    if (Date.now() - Number(match[1]) > UPLOAD_TTL_MS) throw new AppError('The upload expired. Choose the file again.', 410);
    // The key is built from the signed-in user, so nobody can claim someone else's upload.
    const key = userFolder(user) + '/' + value;
    const stat = await store.stat(key);
    if (!stat) throw new AppError('The upload did not finish. Choose the file again.', 400);
    if (stat.size > MAX_UPLOAD_BYTES) { await deleteQuietly(key); throw new AppError('Files must be smaller than 15 MB.', 413); }
    const bytes = await store.get(key);
    await deleteQuietly(key);
    // The object could have been replaced between stat and get; check what was actually read.
    if (bytes.length > MAX_UPLOAD_BYTES) throw new AppError('Files must be smaller than 15 MB.', 413);
    const given = form.get(field + '__name'), label = typeof given === 'string' && clean(given) ? clean(given).slice(0, 200) : match[2];
    out.append(field, new File([new Uint8Array(bytes)], label, { type: typeFromName(match[2]) }));
  }
  return out;
}

/**
 * A private file after the caller's permission check: small files (and everything on local storage) come back as
 * bytes; larger ones as a 60-second signed link. Both log the access.
 */
export async function openPrivateFile(user: Staff, inquiryId: string, kind: string, key: string, name: string, attachment: boolean): Promise<{ bytes: Buffer } | { url: string }> {
  const store = files();
  if (store.signedDownloadUrl) {
    const stat = await store.stat(key);
    if (stat && stat.size > DIRECT_LIMIT) {
      const signed = await store.signedDownloadUrl(key, SIGNED_SECONDS);
      await logFileAccess(user, inquiryId, kind);
      return { url: attachment ? signed + (signed.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(safeName(name)) : signed };
    }
  }
  const bytes = await store.get(key);
  await logFileAccess(user, inquiryId, kind);
  return { bytes };
}

/** Bytes made on the fly (an email attachment): over DIRECT_LIMIT online they are parked for an hour and linked. */
export async function bytesOrLink(bytes: Buffer, contentType: string, name: string, attachment: boolean): Promise<{ bytes: Buffer } | { url: string }> {
  const store = files();
  if (bytes.length <= DIRECT_LIMIT || !store.signedDownloadUrl) return { bytes };
  const now = Date.now(), key = ROOT + '/down/' + now + '-' + randomUUID() + '/' + safeName(name);
  await sweep(store, now);
  await store.put(key, bytes, { contentType, mode: 'create' });
  const signed = await store.signedDownloadUrl(key, SIGNED_SECONDS);
  return { url: attachment ? signed + (signed.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(safeName(name)) : signed };
}
