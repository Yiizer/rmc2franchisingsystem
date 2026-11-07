'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, CircleX, Download, Hourglass, Inbox, RefreshCw, Send, ShieldAlert, TriangleAlert } from 'lucide-react';
import { kpiDelta, manilaTime } from '@/lib/operations/types';
import type { ProposalStats, ProposalStatsRange, Staff } from '@/lib/operations/types';
import { api, Empty } from './operations-common';
import './operations-proposal-dashboard.css';

// Monitoring (Head and Supervisors), feedback round 2026-11-08. Layout: header with range + Export, 4 KPI cards, trend + busiest day,
// pipeline + sent rate, time per employee. Colours come from the operations tokens only (see the .css).
type View = 'charts' | 'numbers' | 'both';
type Summary = NonNullable<ProposalStats['summary']>;
type Kpi = 'received' | 'sent' | 'declined' | 'notStarted';
const RANGES: [ProposalStatsRange, string][] = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];
const VIEWS: [View, string][] = [['charts', 'Charts'], ['numbers', 'Numbers'], ['both', 'Both']];
const BUCKET_NOUN: Record<ProposalStats['period'], string> = { day: 'Day', week: 'Week', month: 'Month' };
const viewKey = (userId: string) => 'rmc2.monitoringView.' + userId;
function readView(userId: string): View {
  try { const value = window.localStorage.getItem(viewKey(userId)); if (value === 'charts' || value === 'numbers' || value === 'both') return value; } catch { /* storage blocked: use the default */ }
  return 'both';
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
/** [from, to) as "Oct 10 – Nov 8, 2026" (the last day shown is the day before `to`). */
function windowLabel(from: string, to: string) { return DAY_FMT.formatRange(new Date(from), new Date(Date.parse(to) - 1)); }

const KPIS: { key: Kpi; label: string; hint: string; upIsGood: boolean; Icon: typeof Inbox; tone: string }[] = [
  { key: 'received', label: 'Inquiries received', hint: 'New inquiries in this period', upIsGood: true, Icon: Inbox, tone: 'received' },
  { key: 'sent', label: 'Proposals sent', hint: 'Inquiries with a proposal emailed', upIsGood: true, Icon: Send, tone: 'sent' },
  { key: 'declined', label: 'Declined', hint: 'Inquiries declined in this period', upIsGood: false, Icon: CircleX, tone: 'declined' },
  { key: 'notStarted', label: 'Not yet started', hint: 'Received in this period, still not started', upIsGood: false, Icon: Hourglass, tone: 'idle' },
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
  const [range, setRange] = useState<ProposalStatsRange>('30d'), [view, setViewState] = useState<View>(() => typeof window === 'undefined' ? 'both' : readView(user.id));
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

  return <div className="pd-page">
    <div className="ops-heading pd-head"><div><h1>Monitoring</h1><p>Inquiries, proposals and how long the team takes. Times are Manila time.</p></div>
      {!denied && <div className="pd-actions">
        <div className="pd-segment" role="group" aria-label="Show the last">{RANGES.map(([key, label]) => <button key={key} aria-pressed={range === key} className={range === key ? 'is-active' : ''} onClick={() => changeRange(key)}>{label}</button>)}</div>
        <button className="ops-btn primary pd-export" onClick={() => shown && download(shown)} disabled={!shown || loading}><Download size={16} aria-hidden="true" />Export</button>
        <button className="ops-btn secondary pd-refresh" onClick={retry} disabled={loading} aria-label="Refresh"><RefreshCw size={16} className={loading ? 'ops-spin' : ''} aria-hidden="true" /><span>Refresh</span></button>
      </div>}
    </div>
    {denied ? <div className="ops-card ops-pad pd-state" role="alert"><ShieldAlert size={24} aria-hidden="true" /><div><h2>You don’t have access to this page</h2><p>Monitoring is for the Head and Supervisors. Ask the Head if you need it.</p></div></div> : <>
      <div className="pd-controls">
        {shown ? <p className="pd-window"><b>{windowLabel(shown.summary!.current.from, shown.summary!.current.to)}</b><span> · compared with {windowLabel(shown.summary!.previous.from, shown.summary!.previous.to)}</span></p> : <span />}
        <div className="pd-segment pd-view" role="group" aria-label="Show">{VIEWS.map(([key, label]) => <button key={key} aria-pressed={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
        {shown && <small className="pd-asof">Updated {manilaTime(shown.asOf)}</small>}
      </div>
      {error && <div className="ops-card ops-pad pd-state pd-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><div><h2>We couldn’t load the monitoring numbers</h2><p>{error}</p></div><button className="ops-btn primary" onClick={retry}>Retry</button></div>}
      {!shown && !error && <Skeleton />}
      {shown && !error && <Body stats={shown} view={view} busy={loading} />}
    </>}
  </div>;
}

function Skeleton() {
  return <div className="pd-skeleton" role="status" aria-busy="true"><span className="sr-only">Loading monitoring numbers…</span>
    <div className="pd-kpis">{KPIS.map(k => <div key={k.key} className="ops-skeleton pd-sk-kpi" />)}</div>
    <div className="pd-row"><div className="ops-skeleton pd-sk-card" /><div className="ops-skeleton pd-sk-card" /></div>
    <div className="pd-row"><div className="ops-skeleton pd-sk-card" /><div className="ops-skeleton pd-sk-card" /></div>
  </div>;
}

function KpiCards({ summary }: { summary: Summary }) {
  return <div className="pd-kpis">{KPIS.map(({ key, label, hint, upIsGood, Icon, tone }) => {
    const value = summary.current[key], previous = summary.previous[key], d = delta(value, previous, upIsGood);
    const said = d.direction === 'flat' ? (previous > 0 ? 'no change' : 'no previous count') : `${d.direction} ${d.text}`;
    return <section key={key} className={'ops-card pd-kpi tone-' + tone} aria-label={`${label}: ${value}, ${said}, versus ${previous} last period`} title={hint}>
      <div className="pd-kpi-head"><span>{label}</span><Icon size={18} aria-hidden="true" /></div>
      <div className="pd-kpi-value"><strong>{value}</strong>
        <span className={'pd-delta is-' + d.tone} aria-hidden="true">{d.direction === 'up' ? <ArrowUp size={12} /> : d.direction === 'down' ? <ArrowDown size={12} /> : null}{d.text}</span></div>
      <small aria-hidden="true">vs. {previous} last period</small>
    </section>;
  })}</div>;
}

/** Half-circle gauge in plain SVG: sent ÷ received for the period. */
function Gauge({ rate, sent, received }: { rate: number | null; sent: number; received: number }) {
  const arc = 'M 16 104 A 84 84 0 0 1 184 104';
  return <div className="pd-gauge" role="img" aria-label={rate === null ? 'Sent rate: no inquiries received in this period' : `Sent rate ${rate}%: ${sent} of ${received} inquiries received in this period have been sent`}>
    <svg viewBox="0 0 200 116" aria-hidden="true">
      <path d={arc} pathLength={100} className="pd-gauge-track" />
      {rate !== null && rate > 0 && <path d={arc} pathLength={100} className="pd-gauge-fill" strokeDasharray={`${Math.min(100, rate)} 100`} />}
    </svg>
    <div className="pd-gauge-label" aria-hidden="true"><strong>{rate === null ? '—' : rate + '%'}</strong><span>{rate === null ? 'No inquiries received' : `${sent} of ${received} inquiries sent`}</span></div>
  </div>;
}

function Body({ stats, view, busy }: { stats: ProposalStats; view: View; busy: boolean }) {
  const summary = stats.summary!;
  const charts = view !== 'numbers', numbers = view !== 'charts', noun = BUCKET_NOUN[stats.period];
  const funnel = stats.funnel.map((item, index) => ({ ...item, fill: 'var(--pd-step-' + (index + 1) + ')', share: index ? pct(item.count, stats.funnel[index - 1].count) : '' }));
  const top = useMemo(() => summary.weekdays.reduce((best, day, i) => day.sent > summary.weekdays[best].sent ? i : best, 0), [summary]);
  const maxDay = Math.max(1, ...summary.weekdays.map(d => d.sent));
  const timing = stats.timing.map(row => ({ name: row.name, create: row.avgCreateMs === null ? undefined : row.avgCreateMs, handling: row.avgHandlingMs === null ? undefined : row.avgHandlingMs }));
  const timingHasBars = timing.some(row => row.create !== undefined || row.handling !== undefined);
  const c = summary.current, p = summary.previous;
  const empty = [c.received, c.sent, c.declined, c.notStarted, p.received, p.sent, p.declined, p.notStarted].every(n => n === 0) && stats.timing.length === 0;
  const anySent = summary.weekdays.some(d => d.sent > 0);

  return <div className="pd-body" aria-busy={busy} data-busy={busy || undefined}>
    <KpiCards summary={summary} />
    {empty ? <div className="ops-card"><Empty text="No inquiries or proposals in this period" hint="Try a longer period, or check back after inquiries come in." /></div> : <>
      <div className="pd-row">
        <section className="ops-card pd-card" aria-labelledby="pd-trend-h"><div className="ops-card-head"><div><h2 id="pd-trend-h">Proposals over time</h2><p>Inquiries received and proposals sent, per {noun.toLowerCase()}</p></div></div>
          {charts && <div className="pd-chart" role="img" aria-label={`Area chart per ${noun.toLowerCase()}: ${c.received} inquiries received and ${c.sent} proposals sent in this period.`}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={stats.buckets} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} accessibilityLayer={false}>
                <CartesianGrid vertical={false} stroke="var(--ops-line)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--ops-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--ops-line)' }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--ops-muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--ops-line)', fontSize: 13 }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 13 }} />
                <Area type="monotone" dataKey="received" name="Received" stroke="var(--pd-received)" strokeWidth={2} strokeDasharray="5 4" fill="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="sent" name="Sent" stroke="var(--pd-sent)" strokeWidth={2} fill="var(--pd-sent-tint)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>}
          {numbers && <div className="pd-scroll pd-scroll-tall" tabIndex={0} role="region" aria-label={`Proposals per ${noun.toLowerCase()}, scroll for more`}><table className="pd-table"><thead><tr><th scope="col">{noun}</th><th scope="col" className="num">Received</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Declined</th><th scope="col" className="num">Not yet started</th></tr></thead>
            <tbody>{stats.buckets.map(b => <tr key={b.start}><th scope="row">{b.label}</th><td className="num">{b.received}</td><td className="num">{b.sent}</td><td className="num">{b.declined}</td><td className="num">{b.notStarted}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">Total</th><td className="num">{c.received}</td><td className="num">{c.sent}</td><td className="num">{c.declined}</td><td className="num">{c.notStarted}</td></tr></tfoot></table></div>}
        </section>
        <section className="ops-card pd-card" aria-labelledby="pd-days-h"><div className="ops-card-head"><div><h2 id="pd-days-h">Busiest day</h2><p>{anySent ? <>Proposals sent by weekday · most on <b>{summary.weekdays[top].day}</b></> : 'Proposals sent by weekday'}</p></div></div>
          {charts && (anySent ? <ol className="pd-days" role="img" aria-label={'Proposals sent by weekday: ' + summary.weekdays.map(d => `${d.day} ${d.sent}`).join(', ') + '.'}>
            {summary.weekdays.map((d, i) => <li key={d.day} className={i === top ? 'is-top' : ''} aria-hidden="true">
              <span className="pd-day-value">{d.sent}</span>
              <span className="pd-day-track"><span className="pd-day-bar" style={{ height: Math.max(d.sent ? 8 : 0, Math.round(d.sent / maxDay * 100)) + '%' }} /></span>
              <span className="pd-day-name">{d.day}</span></li>)}
          </ol> : <p className="ops-pad pd-none">No proposals were sent in this period.</p>)}
          {numbers && <div className="pd-scroll" tabIndex={0} role="region" aria-label="Proposals sent by weekday"><table className="pd-table pd-table-narrow"><thead><tr><th scope="col">Weekday</th><th scope="col" className="num">Sent</th></tr></thead>
            <tbody>{summary.weekdays.map(d => <tr key={d.day}><th scope="row">{d.day}</th><td className="num">{d.sent}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      <div className="pd-row">
        <section className="ops-card pd-card" aria-labelledby="pd-funnel-h"><div className="ops-card-head"><div><h2 id="pd-funnel-h">Pipeline</h2><p>Inquiries received in this period, step by step</p></div></div>
          {charts && <div className="pd-chart" role="img" aria-label={'Pipeline: ' + funnel.map(item => item.step + ' ' + item.count + (item.share ? ' (' + item.share + ' of the step before)' : '')).join(', ') + '.'}>
            {/* Step chart: one bar per step, its width proportional to the first step. Plain markup reads well at 375px and with zero counts. */}
            <ol className="pd-steps" aria-hidden="true">{funnel.map(item => {
              const first = funnel[0].count || 1, width = item.count ? Math.max(6, Math.round(item.count / first * 100)) : 0;
              return <li key={item.step}><span className="pd-step-name">{item.step}</span><span className="pd-step-track"><span className="pd-step-bar" style={{ width: width + '%', background: item.fill }} /></span><span className="pd-step-value"><b>{item.count}</b>{item.share ? <small>{item.share}</small> : null}</span></li>;
            })}</ol>
          </div>}
          {numbers && <div className="pd-scroll" tabIndex={0} role="region" aria-label="Pipeline steps"><table className="pd-table"><thead><tr><th scope="col">Step</th><th scope="col" className="num">Count</th><th scope="col" className="num">Of previous step</th></tr></thead>
            <tbody>{funnel.map(item => <tr key={item.step}><th scope="row">{item.step}</th><td className="num">{item.count}</td><td className="num">{item.share || '—'}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="ops-card pd-card pd-rate" aria-labelledby="pd-rate-h"><div className="ops-card-head"><div><h2 id="pd-rate-h">Sent rate</h2><p>Share of this period’s inquiries that have a proposal sent</p></div></div>
          <Gauge rate={summary.sentRate} sent={stats.funnel[stats.funnel.length - 1].count} received={stats.funnel[0].count} />
        </section>
      </div>
      <section className="ops-card pd-card" aria-labelledby="pd-time-h"><div className="ops-card-head"><div><h2 id="pd-time-h">Time per employee</h2><p>Wall-clock time, nights and weekends included. Averages are for proposals in this period.</p></div></div>
        {stats.timing.length === 0 ? <p className="ops-pad pd-none">No employee activity in this period.</p> : <>
          {charts && timingHasBars && <div className="pd-chart pd-time-chart" role="img" aria-label={'Average times per employee: ' + stats.timing.map(row => `${row.name}, create ${formatDuration(row.avgCreateMs)}, handling ${formatDuration(row.avgHandlingMs)}`).join('; ') + '. The table below has the same numbers.'}>
            <ResponsiveContainer width="100%" height={Math.max(180, timing.length * 64 + 70)}>
              <BarChart data={timing} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} accessibilityLayer={false}>
                <CartesianGrid horizontal={false} stroke="var(--ops-line)" />
                <XAxis type="number" tickFormatter={(v: number) => formatDuration(v)} tick={{ fill: 'var(--ops-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--ops-line)' }} />
                <YAxis type="category" dataKey="name" width={96} tick={{ fill: 'var(--ops-ink)', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => formatDuration(Number(v))} cursor={{ fill: 'var(--ops-info-tint)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--ops-line)', fontSize: 13 }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="create" name="Avg time to create" fill="var(--pd-create)" isAnimationActive={false} />
                <Bar dataKey="handling" name="Avg handling time" fill="var(--pd-handling)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>}
          <div className="pd-scroll" tabIndex={0} role="region" aria-label="Time per employee, scroll for more"><table className="pd-table"><thead><tr><th scope="col">Employee</th><th scope="col" className="num">Proposals created</th><th scope="col" className="num">Avg time to create</th><th scope="col" className="num">Proposals sent</th><th scope="col" className="num">Avg handling time</th></tr></thead>
            <tbody>{stats.timing.map(row => <tr key={row.userId}><th scope="row">{row.name}</th><td className="num">{row.created}</td><td className="num">{formatDuration(row.avgCreateMs)}</td><td className="num">{row.sent}</td><td className="num">{formatDuration(row.avgHandlingMs)}</td></tr>)}</tbody></table></div></>}
      </section>
    </>}
  </div>;
}
