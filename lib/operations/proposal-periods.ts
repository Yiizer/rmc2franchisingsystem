// Monitoring periods (feedback round 2026-11-08b, items 1 and 1b). Pure and client-safe: the server validates with it and the page steps with it.
// Calendar periods in Manila time (UTC+8, no daylight saving): a day, a Monday-Sunday week, a calendar month, a calendar year.
// Period keys (the ?period= value): day YYYY-MM-DD · week YYYY-MM-DD of its Monday · month YYYY-MM · year YYYY.
import type { ProposalStatsRange } from './types';

export const HOUR = 3600000, DAY = 24 * HOUR, MANILA = 8 * HOUR;
export const RANGE_KEYS = ['day', 'week', 'month', 'year'] as const satisfies readonly ProposalStatsRange[];
/** How far back a request may go: periods that start on or after 1 January of (the current Manila year − LOOKBACK_YEARS). PO decision 2026-11-08. */
export const LOOKBACK_YEARS = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const wall = (ms: number) => new Date(ms + MANILA); // read with getUTC*: the Manila wall clock
const at = (year: number, month: number, day = 1) => Date.UTC(year, month, day) - MANILA; // Manila midnight; month/day may overflow
const dayOf = (ms: number) => Math.floor((ms + MANILA) / DAY) * DAY - MANILA;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Start (UTC ms) of the period of `range` that contains `ms`. */
export function periodStart(range: ProposalStatsRange, ms: number): number {
  const day = dayOf(ms), d = wall(ms);
  if (range === 'day') return day;
  if (range === 'week') return day - ((wall(day).getUTCDay() + 6) % 7) * DAY;
  if (range === 'month') return at(d.getUTCFullYear(), d.getUTCMonth());
  return at(d.getUTCFullYear(), 0);
}
/** Start of the period `steps` periods after (or before, when negative) the one starting at `start`. */
export function shiftPeriod(range: ProposalStatsRange, start: number, steps: number): number {
  if (range === 'day') return start + steps * DAY;
  if (range === 'week') return start + steps * 7 * DAY;
  const d = wall(start);
  return range === 'month' ? at(d.getUTCFullYear(), d.getUTCMonth() + steps) : at(d.getUTCFullYear() + steps, 0);
}
export const periodEnd = (range: ProposalStatsRange, start: number) => shiftPeriod(range, start, 1);
export function periodKey(range: ProposalStatsRange, start: number): string {
  const d = wall(start), ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return range === 'year' ? String(d.getUTCFullYear()) : range === 'month' ? ymd.slice(0, 7) : ymd;
}
/** The earliest period start a request may ask for. */
export function earliestStart(range: ProposalStatsRange, now: number): number {
  return periodStart(range, at(wall(now).getUTCFullYear() - LOOKBACK_YEARS, 0));
}

export type PeriodCheck = { ok: true; start: number } | { ok: false; error: string };
const SHAPES: Record<ProposalStatsRange, RegExp> = { day: /^(\d{4})-(\d{2})-(\d{2})$/, week: /^(\d{4})-(\d{2})-(\d{2})$/, month: /^(\d{4})-(\d{2})$/, year: /^(\d{4})$/ };
const FORMAT: Record<ProposalStatsRange, string> = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD (a Monday)', month: 'YYYY-MM', year: 'YYYY' };
/** Parses a ?period= key. Rejects a malformed or impossible date, a week key that is not a Monday, a future period and one before the lookback limit. */
export function parsePeriod(range: ProposalStatsRange, key: string, now: number): PeriodCheck {
  const match = SHAPES[range].exec(key);
  if (!match) return { ok: false, error: `Use period=${FORMAT[range]} for range=${range}.` };
  const [year, month = 1, day = 1] = match.slice(1).map(Number);
  if (month < 1 || month > 12) return { ok: false, error: 'That month does not exist.' };
  const start = at(year, month - 1, day), d = wall(start);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return { ok: false, error: 'That date does not exist.' };
  if (range === 'week' && d.getUTCDay() !== 1) return { ok: false, error: 'A week is given by its Monday.' };
  if (start > periodStart(range, now)) return { ok: false, error: 'That period has not started yet.' };
  if (start < earliestStart(range, now)) return { ok: false, error: `Monitoring goes back ${LOOKBACK_YEARS} years, to ${periodKey(range, earliestStart(range, now))}.` };
  return { ok: true, start };
}

/** "Sat 7 Nov 2026" · "Week of 2–8 Nov 2026" · "Week of 26 Oct – 1 Nov 2026" · "Week of 28 Dec 2026 – 3 Jan 2027" · "October 2026" · "2025". */
export function periodLabel(range: ProposalStatsRange, start: number): string {
  const d = wall(start);
  if (range === 'year') return String(d.getUTCFullYear());
  if (range === 'month') return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  if (range === 'day') return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const e = wall(start + 6 * DAY);
  if (d.getUTCFullYear() !== e.getUTCFullYear()) return `Week of ${d.getUTCDate()} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()} – ${e.getUTCDate()} ${SHORT[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  if (d.getUTCMonth() !== e.getUTCMonth()) return `Week of ${d.getUTCDate()} ${SHORT[d.getUTCMonth()]} – ${e.getUTCDate()} ${SHORT[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  return `Week of ${d.getUTCDate()}–${e.getUTCDate()} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** End of the previous period's comparison window when the selected period is the current one (PO 2026-11-08: like for like, to the same point).
 * Day / week: the same moment one day / one week earlier. Month / year: the same day and time one month / year earlier; a day the earlier
 * month does not have (31 Mar → Feb, 29 Feb → a non-leap year) clamps to the end of that month. */
export function sameMomentEarlier(range: ProposalStatsRange, now: number): number {
  if (range === 'day') return now - DAY;
  if (range === 'week') return now - 7 * DAY;
  const d = wall(now), timeOfDay = (now + MANILA) % DAY;
  const year = d.getUTCFullYear() - (range === 'year' ? 1 : 0), month = d.getUTCMonth() - (range === 'month' ? 1 : 0);
  const daysInMonth = wall(at(year, month + 1) - DAY).getUTCDate();
  return d.getUTCDate() > daysInMonth ? at(year, month + 1) : at(year, month, d.getUTCDate()) + timeOfDay;
}

/** Manila calendar date (YYYY-MM-DD) of a moment, e.g. for a native date input. */
export const manilaDay = (ms: number) => periodKey('day', ms);
/** Parses a YYYY-MM-DD Manila date to its midnight (NaN when invalid). */
export function manilaDayStart(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return NaN;
  const [y, m, d] = match.slice(1).map(Number), start = at(y, m - 1, d), w = wall(start);
  return w.getUTCFullYear() === y && w.getUTCMonth() === m - 1 && w.getUTCDate() === d ? start : NaN;
}
export const MONTH_NAMES = MONTHS;
