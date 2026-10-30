'use client';

import { useEffect, useState } from 'react';

import { ArrowUpRight, RefreshCw } from 'lucide-react';

import type { DuplicateClientMatch, InquiryRecord } from '@/lib/operations/types';

import { manilaTime } from '@/lib/operations/types';

import { normalizeClient, protectionDaysLeft } from '@/lib/operations/client-rules';

import { api } from './operations-common';



export default function ClientComparison({ record, match, onOpen, onRecheck, busy }: {

  record: InquiryRecord; match: DuplicateClientMatch; onOpen: (id: string) => void; onRecheck?:()=>void;busy?:boolean;

}) {

  const [existing, setExisting] = useState<InquiryRecord | null>(null);

  const [error, setError] = useState(false);

  const [retry, setRetry] = useState(0);

  useEffect(() => {

    let active = true;

    setExisting(null);

    setError(false);

    api<{ inquiry: InquiryRecord }>('inquiries/' + encodeURIComponent(match.inquiryId))

      .then(result => { if (active) setExisting(result.inquiry); })

      .catch(() => { if (active) setError(true); });

    return () => { active = false; };

  }, [match.inquiryId, retry]);

  const client = (item: InquiryRecord) => [...new Set([item.fields.addressee, item.fields.contactName].filter(Boolean))].join(' / ') || '';

  const rows = [

    { label: 'Client', here: client(record), there: existing ? client(existing) : '', matched: match.reasons.some(reason => /client|addressee/i.test(reason)) },

    { label: 'Account', here: record.fields.company, there: match.company, matched: match.reasons.some(reason => /account|company/i.test(reason)) },

    { label: 'Agent', here: record.fields.agentName, there: match.agentName, matched: match.sameAgent },

    { label: 'Status', here: 'On hold', there: existing?.status||'', matched: false },
    { label: 'Protection', here: record.protection?protectionDaysLeft(record.protection,Date.now())+' days left':'Not started', there: match.expired?'Expired':existing?.protection?protectionDaysLeft(existing.protection,Date.now())+' days left':'Not started', matched: false },

  ];

  return <div className="ops-client-comparison">



    <table aria-label={'Compare this request with ' + match.inquiryId}>

      <thead><tr><th scope="col"><span className="ops-sr-only">Detail</span></th><th scope="col">This request<small>{record.id}</small></th><th scope="col">Existing registration<small>{match.inquiryId}</small></th></tr></thead>

      <tbody>{rows.map(row => {const unavailable=!existing;const supplied=!!row.here&&!!row.there;const same=supplied&&normalizeClient(row.here)===normalizeClient(row.there);const label=unavailable?'Loading comparison':!supplied?'Not supplied':same?'Same':'Different';return <tr key={row.label} className={row.label==='Agent'?'agent-row':same?'matched':supplied?'different':''}>

        <th scope="row">{row.label}<small className={'ops-comparison-label '+(same?'same':supplied?'different':'missing')}>{['Status','Protection'].includes(row.label)?'':error?'Unavailable':(same?'✓ ':'⚠ ')+label}</small></th>

        <td>{row.here || 'Not supplied'}</td><td>{row.there || (error ? 'Unavailable' : existing?'Not supplied':'Loading…')}</td>

      </tr>;})}</tbody>

    </table>

    <p className="ops-comparison-evidence">Matched on: {match.reasons.join(" · ")}.</p>

    <div className="ops-comparison-footer">



      <a className="ops-link" href="#inquiry-workspace" onClick={event => { event.preventDefault(); onOpen(match.inquiryId); }}>Open existing inquiry <ArrowUpRight size={14}/></a>

      {onRecheck&&<button className="ops-btn" disabled={busy} onClick={onRecheck}><RefreshCw size={14}/>Recheck availability</button>}
    </div>

    {error && <p className="ops-inline-error" role="alert">Could not load the full comparison. <button className="ops-link" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14}/>Try again</button></p>}

  </div>;

}

