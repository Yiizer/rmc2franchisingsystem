import { z } from 'zod';
import { STARTED_HANDLING } from './activity';
import { AppError, allUsers, db, inquiries } from './database';
import { canSeeProposalStats } from './permissions';
import type { AuditEntry, InquiryRecord, ProposalStats, ProposalStatsPeriod, Staff } from './types';

// Proposal dashboard numbers (feedback round 2026-11-07, items 3 and 4). Read in ONE database snapshot and computed in JS, which is fine at
// hundreds of rows; if the table grows into the tens of thousands, move the bucket counts into SQL over inquiry_summaries.
// All bucketing is Manila time (UTC+8, no daylight saving); weeks run Monday-Sunday. Pure: computeProposalStats takes records and `now`.
const HOUR = 3600000, DAY = 24 * HOUR, MANILA = 8 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_BUCKETS: Record<ProposalStatsPeriod, number> = { day: 14, week: 12, month: 12 };
const MAX_BUCKETS = 400;

const shifted = (ms: number) => new Date(ms + MANILA); // read with getUTC*: the Manila wall clock
const dayStart = (ms: number) => Math.floor((ms + MANILA) / DAY) * DAY - MANILA;
const monthStart = (year: number, month: number) => Date.UTC(year, month, 1) - MANILA; // month may overflow (12 = next January) or go below 0
/** Start (UTC ms) of the Manila bucket that contains `ms`. */
export function bucketStart(period: ProposalStatsPeriod, ms: number): number {
  const day = dayStart(ms);
  if (period === 'day') return day;
  if (period === 'week') return day - ((shifted(day).getUTCDay() + 6) % 7) * DAY;
  const d = shifted(ms);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth());
}
function nextStart(period: ProposalStatsPeriod, start: number): number {
  if (period === 'day') return start + DAY;
  if (period === 'week') return start + 7 * DAY;
  const d = shifted(start);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
function previousStart(period: ProposalStatsPeriod, start: number): number {
  if (period === 'day') return start - DAY;
  if (period === 'week') return start - 7 * DAY;
  const d = shifted(start);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth() - 1);
}
function labelOf(period: ProposalStatsPeriod, start: number): string {
  const d = shifted(start), md = (x: Date) => MONTHS[x.getUTCMonth()] + ' ' + x.getUTCDate();
  if (period === 'day') return md(d);
  if (period === 'month') return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const last = shifted(start + 6 * DAY);
  return d.getUTCMonth() === last.getUTCMonth() ? md(d) + '–' + last.getUTCDate() : md(d) + '–' + md(last);
}

const START_PREFIXES = ['Started / saved proposal preparation', 'Updated inquiry details'];
const PREPARATION_PREFIXES = [...START_PREFIXES, 'Paused preparation'];
const startsWith = (entry: AuditEntry, prefixes: string[]) => prefixes.some(prefix => entry.action.startsWith(prefix));
/** A "start event" for timing: the logged first start, or (older records and resubmissions) a save of the preparation. */
const isStartEvent = (entry: AuditEntry) => entry.action === STARTED_HANDLING || startsWith(entry, START_PREFIXES);
const time = (value: string | undefined) => { const ms = value ? Date.parse(value) : NaN; return Number.isFinite(ms) ? ms : NaN; };

/** First start event at or after `after` (ms), by `userId` (or by anyone when undefined). NaN when there is none. */
function firstStart(record: InquiryRecord, userId: string | undefined, after: number): number {
  let best = NaN;
  for (const entry of record.history) {
    if ((userId !== undefined && entry.actorId !== userId) || !isStartEvent(entry)) continue;
    const at = time(entry.at);
    if (Number.isFinite(at) && at >= after && !(at >= best)) best = at;
  }
  return best;
}

export function computeProposalStats(records: InquiryRecord[], users: Pick<Staff, 'id' | 'name'>[], period: ProposalStatsPeriod, now: number, range?: { from: number; to: number }): ProposalStats {
  // Buckets, oldest first. Default: the current bucket and the ones before it. With a range: the buckets that cover it (capped).
  const starts: number[] = [];
  if (range) {
    for (let s = bucketStart(period, range.from); s <= range.to && starts.length < MAX_BUCKETS; s = nextStart(period, s)) starts.push(s);
  } else {
    for (let s = bucketStart(period, now), i = 0; i < DEFAULT_BUCKETS[period]; i++, s = previousStart(period, s)) starts.unshift(s);
  }
  const from = starts[0], to = nextStart(period, starts[starts.length - 1]);
  const where = (ms: number) => { if (!Number.isFinite(ms) || ms < from || ms >= to) return -1; let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= ms) lo = mid; else hi = mid - 1; } return lo; };
  const buckets = starts.map(start => ({ label: labelOf(period, start), start: new Date(start).toISOString(), sent: 0, declined: 0, notStarted: 0 }));
  const funnel = { Received: 0, Started: 0, Submitted: 0, Approved: 0, Sent: 0 };
  const created = new Map<string, number[]>(), handled = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, id: string, ms: number) => { const list = map.get(id) || []; list.push(ms); map.set(id, list); };

  for (const record of records) {
    // Sent: the delivered submission's delivery.at, an inquiry once per bucket.
    const delivered = record.submissions.filter(item => item.delivery && !item.delivery.dryRun);
    for (const index of new Set(delivered.map(item => where(time(item.delivery!.at))).filter(i => i >= 0))) buckets[index].sent++;
    if (record.closure?.kind === 'declined') { const i = where(time(record.closure.at)); if (i >= 0) buckets[i].declined++; }
    const createdIndex = where(time(record.createdAt));
    if (createdIndex >= 0 && record.status === 'New inquiry' && !record.closure) buckets[createdIndex].notStarted++;

    // Funnel over inquiries received in the range. Each step implies the one before it, so the steps are always nested.
    if (createdIndex >= 0) {
      const sent = delivered.length > 0; // the same definition as the Sent bucket: a delivered submission
      const approved = sent || record.submissions.some(item => item.decision?.action === 'approve');
      const submitted = approved || record.submissions.length > 0;
      const started = submitted || record.history.some(entry => entry.action === STARTED_HANDLING || startsWith(entry, PREPARATION_PREFIXES));
      funnel.Received++; if (started) funnel.Started++; if (submitted) funnel.Submitted++; if (approved) funnel.Approved++; if (sent) funnel.Sent++;
    }

    // (a) Time to create, per submitted version: the submitter's first start after creation (v1) or after the decision on the previous version (v2+) -> submission time.
    // Supervisor revisions are not the preparer's creation and are skipped, as are records without a start event.
    record.submissions.forEach((submission, i) => {
      if (submission.supervisorRevision) return;
      const submittedAt = time(submission.at);
      if (where(submittedAt) < 0) return;
      const anchor = i === 0 ? time(record.createdAt) : time(record.submissions[i - 1].decision?.at);
      if (!Number.isFinite(anchor)) return;
      const start = firstStart(record, submission.submittedBy, anchor);
      if (Number.isFinite(start) && start <= submittedAt) add(created, submission.submittedBy, submittedAt - start);
    });
    // (b) Handling time: first start by anyone -> delivery of the sent version, credited to that version's submitter, by sent date. Manual confirmations count.
    const sentVersion = delivered.at(-1);
    if (sentVersion) {
      const deliveredAt = time(sentVersion.delivery!.at);
      if (where(deliveredAt) >= 0) {
        const start = firstStart(record, undefined, 0);
        if (Number.isFinite(start) && start <= deliveredAt) add(handled, sentVersion.submittedBy, deliveredAt - start);
      }
    }
  }

  const names = new Map(users.map(person => [person.id, person.name]));
  const mean = (values: number[] | undefined) => values?.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
  const timing = [...new Set([...created.keys(), ...handled.keys()])].map(userId => ({
    userId, name: names.get(userId) || userId,
    created: created.get(userId)?.length || 0, avgCreateMs: mean(created.get(userId)),
    sent: handled.get(userId)?.length || 0, avgHandlingMs: mean(handled.get(userId)),
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.userId.localeCompare(b.userId));

  return { period, from: new Date(from).toISOString(), to: new Date(to).toISOString(), asOf: new Date(now).toISOString(), buckets, funnel: (Object.keys(funnel) as (keyof typeof funnel)[]).map(step => ({ step, count: funnel[step] })), timing };
}

const manilaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(value => Date.parse(value + 'T00:00:00+08:00')).refine(Number.isFinite, 'Use a valid date.');
const querySchema = z.object({ period: z.enum(['day', 'week', 'month']), from: manilaDate.optional(), to: manilaDate.optional() }).refine(q => (q.from === undefined) === (q.to === undefined), 'Give both from and to, or neither.').refine(q => q.from === undefined || q.to! >= q.from, 'to must not be before from.');
/** GET monitoring/proposals?period=day|week|month[&from=YYYY-MM-DD&to=YYYY-MM-DD] (Manila dates). Head and Supervisors only. */
export async function proposalStats(user: Staff, params: URLSearchParams): Promise<ProposalStats> {
  if (!canSeeProposalStats(user)) throw new AppError('You do not have access to the proposal dashboard.', 403);
  const query = querySchema.parse({ period: params.get('period') || 'day', from: params.get('from') || undefined, to: params.get('to') || undefined });
  const { records, users } = await db.snapshot(async () => ({ records: await inquiries(), users: await allUsers() }));
  return computeProposalStats(records, users, query.period, Date.now(), query.from !== undefined ? { from: query.from, to: query.to! } : undefined);
}
