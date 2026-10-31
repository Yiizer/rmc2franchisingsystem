import { AppError } from './errors';

// Leaf module (imports only errors.ts): shared by file-store.ts and both adapters without an import cycle.

export type StorageErrorCode = 'not_found' | 'exists' | 'invalid_key' | 'too_large' | 'unavailable';
const SAFE_MESSAGE: Record<StorageErrorCode, string> = {
  not_found: 'The stored file is missing. Contact your administrator.',
  exists: 'The file already exists.',
  invalid_key: 'Invalid stored file path',
  too_large: 'The file is too large to store.',
  unavailable: 'File storage is unavailable. Try again.',
};
const STATUS: Record<StorageErrorCode, number> = { not_found: 404, exists: 409, invalid_key: 400, too_large: 413, unavailable: 503 };
/** Messages never contain paths, URLs, bucket names or keys. */
export class StorageError extends AppError {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string = SAFE_MESSAGE[code]) { super(message, STATUS[code]); this.code = code; this.name = 'StorageError'; }
}
/** Shape check that survives duplicated module copies (bundler chunks, hot reload), where instanceof can fail. */
export function isStorageError(error: unknown): error is StorageError {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  return !!candidate && typeof candidate === 'object' && candidate.name === 'StorageError' && typeof candidate.code === 'string';
}

/** App limits (7 MB uploads, 15 MB templates) stay at the callers; this only protects the store itself. */
export const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export function assertKey(key: string): string {
  const invalid = () => new StorageError('invalid_key');
  if (typeof key !== 'string' || !key || key.length > 512 || key.startsWith('/') || key.endsWith('/') || key.includes('\\') || key.includes(':')) throw invalid();
  for (let i = 0; i < key.length; i++) { const code = key.charCodeAt(i); if (code < 32 || code === 127) throw invalid(); }
  for (const segment of key.split('/')) {
    // Windows silently strips trailing dots/spaces and reserves device names, so those would alias other keys.
    if (!segment || segment === '.' || segment === '..' || segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_DEVICE.test(segment)) throw invalid();
  }
  return key;
}
/** A folder prefix: '' or a valid key shape; one trailing slash is tolerated and removed. */
export function assertPrefix(prefix: string): string {
  if (prefix === '') return '';
  return assertKey(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
}
