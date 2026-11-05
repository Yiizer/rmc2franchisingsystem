'use client';
import { useState } from 'react';
import { CheckCircle2, KeyRound, LockOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { Staff } from '@/lib/operations/types';
import { canManageAccounts, canResetPassword, DIVISIONS, isOwnerScoped } from '@/lib/operations/permissions';
import { api, initials, Modal } from './operations-common';
import { CreateAccount } from './operations-administration';
import './operations-report-queue.css';

export const ROLE_LABEL: Record<Staff['role'], string> = { Head: 'Head', Supervisor: 'Supervisor', Employee: 'Employee', DivisionHead: 'Division Head', SOA: 'SOA', Admin: 'Admin' };
const HEAD_ROLES: Staff['role'][] = ['Head', 'Supervisor', 'Employee', 'DivisionHead', 'SOA'];
const approver = (role: Staff['role']) => role === 'Head' || role === 'Supervisor';

function ResetPassword({ target, onClose }: { target: Staff; onClose: () => void }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState<{ user: Staff; temporaryPassword: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { setDone(await api<{ user: Staff; temporaryPassword: string }>('reset-password', { userId: target.id, currentPassword: password })); setPassword(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={'Reset password for ' + target.name + '?'} onClose={() => { if (!busy) onClose(); }}>{done
    ? <div className="ops-pad"><div className="ops-message green"><CheckCircle2 size={25} /><div><b>Password reset for {done.user.name}</b><p>They must set a new password at next sign-in.</p></div></div><label>Username<input readOnly value={done.user.username || done.user.id} /></label><label>Temporary password<input readOnly value={done.temporaryPassword} /></label><p>Shown once. Share these credentials privately.</p><button className="ops-btn primary" onClick={onClose}>Done</button></div>
    : <form className="ops-pad" onSubmit={submit}><p>A temporary password is shown once. They must set a new one at next sign-in.</p><label>Your password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200} /></label>{error && <p role="alert" className="ops-client-error">{error}</p>}<div className="ops-actions"><button type="button" className="ops-btn" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-btn primary" disabled={busy || !password}>{busy ? 'Resetting…' : 'Reset password'}</button></div></form>}</Modal>;
}

function useUnlock() {
  const [busy, setBusy] = useState('');
  return { busy, unlock: async (person: Staff) => { setBusy(person.id); try { await api('unlock-account', { userId: person.id }); toast.success('Sign-in unlocked for ' + person.name); } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); } } };
}

/** Head: edit role, division, phone, status. */
function UserEditor({ person, me, onRefresh, onReset }: { person: Staff; me: Staff; onRefresh: () => Promise<void>; onReset: (p: Staff) => void }) {
  const [role, setRole] = useState(person.role), [active, setActive] = useState(person.active), [division, setDivision] = useState(person.division || ''), [phone, setPhone] = useState(person.phone || ''), [position, setPosition] = useState(person.position || ''), [busy, setBusy] = useState(false);
  const { busy: unlocking, unlock } = useUnlock();
  const self = person.id === me.id, owner = isOwnerScoped({ role }), needDivision = owner && !division;
  const changed = role !== person.role || active !== person.active || (division || '') !== (person.division || '') || (phone || '') !== (person.phone || '') || position !== (person.position || '');
  // A role change or deactivation asks for the Head's own password (checked on the server).
  const sensitive = role !== person.role || active !== person.active, [confirmPassword, setConfirmPassword] = useState('');
  async function save() {
    setBusy(true);
    try { await api('users', { id: person.id, active, role, canApprove: approver(role), division: owner ? division : null, position, phone: phone.trim() || null, ...(sensitive ? { currentPassword: confirmPassword } : {}) }); setConfirmPassword(''); await onRefresh(); toast.success('Staff account saved'); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="ops-user-row"><span className="ops-avatar">{initials(person.name)}</span>
    <div><b>{person.name}</b><small>{person.email}</small><small>{person.username ? '@' + person.username : ''}</small></div>
    <div className="ops-user-extra">
      <select aria-label={'Role for ' + person.name} value={role} disabled={self} onChange={e => setRole(e.target.value as Staff['role'])}>{HEAD_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      {owner && <select aria-label={'Division for ' + person.name} value={division} required aria-invalid={needDivision} onChange={e => setDivision(e.target.value)}><option value="">Choose a division…</option>{DIVISIONS.map(d => <option key={d}>{d}</option>)}</select>}
      <input aria-label={'Position for ' + person.name} value={position} maxLength={200} placeholder="Position" onChange={e => setPosition(e.target.value)} />
      <input aria-label={'Phone for ' + person.name} type="tel" value={phone} maxLength={40} placeholder="Phone (optional)" onChange={e => setPhone(e.target.value)} />
    </div>
    <label className="ops-check"><input type="checkbox" checked={active} disabled={self} onChange={e => setActive(e.target.checked)} />Active</label>
    {self && <span className="ops-user-locked">You can’t change your own role.</span>}
    {needDivision && <span className="ops-user-hint" role="alert">Choose a division.</span>}
    <div className="ops-user-extra">{sensitive && <input type="password" aria-label={'Your password to confirm the change for ' + person.name} placeholder="Your password to confirm" autoComplete="current-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />}<button className="ops-btn" disabled={busy || !changed || needDivision || (sensitive && !confirmPassword)} onClick={() => void save()}>Save</button>
      {!self && canResetPassword(me) && <button className="ops-btn" onClick={() => onReset(person)}><KeyRound size={14} aria-hidden="true" />Reset password</button>}
      {!self && canResetPassword(me) && <button className="ops-btn" disabled={unlocking === person.id} onClick={() => void unlock(person)}><LockOpen size={14} aria-hidden="true" />Unlock</button>}</div>
  </div>;
}

/** Admin: read-only list with Reset password and Unlock. The server lets an Admin reset Employee accounts only and unlock anyone except the Head and other Admins. */
function AdminRow({ person, onReset }: { person: Staff; onReset: (p: Staff) => void }) {
  const { busy, unlock } = useUnlock();
  const canReset = person.role === 'Employee', canUnlock = person.role !== 'Head' && person.role !== 'Admin';
  return <div className="ops-user-row"><span className="ops-avatar">{initials(person.name)}</span>
    <div><b>{person.name}</b><small>{person.email}</small></div>
    <span>{ROLE_LABEL[person.role]}{person.division ? ' · ' + person.division : ''}</span>
    <span>{person.active ? 'Active' : 'Inactive'}</span>
    <div className="ops-user-extra"><button className="ops-btn" disabled={!canReset} aria-label={'Reset password for ' + person.name} title={canReset ? undefined : 'Ask the Head to reset this account.'} onClick={() => onReset(person)}><KeyRound size={14} aria-hidden="true" />Reset password</button>
      <button className="ops-btn" disabled={!canUnlock || busy === person.id} aria-label={'Unlock ' + person.name} title={canUnlock ? undefined : 'Ask the Head to unlock this account.'} onClick={() => void unlock(person)}><LockOpen size={14} aria-hidden="true" />Unlock</button></div>
    {!canReset && <span className="ops-user-locked">Ask the Head to reset this account.</span>}
  </div>;
}

export default function UsersAndRoles({ user, users, onRefresh }: { user: Staff; users: Staff[]; onRefresh: () => Promise<void> }) {
  const [reset, setReset] = useState<Staff | null>(null);
  const head = canManageAccounts(user), list = head ? users.filter(p => p.role !== 'Admin') : users;
  return <><div className="ops-heading"><div><h1>Users &amp; roles</h1><p>{head ? 'Create accounts and set roles. Admin accounts are managed by IT.' : 'Reset a password or unlock an account in an emergency. Role changes are made by the Head.'}</p></div>{head && <CreateAccount onRefresh={onRefresh} />}</div>
    <section className="ops-card ops-admin-users" aria-label="Accounts">{list.map(p => head ? <UserEditor key={p.id + p.role + p.active + (p.division || '') + (p.phone || '')} person={p} me={user} onRefresh={onRefresh} onReset={setReset} /> : <AdminRow key={p.id} person={p} onReset={setReset} />)}</section>
    {reset && <ResetPassword target={reset} onClose={() => setReset(null)} />}</>;
}
