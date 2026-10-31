import { MAX_OBJECT_BYTES, StorageError, assertKey, assertPrefix } from './file-store-core';
import type { FileStat, FileStore } from './file-store';

// Supabase Storage over plain fetch (no SDK). The secret key stays server-side and is only ever sent in request
// headers; logs carry operation, HTTP status, Supabase status code and key, never headers or the key value.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Reply = { status: number; body: Buffer; retried: boolean };

export function createSupabaseStore(cfg: { url: string; secretKey: string; bucket: string; prefix?: string; maxBytes?: number; timeoutMs?: number }): FileStore {
  // Configuration errors are plain Errors (HTTP 500, only the variable name in the message), not per-request 400s.
  let parsed: URL;
  try { parsed = new URL(cfg.url); } catch { throw new Error('RMC2_SUPABASE_URL is not a valid URL.'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('RMC2_SUPABASE_URL must use https.');
  let prefix = '';
  try { prefix = cfg.prefix ? assertPrefix(cfg.prefix) : ''; } catch { throw new Error('RMC2_STORAGE_PREFIX is not a valid folder path.'); }
  const api = cfg.url.replace(/\/+$/, '') + '/storage/v1', bucket = encodeURIComponent(cfg.bucket);
  const max = cfg.maxBytes ?? MAX_OBJECT_BYTES, timeout = cfg.timeoutMs ?? 30000;
  const secret = { apikey: cfg.secretKey, Authorization: 'Bearer ' + cfg.secretKey };
  const full = (key: string) => (prefix ? prefix + '/' + key : key);
  const path = (key: string) => full(key).split('/').map(encodeURIComponent).join('/');

  // One retry (after a short pause) on a network error, timeout or 5xx; the second outcome is returned as is.
  async function request(op: string, key: string, url: string, init: { method: string; headers?: Record<string, string>; body?: BodyInit }, retries: number, timeoutMs: number = timeout): Promise<Reply> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { ...init, headers: { ...secret, ...init.headers }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
        const body = Buffer.from(await response.arrayBuffer());
        if (response.status >= 500 && attempt < retries) { await sleep(250); continue; }
        return { status: response.status, body, retried: attempt > 0 };
      } catch {
        if (attempt < retries) { await sleep(250); continue; }
        console.error('[storage] supabase ' + op + ' network error key=' + key);
        throw new StorageError('unavailable');
      }
    }
  }
  // Supabase often answers HTTP 400 with {statusCode:"404"|"409"}; read both.
  function failure(op: string, key: string, reply: Reply): StorageError {
    let info: { statusCode?: unknown; error?: unknown; message?: unknown } = {};
    try { info = JSON.parse(reply.body.toString('utf8')); } catch { /* not JSON */ }
    const code = Number(info.statusCode) || reply.status, text = String(info.error ?? '') + ' ' + String(info.message ?? '');
    let mapped: StorageError;
    if (/bucket not found/i.test(text)) mapped = new StorageError('unavailable');
    // Only Supabase's own "object not found" body means a missing file; a bare gateway/proxy 404 is an outage or misconfiguration.
    else if (code === 404) mapped = /not_found|object not found/i.test(text) ? new StorageError('not_found') : new StorageError('unavailable');
    else if (code === 409 || /duplicate/i.test(String(info.error ?? ''))) mapped = new StorageError('exists');
    else if (code === 413) mapped = new StorageError('too_large');
    else if (code === 400) mapped = new StorageError('invalid_key');
    else mapped = new StorageError('unavailable');
    if (mapped.code === 'unavailable' || mapped.code === 'invalid_key') console.error('[storage] supabase ' + op + ' failed status=' + reply.status + ' code=' + code + ' key=' + key);
    return mapped;
  }
  const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;
  const json = (op: string, key: string, reply: Reply) => { try { return JSON.parse(reply.body.toString('utf8')); } catch { console.error('[storage] supabase ' + op + ' unreadable reply key=' + key); throw new StorageError('unavailable'); } };

  async function get(key: string, opts?: { timeoutMs?: number }): Promise<Buffer> {
    assertKey(key);
    const reply = await request('get', key, `${api}/object/authenticated/${bucket}/${path(key)}`, { method: 'GET' }, 1, opts?.timeoutMs);
    if (!ok(reply)) throw failure('get', key, reply);
    return reply.body;
  }
  async function listFolder(folder: string, out: string[]) {
    for (let offset = 0; ; offset += 1000) {
      const reply = await request('list', folder, `${api}/object/list/${bucket}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) }, 1);
      if (!ok(reply)) throw failure('list', folder, reply);
      const items = json('list', folder, reply) as { name: string; id: string | null }[];
      for (const item of items) {
        const name = folder ? folder + '/' + item.name : item.name;
        if (item.id === null || item.id === undefined) await listFolder(name, out);
        else if (item.name !== '.emptyFolderPlaceholder') out.push(name);
      }
      if (items.length < 1000) return;
    }
  }
  return {
    kind: 'supabase',
    async put(key, bytes, opts) {
      assertKey(key);
      if (bytes.byteLength > max) throw new StorageError('too_large');
      const mode = opts.mode ?? 'create';
      const reply = await request('put', key, `${api}/object/${bucket}/${path(key)}`, { method: 'POST', headers: { 'Content-Type': opts.contentType, 'x-upsert': String(mode === 'replace') }, body: bytes as unknown as BodyInit }, 1, opts.timeoutMs);
      if (ok(reply)) return;
      const error = failure('put', key, reply);
      // A retried create can find its own first attempt: equal bytes mean the write already happened.
      if (error.code === 'exists' && reply.retried && mode === 'create') { const stored = await get(key); if (stored.equals(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) return; }
      // A 404 on upload means the bucket or project is wrong, not that a file is missing.
      throw error.code === 'not_found' ? new StorageError('unavailable') : error;
    },
    get,
    publicUrl(key) { assertKey(key); return `${api}/object/public/${bucket}/${path(key)}`; },
    async stat(key): Promise<FileStat | null> {
      assertKey(key);
      const reply = await request('stat', key, `${api}/object/info/authenticated/${bucket}/${path(key)}`, { method: 'GET' }, 1);
      if (!ok(reply)) { const error = failure('stat', key, reply); if (error.code === 'not_found') return null; throw error; }
      const info = json('stat', key, reply) as { size?: number; content_type?: string; metadata?: { size?: number; mimetype?: string } };
      return { size: Number(info.size ?? info.metadata?.size ?? 0), ...(info.content_type ?? info.metadata?.mimetype ? { contentType: info.content_type ?? info.metadata?.mimetype } : {}) };
    },
    async delete(key) {
      assertKey(key);
      const reply = await request('delete', key, `${api}/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [full(key)] }) }, 1);
      if (ok(reply)) return;
      const error = failure('delete', key, reply);
      if (error.code !== 'not_found') throw error;
    },
    async list(folder) {
      const base = assertPrefix(folder), out: string[] = [];
      await listFolder(full(base).replace(/^\/+|\/+$/g, ''), out);
      return out.map(name => (prefix ? name.slice(prefix.length + 1) : name)).sort();
    },
  };
}
