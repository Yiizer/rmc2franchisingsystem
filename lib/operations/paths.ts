import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runtime records are not deployment assets and must never be bundled by Next.js.
export const dataRoot = path.resolve(/* turbopackIgnore: true */ process.env.RMC2_DATA_DIR || path.join(process.cwd(),'.data'));

// Private templates and catalog.json. Override with RMC2_RESOURCES_DIR; default is <cwd>/resources/private.
// Read per call so tests (and ops) can change the variable without re-importing.
export function resourcesRoot():string { return path.resolve(/* turbopackIgnore: true */ process.env.RMC2_RESOURCES_DIR || path.join(process.cwd(),'resources','private')); }
export const resourceFile=(...parts:string[])=>path.join(resourcesRoot(),...parts);

// historical-schema.sql ships with the code (not private data). Prefer <cwd>/lib/operations (today's behaviour),
// then fall back to the directory of this module in case the process cwd is not the repository root.
export function historicalSchemaFile():string {
  // No turbopackIgnore here: the schema ships with the code and must be traced into server builds (e.g. Vercel).
  const cwdBased=path.join(process.cwd(),'lib','operations','historical-schema.sql');
  if(existsSync(cwdBased))return cwdBased;
  try{const moduleBased=path.join(path.dirname(fileURLToPath(import.meta.url)),'historical-schema.sql');if(existsSync(moduleBased))return moduleBased;}catch{/* bundled module URL is not a file URL */}
  return cwdBased;
}

// Demo staff and sample inquiries on an empty database. Default on locally; off in production unless explicit.
export function demoSeedAllowed():boolean {
  const flag=process.env.RMC2_SEED_DEMO;
  if(process.env.NODE_ENV==='production')return flag==='1';
  return flag!=='0';
}
