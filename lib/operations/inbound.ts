import { randomUUID, createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError, db, jsonParam, transaction } from './database';
import { deleteQuietly, files } from './file-store';
import { isSafeEmail } from './mail-config';
import { intake, intakeFields } from './service';
import { canReviewInbound } from './permissions';
import { ownerForEmail } from './owners';
import type { InquiryRecord, Staff } from './types';

// Inbound email (phase 7, lean). The test inbox is read READ-ONLY over IMAP with the same Gmail app password as
// sending: nothing is deleted, moved or marked as read. New messages are stored once (by Message-ID) with their
// Excel/PDF attachments in private storage. Agents email their forms in, so a message with a form attachment is
// imported AUTOMATICALLY through the normal intake (client checks, duplicate holds and notifications apply).
// Messages without a form, or whose form cannot be read, stay on the Requests page for staff.
// The inbox is checked every 30 seconds while anyone has the app open, plus the daily cron (production).
// Mail I/O always happens outside transactions (TEAM_DECISIONS file and data rules).

/** Inbox health, kept in the settings table: shown on Requests and used to slow down automatic retries. */
export type InboxHealth = { failures: number; lastError?: string; lastFailureAt?: string; lastOkAt?: string };
const HEALTH_KEY = 'inbound-health', STUCK_IMPORT_MS = 10 * 60 * 1000;
async function readHealth(): Promise<InboxHealth> {
  try { const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', HEALTH_KEY); return row ? JSON.parse(row.data) : { failures: 0 }; } catch { return { failures: 0 }; }
}
async function writeHealth(health: InboxHealth) {
  try { await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', HEALTH_KEY, JSON.stringify(health)); } catch { /* health is advisory */ }
}
/** After 3 failed checks in a row, automatic checks wait 5, 10, 20, then at most 60 minutes. "Check mail now" always tries. */
export function backoffMs(failures: number) { return failures < 3 ? 0 : Math.min(60, 5 * 2 ** (failures - 3)) * 60000; }
const looksLike = (ext: string, bytes: Buffer) => ext === 'pdf' ? bytes.subarray(0, 5).toString('latin1') === '%PDF-' : ext === 'xlsx' ? bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 : false;
/** Emails left "importing" by a request that stopped part-way go back to "new" after 10 minutes. */
async function releaseStuckImports() {
  const rows = await db.all<{ id: string; data: string }>("SELECT id,data FROM inbound_messages WHERE state='importing'");
  for (const row of rows) {
    const record = JSON.parse(row.data) as InboundMessage & { importingAt?: string };
    if (record.importingAt && Date.now() - Date.parse(record.importingAt) < STUCK_IMPORT_MS) continue;
    const rest = { ...record }; delete rest.importingAt;
    await db.run("UPDATE inbound_messages SET state='new',data=? WHERE id=? AND state='importing'", jsonParam({ ...rest, state: 'new' }), row.id);
  }
}
export type InboundAttachment = { name: string; type: string; size: number; key: string };
export type InboundMessage = {
  id: string; messageId: string; receivedAt: string; from: string; fromName: string; replyTo: string; subject: string;
  snippet: string; attachments: InboundAttachment[]; auth: { spf: string; dkim: string; dmarc: string; aligned?: boolean };
  state: 'new' | 'imported' | 'dismissed'; inquiryId?: string; handledBy?: string; handledAt?: string; importError?: string;
  /** When this app stored the email. `receivedAt` comes from the sender's Date header, so retention never relies on it alone. */
  storedAt?: string;
  /** Plain-text body (newer emails only), shown when staff create an inquiry from an email without a form. */
  text?: string;
};

/** Retention (PO 2026-11-11): the app's own copy of an email, with its stored attachments, is cleared 30 days after it was
 *  skipped, 60 days after it arrived if nobody handled it, and 90 days after it was imported. The inquiry keeps its own copy
 *  of the form, and the original stays in the mailbox (the app only reads it). A small row stays behind, so the same
 *  Message-ID is never stored again. Cleared rows are no longer listed on Requests. */
export const RETENTION_DAYS = { dismissed: 30, new: 60, imported: 90 } as const;
const RETENTION_EVERY_MS = 60 * 60 * 1000, RETENTION_BATCH = 500;
let lastRetention = 0;
/** The latest date the app knows for an email: a backdated Date header cannot make it expire early. */
const retentionAge = (record: InboundMessage) => Math.max(...[record.receivedAt, record.storedAt, record.handledAt].map(at => Date.parse(at || '')).filter(Number.isFinite));
export async function pruneInbound(now = Date.now()) {
  let cleared = 0;
  for (const [state, days] of Object.entries(RETENTION_DAYS)) {
    const limit = now - days * 86400000;
    // The age used is never earlier than received_at (indexed), so only rows with received_at before the limit can qualify.
    const rows = await db.all<{ id: string; data: string }>('SELECT id,data FROM inbound_messages WHERE state=? AND received_at<? ORDER BY received_at LIMIT ' + RETENTION_BATCH, state, new Date(limit).toISOString());
    for (const row of rows) {
      const record = JSON.parse(row.data) as InboundMessage;
      if (!(retentionAge(record) < limit)) continue;
      const kept = { id: record.id, messageId: record.messageId, receivedAt: record.receivedAt, state: 'cleared', clearedFrom: state, inquiryId: record.inquiryId, clearedAt: new Date(now).toISOString() };
      // Guarded on the state, so an email a colleague is importing or dismissing right now is left alone.
      const result = await db.run("UPDATE inbound_messages SET state='cleared',data=? WHERE id=? AND state=?", jsonParam(kept), row.id, state);
      if (!result.changes) continue;
      await deleteQuietly(...(record.attachments || []).map(a => a.key)); // after the row: a failed delete leaves an orphan, never a row pointing at nothing
      cleared++;
    }
  }
  return cleared;
}
/** Runs from the inbox check, at most once an hour per server. */
async function retentionDue() {
  if (Date.now() - lastRetention < RETENTION_EVERY_MS) return;
  lastRetention = Date.now();
  try { await pruneInbound(); } catch (error) { console.error('[inbound] retention failed:', (error as { code?: string })?.code || 'error'); }
}
/** The actor recorded in history for automatic imports. Not a sign-in account. */
const EMAIL_INTAKE: Staff = { id: 'email-intake', name: 'Email intake (automatic)', role: 'Employee', email: '', active: true, position: 'System', canApprove: false } as Staff;
const AUTO_CHECK_MS = 30 * 1000;
const MAILBOX = 'INBOX', FIRST_RUN_DAYS = 14, MAX_PER_CHECK = 25, MAX_ATTACHMENT = 7 * 1024 * 1024;
/** Larger emails are not downloaded (memory and time on a serverless function); they are listed for a person to open in the mailbox. */
const MAX_MESSAGE = 15 * 1024 * 1024, MAX_ATTACHMENTS = 5;
const FORM_TYPES: Record<string, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

function imapSettings() {
  const clean = (v?: string) => (v ?? '').trim();
  if (clean(process.env.RMC2_MAIL_MODE).toLowerCase() !== 'smtp') return undefined;
  const user = clean(process.env.RMC2_SMTP_USER), pass = clean(process.env.RMC2_SMTP_APP_PASSWORD).replace(/\s+/g, '');
  if (!user || !pass) return undefined;
  return { host: clean(process.env.RMC2_IMAP_HOST) || 'imap.gmail.com', port: Number(clean(process.env.RMC2_IMAP_PORT)) || 993, user, pass };
}
export const inboundConnected = () => !!imapSettings();
const requireStaff = (user: Staff) => { if (!canReviewInbound(user)) throw new AppError('Your role cannot review incoming email.', 403); };
/** The authserv-id of the inbox provider's own Authentication-Results header (Gmail: mx.google.com). */
const TRUSTED_AUTHSERV = (process.env.RMC2_IMAP_AUTHSERV_ID || 'mx.google.com').trim().toLowerCase();
/** Reads SPF, DKIM and DMARC from our provider's Authentication-Results header, one ";"-separated result at a time. Only a
 *  result at the START of a token counts, so sender-controlled text inside it (smtp.mailfrom=, header.i=) cannot fake a
 *  pass. `aligned` is true only for DMARC pass on the exact domain of the From address. */
export function readAuthResults(header: string, fromAddress: string) {
  const out = { spf: 'none', dkim: 'none', dmarc: 'none', aligned: false };
  let dmarcFrom = '';
  for (const token of header.split(';').slice(1).map(t => t.trim())) {
    const m = token.match(/^(spf|dkim|dmarc)=([a-z]+)/i);
    if (!m) continue;
    const method = m[1].toLowerCase() as 'spf' | 'dkim' | 'dmarc';
    if (out[method] !== 'none') continue; // the first result for each method
    out[method] = m[2].toLowerCase();
    if (method === 'dmarc') dmarcFrom = (token.match(/\bheader\.from=([^\s;()]+)/i)?.[1] || '').toLowerCase();
  }
  const domain = (fromAddress.split('@')[1] || '').toLowerCase();
  out.aligned = out.dmarc === 'pass' && !!domain && dmarcFrom === domain;
  return out;
}
/** Positive proof the From address is genuine: DMARC pass, aligned with the From domain. Older records lack `aligned` and so never qualify. */
export const senderVerified = (auth: InboundMessage['auth']) => auth.dmarc === 'pass' && auth.aligned === true;
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'attachment';

/** Reads new messages from the inbox (read-only) and stores them. Returns how many were added. */
/** Phone notifications for emails that wait on Requests (registered by the route). */
let inboxHook: ((waiting: number) => Promise<void> | void) | undefined;
export const setInboxHook = (hook: (waiting: number) => Promise<void> | void) => { inboxHook = hook; };
export async function checkInbox(): Promise<{ added: number; imported: number; checkedAt: string; connected: boolean }> {
  const settings = imapSettings(), checkedAt = new Date().toISOString();
  if (!settings) return { added: 0, imported: 0, checkedAt, connected: false };
  await releaseStuckImports().catch(() => { /* retried next check */ });
  await retentionDue();
  const cursor = await db.get<{ uidvalidity: string; last_uid: number }>('SELECT uidvalidity,last_uid FROM inbound_cursor WHERE mailbox=?', MAILBOX);
  const client = new ImapFlow({ host: settings.host, port: settings.port, secure: true, auth: { user: settings.user, pass: settings.pass }, logger: false });
  const fetched: { uid: number; source: Buffer }[] = [], oversize: { uid: number; size: number; subject: string; from: string; messageId: string }[] = [];
  let uidValidity = '';
  try {
    await client.connect();
    const box = await client.mailboxOpen(MAILBOX, { readOnly: true });
    uidValidity = String(box.uidValidity);
    const fresh = !cursor || cursor.uidvalidity !== uidValidity;
    const range = fresh ? await client.search({ since: new Date(Date.now() - FIRST_RUN_DAYS * 86400000) }, { uid: true }) : await client.search({ uid: (Number(cursor.last_uid) + 1) + ':*' }, { uid: true });
    // Oldest first: the cursor only moves past what was read, so a burst of more than MAX_PER_CHECK is read over the next checks.
    const uids = (Array.isArray(range) ? range : []).filter(uid => fresh || uid > Number(cursor!.last_uid)).sort((a, b) => a - b).slice(0, MAX_PER_CHECK);
    const small: number[] = [];
    if (uids.length) for await (const message of client.fetch(uids.join(','), { uid: true, size: true, envelope: true }, { uid: true })) {
      if ((message.size || 0) > MAX_MESSAGE) oversize.push({ uid: message.uid, size: message.size || 0, subject: message.envelope?.subject || '', from: message.envelope?.from?.[0]?.address || '', messageId: message.envelope?.messageId || '' });
      else small.push(message.uid);
    }
    if (small.length) for await (const message of client.fetch(small.join(','), { uid: true, source: true }, { uid: true })) if (message.source) fetched.push({ uid: message.uid, source: message.source });
  } catch (error) {
    console.error('[inbound] mailbox check failed:', (error as { code?: string })?.code || (error instanceof Error ? error.name : 'error'));
    const e = error as { authenticationFailed?: boolean; code?: string; serverResponseCode?: string };
    const auth = e?.authenticationFailed || e?.serverResponseCode === 'AUTHENTICATIONFAILED' || e?.code === 'AUTHENTICATIONFAILED';
    const reason = auth ? 'The inbox refused the sign-in. The app password may have been revoked or changed.' : 'The inbox could not be reached.';
    const health = await readHealth();
    await writeHealth({ ...health, failures: (health.failures || 0) + 1, lastError: reason, lastFailureAt: new Date().toISOString() });
    throw new AppError(reason + ' Try again shortly.', 503);
  } finally { await client.logout().catch(() => client.close()); }

  let added = 0, imported = 0, lastUid = cursor && cursor.uidvalidity === uidValidity ? Number(cursor.last_uid) : 0;
  /** An email that cannot be read or stored is listed as skipped with the reason, so it never blocks the emails after it. */
  const skipped = async (uid: number, messageId: string, info: { subject?: string; from?: string }, reason: string) => {
    const id = randomUUID(), record: InboundMessage = { id, messageId: (messageId || 'uid-' + uidValidity + '-' + uid).slice(0, 300), receivedAt: new Date().toISOString(), from: (info.from || '').toLowerCase(), fromName: '', replyTo: '', subject: (info.subject || '(no subject)').slice(0, 300), snippet: '', attachments: [], auth: { spf: 'none', dkim: 'none', dmarc: 'none', aligned: false }, state: 'dismissed', handledBy: 'email-filter', handledAt: new Date().toISOString(), importError: reason, storedAt: new Date().toISOString() };
    const result = await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?) ON CONFLICT (message_id) DO NOTHING', id, record.messageId, record.receivedAt, record.state, jsonParam(record));
    if (result.changes) added++;
  };
  const work: ({ uid: number; item: { uid: number; source: Buffer } } | { uid: number; big: { uid: number; size: number; subject: string; from: string; messageId: string } })[] = [...fetched.map(item => ({ uid: item.uid, item })), ...oversize.map(big => ({ uid: big.uid, big }))].sort((a, b) => a.uid - b.uid);
  try {
  for (const entry of work) {
    if ('big' in entry) {
      await skipped(entry.uid, entry.big.messageId, entry.big, 'This email is ' + Math.round(entry.big.size / 1048576) + ' MB, too large to read here. Open it in the mailbox.');
      lastUid = Math.max(lastUid, entry.uid); continue;
    }
    const item = entry.item;
    try {
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
        if (!FORM_TYPES[ext] || part.size > MAX_ATTACHMENT || attachments.length >= MAX_ATTACHMENTS || !looksLike(ext, part.content)) continue; // the name says Excel/PDF and so must the bytes
        const key = `inbound/${id}/${index}-${safeName(part.filename || 'form.' + ext)}`;
        await files().put(key, part.content, { contentType: FORM_TYPES[ext], mode: 'replace' });
        attachments.push({ name: part.filename || 'form.' + ext, type: ext, size: part.size, key });
      }
      const from = parsed.from?.value?.[0], replyTo = parsed.replyTo?.value?.[0]?.address || '';
      // Trust only the results our own mailbox provider wrote. It adds its Authentication-Results header on top; a sender
      // can add forged ones below it, so take the topmost header from the trusted authserv-id and ignore the rest.
      const authHeader = (parsed.headerLines || []).filter(line => line.key === 'authentication-results')
        .map(line => line.line.replace(/^[^:]*:\s*/, '').replace(/\s+/g, ' ').trim())
        .find(value => value.toLowerCase().startsWith(TRUSTED_AUTHSERV + ';')) || '';
      const record: InboundMessage = {
        id, messageId, receivedAt: (parsed.date ?? new Date()).toISOString(), from: (from?.address || '').toLowerCase(), fromName: from?.name || '',
        replyTo: replyTo.toLowerCase(), subject: (parsed.subject || '(no subject)').slice(0, 300), snippet: (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        // The body as plain text (line breaks kept, at most 5,000 characters) so staff can type an inquiry from an email that
        // has the details in it instead of a form ("Create inquiry from this email"). Retention clears it with the rest.
        text: (parsed.text || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000),
        attachments, auth: readAuthResults(authHeader, (from?.address || '').toLowerCase()), state: 'new', storedAt: new Date().toISOString(),
      };
      // Newsletters and notifications (no-reply senders, mailing lists, bulk mail) with no form attached are never agent
      // requests: they are recorded as skipped (still listed under All) instead of waiting in "To review".
      if (!attachments.length && automatedEmail(record.from, parsed.headers)) Object.assign(record, { state: 'dismissed', handledBy: 'email-filter', handledAt: new Date().toISOString() });
      try {
        const result = await db.run('INSERT INTO inbound_messages (id,message_id,received_at,state,data) VALUES (?,?,?,?,?) ON CONFLICT (message_id) DO NOTHING', id, messageId, record.receivedAt, record.state, jsonParam(record));
        if (result.changes) added++; else { await deleteQuietly(...attachments.map(a => a.key)); continue; } // a parallel check stored it first
      } catch (error) { await deleteQuietly(...attachments.map(a => a.key)); throw error; }
      // Agents email their forms in: an Excel franchise form is imported straight away (the form reader rejects other
      // workbooks). PDFs could be anything (invoices, letters), so they wait on the Requests page for a person.
      const formIndex = attachments.findIndex(a => a.type === 'xlsx');
      if (formIndex >= 0) {
        try { await importInbound(EMAIL_INTAKE, id, formIndex, true); imported++; }
        catch (error) {
          const reason = error instanceof AppError && error.status < 500 ? error.message : 'The form could not be imported automatically.';
          await db.run('UPDATE inbound_messages SET data=? WHERE id=?', jsonParam({ ...record, importError: reason }), id);
        }
      }
    }
    } catch (error) {
      console.error('[inbound] message skipped:', (error as { code?: string })?.code || (error instanceof Error ? error.name : 'error'));
      await skipped(item.uid, '', {}, 'This email could not be read. Open it in the mailbox.'); // if even this fails, the finally below keeps the cursor before it
    }
    lastUid = Math.max(lastUid, item.uid);
  }
  } finally {
    // Saved even when a database error stops the loop, so the emails already handled are not read again.
  await db.run('INSERT INTO inbound_cursor (mailbox,uidvalidity,last_uid,checked_at) VALUES (?,?,?,?) ON CONFLICT (mailbox) DO UPDATE SET uidvalidity=excluded.uidvalidity,last_uid=excluded.last_uid,checked_at=excluded.checked_at', MAILBOX, uidValidity, lastUid, checkedAt);
  }
  await writeHealth({ failures: 0, lastOkAt: checkedAt });
  if (added > imported) { try { await inboxHook?.(added - imported); } catch { /* phone notifications never fail a check */ } }
  return { added, imported, checkedAt, connected: true };
}

/** Called from the workspace poll: claims the shared slot, so at most one inbox check runs every 30 seconds across
 * all users and instances. Returns true when this request won the slot; the caller then runs `runClaimedInboxCheck`
 * after the response and tells the client to refresh shortly, so the import appears without waiting for the next poll. */
export async function claimInboxCheck(): Promise<boolean> {
  if (!imapSettings()) return false;
  try {
    const now = Date.now(), due = new Date(now - AUTO_CHECK_MS).toISOString(), at = new Date(now).toISOString();
    // Most polls find the slot still fresh: a read, no write, on the response path.
    const cursor = await db.get<{ checked_at: string }>('SELECT checked_at FROM inbound_cursor WHERE mailbox=?', MAILBOX);
    if (cursor && cursor.checked_at >= due) return false;
    const health = await readHealth(), wait = backoffMs(health.failures || 0);
    if (wait && health.lastFailureAt && now - Date.parse(health.lastFailureAt) < wait) return false; // the inbox keeps failing: retry less often
    // Claim the slot atomically: only the request that moves checked_at forward runs the check.
    if (!cursor) await db.run("INSERT INTO inbound_cursor (mailbox,uidvalidity,last_uid,checked_at) VALUES (?,'',0,?) ON CONFLICT (mailbox) DO NOTHING", MAILBOX, new Date(0).toISOString());
    const claimed = await db.run('UPDATE inbound_cursor SET checked_at=? WHERE mailbox=? AND checked_at<?', at, MAILBOX, due);
    return !!claimed.changes;
  } catch (error) {
    console.error('[inbound] slot claim failed:', (error as { code?: string })?.code || 'error');
    return false;
  }
}
export async function runClaimedInboxCheck(): Promise<void> {
  try { await checkInbox(); } catch { /* logged in checkInbox; the next slot retries */ }
}

export async function listInbound(user: Staff) {
  requireStaff(user);
  const rows = await db.all<{ data: string }>("SELECT data FROM inbound_messages WHERE state<>'cleared' ORDER BY received_at DESC LIMIT 200");
  const cursor = await db.get<{ checked_at: string }>('SELECT checked_at FROM inbound_cursor WHERE mailbox=?', MAILBOX);
  return { messages: rows.map(r => JSON.parse(r.data) as InboundMessage), checkedAt: cursor?.checked_at || '', connected: inboundConnected(), health: await readHealth() };
}

async function claim(id: string, from: string, to: string) {
  return transaction(async () => {
    const row = await db.get<{ data: string; state: string }>('SELECT data,state FROM inbound_messages WHERE id=?' + (db.dialect === 'postgres' ? ' FOR UPDATE' : ''), id);
    if (!row) throw new AppError('This email no longer exists.', 404);
    if (row.state !== from) throw new AppError('A colleague already handled this email. Refresh the list.', 409);
    const record = JSON.parse(row.data) as InboundMessage;
    if (to === 'importing') await db.run('UPDATE inbound_messages SET state=?,data=? WHERE id=?', to, jsonParam({ ...record, importingAt: new Date().toISOString() }), id);
    else await db.run('UPDATE inbound_messages SET state=? WHERE id=?', to, id);
    return record;
  });
}
async function finish(id: string, record: InboundMessage) {
  await db.run('UPDATE inbound_messages SET state=?,data=? WHERE id=?', record.state, jsonParam(record), id);
}

/** Creates an inquiry from one form attachment through the normal intake (client checks apply). */
const AUTOMATED_SENDER = /^(?:no-?reply|do-?not-?reply|notifications?|newsletters?|news|marketing|updates|mailer-daemon|bounces?)(?:[+._-]|@)/i;
/** A machine-sent email: a no-reply style sender, a mailing list (List-Unsubscribe / List-Id) or bulk precedence. */
export function automatedEmail(from: string, headers: Map<string, unknown>) {
  const precedence = String(headers.get('precedence') ?? '').toLowerCase();
  return AUTOMATED_SENDER.test(from) || headers.has('list-unsubscribe') || headers.has('list-id') || ['bulk', 'list', 'junk'].includes(precedence);
}
export async function importInbound(user: Staff, id: string, index: number, automatic = false, ownerOverride?: string | null): Promise<InquiryRecord> {
  if (!automatic) requireStaff(user);
  const record = await claim(id, 'new', 'importing');
  try {
    const attachment = record.attachments[index];
    if (!attachment) throw new AppError('Choose one of the form attachments.', 400);
    const bytes = await files().get(attachment.key);
    // A sender that is an active Division Head / SOA account links the inquiry to them, but only on positive proof the
    // mail really came from that address (DMARC pass aligned with the From domain, from our provider's own header) and only when
    // replies would go back to that same address. Anything else imports unlinked for staff to link by hand.
    const verified = senderVerified(record.auth);
    const sameReply = !record.replyTo || record.replyTo.trim().toLowerCase() === record.from.trim().toLowerCase();
    const autoOwner = ownerOverride === undefined && verified && sameReply ? await ownerForEmail(record.from) : undefined;
    const ownerId = ownerOverride !== undefined ? ownerOverride : autoOwner?.id ?? null;
    // When linked, replies go to the owner's account address, never to a header the sender chose.
    const sender = autoOwner ? autoOwner.email : [record.replyTo, record.from].find(address => isSafeEmail(address)) || '';
    const inquiry = await intake(user, new File([new Uint8Array(bytes)], attachment.name, { type: FORM_TYPES[attachment.type] }), sender, { ownerId, origin: 'email', fromAddress: record.from });
    await finish(id, { ...record, state: 'imported', inquiryId: inquiry.id, handledBy: user.id, handledAt: new Date().toISOString(), importError: undefined });
    return inquiry;
  } catch (error) {
    await db.run("UPDATE inbound_messages SET state='new' WHERE id=? AND state='importing'", id);
    throw error;
  }
}

/** "Create inquiry from this email": staff type the details from an email that has no usable form (details in the body,
 *  a scan, a letter). The same checks as the fill-in form apply (intakeFields: duplicates, divisions, notifications), the
 *  inquiry is marked as having come by email, and the email is marked imported so nobody handles it twice. The agent
 *  email is whatever staff confirm in the form; Requests pre-fills the From address, not a Reply-To the sender chose. */
export async function createFromInbound(user: Staff, id: string, input: unknown): Promise<InquiryRecord> {
  requireStaff(user);
  const record = await claim(id, 'new', 'importing');
  try {
    const inquiry = await intakeFields(user, input, { fromAddress: record.from });
    await finish(id, { ...record, state: 'imported', inquiryId: inquiry.id, handledBy: user.id, handledAt: new Date().toISOString(), importError: undefined });
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
