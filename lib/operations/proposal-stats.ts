import { z } from 'zod';
import { STARTED_HANDLING } from './activity';
import { AppError, allUsers, db, inquiries } from './database';
import { canSeeProposalStats } from './permissions';
import { RANGE_KEYS, earliestStart, parsePeriod, periodEnd, periodKey, periodLabel, periodStart, sameMomentEarlier, shiftPeriod } from './proposal-periods';
import type { AuditEntry, InquiryRecord, ProposalEmployeeDetail, ProposalStats, ProposalStatsPeriod, ProposalStatsRange, ProposalTimelineEvent, ProposalWindowTotals, Staff } from './types';

// Monitoring numbers (feedback round 2026-11-07, items 3 and 4). Read in ONE database snapshot and computed in JS, which is fine at
// hundreds of rows; if the table grows into the tens of thousands, move the bucket counts into SQL over inquiry_summaries.
// All bucketing is Manila time (UTC+8, no daylight saving); weeks run Monday-Sunday. Pure: computeProposalStats takes records and `now`.
const HOUR = 3600000, DAY = 24 * HOUR, MANILA = 8 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_BUCKETS: Record<ProposalStatsPeriod, number> = { hour: 24, day: 14, week: 12, month: 12 };
const MAX_BUCKETS = 400;

const shifted = (ms: number) => new Date(ms + MANILA); // read with getUTC*: the Manila wall clock
const dayStart = (ms: number) => Math.floor((ms + MANILA) / DAY) * DAY - MANILA;
const monthStart = (year: number, month: number) => Date.UTC(year, month, 1) - MANILA; // month may overflow (12 = next January) or go below 0
/** Start (UTC ms) of the Manila bucket that contains `ms`. */
export function bucketStart(period: ProposalStatsPeriod, ms: number): number {
  if (period === 'hour') return Math.floor(ms / HOUR) * HOUR; // Manila is a whole number of hours from UTC
  const day = dayStart(ms);
  if (period === 'day') return day;
  if (period === 'week') return day - ((shifted(day).getUTCDay() + 6) % 7) * DAY;
  const d = shifted(ms);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth());
}
function nextStart(period: ProposalStatsPeriod, start: number): number {
  if (period === 'hour') return start + HOUR;
  if (period === 'day') return start + DAY;
  if (period === 'week') return start + 7 * DAY;
  const d = shifted(start);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
function previousStart(period: ProposalStatsPeriod, start: number): number {
  if (period === 'hour') return start - HOUR;
  if (period === 'day') return start - DAY;
  if (period === 'week') return start - 7 * DAY;
  const d = shifted(start);
  return monthStart(d.getUTCFullYear(), d.getUTCMonth() - 1);
}
function labelOf(period: ProposalStatsPeriod, start: number): string {
  const d = shifted(start), md = (x: Date) => MONTHS[x.getUTCMonth()] + ' ' + x.getUTCDate();
  if (period === 'hour') { const h = d.getUTCHours(); return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'); }
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
const deliveredSubmissions = (record: InquiryRecord) => record.submissions.filter(item => item.delivery && !item.delivery.dryRun);
/** (a) Time to create of submission `i`: the submitter's first start after creation (v1) or after the decision on the previous version (v2+)
 * -> submission time. NaN for a supervisor revision or when there is no start event. Shared by the table and the drill-down. */
function createDuration(record: InquiryRecord, i: number): number {
  const submission = record.submissions[i];
  if (submission.supervisorRevision) return NaN;
  const submittedAt = time(submission.at), anchor = i === 0 ? time(record.createdAt) : time(record.submissions[i - 1].decision?.at);
  if (!Number.isFinite(submittedAt) || !Number.isFinite(anchor)) return NaN;
  const start = firstStart(record, submission.submittedBy, anchor);
  return Number.isFinite(start) && start <= submittedAt ? submittedAt - start : NaN;
}
/** (b) Handling time: first start by anyone -> delivery of the sent version, credited to that version's submitter. Manual confirmations count. */
function handling(record: InquiryRecord): { userId: string; at: number; ms: number } | null {
  const sentVersion = deliveredSubmissions(record).at(-1);
  if (!sentVersion) return null;
  const at = time(sentVersion.delivery!.at), start = firstStart(record, undefined, 0);
  return Number.isFinite(at) && Number.isFinite(start) && start <= at ? { userId: sentVersion.submittedBy, at, ms: at - start } : null;
}

/** `range.to` is inclusive (the start of a Manila date), unless `exact`: then [from, to) is the exact window and the first bucket is clipped to it. */
export function computeProposalStats(records: InquiryRecord[], users: Pick<Staff, 'id' | 'name'>[], period: ProposalStatsPeriod, now: number, range?: { from: number; to: number; exact?: boolean }): ProposalStats {
  // Buckets, oldest first. Default: the current bucket and the ones before it. With a range: the buckets that cover it (capped).
  const starts: number[] = [];
  if (range) {
    for (let s = bucketStart(period, range.from); (range.exact ? s < range.to : s <= range.to) && starts.length < MAX_BUCKETS; s = nextStart(period, s)) starts.push(s);
  } else {
    for (let s = bucketStart(period, now), i = 0; i < DEFAULT_BUCKETS[period]; i++, s = previousStart(period, s)) starts.unshift(s);
  }
  const from = range?.exact ? range.from : starts[0], to = range?.exact ? range.to : nextStart(period, starts[starts.length - 1]);
  const where = (ms: number) => { if (!Number.isFinite(ms) || ms < from || ms >= to) return -1; let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= ms) lo = mid; else hi = mid - 1; } return lo; };
  const buckets = starts.map(start => ({ label: labelOf(period, start), start: new Date(start).toISOString(), received: 0, sent: 0, declined: 0, notStarted: 0 }));
  const funnel = { Received: 0, Started: 0, Submitted: 0, Approved: 0, Sent: 0 };
  const created = new Map<string, number[]>(), handled = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, id: string, ms: number) => { const list = map.get(id) || []; list.push(ms); map.set(id, list); };

  for (const record of records) {
    // Sent: the delivered submission's delivery.at, an inquiry once per bucket.
    const delivered = deliveredSubmissions(record);
    for (const index of new Set(delivered.map(item => where(time(item.delivery!.at))).filter(i => i >= 0))) buckets[index].sent++;
    if (record.closure?.kind === 'declined') { const i = where(time(record.closure.at)); if (i >= 0) buckets[i].declined++; }
    const createdIndex = where(time(record.createdAt));
    if (createdIndex >= 0) buckets[createdIndex].received++;
    if (createdIndex >= 0 && record.status === 'New inquiry' && !record.closure) buckets[createdIndex].notStarted++;

    // Funnel over inquiries received in the range. Each step implies the one before it, so the steps are always nested.
    if (createdIndex >= 0) {
      const sent = delivered.length > 0; // the same definition as the Sent bucket: a delivered submission
      const approved = sent || record.submissions.some(item => item.decision?.action === 'approve');
      const submitted = approved || record.submissions.length > 0;
      const started = submitted || record.history.some(entry => entry.action === STARTED_HANDLING || startsWith(entry, PREPARATION_PREFIXES));
      funnel.Received++; if (started) funnel.Started++; if (submitted) funnel.Submitted++; if (approved) funnel.Approved++; if (sent) funnel.Sent++;
    }

    // (a) Time to create, per submitted version in the range; (b) handling time, by sent date (see createDuration / handling).
    record.submissions.forEach((submission, i) => {
      if (where(time(submission.at)) < 0) return;
      const ms = createDuration(record, i);
      if (Number.isFinite(ms)) add(created, submission.submittedBy, ms);
    });
    const handled1 = handling(record);
    if (handled1 && where(handled1.at) >= 0) add(handled, handled1.userId, handled1.ms);
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

// ---------- Monitoring summary (feedback round 2026-11-08b): calendar periods, past periods, the previous period, sends per weekday, sent rate ----------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const BUCKET_OF: Record<ProposalStatsRange, ProposalStatsPeriod> = { day: 'hour', week: 'day', month: 'day', year: 'month' };
/** The selected calendar period [from, to) and the previous period's comparison window [previousFrom, previousTo), Manila time.
 * A past period is compared with the whole period before it. The current period is compared like for like: the previous period up to the same point. */
export function periodWindows(range: ProposalStatsRange, now: number, key?: string) {
  let from = periodStart(range, now);
  if (key !== undefined) { const parsed = parsePeriod(range, key, now); if (!parsed.ok) throw new AppError(parsed.error, 400); from = parsed.start; }
  const to = periodEnd(range, from), previousFrom = shiftPeriod(range, from, -1), toDate = from === periodStart(range, now);
  return { bucket: BUCKET_OF[range], from, to, previousFrom, previousTo: toDate ? Math.min(from, sameMomentEarlier(range, now)) : from, toDate };
}
/** The four KPI counts over [from, to). Same definitions as the buckets; "sent" counts an inquiry once however often it was delivered. */
export function windowTotals(records: InquiryRecord[], from: number, to: number): Omit<ProposalWindowTotals, 'from' | 'to'> {
  const inside = (value: string | undefined) => { const ms = time(value); return ms >= from && ms < to; };
  let received = 0, sent = 0, declined = 0, notStarted = 0;
  for (const record of records) {
    if (inside(record.createdAt)) { received++; if (record.status === 'New inquiry' && !record.closure) notStarted++; }
    if (record.submissions.some(item => item.delivery && !item.delivery.dryRun && inside(item.delivery.at))) sent++;
    if (record.closure?.kind === 'declined' && inside(record.closure.at)) declined++;
  }
  return { received, sent, declined, notStarted };
}
/** Proposals sent per Manila weekday in [from, to) (PO Q3): an inquiry counts once per day it was delivered, the same as the day buckets. */
export function sendsByWeekday(records: InquiryRecord[], from: number, to: number) {
  const counts = WEEKDAYS.map(() => 0);
  for (const record of records) {
    const days = new Set(deliveredSubmissions(record).map(item => time(item.delivery!.at)).filter(ms => ms >= from && ms < to).map(dayStart));
    for (const day of days) counts[(shifted(day).getUTCDay() + 6) % 7]++;
  }
  return WEEKDAYS.map((day, i) => ({ day, sent: counts[i] }));
}
export function computeRangeStats(records: InquiryRecord[], users: Pick<Staff, 'id' | 'name'>[], range: ProposalStatsRange, now: number, key?: string): ProposalStats {
  const w = periodWindows(range, now, key), result = computeProposalStats(records, users, w.bucket, now, { from: w.from, to: w.to, exact: true });
  const received = result.funnel[0].count, sent = result.funnel[result.funnel.length - 1].count, iso = (ms: number) => new Date(ms).toISOString();
  return { ...result, buckets: result.buckets.map(b => Date.parse(b.start) > now ? { ...b, future: true } : b), summary: {
    range, period: periodKey(range, w.from), label: periodLabel(range, w.from), previousLabel: periodLabel(range, w.previousFrom), toDate: w.toDate,
    currentPeriod: periodKey(range, periodStart(range, now)), earliestPeriod: periodKey(range, earliestStart(range, now)),
    current: { from: iso(w.from), to: iso(w.to), ...windowTotals(records, w.from, w.to) },
    previous: { from: iso(w.previousFrom), to: iso(w.previousTo), ...windowTotals(records, w.previousFrom, w.previousTo) },
    weekdays: sendsByWeekday(records, w.from, w.to),
    sentRate: received ? Math.round(sent / received * 100) : null,
  } };
}

// ---------- Drill-down (item 5): one employee's proposals in the selected period ----------
export const MAX_TIMELINE = 300;
/** Pure. The summary reuses computeProposalStats, so it always equals the employee's Time per employee row. */
export function employeeTimeline(records: InquiryRecord[], users: Pick<Staff, 'id' | 'name'>[], userId: string, range: ProposalStatsRange, now: number, key?: string): ProposalEmployeeDetail {
  const w = periodWindows(range, now, key), inside = (ms: number) => ms >= w.from && ms < w.to;
  const row = computeProposalStats(records, users, w.bucket, now, { from: w.from, to: w.to, exact: true }).timing.find(item => item.userId === userId);
  const proposals: { first: number; item: ProposalEmployeeDetail['proposals'][number] }[] = [];
  let declined = 0;
  for (const record of records) {
    const events: ProposalTimelineEvent[] = [], push = (kind: ProposalTimelineEvent['kind'], ms: number, extra: Partial<ProposalTimelineEvent> = {}) => { if (Number.isFinite(ms)) events.push({ kind, at: new Date(ms).toISOString(), inPeriod: inside(ms), ...extra }); };
    const started = firstStart(record, userId, 0);
    push('started', started);
    record.submissions.forEach((submission, i) => {
      if (submission.submittedBy !== userId) return;
      const at = time(submission.at), ms = createDuration(record, i);
      push('submitted', at, { version: submission.version, ...(inside(at) && Number.isFinite(ms) ? { createMs: ms } : {}) });
      if (submission.decision?.action === 'approve' || submission.decision?.action === 'return') push(submission.decision.action === 'approve' ? 'approved' : 'returned', time(submission.decision.at), { version: submission.version });
    });
    const handled = handling(record), sentVersion = deliveredSubmissions(record).at(-1);
    if (sentVersion?.submittedBy === userId) push('sent', time(sentVersion.delivery!.at), { version: sentVersion.version, ...(handled && inside(handled.at) ? { handlingMs: handled.ms } : {}) });
    const declinedHere = record.closure?.kind === 'declined' && record.closure.by === userId;
    if (declinedHere) { push('declined', time(record.closure!.at)); if (inside(time(record.closure!.at))) declined++; }
    if (!events.some(event => event.inPeriod)) continue; // only proposals this employee worked on inside the period
    push('received', time(record.createdAt));
    events.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'received' ? -1 : b.kind === 'received' ? 1 : 0));
    proposals.push({ first: Math.min(...events.filter(event => event.inPeriod).map(event => Date.parse(event.at))),
      item: { inquiryId: record.id, company: record.fields.company || record.id, status: record.status, outcome: sentVersion ? 'sent' : record.closure?.kind === 'declined' ? 'declined' : 'open', events } });
  }
  proposals.sort((a, b) => a.first - b.first || a.item.inquiryId.localeCompare(b.item.inquiryId));
  const name = users.find(person => person.id === userId)?.name || userId, iso = (ms: number) => new Date(ms).toISOString();
  return {
    user: { id: userId, name }, range, period: periodKey(range, w.from), label: periodLabel(range, w.from), from: iso(w.from), to: iso(w.to), asOf: iso(now),
    summary: { created: row?.created || 0, sent: row?.sent || 0, declined, avgCreateMs: row?.avgCreateMs ?? null, avgHandlingMs: row?.avgHandlingMs ?? null },
    proposals: proposals.slice(0, MAX_TIMELINE).map(entry => entry.item), truncated: proposals.length > MAX_TIMELINE,
  };
}

const manilaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(value => Date.parse(value + 'T00:00:00+08:00')).refine(Number.isFinite, 'Use a valid date.');
const querySchema = z.object({ period: z.enum(['day', 'week', 'month']), from: manilaDate.optional(), to: manilaDate.optional() }).refine(q => (q.from === undefined) === (q.to === undefined), 'Give both from and to, or neither.').refine(q => q.from === undefined || q.to! >= q.from, 'to must not be before from.');
const rangeSchema = z.object({ range: z.enum(RANGE_KEYS), period: z.string().min(1).max(10).optional() });
const employeeSchema = rangeSchema.extend({ user: z.string().min(1).max(100) });
const readSnapshot = () => db.snapshot(async () => ({ records: await inquiries(), users: await allUsers() }));
/** GET monitoring/proposals?range=day|week|month|year[&period=key] (the Monitoring page) or the older ?period=day|week|month[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * (Manila dates). With range, `period` is the period key (see proposal-periods.ts) and defaults to the current period. Head and Supervisors only. */
export async function proposalStats(user: Staff, params: URLSearchParams): Promise<ProposalStats> {
  if (!canSeeProposalStats(user)) throw new AppError('You do not have access to Monitoring.', 403);
  if (params.has('range')) {
    const query = rangeSchema.parse({ range: params.get('range'), period: params.get('period') ?? undefined });
    const { records, users } = await readSnapshot();
    return computeRangeStats(records, users, query.range, Date.now(), query.period);
  }
  const query = querySchema.parse({ period: params.get('period') || 'day', from: params.get('from') || undefined, to: params.get('to') || undefined });
  const { records, users } = await readSnapshot();
  return computeProposalStats(records, users, query.period, Date.now(), query.from !== undefined ? { from: query.from, to: query.to! } : undefined);
}
/** GET monitoring/proposals/employee?user=<id>&range=…[&period=…]. Head and Supervisors only (the same rule as the dashboard); unknown user 404. */
export async function proposalEmployee(user: Staff, params: URLSearchParams): Promise<ProposalEmployeeDetail> {
  if (!canSeeProposalStats(user)) throw new AppError('You do not have access to Monitoring.', 403);
  const query = employeeSchema.parse({ user: params.get('user') ?? undefined, range: params.get('range') ?? undefined, period: params.get('period') ?? undefined });
  const now = Date.now();
  periodWindows(query.range, now, query.period); // validate the period before reading anything
  const { records, users } = await readSnapshot();
  if (!users.some(person => person.id === query.user)) throw new AppError('That employee was not found.', 404);
  return employeeTimeline(records, users, query.user, query.range, now, query.period);
}
