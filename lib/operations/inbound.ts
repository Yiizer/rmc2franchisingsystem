import { randomUUID, createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError, db, jsonParam, transaction } from './database';
import { deleteQuietly, files } from './file-store';
import { isSafeEmail } from './mail-config';
import { intake } from './service';
import { canPrepareProposal } from './types';
import type { InquiryRecord, Staff } from './types';

// Inbound email (phase 7, lean). The test inbox is read READ-ONLY over IMAP with the same Gmail app password as
// sending: nothing is deleted, moved or marked as read. New messages are stored once (by Message-ID) with their
// Excel/PDF attachments in private storage, and wait on the Requests page. Nothing becomes an inquiry
// automatically: staff import a form attachment (the normal intake, so client checks apply) or dismiss it.
// Mail I/O always happens outside transactions (TEAM_DECISIONS file and data rules).

export type InboundAttachment = { name: string; type: string; size: number; key: string };
export type InboundMessage = {
  id: string; messageId: string; receivedAt: string; from: string; fromName: string; replyTo: string; subject: string;
  snippet: string; attachments: InboundAttachment[]; auth: { spf: string; dkim: string; dmarc: string };
  state: 'new' | 'imported' | 'dismissed'; inquiryId?: string; handledBy?: string; handledAt?: string;
};
const MAILBOX = 'INBOX', FIRST_RUN_DAYS = 14, MAX_PER_CHECK = 25, MAX_ATTACHMENT = 7 * 1024 * 1024;
const FORM_TYPES: Record<string, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

function imapSettings() {
  const clean = (v?: string) => (v ?? '').trim();
  if (clean(process.env.RMC2_MAIL_MODE).toLowerCase() !== 'smtp') return undefined;
  const user = clean(process.env.RMC2_SMTP_USER), pass = clean(process.env.RMC2_SMTP_APP_PASSWORD).replace(/\s+/g, '');
  if (!user || !pass) return undefined;
  return { host: clean(process.env.RMC2_IMAP_HOST) || 'imap.gmail.com', port: Number(clean(process.env.RMC2_IMAP_PORT)) || 993, user, pass };
}
export const inboundConnected = () => !!imapSettings();
const requireStaff = (user: Staff) => { if (!canPrepareProposal(user) && user.role !== 'Admin') throw new AppError('Your role cannot review incoming email.', 403); };
const authResult = (header: string, name: string) => (header.match(new RegExp('\\b' + name + '=(\\w+)', 'i'))?.[1] || 'none').toLowerCase();
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'attachment';

/** Reads new messages from the inbox (read-only) and stores them. Returns how many were added. */
export async function checkInbox(): Promise<{ added: number; checkedAt: string; connected: boolean }> {
  const settings = imapSettings(), checkedAt = new Date().toISOString();
  if (!settings) return { added: 0, checkedAt, connected: false };
  const cursor = await db.get<{ uidvalidity: string; last_uid: number }>('SELECT uidvalidity,last_uid FROM inbound_cursor WHERE mailbox=?', MAILBOX);
  const client = new ImapFlow({ host: settings.host, port: settings.port, secure: true, auth: { user: settings.user, pass: settings.pass }, logger: false });
  const fetched: { uid: number; source: Buffer }[] = [];
  let uidValidity = '';
  try {
    await client.connect();
    const box = await client.mailboxOpen(MAILBOX, { readOnly: true });
    uidValidity = String(box.uidValidity);
    const fresh = !cursor || cursor.uidvalidity !== uidValidity;
    const range = fresh ? await client.search({ since: new Date(Date.now() - FIRST_RUN_DAYS * 86400000) }, { uid: true }) : await client.search({ uid: (Number(cursor.last_uid) + 1) + ':*' }, { uid: true });
    const uids = (Array.isArray(range) ? range : []).filter(uid => fresh || uid > Number(cursor!.last_uid)).sort((a, b) => a - b).slice(-MAX_PER_CHECK);
    if (uids.length) for await (const message of client.fetch(uids.join(','), { uid: true, source: true }, { uid: true })) if (message.source) fetched.push({ uid: message.uid, source: message.source });
  } catch (error) {
    console.error('[inbound] mailbox check failed:', (error as { code?: string })?.code || (error instanceof Error ? error.name : 'error'));
    throw new AppError('The test inbox could not be checked right now. Try again shortly.', 503);
  } finally { await client.logout().catch(() => client.close()); }

  let added = 0, lastUid = cursor && cursor.uidvalidity === uidValidity ? Number(cursor.last_uid) : 0;
  for (const item of fetched.sort((a, b) => a.uid - b.uid)) {
    const parsed = await simpleParser(item.source);
    const messageId = (parsed.messageId || 'uid-' + uidValidity + '-' + item.uid).slice(0, 300);
    const exists = await db.get('SELECT id FROM inbound_messages WHERE message_id=?', messageId);
    // Test mode redirects this system's own replies into the same inbox; those are not requests.
    const ownSender = (process.env.RMC2_MAIL_FROM_ADDRESS || process.env.RMC2_SMTP_USER || '').trim().toLowerCase();
    const ownReply = !!ownSender && (parsed.from?.value?.[0]?.address || '').toLowerCase() === ownSender && /^\[TEST\b/.test(parsed.subject || '');
    if (!exists && !ownReply) {
      const id = randomUUID(), attachments: InboundAttachment[] = [];
      for (const [index, part] of parsed.attachments.entries()) {
        const ext = (part.filename || '').toLowerCase().split('.').pop() || '';
        if (!FORM_TYPES[ext] || part.size > MAX_ATTACHMENT) continue;
        const key = `inbound/${id}/${index}-${safeName(part.filename || 'form.' + ext)}`;
        await files().put(key, part.content, { contentType: FORM_TYPES[ext], mode: 'replace' });
        attachments.push({ name: part.filename || 'form.' + ext, type: ext, size: part.size, key });
      }
      const from = parsed.from?.value?.[0], replyTo = parsed.replyTo?.value?.[0]?.address || '';
      const authHeader = String(parsed.headers.get('authentication-results') ?? '');
      const record: InboundMessage = {
        id, messageId, receivedAt: (parsed.date ?? new Date()).toISOString(), from: (from?.address || '').toLowerCase(), fromName: from?.name || '',
        replyTo: replyTo.toLowerCase(), subject: (parsed.subject || '(no subject)').slice(0, 300), snippet: (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        attachments, auth: { spf: authResult(authHeader, 'spf'), dkim: authResult(authHeader, 'dkim'), dmarc: authResult(authHeader, 'dmarc') }, state: 'new',
      };
      try {
        const result = await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?) ON CONFLICT (message_id) DO NOTHING', id, messageId, record.receivedAt, 'new', jsonParam(record));
        if (result.changes) added++; else await deleteQuietly(...attachments.map(a => a.key)); // a parallel check stored it first
      } catch (error) { await deleteQuietly(...attachments.map(a => a.key)); throw error; }
    }
    lastUid = Math.max(lastUid, item.uid);
  }
  await db.run('INSERT INTO inbound_cursor (mailbox,uidvalidity,last_uid,checked_at) VALUES (?,?,?,?) ON CONFLICT (mailbox) DO UPDATE SET uidvalidity=excluded.uidvalidity,last_uid=excluded.last_uid,checked_at=excluded.checked_at', MAILBOX, uidValidity, lastUid, checkedAt);
  return { added, checkedAt, connected: true };
}

export async function listInbound(user: Staff) {
  requireStaff(user);
  const rows = await db.all<{ data: string }>('SELECT data FROM inbound_messages ORDER BY received_at DESC LIMIT 200');
  const cursor = await db.get<{ checked_at: string }>('SELECT checked_at FROM inbound_cursor WHERE mailbox=?', MAILBOX);
  return { messages: rows.map(r => JSON.parse(r.data) as InboundMessage), checkedAt: cursor?.checked_at || '', connected: inboundConnected() };
}

async function claim(id: string, from: string, to: string) {
  return transaction(async () => {
    const row = await db.get<{ data: string; state: string }>('SELECT data,state FROM inbound_messages WHERE id=?' + (db.dialect === 'postgres' ? ' FOR UPDATE' : ''), id);
    if (!row) throw new AppError('This email no longer exists.', 404);
    if (row.state !== from) throw new AppError('A colleague already handled this email. Refresh the list.', 409);
    await db.run('UPDATE inbound_messages SET state=? WHERE id=?', to, id);
    return JSON.parse(row.data) as InboundMessage;
  });
}
async function finish(id: string, record: InboundMessage) {
  await db.run('UPDATE inbound_messages SET state=?,data=? WHERE id=?', record.state, jsonParam(record), id);
}

/** Creates an inquiry from one form attachment through the normal intake (client checks apply). */
export async function importInbound(user: Staff, id: string, index: number): Promise<InquiryRecord> {
  requireStaff(user);
  const record = await claim(id, 'new', 'importing');
  try {
    const attachment = record.attachments[index];
    if (!attachment) throw new AppError('Choose one of the form attachments.', 400);
    const bytes = await files().get(attachment.key);
    const sender = [record.replyTo, record.from].find(address => isSafeEmail(address)) || '';
    const inquiry = await intake(user, new File([new Uint8Array(bytes)], attachment.name, { type: FORM_TYPES[attachment.type] }), sender);
    await finish(id, { ...record, state: 'imported', inquiryId: inquiry.id, handledBy: user.id, handledAt: new Date().toISOString() });
    return inquiry;
  } catch (error) {
    await db.run("UPDATE inbound_messages SET state='new' WHERE id=? AND state='importing'", id);
    throw error;
  }
}

export async function dismissInbound(user: Staff, id: string) {
  requireStaff(user);
  const record = await claim(id, 'new', 'dismissed');
  await finish(id, { ...record, state: 'dismissed', handledBy: user.id, handledAt: new Date().toISOString() });
}

export async function inboundAttachment(user: Staff, id: string, index: number) {
  requireStaff(user);
  const row = await db.get<{ data: string }>('SELECT data FROM inbound_messages WHERE id=?', id);
  const attachment = row ? (JSON.parse(row.data) as InboundMessage).attachments[index] : undefined;
  if (!attachment) throw new AppError('This attachment no longer exists.', 404);
  return { bytes: await files().get(attachment.key), name: attachment.name, type: FORM_TYPES[attachment.type] };
}

/** Constant-time check for the scheduled job (Vercel Cron sends Authorization: Bearer <CRON_SECRET>). */
export function cronAllowed(header: string | null) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 16 || !header) return false;
  const a = createHash('sha256').update(header).digest(), b = createHash('sha256').update('Bearer ' + secret).digest();
  return a.equals(b);
}
