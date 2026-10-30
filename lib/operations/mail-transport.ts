// Server-side only. Builds, validates and sends outbound mail. Nothing here logs, stores or returns credentials.
import { createTransport } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { isSafeEmail, mailConfig, normalizeEmail } from './mail-config';
import type { MailConfig } from './mail-config';

export type MailKind = 'reply' | 'details';
export type OutboundAttachment = { filename: string; content: Buffer; contentType: string };
export type OutboundMail = { messageId: string; to: string; subject: string; body: string; attachments: OutboundAttachment[]; kind: MailKind };
export type DeliveryMode = 'local-test' | 'smtp-redirected' | 'smtp-live';
export type SendResult = { at: string; providerId?: string; mode: DeliveryMode; dryRun: boolean; /** The message exactly as sent (redirected form). */ eml: Buffer };
export type MailErrorCode = 'AUTH' | 'RECIPIENT_REFUSED' | 'TIMEOUT' | 'ATTACHMENT_TOO_LARGE' | 'GUARD_REFUSED' | 'RATE_LIMITED' | 'NETWORK' | 'SIMULATED' | 'UNKNOWN';
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const SEND_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, overall: 45_000 };

export const MAIL_REASONS: Record<MailErrorCode, string> = {
  AUTH: 'The mail account rejected the sign-in. Ask the administrator to check the mail credentials.',
  RECIPIENT_REFUSED: 'The mail server refused the recipient address.',
  TIMEOUT: 'The mail server did not answer in time.',
  ATTACHMENT_TOO_LARGE: 'The attachment is larger than the 15 MB limit.',
  GUARD_REFUSED: 'The safety checks refused this message. Nothing was sent.',
  RATE_LIMITED: 'The sending limit was reached (5 per hour, 20 per day). Try again later.',
  NETWORK: 'Could not reach the mail server. Nothing was sent.',
  SIMULATED: 'Local delivery failure requested for testing. The approved package is preserved.',
  UNKNOWN: 'The email could not be sent because of an unexpected error. Check the server log.',
};
export class MailSendError extends Error {
  constructor(public code: MailErrorCode, public safeReason: string = MAIL_REASONS[code], public retryable = false, public uncertain = false) { super(safeReason); this.name = 'MailSendError'; }
}

/** Strip anything that could break out of a header line. */
export const headerSafe = (value: string) => value.replace(/[\r\n\u2028\u2029\0]/g, ' ').replace(/\s+/g, ' ').trim();
export const bodySafe = (value: string) => value.replace(/\0/g, '').replace(/[\u2028\u2029]/g, '\n').replace(/\r\n?/g, '\n');
export function safeFilename(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').replace(/_{2,}/g, '_').slice(0, 100);
  return cleaned || 'attachment.pdf';
}
const safeContentType = (type: string) => (/^[a-z]+\/[a-z0-9.+-]+$/.test(type) ? type : 'application/octet-stream');
const safeId = (id: string) => { if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new MailSendError('GUARD_REFUSED'); return id; };

/** Final gate: every envelope address must be an ASCII exact address, and outside production an exact allowlist member. */
export function assertEnvelope(config: MailConfig, addresses: string[]) {
  if (!addresses.length || addresses.length > 3) throw new MailSendError('GUARD_REFUSED');
  for (const address of addresses) {
    if (!isSafeEmail(address)) throw new MailSendError('GUARD_REFUSED');
    if (config.env !== 'production' && !config.allowlist.includes(normalizeEmail(address))) throw new MailSendError('GUARD_REFUSED');
  }
}
export function recipientsFor(config: MailConfig, original: string): string[] {
  if (config.env === 'production') return [normalizeEmail(original)];
  return [...config.redirectTo];
}
function checkAttachments(attachments: OutboundAttachment[]) {
  if (attachments.reduce((sum, a) => sum + a.content.length, 0) > MAX_ATTACHMENT_BYTES) throw new MailSendError('ATTACHMENT_TOO_LARGE');
}

/** Pure: validates and produces the nodemailer options. Throws MailSendError('GUARD_REFUSED' | 'ATTACHMENT_TOO_LARGE'). */
export function prepareMessage(config: MailConfig, mail: OutboundMail): { options: SendMailOptions; envelope: { from: string; to: string[] } } {
  if (config.mode !== 'smtp') throw new MailSendError('GUARD_REFUSED');
  if (!isSafeEmail(mail.to) || !isSafeEmail(config.from.address)) throw new MailSendError('GUARD_REFUSED');
  checkAttachments(mail.attachments);
  const messageId = safeId(mail.messageId), to = recipientsFor(config, mail.to);
  assertEnvelope(config, to);
  const original = normalizeEmail(mail.to), redirected = config.env !== 'production';
  const subject = headerSafe(mail.subject), body = bodySafe(mail.body);
  const options: SendMailOptions = {
    from: { name: headerSafe(config.from.name), address: config.from.address },
    to: to.map(address => ({ name: '', address })),
    envelope: { from: config.from.address, to },
    subject: redirected ? `[TEST → ${original}] ${subject}` : subject,
    text: redirected ? `[TEST EMAIL — redirected. Original recipient: ${original}. The real recipient received nothing.]\n\n${body}` : body,
    messageId: `<${messageId}@${config.from.address.split('@')[1]}>`,
    ...(redirected ? { headers: { 'X-RMC2-Original-To': original } } : {}),
    attachments: mail.attachments.map(a => ({ filename: safeFilename(a.filename), content: a.content, contentType: safeContentType(a.contentType), contentDisposition: 'attachment' as const })),
    disableFileAccess: true, disableUrlAccess: true,
  };
  return { options, envelope: { from: config.from.address, to } };
}

export interface MailTransport { send(mail: OutboundMail): Promise<SendResult> }

const PRE_DATA = new Set(['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO']);
/** Maps any nodemailer/socket error to a safe, value-free MailSendError. Never copies the original message. */
export function mapSmtpError(error: unknown): MailSendError {
  if (error instanceof MailSendError) return error;
  const e = (error ?? {}) as { code?: string; command?: string; responseCode?: number; message?: string };
  const code = String(e.code || ''), command = String(e.command || '');
  const beforeData = PRE_DATA.has(command);
  if (code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) return new MailSendError('AUTH');
  if (code === 'EENVELOPE' || (command === 'RCPT TO' && (e.responseCode ?? 0) >= 500)) return new MailSendError('RECIPIENT_REFUSED');
  if (code === 'ETIMEDOUT' || (code === 'ESOCKET' && /timeout/i.test(String(e.message)))) return new MailSendError('TIMEOUT', MAIL_REASONS.TIMEOUT, true, !beforeData);
  if (['ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'ETLS', 'ECONNRESET', 'EHOSTUNREACH'].includes(code) && (beforeData || !command)) return new MailSendError('NETWORK', MAIL_REASONS.NETWORK, true, false);
  // Unknown failure: only "not sent" when we know the server never reached DATA.
  return new MailSendError('UNKNOWN', MAIL_REASONS.UNKNOWN, beforeData, !beforeData);
}

type Sender = { sendMail(options: SendMailOptions): Promise<{ accepted?: unknown[]; rejected?: unknown[]; messageId?: string }>; close(): void };
export type SenderFactory = (config: MailConfig) => Sender;
const smtpFactory: SenderFactory = config => {
  const s = config.smtp!;
  return createTransport({ host: s.host, port: s.port, secure: s.port === 465, requireTLS: s.port !== 465, auth: { user: s.user, pass: s.pass },
    connectionTimeout: SEND_TIMEOUTS.connectionTimeout, greetingTimeout: SEND_TIMEOUTS.greetingTimeout, socketTimeout: SEND_TIMEOUTS.socketTimeout,
    disableFileAccess: true, disableUrlAccess: true, tls: { minVersion: 'TLSv1.2' } }) as unknown as Sender;
};
async function buildEml(options: SendMailOptions, envelope: { from: string; to: string[] }): Promise<Buffer> {
  const built = await createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail(options) as unknown as { envelope: { from: string; to: string[] }; message: Buffer };
  // Re-check what nodemailer will actually use, not just what we asked for.
  if (built.envelope.from !== envelope.from || built.envelope.to.join(',') !== envelope.to.join(',')) throw new MailSendError('GUARD_REFUSED');
  return built.message;
}
export class SmtpMailTransport implements MailTransport {
  constructor(private config: MailConfig, private factory: SenderFactory = smtpFactory, private overallTimeout = SEND_TIMEOUTS.overall) {}
  async send(mail: OutboundMail): Promise<SendResult> {
    const { config } = this;
    const { options, envelope } = prepareMessage(config, mail);
    assertEnvelope(config, envelope.to);
    const eml = await buildEml(options, envelope);
    const mode: DeliveryMode = config.env === 'production' ? 'smtp-live' : 'smtp-redirected';
    if (config.dryRun) return { at: new Date().toISOString(), providerId: 'dry-run', mode, dryRun: true, eml };
    if (!config.smtp) throw new MailSendError('GUARD_REFUSED');
    const sender = this.factory(config);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MailSendError('TIMEOUT', MAIL_REASONS.TIMEOUT, true, true)), this.overallTimeout); });
      const info = await Promise.race([sender.sendMail(options), timeout]);
      const accepted = (info.accepted || []).map(a => String(typeof a === 'object' && a ? (a as { address?: string }).address : a).toLowerCase());
      if ((info.rejected || []).length || envelope.to.some(a => !accepted.includes(a))) throw new MailSendError('RECIPIENT_REFUSED');
      return { at: new Date().toISOString(), providerId: info.messageId, mode, dryRun: false, eml };
    } catch (error) { throw mapSmtpError(error); }
    finally { if (timer) clearTimeout(timer); try { sender.close(); } catch { /* ignore */ } }
  }
}

/** Local test mailbox: writes the message the way the app always has. Nothing leaves the machine. */
export class LocalMailTransport implements MailTransport {
  async send(mail: OutboundMail): Promise<SendResult> {
    if (!isSafeEmail(mail.to)) throw new MailSendError('GUARD_REFUSED');
    checkAttachments(mail.attachments);
    const boundary = 'rmc2-' + safeId(mail.messageId);
    const lines = ['From: RMC2 Franchising <franchising@rmc2.local>', `To: ${mail.to}`, `Subject: =?UTF-8?B?${Buffer.from(headerSafe(mail.subject)).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${mail.messageId}@rmc2.local>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(bodySafe(mail.body)).toString('base64')];
    for (const a of mail.attachments) lines.push(`--${boundary}`, `Content-Type: ${safeContentType(a.contentType)}`, `Content-Disposition: attachment; filename="${safeFilename(a.filename)}"`, 'Content-Transfer-Encoding: base64', '', (a.content.toString('base64').match(/.{1,76}/g) || ['']).join('\r\n'));
    lines.push(`--${boundary}--`, '');
    return { at: new Date().toISOString(), mode: 'local-test', dryRun: false, eml: Buffer.from(lines.join('\r\n')) };
  }
}
let testTransport: ((config: MailConfig) => MailTransport) | null = null;
/** Test seam for scripts/test-mail-service.mjs only: inert unless RMC2_MAIL_TEST_HOOK=1 is set in the process environment. */
export function setTestTransport(factory: ((config: MailConfig) => MailTransport) | null) {
  if (process.env.RMC2_MAIL_TEST_HOOK !== '1') throw new Error('Mail test hook is disabled');
  testTransport = factory;
}
export function mailTransport(config: MailConfig = mailConfig()): MailTransport {
  if (testTransport && process.env.RMC2_MAIL_TEST_HOOK === '1') return testTransport(config);
  return config.mode === 'smtp' ? new SmtpMailTransport(config) : new LocalMailTransport();
}
