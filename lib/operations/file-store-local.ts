import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, stat as fileStat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_OBJECT_BYTES, StorageError, assertKey, assertPrefix } from './file-store-core';
import type { FileStat, FileStore } from './file-store';

const errno = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const missing = (error: unknown) => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(errno(error) || '');
// In-flight writes live next to their target under this name and are never listed.
const isTemp = (name: string) => name.startsWith('.') && name.endsWith('.tmp');

/** Local disk adapter: keys map to files under `root`; the resolve-and-prefix check of the old safeStorage is kept. */
export function createLocalStore(cfg: { root: string; maxBytes?: number }): FileStore {
  const root = path.resolve(cfg.root), max = cfg.maxBytes ?? MAX_OBJECT_BYTES;
  const resolve = (key: string) => {
    assertKey(key);
    const full = path.resolve(root, ...key.split('/'));
    if (!full.startsWith(root + path.sep)) throw new StorageError('invalid_key');
    return full;
  };
  const failed = (op: string, key: string, error: unknown) => { console.error('[storage] local ' + op + ' failed code=' + (errno(error) || 'error') + ' key=' + key); return new StorageError('unavailable'); };
  async function walk(directory: string, relative: string, out: string[]) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (missing(error)) return; throw error; }
    for (const entry of entries) {
      const key = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), key, out); else if (entry.isFile() && !isTemp(entry.name)) out.push(key);
    }
  }
  return {
    kind: 'local',
    async put(key, bytes, opts) {
      const full = resolve(key);
      if (bytes.byteLength > max) throw new StorageError('too_large');
      // Write a complete temp file beside the target, then publish it atomically: link (fails if the key exists)
      // for create, rename for replace. Readers never see a partial file; a failure leaves nothing behind.
      const temp = path.join(path.dirname(full), '.' + path.basename(full) + '.' + randomUUID() + '.tmp');
      let publishing = false;
      try {
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(temp, bytes, { flag: 'wx' });
        publishing = true;
        if ((opts.mode ?? 'create') === 'create') await link(temp, full);
        else for (let attempt = 0; ; attempt++) {
          // Windows refuses to replace a file that a reader has open at this very moment; wait it out briefly.
          try { await rename(temp, full); break; }
          catch (error) { if (attempt >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(errno(error) || '')) throw error; await new Promise(resolve => setTimeout(resolve, 15)); }
        }
      } catch (error) {
        if (publishing && errno(error) === 'EEXIST') throw new StorageError('exists');
        throw failed('put', key, error);
      } finally {
        await unlink(temp).catch(() => {});
      }
    },
    async get(key) {
      const full = resolve(key);
      try { return await readFile(full); } catch (error) { if (missing(error)) throw new StorageError('not_found'); throw failed('get', key, error); }
    },
    async stat(key): Promise<FileStat | null> {
      const full = resolve(key);
      try { const info = await fileStat(full); return info.isFile() ? { size: info.size } : null; } catch (error) { if (missing(error)) return null; throw failed('stat', key, error); }
    },
    async delete(key) {
      const full = resolve(key);
      try { await unlink(full); } catch (error) { if (!missing(error)) throw failed('delete', key, error); }
    },
    async list(prefix) {
      const folder = assertPrefix(prefix), out: string[] = [];
      try { await walk(folder ? path.resolve(root, ...folder.split('/')) : root, folder, out); } catch (error) { throw failed('list', folder, error); }
      return out.sort();
    },
  };
}
