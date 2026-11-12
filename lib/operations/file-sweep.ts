import { catalog, db, jsonParam } from './database';
import { AppError } from './errors';
import { deleteQuietly, files } from './file-store';
import { securityEvent } from './accounts';
import { canSeeSystemHealth } from './permissions';
import type { Staff } from './types';

// Unused stored files (REMAINING_WORK §2 data hygiene). Leftovers appear when a step stores a file and then stops before
// its record is saved, or when test data is reset. This is a mark-and-sweep run by the IT Admin from Monitoring; nothing is
// deleted automatically.
//
// A file counts as IN USE when its full name, or any id or hash inside its name, appears in any text column of any table.
// That is deliberately generous: some names are built in code from an id or hash (a template's Word source is
// sources/<sourceHash>.docx), so a file is only treated as unused when nothing in the database can point to it at all.
// The storage layer records no write times, so a file saved a moment before its record would look unused. To rule that out,
// a file is deleted only if an earlier scan, at least 24 hours before, also found it unused and it is still unused now.

const SETTINGS_KEY = 'file-sweep';
export const SWEEP_WAIT_MS = 24 * 60 * 60 * 1000;
const MAX_DELETE = 500;
/** Only the folders the app writes record files into are ever looked at. On this computer the store's root is the data
 *  directory, which also holds the SQLite database, backups and the historical sources: none of that may be swept.
 *  transfer/ (large-file uploads) and health/ (the connectivity probe) have their own clean-up. */
export const SWEPT_FOLDERS = new Set(['attachments', 'bor', 'generated', 'inbound', 'outbox', 'sources', 'templates']);
const swept = (key: string) => key.includes('/') && SWEPT_FOLDERS.has(key.split('/')[0]);

type Candidate = { key: string; firstSeenAt: string };
export type SweepState = { scannedAt: string; scannedBy: string; total: number; candidates: Candidate[]; lastDelete?: { at: string; by: string; deleted: number } };
export type SweepView = { scannedAt?: string; total: number; unused: number; ready: number; byFolder: Record<string, number>; readyAt?: string; lastDelete?: SweepState['lastDelete'] };

/** The ids and hashes inside a file name: UUIDs, long hex strings (content hashes) and the app's other generated ids. */
export function nameTokens(key: string): string[] {
  const tokens = key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|t[0-9a-f]{20}|INQ-\d{4}-\d{5}/gi) || [];
  return [...new Set(tokens.map(token => token.toLowerCase()))];
}
export function isReferenced(key: string, corpus: string): boolean {
  return corpus.includes(key.toLowerCase()) || nameTokens(key).some(token => corpus.includes(token));
}

const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
/** Every text value in the database, lower-cased, read table by table. Table and column names come from the database itself. */
async function databaseText(): Promise<string> {
  const columns: { table: string; column: string }[] = [];
  if (db.dialect === 'postgres') {
    const rows = await db.all<{ table_name: string; column_name: string }>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND data_type IN ('text','jsonb','json','character varying')");
    for (const row of rows) columns.push({ table: row.table_name, column: row.column_name });
  } else {
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).filter(table => !table.name.startsWith('sqlite_'));
    for (const { name } of tables) for (const col of await db.all<{ name: string; type: string }>('PRAGMA table_info(' + quote(name) + ')'))
      if (!col.type || /TEXT|CHAR|CLOB|JSON/i.test(col.type)) columns.push({ table: name, column: col.name });
  }
  const parts: string[] = [];
  for (const { table, column } of columns) {
    const expr = db.dialect === 'postgres' ? quote(column) + '::text' : quote(column);
    // The sweep's own list of candidates lives in settings and must not count as a reference to them.
    const own = table === 'settings' ? ' AND key<>?' : '';
    for (const row of await db.all<{ v: string | null }>('SELECT ' + expr + ' AS v FROM ' + quote(table) + ' WHERE ' + quote(column) + ' IS NOT NULL' + own, ...(own ? [SETTINGS_KEY] : []))) if (row.v) parts.push(row.v);
  }
  // The supplied templates are listed in resources/catalog.json, not in the database: their source hashes count too.
  parts.push(JSON.stringify(await catalog()));
  return parts.join('\n').toLowerCase();
}

async function readState(): Promise<SweepState | null> {
  const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', SETTINGS_KEY);
  return row ? JSON.parse(row.data) as SweepState : null;
}
async function writeState(state: SweepState) {
  await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', SETTINGS_KEY, jsonParam(state));
}
const requireAdmin = (user: Staff) => { if (!canSeeSystemHealth(user)) throw new AppError('Only the IT Admin can review stored files.', 403); };

/** Lists stored files no record can point to. The keys stay on the server; the Admin sees counts per folder. */
async function findUnused(): Promise<{ total: number; unused: string[] }> {
  const keys = (await files().list('')).filter(swept);
  const corpus = await databaseText(); // read after listing: a record saved in between is still seen
  return { total: keys.length, unused: keys.filter(key => !isReferenced(key, corpus)) };
}
function view(state: SweepState | null, now = Date.now()): SweepView {
  if (!state) return { total: 0, unused: 0, ready: 0, byFolder: {} };
  const byFolder: Record<string, number> = {};
  for (const c of state.candidates) { const top = c.key.split('/')[0]; byFolder[top] = (byFolder[top] || 0) + 1; }
  const ready = state.candidates.filter(c => now - Date.parse(c.firstSeenAt) >= SWEEP_WAIT_MS).length;
  const waiting = state.candidates.filter(c => now - Date.parse(c.firstSeenAt) < SWEEP_WAIT_MS).map(c => Date.parse(c.firstSeenAt));
  return { scannedAt: state.scannedAt, total: state.total, unused: state.candidates.length, ready, byFolder, readyAt: waiting.length ? new Date(Math.min(...waiting) + SWEEP_WAIT_MS).toISOString() : undefined, lastDelete: state.lastDelete };
}

export async function sweepStatus(user: Staff) { requireAdmin(user); return view(await readState()); }

/** Scan: records which files are unused, keeping the first time each was seen. Deletes nothing. */
export async function scanFiles(user: Staff, now = Date.now()) {
  requireAdmin(user);
  const previous = await readState(), seen = new Map((previous?.candidates || []).map(c => [c.key, c.firstSeenAt]));
  const { total, unused } = await findUnused();
  const at = new Date(now).toISOString();
  const state: SweepState = { scannedAt: at, scannedBy: user.id, total, candidates: unused.map(key => ({ key, firstSeenAt: seen.get(key) || at })), lastDelete: previous?.lastDelete };
  await writeState(state);
  return view(state, now);
}

/** Delete: scans again and removes only files that were already unused at least 24 hours ago and are still unused now. */
export async function deleteUnusedFiles(user: Staff, now = Date.now()) {
  requireAdmin(user);
  const previous = await readState();
  const old = new Set((previous?.candidates || []).filter(c => now - Date.parse(c.firstSeenAt) >= SWEEP_WAIT_MS).map(c => c.key));
  if (!old.size) throw new AppError('No files have been unused for 24 hours yet. Scan, then come back after a day.', 409);
  const { total, unused } = await findUnused();
  const doomed = unused.filter(key => old.has(key)).slice(0, MAX_DELETE);
  await deleteQuietly(...doomed);
  const left = new Set(await files().list('').then(keys => keys.filter(key => doomed.includes(key))));
  const deleted = doomed.filter(key => !left.has(key)).length;
  const at = new Date(now).toISOString(), seen = new Map((previous?.candidates || []).map(c => [c.key, c.firstSeenAt]));
  const state: SweepState = { scannedAt: at, scannedBy: user.id, total: total - deleted, candidates: unused.filter(key => !doomed.includes(key) || left.has(key)).map(key => ({ key, firstSeenAt: seen.get(key) || at })), lastDelete: { at, by: user.id, deleted } };
  await writeState(state);
  await securityEvent(user, 'Deleted ' + deleted + ' unused stored files');
  return { ...view(state, now), deleted };
}
