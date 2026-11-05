'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, LockKeyhole, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { ageLabel, manilaTime } from '@/lib/operations/types';
import type { InquiryRecord, PendingProgressReport } from '@/lib/operations/types';
import { api, endpoint, Modal } from './operations-common';
import './operations-report-queue.css';

const DAY = 86400000;
const manilaDate = (value: string | number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value));
export type DecisionTarget = { inquiryId: string; reportId: string; client: string; ownerName: string; protectionExpiresAt?: string };

function failure(error: unknown) {
  const status = (error as { status?: number }).status, message = (error as Error).message;
  return status === 409 ? { gone: true, text: /decided/i.test(message) ? 'Another approver already decided this report.' : message } : { gone: false, text: message };
}

export function ApproveReportModal({ target, onClose, onDone }: { target: DecisionTarget; onClose: () => void; onDone: (inquiry?: InquiryRecord, gone?: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [opened] = useState(() => Date.now());
  const until = manilaDate(opened + 30 * DAY), name = target.ownerName || 'The owner';
  async function approve() {
    setBusy(true); setError('');
    try {
      const result = await api<{ inquiry: InquiryRecord }>('inquiries/' + encodeURIComponent(target.inquiryId) + '/progress-report/' + encodeURIComponent(target.reportId) + '/decision', { action: 'approve' });
      toast.success('Report approved. Protection runs until ' + (result.inquiry.protection ? manilaDate(result.inquiry.protection.expiresAt) : until) + '.');
      onDone(result.inquiry);
    } catch (e) { const f = failure(e); setError(f.text); if (f.gone) { toast.error(f.text); onDone(undefined, true); } } finally { setBusy(false); }
  }
  return <Modal title="Approve progress report?" onClose={() => { if (!busy) onClose(); }}><div className="ops-pad">
    <p>Protection for {target.client} will run 30 days from today, until {until}. {name} will be notified.</p>
    {error && <p role="alert" className="ops-client-error">{error}</p>}
    <div className="ops-actions"><button className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy} onClick={() => void approve()}>{busy ? 'Approving…' : 'Approve report'}</button></div></div></Modal>;
}

export function RejectReportModal({ target, onClose, onDone }: { target: DecisionTarget; onClose: () => void; onDone: (inquiry?: InquiryRecord, gone?: boolean) => void }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const name = target.ownerName || 'the owner', valid = reason.trim().length >= 5 && reason.length <= 500;
  async function reject(event: React.FormEvent) {
    event.preventDefault(); if (!valid) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ inquiry: InquiryRecord }>('inquiries/' + encodeURIComponent(target.inquiryId) + '/progress-report/' + encodeURIComponent(target.reportId) + '/decision', { action: 'reject', reason: reason.trim() });
      toast.success('Report rejected. ' + name + ' can see your reason.');
      onDone(result.inquiry);
    } catch (e) { const f = failure(e); setError(f.text); if (f.gone) { toast.error(f.text); onDone(undefined, true); } } finally { setBusy(false); }
  }
  return <Modal title="Reject progress report" onClose={() => { if (!busy) onClose(); }}><form className="ops-pad ops-reason-field" onSubmit={reject}>
    <label>Reason (shown to {name})<textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} maxLength={500} required aria-describedby="rj-hint" /></label>
    <span id="rj-hint" className="ops-reason-hint">Be specific so they can file a better report.</span><span className="ops-char-count">{reason.length} / 500{reason.trim().length > 0 && reason.trim().length < 5 ? ' · at least 5 characters' : ''}</span>
    {error && <p role="alert" className="ops-client-error">{error}</p>}
    <div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn danger" disabled={busy || !valid}>{busy ? 'Rejecting…' : 'Reject report'}</button></div></form></Modal>;
}

export default function ReportQueue({ reports, now, onRefresh, onOpenInquiry, tabs, focusId }: { reports: PendingProgressReport[]; now: number; onRefresh: () => Promise<void>; onOpenInquiry: (id: string) => void; tabs: React.ReactNode; focusId?: string }) {
  const [search, setSearch] = useState(''), [modal, setModal] = useState<{ kind: 'approve' | 'reject'; target: DecisionTarget } | null>(null), [announce, setAnnounce] = useState(''), [removed, setRemoved] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter(r => !removed.includes(r.reportId)).filter(r => !q || r.company.toLowerCase().includes(q) || r.ownerName.toLowerCase().includes(q)).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  }, [reports, search, removed]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focusId) document.getElementById('rq-' + focusId)?.scrollIntoView({ block: 'center' }); }, [focusId, reports.length]);
  async function reload() { setLoading(true); setError(''); try { await onRefresh(); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  const done = (target: DecisionTarget, kind: string) => async (_inquiry?: InquiryRecord, gone?: boolean) => {
    setModal(null); setRemoved(prev => [...prev, target.reportId]);
    await reload();
    const left = Math.max(0, reports.filter(r => r.reportId !== target.reportId && !removed.includes(r.reportId)).length);
    setAnnounce((gone ? 'Report already decided.' : kind === 'approve' ? 'Report approved.' : 'Report rejected.') + ' ' + left + ' report' + (left === 1 ? '' : 's') + ' waiting.');
  };
  return <div className="dir-page dir-full-page ops-inquiry-list ops-report-page">
    <header className="dir-page-heading"><div><h1>Approval Queue</h1><p>Progress reports from Division Heads and SOAs, oldest first.</p></div></header>
    <section className="dir-register" aria-label="Progress reports" aria-busy={loading}>
      <div className="dir-toolbar"><label className="dir-search"><Search size={17} aria-hidden="true" /><input aria-label="Search progress reports" placeholder="Search client or Division Head / SOA…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      {tabs}
      <p className="sr-only" role="status">{announce}</p>
      {error && <p className="ops-message amber" role="alert">{error} <button className="ops-btn" onClick={() => void reload()}><RefreshCw size={14} />Try again</button></p>}
      <section ref={ref} className="ops-report-scroll" aria-label="Progress report list">
        {loading && !reports.length ? <p role="status" className="ops-list-loading">Loading progress reports…</p>
          : !list.length ? <div className="dir-empty"><h3>{search ? 'No reports match' : 'No progress reports waiting'}</h3><p>{search ? 'Try a different name.' : 'Reports from Division Heads and SOAs will show here for approval.'}</p></div>
            : <ul className="ops-report-list">{list.map(r => <ReportCard key={r.reportId} report={r} now={now} focused={focusId === r.reportId} onOpen={() => onOpenInquiry(r.inquiryId)} onDecide={kind => setModal({ kind, target: { inquiryId: r.inquiryId, reportId: r.reportId, client: r.company, ownerName: r.ownerName, protectionExpiresAt: r.protectionExpiresAt } })} />)}</ul>}
      </section>
    </section>
    {modal?.kind === 'approve' && <ApproveReportModal target={modal.target} onClose={() => setModal(null)} onDone={done(modal.target, 'approve')} />}
    {modal?.kind === 'reject' && <RejectReportModal target={modal.target} onClose={() => setModal(null)} onDone={done(modal.target, 'reject')} />}
  </div>;
}

function ReportCard({ report: r, now, focused, onOpen, onDecide }: { report: PendingProgressReport; now: number; focused: boolean; onOpen: () => void; onDecide: (kind: 'approve' | 'reject') => void }) {
  const expiry = r.protectionExpiresAt ? Date.parse(r.protectionExpiresAt) : 0, passed = !!expiry && expiry <= now, daysLeft = expiry ? Math.max(0, Math.ceil((expiry - Date.parse(r.submittedAt)) / DAY)) : 0;
  return <li id={'rq-' + r.reportId} className={'ops-report-card' + (focused ? ' focused' : '')}>
    <div className="ops-report-head"><h3>{r.company}</h3><span className="ops-client-pill warning held"><LockKeyhole size={13} aria-hidden="true" />Held{expiry ? ' · ' + daysLeft + ' days were left' : ''}</span></div>
    <p className="ops-report-meta">Submitted by {r.ownerName}{r.division ? ' · ' + r.division : ''} · {manilaTime(r.submittedAt)} ({ageLabel(r.submittedAt, now)})</p>
    <p className="ops-report-summary">{r.summary}</p>
    <p className="ops-report-meta"><b>Reference:</b> {r.reference}</p>
    {r.hasAttachment && <a className="ops-link" href={endpoint + '/file/' + encodeURIComponent(r.inquiryId) + '/progress?report=' + encodeURIComponent(r.reportId)} target="_blank" rel="noopener noreferrer">View attachment<ArrowUpRight size={14} aria-hidden="true" /></a>}
    <p className="ops-report-meta">{expiry ? 'Protection ' + (passed ? 'ended' : daysLeft + ' days left, until') + ' ' + manilaDate(expiry) : 'Protection dates unavailable'} · <button className="ops-link" onClick={onOpen}>Open client</button></p>
    {passed && <p className="ops-message amber" role="note"><TriangleAlert size={16} aria-hidden="true" />Protection ended on {manilaDate(expiry)}. If you reject this report, protection ends. If you approve, it restarts from today.</p>}
    <div className="ops-report-actions"><button className="ops-btn primary" onClick={() => onDecide('approve')}><CheckCircle2 size={16} aria-hidden="true" />Approve</button><button className="ops-btn danger" onClick={() => onDecide('reject')}><X size={16} aria-hidden="true" />Reject</button></div>
  </li>;
}
