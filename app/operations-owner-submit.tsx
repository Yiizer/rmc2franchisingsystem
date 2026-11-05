'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, RefreshCw, TriangleAlert, Upload } from 'lucide-react';
import type { OwnerClient } from '@/lib/operations/owner-view';
import { api } from './operations-common';
import { manilaDate } from './operations-owner-chip';

const MAX_BYTES = 7 * 1024 * 1024;
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
type Result = { client: OwnerClient; alreadyProtected: boolean; message?: string };

export default function SubmitInquiry({ division, onDone, onOpenClient }: { division?: string; onDone: () => void; onOpenClient: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null), [fileError, setFileError] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Result | null>(null), [dragging, setDragging] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (result && !result.alreadyProtected) heading.current?.focus(); }, [result]);
  const choose = (picked: File | null) => {
    setError(''); setFileError('');
    if (!picked) { setFile(null); return; }
    if (!/\.(xlsx|xls|pdf)$/i.test(picked.name)) { setFile(null); setFileError('Please choose an Excel or PDF file.'); return; }
    if (picked.size > MAX_BYTES) { setFile(null); setFileError('This file is ' + mb(picked.size) + ' MB. The limit is 7 MB.'); return; }
    setFile(picked);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!file || busy) return;
    setBusy(true); setError('');
    const form = new FormData(); form.append('file', file);
    try { const r = await api<Result>('intake', form); setResult(r); onDone(); }
    catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 429 ? (e as Error).message : status && status < 500 && status !== 401 ? 'We couldn’t read this form. Please upload the franchise inquiry form as an Excel or PDF file.' : 'We couldn’t submit your inquiry. Nothing was sent. Please try again.');
    } finally { setBusy(false); }
  }
  const reset = () => { setResult(null); setFile(null); setError(''); setFileError(''); };
  return <div className="ops-oc-page ops-oc-submit">
    <header className="ops-oc-heading"><div><h1 ref={heading} tabIndex={-1}>Submit inquiry</h1><p>Upload the franchise inquiry form (Excel or PDF). Franchising will take it from there.</p></div></header>
    {result && !result.alreadyProtected && <section className="ops-message green ops-oc-result" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div><b>Inquiry submitted</b><p>{result.client.client} was received on {manilaDate(result.client.createdAt)}. You can follow it in My Clients.</p><div className="ops-actions"><button className="ops-btn primary" onClick={() => onOpenClient(result.client.id)}>View client</button><button className="ops-btn" onClick={reset}>Submit another</button></div></div></section>}
    {result?.alreadyProtected && <section className="ops-message amber ops-oc-result" role="alert"><TriangleAlert size={22} aria-hidden="true" /><div><b>This client is already protected.</b><div className="ops-actions"><button className="ops-btn" onClick={reset}>Submit a different client</button></div></div></section>}
    {!result && <form className="ops-card ops-pad" onSubmit={submit}>
      <div className={'ops-dropzone' + (file ? ' has-file' : '') + (dragging ? ' dragging' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0] || null); }}>
        <Upload size={26} aria-hidden="true" />
        <div><button type="button" className="ops-btn" onClick={() => input.current?.click()}>Choose file</button><span className="ops-oc-desktop-only"> or drag it here</span></div>
        <input ref={input} className="sr-only" tabIndex={-1} aria-label="Inquiry form file" type="file" accept=".xlsx,.xls,.pdf" onChange={e => { choose(e.target.files?.[0] || null); e.target.value = ''; }} />
        <small>Excel or PDF, up to 7 MB. One client per form.</small>
      </div>
      {fileError && <p role="alert" className="ops-client-error">{fileError}</p>}
      {file && <div className="ops-file-row"><FileSpreadsheet size={18} aria-hidden="true" /><span><b>{file.name}</b><small>{mb(file.size)} MB</small></span><button type="button" className="ops-btn" disabled={busy} onClick={() => choose(null)}>Remove</button></div>}
      {division && <p className="ops-oc-muted">Filed under: {division}</p>}
      {error && <p role="alert" className="ops-message amber">{error}</p>}
      <div className="ops-actions"><button className="ops-btn primary" disabled={!file || busy}>{busy ? <><RefreshCw size={16} className="ops-spin" aria-hidden="true" />Submitting…</> : 'Submit inquiry'}</button></div>
    </form>}
  </div>;
}
