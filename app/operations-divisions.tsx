'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, RefreshCw, Save, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from './operations-common';
import type { DivisionTable } from '@/lib/operations/divisions';
import './operations-divisions.css';

// Head only: the division → branch table used to file inquiries and sort the Client Directory. Spellings are the
// other ways a branch is written in old records ("Baliuag", "QC"); the directory re-sorts as soon as this is saved.
const list = (text: string) => [...new Set(text.split(',').map(value => value.trim()).filter(Boolean))];
const join = (values: string[]) => values.join(', ');

export default function DivisionsEditor() {
  const [saved, setSaved] = useState<DivisionTable | null>(null), [draft, setDraft] = useState<DivisionTable | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState('');
  const load = async () => {
    setLoadError('');
    try { const table = await api<DivisionTable>('divisions'); setSaved(table); setDraft(structuredClone(table)); }
    catch (e) { setLoadError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const dirty = useMemo(() => !!saved && !!draft && JSON.stringify(saved.divisions) !== JSON.stringify(draft.divisions), [saved, draft]);
  const update = (fn: (table: DivisionTable) => void) => setDraft(previous => { if (!previous) return previous; const next = structuredClone(previous); fn(next); return next; });
  const save = async () => {
    if (!draft) return; setBusy(true); setError('');
    try {
      const table = await api<DivisionTable>('divisions', { divisions: draft.divisions.map(d => ({ name: d.name.trim(), divisionAliases: list(join(d.divisionAliases)), branches: d.branches.map(b => ({ name: b.name.trim(), aliases: list(join(b.aliases)) })) })) });
      setSaved(table); setDraft(structuredClone(table)); toast.success('Divisions saved. The Client Directory now uses this table.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (loadError) return <><Heading /><p className="ops-message amber" role="alert">{loadError} <button className="ops-btn" onClick={() => void load()}><RefreshCw size={14} />Try again</button></p></>;
  if (!draft) return <><Heading /><div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading divisions…</div></>;
  const names = draft.divisions.map(d => d.name);
  return <>
    <Heading updated={saved?.updatedAt} />
    <div className="ops-div-actions">
      <button className="ops-btn" disabled={!dirty || busy} onClick={() => { if (saved) setDraft(structuredClone(saved)); setError(''); }}><Undo2 size={15} />Discard changes</button>
      <button className="ops-btn primary" disabled={!dirty || busy} onClick={() => void save()}><Save size={15} />{busy ? 'Saving…' : 'Save divisions'}</button>
    </div>
    {error && <p className="ops-message amber" role="alert">{error}</p>}
    <div className="ops-div-grid">
      {draft.divisions.map((division, di) => <section key={di} className="ops-card ops-div-card" aria-label={division.name}>
        <header>
          {/* Division names stay "Division 1"…"Division 7": accounts and inquiries refer to them by name. */}
          <h2 className="ops-div-name">{division.name}</h2>
          <small>{division.branches.length} branch{division.branches.length === 1 ? '' : 'es'}</small>
        </header>
        {division.branches.length === 0 && <p className="ops-div-empty">No branches yet.</p>}
        <ul className="ops-div-branches">
          {division.branches.map((branch, bi) => <li key={bi}>
            <label><span>Branch</span><input value={branch.name} onChange={e => update(t => { t.divisions[di].branches[bi].name = e.target.value; })} /></label>
            <label><span>Other spellings <small>(comma-separated)</small></span><input value={join(branch.aliases)} onChange={e => update(t => { t.divisions[di].branches[bi].aliases = [e.target.value]; })} placeholder="e.g. Baliuag, Baliwag Bulacan" /></label>
            <div className="ops-div-row-actions">
              <label className="ops-div-move"><ArrowRight size={14} aria-hidden="true" /><span className="sr-only">Move {branch.name} to</span>
                <select value="" onChange={e => { const target = Number(e.target.value); if (Number.isNaN(target)) return; update(t => { const [moved] = t.divisions[di].branches.splice(bi, 1); t.divisions[target].branches.push(moved); }); }}>
                  <option value="">Move to…</option>{names.map((name, ni) => ni !== di && <option key={ni} value={ni}>{name}</option>)}
                </select></label>
              <button className="ops-btn" aria-label={'Remove ' + branch.name} onClick={() => update(t => { t.divisions[di].branches.splice(bi, 1); })}><Trash2 size={14} /></button>
            </div>
          </li>)}
        </ul>
        <button className="ops-btn" onClick={() => update(t => { t.divisions[di].branches.push({ name: 'New branch', aliases: [] }); })}><Plus size={14} />Add branch</button>
        <label className="ops-div-aliases"><span>Division-only spellings <small>(say the division but not the branch, e.g. "Cebu")</small></span>
          <input value={join(division.divisionAliases)} onChange={e => update(t => { t.divisions[di].divisionAliases = [e.target.value]; })} /></label>
      </section>)}
    </div>
  </>;
}
function Heading({ updated }: { updated?: string }) {
  return <div className="ops-heading"><div><h1>Divisions &amp; Branches</h1><p>Which branches belong to which division. New inquiries and the Client Directory use this table; old records keep their original text beside the result.{updated ? ' Last saved ' + new Date(updated).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.' : ' Using the list agreed on Nov 5, 2026.'} Records that match no branch show as “Unassigned” in the Client Directory.</p></div></div>;
}
