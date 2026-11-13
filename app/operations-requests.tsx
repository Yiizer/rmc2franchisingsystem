'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, FileSpreadsheet, FileText, MailCheck, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { ageLabel, manilaTime } from '@/lib/operations/types';
import type { InquiryRecord } from '@/lib/operations/types';
import type { InboundMessage, InboxHealth } from '@/lib/operations/inbound';
import { api, endpoint, Modal } from './operations-common';
import InquiryEntry from './operations-inquiry-entry';

// Requests: emails read from the test inbox. Staff decide; nothing becomes an inquiry on its own.
export default function RequestsPage({ now, onOpen, canCreate = false }: { now: number; onOpen: (record: InquiryRecord) => void; canCreate?: boolean }) {
  const [typing, setTyping] = useState<InboundMessage | null>(null); // "Create inquiry from this email"
  const [data, setData] = useState<{ messages: InboundMessage[]; checkedAt: string; connected: boolean; health?: InboxHealth } | null>(null);
  const [busy, setBusy] = useState(''), [show, setShow] = useState<'new' | 'all'>('new'), [error, setError] = useState('');
  // Polls can overlap on a slow connection: only the newest answer is shown, so an older list never replaces a newer one.
  const latest = useRef(0);
  const load = useCallback(async () => { const mine = ++latest.current; try { const result = await api<{ messages: InboundMessage[]; checkedAt: string; connected: boolean; health?: InboxHealth }>('inbound'); if (mine === latest.current) { setData(result); setError(''); } } catch (e) { if (mine === latest.current) setError((e as Error).message); } }, []);
  useEffect(() => {
    void load();
    // Keep the list current while the page is visible: the server checks the inbox every 30 seconds.
    const poll = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [load]);
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
  // Same rule as the server (lib/operations/inbound.ts senderVerified): DMARC pass aligned with the From domain. The results are information only, never identity.
  const verified = (m: InboundMessage) => m.auth.dmarc === 'pass' && m.auth.aligned === true;
  return <>
    <div className="ops-heading"><div><h1>Requests</h1><p>{data && !data.connected ? 'The inbox is not connected on this server (email is in local test mode).' : 'Agent emails from the test inbox, checked every 30 seconds while the app is open. Excel forms become inquiries automatically; anything else waits here for you.'}{data?.checkedAt ? ' Last checked ' + manilaTime(data.checkedAt) + ' (' + ageLabel(data.checkedAt, now) + ').' : ''}</p></div>
      <button className="ops-btn primary" onClick={check} disabled={!!busy}><RefreshCw size={16} className={busy === 'check' ? 'ops-spin' : ''} />{busy === 'check' ? 'Checking…' : 'Check mail now'}</button></div>
    <div className="ops-tabs" role="tablist">{(['new', 'all'] as const).map(t => <button key={t} role="tab" aria-selected={show === t} className={show === t ? 'active' : ''} onClick={() => setShow(t)}>{t === 'new' ? 'To review' : 'All'} <span>{t === 'new' ? waiting : data?.messages.length ?? 0}</span></button>)}</div>
    {error && <p className="ops-message amber" role="alert">{error}</p>}
    {!!data?.health?.failures && <p className="ops-message amber" role="alert"><ShieldAlert size={18} aria-hidden="true" /> <span><b>The inbox could not be checked {data.health.failures === 1 ? 'on the last try' : data.health.failures + ' times in a row'}{data.health.lastFailureAt ? ' (last at ' + manilaTime(data.health.lastFailureAt) + ')' : ''}.</b> {data.health.lastError}{data.health.failures >= 3 ? ' Automatic checks now run less often; “Check mail now” still tries straight away.' : ''} If it keeps failing, ask the administrator to check the mailbox settings.</span></p>}
    <section className="ops-card">{!data ? <div className="ops-list-loading" role="status"><RefreshCw className="ops-spin" />Loading…</div>
      : !list.length ? <div className="dir-empty"><h3>{show === 'new' ? 'Nothing to review' : 'No emails yet'}</h3><p>Use “Check mail now” to read new emails from the test inbox.</p></div>
      : <div className="ops-request-list" role="list">{list.map(m => <article role="listitem" key={m.id} className="ops-request">
        <div className="ops-request-head"><div><b>{m.subject}</b><small>{m.fromName ? m.fromName + ' · ' : ''}{m.from}{m.replyTo && m.replyTo !== m.from ? ' · reply to ' + m.replyTo : ''}</small></div>
          <div className="ops-request-meta"><span className={'ops-badge ' + (verified(m) ? 'green' : 'amber')} title={`SPF ${m.auth.spf} · DKIM ${m.auth.dkim} · DMARC ${m.auth.dmarc}`}>{verified(m) ? <MailCheck size={13} /> : <ShieldAlert size={13} />}{verified(m) ? 'Sender verified' : 'Sender not verified'}</span><small>{manilaTime(m.receivedAt)} · {ageLabel(m.receivedAt, now)}</small></div></div>
        {m.snippet && <p className="ops-request-snippet">{m.snippet}</p>}
        {m.state === 'new' && m.importError && <p className="ops-message amber" role="note">Not imported automatically: {m.importError}</p>}
        <div className="ops-request-files">{m.attachments.length ? m.attachments.map((a, i) => <div key={a.key} className="ops-request-file">{a.type === 'xlsx' ? <FileSpreadsheet size={16} /> : <FileText size={16} />}<span>{a.name}</span><small>{Math.max(1, Math.round(a.size / 1024))} KB</small>
          <a className="ops-btn" href={endpoint + '/inbound/' + m.id + '/attachment/' + i}><Download size={14} />Open</a>
          {m.state === 'new' && <button className="ops-btn primary" disabled={!!busy} onClick={() => void importForm(m, i)}>{busy === m.id ? 'Creating…' : 'Create inquiry'}</button>}</div>)
          : <small>No Excel or PDF form attached.</small>}</div>
        {m.state === 'new' && canCreate && <div className="ops-request-type"><button className="ops-btn" disabled={!!busy} onClick={() => setTyping(m)}><FilePlus2 size={15} />Create inquiry from this email</button><small>{m.attachments.length ? 'If the form will not import, type the details instead.' : 'For details written in the email itself.'}</small></div>}
        <div className="ops-request-foot">{m.state === 'new' ? <button className="ops-btn" disabled={!!busy} onClick={() => void dismiss(m)}><X size={14} />Dismiss</button>
          : m.state === 'imported' ? <span className="ops-badge green">{m.handledBy === 'email-intake' ? 'Imported automatically as ' : 'Imported as '}{m.inquiryId}</span> : <span className="ops-badge">{m.handledBy === 'email-filter' ? 'Skipped automatically · newsletter or notification' : 'Dismissed'}</span>}</div>
      </article>)}</div>}</section>
    {typing && <Modal title="Create inquiry from this email" wide onClose={() => { if (!busy) setTyping(null); }}>
      <div className="ops-pad ops-request-compose">
        <aside className="ops-request-source" aria-label="The agent's email">
          <p className="ops-request-source-label">From the email</p>
          <b>{typing.subject}</b>
          <small>{typing.fromName ? typing.fromName + ' · ' : ''}{typing.from} · {manilaTime(typing.receivedAt)}</small>
          {typing.replyTo && typing.replyTo !== typing.from && <p className="ops-message amber" role="note">This email asks for replies to {typing.replyTo}, a different address from the sender. The form uses the sender’s address; change it only if you have confirmed it with the agent.</p>}
          <pre className="ops-request-body">{typing.text || typing.snippet || 'This email has no text.'}</pre>
          {!typing.text && typing.snippet && <small>Only the start of this older email was kept. Open it in the mailbox for the rest.</small>}
        </aside>
        <div className="ops-request-entry">
          <InquiryEntry variant="staff" endpoint={'inbound/' + typing.id + '/create'} initial={{ agentEmail: typing.from, ...(typing.fromName ? { agentName: typing.fromName } : {}) }} submitLabel="Create inquiry" onCancel={() => setTyping(null)}
            onCreated={async result => { const record = (result as { inquiry: InquiryRecord }).inquiry; setTyping(null); toast.success('Inquiry ' + record.id + ' created from the email.'); await load(); onOpen(record); }} />
        </div>
      </div>
    </Modal>}
  </>;
}
