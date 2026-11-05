'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, ArrowUpRight, ChevronLeft, FileText, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ageLabel, manilaTime } from '@/lib/operations/types';
import type { OwnerClient, OwnerReport } from '@/lib/operations/owner-view';
import { api, endpoint, Modal } from './operations-common';
import { manilaDate, OwnerStatus, protectionView } from './operations-owner-chip';

const MAX_BYTES = 7 * 1024 * 1024;
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
const reportUrl = (clientId: string, reportId: string) => endpoint + '/my-clients/' + encodeURIComponent(clientId) + '/report/' + encodeURIComponent(reportId);

function NotFound({ onBack }: { onBack: () => void }) {
  return <div className="ops-oc-page"><div className="ops-card ops-oc-empty" role="alert"><TriangleAlert size={28} aria-hidden="true" /><h1>We couldn’t find this client</h1><p>It may have been removed, or it isn’t one of your clients.</p><button className="ops-btn primary" onClick={onBack}>Back to My Clients</button></div></div>;
}

type TimelineItem = { key: string; at: string; label: string };
function timeline(client: OwnerClient): TimelineItem[] {
  const items: TimelineItem[] = [{ key: 'received', at: client.createdAt, label: 'Received' }];
  if (client.sentAt) items.push({ key: 'sent', at: client.sentAt, label: 'Proposal sent' });
  for (const r of client.progressReports) {
    items.push({ key: 'f' + r.id, at: r.submittedAt, label: 'Report filed' });
    if (r.status === 'approved' && r.decidedAt) { items.push({ key: 'a' + r.id, at: r.decidedAt, label: 'Report approved' }); items.push({ key: 'e' + r.id, at: r.decidedAt, label: 'Protection extended' }); }
    if (r.status === 'rejected' && r.decidedAt) items.push({ key: 'r' + r.id, at: r.decidedAt, label: 'Report rejected' });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

function ReportItem({ clientId, report, focusId, now }: { clientId: string; report: OwnerReport; focusId: string; now: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focusId === report.id) ref.current?.focus(); }, [focusId, report.id]);
  const long = report.summary.length > 180 || report.summary.split('\n').length > 3;
  return <li ref={ref} tabIndex={-1} id={'report-' + report.id} className={'ops-oc-report-item ' + report.status}>
    <div className="ops-oc-report-top"><b>{report.reference}</b>
      {report.status === 'pending' ? <span className="ops-client-pill warning"><LockKeyhole size={13} aria-hidden="true" />Pending review</span> : report.status === 'approved' ? <span className="ops-client-pill protected"><ShieldCheck size={13} aria-hidden="true" />Approved</span> : <span className="ops-client-pill warning"><TriangleAlert size={13} aria-hidden="true" />Rejected {manilaDate(report.decidedAt || report.submittedAt)}</span>}</div>
    <small>Filed {manilaTime(report.submittedAt)} · {ageLabel(report.submittedAt, now)}</small>
    <p className={'ops-oc-summary' + (open ? ' open' : '')}>{report.summary}</p>
    {long && <button className="ops-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    {report.hasAttachment && <a className="ops-link" href={reportUrl(clientId, report.id)} target="_blank" rel="noopener noreferrer">View attachment<ArrowUpRight size={14} aria-hidden="true" /></a>}
    {report.status === 'pending' && <p className="ops-oc-note">Waiting for the Head or Supervisor.</p>}
    {report.status === 'approved' && <p className="ops-oc-note">Approved {manilaDate(report.decidedAt || report.submittedAt)} · Protection runs until {manilaDate(new Date(Date.parse(report.decidedAt || report.submittedAt) + 30 * 86400000).toISOString())}</p>}
    {report.status === 'rejected' && <p className="ops-oc-note amber">Reason: {report.rejectReason || 'No reason given.'} You can file a new report.</p>}
  </li>;
}

export function FileReportModal({ client, onClose, onFiled }: { client: OwnerClient; onClose: () => void; onFiled: (client: OwnerClient) => void }) {
  const [summary, setSummary] = useState(''), [reference, setReference] = useState(''), [file, setFile] = useState<File | null>(null), [fileError, setFileError] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const pick = (picked: File | null) => {
    setFileError('');
    if (!picked) { setFile(null); return; }
    const okType = picked.type === 'application/pdf' || picked.type === 'image/png' || picked.type === 'image/jpeg' || /\.(pdf|png|jpe?g)$/i.test(picked.name) && !picked.type;
    if (!okType) { setFile(null); setFileError('Please choose a PDF or a photo.'); return; }
    if (picked.size > MAX_BYTES) { setFile(null); setFileError('This file is ' + mb(picked.size) + ' MB. The limit is 7 MB.'); return; }
    setFile(picked);
  };
  const valid = summary.trim().length >= 10 && summary.length <= 2000 && reference.trim().length >= 3 && reference.length <= 120;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!valid || busy) return;
    setBusy(true); setError('');
    const form = new FormData(); form.set('summary', summary.trim()); form.set('reference', reference.trim()); form.set('requestId', requestId.current); if (file) form.set('file', file);
    try {
      const result = await api<{ client: OwnerClient }>('my-clients/' + encodeURIComponent(client.id) + '/progress-report', form);
      toast.success('Report sent for review. Your protection is held until it is decided.');
      onFiled(result.client);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 && /contact franchising/i.test((e as Error).message) ? (e as Error).message : status === 409 ? (client.progressReports.some(r => r.status === 'pending') ? 'A report is already under review for this client.' : 'This client no longer has active protection.') : 'We couldn’t send your report. Nothing was saved. Please try again.');
    } finally { setBusy(false); }
  }
  return <Modal title="File progress report" onClose={() => { if (!busy) onClose(); }}>
    <form className="ops-pad ops-file-report" onSubmit={submit}>
      <p>Tell franchising what happened with {client.client}. Once the Head or Supervisor approves, you get 30 days from the approval date.</p>
      <label>Summary<textarea value={summary} onChange={e => setSummary(e.target.value)} rows={5} maxLength={2000} required aria-describedby="rp-sum-hint" /><span id="rp-sum-hint" className="ops-reason-hint">What did you do with this client? Meetings, calls, next steps.</span><span className="ops-char-count" aria-live="off">{summary.length} / 2000{summary.trim().length > 0 && summary.trim().length < 10 ? ' · at least 10 characters' : ''}</span></label>
      <label>Reference<input value={reference} onChange={e => setReference(e.target.value)} maxLength={120} required aria-describedby="rp-ref-hint" /><span id="rp-ref-hint" className="ops-reason-hint">An email subject, meeting title or other reference we can look up.</span></label>
      <div className="ops-file-field"><span className="ops-field-label">Attachment (optional)</span>
        {file ? <div className="ops-file-row"><FileText size={18} aria-hidden="true" /><span><b>{file.name}</b><small>{mb(file.size)} MB</small></span><button type="button" className="ops-btn" onClick={() => pick(null)}>Remove</button></div>
          : <label className="ops-btn ops-file-pick">Choose file<input type="file" accept="application/pdf,image/*" onChange={e => { pick(e.target.files?.[0] || null); e.target.value = ''; }} /></label>}
        <span className="ops-reason-hint">PDF or photo, up to 7 MB.</span>
        {fileError && <p role="alert" className="ops-client-error">{fileError}</p>}</div>
      {error && <p role="alert" className="ops-client-error">{error}</p>}
      <div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy || !valid}>{busy ? 'Sending…' : 'Send for review'}</button></div>
    </form>
  </Modal>;
}

export default function ClientPage({ id, initial, onBack, onChanged, now }: { id: string; initial?: OwnerClient; onBack: () => void; onChanged: () => void; now: number }) {
  const [fetched, setClient] = useState<OwnerClient | null>(null), [missing, setMissing] = useState(false), [error, setError] = useState(''), [fileOpen, setFileOpen] = useState(false), [focusId, setFocusId] = useState('');
  const reasonId = useId(), opener = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    try { const r = await api<{ client: OwnerClient }>('my-clients/' + encodeURIComponent(id)); setClient(r.client); setError(''); setMissing(false); }
    catch (e) { if ((e as { status?: number }).status === 404) setMissing(true); else setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const client = fetched && (!initial || fetched.lastActivityAt >= initial.lastActivityAt) ? fetched : initial || null;
  const events = useMemo(() => client ? timeline(client) : [], [client]);
  if (missing) return <NotFound onBack={onBack} />;
  if (!client) return error ? <div className="ops-oc-page"><p className="ops-message amber" role="alert">We couldn’t load this client. Check your connection and try again. <button className="ops-btn" onClick={() => void load()}>Try again</button></p></div> : <div className="ops-oc-page" aria-busy="true"><p className="sr-only" role="status">Loading client…</p><div className="ops-skeleton" /></div>;
  const view = protectionView(client, now), pending = client.progressReports.some(r => r.status === 'pending');
  const active = !!client.protection && view.tone !== 'expired' && view.tone !== 'neutral';
  const since = Math.max(Date.parse(client.protection?.startedAt || '') || 0, ...client.progressReports.filter(r => r.status === 'approved').map(r => Date.parse(r.decidedAt || '') || 0));
  const blocked = client.progressReports.filter(r => r.status === 'rejected' && (Date.parse(r.decidedAt || r.submittedAt) || 0) >= since).length >= 2;
  const canFile = !pending && active && !blocked;
  const reason = blocked ? 'Contact franchising before filing again.' : pending ? 'You already have a report under review. You can file another after it is decided.' : !active ? 'You can file a progress report only while a client has active protection.' : '';
  const open = () => { if (canFile) setFileOpen(true); };
  const proposalHref = endpoint + '/my-clients/' + encodeURIComponent(client.id) + '/proposal';
  const days = view.days;
  const fileButton = <button ref={opener} className="ops-btn primary" aria-disabled={!canFile} aria-describedby={reason ? reasonId : undefined} onClick={open}><FileText size={16} aria-hidden="true" />File progress report</button>;
  const panelCls = 'ops-card ops-client-protection' + (view.tone === 'held' ? ' held' : view.tone === 'urgent' ? ' urgent due' : view.tone === 'warning' ? ' due' : view.tone === 'expired' ? ' archived' : '');
  return <div className="ops-oc-page ops-oc-client">
    <button className="ops-link ops-oc-back" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />My Clients</button>
    <header className="ops-oc-heading"><div><h1>{client.client}</h1><OwnerStatus value={client.status} /></div>{client.hasSentProposal && <a className="ops-btn ops-oc-desktop-only" href={proposalHref} target="_blank" rel="noopener noreferrer">Open sent proposal<ArrowUpRight size={15} aria-hidden="true" /></a>}</header>
    {error && <p className="ops-message amber" role="alert">We couldn’t refresh this client. <button className="ops-btn" onClick={() => void load()}>Try again</button></p>}
    <div className="ops-oc-grid">
      <div className="ops-oc-main">
        <section className={panelCls} aria-label="Protection">
          <div className="ops-client-protection-main"><span className="ops-client-shield" aria-hidden="true">{view.tone === 'expired' ? <Archive size={25} /> : view.tone === 'held' ? <LockKeyhole size={25} /> : <ShieldCheck size={25} />}</span>
            <div className="ops-client-agent"><span>Protection</span>
              <b>{!client.protection ? 'Protection not started' : view.tone === 'held' ? 'Held — report under review' : view.tone === 'expired' ? 'Protection ended on ' + manilaDate(client.protection.expiresAt) : 'Protected until ' + manilaDate(client.protection.expiresAt)}</b></div>
            {client.protection && view.tone !== 'expired' && view.tone !== 'held' && <div className="ops-client-countdown" role="timer" aria-label={days + ' days of protection left'}><strong>{days}</strong><span>{days === 1 ? 'day left' : 'days left'}</span></div>}</div>
          {client.protection && view.tone !== 'expired' && <div className="ops-client-meter" aria-hidden="true"><i style={{ width: Math.min(100, days / 30 * 100) + '%' }} /></div>}
          <div className="ops-oc-panel-notes">
            {!client.protection && <p>Protection starts when the proposal is sent.</p>}
            {view.tone === 'held' && <p><b>Held — report under review.</b> Your protection is paused while the Head or Supervisor reviews your progress report. You will be notified of the decision.</p>}
            {view.tone === 'expired' && <p><b>Protection ended on {manilaDate(client.protection!.expiresAt)}.</b> Ask franchising if you want to protect this client again.</p>}
            {view.tone === 'warning' && <p>Protection ends soon. File a progress report to extend it by 30 days.</p>}
            {view.tone === 'urgent' && <><p><b>Protection ends in {days <= 0 ? 'less than a day' : days + ' day' + (days === 1 ? '' : 's')}.</b> File a progress report now.</p>{fileButton}</>}
            <p className="ops-oc-muted">An approved report gives you 30 days from the approval date.</p>
          </div>
        </section>
        <section className="ops-card ops-oc-proposal" aria-label="Proposal"><div className="ops-card-head"><h2>Proposal</h2></div><div className="ops-pad">
          {client.hasSentProposal ? <><p>Sent {manilaDate(client.sentAt!)}</p><a className="ops-btn primary" href={proposalHref} target="_blank" rel="noopener noreferrer">Open sent proposal<ArrowUpRight size={15} aria-hidden="true" /></a><small className="ops-oc-muted">Opens in a new tab</small></>
            : <p>Your proposal isn’t ready yet. You’ll get a notification when it is sent.</p>}</div></section>
        <section className="ops-card ops-oc-reports" aria-label="Progress reports"><div className="ops-card-head"><h2>Progress reports <span className="ops-count">{client.progressReports.length}</span></h2>{view.tone !== 'urgent' && fileButton}</div><div className="ops-pad">
          {reason && <p id={reasonId} className="ops-oc-note">{reason}</p>}
          {client.progressReports.length ? <ul className="ops-oc-report-list">{client.progressReports.map(r => <ReportItem key={r.id} clientId={client.id} report={r} focusId={focusId} now={now} />)}</ul> : <p>No progress reports yet.</p>}</div></section>
      </div>
      <aside className="ops-oc-side"><section className="ops-card" aria-label="Progress"><div className="ops-card-head"><h2>Progress</h2></div><ol className="ops-timeline">{events.map(e => <li key={e.key}><b>{e.label}</b><small>{manilaTime(e.at)} · {ageLabel(e.at, now)}</small></li>)}</ol></section></aside>
    </div>
    {fileOpen && <FileReportModal client={client} onClose={() => { setFileOpen(false); setTimeout(() => opener.current?.focus(), 0); }} onFiled={next => { const before = new Set(client.progressReports.map(r => r.id)); setClient(next); setFileOpen(false); setFocusId(next.progressReports.find(r => !before.has(r.id))?.id || ''); onChanged(); }} />}
  </div>;
}
