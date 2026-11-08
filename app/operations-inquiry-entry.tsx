'use client';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { philippinePhone } from '@/lib/operations/proposal-fields';
import { api } from './operations-common';
import './operations-inquiry-entry.css';

// Item 7: "Upload form" (the existing file flow, passed in) or "Fill in details" (typed fields, POST intake-fields). The server turns the typed
// fields into a real franchise-form workbook and runs the unchanged intake, so the response is the same as for an uploaded form.
type Spec = { key: string; label: string; kind?: 'text' | 'select' | 'date' | 'email' | 'tel' | 'numeric'; options?: string[]; wide?: boolean; hint?: string; auto?: string };
const GROUPS: { title: string; fields: Spec[] }[] = [
  { title: 'Account', fields: [
    { key: 'company', label: 'Account name', auto: 'organization' }, { key: 'sector', label: 'Sector', kind: 'select', options: ['Private', 'DepEd', 'Government'] },
    { key: 'industry', label: 'Nature of business' }, { key: 'branch', label: 'Branch' },
    { key: 'address', label: 'Address', wide: true }, { key: 'requestDate', label: 'Request date', kind: 'date' }] },
  { title: 'Agent and contact', fields: [
    { key: 'agentName', label: 'Agent name' }, { key: 'agentEmail', label: 'Agent email (replies go here)', kind: 'email', auto: 'email' },
    { key: 'agentPhone', label: 'Agent mobile', kind: 'tel', hint: 'For example 0917 123 4567' }, { key: 'contactName', label: 'Client contact' },
    { key: 'contactEmail', label: 'Client email', kind: 'email' }, { key: 'contactPhone', label: 'Client mobile', kind: 'tel', hint: 'For example 0917 123 4567' },
    { key: 'contactPosition', label: 'Client position' }, { key: 'addressee', label: 'Proposal addressee' }, { key: 'addresseePosition', label: 'Addressee position' }] },
  { title: 'Coverage', fields: [
    { key: 'requestedPlan', label: 'Requested plan' }, { key: 'existingProvider', label: 'Existing provider' },
    { key: 'payment', label: 'Payment schedule', kind: 'select', options: ['Annual', 'Semiannual'] }, { key: 'employees', label: 'Regular employees', kind: 'numeric' },
    { key: 'dependents', label: 'Dependents', kind: 'numeric' }, { key: 'employeeAges', label: 'Employee age range' },
    { key: 'dependentAges', label: 'Dependent age range' }, { key: 'hospitals', label: 'Preferred hospitals / clinics' }, { key: 'dental', label: 'Preferred dental clinics' }] },
];
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Only what is needed to create the inquiry. Everything else is optional here; the review step flags what is still missing.
const uuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16); // non-secure origins (plain http on a LAN address) have no randomUUID
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Without `upload`, only the fill-in form is shown (no tabs), as on the Division Head / SOA Submit inquiry page. */
type Props = { variant: 'staff' | 'owner'; upload?: ReactNode; onCreated: (result: unknown) => void | Promise<void>; ownerId?: string | null; extra?: ReactNode; onCancel?: () => void; onBusyChange?: (busy: boolean) => void; submitLabel?: string };

export default function InquiryEntry({ variant, upload, onCreated, ownerId, extra, onCancel, onBusyChange, submitLabel }: Props) {
  const [tab, setTab] = useState<'upload' | 'fill'>(upload ? 'upload' : 'fill'), [values, setValues] = useState<Record<string, string>>(() => ({ requestDate: manilaToday() })), [shown, setShown] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [key] = useState(uuid); // once per time the form is opened: a double click or a retry replays the same inquiry
  const base = useId(), form = useRef<HTMLFormElement>(null), owner = variant === 'owner';
  const groups = useMemo(() => GROUPS.map(g => ({ ...g, fields: g.fields.filter(f => !(owner && f.key === 'agentEmail')) })), [owner]);
  const required = (spec: Spec) => spec.key === 'company' || (!owner && (spec.key === 'agentName' || spec.key === 'agentEmail'));
  const problem = (spec: Spec): string => {
    const value = (values[spec.key] || '').trim();
    if (!value) return required(spec) ? (spec.kind === 'select' ? 'Choose a value.' : 'Required.') : '';
    if (spec.kind === 'email' && !EMAIL.test(value)) return 'Enter a full email address.';
    if (spec.kind === 'tel' && !philippinePhone(value).valid) return 'Check the Philippine mobile number.';
    if (spec.kind === 'numeric' && !/^\d{1,6}$/.test(value)) return 'Use digits only.';
    return '';
  };
  const errors = Object.fromEntries(groups.flatMap(g => g.fields).map(f => [f.key, problem(f)]).filter(([, message]) => message));
  const set = (name: string, value: string) => setValues(prev => ({ ...prev, [name]: value }));
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setShown(true); setError('');
    const firstBad = Object.keys(errors)[0];
    if (firstBad) { form.current?.querySelector<HTMLElement>('[name="' + firstBad + '"]')?.focus(); return; }
    setBusy(true);
    try {
      const fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v && !(owner && k === 'agentEmail')));
      const result = await api<unknown>('intake-fields', { fields, ...(!owner && ownerId ? { ownerId } : {}), idempotencyKey: key });
      await onCreated(result);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(owner && (!status || status >= 500 || status === 401) ? 'We couldn’t submit your inquiry. Nothing was sent. Please try again.' : (e as Error).message);
    } finally { setBusy(false); }
  }
  const tabs: ['upload' | 'fill', string][] = [['upload', 'Upload form'], ['fill', 'Fill in details']];
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'upload' : event.key === 'End' ? 'fill' : tab === 'upload' ? 'fill' : 'upload';
    setTab(next); document.getElementById(base + '-tab-' + next)?.focus();
  };
  return <div className="ops-entry">
    {upload && <div className="ops-entry-tabs" role="tablist" aria-label="How to add the inquiry">{tabs.map(([id, label]) => <button key={id} id={base + '-tab-' + id} role="tab" type="button" aria-selected={tab === id} aria-controls={base + '-panel-' + id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)} onKeyDown={move}>{label}</button>)}</div>}
    {upload && <div id={base + '-panel-upload'} role="tabpanel" aria-labelledby={base + '-tab-upload'} hidden={tab !== 'upload'}>{upload}</div>}
    <div id={base + '-panel-fill'} {...(upload ? { role: 'tabpanel', 'aria-labelledby': base + '-tab-fill' } : {})} hidden={!!upload && tab !== 'fill'}>
      <form ref={form} noValidate onSubmit={submit} className="ops-entry-form" aria-busy={busy}>
        <p className="ops-entry-note">Type the details from the agent’s request. <span aria-hidden="true">*</span><span className="sr-only">Fields marked required</span> Only the fields marked with an asterisk are needed now; the review step flags anything else that is missing.</p>
        {groups.map(group => <fieldset key={group.title} className="ops-entry-group"><legend>{group.title}</legend><div className="ops-entry-grid">{group.fields.map(spec => {
          const id = base + '-' + spec.key, message = shown ? errors[spec.key] : '', req = required(spec), describedBy = [message && id + '-err', spec.hint && id + '-hint'].filter(Boolean).join(' ') || undefined;
          return <div key={spec.key} className={'ops-entry-field' + (spec.wide ? ' wide' : '') + (message ? ' invalid' : '')}>
            <label htmlFor={id}>{spec.label}{req && <span className="ops-entry-req" aria-hidden="true"> *</span>}{req && <span className="sr-only"> (required)</span>}</label>
            {spec.kind === 'select'
              ? <select id={id} name={spec.key} value={values[spec.key] || ''} aria-required={req} aria-invalid={!!message} aria-describedby={describedBy} disabled={busy} onChange={e => set(spec.key, e.target.value)}><option value="">Choose…</option>{spec.options!.map(o => <option key={o}>{o}</option>)}</select>
              : <input id={id} name={spec.key} type={spec.kind === 'date' ? 'date' : spec.kind === 'email' ? 'email' : spec.kind === 'tel' ? 'tel' : 'text'} inputMode={spec.kind === 'numeric' ? 'numeric' : undefined} autoComplete={spec.auto || 'off'} maxLength={spec.key === 'address' ? 300 : 200} value={values[spec.key] || ''} aria-required={req} aria-invalid={!!message} aria-describedby={describedBy} disabled={busy} onChange={e => set(spec.key, e.target.value)} />}
            {spec.hint && <small id={id + '-hint'}>{spec.hint}</small>}
            {message && <small id={id + '-err'} className="ops-entry-error" role="alert">{message}</small>}
          </div>;
        })}</div></fieldset>)}
        {extra}
        {error && <p role="alert" className="ops-message amber">{error}</p>}
        {shown && Object.keys(errors).length > 0 && <p role="status" className="ops-entry-summary">{Object.keys(errors).length} {Object.keys(errors).length === 1 ? 'field needs' : 'fields need'} a look before you can continue.</p>}
        <div className="ops-actions">{onCancel && <button type="button" className="ops-btn" onClick={onCancel} disabled={busy}>Cancel</button>}<button className="ops-btn primary" disabled={busy}>{busy ? <><RefreshCw size={16} className="ops-spin" aria-hidden="true" />Submitting…</> : <>{submitLabel || (owner ? 'Submit inquiry' : 'Create inquiry')}<ArrowRight size={15} aria-hidden="true" /></>}</button></div>
      </form>
    </div>
  </div>;
}
