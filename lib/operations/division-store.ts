import { z } from 'zod';
import { AppError, db, transaction } from './database';
import { securityEvent } from './accounts';
import { DEFAULT_DIVISION_TABLE, divisionTableProblems, type DivisionTable } from './divisions';
import { DIVISIONS, canManageAccounts, canSeeAllInquiries } from './permissions';
import type { Staff } from './types';

// The editable division table lives in settings('division_table'). Until the Head saves one, the PO's list
// (DEFAULT_DIVISION_TABLE) applies. Reading is cheap and safe outside transactions.
const KEY = 'division_table';
const name = z.string().trim().min(1).max(80);
const tableSchema = z.object({
  divisions: z.array(z.object({
    name,
    divisionAliases: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    branches: z.array(z.object({ name, aliases: z.array(z.string().trim().min(1).max(80)).max(100).default([]) }).strict()).max(60),
  }).strict()).min(1).max(20),
}).strict();

export async function getDivisionTable(): Promise<DivisionTable> {
  const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', KEY);
  if (!row) return DEFAULT_DIVISION_TABLE;
  try { return JSON.parse(row.data) as DivisionTable; } catch { return DEFAULT_DIVISION_TABLE; }
}
/** Staff who can see every inquiry may read the table (Head, Supervisor, Employee, Admin). */
export async function readDivisionTable(user: Staff): Promise<DivisionTable> {
  if (!canSeeAllInquiries(user)) throw new AppError('Not allowed.', 403);
  return await getDivisionTable();
}
/** Head only: replace the table (rename divisions, move branches, add spellings). */
export async function saveDivisionTable(user: Staff, input: unknown): Promise<DivisionTable> {
  if (!canManageAccounts(user)) throw new AppError('Only the Head can change divisions and branches.', 403);
  const body = tableSchema.parse(input);
  const table: DivisionTable = { divisions: body.divisions, updatedAt: new Date().toISOString(), updatedBy: user.id };
  // Accounts and inquiries refer to divisions by name, so the seven names stay fixed; only branches and spellings change.
  if (JSON.stringify(table.divisions.map(d => d.name)) !== JSON.stringify([...DIVISIONS])) throw new AppError('Keep the divisions as Division 1 to Division 7; change only their branches and spellings.', 422);
  const problems = divisionTableProblems(table);
  if (problems.length) throw new AppError(problems.slice(0, 5).join(' '), 422);
  await transaction(async () => {
    await db.lock('divisions');
    await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', KEY, JSON.stringify(table));
    await securityEvent(user, 'Updated the division table (' + table.divisions.length + ' divisions, ' + table.divisions.reduce((n, d) => n + d.branches.length, 0) + ' branches)');
  });
  return table;
}
