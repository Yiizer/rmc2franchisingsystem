'use client';
import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText, MailCheck, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { ageLabel } from '@/lib/operations/types';
import type { InquiryRecord } from '@/lib/operations/types';
import type { InboundMessage } from '@/lib/operations/inbound';
import { api, endpoint } from './operations-common';

// Requests: emails read from the test inbox. Staff decide; nothing becomes an inquiry on its own.
export default function RequestsPage({ now, onOpen }: { now: number; onOpen: (record: InquiryRecord) => void }) {
  const [data, setData] = useState<{ messages: InboundMessage[]; checkedAt: string; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(''), [show, setShow] = useState<'new' | 'all'>('new'), [error, setError] = useState('');
  const load = useCallback(async () => { try { setData(await api('inbound')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const check = async () => {
    setBusy('check');
    try { const r = await api<{ added: number; imported?: number; connected: boolean }>('inbound/check', {}); toast[r.connected ? 'success' : 'warning'](!r.connected ? 'The inbox is not connected on this server.' : r.added ? `${r.added} new email${r.added === 1 ? '' : 's'}` + (r.imported ? ` · ${r.imported} inquir${r.imported === 1 ? 'y' : 'ies'} created automatically.` : '.') : 'No new email.'); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  };
  const importForm = async (m: InboundMessage, index: number) => {
    setBusy(m.id);
    try { const r = await api<{ inquiry: InquiryRecord }>('inbound/' + m.id + '/import', { index }); toast.success('Inquiry ' + r.inquiry.id + ' created from the email.'); await load(); onOpen(r.inquiry); }
    catch (e) { toast.error((e as Error).message); await load(); } finally { setBusy(''); }
  };
  const dismiss = async (m: InboundMessage) => {
    setBusy(m.id);
    try { await api('inbound/' + m.id + '/dismiss', {}); await load(); } catch (e) { toast.error((e as Error).message); await load(); } finally { setBusy(''); }
  };
  const list = (data?.messages ?? []).filter(m => show === 'all' || m.state === 'new');
  const waiting = (data?.messages ?? []).filter(m => m.state === 'new').length;
  const verified = (m: InboundMessage) => m.auth.dmarc === 'pass' || (m.auth.spf === 'pass' && m.auth.dkim === 'pass');
  return <>
    <div className="ops-heading"><div><h1>Requests</h1><p>{data && !data.connected ? 'The inbox is not connected on this server (email is in local test mode).' : 'Agent emails from the test inbox, checked every 2 minutes while the app is open. Excel forms become inquiries automatically; anything else waits here for you.'}{data?.checkedAt ? ' Last checked ' + ageLabel(data.checkedAt, now) + '.' : ''}</p></div>
      <button className="ops-btn primary" onClick={check} disabled={!!busy}><RefreshCw size={16} className={busy === 'check' ? 'ops-spin' : ''} />{busy === 'check' ? 'Checking…' : 'Check mail now'}</button></div>
    <div className="ops-tabs" role="tablist">{(['new', 'all'] as const).map(t => <button key={t} role="tab" aria-selected={show === t} className={show === t ? 'active' : ''} onClick={() => setShow(t)}>{t === 'new' ? 'To review' : 'All'} <span>{t === 'new' ? waiting : data?.messages.length ?? 0}</span></button>)}</div>
    {error && <p className="ops-message amber" role="alert">{error}</p>}
    <section className="ops-card">{!data ? <div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading…</div>
      : !list.length ? <div className="dir-empty"><h3>{show === 'new' ? 'Nothing to review' : 'No emails yet'}</h3><p>Use “Check mail now” to read new emails from the test inbox.</p></div>
      : <div className="ops-request-list" role="list">{list.map(m => <article role="listitem" key={m.id} className="ops-request">
        <div className="ops-request-head"><div><b>{m.subject}</b><small>{m.fromName ? m.fromName + ' · ' : ''}{m.from}{m.replyTo && m.replyTo !== m.from ? ' · reply to ' + m.replyTo : ''}</small></div>
          <div className="ops-request-meta"><span className={'ops-badge ' + (verified(m) ? 'green' : 'amber')} title={`SPF ${m.auth.spf} · DKIM ${m.auth.dkim} · DMARC ${m.auth.dmarc}`}>{verified(m) ? <MailCheck size={13} /> : <ShieldAlert size={13} />}{verified(m) ? 'Sender verified' : 'Sender not verified'}</span><small>{ageLabel(m.receivedAt, now)}</small></div></div>
        {m.snippet && <p className="ops-request-snippet">{m.snippet}</p>}
        {m.state === 'new' && m.importError && <p className="ops-message amber" role="note">Not imported automatically: {m.importError}</p>}
        <div className="ops-request-files">{m.attachments.length ? m.attachments.map((a, i) => <div key={a.key} className="ops-request-file">{a.type === 'xlsx' ? <FileSpreadsheet size={16} /> : <FileText size={16} />}<span>{a.name}</span><small>{Math.max(1, Math.round(a.size / 1024))} KB</small>
          <a className="ops-btn" href={endpoint + '/inbound/' + m.id + '/attachment/' + i}><Download size={14} />Open</a>
          {m.state === 'new' && <button className="ops-btn primary" disabled={!!busy} onClick={() => void importForm(m, i)}>{busy === m.id ? 'Creating…' : 'Create inquiry'}</button>}</div>)
          : <small>No Excel or PDF form attached.</small>}</div>
        <div className="ops-request-foot">{m.state === 'new' ? <button className="ops-btn" disabled={!!busy} onClick={() => void dismiss(m)}><X size={14} />Dismiss</button>
          : m.state === 'imported' ? <span className="ops-badge green">{m.handledBy === 'email-intake' ? 'Imported automatically as ' : 'Imported as '}{m.inquiryId}</span> : <span className="ops-badge">Dismissed</span>}</div>
      </article>)}</div>}</section>
  </>;
}
