'use client';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BellRing, KeyRound, Mail, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Staff } from '@/lib/operations/types';
import { api, initials, PasswordInput } from './operations-common';
import PhoneNotifications from './operations-phone-notifications';
import { EmailTemplatesSettings, canUseEmailTemplates } from './operations-email-templates';
import './operations-settings.css';

// Settings: one tab per job (profile, security, notifications, email templates). The light/dark choice lives in the
// topbar toggle, not here. The chosen tab is remembered for this browser tab only.
type TabId = 'profile' | 'security' | 'notifications' | 'email';
type Tab = { id: TabId; label: string; hint: string; Icon: LucideIcon };
const TAB_KEY = 'rmc2.settings.tab';

function tabsFor(user: Staff): Tab[] {
  if (user.mustChangePassword) return [{ id: 'security', label: 'Security', hint: 'Set your password', Icon: ShieldCheck }];
  return [
    { id: 'profile', label: 'Profile', hint: 'Name and username', Icon: UserRound },
    { id: 'security', label: 'Security', hint: 'Password and sessions', Icon: ShieldCheck },
    { id: 'notifications', label: 'Notifications', hint: 'Alerts on your phone', Icon: BellRing },
    ...(canUseEmailTemplates(user) ? [{ id: 'email' as const, label: 'Email templates', hint: 'Your default wording', Icon: Mail }] : []),
  ];
}

export function AccountSettings({ user, onSignedOut }: { user: Staff; onSignedOut: () => void }) {
  const tabs = tabsFor(user);
  const [active, setActive] = useState<TabId>(() => {
    try { const saved = sessionStorage.getItem(TAB_KEY); if (tabs.some(t => t.id === saved)) return saved as TabId; } catch { /* storage blocked */ }
    return tabs[0].id;
  });
  const current = tabs.find(t => t.id === active) ?? tabs[0];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (id: TabId) => { setActive(id); try { sessionStorage.setItem(TAB_KEY, id); } catch { /* not remembered */ } };
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex(t => t.id === current.id);
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + tabs.length) % tabs.length;
    choose(tabs[j].id); buttons.current[j]?.focus();
  }
  return <div className="ops-settings">
    <div className="ops-settings-head">
      <h1>Settings</h1>
      <p>Manage your account, how you sign in and how the workspace reaches you.</p>
    </div>
    <div className="ops-settings-layout">
      <div className="ops-settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical" onKeyDown={onKey}>
        {tabs.map(({ id, label, hint, Icon }, i) => <button key={id} ref={el => { buttons.current[i] = el; }} role="tab" id={'ops-set-tab-' + id} aria-controls={'ops-set-panel-' + id} aria-selected={id === current.id} tabIndex={id === current.id ? 0 : -1} onClick={() => choose(id)}>
          <span className="ops-settings-glyph"><Icon size={17} aria-hidden="true" /></span>
          <span><b>{label}</b><small>{hint}</small></span>
        </button>)}
      </div>
      <section className="ops-settings-panel" role="tabpanel" id={'ops-set-panel-' + current.id} aria-labelledby={'ops-set-tab-' + current.id} key={current.id}>
        {current.id === 'profile' && <ProfilePanel user={user} onSignedOut={onSignedOut} />}
        {current.id === 'security' && <SecurityPanel user={user} onSignedOut={onSignedOut} />}
        {current.id === 'notifications' && <Panel title="Notifications" lead="Choose which events reach this phone or browser. Each device is set up on its own."><PhoneNotifications /></Panel>}
        {current.id === 'email' && <Panel title="Email templates" lead="Write the greeting, wording and sign-off once. Each email starts from this text and stays editable."><EmailTemplatesSettings user={user} /></Panel>}
      </section>
    </div>
  </div>;
}

function Panel({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return <><div className="ops-settings-panel-head"><h2>{title}</h2><p>{lead}</p></div>{children}</>;
}

/** A labelled settings row: what it is on the left, the control on the right. Stacks on phones. */
function Row({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor?: string; children: ReactNode }) {
  return <div className="ops-settings-row">
    <div className="ops-settings-row-label">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}{help && <small>{help}</small>}</div>
    <div className="ops-settings-row-control">{children}</div>
  </div>;
}

/** Both forms use the same "account-settings" call, which needs the current password and signs every session out. */
function useAccountSave(onSignedOut: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(body: { username: string; currentPassword: string; password?: string }, done: string) {
    setBusy(true); setError('');
    try { await api('account-settings', body); toast.success(done); onSignedOut(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return { busy, error, setError, save };
}

function ProfilePanel({ user, onSignedOut }: { user: Staff; onSignedOut: () => void }) {
  const original = user.username || user.id;
  const [username, setUsername] = useState(original), [current, setCurrent] = useState('');
  const { busy, error, save } = useAccountSave(onSignedOut);
  const changed = username.trim() !== original;
  return <Panel title="Profile" lead="How you appear to your team, and the username you sign in with.">
    <div className="ops-settings-identity">
      <span className="ops-settings-avatar" aria-hidden="true">{initials(user.name)}</span>
      <div><b>{user.name}</b><span>{user.role}{user.position ? ', ' + user.position : ''}</span><small>{user.email}</small></div>
    </div>
    <form className="ops-settings-group" onSubmit={e => { e.preventDefault(); void save({ username: username.trim(), currentPassword: current }, 'Username updated. Sign in with your new username.'); }}>
      <Row label="Username" help="3 to 50 characters. You can also sign in with your email." htmlFor="ops-set-username">
        <input id="ops-set-username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={50} required />
      </Row>
      {changed && <Row label="Current password" help="Confirms it is you." htmlFor="ops-set-username-pw">
        <PasswordInput id="ops-set-username-pw" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={200} />
      </Row>}
      <div className="ops-settings-foot">
        <p>Name, role and email are managed by your administrator.{changed ? ' Saving signs out all your sessions.' : ''}</p>
        {error && <p role="alert" className="ops-client-error">{error}</p>}
        <button className="ops-btn primary" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save username'}</button>
      </div>
    </form>
  </Panel>;
}

function SecurityPanel({ user, onSignedOut }: { user: Staff; onSignedOut: () => void }) {
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const { busy, error, setError, save } = useAccountSave(onSignedOut);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('The new passwords do not match.'); return; }
    void save({ username: user.username || user.id, currentPassword: current, password }, 'Password changed. Sign in with your new password.');
  }
  return <Panel title="Security" lead="Change the password you sign in with. A long, unique passphrase works well.">
    {user.mustChangePassword && <div className="ops-message amber">Set your own password to activate your account.</div>}
    <form className="ops-settings-group" onSubmit={submit}>
      <input type="text" name="username" autoComplete="username" value={user.username || user.id} readOnly hidden />
      <Row label="Current password" htmlFor="ops-set-current">
        <PasswordInput id="ops-set-current" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={200} />
      </Row>
      <Row label="New password" help="At least 14 characters." htmlFor="ops-set-new">
        <PasswordInput id="ops-set-new" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={14} maxLength={200} required />
      </Row>
      <Row label="Confirm new password" htmlFor="ops-set-confirm">
        <PasswordInput id="ops-set-confirm" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required maxLength={200} />
      </Row>
      <div className="ops-settings-foot">
        <p>Changing your password signs out every device signed in to your account.</p>
        {error && <p role="alert" className="ops-client-error">{error}</p>}
        <button className="ops-btn primary" disabled={busy}><KeyRound size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  </Panel>;
}
