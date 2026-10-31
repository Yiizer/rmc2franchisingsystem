import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { isStorageError } from './file-store-core';
import { dataRoot } from './paths';
import { createLocalStore } from './file-store-local';
import { createSupabaseStore } from './file-store-supabase';

export { MAX_OBJECT_BYTES, StorageError, assertKey, assertPrefix, isStorageError } from './file-store-core';
export type { StorageErrorCode } from './file-store-core';

// One interface for every private data file (uploads, generated documents, emails, archived masters).
// Callers never touch the disk directly. Rule: never call files() inside transaction() (see TEAM_DECISIONS.md).

/** Relative POSIX path, identical to the values already stored in database records. */
export type FileKey = string;
/** create = fail with `exists` when the key is taken (today's "wx"); replace = overwrite. */
export type PutMode = 'create' | 'replace';
export interface FileStat { size: number; contentType?: string }
export interface FileStore {
  readonly kind: 'local' | 'supabase';
  /** `timeoutMs` shortens the remote request timeout for latency-sensitive callers (ignored by the local adapter). */
  put(key: FileKey, bytes: Uint8Array, opts: { contentType: string; mode?: PutMode; timeoutMs?: number }): Promise<void>;
  get(key: FileKey, opts?: { timeoutMs?: number }): Promise<Buffer>;
  stat(key: FileKey): Promise<FileStat | null>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: FileKey): Promise<void>;
  /** Recursive list of every key under a folder prefix ('' = everything). Maintenance and tests only. */
  list(prefix: string): Promise<FileKey[]>;
  /** Remote stores only: the URL an anonymous visitor would use, so the health check can prove the bucket is private. */
  publicUrl?(key: FileKey): string;
}

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  eml: 'message/rfc822',
  text: 'text/plain',
} as const;

export type FileStoreConfig =
  | { kind: 'local'; root: string; maxBytes?: number }
  | { kind: 'supabase'; url: string; secretKey: string; bucket: string; prefix?: string; maxBytes?: number; timeoutMs?: number };

/** Reads RMC2_STORAGE and friends. Errors name variables, never values. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env, root: string = dataRoot): FileStoreConfig {
  const kind = (env.RMC2_STORAGE || 'local').trim();
  if (kind !== 'local' && kind !== 'supabase') throw new Error('RMC2_STORAGE must be "local" or "supabase".');
  if (kind === 'local') {
    if (env.VERCEL) throw new Error('RMC2_STORAGE=supabase is required on Vercel (local disk is ephemeral).');
    return { kind: 'local', root };
  }
  const missing = ['RMC2_SUPABASE_URL', 'RMC2_SUPABASE_SECRET_KEY', 'RMC2_STORAGE_BUCKET'].filter(name => !env[name]?.trim());
  if (missing.length) throw new Error('RMC2_STORAGE=supabase also requires: ' + missing.join(', ') + '.');
  const prefix = env.RMC2_STORAGE_PREFIX?.trim();
  return { kind: 'supabase', url: env.RMC2_SUPABASE_URL!.trim(), secretKey: env.RMC2_SUPABASE_SECRET_KEY!.trim(), bucket: env.RMC2_STORAGE_BUCKET!.trim(), ...(prefix ? { prefix } : {}) };
}

export function createFileStore(cfg: FileStoreConfig): FileStore {
  return cfg.kind === 'local' ? createLocalStore(cfg) : createSupabaseStore(cfg);
}

// One store per process, shared by every module copy and hot reload (like the database).
type FilesGlobal = typeof globalThis & { rmc2Files?: FileStore };
export function files(): FileStore {
  const shared = globalThis as FilesGlobal;
  return shared.rmc2Files ?? (shared.rmc2Files = createFileStore(storageConfigFromEnv()));
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/**
 * Content-addressed object (key derived from the hash): create it, and if it already exists confirm the stored
 * bytes really hash to `sha256`. Never deleted by rollbacks because other records may reference it.
 */
export async function putContentAddressed(key: FileKey, bytes: Uint8Array, sha256Hex: string, contentType: string, mismatchMessage: string, store: FileStore = files()): Promise<void> {
  try { await store.put(key, bytes, { contentType, mode: 'create' }); return; }
  catch (error) { if (!isStorageError(error) || error.code !== 'exists') throw error; }
  if (sha256(await store.get(key)) !== sha256Hex) throw new AppError(mismatchMessage, 409);
}

/** Best-effort cleanup of per-request keys after a failed transaction. Never throws; logs key and code only. */
export async function deleteQuietly(...keys: (FileKey | undefined)[]): Promise<void> {
  for (const key of keys) if (key) {
    try { await files().delete(key); }
    catch (error) { console.error('[storage] cleanup failed key=' + key + ' code=' + (isStorageError(error) ? error.code : 'error')); /* an orphan is harmless; a later sweep removes it */ }
  }
}
