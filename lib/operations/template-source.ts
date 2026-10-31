import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageError, files } from './file-store';
import { resourceFile } from './paths';
import type { CatalogTemplate } from './types';

// Bundled resources (catalog masters, the blank franchise form) live on disk with the deployment, not in the
// data store. A missing one reports the same safe message as a missing stored file.
export async function resourceBytes(...parts: string[]): Promise<Buffer> {
  try { return await readFile(resourceFile(...parts)); }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw new StorageError('not_found'); throw error; }
}

/** The Word master of a template: an archived/uploaded copy in the file store, or a bundled catalog resource. */
export async function templateBytes(template: CatalogTemplate): Promise<Buffer> {
  return template.storage ? await files().get(template.storage) : await resourceBytes(path.basename(template.file));
}
