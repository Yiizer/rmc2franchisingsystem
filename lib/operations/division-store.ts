import { z } from 'zod';
import { AppError, allUsers, db, transaction } from './database';
import { securityEvent } from './accounts';
import { divisionTableProblems, UNASSIGNED, type DivisionTable } from './divisions';
import { DIVISION_TABLE_KEY, getDivisionTable } from './division-table';
import { canManageAccounts, canSeeAllInquiries } from './permissions';
import type { Staff } from './types';

export { getDivisionTable } from './division-table';

// The editable division table lives in settings('division_table'). Since 2026-11-13 (PO) the Head may also add and delete
// divisions. Records refer to a division by its name, so:
//   - a division keeps its name once saved (the editor offers no rename): a new name is a new division;
//   - a division with people assigned (Division Heads, SOAs) cannot be deleted; move them first;
//   - inquiries and directory records filed under a deleted division keep that name as text and sort as Unassigned.
const name = z.string().trim().min(1).max(40);
const tableSchema = z.object({
  divisions: z.array(z.object({
    name,
    divisionAliases: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    branches: z.array(z.object({ name: z.string().trim().min(1).max(80), aliases: z.array(z.string().trim().min(1).max(80)).max(100).default([]) }).strict()).max(60),
  }).strict()).min(1).max(20),
}).strict();

/** Staff who can see every inquiry may read the table (Head, Supervisor, Employee, Admin). */
export async function readDivisionTable(user: Staff): Promise<DivisionTable> {
  if (!canSeeAllInquiries(user)) throw new AppError('Not allowed.', 403);
  return await getDivisionTable();
}
/** Head only: replace the table (add or delete divisions, add, move or remove branches, spellings). */
export async function saveDivisionTable(user: Staff, input: unknown): Promise<DivisionTable> {
  if (!canManageAccounts(user)) throw new AppError('Only the Head can change divisions and branches.', 403);
  const body = tableSchema.parse(input);
  const table: DivisionTable = { divisions: body.divisions, updatedAt: new Date().toISOString(), updatedBy: user.id };
  const names = table.divisions.map(d => d.name), lower = names.map(n => n.toLowerCase());
  if (lower.some((n, i) => lower.indexOf(n) !== i)) throw new AppError('Two divisions have the same name. Give each division its own name.', 422);
  if (lower.includes(UNASSIGNED.toLowerCase())) throw new AppError('"' + UNASSIGNED + '" is reserved for records without a division.', 422);
  const problems = divisionTableProblems(table);
  if (problems.length) throw new AppError(problems.slice(0, 5).join(' '), 422);
  return await transaction(async () => {
    await db.lock('divisions', 'users-admin'); // the same lock as account changes: nobody is assigned to a division being deleted
    const before = (await getDivisionTable()).divisions.map(d => d.name);
    const removed = before.filter(old => !names.includes(old));
    if (removed.length) {
      const people = (await allUsers()).filter(person => person.division && removed.includes(person.division));
      if (people.length) {
        const byDivision = removed.map(division => ({ division, count: people.filter(p => p.division === division).length })).filter(x => x.count);
        throw new AppError(byDivision.map(x => `${x.division} still has ${x.count} ${x.count === 1 ? 'person' : 'people'} assigned`).join('; ') + '. Move them to another division in Users & Roles first.', 409);
      }
    }
    await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', DIVISION_TABLE_KEY, JSON.stringify(table));
    const added = names.filter(n => !before.includes(n));
    await securityEvent(user, 'Updated the division table (' + table.divisions.length + ' divisions, ' + table.divisions.reduce((n, d) => n + d.branches.length, 0) + ' branches' + (added.length ? '; added ' + added.join(', ') : '') + (removed.length ? '; deleted ' + removed.join(', ') : '') + ')');
    return table;
  });
}
