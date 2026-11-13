'use client';
import { useEffect, useState } from 'react';
import { DIVISIONS } from '@/lib/operations/permissions';
import type { DivisionTable } from '@/lib/operations/divisions';
import { api } from './operations-common';

// The division names from the saved Divisions & Branches table (the Head may add and delete divisions since 2026-11-13).
// Loaded once per page load and shared by every form; the editor refreshes it after saving. Until it arrives, or if the
// table cannot be read (roles without access), the original seven names are used.
let cached: string[] | null = null;
let pending: Promise<string[]> | null = null;
const listeners = new Set<(names: string[]) => void>();
const fetchNames = () => (pending ??= api<DivisionTable>('divisions').then(table => table.divisions.map(d => d.name), () => [...DIVISIONS]).then(names => { cached = names; pending = null; listeners.forEach(fn => fn(names)); return names; }));

export function setDivisionNames(names: string[]) { cached = names; listeners.forEach(fn => fn(names)); }

export function useDivisionNames(): string[] {
  const [names, setNames] = useState<string[]>(cached ?? [...DIVISIONS]);
  useEffect(() => {
    listeners.add(setNames);
    if (!cached) void fetchNames(); // a cached list is already the initial state; the fetch reaches us through the listener
    return () => { listeners.delete(setNames); };
  }, []);
  return names;
}
