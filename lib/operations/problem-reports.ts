import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, db } from './database';
import { canSeeProblemReports } from './permissions';
import type { CrashReport, ProblemReport, ProblemReportStatus, Staff } from './types';

// "Report a problem" (pilot plan 2026-11-16, item 5). Anyone signed in files a short description; the app adds the
// page, role, inquiry id, app version, window size and browser. Only the Head and Admin read the list and set status.
// No screenshots and no form contents are captured: the description is the only free text.
export const PROBLEM_REPORTS_PER_DAY = 30;
/** New crash entries one person's browser can open a day (repeats of a known crash only add to its count). */
export const CRASHES_PER_DAY = 20;
const CRASH_PREFIX = 'err-';
const STATUSES = ['new', 'in-progress', 'fixed'] as const satisfies readonly ProblemReportStatus[];
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();
const short = (max: number) => z.string().max(max * 4).transform(value => clean(value).slice(0, max));

const submitSchema = z.object({
  description: z.string().max(8000).transform(clean).pipe(z.string().min(10, 'Describe the problem in a few words (at least 10 characters).').max(2000)),
  page: short(80),
  inquiryId: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
}).strict();
// Crash entries (pilot plan item 6): sent by the app itself on an uncaught error, never typed by a person.
const crashSchema = z.object({
  kind: z.literal('error'),
  source: z.enum(['error', 'unhandledrejection', 'render']),
  message: z.string().max(4000).transform(clean).pipe(z.string().min(1).max(1000)).transform(value => value.slice(0, 300)),
  stack: z.string().max(20000).optional(),
  page: short(80),
  inquiryId: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
}).strict();
/** Keeps the first 12 frames, without the site address or query strings, so stacks stay short and comparable. */
const cleanStack = (stack = '') => stack.replace(/https?:\/\/[^/\s)]+/g, '').replace(/\?[^\s):]*/g, '').split('\n').map(line => clean(line)).filter(Boolean).slice(0, 12).join('\n').slice(0, 2000);
const statusSchema = z.object({ status: z.enum(STATUSES), note: short(1000).optional() }).strict();

/** The deployment that served the request: the commit on Vercel, "local" on this computer. */
export function appVersion() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  return sha || (process.env.VERCEL_DEPLOYMENT_ID ? process.env.VERCEL_DEPLOYMENT_ID.slice(0, 16) : 'local');
}

type Row = { id: string; at: string; user_id: string; status: string; data: string };
const toReport = (row: Row): ProblemReport | CrashReport => ({ ...(JSON.parse(row.data) as Omit<ProblemReport, 'id' | 'at' | 'userId' | 'status'>), id: row.id, at: row.at, userId: row.user_id, status: row.status as ProblemReportStatus });

export async function submitProblemReport(user: Staff, input: unknown, userAgent: string) {
  if ((input as { kind?: unknown } | null)?.kind === 'error') return submitCrash(user, input, userAgent);
  const body = submitSchema.parse(input);
  const since = new Date(Date.now() - 86400000).toISOString();
  const recent = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM problem_reports WHERE user_id=? AND at>? AND NOT (id>='err-' AND id<'err.')", user.id, since); // ids starting "err-" ('.' follows '-'; ids compare byte by byte)
  if (Number(recent?.n || 0) >= PROBLEM_REPORTS_PER_DAY) throw new AppError(`You can send up to ${PROBLEM_REPORTS_PER_DAY} problem reports a day. Tell your supervisor directly if you need to send more.`, 429);
  const id = randomUUID(), at = new Date().toISOString();
  const data = { description: body.description, page: body.page || 'Unknown page', role: user.role, ...(body.inquiryId ? { inquiryId: body.inquiryId } : {}), version: appVersion(), ...(body.viewport ? { viewport: body.viewport } : {}), browser: clean(userAgent).slice(0, 300) };
  await db.run('INSERT INTO problem_reports(id,at,user_id,status,data) VALUES (?,?,?,?,?)', id, at, user.id, 'new', JSON.stringify(data));
  return { id, at };
}

/** One entry per distinct crash in one app version: the first time opens it, repeats add to its count and reopen it if it was marked fixed. */
async function submitCrash(user: Staff, input: unknown, userAgent: string) {
  const body = crashSchema.parse(input);
  const stack = cleanStack(body.stack), version = appVersion(), now = new Date().toISOString();
  const id = CRASH_PREFIX + createHash('sha256').update([version, body.source, body.message, stack.split('\n').slice(0, 3).join('\n')].join('|')).digest('hex').slice(0, 24);
  const existing = await db.get<Row>('SELECT id,at,user_id,status,data FROM problem_reports WHERE id=?', id);
  if (!existing) {
    const since = new Date(Date.now() - 86400000).toISOString();
    const recent = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM problem_reports WHERE user_id=? AND at>? AND id>='err-' AND id<'err.'", user.id, since);
    if (Number(recent?.n || 0) >= CRASHES_PER_DAY) throw new AppError('Too many app errors were logged today.', 429);
    const data = { kind: 'error', source: body.source, description: body.message, ...(stack ? { stack } : {}), page: body.page || 'Unknown page', role: user.role, ...(body.inquiryId ? { inquiryId: body.inquiryId } : {}), version, ...(body.viewport ? { viewport: body.viewport } : {}), browser: clean(userAgent).slice(0, 300), count: 1, lastAt: now, userIds: [user.id] };
    // Two browsers can hit the same new crash at once; the second insert is skipped (its occurrence is not counted).
    await db.run('INSERT INTO problem_reports(id,at,user_id,status,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING', id, now, user.id, 'new', JSON.stringify(data));
    return { id, at: now, repeat: false };
  }
  const data = JSON.parse(existing.data) as Omit<CrashReport, 'id' | 'at' | 'userId' | 'status'>;
  const reopen = existing.status === 'fixed';
  const next = { ...data, count: Number(data.count || 1) + 1, lastAt: now, userIds: [...new Set([...(data.userIds || []), user.id])].slice(0, 20), ...(body.inquiryId ? { inquiryId: body.inquiryId } : {}), ...(reopen ? { reopened: true } : {}) };
  await db.run('UPDATE problem_reports SET status=?,data=? WHERE id=?', reopen ? 'new' : existing.status, JSON.stringify(next), id);
  return { id, at: existing.at, repeat: true };
}

export async function listProblemReports(user: Staff): Promise<{ reports: (ProblemReport | CrashReport)[] }> {
  if (!canSeeProblemReports(user)) throw new AppError('Only the IT Admin can read problem reports.', 403);
  const rows = await db.all<Row>('SELECT id,at,user_id,status,data FROM problem_reports ORDER BY at DESC LIMIT 300');
  return { reports: rows.map(toReport) };
}

export async function updateProblemReport(user: Staff, id: string, input: unknown): Promise<{ report: ProblemReport | CrashReport }> {
  if (!canSeeProblemReports(user)) throw new AppError('Only the IT Admin can update problem reports.', 403);
  const body = statusSchema.parse(input);
  const row = await db.get<Row>('SELECT id,at,user_id,status,data FROM problem_reports WHERE id=?', id);
  if (!row) throw new AppError('Problem report not found.', 404);
  const data = { ...JSON.parse(row.data), updatedAt: new Date().toISOString(), updatedBy: user.id, ...(body.note !== undefined ? { note: body.note } : {}) };
  await db.run('UPDATE problem_reports SET status=?,data=? WHERE id=?', body.status, JSON.stringify(data), id);
  return { report: toReport({ ...row, status: body.status, data: JSON.stringify(data) }) };
}
