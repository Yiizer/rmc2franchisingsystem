'use client';
import { useEffect, useState } from 'react';
import { BellRing, BellOff, Share, PlusSquare, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from './operations-common';

// Account settings → Phone notifications. iPhone first: Safari only allows push for an app added to the Home Screen
// (iOS 16.4+), so outside the installed app we show the steps instead of a button that cannot work.
type Settings = { configured: boolean; publicKey: string; muted: string[]; types: string[]; labels: Record<string, string>; devices: { id: string; label: string; createdAt: string; lastUsedAt: string }[] };
type Support = 'checking' | 'ok' | 'install' | 'unsupported' | 'blocked';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4), raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const deviceLabel = () => isIos() ? 'iPhone' : /Android/i.test(navigator.userAgent) ? 'Android phone' : /Edg\//.test(navigator.userAgent) ? 'Edge browser' : /Chrome\//.test(navigator.userAgent) ? 'Chrome browser' : 'This browser';
const when = (iso: string) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet';

export default function PhoneNotifications() {
  const [settings, setSettings] = useState<Settings | null>(null), [support, setSupport] = useState<Support>('checking');
  const [endpoint, setEndpoint] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try { const data = await api<Settings>('push'); if (alive) setSettings(data); } catch (e) { if (alive) setError((e as Error).message); }
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) { if (alive) setSupport(isIos() && !standalone() ? 'install' : 'unsupported'); return; }
      if (Notification.permission === 'denied') { if (alive) setSupport('blocked'); return; }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        const existing = await registration.pushManager.getSubscription();
        if (alive) { setEndpoint(existing?.endpoint || ''); setSupport('ok'); }
      } catch { if (alive) setSupport('unsupported'); }
    })();
    return () => { alive = false; };
  }, []);
  const thisDeviceOn = !!endpoint && !!settings?.devices.length;
  async function turnOn() {
    if (!settings?.publicKey) return; setBusy(true); setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setSupport(permission === 'denied' ? 'blocked' : 'ok'); setError('Notifications were not allowed on this device.'); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription()) || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(settings.publicKey) });
      const json = subscription.toJSON();
      setSettings(await api<Settings>('push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }));
      setEndpoint(subscription.endpoint); toast.success('Phone notifications are on for this device.');
    } catch (e) { setError((e as Error).message || 'Could not turn on notifications.'); }
    finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setError('');
    try {
      const registration = await navigator.serviceWorker.ready, subscription = await registration.pushManager.getSubscription();
      if (subscription) { setSettings(await api<Settings>('push/unsubscribe', { endpoint: subscription.endpoint })); await subscription.unsubscribe(); }
      setEndpoint(''); toast.success('Phone notifications are off for this device.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function sendTest() { setBusy(true); try { await api('push/test', {}); toast.success('Test sent. It should arrive on your phone in a few seconds.'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  async function removeDevice(id: string) { try { setSettings(await api<Settings>('push/unsubscribe', { id })); } catch (e) { toast.error((e as Error).message); } }
  async function toggle(type: string, on: boolean) {
    if (!settings) return;
    const muted = on ? settings.muted.filter(t => t !== type) : [...settings.muted, type];
    try { setSettings(await api<Settings>('push/mute', { muted })); } catch (e) { toast.error((e as Error).message); }
  }
  return <section className="ops-card ops-phone-notifications" aria-labelledby="phone-notifications-title">
    <div className="ops-pad">
      <h2 id="phone-notifications-title"><Smartphone size={18} />Phone notifications</h2>
      <p className="ops-phone-intro">Get an alert on your phone for new work, approvals and decisions. The lock screen shows the event and the client name only.</p>
      {error && <p className="ops-message amber" role="alert">{error}</p>}
      {settings && !settings.configured && <p className="ops-message amber" role="note">Phone notifications are not set up on this server yet.</p>}
      {support === 'checking' && <p role="status">Checking this device…</p>}
      {support === 'install' && <div className="ops-phone-steps"><b>On iPhone, add the app to your Home Screen first</b><ol>
        <li>In Safari, tap <Share size={15} aria-label="Share" /> <b>Share</b>.</li>
        <li>Tap <PlusSquare size={15} aria-hidden="true" /> <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open <b>RMC2</b> from the new Home Screen icon and sign in.</li>
        <li>Come back here and tap <b>Turn on</b>. Needs iOS 16.4 or newer.</li></ol></div>}
      {support === 'unsupported' && <p className="ops-message amber" role="note">This browser cannot receive notifications. On iPhone, use Safari and add the app to the Home Screen.</p>}
      {support === 'blocked' && <p className="ops-message amber" role="note">Notifications are blocked for this app. On iPhone: Settings → Notifications → RMC2 → Allow Notifications.</p>}
      {support === 'ok' && settings?.configured && <div className="ops-phone-toggle">
        {thisDeviceOn ? <><span className="ops-badge green"><BellRing size={13} />On for this device</span><button className="ops-btn" disabled={busy} onClick={() => void sendTest()}><BellRing size={15} />Send a test</button><button className="ops-btn" disabled={busy} onClick={() => void turnOff()}><BellOff size={15} />{busy ? 'Turning off…' : 'Turn off'}</button></>
          : <button className="ops-btn primary" disabled={busy} onClick={() => void turnOn()}><BellRing size={15} />{busy ? 'Turning on…' : 'Turn on for this device'}</button>}
      </div>}
      {settings && settings.configured && <fieldset className="ops-phone-types"><legend>Send me</legend>
        {settings.types.map(type => <label key={type} className="ops-check"><input type="checkbox" checked={!settings.muted.includes(type)} onChange={e => void toggle(type, e.target.checked)} />{settings.labels[type] || type}</label>)}
      </fieldset>}
      {!!settings?.devices.length && <div className="ops-phone-devices"><b>Your devices</b><ul>{settings.devices.map(device => <li key={device.id}><span>{device.label}<small>Added {when(device.createdAt)} · Last alert {when(device.lastUsedAt)}</small></span><button className="ops-btn" aria-label={'Remove ' + device.label} onClick={() => void removeDevice(device.id)}><Trash2 size={14} /></button></li>)}</ul></div>}
    </div>
  </section>;
}
