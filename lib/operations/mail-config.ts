// Server-side only: reads mail credentials from the environment. Never import this from a client component
// (the `server-only` package is not installed; the UI imports only the MailStatus type from ./types).
import path from 'node:path';
import type { MailStatus } from './types';

export type MailMode = 'local' | 'smtp';
export type MailEnv = 'local' | 'staging' | 'production';
export type SmtpSettings = { host: string; port: number; user: string; pass: string };
export type MailConfig = {
  mode: MailMode; env: MailEnv; redirectTo: string[]; allowlist: string[]; dryRun: boolean;
  caps: { perHour: number; perDay: number }; from: { name: string; address: string }; warning?: string;
  /** Credentials. Non-enumerable so JSON.stringify / console.log / spreading a config can never leak them. */
  readonly smtp?: SmtpSettings;
};
export const LIVE_CONFIRM = 'I-APPROVE-LIVE-EMAIL';
export const MAIL_CAPS = { perHour: 5, perDay: 20 };
const LOCAL_FROM = { name: 'RMC2 Franchising', address: 'franchising@rmc2.local' };
// Exact-address gate. ASCII only (checked first so Unicode case-folding such as the Kelvin sign can never map into it).
const GATE = /^[a-z0-9._+-]+@[a-z0-9.-]+$/;
export function isSafeEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || !/^[\x21-\x7e]+$/.test(value)) return false;
  const v = value.toLowerCase();
  if (!GATE.test(v)) return false;
  const [local, domain] = v.split('@');
  return !!local && !local.startsWith('.') && !local.endsWith('.') && !v.includes('..') && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && !domain.startsWith('-');
}
export const normalizeEmail = (value: string) => value.toLowerCase();
const clean = (value: string | undefined) => (value ?? '').trim();
const list = (value: string | undefined) => clean(value).split(/[,;]/).map(v => v.trim().toLowerCase()).filter(Boolean);
const underOrEqual = (child: string, parent: string) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const inTestResults = (dir: string) => dir.split(/[\\/]+/).some(part => part.toLowerCase() === 'test-results');

function localConfig(warning?: string): MailConfig {
  return { mode: 'local', env: 'local', redirectTo: [], allowlist: [], dryRun: false, caps: MAIL_CAPS, from: LOCAL_FROM, ...(warning ? { warning } : {}) };
}
/** Pure parser. Anything missing, empty or invalid falls back to `local` with a static (value-free) warning. */
export function parseMailConfig(env: Record<string, string | undefined>, dataDir: string, cwd: string): MailConfig {
  const requested = clean(env.RMC2_MAIL_MODE).toLowerCase();
  if (!requested || requested === 'local') return localConfig();
  const refuse = (reason: string) => localConfig('Real email is disabled: ' + reason + ' Using the local test mailbox.');
  if (requested !== 'smtp') return refuse('RMC2_MAIL_MODE must be local or smtp.');
  const mailEnv = clean(env.RMC2_MAIL_ENV).toLowerCase();
  if (mailEnv !== 'staging' && mailEnv !== 'production') return refuse('RMC2_MAIL_ENV must be staging or production.');
  const dir = path.resolve(dataDir), realData = path.resolve(cwd, '.data');
  if (mailEnv === 'production') {
    if (inTestResults(dir)) return refuse('a test-results data directory can never send production email.');
    if (clean(env.RMC2_MAIL_LIVE_CONFIRM) !== LIVE_CONFIRM) return refuse('live email is not confirmed.');
  } else if (underOrEqual(dir, realData)) return refuse('only the test copy may send; the real data directory never sends.');
  const host = clean(env.RMC2_SMTP_HOST), port = Number(clean(env.RMC2_SMTP_PORT)), user = clean(env.RMC2_SMTP_USER), pass = clean(env.RMC2_SMTP_APP_PASSWORD).replace(/\s+/g, ''); // Google shows app passwords as 4 groups; spaces are never part of them.
  const address = clean(env.RMC2_MAIL_FROM_ADDRESS).toLowerCase(), name = clean(env.RMC2_MAIL_FROM_NAME);
  if (!host || !user || !pass || !address || !name || !clean(env.RMC2_SMTP_PORT)) return refuse('SMTP settings are incomplete.');
  if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return refuse('SMTP host or port is invalid.');
  if (!isSafeEmail(address) || user.toLowerCase() !== address) return refuse('the sender address must be a valid address equal to the SMTP user.');
  if (name.length > 80 || /[\x00-\x1f\x7f\u2028\u2029"<>]/.test(name)) return refuse('the sender name is invalid.');
  const dryRun = ['1', 'true'].includes(clean(env.RMC2_MAIL_DRY_RUN).toLowerCase());
  let allowlist: string[] = [], redirectTo: string[] = [];
  if (mailEnv !== 'production') {
    allowlist = list(env.RMC2_MAIL_ALLOWLIST); redirectTo = list(env.RMC2_MAIL_REDIRECT_TO);
    if (!allowlist.length || allowlist.length > 10 || !allowlist.every(a => !a.includes('*') && isSafeEmail(a))) return refuse('the allowlist must contain 1-10 exact addresses.');
    if (!redirectTo.length || redirectTo.length > 3 || !redirectTo.every(a => isSafeEmail(a) && allowlist.includes(a))) return refuse('the redirect inbox must be on the allowlist.');
  }
  const config: MailConfig = { mode: 'smtp', env: mailEnv, redirectTo, allowlist, dryRun, caps: MAIL_CAPS, from: { name, address } };
  Object.defineProperty(config, 'smtp', { value: { host, port, user, pass }, enumerable: false });
  return config;
}
export function mailConfig(): MailConfig {
  return parseMailConfig(process.env, process.env.RMC2_DATA_DIR || path.join(process.cwd(), '.data'), process.cwd());
}
export function maskEmail(address: string) {
  const [local = '', domain = ''] = address.split('@');
  return local.slice(0, local.length > 2 ? 2 : 1) + '•••@' + domain;
}
export function mailStatusFor(config: MailConfig): MailStatus {
  if (config.mode === 'local') return { mode: 'local', env: 'local', label: 'LOCAL TEST MAILBOX · nothing is sent', dryRun: false, ...(config.warning ? { warning: config.warning } : {}) };
  const redirectedTo = config.env === 'production' ? undefined : config.redirectTo.map(maskEmail).join(', ');
  const label = config.env === 'production' ? 'LIVE EMAIL' : 'TEST EMAIL · to ' + redirectedTo;
  return { mode: 'smtp', env: config.env, label: label + (config.dryRun ? ' · DRY RUN, not sent' : ''), ...(redirectedTo ? { redirectedTo } : {}), dryRun: config.dryRun };
}
export const mailStatus = (): MailStatus => mailStatusFor(mailConfig());
