'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { manilaTime } from '@/lib/operations/types';
import type { ProposalStats, ProposalStatsPeriod, Staff } from '@/lib/operations/types';
import { api, Empty } from './operations-common';
import './operations-proposal-dashboard.css';

type View = 'charts' | 'numbers' | 'both';
const PERIODS: [ProposalStatsPeriod, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const VIEWS: [View, string][] = [['charts', 'Charts'], ['numbers', 'Numbers'], ['both', 'Both']];
const PERIOD_NOUN: Record<ProposalStatsPeriod, string> = { day: 'day', week: 'week', month: 'month' };
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

export default function ProposalDashboard({ user }: { user: Pick<Staff, 'id'> }) {
  const [period, setPeriod] = useState<ProposalStatsPeriod>('day'), [view, setViewState] = useState<View>(() => typeof window === 'undefined' ? 'both' : readView(user.id));
  const [stats, setStats] = useState<ProposalStats | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [denied, setDenied] = useState(false), [attempt, setAttempt] = useState(0);
  const setView = (next: View) => { setViewState(next); try { window.localStorage.setItem(viewKey(user.id), next); } catch { /* not persisted */ } };
  useEffect(() => {
    let active = true;
    api<ProposalStats>('monitoring/proposals?period=' + period)
      .then(result => { if (active) { setStats(result); setDenied(false); } })
      .catch(e => { if (!active) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, attempt]);
  const retry = useCallback(() => { setLoading(true); setError(''); setDenied(false); setAttempt(n => n + 1); }, []);
  const changePeriod = (next: ProposalStatsPeriod) => { if (next === period) return; setLoading(true); setError(''); setDenied(false); setPeriod(next); };
  const shown = stats && stats.period === period ? stats : null;

  return <div className="pd-page">
    <div className="ops-heading"><div><h1>Proposal dashboard</h1><p>How many proposals were sent, declined or not started, and how long the team takes. Times are Manila time.</p></div>
      <button className="ops-btn secondary" onClick={retry} disabled={loading}><RefreshCw size={16} className={loading ? 'ops-spin' : ''} aria-hidden="true" />Refresh</button></div>
    {denied ? <div className="ops-card ops-pad pd-state" role="alert"><ShieldAlert size={24} aria-hidden="true" /><div><h2>You don’t have access to this page</h2><p>The proposal dashboard is for the Head and Supervisors. Ask the Head if you need it.</p></div></div> : <>
      <div className="pd-controls">
        <div className="pd-segment" role="group" aria-label="Period">{PERIODS.map(([key, label]) => <button key={key} aria-pressed={period === key} className={period === key ? 'is-active' : ''} onClick={() => changePeriod(key)}>{label}</button>)}</div>
        <div className="pd-segment" role="group" aria-label="Show">{VIEWS.map(([key, label]) => <button key={key} aria-pressed={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
        {shown && <small className="pd-asof">Updated {manilaTime(shown.asOf)}</small>}
      </div>
      {error && <div className="ops-card ops-pad pd-state pd-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><div><h2>We couldn’t load the proposal numbers</h2><p>{error}</p></div><button className="ops-btn primary" onClick={retry}>Retry</button></div>}
      {!shown && !error && <div className="pd-skeleton" role="status" aria-busy="true"><span className="sr-only">Loading proposal numbers…</span><div className="ops-skeleton" /><div className="ops-skeleton" /><div className="ops-skeleton" /></div>}
      {shown && !error && <Body stats={shown} view={view} busy={loading} />}
    </>}
  </div>;
}

function Body({ stats, view, busy }: { stats: ProposalStats; view: View; busy: boolean }) {
  const totals = useMemo(() => stats.buckets.reduce((sum, b) => ({ sent: sum.sent + b.sent, declined: sum.declined + b.declined, notStarted: sum.notStarted + b.notStarted }), { sent: 0, declined: 0, notStarted: 0 }), [stats]);
  const total = totals.sent + totals.declined + totals.notStarted;
  const empty = total === 0 && (stats.funnel[0]?.count ?? 0) === 0 && stats.timing.length === 0;
  const noun = PERIOD_NOUN[stats.period];
  if (empty) return <div className="ops-card"><Empty text="No proposals in this period" hint="Try a longer period, or check back after inquiries come in." /></div>;
  const charts = view !== 'numbers', numbers = view !== 'charts';
  const funnel = stats.funnel.map((item, index) => ({ ...item, label: `${item.step} ${item.count}${index ? ' (' + pct(item.count, stats.funnel[index - 1].count) + ')' : ''}`, fill: 'var(--pd-step-' + (index + 1) + ')' }));
  const timing = stats.timing.map(row => ({ name: row.name, create: row.avgCreateMs === null ? undefined : row.avgCreateMs, handling: row.avgHandlingMs === null ? undefined : row.avgHandlingMs }));
  const timingHasBars = timing.some(row => row.create !== undefined || row.handling !== undefined);
  return <div className="pd-body" aria-busy={busy} data-busy={busy || undefined}>
    {charts && <div className="pd-charts">
      <section className="ops-card pd-card" aria-labelledby="pd-bars-h"><div className="ops-card-head"><div><h2 id="pd-bars-h">Proposals per {noun}</h2><p>Sent, declined and not yet started</p></div></div>
        <div className="pd-chart" role="img" aria-label={`Stacked bar chart of proposals per ${noun}. Totals: ${totals.sent} sent, ${totals.declined} declined, ${totals.notStarted} not yet started. The Numbers view has the same data.`}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats.buckets} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer={false}>
              <CartesianGrid vertical={false} stroke="var(--ops-line)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--ops-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--ops-line)' }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--ops-muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'var(--ops-info-tint)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--ops-line)', fontSize: 13 }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="sent" name="Sent" stackId="p" fill="var(--pd-sent)" isAnimationActive={false} />
              <Bar dataKey="declined" name="Declined" stackId="p" fill="var(--pd-declined)" isAnimationActive={false} />
              <Bar dataKey="notStarted" name="Not started" stackId="p" fill="var(--pd-idle)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div></section>
      <section className="ops-card pd-card" aria-labelledby="pd-funnel-h"><div className="ops-card-head"><div><h2 id="pd-funnel-h">Where proposals get to</h2><p>Inquiries received in the selected range, step by step</p></div></div>
        <div className="pd-chart" role="img" aria-label={'Funnel chart: ' + stats.funnel.map((item, index) => item.step + ' ' + item.count + (index ? ' (' + pct(item.count, stats.funnel[index - 1].count) + ' of the step before)' : '')).join(', ') + '.'}>
          {/* Step (funnel) chart: one centred bar per step, its width proportional to the first step. Plain markup reads well at 375px and with zero counts. */}
          <ol className="pd-steps" aria-hidden="true">{funnel.map((item, index) => {
            const first = funnel[0].count || 1, width = item.count ? Math.max(6, Math.round(item.count / first * 100)) : 0;
            return <li key={item.step}><span className="pd-step-name">{item.step}</span><span className="pd-step-track"><span className="pd-step-bar" style={{ width: width + '%', background: item.fill }} /></span><span className="pd-step-value"><b>{item.count}</b>{index ? <small>{pct(item.count, funnel[index - 1].count)}</small> : null}</span></li>;
          })}</ol>
        </div></section>
    </div>}
    {numbers && <div className="pd-numbers">
      <section className="ops-card pd-card" aria-labelledby="pd-table-h"><div className="ops-card-head"><div><h2 id="pd-table-h">Proposals per {noun}</h2><p>The same numbers as the chart</p></div></div>
        <div className="pd-scroll" tabIndex={0} role="region" aria-label={`Proposals per ${noun}, scroll for more`}><table className="pd-table"><thead><tr><th scope="col">{noun === 'day' ? 'Day' : noun === 'week' ? 'Week' : 'Month'}</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Declined</th><th scope="col" className="num">Not started</th><th scope="col" className="num">Total</th></tr></thead>
          <tbody>{stats.buckets.map(b => <tr key={b.start}><th scope="row">{b.label}</th><td className="num">{b.sent}</td><td className="num">{b.declined}</td><td className="num">{b.notStarted}</td><td className="num">{b.sent + b.declined + b.notStarted}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Total</th><td className="num">{totals.sent}</td><td className="num">{totals.declined}</td><td className="num">{totals.notStarted}</td><td className="num">{total}</td></tr></tfoot></table></div></section>
      <section className="ops-card pd-card" aria-labelledby="pd-steps-h"><div className="ops-card-head"><div><h2 id="pd-steps-h">Where proposals get to</h2><p>Count and share of the step before</p></div></div>
        <div className="pd-scroll" tabIndex={0} role="region" aria-label="Funnel steps, scroll for more"><table className="pd-table"><thead><tr><th scope="col">Step</th><th scope="col" className="num">Count</th><th scope="col" className="num">Of previous step</th></tr></thead>
          <tbody>{stats.funnel.map((item, index) => <tr key={item.step}><th scope="row">{item.step}</th><td className="num">{item.count}</td><td className="num">{index ? pct(item.count, stats.funnel[index - 1].count) : '—'}</td></tr>)}</tbody></table></div></section>
    </div>}
    <section className="ops-card pd-card" aria-labelledby="pd-time-h"><div className="ops-card-head"><div><h2 id="pd-time-h">Time per employee</h2><p>Wall-clock time, nights and weekends included. Averages are for proposals in this range.</p></div></div>
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
  </div>;
}
