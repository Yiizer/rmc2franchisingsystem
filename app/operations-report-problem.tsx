'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug, LifeBuoy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { manilaTime, type CrashReport, type ProblemReport, type ProblemReportStatus, type Staff } from '@/lib/operations/types';
import { api, Modal, staffName } from './operations-common';
import { useCrashReporter } from './operations-crash-report';
import './operations-report-problem.css';

// "Report a problem" (pilot plan 2026-11-16, item 5). The button sits in the top bar of every staff and Division Head /
// SOA screen. Only the description is typed; the app adds the page, inquiry, role, app version, window size and browser.
const viewport = () => typeof window === 'undefined' ? undefined : Math.round(window.innerWidth) + 'x' + Math.round(window.innerHeight);

/** The open inquiry, read from the address: #inquiry/<id> (staff) or #my-clients/<id> (Division Head / SOA). */
const inquiryFromHash = () => { const match = /^#(?:inquiry|my-clients)\/([A-Za-z0-9-]{1,40})$/.exec(window.location.hash); return match?.[1]; };

export function ReportProblemButton({ page }: { page: string }) {
  useCrashReporter(page);
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [inquiryId, setInquiryId] = useState<string>();
  const close = () => { if (!busy) { setOpen(false); setError(''); } };
  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('problem-reports', { description: text, page, ...(inquiryId ? { inquiryId } : {}), ...(viewport() ? { viewport: viewport() } : {}) });
      setText(''); setOpen(false); toast.success('Thanks. Your report was sent to the IT Admin.');
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <>
    <button type="button" className="ops-icon ops-report-problem" aria-label="Report a problem" title="Report a problem" onClick={() => { setInquiryId(inquiryFromHash()); setOpen(true); }}><LifeBuoy size={19} aria-hidden="true" /></button>
    {/* Rendered on <body>: inside the sticky top bar the dialog could not rise above the sidebar. */}
    {open && createPortal(<div className="ops-app ops-portal-root"><Modal title="Report a problem" onClose={close}><form className="ops-pad ops-report-form" onSubmit={send}>
      <label>What went wrong?<textarea autoFocus rows={5} maxLength={2000} required minLength={10} value={text} onChange={event => setText(event.target.value)} placeholder="For example: I clicked Generate PDF and nothing happened." /></label>
      <p className="ops-report-context">We also send the page (<b>{page}</b>{inquiryId ? <>, inquiry <b>{inquiryId}</b></> : null}), your role, the app version, your window size and browser. No screenshots or form contents.</p>
      {error && <p role="alert" className="ops-message amber">{error}</p>}
      <div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={close}>Cancel</button><button className="ops-btn primary" disabled={busy || text.trim().length < 10}>{busy ? 'Sending…' : 'Send report'}</button></div>
    </form></Modal></div>, document.body)}
  </>;
}

const LABELS: Record<ProblemReportStatus, string> = { new: 'New', 'in-progress': 'In progress', fixed: 'Fixed' };
type Filter = ProblemReportStatus | 'all' | 'errors';
type Entry = ProblemReport | CrashReport;
const isCrash = (report: Entry): report is CrashReport => (report as CrashReport).kind === 'error';
const SOURCES: Record<CrashReport['source'], string> = { error: 'Uncaught error', unhandledrejection: 'Unhandled promise', render: 'Screen failed to draw' };

export function ProblemReportsPage({ users }: { users: Staff[] }) {
  const [reports, setReports] = useState<Entry[] | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState<Filter>('new'), [saving, setSaving] = useState('');
  const [tick, setTick] = useState(0);
  const load = useCallback(() => { setError(''); setReports(null); setTick(n => n + 1); }, []);
  useEffect(() => { let live = true; api<{ reports: Entry[] }>('problem-reports').then(result => { if (live) setReports(result.reports); }, (failure: Error) => { if (live) setError(failure.message); }); return () => { live = false; }; }, [tick]);
  const typed = useMemo(() => (reports || []).filter(r => !isCrash(r)), [reports]);
  const crashes = useMemo(() => (reports || []).filter(isCrash).sort((a, b) => (a.status === 'fixed' ? 1 : 0) - (b.status === 'fixed' ? 1 : 0) || b.lastAt.localeCompare(a.lastAt)), [reports]);
  const counts = useMemo(() => ({ all: typed.length, errors: crashes.filter(c => c.status !== 'fixed').length, ...Object.fromEntries((['new', 'in-progress', 'fixed'] as const).map(s => [s, typed.filter(r => r.status === s).length])) }) as Record<Filter, number>, [typed, crashes]);
  const shown: Entry[] = filter === 'errors' ? crashes : typed.filter(r => filter === 'all' || r.status === filter);
  async function setStatus(report: Entry, status: ProblemReportStatus) {
    setSaving(report.id);
    try { const { report: next } = await api<{ report: Entry }>('problem-reports/' + encodeURIComponent(report.id) + '/status', { status }); setReports(list => list?.map(r => r.id === next.id ? next : r) || null); }
    catch (failure) { toast.error((failure as Error).message); } finally { setSaving(''); }
  }
  const tabLabel = (key: Filter) => key === 'all' ? 'All reports' : key === 'errors' ? 'App errors' : LABELS[key];
  const emptyTitle = filter === 'errors' ? 'No app errors logged' : filter === 'all' ? 'No problem reports yet' : 'Nothing ' + LABELS[filter].toLowerCase();
  const emptyText = filter === 'errors' ? 'When the app hits an unexpected error, it is logged here automatically with the page and browser.' : 'Reports appear here when someone uses Report a problem in the top bar.';
  return <>
    <div className="ops-heading"><div><h1><LifeBuoy size={24} />Problem reports</h1><p>What staff and Division Heads reported, and errors the app logged by itself. Newest first.</p></div><button className="ops-btn" onClick={load} aria-label="Refresh problem reports"><RefreshCw size={16} />Refresh</button></div>
    <div className="ops-report-tabs" role="tablist" aria-label="Filter reports">{(['new', 'in-progress', 'fixed', 'all', 'errors'] as const).map(key => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{tabLabel(key)} <span>{counts[key]}</span></button>)}</div>
    {error ? <section className="ops-card ops-pad"><p role="alert" className="ops-message amber">{error}</p><button className="ops-btn" onClick={load}>Try again</button></section>
      : !reports ? <div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading reports…</div>
        : !shown.length ? <section className="ops-card ops-empty">{filter === 'errors' ? <Bug size={28} /> : <LifeBuoy size={28} />}<h3>{emptyTitle}</h3><p>{emptyText}</p></section>
          : <ul className="ops-report-list">{shown.map(report => { const crash = isCrash(report) ? report : undefined; return <li key={report.id} className={'ops-card ops-report-item status-' + report.status + (crash ? ' kind-error' : '')}>
            <div className="ops-report-main"><p className="ops-report-text">{report.description}{crash && <span className="ops-report-count" title="Times this error happened">{crash.count}×</span>}</p>
              <p className="ops-report-meta">{crash ? <>{SOURCES[crash.source] || 'Error'} · last {manilaTime(crash.lastAt)} · first {manilaTime(crash.at)} · {crash.userIds.length === 1 ? staffName(users, crash.userIds[0]) : crash.userIds.length + ' people'}{crash.reopened && ' · happened again after it was marked fixed'}</> : <><b>{staffName(users, report.userId)}</b> · {report.role} · {manilaTime(report.at)}</>} · {report.page}{report.inquiryId && <> · <a className="ops-link" href={'#inquiry/' + encodeURIComponent(report.inquiryId)}>{report.inquiryId}</a></>}</p>
              <details><summary>Technical details</summary><dl><div><dt>App version</dt><dd>{report.version}</dd></div>{crash && crash.userIds.length > 1 && <div><dt>People</dt><dd>{crash.userIds.map(id => staffName(users, id)).join(', ')}</dd></div>}{report.viewport && <div><dt>Window</dt><dd>{report.viewport}</dd></div>}<div><dt>Browser</dt><dd>{report.browser || 'Unknown'}</dd></div>{report.updatedAt && <div><dt>Status changed</dt><dd>{manilaTime(report.updatedAt)}{report.updatedBy ? ' by ' + staffName(users, report.updatedBy) : ''}</dd></div>}</dl>{crash?.stack && <pre className="ops-report-stack">{crash.stack}</pre>}</details>
            </div>
            <label className="ops-report-status">Status<select aria-label={(crash ? 'Status of the app error ' : 'Status of the report from ' + staffName(users, report.userId)) + (crash ? report.description.slice(0, 40) : '')} value={report.status} disabled={saving === report.id} onChange={event => void setStatus(report, event.target.value as ProblemReportStatus)}>{(['new', 'in-progress', 'fixed'] as const).map(s => <option key={s} value={s}>{LABELS[s]}</option>)}</select></label>
          </li>; })}</ul>}
  </>;
}
