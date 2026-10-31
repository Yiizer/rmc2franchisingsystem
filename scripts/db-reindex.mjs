// Re-queues every inquiry for projection and rebuilds inquiry_summaries / inquiry_keys from the authoritative records.
// Run after changing the projection code (bump PROJECTION_VERSION in lib/operations/database.ts), or to repair the index.
//   RMC2_DB=postgres RMC2_DATABASE_URL=... node scripts/db-reindex.mjs     (default: SQLite in RMC2_DATA_DIR / .data)
// Writes only derived index tables (and app_meta.projection_version on Postgres). Never prints connection details.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

register();
const imp = file => import(pathToFileURL(path.resolve('lib/operations', file)).href);
const database = await imp('database.ts');
const index = await imp('inquiry-index.ts');
try {
  await database.ensureReady();
  const before = (await database.db.get('SELECT COUNT(*) AS n FROM inquiry_summaries')).n;
  await database.enqueueFullReindex();
  const queued = (await database.db.get('SELECT COUNT(*) AS n FROM inquiry_index_pending')).n;
  await index.synchronizeInquiryIndex();
  const after = (await database.db.get('SELECT COUNT(*) AS n FROM inquiry_summaries')).n;
  console.log(`Reindexed ${queued} inquiries on ${database.db.dialect} (summaries before: ${before}, after: ${after}).`);
} catch (error) {
  console.error('Reindex failed:', error?.status ? error.message : error?.name ?? 'error');
  process.exitCode = 1;
} finally {
  await database.db.close();
}