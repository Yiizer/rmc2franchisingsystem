import { db } from './database';
import { DEFAULT_DIVISION_TABLE, type DivisionTable } from './divisions';

// The saved division table (settings 'division_table'), read without any permission check: accounts, the directory and
// the Head's editor all use it. Until the Head saves one, the PO's list (DEFAULT_DIVISION_TABLE) applies. Since 2026-11-13
// the Head may add and delete divisions, so the list of division names always comes from here, never from a constant.
export const DIVISION_TABLE_KEY = 'division_table';

export async function getDivisionTable(): Promise<DivisionTable> {
  const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', DIVISION_TABLE_KEY);
  if (!row) return DEFAULT_DIVISION_TABLE;
  try { return JSON.parse(row.data) as DivisionTable; } catch { return DEFAULT_DIVISION_TABLE; }
}
export const divisionNames = async () => (await getDivisionTable()).divisions.map(division => division.name);
