'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import type { OwnerClient } from '@/lib/operations/owner-view';
import { manilaDate } from './operations-owner-chip';
import InquiryEntry from './operations-inquiry-entry';

type Result = { client: OwnerClient; alreadyProtected: boolean; message?: string };

export default function SubmitInquiry({ division, onDone, onOpenClient }: { division?: string; onDone: () => void; onOpenClient: (id: string) => void }) {
  // Division Heads and SOAs fill in the details here; uploading a form is for Franchising staff (PO, 2026-11-09).
  const [result, setResult] = useState<Result | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (result && !result.alreadyProtected) heading.current?.focus(); }, [result]);
  const reset = () => setResult(null);
  return <div className="ops-oc-page ops-oc-submit">
    <header className="ops-oc-heading"><div><h1 ref={heading} tabIndex={-1}>Submit inquiry</h1><p>Fill in the client’s details. Franchising will take it from there.</p></div></header>
    {result && !result.alreadyProtected && <section className="ops-message green ops-oc-result" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div><b>Inquiry submitted</b><p>{result.client.client} was received on {manilaDate(result.client.createdAt)}. You can follow it in My Clients.</p><div className="ops-actions"><button className="ops-btn primary" onClick={() => onOpenClient(result.client.id)}>View client</button><button className="ops-btn" onClick={reset}>Submit another</button></div></div></section>}
    {result?.alreadyProtected && <section className="ops-message amber ops-oc-result" role="alert"><TriangleAlert size={22} aria-hidden="true" /><div><b>This client is already protected.</b><div className="ops-actions"><button className="ops-btn" onClick={reset}>Submit a different client</button></div></div></section>}
    {!result && <div className="ops-card ops-pad"><InquiryEntry variant="owner" onCreated={r => { setResult(r as Result); onDone(); }} extra={division ? <p className="ops-oc-muted">Filed under: {division}</p> : undefined} /></div>}
  </div>;
}
