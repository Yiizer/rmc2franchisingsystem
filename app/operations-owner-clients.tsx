'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Upload, Users } from 'lucide-react';
import { ageLabel, manilaTime } from '@/lib/operations/types';
import type { OwnerClient } from '@/lib/operations/owner-view';
import { ClientProtectionChip, hasPendingReport, lastReport, OwnerStatus, ReportChip } from './operations-owner-chip';

type Filter = 'all' | 'ending' | 'pending' | 'rejected';
type Sort = 'activity' | 'ending' | 'name';
const PAGE = 25;
const ending = (c: OwnerClient, now: number) => !!c.protection && !c.protection.held && Date.parse(c.protection.expiresAt) > now && c.protection.daysLeft <= 7;

export default function MyClients({ clients, loading, error, onRetry, onOpen, onSubmit, now }: { clients: OwnerClient[] | null; loading: boolean; error: string; onRetry: () => void; onOpen: (id: string) => void; onSubmit: () => void; now: number }) {
  const [search, setSearch] = useState(''), [sort, setSort] = useState<Sort>('activity'), [filter, setFilter] = useState<Filter>('all'), [page, setPage] = useState(1);
  const list = useMemo(() => clients || [], [clients]);
  const counts = useMemo(() => ({ all: list.length, ending: list.filter(c => ending(c, now)).length, pending: list.filter(hasPendingReport).length, rejected: list.filter(c => lastReport(c)?.status === 'rejected').length }), [list, now]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = list.filter(c => (!q || c.client.toLowerCase().includes(q)) && (filter === 'all' || filter === 'ending' && ending(c, now) || filter === 'pending' && hasPendingReport(c) || filter === 'rejected' && lastReport(c)?.status === 'rejected'));
    const key = (c: OwnerClient) => c.protection && !c.protection.held ? Date.parse(c.protection.expiresAt) : Infinity;
    if (sort === 'name') rows.sort((a, b) => a.client.localeCompare(b.client));
    else if (sort === 'ending') rows.sort((a, b) => key(a) - key(b) || a.client.localeCompare(b.client));
    else rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return rows;
  }, [list, search, filter, sort, now]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)), current = Math.min(page, pages), slice = shown.slice((current - 1) * PAGE, current * PAGE);
  const announce = useRef<HTMLParagraphElement>(null);
  const clear = () => { setSearch(''); setFilter('all'); setPage(1); };
  const filters: [Filter, string][] = [['all', 'All'], ['ending', 'Protection ending'], ['pending', 'Report under review'], ['rejected', 'Report rejected']];
  return <div className="ops-oc-page">
    <header className="ops-oc-heading"><div><h1>My Clients</h1><p>Your clients, their protection and your progress reports.</p></div></header>
    <section className="ops-card ops-oc-register" aria-busy={loading} aria-label="My clients">
      <div className="ops-oc-toolbar">
        <label className="ops-oc-search"><Search size={17} aria-hidden="true" /><input aria-label="Search my clients" placeholder="Search by client name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label className="ops-oc-sort"><span className="sr-only">Sort clients</span><select aria-label="Sort" value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1); }}><option value="activity">Sort: Latest activity</option><option value="ending">Protection ending soonest</option><option value="name">Client A–Z</option></select></label>
      </div>
      <nav className="ops-oc-filters" aria-label="Filter clients">{filters.map(([key, label]) => <button key={key} className={'dir-filter' + (filter === key ? ' is-active' : '')} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label} <b>{counts[key]}</b></button>)}</nav>
      <p ref={announce} className="sr-only" role="status">{loading ? 'Loading your clients…' : shown.length + ' client' + (shown.length === 1 ? '' : 's') + ' shown'}</p>
      {error && <p className="ops-message amber" role="alert">We couldn’t load your clients. Check your connection and try again. <button className="ops-btn" onClick={onRetry}>Try again</button></p>}
      {loading && !clients ? <div className="ops-oc-skeletons" aria-busy="true"><span className="sr-only" role="status">Loading your clients…</span>{[0, 1, 2].map(i => <div key={i} className="ops-skeleton" />)}</div>
        : !list.length ? <div className="ops-oc-empty"><Users size={28} aria-hidden="true" /><h3>No clients yet</h3><p>When you submit an inquiry, the client will show up here with its protection dates.</p><button className="ops-btn primary" onClick={onSubmit}><Upload size={16} />Submit inquiry</button></div>
        : !shown.length ? <div className="ops-oc-empty"><Search size={28} aria-hidden="true" /><h3>No clients match</h3><p>Try a different name or clear the filters.</p><button className="ops-btn" onClick={clear}>Clear filters</button></div>
        : <div className={error ? 'ops-oc-dim' : ''}>
          <div className="dir-table-scroll ops-oc-table-wrap"><table className="dir-table ops-oc-table"><thead><tr><th>Client</th><th>Status</th><th>Protection</th><th>Last progress report</th><th>Latest activity</th><th className="dir-open-column"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{slice.map(c => <tr key={c.id} tabIndex={0} role="link" aria-label={'Open ' + c.client} onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(c.id); } }}>
              <th scope="row"><b className="dir-client-name">{c.client}</b><small>{c.hasSentProposal ? 'Proposal sent' : 'Franchising inquiry'}</small></th>
              <td><OwnerStatus value={c.status} /></td>
              <td><ClientProtectionChip client={c} now={now} /></td>
              <td><ReportChip report={lastReport(c)} /></td>
              <td>{manilaTime(c.lastActivityAt)}<small>{ageLabel(c.lastActivityAt, now)}</small></td>
              <td className="dir-open-column"><ChevronRight size={18} aria-hidden="true" /></td></tr>)}</tbody></table></div>
          <ul className="ops-oc-cards">{slice.map(c => <li key={c.id}><a className="ops-client-card" href={'#my-clients/' + c.id} aria-label={'Open ' + c.client}>
            <span className="ops-client-card-head"><b>{c.client}</b><OwnerStatus value={c.status} /></span>
            <span className="ops-client-card-meta"><ClientProtectionChip client={c} now={now} /><ReportChip report={lastReport(c)} /></span>
            <small>{manilaTime(c.lastActivityAt)} · {ageLabel(c.lastActivityAt, now)}</small></a></li>)}</ul>
        </div>}
      {list.length > 0 && <footer className="dir-bottom ops-oc-bottom"><span>{shown.length ? ((current - 1) * PAGE + 1) + '–' + Math.min(current * PAGE, shown.length) : '0'} of {shown.length} clients</span><div><button className="ops-btn" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} />Previous</button><span>Page {current} of {pages}</span><button className="ops-btn" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next<ChevronRight size={16} /></button></div></footer>}
    </section>
  </div>;
}
