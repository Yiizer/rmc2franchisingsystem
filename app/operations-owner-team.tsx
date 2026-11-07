'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Plus, RefreshCw, ShieldAlert, UserX, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamMember } from '@/lib/operations/types';
import { api, initials, Modal } from './operations-common';
import './operations-report-queue.css';
import './operations-administration.css';

// Division Head only: the SOAs of their own division. The server re-checks the role, the division and the password on every call;
// a Division Head cannot reactivate (the Head does that), so deactivated people only show as Inactive here.
type TeamResponse = { division: string; members: TeamMember[] };
type Dialog = { kind: 'add' } | { kind: 'reset'; member: TeamMember } | { kind: 'deactivate'; member: TeamMember } | null;

export default function OwnerTeam() {
  const [data, setData] = useState<TeamResponse | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [denied, setDenied] = useState(false), [dialog, setDialog] = useState<Dialog>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => { setLoading(true); setError(''); setAttempt(n => n + 1); }, []);
  useEffect(() => {
    let active = true;
    api<TeamResponse>('my-team').then(next => { if (active) { setData(next); setDenied(false); } })
      .catch(e => { if (!active) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const division = data?.division || 'your division';
  return <div className="ops-oc-page ops-oc-team">
    <div className="ops-heading"><div><h1>My team</h1><p>{data ? 'The SOAs in ' + data.division + '. Add people, reset a password or deactivate an account.' : 'The SOAs in your division.'}</p></div>{data && !denied && <button className="ops-btn primary" onClick={() => setDialog({ kind: 'add' })}><Plus size={16} aria-hidden="true" />Add SOA</button>}</div>
    {denied ? <div className="ops-card ops-pad ops-oc-empty" role="alert"><ShieldAlert size={28} aria-hidden="true" /><h2>You can’t manage a team</h2><p>Only a Division Head can add or manage SOAs.</p></div>
      : loading && !data ? <div className="ops-oc-skeletons ops-card" aria-busy="true"><span className="sr-only" role="status">Loading your team…</span>{[0, 1, 2].map(i => <div key={i} className="ops-skeleton" />)}</div>
      : error && !data ? <div className="ops-card ops-pad ops-oc-empty" role="alert"><h2>We couldn’t load your team</h2><p>{error}</p><button className="ops-btn primary" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />Try again</button></div>
      : data && !data.members.length ? <section className="ops-card ops-oc-empty"><UsersRound size={28} aria-hidden="true" /><h2>No SOAs in {division} yet</h2><p>Add an SOA so they can submit inquiries for {division}.</p><button className="ops-btn primary" onClick={() => setDialog({ kind: 'add' })}><Plus size={16} aria-hidden="true" />Add SOA</button></section>
      : data && <section className="ops-card ops-admin-users" aria-label={'SOAs in ' + data.division} aria-busy={loading}>{data.members.map(m => <div className="ops-user-row" key={m.id}>
        <span className="ops-avatar">{initials(m.name)}</span>
        <div><b>{m.name}</b><small>{m.email}</small><small>{m.username ? '@' + m.username : ''}</small></div>
        <div><span>{m.position || 'SOA'}</span>{m.phone && <small>{m.phone}</small>}</div>
        <span className={'ops-badge ' + (m.active ? 'green' : 'slate')}><span className="ops-dot" />{m.active ? (m.mustChangePassword ? 'Active · must set a password' : 'Active') : 'Inactive'}</span>
        <div className="ops-user-extra">{m.active ? <><button className="ops-btn" aria-label={'Reset password for ' + m.name} onClick={() => setDialog({ kind: 'reset', member: m })}><KeyRound size={14} aria-hidden="true" />Reset password</button><button className="ops-btn danger" aria-label={'Deactivate ' + m.name} onClick={() => setDialog({ kind: 'deactivate', member: m })}><UserX size={14} aria-hidden="true" />Deactivate</button></> : <span className="ops-user-locked">Ask the Head to reactivate this account.</span>}</div>
      </div>)}</section>}
    {error && data && <p className="ops-message amber" role="alert">{error} <button className="ops-btn" onClick={() => void load()}>Try again</button></p>}
    {dialog?.kind === 'add' && <AddSoa division={division} onClose={() => setDialog(null)} onDone={() => void load()} />}
    {dialog?.kind === 'reset' && <ResetSoa member={dialog.member} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'deactivate' && <DeactivateSoa member={dialog.member} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} />}
  </div>;
}

function Credentials({ name, username, temporaryPassword, lead, onDone }: { name: string; username?: string; temporaryPassword: string; lead: string; onDone: () => void }) {
  return <div className="ops-pad"><div className="ops-message green"><CheckCircle2 size={25} aria-hidden="true" /><div><b>{lead} {name}</b><p>They must set a new password at first sign-in.</p></div></div>{username && <label>Username<input aria-label="Username" readOnly value={username} /></label>}<label>Temporary password<input aria-label="Temporary password" readOnly value={temporaryPassword} onFocus={e => e.currentTarget.select()} /></label><p>Shown once. Share these credentials privately with this person.</p><button className="ops-btn primary" onClick={onDone}>Done</button></div>;
}

function AddSoa({ division, onClose, onDone }: { division: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState<{ user: TeamMember; temporaryPassword: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget), phone = String(form.get('phone') || '').trim();
    try {
      const result = await api<{ user: TeamMember; temporaryPassword: string }>('my-team/create', { name: form.get('name'), username: form.get('username'), email: form.get('email'), position: String(form.get('position') || '').trim() || 'SOA', ...(phone ? { phone } : {}), currentPassword: form.get('password') });
      setCreated(result); onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Add SOA" onClose={() => { if (!busy) onClose(); }}>{created
    ? <Credentials lead="Account created for" name={created.user.name} username={created.user.username} temporaryPassword={created.temporaryPassword} onDone={onClose} />
    : <form className="ops-pad" onSubmit={submit}>
      <label>Division<input aria-label="Division" value={division} readOnly aria-readonly="true" /><small>SOAs you add always join your own division.</small></label>
      <label>Full name<input aria-label="Full name" name="name" required minLength={2} maxLength={100} autoComplete="off" /></label>
      <label>Username<input aria-label="Username" name="username" autoComplete="off" required minLength={3} maxLength={50} /></label>
      <label>Email<input aria-label="Email" name="email" type="email" required maxLength={254} /></label>
      <label>Position<input aria-label="Position" name="position" maxLength={200} defaultValue="SOA" /></label>
      <label>Phone (optional)<input aria-label="Phone (optional)" name="phone" type="tel" maxLength={40} autoComplete="off" /></label>
      <label>Your password<input aria-label="Your password" name="password" type="password" autoComplete="current-password" required maxLength={200} /><small>We ask for your password to confirm it’s you.</small></label>
      {error && <p role="alert" className="ops-client-error">{error}</p>}
      <div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add SOA'}</button></div>
    </form>}</Modal>;
}

function ResetSoa({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState<{ temporaryPassword: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { setDone(await api<{ temporaryPassword: string }>('my-team/' + encodeURIComponent(member.id) + '/reset-password', { currentPassword: password })); setPassword(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={'Reset password for ' + member.name + '?'} onClose={() => { if (!busy) onClose(); }}>{done
    ? <Credentials lead="Password reset for" name={member.name} username={member.username} temporaryPassword={done.temporaryPassword} onDone={onClose} />
    : <form className="ops-pad" onSubmit={submit}><p>A temporary password is shown once. {member.name} must set a new one at next sign-in.</p><label>Your password<input aria-label="Your password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200} /></label>{error && <p role="alert" className="ops-client-error">{error}</p>}<div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy || !password}>{busy ? 'Resetting…' : 'Reset password'}</button></div></form>}</Modal>;
}

function DeactivateSoa({ member, onClose, onDone }: { member: TeamMember; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('my-team/' + encodeURIComponent(member.id) + '/deactivate', { currentPassword: password }); toast.success(member.name + ' was deactivated'); onDone(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title={'Deactivate ' + member.name + '?'} onClose={() => { if (!busy) onClose(); }}>
    <form className="ops-pad" onSubmit={submit}><p>{member.name} will be signed out and won’t be able to sign in. Their clients and history stay. Only the Head can turn the account back on.</p><label>Your password<input aria-label="Your password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200} /></label>{error && <p role="alert" className="ops-client-error">{error}</p>}<div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn danger" disabled={busy || !password}>{busy ? 'Deactivating…' : 'Deactivate'}</button></div></form></Modal>;
}
