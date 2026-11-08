'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LifeBuoy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { manilaTime, type ProblemReport, type ProblemReportStatus, type Staff } from '@/lib/operations/types';
import { api, Modal, staffName } from './operations-common';
import './operations-report-problem.css';

// "Report a problem" (pilot plan 2026-11-16, item 5). The button sits in the top bar of every staff and Division Head /
// SOA screen. Only the description is typed; the app adds the page, inquiry, role, app version, window size and browser.
const viewport = () => typeof window === 'undefined' ? undefined : Math.round(window.innerWidth) + 'x' + Math.round(window.innerHeight);

/** The open inquiry, read from the address: #inquiry/<id> (staff) or #my-clients/<id> (Division Head / SOA). */
const inquiryFromHash = () => { const match = /^#(?:inquiry|my-clients)\/([A-Za-z0-9-]{1,40})$/.exec(window.location.hash); return match?.[1]; };

export function ReportProblemButton({ page }: { page: string }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [inquiryId, setInquiryId] = useState<string>();
  const close = () => { if (!busy) { setOpen(false); setError(''); } };
  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('problem-reports', { description: text, page, ...(inquiryId ? { inquiryId } : {}), ...(viewport() ? { viewport: viewport() } : {}) });
      setText(''); setOpen(false); toast.success('Thanks. Your report was sent to the Head.');
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
type Filter = ProblemReportStatus | 'all';

export function ProblemReportsPage({ users }: { users: Staff[] }) {
  const [reports, setReports] = useState<ProblemReport[] | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState<Filter>('new'), [saving, setSaving] = useState('');
  const [tick, setTick] = useState(0);
  const load = useCallback(() => { setError(''); setReports(null); setTick(n => n + 1); }, []);
  useEffect(() => { let live = true; api<{ reports: ProblemReport[] }>('problem-reports').then(result => { if (live) setReports(result.reports); }, (failure: Error) => { if (live) setError(failure.message); }); return () => { live = false; }; }, [tick]);
  const counts = useMemo(() => ({ new: 0, 'in-progress': 0, fixed: 0, all: reports?.length || 0, ...Object.fromEntries((['new', 'in-progress', 'fixed'] as const).map(s => [s, reports?.filter(r => r.status === s).length || 0])) }) as Record<Filter, number>, [reports]);
  const shown = (reports || []).filter(r => filter === 'all' || r.status === filter);
  async function setStatus(report: ProblemReport, status: ProblemReportStatus) {
    setSaving(report.id);
    try { const { report: next } = await api<{ report: ProblemReport }>('problem-reports/' + encodeURIComponent(report.id) + '/status', { status }); setReports(list => list?.map(r => r.id === next.id ? next : r) || null); }
    catch (failure) { toast.error((failure as Error).message); } finally { setSaving(''); }
  }
  return <>
    <div className="ops-heading"><div><h1><LifeBuoy size={24} />Problem reports</h1><p>What staff and Division Heads reported from the app. Newest first.</p></div><button className="ops-btn" onClick={load} aria-label="Refresh problem reports"><RefreshCw size={16} />Refresh</button></div>
    <div className="ops-report-tabs" role="tablist" aria-label="Filter by status">{(['new', 'in-progress', 'fixed', 'all'] as const).map(key => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{key === 'all' ? 'All' : LABELS[key]} <span>{counts[key]}</span></button>)}</div>
    {error ? <section className="ops-card ops-pad"><p role="alert" className="ops-message amber">{error}</p><button className="ops-btn" onClick={load}>Try again</button></section>
      : !reports ? <div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading reports…</div>
        : !shown.length ? <section className="ops-card ops-empty"><LifeBuoy size={28} /><h3>{filter === 'all' ? 'No problem reports yet' : 'Nothing ' + LABELS[filter].toLowerCase()}</h3><p>Reports appear here when someone uses Report a problem in the top bar.</p></section>
          : <ul className="ops-report-list">{shown.map(report => <li key={report.id} className={'ops-card ops-report-item status-' + report.status}>
            <div className="ops-report-main"><p className="ops-report-text">{report.description}</p>
              <p className="ops-report-meta"><b>{staffName(users, report.userId)}</b> · {report.role} · {manilaTime(report.at)} · {report.page}{report.inquiryId && <> · <a className="ops-link" href={'#inquiry/' + encodeURIComponent(report.inquiryId)}>{report.inquiryId}</a></>}</p>
              <details><summary>Technical details</summary><dl><div><dt>App version</dt><dd>{report.version}</dd></div>{report.viewport && <div><dt>Window</dt><dd>{report.viewport}</dd></div>}<div><dt>Browser</dt><dd>{report.browser || 'Unknown'}</dd></div>{report.updatedAt && <div><dt>Status changed</dt><dd>{manilaTime(report.updatedAt)}{report.updatedBy ? ' by ' + staffName(users, report.updatedBy) : ''}</dd></div>}</dl></details>
            </div>
            <label className="ops-report-status">Status<select aria-label={'Status of the report from ' + staffName(users, report.userId)} value={report.status} disabled={saving === report.id} onChange={event => void setStatus(report, event.target.value as ProblemReportStatus)}>{(['new', 'in-progress', 'fixed'] as const).map(s => <option key={s} value={s}>{LABELS[s]}</option>)}</select></label>
          </li>)}</ul>}
  </>;
}
