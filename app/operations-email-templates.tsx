'use client';
import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { EMAIL_PLACEHOLDERS } from '@/lib/operations/types';
import type { EmailTemplateKind, EmailTemplatesResponse, Staff } from '@/lib/operations/types';
import { api } from './operations-common';
import './operations-email-templates.css';

// Item 10: each staff member keeps their own wording for the three agent emails. Placeholders are filled here for the form and the preview;
// the server fills them again with plain text replacement when it builds an email itself.
export type TemplateValues = { agentName?: string; company?: string; proposalName?: string; myName?: string };
export const fillTemplate = (text: string, values: TemplateValues) => text.replace(/\{(agentName|company|proposalName|myName)\}/g, (_, key: keyof TemplateValues) => values[key] ?? '');
/** Turns this inquiry's own values back into placeholders (longest first, empty values skipped) so a saved template works for the next inquiry. */
export function toPlaceholders(text: string, values: TemplateValues): { text: string; replaced: string[] } {
  const pairs = (Object.entries(values) as [keyof TemplateValues, string | undefined][]).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()] as const).sort((a, b) => b[1].length - a[1].length);
  const replaced: string[] = [];
  let out = text;
  for (const [key, value] of pairs) { if (out.includes(value)) { out = out.split(value).join('{' + key + '}'); replaced.push(value + ' → {' + key + '}'); } }
  return { text: out, replaced };
}
/** Head, Supervisor and Employee only (the same people who prepare proposals). */
export const canUseEmailTemplates = (user: Pick<Staff, 'role'>) => ['Head', 'Supervisor', 'Employee'].includes(user.role);
export const loadEmailTemplates = () => api<EmailTemplatesResponse>('email-templates');
/** The text of one kind: the user's own, else the built-in default. */
export function templateText(data: EmailTemplatesResponse | null, kind: 'details' | 'decline'): string | undefined { return data?.mine[kind]?.body ?? data?.defaults[kind]?.body; }
export async function saveMyTemplate(kind: 'details' | 'decline', body: string) {
  await api('email-templates', { [kind]: { body } });
}
export const PLACEHOLDER_HINT = 'Placeholders: ' + EMAIL_PLACEHOLDERS.join(' ') + ' are filled in for you.';

const SAMPLE = { agentName: 'Maria Santos', company: 'Sample Corporation', proposalName: 'Sample proposal' };
const CARDS: { kind: EmailTemplateKind; title: string; blurb: string }[] = [
  { kind: 'proposal', title: 'Proposal email', blurb: 'Sent to the agent when a proposal is approved.' },
  { kind: 'details', title: 'Request missing details', blurb: 'Asks the agent to complete the form.' },
  { kind: 'decline', title: 'Decline', blurb: 'Tells the agent a request was declined.' },
];
type Draft = { subject: string; body: string };
const draftOf = (data: EmailTemplatesResponse, kind: EmailTemplateKind): Draft => kind === 'proposal' ? { subject: (data.mine.proposal ?? data.defaults.proposal).subject, body: (data.mine.proposal ?? data.defaults.proposal).body } : { subject: '', body: (data.mine[kind] ?? data.defaults[kind]).body };

/** Settings → "My email templates". */
export function EmailTemplatesSettings({ user }: { user: Staff }) {
  const [data, setData] = useState<EmailTemplatesResponse | null>(null), [drafts, setDrafts] = useState<Record<EmailTemplateKind, Draft> | null>(null), [error, setError] = useState(''), [denied, setDenied] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const apply = useCallback((next: EmailTemplatesResponse) => { setData(next); setDrafts({ proposal: draftOf(next, 'proposal'), details: draftOf(next, 'details'), decline: draftOf(next, 'decline') }); }, []);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => { setLoading(true); setError(''); setAttempt(n => n + 1); }, []);
  useEffect(() => {
    let active = true;
    loadEmailTemplates().then(next => { if (active) { apply(next); setDenied(false); } })
      .catch(e => { if (!active) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, apply]);
  async function send(kind: EmailTemplateKind, reset: boolean) {
    if (!drafts) return;
    setBusy(kind + (reset ? ':reset' : ':save'));
    try {
      const body = reset ? null : kind === 'proposal' ? { subject: drafts.proposal.subject, body: drafts.proposal.body } : { body: drafts[kind].body };
      await api('email-templates', { [kind]: body });
      const next = await loadEmailTemplates();
      setData(next); setDrafts(prev => prev ? { ...prev, [kind]: draftOf(next, kind) } : prev); // only the saved card; other unsaved drafts stay
      toast.success(reset ? 'Back to the default wording' : 'Template saved');
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(''); }
  }
  const values: TemplateValues = { ...SAMPLE, myName: user.name };
  return <section className="ops-et" aria-labelledby="ops-et-title">
    <div className="ops-heading"><div><h2 id="ops-et-title"><Mail size={22} aria-hidden="true" />My email templates</h2><p>Write the greeting, wording and sign-off once. Your emails start from this text, and you can still edit each one.</p></div></div>
    {loading && !data ? <div className="ops-et-skeleton" role="status" aria-busy="true"><span className="sr-only">Loading your email templates…</span>{[0, 1, 2].map(i => <div key={i} className="ops-skeleton" />)}</div>
      : denied ? <div className="ops-card ops-pad ops-et-state" role="alert"><ShieldAlert size={22} aria-hidden="true" /><div><b>Email templates are not available for your account.</b><p>Ask the Head if you think this is a mistake.</p></div></div>
      : error || !data || !drafts ? <div className="ops-card ops-pad ops-et-state" role="alert"><div><b>We couldn’t load your email templates.</b><p>{error || 'Please try again.'}</p></div><button className="ops-btn" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />Try again</button></div>
      : <div className="ops-et-grid">{CARDS.map(({ kind, title, blurb }) => {
        const draft = drafts[kind], saved = draftOf(data, kind), own = !!data.mine[kind], dirty = draft.body !== saved.body || draft.subject !== saved.subject, working = busy.startsWith(kind);
        const set = (patch: Partial<Draft>) => setDrafts(prev => prev ? { ...prev, [kind]: { ...prev[kind], ...patch } } : prev);
        const idBase = 'ops-et-' + kind;
        return <section key={kind} className="ops-card ops-et-card" aria-labelledby={idBase + '-h'}>
          <div className="ops-card-head"><div><h3 id={idBase + '-h'}>{title}</h3><p>{blurb}</p></div><span className={'ops-badge ' + (own ? 'green' : 'slate')}>{own ? 'Your wording' : 'Default wording'}</span></div>
          <div className="ops-pad ops-et-body">
            {kind === 'proposal' && <label htmlFor={idBase + '-subject'}>Subject<input id={idBase + '-subject'} value={draft.subject} maxLength={300} onChange={e => set({ subject: e.target.value })} /></label>}
            <label htmlFor={idBase + '-body'}>Message<textarea id={idBase + '-body'} rows={9} maxLength={10000} value={draft.body} onChange={e => set({ body: e.target.value })} aria-describedby={idBase + '-hint'} /></label>
            <p id={idBase + '-hint'} className="ops-et-hint">{PLACEHOLDER_HINT}</p>
            <div className="ops-et-preview" role="group" aria-label={title + ' preview'}><small>Preview with sample details</small>{kind === 'proposal' && <b>{fillTemplate(draft.subject, values) || 'No subject'}</b>}<pre>{fillTemplate(draft.body, values) || 'Nothing to show yet.'}</pre></div>
            <div className="ops-actions"><button className="ops-btn" disabled={!own || !!busy} onClick={() => void send(kind, true)}><RotateCcw size={15} aria-hidden="true" />{busy === kind + ':reset' ? 'Resetting…' : 'Reset to default'}</button><button className="ops-btn primary" disabled={!dirty || !draft.body.trim() || (kind === 'proposal' && !draft.subject.trim()) || !!busy} onClick={() => void send(kind, false)}><Save size={15} aria-hidden="true" />{working && busy.endsWith(':save') ? 'Saving…' : 'Save'}</button></div>
          </div>
        </section>;
      })}</div>}
  </section>;
}

/** "Save as my template" for the Decline and Request-details dialogs. Saves the text exactly as typed. */
export function SaveAsTemplate({ kind, body, values, disabled = false }: { kind: 'details' | 'decline'; body: string; values: TemplateValues; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { text, replaced } = toPlaceholders(body, values);
      await saveMyTemplate(kind, text);
      toast.success('Saved as your ' + (kind === 'decline' ? 'decline' : 'request details') + ' template', { description: replaced.length ? 'Turned into placeholders: ' + replaced.join(', ') : 'No names to replace; saved as typed.' });
    }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="ops-mail-template"><button type="button" className="ops-btn" disabled={disabled || busy || !body.trim()} onClick={() => void save()}><Save size={15} aria-hidden="true" />{busy ? 'Saving…' : 'Save as my template'}</button><small>Names on this inquiry are saved as {EMAIL_PLACEHOLDERS.join(' ')} so the template works next time.</small></div>;
}
