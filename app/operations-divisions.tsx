'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowRightLeft, Building2, Check, ChevronRight, MapPin, Plus, RefreshCw, Save, Search, Trash2, Undo2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, Modal } from './operations-common';
import { setDivisionNames } from './use-division-names';
import type { DivisionTable } from '@/lib/operations/divisions';
import type { Staff } from '@/lib/operations/types';
import type { ClientListing } from '@/lib/operations/directory-model';
import './operations-divisions.css';

// Head only: the divisions, the branches in each, and the other ways a place is written in old records. New inquiries,
// account divisions and the Client Directory all use this table. Since 2026-11-13 (PO) the Head can also add and delete
// divisions. Records refer to a division by name, so a saved division keeps its name, and one with people assigned cannot
// be deleted (the server refuses it too). Changes are staged here and only take effect when saved.

type Draft = DivisionTable['divisions'];
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Spellings as tags: Enter or comma adds, × or Backspace on an empty box removes. */
function TagInput({ values, onChange, placeholder, label }: { values: string[]; onChange: (next: string[]) => void; placeholder: string; label: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => { const parts = raw.split(',').map(clean).filter(Boolean); if (!parts.length) return; onChange([...new Set([...values, ...parts])]); setText(''); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
    else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
  };
  return <div className="ops-div-tags" onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
    {values.map(value => <span className="ops-div-tag" key={value}>{value}<button type="button" aria-label={'Remove spelling ' + value} onClick={() => onChange(values.filter(v => v !== value))}><X size={12} /></button></span>)}
    <input aria-label={label} value={text} placeholder={values.length ? '' : placeholder} onChange={e => { const v = e.target.value; if (v.includes(',')) add(v); else setText(v); /* a typed or pasted comma adds */ }} onKeyDown={key} onBlur={() => add(text)} />
  </div>;
}

export default function DivisionsEditor({ users = [] }: { users?: Staff[] }) {
  const [saved, setSaved] = useState<DivisionTable | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState(0), [query, setQuery] = useState(''), [adding, setAdding] = useState(false), [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState('');
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({});
  const newInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    try { const table = await api<DivisionTable>('divisions'); setLoadError(''); setSaved(table); setDraft(structuredClone(table.divisions)); }
    catch (e) { setLoadError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  // Client Directory totals per division (read-only; the page works without them).
  useEffect(() => { void api<ClientListing>('directory?page=1').then(list => setClientCounts(Object.fromEntries(list.divisionCounts.map(d => [d.name, d.count]))), () => {}); }, [saved?.updatedAt]);
  useEffect(() => { if (adding) newInput.current?.focus(); }, [adding]);

  const savedNames = useMemo(() => new Set(saved?.divisions.map(d => d.name) ?? []), [saved]);
  const people = useMemo(() => { const map: Record<string, Staff[]> = {}; for (const u of users) if (u.division) (map[u.division] ??= []).push(u); return map; }, [users]);
  const changes = useMemo(() => {
    if (!saved || !draft) return 0;
    const before = new Map(saved.divisions.map(d => [d.name, JSON.stringify(d)])), after = new Map(draft.map(d => [d.name, JSON.stringify(d)]));
    let n = 0; for (const [name, json] of after) if (before.get(name) !== json) n++; for (const name of before.keys()) if (!after.has(name)) n++; return n;
  }, [saved, draft]);
  const update = (fn: (divisions: Draft) => void) => setDraft(previous => { if (!previous) return previous; const next = structuredClone(previous); fn(next); return next; });
  const save = async () => {
    if (!draft) return; setBusy(true); setError('');
    try {
      const table = await api<DivisionTable>('divisions', { divisions: draft.map(d => ({ name: clean(d.name), divisionAliases: d.divisionAliases.map(clean).filter(Boolean), branches: d.branches.map(b => ({ name: clean(b.name), aliases: b.aliases.map(clean).filter(Boolean) })) })) });
      setSaved(table); setDraft(structuredClone(table.divisions)); setDivisionNames(table.divisions.map(d => d.name));
      toast.success('Divisions saved. New inquiries, accounts and the Client Directory now use them.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const addDivision = () => {
    if (!draft) return;
    const name = clean(newName);
    if (!name) { setError('Give the new division a name.'); return; }
    if (draft.some(d => d.name.toLowerCase() === name.toLowerCase())) { setError('There is already a division called "' + name + '".'); return; }
    if (name.toLowerCase() === 'unassigned') { setError('"Unassigned" is kept for records without a division.'); return; }
    update(d => { d.push({ name, divisionAliases: [], branches: [] }); });
    setSelected(draft.length); setNewName(''); setAdding(false); setError('');
  };

  if (loadError) return <><Heading /><p className="ops-message amber" role="alert">{loadError} <button className="ops-btn" onClick={() => void load()}><RefreshCw size={14} />Try again</button></p></>;
  if (!draft) return <><Heading /><div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading divisions…</div></>;
  const index = Math.min(selected, draft.length - 1), division = draft[index];
  const assigned = people[division.name] ?? [];
  const isNew = !savedNames.has(division.name);
  const branchTotal = draft.reduce((n, d) => n + d.branches.length, 0);
  const q = clean(query).toLowerCase();
  const hits = q ? draft.flatMap((d, di) => d.branches.map((b, bi) => ({ d, di, b, bi })).filter(({ b }) => [b.name, ...b.aliases].some(v => v.toLowerCase().includes(q)))) : [];

  return <div className="ops-div-page">
    <Heading updated={saved?.updatedAt} />
    <div className="ops-div-stats" aria-label="Summary">
      <div><Building2 size={18} aria-hidden="true" /><b>{draft.length}</b><span>divisions</span></div>
      <div><MapPin size={18} aria-hidden="true" /><b>{branchTotal}</b><span>branches</span></div>
      <div><Users size={18} aria-hidden="true" /><b>{users.filter(u => u.division && u.active).length}</b><span>Division Heads &amp; SOAs</span></div>
      {clientCounts.Unassigned !== undefined && <div className="ops-div-stat-warn"><AlertTriangle size={18} aria-hidden="true" /><b>{clientCounts.Unassigned.toLocaleString()}</b><span>directory clients unassigned</span></div>}
    </div>
    {error && <p className="ops-message amber" role="alert">{error}</p>}

    <div className="ops-div-layout">
      <aside className="ops-card ops-div-rail" aria-label="Divisions">
        <label className="ops-div-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Find a branch" placeholder="Find a branch or spelling" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {q ? <ul className="ops-div-hits" aria-label="Matching branches">
          {hits.length ? hits.map(({ d, di, b, bi }) => <li key={di + '-' + bi}><button onClick={() => { setSelected(di); setQuery(''); }}><span>{b.name}</span><small>{d.name}</small><ChevronRight size={14} aria-hidden="true" /></button></li>)
            : <li className="ops-div-none">No branch or spelling matches “{query}”.</li>}
        </ul> : <nav className="ops-div-list">
          {draft.map((d, di) => { const n = (people[d.name] ?? []).filter(p => p.active).length; return <button key={d.name + di} className={'ops-div-item' + (di === index ? ' active' : '')} aria-current={di === index ? 'true' : undefined} onClick={() => setSelected(di)}>
            <span className="ops-div-item-name">{d.name}{!savedNames.has(d.name) && <em>New</em>}</span>
            <span className="ops-div-item-meta">{d.branches.length} branch{d.branches.length === 1 ? '' : 'es'}{n ? ' · ' + n + ' ' + (n === 1 ? 'person' : 'people') : ''}</span>
            {clientCounts[d.name] !== undefined && <span className="ops-div-item-count" title="Client Directory">{clientCounts[d.name].toLocaleString()}</span>}
          </button>; })}
        </nav>}
        {adding ? <form className="ops-div-add" onSubmit={e => { e.preventDefault(); addDivision(); }}>
          <input ref={newInput} aria-label="New division name" placeholder={'e.g. Division ' + (draft.length + 1)} value={newName} maxLength={40} onChange={e => setNewName(e.target.value)} />
          <button className="ops-btn primary" type="submit"><Check size={15} />Add</button>
          <button className="ops-btn" type="button" aria-label="Cancel" onClick={() => { setAdding(false); setNewName(''); }}><X size={15} /></button>
        </form> : <button className="ops-btn ops-div-add-btn" onClick={() => { setAdding(true); setNewName('Division ' + (draft.length + 1)); }}><Plus size={15} />Add division</button>}
      </aside>

      {/* Phones: the rail becomes a picker */}
      <label className="ops-div-picker"><span>Division</span><select value={index} onChange={e => setSelected(Number(e.target.value))}>{draft.map((d, di) => <option key={di} value={di}>{d.name} · {d.branches.length} branches</option>)}</select></label>

      <section className="ops-card ops-div-detail" aria-label={division.name}>
        <div className="ops-div-head">
          <div>
            <p className="ops-div-eyebrow">{isNew ? 'New division · not saved yet' : 'Division'}</p>
            {isNew ? <input className="ops-div-title-input" aria-label="Division name" value={division.name} maxLength={40} onChange={e => update(d => { d[index].name = e.target.value; })} /> : <h2>{division.name}</h2>}
            <div className="ops-div-chips">
              <span><MapPin size={13} aria-hidden="true" />{division.branches.length} branch{division.branches.length === 1 ? '' : 'es'}</span>
              <span><Users size={13} aria-hidden="true" />{assigned.length ? assigned.map(p => p.name).join(', ') : 'Nobody assigned'}</span>
              {clientCounts[division.name] !== undefined && <span><Building2 size={13} aria-hidden="true" />{clientCounts[division.name].toLocaleString()} directory client{clientCounts[division.name] === 1 ? '' : 's'}</span>}
            </div>
          </div>
          <div className="ops-div-head-actions">
            <button className="ops-btn danger" disabled={assigned.length > 0 || draft.length <= 1} onClick={() => setConfirmDelete(index)}><Trash2 size={15} />Delete division</button>
            {assigned.length > 0 && <small>Move {assigned.length === 1 ? 'its person' : 'its ' + assigned.length + ' people'} to another division in Users &amp; Roles first.</small>}
          </div>
        </div>

        <div className="ops-div-section">
          <div className="ops-div-section-head"><h3>Branches</h3><button className="ops-btn" onClick={() => update(d => { d[index].branches.push({ name: '', aliases: [] }); })}><Plus size={15} />Add branch</button></div>
          {division.branches.length === 0 ? <div className="ops-div-empty"><MapPin size={22} aria-hidden="true" /><p>No branches in {division.name} yet.</p><button className="ops-btn primary" onClick={() => update(d => { d[index].branches.push({ name: '', aliases: [] }); })}><Plus size={15} />Add the first branch</button></div>
            : <ol className="ops-div-branches">
              {division.branches.map((branch, bi) => <li key={index + '-' + bi} className="ops-div-branch">
                <div className="ops-div-branch-main">
                  <label className="ops-div-field"><span>Branch name</span><input value={branch.name} placeholder="e.g. Antipolo" aria-label={'Branch name ' + (bi + 1)} autoFocus={!branch.name} onChange={e => update(d => { d[index].branches[bi].name = e.target.value; })} /></label>
                  <div className="ops-div-field"><span>Other spellings in old records</span><TagInput label={'Other spellings for ' + (branch.name || 'this branch')} values={branch.aliases} placeholder="Type a spelling, press Enter" onChange={next => update(d => { d[index].branches[bi].aliases = next; })} /></div>
                </div>
                <div className="ops-div-branch-actions">
                  <label className="ops-div-move" title="Move to another division"><ArrowRightLeft size={14} aria-hidden="true" /><span className="sr-only">Move {branch.name || 'branch'} to</span>
                    <select value="" aria-label={'Move ' + (branch.name || 'branch') + ' to another division'} onChange={e => { const target = Number(e.target.value); if (Number.isNaN(target) || e.target.value === '') return; update(d => { const [moved] = d[index].branches.splice(bi, 1); d[target].branches.push(moved); }); toast.success((branch.name || 'Branch') + ' moved to ' + draft[target].name + '. Save to keep it.'); }}>
                      <option value="">Move to…</option>{draft.map((d, ni) => ni !== index && <option key={ni} value={ni}>{d.name}</option>)}
                    </select></label>
                  <button className="ops-btn ops-div-icon" aria-label={'Remove ' + (branch.name || 'branch')} title="Remove branch" onClick={() => update(d => { d[index].branches.splice(bi, 1); })}><Trash2 size={15} /></button>
                </div>
              </li>)}
            </ol>}
        </div>

        <div className="ops-div-section">
          <div className="ops-div-section-head"><h3>Division-only spellings</h3></div>
          <p className="ops-div-help">Words that name this division but no branch, for example “Cebu”. Old records with only these words are filed here without a branch.</p>
          <TagInput label={'Division-only spellings for ' + division.name} values={division.divisionAliases} placeholder="Type a spelling, press Enter" onChange={next => update(d => { d[index].divisionAliases = next; })} />
        </div>
      </section>
    </div>

    {changes > 0 && <div className="ops-div-savebar" role="region" aria-label="Unsaved changes">
      <span><b>{changes}</b> {changes === 1 ? 'division' : 'divisions'} changed · not saved yet</span>
      <button className="ops-btn" disabled={busy} onClick={() => { if (saved) setDraft(structuredClone(saved.divisions)); setError(''); setSelected(0); }}><Undo2 size={15} />Discard</button>
      <button className="ops-btn primary" disabled={busy} onClick={() => void save()}><Save size={15} />{busy ? 'Saving…' : 'Save changes'}</button>
    </div>}

    {confirmDelete !== null && draft[confirmDelete] && <Modal title={'Delete ' + draft[confirmDelete].name + '?'} onClose={() => setConfirmDelete(null)}>
      <div className="ops-pad">
        <p>{draft[confirmDelete].branches.length ? `Its ${draft[confirmDelete].branches.length} branch${draft[confirmDelete].branches.length === 1 ? '' : 'es'} will be removed with it. ` : ''}Inquiries and directory records filed under it keep the name as text and show as Unassigned. To keep a branch, move it to another division first.</p>
        <p className="ops-muted">Nothing changes until you save.</p>
        <div className="ops-actions"><button className="ops-btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="ops-btn danger" onClick={() => { const at = confirmDelete; update(d => { d.splice(at, 1); }); setSelected(Math.max(0, at - 1)); setConfirmDelete(null); }}><Trash2 size={15} />Delete division</button></div>
      </div>
    </Modal>}
  </div>;
}

function Heading({ updated }: { updated?: string }) {
  return <div className="ops-heading"><div><h1>Divisions &amp; Branches</h1><p>Which branches belong to which division. New inquiries, Division Head and SOA accounts and the Client Directory use this table; old records keep their original text beside the result.{updated ? ' Last saved ' + new Date(updated).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.' : ''}</p></div></div>;
}
