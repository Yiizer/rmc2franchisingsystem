'use client';
import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Staff } from '@/lib/operations/types';
import { isOwnerScoped } from '@/lib/operations/permissions';
import './operations-report-queue.css';

export const ownerLabel = (person: Pick<Staff, 'name' | 'role' | 'division'>) => person.name + ' · ' + (person.division || 'No division') + (person.role === 'SOA' ? ' · SOA' : '');

/** ARIA 1.2 combobox with a list box: Up/Down move, Enter picks, Escape closes. The first option clears the link. */
export default function OwnerPicker({ users, value, disabled, busy, onPick }: { users: Staff[]; value?: string; disabled?: boolean; busy?: boolean; onPick: (id: string | null) => void }) {
  const owners = useMemo(() => users.filter(u => u.active && isOwnerScoped(u)).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const current = owners.find(o => o.id === value) || users.find(u => u.id === value);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const id = useId(), listId = id + '-list', input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const filtered = owners.filter(o => !q || ownerLabel(o).toLowerCase().includes(q));
  const options: { id: string | null; label: string }[] = [...(q ? [] : [{ id: null, label: 'Not linked' }]), ...filtered.map(o => ({ id: o.id, label: ownerLabel(o) }))];
  const pick = (optionId: string | null) => { setOpen(false); setQuery(''); if ((optionId || null) !== (value || null)) onPick(optionId); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); } else setActive(Math.min(options.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); const o = options[active]; if (o) pick(o.id); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(''); }
  };
  return <div className="ops-owner-picker">
    <div className="ops-owner-picker-box"><input ref={input} role="combobox" aria-label="Owner (Division Head / SOA)" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && options[active] ? id + '-opt-' + active : undefined} autoComplete="off" disabled={disabled || busy}
      value={open ? query : current ? ownerLabel(current) : value ? 'Division Head / SOA' : 'Not linked'} placeholder="Search Division Heads and SOAs…"
      onFocus={() => { setOpen(true); setActive(0); }} onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey} />
      <ChevronDown size={16} aria-hidden="true" /></div>
    {open && <ul id={listId} role="listbox" aria-label="Division Heads and SOAs" className="ops-owner-picker-list">
      {options.map((o, index) => <li key={o.id ?? 'none'} id={id + '-opt-' + index} role="option" aria-selected={(o.id || null) === (value || null)} className={'ops-owner-picker-option' + (index === active ? ' active' : '')} onMouseDown={e => { e.preventDefault(); pick(o.id); }} onMouseEnter={() => setActive(index)}>{o.label}</li>)}
      {!filtered.length && q && <li role="presentation" className="ops-owner-picker-empty">No Division Head or SOA matches “{query}”</li>}
    </ul>}
  </div>;
}
