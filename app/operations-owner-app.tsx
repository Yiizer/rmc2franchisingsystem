'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { useTheme } from './operations-theme';
import { manilaTime, ageLabel } from '@/lib/operations/types';
import type { Staff } from '@/lib/operations/types';
import type { OwnerClient, OwnerNotice, OwnerUser } from '@/lib/operations/owner-view';
import { api, Empty } from './operations-common';
import { AccountSettings } from './operations-settings';
import OperationsShell from './operations-shell';
import { noticeStyle } from './operations-notifications';
import MyClients from './operations-owner-clients';
import ClientPage from './operations-owner-client';
import SubmitInquiry from './operations-owner-submit';
import OwnerTeam from './operations-owner-team';
import './operations-notifications.css';
import './operations-report-queue.css';
import './operations-owner-app.css';

export type OwnerBoot = { scoped: true; user: OwnerUser; clients: OwnerClient[]; notifications: OwnerNotice[]; unreadCount: number };
type Route = { page: 'My Clients' | 'Client' | 'Submit inquiry' | 'My team' | 'Notifications' | 'Settings'; id: string };
const parse = (hash: string): Route => {
  const h = hash.replace(/^#/, ''), [a, b] = h.split('/');
  if (a === 'my-clients' && b) return { page: 'Client', id: decodeURIComponent(b) };
  if (a === 'submit-inquiry') return { page: 'Submit inquiry', id: '' };
  if (a === 'my-team') return { page: 'My team', id: '' };
  if (a === 'notifications') return { page: 'Notifications', id: '' };
  if (a === 'settings') return { page: 'Settings', id: '' };
  return { page: 'My Clients', id: '' };
};
const hashFor = (page: string, id = '') => ({ 'My Clients': 'my-clients', Client: 'my-clients/' + encodeURIComponent(id), 'Submit inquiry': 'submit-inquiry', 'My team': 'my-team', Notifications: 'notifications', Settings: 'settings' } as Record<string, string>)[page] || 'my-clients';

export default function OwnerApp({ initial, onSignedOut }: { initial: OwnerBoot; onSignedOut: () => void }) {
  const [boot, setBoot] = useState<OwnerBoot>(initial), [loading, setLoading] = useState(false), [error, setError] = useState(''), [now, setNow] = useState(() => Date.now());
  const [route, setRoute] = useState<Route>(() => parse(typeof window === 'undefined' ? '' : window.location.hash));
  const mustChange = !!boot.user.mustChangePassword;
  const page = mustChange ? 'Settings' : route.page === 'My team' && boot.user.role !== 'DivisionHead' ? 'My Clients' : route.page; // My team is for Division Heads only

  const refresh = useCallback(async () => {
    setLoading(true);
    try { const next = await api<OwnerBoot>('bootstrap'); setBoot(next); setError(''); }
    catch (e) { if ((e as { status?: number }).status === 401) onSignedOut(); else setError((e as Error).message); }
    finally { setLoading(false); }
  }, [onSignedOut]);
  useEffect(() => {
    const sync = () => {
      const r = parse(window.location.hash), canonical = hashFor(r.page, r.id);
      if (window.location.hash.replace(/^#/, '') !== canonical) window.history.replaceState(null, '', '#' + canonical);
      setRoute(r);
    };
    sync(); window.addEventListener('hashchange', sync);
    const poll = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void refresh(); } };
    const timer = setInterval(poll, 10000);
    window.addEventListener('focus', poll);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('focus', poll); clearInterval(timer); };
  }, [refresh]);

  const go = useCallback(async (target: string) => { window.location.hash = hashFor(target); window.scrollTo(0, 0); return true; }, []);
  const openClient = useCallback((id: string) => { window.location.hash = hashFor('Client', id); window.scrollTo(0, 0); }, []);
  const signOut = useCallback(async () => { try { await api('logout', {}); } catch { /* the session is gone either way */ } onSignedOut(); }, [onSignedOut]);
  async function read(ids: string[], all = false) { try { await api('notifications', all ? { all: true } : { ids }); await refresh(); } catch (e) { toast.error((e as Error).message); } }

  const { theme } = useTheme();
  const user = boot.user as unknown as Staff;
  const found = useMemo(() => boot.clients.find(c => c.id === route.id), [boot.clients, route.id]);
  const names = useMemo(() => new Map(boot.clients.map(c => [c.id, c.client])), [boot.clients]);
  return <div className="ops-app ops-owner-app"><Toaster position="top-right" theme={theme} />
    <OperationsShell user={{ ...user, active: true, canApprove: false }} page={page} pending={0} unread={boot.unreadCount} onGo={go} onSignOut={signOut}>
      <main className="ops-main ops-owner-main" id="main">
        {page === 'My Clients' && <MyClients clients={boot.clients} loading={loading} error={error} onRetry={() => void refresh()} onOpen={openClient} onSubmit={() => void go('Submit inquiry')} now={now} />}
        {page === 'Client' && <ClientPage key={route.id} id={route.id} initial={found} onBack={() => void go('My Clients')} onChanged={() => void refresh()} now={now} />}
        {page === 'Submit inquiry' && <SubmitInquiry division={boot.user.division} onDone={() => void refresh()} onOpenClient={openClient} />}
        {page === 'My team' && <OwnerTeam />}
        {page === 'Notifications' && <OwnerNotifications notices={boot.notifications} names={names} now={now} onReadAll={() => void read([], true)} onOpen={n => { void read([n.id]); openClient(n.inquiryId); }} />}
        {page === 'Settings' && <AccountSettings user={user} onSignedOut={onSignedOut} />}
      </main>
    </OperationsShell></div>;
}

function OwnerNotifications({ notices, names, now, onReadAll, onOpen }: { notices: OwnerNotice[]; names: Map<string, string>; now: number; onReadAll: () => void; onOpen: (n: OwnerNotice) => void }) {
  const unread = notices.filter(n => !n.read).length;
  return <div className="ops-oc-page"><header className="ops-oc-heading"><div><h1>Notifications</h1><p>{unread} unread</p></div><button className="ops-btn secondary" disabled={!unread} onClick={onReadAll}>Mark all as read</button></header>
    <section className="ops-card" aria-label="Notifications">{notices.length ? <div className="ops-notification-feed">{notices.map(n => { const { Icon, tone } = noticeStyle(n.title); return <button key={n.id} className={'ops-notification-row' + (n.read ? '' : ' unread')} onClick={() => onOpen(n)}><span className={'ops-badge ' + tone}><Icon size={18} aria-hidden="true" /></span><span><b>{n.title}</b><span>{n.message}</span><small>{names.get(n.inquiryId) || 'Client'} · {manilaTime(n.at)} · {ageLabel(n.at, now)}</small></span>{!n.read && <span className="ops-unread-dot" aria-label="Unread" />}</button>; })}</div> : <Empty text="You're all caught up" hint="New activity on your clients will appear here." />}</section></div>;
}
