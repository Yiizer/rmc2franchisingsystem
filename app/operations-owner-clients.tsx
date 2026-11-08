'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Upload, Users } from 'lucide-react';
import { ageLabel, manilaTime } from '@/lib/operations/types';
import type { OwnerClient } from '@/lib/operations/owner-view';
import { ClientProtectionChip, hasPendingReport, lastReport, OwnerStatus, protectionView } from './operations-owner-chip';
import './operations-dashboard.css';
import './operations-lists.css';

// Same building blocks as the employee dashboard and Inquiries list: ops-heading, ops-stats cards, ops-table / ops-inquiry-table.
type Filter = 'all' | 'received' | 'preparing' | 'review' | 'enrolled' | 'ending' | 'pending' | 'rejected';
type Sort = 'activity' | 'ending' | 'name';
const PAGE = 25;
const ending = (c: OwnerClient, now: number) => !!c.protection && !c.protection.held && Date.parse(c.protection.expiresAt) > now && c.protection.daysLeft <= 7;
const statusIn = (c: OwnerClient, names: string[]) => names.includes(c.status);
const MATCH: Record<Filter, (c: OwnerClient, now: number) => boolean> = {
  all: () => true,
  received: c => statusIn(c, ['Received']),
  preparing: c => statusIn(c, ['Preparing proposal', 'Waiting for your details']),
  review: c => statusIn(c, ['Proposal under review', 'Proposal approved']),
  enrolled: c => statusIn(c, ['Enrolled']),
  ending: (c, now) => ending(c, now),
  pending: c => hasPendingReport(c),
  rejected: c => lastReport(c)?.status === 'rejected',
};
const CARDS: { key: Filter; label: string; tone: string }[] = [{ key: 'received', label: 'Received', tone: 'blue' }, { key: 'preparing', label: 'In preparation', tone: 'amber' }, { key: 'review', label: 'Under review', tone: 'purple' }, { key: 'enrolled', label: 'Enrolled', tone: 'green' }, { key: 'ending', label: 'Protection expiring', tone: 'slate' }];

export default function MyClients({ clients, loading, error, onRetry, onOpen, onSubmit, now }: { clients: OwnerClient[] | null; loading: boolean; error: string; onRetry: () => void; onOpen: (id: string) => void; onSubmit: () => void; now: number }) {
  const [search, setSearch] = useState(''), [sort, setSort] = useState<Sort>('activity'), [filter, setFilter] = useState<Filter>('all'), [page, setPage] = useState(1);
  const list = useMemo(() => clients || [], [clients]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(MATCH) as Filter[]).map(k => [k, list.filter(c => MATCH[k](c, now)).length])) as Record<Filter, number>, [list, now]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = list.filter(c => (!q || c.client.toLowerCase().includes(q)) && MATCH[filter](c, now));
    const key = (c: OwnerClient) => c.protection && !c.protection.held ? Date.parse(c.protection.expiresAt) : Infinity;
    if (sort === 'name') rows.sort((a, b) => a.client.localeCompare(b.client));
    else if (sort === 'ending') rows.sort((a, b) => key(a) - key(b) || a.client.localeCompare(b.client));
    else rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return rows;
  }, [list, search, filter, sort, now]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)), current = Math.min(page, pages), slice = shown.slice((current - 1) * PAGE, current * PAGE);
  const announce = useRef<HTMLParagraphElement>(null);
  const clear = () => { setSearch(''); setFilter('all'); setPage(1); };
  const pick = (key: Filter) => { setFilter(f => f === key ? 'all' : key); setPage(1); };
  const chips: [Filter, string][] = [['all', 'All'], ['pending', 'Report under review'], ['rejected', 'Report rejected']];
  const sub = (c: OwnerClient) => [c.division, c.branch].filter(Boolean).join(' · ') || 'Franchising inquiry';
  return <div className="ops-oc-page ops-oc-dash">
    <div className="ops-heading"><div><h1>My Clients</h1><p>Your clients, their protection and your progress reports.</p></div><button className="ops-btn primary" onClick={onSubmit}><Upload size={16} aria-hidden="true" />Submit inquiry</button></div>
    <div className="ops-stats ops-oc-stats" role="group" aria-label="Clients by stage">{CARDS.map(card => <button key={card.key} className={'ops-stat ' + card.tone + (filter === card.key ? ' is-active' : '')} aria-pressed={filter === card.key} onClick={() => pick(card.key)}><span>{card.label}</span><strong>{loading && !clients ? '–' : counts[card.key]}</strong><small className="sr-only">Show only these clients</small></button>)}</div>
    <section className="ops-card ops-oc-register" aria-busy={loading} aria-label="My clients">
      <div className="ops-oc-toolbar">
        <label className="ops-oc-search"><Search size={17} aria-hidden="true" /><input aria-label="Search my clients" placeholder="Search by client name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label className="ops-oc-sort"><span className="sr-only">Sort clients</span><select aria-label="Sort" value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1); }}><option value="activity">Sort: Latest activity</option><option value="ending">Protection ending soonest</option><option value="name">Client A–Z</option></select></label>
      </div>
      <nav className="ops-oc-filters" aria-label="Filter clients">{chips.map(([key, label]) => <button key={key} className={'dir-filter' + (filter === key ? ' is-active' : '')} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label} <b>{counts[key]}</b></button>)}</nav>
      <p ref={announce} className="sr-only" role="status">{loading ? 'Loading your clients…' : shown.length + ' client' + (shown.length === 1 ? '' : 's') + ' shown'}</p>
      {error && <p className="ops-message amber" role="alert">We couldn’t load your clients. Check your connection and try again. <button className="ops-btn" onClick={onRetry}>Try again</button></p>}
      {loading && !clients ? <div className="ops-oc-skeletons" aria-busy="true"><span className="sr-only" role="status">Loading your clients…</span>{[0, 1, 2].map(i => <div key={i} className="ops-skeleton" />)}</div>
        : !list.length ? <div className="ops-oc-empty"><Users size={28} aria-hidden="true" /><h3>No clients yet</h3><p>When you submit an inquiry, the client will show up here with its protection dates.</p><button className="ops-btn primary" onClick={onSubmit}><Upload size={16} />Submit inquiry</button></div>
        : !shown.length ? <div className="ops-oc-empty"><Search size={28} aria-hidden="true" /><h3>No clients match</h3><p>Try a different name or clear the filters.</p><button className="ops-btn" onClick={clear}>Clear filters</button></div>
        : <div className={error ? 'ops-oc-dim' : ''}>
          <div className="ops-table-scroll ops-oc-table-wrap"><table className="ops-table ops-inquiry-table ops-oc-inq-table"><thead><tr><th>Inquiry</th><th>Status</th><th>Received</th><th>Updated</th></tr></thead>
            <tbody>{slice.map(c => <tr key={c.id} tabIndex={0} role="link" aria-label={'Open ' + c.client} onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(c.id); } }}>
              <td data-label="Account"><b className="ops-account">{c.client}</b><small>{sub(c)}</small><small>Protection: {protectionView(c, now).text}</small></td>
              <td data-label="Status"><OwnerStatus value={c.status} />{hasPendingReport(c) && <small>Progress report under review</small>}</td>
              <td data-label="Received">{manilaTime(c.createdAt)}<small>{ageLabel(c.createdAt, now)}</small></td>
              <td data-label="Updated" title={manilaTime(c.lastActivityAt)}>{ageLabel(c.lastActivityAt, now)}</td></tr>)}</tbody></table></div>
          <ul className="ops-oc-cards">{slice.map(c => <li key={c.id}><a className="ops-client-card" href={'#my-clients/' + c.id} aria-label={'Open ' + c.client}>
            <span className="ops-client-card-head"><b>{c.client}</b><OwnerStatus value={c.status} /></span>
            <span className="ops-client-card-meta"><ClientProtectionChip client={c} now={now} /></span>
            <small>Received {manilaTime(c.createdAt)} · Updated {ageLabel(c.lastActivityAt, now)}</small></a></li>)}</ul>
        </div>}
      {list.length > 0 && <footer className="dir-bottom ops-oc-bottom"><span>{shown.length ? ((current - 1) * PAGE + 1) + '–' + Math.min(current * PAGE, shown.length) : '0'} of {shown.length} clients</span><div><button className="ops-btn" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} />Previous</button><span>Page {current} of {pages}</span><button className="ops-btn" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next<ChevronRight size={16} /></button></div></footer>}
    </section>
  </div>;
}
