'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, CircleX, Download, Hourglass, Inbox, RefreshCw, Send, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { kpiDelta, manilaTime } from '@/lib/operations/types';
import type { ProposalEmployeeDetail, ProposalStats, ProposalStatsRange, ProposalTimelineEvent, Staff } from '@/lib/operations/types';
import { MONTH_NAMES, earliestStart, manilaDay, manilaDayStart, parsePeriod, periodKey, periodLabel, periodStart, shiftPeriod } from '@/lib/operations/proposal-periods';
import { api, Empty } from './operations-common';
import type { PdfModel } from './operations-proposal-dashboard-pdf';
import './operations-proposal-dashboard.css';

// Monitoring (Head and Supervisors). Redesign 2026-11-08 (PO): the whole page fits one desktop screen, no page scroll.
// Header (range, period stepper, view, export) · 5 KPI tiles · trend + busiest day · pipeline + time per employee (rows open a drill-down).
// Feedback round 2026-11-08b: calendar periods Today / Weekly / Monthly / Yearly, past periods (?range=&period= in the URL), PDF export.
// Colours come from the operations tokens only (see the .css).
type View = 'charts' | 'numbers';
type Summary = NonNullable<ProposalStats['summary']>;
type Kpi = 'received' | 'sent' | 'declined' | 'notStarted';
type Selection = { range: ProposalStatsRange; key: string | null }; // key null = the current period
type TimingRow = ProposalStats['timing'][number];
const RANGES: [ProposalStatsRange, string][] = [['day', 'Today'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']];
const RANGE_LABEL = Object.fromEntries(RANGES) as Record<ProposalStatsRange, string>;
const STEP_NOUN: Record<ProposalStatsRange, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };
const SAME_POINT: Record<ProposalStatsRange, string> = { day: 'by this time yesterday', week: 'by this point last week', month: 'by this point last month', year: 'by this point last year' };
const BEFORE: Record<ProposalStatsRange, string> = { day: 'the day before', week: 'the week before', month: 'the month before', year: 'the year before' };
const VIEWS: [View, string][] = [['charts', 'Charts'], ['numbers', 'Numbers']];
const BUCKET_NOUN: Record<ProposalStats['period'], string> = { hour: 'Hour', day: 'Day', week: 'Week', month: 'Month' };
const TIMING_ROWS = 4, FEW_SENDS = 5, DEFAULT_RANGE: ProposalStatsRange = 'month';
const STILL_NEW_HELP = 'Received in this period and still at New inquiry: no draft saved yet and not closed (counted as of now).';
const viewKey = (userId: string) => 'rmc2.monitoringView.' + userId;
/** "both" was removed (PO 2026-11-08: no page scroll); a stored "both" opens Charts. */
function readView(userId: string): View {
  try { const value = window.localStorage.getItem(viewKey(userId)); if (value === 'numbers') return 'numbers'; } catch { /* storage blocked: use the default */ }
  return 'charts';
}
/** ?range=month&period=2026-10 from the page URL. Anything invalid falls back to the current period (the server validates again). */
function readSelection(): Selection {
  const params = new URLSearchParams(window.location.search), range = RANGES.find(([key]) => key === params.get('range'))?.[0] || DEFAULT_RANGE;
  const key = params.get('period'), now = Date.now();
  if (!key) return { range, key: null };
  const parsed = parsePeriod(range, key, now);
  return { range, key: parsed.ok && parsed.start !== periodStart(range, now) ? key : null };
}
/** The clock the period controls use, kept in state (render stays pure) and refreshed every minute so "current" rolls over at midnight. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  return now;
}
const startOf = (selection: Selection, now: number) => { if (selection.key) { const parsed = parsePeriod(selection.range, selection.key, now); if (parsed.ok) return parsed.start; } return periodStart(selection.range, now); };
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
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
const compareText = (s: Summary) => s.toDate ? `${s.previousLabel}, up to the same point` : s.previousLabel;
const vsText = (s: Summary, previous: number) => s.toDate ? `vs. ${previous} ${SAME_POINT[s.range]}` : `vs. ${previous} ${BEFORE[s.range]}`;

const KPIS: { key: Kpi; label: string; upIsGood: boolean; Icon: typeof Inbox; tone: string; help?: string }[] = [
  { key: 'received', label: 'Inquiries received', upIsGood: true, Icon: Inbox, tone: 'received' },
  { key: 'sent', label: 'Proposals sent', upIsGood: true, Icon: Send, tone: 'sent' },
  { key: 'declined', label: 'Declined', upIsGood: false, Icon: CircleX, tone: 'declined' },
  { key: 'notStarted', label: 'Still new', upIsGood: false, Icon: Hourglass, tone: 'idle', help: STILL_NEW_HELP },
];
const KPI_TOKEN: Record<string, string> = { received: '--pd-received', sent: '--pd-sent', declined: '--pd-declined', idle: '--pd-idle' };
const delta = kpiDelta;
const byMostSent = (rows: TimingRow[]) => [...rows].sort((a, b) => b.sent - a.sent || b.created - a.created || a.name.localeCompare(b.name));

// ---------- PDF export (built from the numbers on screen; no extra request) ----------
export function monitoringPdfModel(stats: ProposalStats, generated: Date): PdfModel {
  const s = stats.summary!, first = stats.funnel[0].count, received = first, sent = stats.funnel[stats.funnel.length - 1].count;
  const few = s.weekdays.reduce((sum, d) => sum + d.sent, 0) < FEW_SENDS;
  return {
    rangeLabel: RANGE_LABEL[s.range], periodLabel: s.label, compareText: 'Compared with ' + compareText(s), generatedAt: manilaTime(generated.toISOString()), asOf: manilaTime(stats.asOf),
    fileName: `monitoring-${s.range}-${s.period}-generated-${manilaDay(generated.getTime())}.pdf`,
    kpis: [...KPIS.map(k => {
      const value = s.current[k.key], previous = s.previous[k.key], d = delta(value, previous, k.upIsGood);
      return { label: k.label, value: String(value), delta: previous > 0 ? (d.direction === 'up' ? '+' : d.direction === 'down' ? '-' : '') + d.text : '', tone: d.tone, sub: previous > 0 ? vsText(s, previous) : 'No earlier data to compare', color: KPI_TOKEN[k.tone] };
    }), { label: 'Sent rate', value: s.sentRate === null ? '—' : s.sentRate + '%', delta: '', tone: 'neutral' as const, sub: s.sentRate === null ? 'No inquiries received' : `${sent} of ${received} inquiries sent`, color: '--pd-sent' }],
    trend: { noun: BUCKET_NOUN[stats.period].toLowerCase(), labels: stats.buckets.map(b => b.label), received: stats.buckets.map(b => b.received), sent: stats.buckets.map(b => b.sent), future: stats.buckets.map(b => !!b.future) },
    weekdays: s.range === 'day' ? null : s.weekdays,
    weekdayNote: s.range === 'day' ? 'Pick Weekly or longer to compare days.' : few ? (s.weekdays.every(d => !d.sent) ? 'No proposals sent in this period.' : 'Too few sends to compare days.') : '',
    funnel: stats.funnel.map((f, i) => ({ step: f.step, count: f.count, ofFirst: first ? Math.round(f.count / first * 100) + '%' : '—', ofBefore: i ? pct(f.count, stats.funnel[i - 1].count) : '—' })),
    timing: byMostSent(stats.timing).map(t => ({ name: t.name, created: String(t.created), avgCreate: formatDuration(t.avgCreateMs), sent: String(t.sent), avgHandling: formatDuration(t.avgHandlingMs) })),
  };
}

export default function ProposalDashboard({ user }: { user: Pick<Staff, 'id'> }) {
  const [selection, setSelection] = useState<Selection>(() => typeof window === 'undefined' ? { range: DEFAULT_RANGE, key: null } : readSelection());
  const [view, setViewState] = useState<View>(() => typeof window === 'undefined' ? 'charts' : readView(user.id));
  // `loaded.request` is the request the stats answer, so a response is shown only for the selection (and current period) it was asked for.
  const [loaded, setLoaded] = useState<{ request: string; stats: ProposalStats } | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [denied, setDenied] = useState(false), [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const page = useRef<HTMLDivElement>(null), now = useNow();
  const { range, key } = selection, currentKey = periodKey(range, periodStart(range, now));
  const setView = (next: View) => { setViewState(next); try { window.localStorage.setItem(viewKey(user.id), next); } catch { /* not persisted */ } };
  useEffect(() => {
    let active = true;
    api<ProposalStats>(`monitoring/proposals?range=${range}${key ? '&period=' + encodeURIComponent(key) : ''}`)
      .then(result => { if (active) { setLoaded({ request: `${range}|${key ?? 'current:' + currentKey}`, stats: result }); setDenied(false); } })
      .catch(e => { if (!active) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // currentKey: a page left open on the current period refetches when the clock rolls into the next day / week / month / year.
  }, [range, key, currentKey, attempt]);
  // The selected range and period live in the URL (?range=&period=, next to the #monitoring page hash), so a reload or a shared link opens the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('range', range);
    if (key) url.searchParams.set('period', key); else url.searchParams.delete('period');
    window.history.replaceState(window.history.state, '', url);
  }, [range, key]);
  useEffect(() => () => { const url = new URL(window.location.href); url.searchParams.delete('range'); url.searchParams.delete('period'); window.history.replaceState(window.history.state, '', url); }, []);
  const retry = useCallback(() => { setLoading(true); setError(''); setDenied(false); setAttempt(n => n + 1); }, []);
  const select = (next: ProposalStatsRange, start: number) => {
    const current = periodStart(next, now), clamped = Math.min(current, Math.max(earliestStart(next, now), periodStart(next, start)));
    const nextKey = clamped === current ? null : periodKey(next, clamped);
    if (next === range && nextKey === key) return;
    setLoading(true); setError(''); setDenied(false); setExportError(''); setSelection({ range: next, key: nextKey });
  };
  const shown = loaded?.stats.summary && loaded.request === `${range}|${key ?? 'current:' + currentKey}` ? loaded.stats : null;
  const s = shown?.summary;
  const exportPdf = async () => {
    if (!shown || !page.current) return;
    setExporting(true); setExportError('');
    try {
      const { buildMonitoringPdf, downloadPdf } = await import('./operations-proposal-dashboard-pdf');
      const model = monitoringPdfModel(shown, new Date());
      downloadPdf(await buildMonitoringPdf(model, page.current), model.fileName);
    } catch { setExportError('The PDF could not be made. Try again.'); } finally { setExporting(false); }
  };

  return <div ref={page} className={'pd-page' + (denied || error ? ' is-state' : '')}>
    <div className="pd-head">
      <div className="pd-title"><h1>Monitoring</h1>
        <p title={s ? `${s.label}, compared with ${compareText(s)}. Updated ${manilaTime(shown!.asOf)}, Manila time.` : undefined}>{s ? <><b>{RANGE_LABEL[s.range]} · {s.label}</b> · vs {compareText(s)} · Updated {TIME_FMT.format(new Date(shown!.asOf))} Manila time</> : denied ? 'Inquiries, proposals and team timing' : 'Loading…'}</p></div>
      {!denied && <div className="pd-actions">
        <div className="pd-segment pd-ranges" role="group" aria-label="Range">{RANGES.map(([value, label]) => <button key={value} aria-pressed={range === value} className={range === value ? 'is-active' : ''} onClick={() => select(value, key ? startOf(selection, now) : now)}>{label}</button>)}</div>
        <PeriodNav selection={selection} now={now} onSelect={start => select(range, start)} />
        <div className="pd-segment pd-view" role="group" aria-label="Show as">{VIEWS.map(([value, label]) => <button key={value} aria-pressed={view === value} className={view === value ? 'is-active' : ''} onClick={() => setView(value)}>{label}</button>)}</div>
        <button className="ops-btn primary pd-export" onClick={() => void exportPdf()} disabled={!shown || loading || exporting} aria-describedby={exportError ? 'pd-export-error' : undefined}>{exporting ? <RefreshCw size={16} className="ops-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}Export PDF</button>
        <button className="ops-btn secondary pd-refresh" onClick={retry} disabled={loading} aria-label="Refresh" title="Refresh"><RefreshCw size={16} className={loading ? 'ops-spin' : ''} aria-hidden="true" /></button>
        {exportError && <span id="pd-export-error" className="pd-export-error" role="alert">{exportError}</span>}
      </div>}
    </div>
    {denied ? <div className="ops-card pd-state" role="alert"><ShieldAlert size={24} aria-hidden="true" /><div><h2>You don’t have access to this page</h2><p>Monitoring is for the Head and Supervisors. Ask the Head if you need it.</p></div></div>
      : error ? <div className="ops-card pd-state pd-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><div><h2>We couldn’t load the monitoring numbers</h2><p>{error}</p></div><button className="ops-btn primary" onClick={retry}>Retry</button></div>
      : shown ? <Body stats={shown} view={view} busy={loading} />
      : <Skeleton />}
  </div>;
}

/** ‹ previous · the selected period (opens "Jump to") · next › · Back to current. Next stops at the current period; previous at the lookback limit. */
function PeriodNav({ selection, now, onSelect }: { selection: Selection; now: number; onSelect: (start: number) => void }) {
  const [open, setOpen] = useState(false), wrap = useRef<HTMLDivElement>(null);
  const { range } = selection, start = startOf(selection, now), current = periodStart(range, now), earliest = earliestStart(range, now);
  const isCurrent = start >= current, label = periodLabel(range, start), noun = STEP_NOUN[range];
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return <div className="pd-period" role="group" aria-label="Period">
    <button className="pd-step" onClick={() => onSelect(shiftPeriod(range, start, -1))} disabled={start <= earliest} aria-label={`Previous ${noun}`} title={`Previous ${noun}`}><ChevronLeft size={16} aria-hidden="true" /></button>
    <div className="pd-jump-wrap" ref={wrap}>
      <button className="pd-period-label" onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}. Jump to another ${noun}`}><CalendarDays size={15} aria-hidden="true" /><span>{label}</span></button>
      {open && <JumpPanel range={range} start={start} now={now} onCancel={() => setOpen(false)} onGo={next => { setOpen(false); onSelect(next); }} />}
    </div>
    <button className="pd-step" onClick={() => onSelect(shiftPeriod(range, start, 1))} disabled={isCurrent} aria-label={`Next ${noun}`} title={isCurrent ? `This is the current ${noun}` : `Next ${noun}`}><ChevronRight size={16} aria-hidden="true" /></button>
    {!isCurrent && <button className="pd-current" onClick={() => onSelect(current)}>Back to current</button>}
  </div>;
}

/** "Jump to": a day (Today), any day of the week (Weekly), a month and year (Monthly) or a year (Yearly). Native controls, no new dependency. */
function JumpPanel({ range, start, now, onGo, onCancel }: { range: ProposalStatsRange; start: number; now: number; onGo: (start: number) => void; onCancel: () => void }) {
  const first = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const earliest = earliestStart(range, now), [day, setDay] = useState(manilaDay(start));
  const [year, setYear] = useState(Number(periodKey('year', start))), [month, setMonth] = useState(Number(periodKey('month', start).slice(5)) - 1);
  const thisYear = Number(periodKey('year', now)), thisMonth = Number(periodKey('month', now).slice(5)) - 1, firstYear = Number(periodKey('year', earliest));
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);
  useEffect(() => { first.current?.focus(); }, []);
  const target = range === 'day' || range === 'week' ? manilaDayStart(day) : manilaDayStart(`${year}-${String(range === 'year' ? 1 : Math.min(month + 1, year === thisYear ? thisMonth + 1 : 12)).padStart(2, '0')}-01`);
  const valid = Number.isFinite(target) && target <= now && periodStart(range, target) >= earliest;
  return <div className="pd-jump" role="dialog" aria-label="Jump to a period" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
    <form onSubmit={event => { event.preventDefault(); if (valid) onGo(target); }}>
      {(range === 'day' || range === 'week') && <label>{range === 'day' ? 'Day' : 'Any day in the week'}<input ref={first} type="date" value={day} min={manilaDay(earliest)} max={manilaDay(now)} onChange={event => setDay(event.target.value)} required /></label>}
      {range === 'month' && <label>Month<select ref={first} value={month} onChange={event => setMonth(Number(event.target.value))}>{MONTH_NAMES.map((name, i) => <option key={name} value={i} disabled={year === thisYear && i > thisMonth}>{name}</option>)}</select></label>}
      {(range === 'month' || range === 'year') && <label>Year<select ref={range === 'year' ? first : undefined} value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>}
      {!valid && <p className="pd-jump-hint" role="alert">Pick a date from {manilaDay(earliest)} to today.</p>}
      <div className="pd-jump-actions"><button type="button" className="ops-btn secondary" onClick={onCancel}>Cancel</button><button type="submit" className="ops-btn primary" disabled={!valid}>Go</button></div>
    </form>
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
  const past = stats.buckets.filter(b => !b.future);
  return <div className="pd-kpis">
    {KPIS.map(({ key, label, upIsGood, Icon, tone, help }) => {
      const value = summary.current[key], previous = summary.previous[key], d = delta(value, previous, upIsGood), compare = previous > 0;
      const said = !compare ? 'no earlier data to compare' : d.direction === 'flat' ? 'no change' : `${d.direction} ${d.text}`;
      return <section key={key} className={'ops-card pd-kpi tone-' + tone} title={help} aria-label={`${label}: ${value}, ${said}${compare ? `, ${vsText(summary, previous)}` : ''}${help ? '. ' + help : ''}`}>
        <div className="pd-kpi-head"><span>{label}</span><Icon size={16} aria-hidden="true" /></div>
        <div className="pd-kpi-main" aria-hidden="true"><strong>{value}</strong>
          {compare && <span className={'pd-delta is-' + d.tone}>{d.direction === 'up' ? <ArrowUp size={12} /> : d.direction === 'down' ? <ArrowDown size={12} /> : null}{d.text}</span>}
          <Sparkline values={past.map(b => b[key])} /></div>
        <small aria-hidden="true">{compare ? vsText(summary, previous) : 'No earlier data to compare'}</small>
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
  if (!active || !payload?.length || payload.every(p => p.value === undefined || p.value === null)) return null;
  return <div className="pd-tip"><b>{label}</b>{payload.map(p => <span key={p.name}><i style={{ background: p.color }} />{p.name}<em>{p.value}</em></span>)}</div>;
}

function Trend({ stats, view }: { stats: ProposalStats; view: View }) {
  const c = stats.summary!.current, noun = BUCKET_NOUN[stats.period];
  const data = useMemo(() => stats.buckets.map(b => b.future ? { ...b, received: null, sent: null } : b), [stats.buckets]);
  if (view === 'numbers') return <div className="pd-scroll pd-fill" tabIndex={0} role="region" aria-label={`Proposals per ${noun.toLowerCase()}`}><table className="pd-table"><thead><tr><th scope="col">{noun}</th><th scope="col" className="num">Received</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Declined</th><th scope="col" className="num" title={STILL_NEW_HELP}>Still new</th></tr></thead>
    <tbody>{stats.buckets.filter(b => !b.future).map(b => <tr key={b.start}><th scope="row">{b.label}</th><td className="num">{b.received}</td><td className="num">{b.sent}</td><td className="num">{b.declined}</td><td className="num">{b.notStarted}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th><td className="num">{c.received}</td><td className="num">{c.sent}</td><td className="num">{c.declined}</td><td className="num">{c.notStarted}</td></tr></tfoot></table></div>;
  return <div className="pd-fill pd-chart" role="img" aria-label={`Column chart per ${noun.toLowerCase()}: ${c.received} inquiries received and ${c.sent} proposals sent in this period. Hover a column for the exact counts, or switch to Numbers.`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barGap={2} barCategoryGap="14%" accessibilityLayer={false}>
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
  if (summary.range === 'day') return <p className="pd-hint pd-fill">Pick Weekly or longer to compare days.</p>;
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

/** Each row opens that employee's drill-down: the name is a button (keyboard), and a click anywhere on the row does the same. */
function TimingTable({ rows, onOpen }: { rows: TimingRow[]; onOpen: (row: TimingRow) => void }) {
  const maxCreate = Math.max(1, ...rows.map(r => r.avgCreateMs || 0)), maxHandling = Math.max(1, ...rows.map(r => r.avgHandlingMs || 0));
  const bar = (ms: number | null, max: number, kind: string) => ms === null ? null : <span className={'pd-mini ' + kind} style={{ width: Math.max(4, ms / max * 100) + '%' }} aria-hidden="true" />;
  return <table className="pd-table pd-timing pd-compact"><thead><tr><th scope="col">Employee</th><th scope="col" className="num">Created</th><th scope="col" className="num">Avg create</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Avg handling</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.userId} className="is-clickable" onClick={() => onOpen(row)}><th scope="row"><button type="button" className="pd-person" onClick={event => { event.stopPropagation(); onOpen(row); }} aria-label={`${row.name}: open the details for this period`}>{row.name}</button></th><td className="num">{row.created}</td>
      <td className="num"><span className="pd-avg">{formatDuration(row.avgCreateMs)}{bar(row.avgCreateMs, maxCreate, 'create')}</span></td>
      <td className="num">{row.sent}</td>
      <td className="num"><span className="pd-avg">{formatDuration(row.avgHandlingMs)}{bar(row.avgHandlingMs, maxHandling, 'handling')}</span></td></tr>)}</tbody></table>;
}

const ROW_PX = 31, HEAD_PX = 28, LINK_PX = 26;
function Timing({ stats }: { stats: ProposalStats }) {
  const dialog = useRef<HTMLDialogElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0), [person, setPerson] = useState<TimingRow | null>(null);
  const rows = useMemo(() => byMostSent(stats.timing), [stats.timing]);
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
  const openPerson = (row: TimingRow) => { setPerson(row); if (!dialog.current?.open) dialog.current?.showModal(); };
  const openAll = () => { setPerson(null); dialog.current?.showModal(); };
  if (!rows.length) return <p className="pd-hint pd-fill">No employee activity in this period.</p>;
  return <div className="pd-fill pd-timing-wrap" ref={wrap}>
    <div className="pd-scroll"><TimingTable rows={rows.slice(0, shownRows)} onOpen={openPerson} /></div>
    {rows.length > shownRows && <button className="ops-link pd-all" onClick={openAll}>View all ({rows.length})</button>}
    <dialog ref={dialog} className="pd-dialog" aria-labelledby="pd-all-h" onClose={() => setPerson(null)}>
      {person ? <EmployeeDetail key={person.userId + stats.summary!.period} person={person} summary={stats.summary!} onBack={() => setPerson(null)} onClose={() => dialog.current?.close()} />
        : <><div className="pd-dialog-head"><div><h2 id="pd-all-h">Time per employee</h2><p>{RANGE_LABEL[stats.summary!.range]} · {stats.summary!.label} · choose a name for the details</p></div><button className="ops-btn secondary pd-close" onClick={() => dialog.current?.close()} aria-label="Close"><X size={16} aria-hidden="true" /></button></div>
          <div className="pd-scroll"><TimingTable rows={rows} onOpen={openPerson} /></div></>}
    </dialog>
  </div>;
}

const EVENT_LABEL: Record<ProposalTimelineEvent['kind'], string> = { received: 'Inquiry received', started: 'Started handling', submitted: 'Submitted for approval', returned: 'Returned for correction', approved: 'Approved', sent: 'Proposal sent', declined: 'Declined' };
const OUTCOME: Record<ProposalEmployeeDetail['proposals'][number]['outcome'], string> = { sent: 'Sent', declined: 'Declined', open: 'In progress' };
/** Item 5: one employee in the selected range and period. Fetched on open; the server applies the same Head/Supervisor rule as the dashboard. */
function EmployeeDetail({ person, summary, onBack, onClose }: { person: TimingRow; summary: Summary; onBack: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<ProposalEmployeeDetail | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    api<ProposalEmployeeDetail>(`monitoring/proposals/employee?user=${encodeURIComponent(person.userId)}&range=${summary.range}&period=${encodeURIComponent(summary.period)}`)
      .then(result => { if (active) setDetail(result); })
      .catch(e => { if (active) setError((e as { status?: number }).status === 403 ? 'You do not have access to Monitoring.' : (e as Error).message); });
    return () => { active = false; };
  }, [person.userId, summary.range, summary.period, attempt]);
  const d = detail?.summary;
  const tiles: [string, string][] = d ? [['Versions submitted', String(d.created)], ['Proposals sent', String(d.sent)], ['Declined', String(d.declined)], ['Avg time to create', formatDuration(d.avgCreateMs)], ['Avg handling time', formatDuration(d.avgHandlingMs)]] : [];
  return <>
    <div className="pd-dialog-head">
      <div className="pd-detail-title"><button ref={back} type="button" className="pd-back" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />All employees</button>
        <h2 id="pd-all-h">{person.name}</h2><p>{RANGE_LABEL[summary.range]} · {summary.label}</p></div>
      <button className="ops-btn secondary pd-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
    </div>
    <div className="pd-scroll pd-detail" aria-busy={!detail && !error}>
      {error ? <div className="pd-state pd-error" role="alert"><TriangleAlert size={20} aria-hidden="true" /><div><h3>We couldn’t load {person.name}’s details</h3><p>{error}</p></div><button className="ops-btn primary" onClick={() => { setError(''); setAttempt(n => n + 1); }}>Retry</button></div>
        : !detail ? <><span className="sr-only" role="status">Loading {person.name}’s details…</span><div className="pd-detail-kpis" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <div key={i} className="ops-skeleton pd-sk-small" />)}</div>{[0, 1, 2].map(i => <div key={i} className="ops-skeleton pd-sk-line" aria-hidden="true" />)}</>
        : <>
          <dl className="pd-detail-kpis">{tiles.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <h3 className="pd-detail-h">Proposals in this period <span>({detail.proposals.length}{detail.truncated ? '+' : ''})</span></h3>
          {detail.truncated && <p className="pd-hint">Showing the first {detail.proposals.length}. Pick a shorter range to see the rest.</p>}
          {!detail.proposals.length ? <p className="pd-hint pd-detail-empty">{person.name} did not work on any proposal in this period.</p>
            : <ol className="pd-tl-list">{detail.proposals.map(item => <li key={item.inquiryId} className="pd-tl">
              <div className="pd-tl-head"><b>{item.company}</b><span className={'pd-outcome is-' + item.outcome}>{OUTCOME[item.outcome]}</span></div>
              <ol className="pd-tl-events">{item.events.map((event, i) => {
                const since = i ? Date.parse(event.at) - Date.parse(item.events[i - 1].at) : null;
                return <li key={event.kind + event.at + (event.version ?? '')} className={'is-' + event.kind + (event.inPeriod ? '' : ' is-outside')}>
                  <span className="pd-tl-dot" aria-hidden="true" />
                  <span className="pd-tl-what">{EVENT_LABEL[event.kind]}{event.version ? ` (v${event.version})` : ''}{!event.inPeriod && <em> · outside this period</em>}</span>
                  <time dateTime={event.at}>{manilaTime(event.at)}</time>
                  <span className="pd-tl-dur">{since !== null ? '+' + formatDuration(since) : ''}{event.createMs !== undefined && <b> · time to create {formatDuration(event.createMs)}</b>}{event.handlingMs !== undefined && <b> · handling {formatDuration(event.handlingMs)}</b>}</span>
                </li>;
              })}</ol>
            </li>)}</ol>}
        </>}
    </div>
  </>;
}

function Body({ stats, view, busy }: { stats: ProposalStats; view: View; busy: boolean }) {
  const summary = stats.summary!, c = summary.current, p = summary.previous, noun = BUCKET_NOUN[stats.period].toLowerCase();
  const empty = [c.received, c.sent, c.declined, c.notStarted, p.received, p.sent, p.declined, p.notStarted].every(n => n === 0) && stats.timing.length === 0;
  const steps = stats.funnel;
  let drop = -1, lost = 0;
  steps.forEach((step, i) => { if (i && steps[i - 1].count - step.count > lost) { lost = steps[i - 1].count - step.count; drop = i; } });
  return <>
    <div className="pd-kpis-wrap" data-busy={busy || undefined} aria-busy={busy}><KpiTiles stats={stats} /></div>
    {empty ? <div className="ops-card pd-empty"><Empty text="No inquiries or proposals in this period" hint="Try an earlier period or a longer range." /></div> : <>
      <div className="pd-row pd-row-main" data-busy={busy || undefined}>
        <Card id="pd-trend-h" title="Proposals over time" note={`Inquiries received and proposals sent, per ${noun}`}
          legend={view === 'charts' ? <ul className="pd-legend" aria-label="Legend"><li><i className="received" />Received</li><li><i className="sent" />Sent</li></ul> : undefined}>
          <Trend stats={stats} view={view} />
        </Card>
        <Card id="pd-days-h" title="Busiest day" note="Proposals sent by weekday"><BusiestDay summary={summary} /></Card>
      </div>
      <div className="pd-row pd-row-low" data-busy={busy || undefined}>
        <Card id="pd-funnel-h" title="Pipeline" note={drop > 0 ? <>Biggest drop: <b>{steps[drop - 1].step} → {steps[drop].step}</b> ({lost})</> : 'Inquiries received in this period, step by step'}><Pipeline stats={stats} view={view} /></Card>
        <Card id="pd-time-h" title="Time per employee" note="Wall-clock averages for this period · choose a name for details"><Timing stats={stats} /></Card>
      </div>
    </>}
  </>;
}
