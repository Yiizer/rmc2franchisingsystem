import { createHash } from 'node:crypto';
import { after } from 'next/server';
import webpush from 'web-push';
import { z } from 'zod';
import { AppError, db } from './database';
import { isOwnerScoped } from './permissions';
import type { Staff } from './types';
import { pushHostAllowed } from './push-hosts';

// Phone notifications (Web Push, iPhone first: the app must be added to the Home Screen on iOS 16.4+).
// Keys are our own VAPID pair from env (no third-party service). The lock screen shows the event and the client name only,
// never amounts, contacts or attachments. Sending is fire-and-forget after the response: a slow push never blocks a request.
export const PUSH_TYPES = ['inquiry', 'approval', 'decision', 'protection', 'handover'] as const;
export type PushType = typeof PUSH_TYPES[number];
export const PUSH_TYPE_LABELS: Record<PushType, string> = {
  inquiry: 'New inquiries and emails', approval: 'Waiting for approval', decision: 'Decisions on your work',
  protection: 'Protection reminders', handover: 'Handover requests and take-overs',
};

const clean = (v?: string) => (v ?? '').trim();
function keys() {
  const publicKey = clean(process.env.RMC2_VAPID_PUBLIC_KEY), privateKey = clean(process.env.RMC2_VAPID_PRIVATE_KEY);
  const subject = clean(process.env.RMC2_VAPID_SUBJECT) || 'mailto:franchising@rmc2.local';
  return publicKey && privateKey ? { publicKey, privateKey, subject } : undefined;
}
export const pushConfigured = () => !!keys();

/** Which notifications go to phones, by their in-app title. Anything not listed stays in-app only. */
export function pushTypeForTitle(title: string): PushType | null {
  if (/^(New inquir|Duplicate import received|Client details needed|Duplicate client|New email)/.test(title)) return 'inquiry';
  if (/awaiting approval/i.test(title)) return 'approval';
  if (/^(Progress report (approved|rejected)|Proposal approved|Proposal needs correction|Request declined|Approved reply sent|Approved email|Agent change rejected)/.test(title)) return 'decision';
  if (/^(Protection ending soon|Client linked to you)/.test(title)) return 'protection';
  if (/^(Handover requested|Inquiry taken over|Inquiry assigned to you|Still being handled)/.test(title)) return 'handover';
  return null;
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).refine(pushHostAllowed, 'Use the browser’s own push service.'),
  keys: z.object({ p256dh: z.string().min(20).max(400), auth: z.string().min(8).max(200) }),
  label: z.string().trim().max(80).optional(),
}).passthrough();
const idFor = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
const prefsKey = (user: Pick<Staff, 'id'>) => 'push:' + user.id;

export async function pushSettings(user: Staff) {
  const devices = await db.all<{ id: string; label: string; created_at: string; last_used_at: string }>('SELECT id,label,created_at,last_used_at FROM push_subscriptions WHERE user_id=? ORDER BY created_at', user.id);
  return { configured: pushConfigured(), publicKey: keys()?.publicKey || '', muted: await mutedFor(user.id), types: PUSH_TYPES.filter(type => isOwnerScoped(user) ? ['decision', 'protection'].includes(type) : type !== 'protection'), labels: PUSH_TYPE_LABELS, devices: devices.map(d => ({ id: d.id, label: d.label, createdAt: d.created_at, lastUsedAt: d.last_used_at })) };
}
export async function savePushSubscription(user: Staff, input: unknown) {
  if (!pushConfigured()) throw new AppError('Phone notifications are not set up on this server.', 503);
  const body = subscriptionSchema.parse(input), now = new Date().toISOString(), id = idFor(body.endpoint);
  // One phone = one row. Signing in as someone else on the same phone moves the subscription to that account.
  await db.run('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,label,created_at,last_used_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,label=excluded.label',
    id, user.id, body.endpoint, body.keys.p256dh, body.keys.auth, body.label || 'This phone', now, '');
  return await pushSettings(user);
}
export async function removePushSubscription(user: Staff, input: unknown) {
  const body = z.object({ endpoint: z.string().max(2000).optional(), id: z.string().max(80).optional() }).strict().parse(input);
  const id = body.id || (body.endpoint ? idFor(body.endpoint) : '');
  if (id) await db.run('DELETE FROM push_subscriptions WHERE id=? AND user_id=?', id, user.id);
  return await pushSettings(user);
}
export async function setPushMuted(user: Staff, input: unknown) {
  const body = z.object({ muted: z.array(z.enum(PUSH_TYPES)).max(PUSH_TYPES.length) }).strict().parse(input);
  await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', prefsKey(user), JSON.stringify({ muted: [...new Set(body.muted)] }));
  return await pushSettings(user);
}
async function mutedFor(userId: string): Promise<PushType[]> {
  const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', prefsKey({ id: userId }));
  try { return row ? (JSON.parse(row.data).muted || []) : []; } catch { return []; }
}

export type PushMessage = { title: string; body: string; url: string; type: PushType; tag?: string };
/** Sends to every phone of these users that has not muted the type. Dead subscriptions (404/410) are removed. */
export async function sendPush(userIds: string[], message: PushMessage): Promise<{ sent: number; removed: number }> {
  const config = keys(); if (!config || !userIds.length) return { sent: 0, removed: 0 };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  let sent = 0, removed = 0;
  for (const userId of [...new Set(userIds)]) {
    if (message.tag !== 'test' && (await mutedFor(userId)).includes(message.type)) continue;
    const subs = await db.all<{ id: string; endpoint: string; p256dh: string; auth: string }>('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?', userId);
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag }), { TTL: 6 * 3600, urgency: 'high' });
        sent++; await db.run('UPDATE push_subscriptions SET last_used_at=? WHERE id=?', new Date().toISOString(), sub.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) { removed++; await db.run('DELETE FROM push_subscriptions WHERE id=?', sub.id); }
        else console.error('[push] send failed:', status || (error as Error).name);
      }
    }
  }
  return { sent, removed };
}

/** A test alert to the signed-in person's own phones (the "Send a test" button). */
export async function sendTestPush(user: Staff) {
  if (!pushConfigured()) throw new AppError('Phone notifications are not set up on this server.', 503);
  const result = await sendPush([user.id], { title: 'Test notification', body: 'RMC2 phone notifications are working.', url: isOwnerScoped(user) ? '/#my-clients' : '/#notifications', type: 'decision', tag: 'test' });
  if (!result.sent) throw new AppError('No phone received it. Turn on notifications on this device first.', 409);
  return result;
}
/** Queues phone notifications for a saved in-app notice: after the response when inside a request, otherwise right away. */
export function queuePushForNotice(notice: { title: string; inquiryId: string; recipientIds: string[] }, clientName: string, ownerIds: Set<string>) {
  const type = pushTypeForTitle(notice.title); if (!type || !pushConfigured()) return;
  const client = clientName.trim() || 'a client';
  const owners = notice.recipientIds.filter(id => ownerIds.has(id)), staff = notice.recipientIds.filter(id => !ownerIds.has(id));
  const run = async () => {
    try {
      // Lock screen: the event and the client name only.
      if (staff.length) await sendPush(staff, { title: notice.title, body: client, url: '/#notifications', type, tag: notice.inquiryId });
      if (owners.length) await sendPush(owners, { title: notice.title, body: client, url: '/#my-clients/' + encodeURIComponent(notice.inquiryId), type, tag: notice.inquiryId });
    } catch (error) { console.error('[push] queue failed:', (error as Error).name); }
  };
  try { after(run); } catch { void run(); }
}
