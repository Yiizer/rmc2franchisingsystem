'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, CircleX, Download, Hourglass, Inbox, RefreshCw, Send, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { kpiDelta, manilaTime } from '@/lib/operations/types';
import type { ProposalStats, ProposalStatsRange, Staff } from '@/lib/operations/types';
import { api, Empty } from './operations-common';
import './operations-proposal-dashboard.css';

// Monitoring (Head and Supervisors). Redesign 2026-11-08 (PO): the whole page fits one desktop screen, no page scroll.
// Header · 5 KPI tiles · trend + busiest day · pipeline + time per employee. Colours come from the operations tokens only (see the .css).
type View = 'charts' | 'numbers';
type Summary = NonNullable<ProposalStats['summary']>;
type Kpi = 'received' | 'sent' | 'declined' | 'notStarted';
const RANGES: [ProposalStatsRange, string][] = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];
const VIEWS: [View, string][] = [['charts', 'Charts'], ['numbers', 'Numbers']];
const BUCKET_NOUN: Record<ProposalStats['period'], string> = { day: 'Day', week: 'Week', month: 'Month' };
const TIMING_ROWS = 4, FEW_SENDS = 5;
const viewKey = (userId: string) => 'rmc2.monitoringView.' + userId;
/** "both" was removed (PO 2026-11-08: no page scroll); a stored "both" opens Charts. */
function readView(userId: string): View {
  try { const value = window.localStorage.getItem(viewKey(userId)); if (value === 'numbers') return 'numbers'; } catch { /* storage blocked: use the default */ }
  return 'charts';
}
/** 8100000 -> "2h 15m", 100800000 -> "1d 4h", null -> "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
const pct = (count: number, previous: number | undefined) => previous === undefined ? '' : previous > 0 ? Math.round(count / previous * 100) + '%' : '—';
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
const SHORT_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
/** [from, to) as "Oct 10 – Nov 8, 2026" (the last day shown is the day before `to`). */
function windowLabel(from: string, to: string) { return DAY_FMT.formatRange(new Date(from), new Date(Date.parse(to) - 1)); }
function shortWindow(from: string, to: string) { return SHORT_FMT.formatRange(new Date(from), new Date(Date.parse(to) - 1)); }

const KPIS: { key: Kpi; label: string; upIsGood: boolean; Icon: typeof Inbox; tone: string }[] = [
  { key: 'received', label: 'Inquiries received', upIsGood: true, Icon: Inbox, tone: 'received' },
  { key: 'sent', label: 'Proposals sent', upIsGood: true, Icon: Send, tone: 'sent' },
  { key: 'declined', label: 'Declined', upIsGood: false, Icon: CircleX, tone: 'declined' },
  { key: 'notStarted', label: 'Not yet started', upIsGood: false, Icon: Hourglass, tone: 'idle' },
];
const delta = kpiDelta;

// ---------- CSV export (built from the numbers on screen; no extra request) ----------
const cell = (value: string | number | null) => {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; // a spreadsheet must never read a name as a formula
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};
export function monitoringCsv(stats: ProposalStats): string {
  const s = stats.summary!, rows: (string | number | null)[][] = [];
  const range = RANGES.find(([key]) => key === s.range)?.[1] || s.range;
  rows.push(['Monitoring', 'Last ' + range], ['Period', windowLabel(s.current.from, s.current.to)], ['Compared with', windowLabel(s.previous.from, s.previous.to)], ['Updated', manilaTime(stats.asOf)], []);
  rows.push(['Summary', 'This period', 'Last period', 'Change']);
  for (const k of KPIS) { const d = delta(s.current[k.key], s.previous[k.key], k.upIsGood); rows.push([k.label, s.current[k.key], s.previous[k.key], d.direction === 'down' ? '-' + d.text : d.text]); }
  rows.push(['Sent rate', s.sentRate === null ? '—' : s.sentRate + '%'], []);
  rows.push(['Proposals over time', 'Received', 'Sent', 'Declined', 'Not yet started']);
  for (const b of stats.buckets) rows.push([b.label, b.received, b.sent, b.declined, b.notStarted]);
  rows.push([], ['Proposals sent by weekday', 'Sent']);
  for (const w of s.weekdays) rows.push([w.day, w.sent]);
  rows.push([], ['Pipeline', 'Count', 'Of previous step']);
  stats.funnel.forEach((f, i) => rows.push([f.step, f.count, i ? pct(f.count, stats.funnel[i - 1].count) : '—']));
  rows.push([], ['Time per employee', 'Proposals created', 'Avg time to create (min)', 'Avg time to create', 'Proposals sent', 'Avg handling time (min)', 'Avg handling time']);
  const minutes = (ms: number | null) => ms === null ? null : Math.round(ms / 60000);
  for (const t of stats.timing) rows.push([t.name, t.created, minutes(t.avgCreateMs), formatDuration(t.avgCreateMs), t.sent, minutes(t.avgHandlingMs), formatDuration(t.avgHandlingMs)]);
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
function download(stats: ProposalStats) {
  const blob = new Blob([monitoringCsv(stats)], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(stats.asOf)); // YYYY-MM-DD, Manila
  link.href = url; link.download = `monitoring-${stats.summary!.range}-${day}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProposalDashboard({ user }: { user: Pick<Staff, 'id'> }) {
  const [range, setRange] = useState<ProposalStatsRange>('30d'), [view, setViewState] = useState<View>(() => typeof window === 'undefined' ? 'charts' : readView(user.id));
  const [stats, setStats] = useState<ProposalStats | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [denied, setDenied] = useState(false), [attempt, setAttempt] = useState(0);
  const setView = (next: View) => { setViewState(next); try { window.localStorage.setItem(viewKey(user.id), next); } catch { /* not persisted */ } };
  useEffect(() => {
    let active = true;
    api<ProposalStats>('monitoring/proposals?range=' + range)
      .then(result => { if (active) { setStats(result); setDenied(false); } })
      .catch(e => { if (!active) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, attempt]);
  const retry = useCallback(() => { setLoading(true); setError(''); setDenied(false); setAttempt(n => n + 1); }, []);
  const changeRange = (next: ProposalStatsRange) => { if (next === range) return; setLoading(true); setError(''); setDenied(false); setRange(next); };
  const shown = stats?.summary && stats.summary.range === range ? stats : null;
  const s = shown?.summary;

  return <div className={'pd-page' + (denied || error ? ' is-state' : '')}>
    <div className="pd-head">
      <div className="pd-title"><h1>Monitoring</h1>
        <p title={s ? `${windowLabel(s.current.from, s.current.to)}, compared with ${windowLabel(s.previous.from, s.previous.to)}. Updated ${manilaTime(shown!.asOf)}, Manila time.` : undefined}>{s ? <><b>{windowLabel(s.current.from, s.current.to)}</b> · vs {shortWindow(s.previous.from, s.previous.to)} · Updated {TIME_FMT.format(new Date(shown!.asOf))} Manila time</> : denied ? 'Inquiries, proposals and team timing' : 'Loading…'}</p></div>
      {!denied && <div className="pd-actions">
        <div className="pd-segment" role="group" aria-label="Show the last">{RANGES.map(([key, label]) => <button key={key} aria-pressed={range === key} className={range === key ? 'is-active' : ''} onClick={() => changeRange(key)}>{label}</button>)}</div>
        <div className="pd-segment pd-view" role="group" aria-label="Show as">{VIEWS.map(([key, label]) => <button key={key} aria-pressed={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
        <button className="ops-btn primary pd-export" onClick={() => shown && download(shown)} disabled={!shown || loading}><Download size={16} aria-hidden="true" />Export</button>
        <button className="ops-btn secondary pd-refresh" onClick={retry} disabled={loading} aria-label="Refresh" title="Refresh"><RefreshCw size={16} className={loading ? 'ops-spin' : ''} aria-hidden="true" /></button>
      </div>}
    </div>
    {denied ? <div className="ops-card pd-state" role="alert"><ShieldAlert size={24} aria-hidden="true" /><div><h2>You don’t have access to this page</h2><p>Monitoring is for the Head and Supervisors. Ask the Head if you need it.</p></div></div>
      : error ? <div className="ops-card pd-state pd-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><div><h2>We couldn’t load the monitoring numbers</h2><p>{error}</p></div><button className="ops-btn primary" onClick={retry}>Retry</button></div>
      : shown ? <Body stats={shown} view={view} busy={loading} />
      : <Skeleton />}
  </div>;
}

function Skeleton() {
  return <>
    <span className="sr-only" role="status">Loading monitoring numbers…</span>
    <div className="pd-kpis" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <div key={i} className="ops-skeleton pd-sk" />)}</div>
    <div className="pd-row pd-row-main" aria-hidden="true"><div className="ops-skeleton pd-sk" /><div className="ops-skeleton pd-sk" /></div>
    <div className="pd-row pd-row-low" aria-hidden="true"><div className="ops-skeleton pd-sk" /><div className="ops-skeleton pd-sk" /></div>
  </>;
}

/** A tiny trend line (no axes) for a KPI tile; flat when everything is 0. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values), w = 72, h = 26;
  const points = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 2 - v / max * (h - 4)).toFixed(1)}`).join(' ');
  return <svg className="pd-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function KpiTiles({ stats }: { stats: ProposalStats }) {
  const summary = stats.summary!, received = stats.funnel[0].count, sent = stats.funnel[stats.funnel.length - 1].count, rate = summary.sentRate;
  return <div className="pd-kpis">
    {KPIS.map(({ key, label, upIsGood, Icon, tone }) => {
      const value = summary.current[key], previous = summary.previous[key], d = delta(value, previous, upIsGood), compare = previous > 0;
      const said = !compare ? 'no earlier data to compare' : d.direction === 'flat' ? 'no change' : `${d.direction} ${d.text}`;
      return <section key={key} className={'ops-card pd-kpi tone-' + tone} aria-label={`${label}: ${value}, ${said}${compare ? `, versus ${previous} last period` : ''}`}>
        <div className="pd-kpi-head"><span>{label}</span><Icon size={16} aria-hidden="true" /></div>
        <div className="pd-kpi-main" aria-hidden="true"><strong>{value}</strong>
          {compare && <span className={'pd-delta is-' + d.tone}>{d.direction === 'up' ? <ArrowUp size={12} /> : d.direction === 'down' ? <ArrowDown size={12} /> : null}{d.text}</span>}
          <Sparkline values={stats.buckets.map(b => b[key])} /></div>
        <small aria-hidden="true">{compare ? `vs. ${previous} last period` : 'No earlier data to compare'}</small>
      </section>;
    })}
    <section className="ops-card pd-kpi pd-kpi-rate" aria-label={rate === null ? 'Sent rate: no inquiries received in this period' : `Sent rate ${rate}%: ${sent} of ${received} inquiries received in this period have been sent`}>
      <div className="pd-kpi-head"><span>Sent rate</span></div>
      <div className="pd-kpi-main" aria-hidden="true"><strong>{rate === null ? '—' : rate + '%'}</strong>
        <svg className="pd-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" pathLength={100} className="pd-ring-track" />{rate ? <circle cx="18" cy="18" r="15" pathLength={100} className="pd-ring-fill" strokeDasharray={`${Math.min(100, rate)} 100`} /> : null}</svg></div>
      <small aria-hidden="true">{rate === null ? 'No inquiries received' : `${sent} of ${received} inquiries sent`}</small>
    </section>
  </div>;
}

function Card({ id, title, note, legend, children, className = '' }: { id: string; title: string; note?: React.ReactNode; legend?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={'ops-card pd-card ' + className} aria-labelledby={id}>
    <div className="pd-card-head"><div><h2 id={id}>{title}</h2>{note && <p>{note}</p>}</div>{legend}</div>
    <div className="pd-card-body">{children}</div>
  </section>;
}

type TipProps = { active?: boolean; label?: string | number; payload?: { name?: string; value?: number; color?: string }[] };
function TrendTip({ active, label, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  return <div className="pd-tip"><b>{label}</b>{payload.map(p => <span key={p.name}><i style={{ background: p.color }} />{p.name}<em>{p.value}</em></span>)}</div>;
}

function Trend({ stats, view }: { stats: ProposalStats; view: View }) {
  const c = stats.summary!.current, noun = BUCKET_NOUN[stats.period];
  if (view === 'numbers') return <div className="pd-scroll pd-fill" tabIndex={0} role="region" aria-label={`Proposals per ${noun.toLowerCase()}`}><table className="pd-table"><thead><tr><th scope="col">{noun}</th><th scope="col" className="num">Received</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Declined</th><th scope="col" className="num">Not yet started</th></tr></thead>
    <tbody>{stats.buckets.map(b => <tr key={b.start}><th scope="row">{b.label}</th><td className="num">{b.received}</td><td className="num">{b.sent}</td><td className="num">{b.declined}</td><td className="num">{b.notStarted}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th><td className="num">{c.received}</td><td className="num">{c.sent}</td><td className="num">{c.declined}</td><td className="num">{c.notStarted}</td></tr></tfoot></table></div>;
  return <div className="pd-fill pd-chart" role="img" aria-label={`Column chart per ${noun.toLowerCase()}: ${c.received} inquiries received and ${c.sent} proposals sent in this period. Hover a column for the exact counts, or switch to Numbers.`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={stats.buckets} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barGap={2} barCategoryGap="14%" accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke="var(--ops-line)" />
        <XAxis dataKey="label" tick={{ fill: 'var(--ops-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--ops-line)' }} interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} tick={{ fill: 'var(--ops-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<TrendTip />} cursor={{ fill: 'var(--ops-info-tint)' }} />
        <Bar dataKey="received" name="Received" fill="var(--pd-received)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
        <Bar dataKey="sent" name="Sent" fill="var(--pd-sent)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

function BusiestDay({ summary }: { summary: Summary }) {
  const total = summary.weekdays.reduce((sum, d) => sum + d.sent, 0), few = total < FEW_SENDS, max = Math.max(1, ...summary.weekdays.map(d => d.sent));
  const top = few ? -1 : summary.weekdays.reduce((best, d, i) => d.sent > summary.weekdays[best].sent ? i : best, 0);
  return <div className="pd-fill pd-days-wrap">
    <ol className="pd-days" aria-label={'Proposals sent by weekday: ' + summary.weekdays.map(d => `${d.day} ${d.sent}`).join(', ') + (top >= 0 ? `. Most on ${summary.weekdays[top].day}.` : '.')}>
      {summary.weekdays.map((d, i) => <li key={d.day} className={i === top ? 'is-top' : ''}>
        <span className="pd-day-name">{d.day}</span>
        <span className="pd-bar-track" aria-hidden="true"><span className="pd-bar" style={{ width: (d.sent ? Math.max(4, d.sent / max * 100) : 0) + '%' }} /></span>
        <span className="pd-day-value">{d.sent}</span></li>)}
    </ol>
    {few && <p className="pd-hint">{total === 0 ? 'No proposals sent in this period.' : 'Too few sends to compare days.'}</p>}
  </div>;
}

function Pipeline({ stats, view }: { stats: ProposalStats; view: View }) {
  const steps = stats.funnel, first = steps[0].count;
  let drop = -1, lost = 0;
  steps.forEach((step, i) => { if (i && steps[i - 1].count - step.count > lost) { lost = steps[i - 1].count - step.count; drop = i; } });
  const ofFirst = (n: number) => first ? Math.round(n / first * 100) + '%' : '—';
  if (view === 'numbers') return <div className="pd-scroll pd-fill" tabIndex={0} role="region" aria-label="Pipeline steps"><table className="pd-table pd-compact"><thead><tr><th scope="col">Step</th><th scope="col" className="num">Count</th><th scope="col" className="num">Of received</th><th scope="col" className="num">Of step before</th></tr></thead>
    <tbody>{steps.map((step, i) => <tr key={step.step} className={i === drop ? 'is-drop' : ''}><th scope="row">{step.step}</th><td className="num">{step.count}</td><td className="num">{ofFirst(step.count)}</td><td className="num">{i ? pct(step.count, steps[i - 1].count) : '—'}</td></tr>)}</tbody></table></div>;
  return <ol className="pd-fill pd-steps" aria-label={'Pipeline: ' + steps.map((step, i) => `${step.step} ${step.count}${i ? `, ${ofFirst(step.count)} of received, ${pct(step.count, steps[i - 1].count)} of the step before` : ''}`).join('; ') + (drop > 0 ? `. Biggest drop: ${steps[drop - 1].step} to ${steps[drop].step}, ${lost} inquiries.` : '.')}>
    <li className="pd-steps-head" aria-hidden="true"><span /><span /><span>Count</span><span>Of received</span><span>Of step before</span><span /></li>
    {steps.map((step, i) => <li key={step.step} className={(i === drop ? 'is-drop ' : '') + (i === steps.length - 1 ? 'is-last' : '')} aria-hidden="true">
      <span className="pd-step-name">{step.step}</span>
      <span className="pd-bar-track"><span className="pd-bar" style={{ width: (step.count && first ? Math.max(2, step.count / first * 100) : 0) + '%' }} /></span>
      <b className="pd-step-count">{step.count}</b>
      <span className="pd-step-pct">{ofFirst(step.count)}</span>
      <span className="pd-step-pct">{i ? pct(step.count, steps[i - 1].count) : '—'}</span>
      <span>{i === drop && <span className="pd-drop">−{lost}</span>}</span>
    </li>)}
  </ol>;
}

function TimingTable({ rows }: { rows: ProposalStats['timing'] }) {
  const maxCreate = Math.max(1, ...rows.map(r => r.avgCreateMs || 0)), maxHandling = Math.max(1, ...rows.map(r => r.avgHandlingMs || 0));
  const bar = (ms: number | null, max: number, kind: string) => ms === null ? null : <span className={'pd-mini ' + kind} style={{ width: Math.max(4, ms / max * 100) + '%' }} aria-hidden="true" />;
  return <table className="pd-table pd-timing pd-compact"><thead><tr><th scope="col">Employee</th><th scope="col" className="num">Created</th><th scope="col" className="num">Avg create</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Avg handling</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.userId}><th scope="row">{row.name}</th><td className="num">{row.created}</td>
      <td className="num"><span className="pd-avg">{formatDuration(row.avgCreateMs)}{bar(row.avgCreateMs, maxCreate, 'create')}</span></td>
      <td className="num">{row.sent}</td>
      <td className="num"><span className="pd-avg">{formatDuration(row.avgHandlingMs)}{bar(row.avgHandlingMs, maxHandling, 'handling')}</span></td></tr>)}</tbody></table>;
}

const ROW_PX = 31, HEAD_PX = 28, LINK_PX = 26;
function Timing({ stats }: { stats: ProposalStats }) {
  const dialog = useRef<HTMLDialogElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const rows = useMemo(() => [...stats.timing].sort((a, b) => b.sent - a.sent || b.created - a.created || a.name.localeCompare(b.name)), [stats.timing]);
  useEffect(() => {
    const el = wrap.current; if (!el || typeof ResizeObserver === 'undefined') return;
    // Only the desktop one-screen layout (see the .css media query) has a fixed card height to fit; elsewhere show TIMING_ROWS.
    const fixed = window.matchMedia('(min-width:1024px) and (min-height:620px)');
    const observer = new ResizeObserver(([entry]) => setHeight(fixed.matches ? entry.contentRect.height : 0)); observer.observe(el);
    return () => observer.disconnect();
  }, [rows.length]);
  // As many rows as the card has room for (at most TIMING_ROWS), so the table never scrolls; the rest are in "View all".
  const fitAll = height ? Math.floor((height - HEAD_PX) / ROW_PX) : TIMING_ROWS;
  const shownRows = rows.length <= Math.min(TIMING_ROWS, fitAll) ? rows.length : Math.max(1, Math.min(TIMING_ROWS, height ? Math.floor((height - HEAD_PX - LINK_PX) / ROW_PX) : TIMING_ROWS));
  if (!rows.length) return <p className="pd-hint pd-fill">No employee activity in this period.</p>;
  return <div className="pd-fill pd-timing-wrap" ref={wrap}>
    <div className="pd-scroll"><TimingTable rows={rows.slice(0, shownRows)} /></div>
    {rows.length > shownRows && <>
      <button className="ops-link pd-all" onClick={() => dialog.current?.showModal()}>View all ({rows.length})</button>
      <dialog ref={dialog} className="pd-dialog" aria-labelledby="pd-all-h">
        <div className="pd-dialog-head"><h2 id="pd-all-h">Time per employee</h2><button className="ops-btn secondary pd-close" onClick={() => dialog.current?.close()} aria-label="Close"><X size={16} aria-hidden="true" /></button></div>
        <div className="pd-scroll"><TimingTable rows={rows} /></div>
      </dialog>
    </>}
  </div>;
}

function Body({ stats, view, busy }: { stats: ProposalStats; view: View; busy: boolean }) {
  const summary = stats.summary!, c = summary.current, p = summary.previous, noun = BUCKET_NOUN[stats.period].toLowerCase();
  const empty = [c.received, c.sent, c.declined, c.notStarted, p.received, p.sent, p.declined, p.notStarted].every(n => n === 0) && stats.timing.length === 0;
  const steps = stats.funnel;
  let drop = -1, lost = 0;
  steps.forEach((step, i) => { if (i && steps[i - 1].count - step.count > lost) { lost = steps[i - 1].count - step.count; drop = i; } });
  return <>
    <div className="pd-kpis-wrap" data-busy={busy || undefined} aria-busy={busy}><KpiTiles stats={stats} /></div>
    {empty ? <div className="ops-card pd-empty"><Empty text="No inquiries or proposals in this period" hint="Try a longer period, or check back after inquiries come in." /></div> : <>
      <div className="pd-row pd-row-main" data-busy={busy || undefined}>
        <Card id="pd-trend-h" title="Proposals over time" note={`Inquiries received and proposals sent, per ${noun}`}
          legend={view === 'charts' ? <ul className="pd-legend" aria-label="Legend"><li><i className="received" />Received</li><li><i className="sent" />Sent</li></ul> : undefined}>
          <Trend stats={stats} view={view} />
        </Card>
        <Card id="pd-days-h" title="Busiest day" note="Proposals sent by weekday"><BusiestDay summary={summary} /></Card>
      </div>
      <div className="pd-row pd-row-low" data-busy={busy || undefined}>
        <Card id="pd-funnel-h" title="Pipeline" note={drop > 0 ? <>Biggest drop: <b>{steps[drop - 1].step} → {steps[drop].step}</b> ({lost})</> : 'Inquiries received in this period, step by step'}><Pipeline stats={stats} view={view} /></Card>
        <Card id="pd-time-h" title="Time per employee" note="Wall-clock averages for this period"><Timing stats={stats} /></Card>
      </div>
    </>}
  </>;
}
