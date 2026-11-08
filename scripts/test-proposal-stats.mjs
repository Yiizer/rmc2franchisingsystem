// Feedback rounds 2026-11-07 (items 3, 4), 2026-11-08 and 2026-11-08b: proposal dashboard buckets, funnel, time per employee, calendar periods and the drill-down.
// computeProposalStats is pure, so the fixtures below have fixed timestamps and the expected numbers are hand-computed (see the tables).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './feedback-harness.mjs';

const t = await setup('proposal-stats');
const [stats, activity, service, forms] = await Promise.all(['proposal-stats', 'activity', 'service', 'forms'].map(t.load));

// ---------- Fixtures. "now" is Sunday 2026-11-08 10:00 Manila. Times are Manila (+08:00). ----------
const M = text => new Date(text + '+08:00').toISOString();
const NOW = Date.parse(M('2026-11-08T10:00:00'));
const H = 3600000;
const entry = (at, actorId, action) => ({ id: randomUUID(), at, actorId, actor: actorId, action });
const sub = (version, at, by, extra = {}) => ({ version, at, submittedBy: by, fields: {}, email: { to: '', subject: '', body: '' }, emailOverrides: [], generated: {}, notes: '', warnings: [], ...extra });
const approve = at => ({ action: 'approve', actorId: 'emerson', at, note: '', flags: [] });
const back = at => ({ action: 'return', actorId: 'emerson', at, note: 'fix', flags: [] });
const delivery = at => ({ id: randomUUID(), at, mode: 'local-test', file: '' });
const rec = (id, createdAt, status, over = {}) => ({ id, revision: 1, status, createdAt, updatedAt: createdAt, fields: {}, source: { filename: '', storage: '', sheet: '', cells: [], fields: {}, receivedAt: createdAt }, email: { to: '', subject: '', body: '' }, emailOverrides: [], templateId: '', submissions: [], handledBy: [], history: [entry(createdAt, 'intake', 'Agent inquiry received')], chat: [], notes: '', returnNote: '', returnFlags: [], detailRequests: [], ...over });
const started = (at, who) => entry(M(at), who, 'Started handling');

const records = [
  // R1/R3 are "not started"; R3 is 1 ms before Manila midnight of Nov 2, R2 is exactly Manila midnight.
  rec('R1', M('2026-11-01T23:30:00'), 'New inquiry'),
  rec('R2', M('2026-11-02T00:00:00'), 'New inquiry'),
  rec('R3', '2026-11-01T15:59:59.999Z', 'New inquiry'),
  // R4: Cryssa starts 10:00, submits v1 12:00, returned 14:00, saves 15:00, resubmits v2 17:30, approved Nov 4 08:00, delivered Nov 4 08:05.
  rec('R4', M('2026-11-03T09:00:00'), 'Sent', {
    history: [entry(M('2026-11-03T09:00:00'), 'intake', 'Agent inquiry received'), started('2026-11-03T10:00:00', 'cryssa'), entry(M('2026-11-03T15:00:00'), 'cryssa', 'Updated inquiry details')],
    submissions: [sub(1, M('2026-11-03T12:00:00'), 'cryssa', { decision: back(M('2026-11-03T14:00:00')) }), sub(2, M('2026-11-03T17:30:00'), 'cryssa', { decision: approve(M('2026-11-04T08:00:00')), delivery: delivery(M('2026-11-04T08:05:00')) })],
  }),
  // R5: Jefferson starts 09:00, submits 10:00, approved 11:00, delivered Nov 2 11:30.
  rec('R5', M('2026-11-02T08:00:00'), 'Sent', { history: [entry(M('2026-11-02T08:00:00'), 'intake', 'x'), started('2026-11-02T09:00:00', 'jefferson')], submissions: [sub(1, M('2026-11-02T10:00:00'), 'jefferson', { decision: approve(M('2026-11-02T11:00:00')), delivery: delivery(M('2026-11-02T11:30:00')) })] }),
  // R6: no start event at all (counted in Sent and the funnel, skipped in the timing).
  rec('R6', M('2026-11-05T09:00:00'), 'Sent', { submissions: [sub(1, M('2026-11-05T10:00:00'), 'cryssa', { decision: approve(M('2026-11-05T11:00:00')), delivery: delivery(M('2026-11-05T11:05:00')) })] }),
  // R7: declined on Sunday Nov 1 12:00 (created Oct 30).
  rec('R7', M('2026-10-30T10:00:00'), 'Declined', { closure: { kind: 'declined', at: M('2026-11-01T12:00:00'), by: 'cryssa', reason: 'duplicate request' } }),
  // R8 / R9: delivered one second before / exactly at the Sunday-to-Monday Manila midnight.
  rec('R8', M('2026-10-31T08:00:00'), 'Sent', { history: [entry(M('2026-10-31T08:00:00'), 'intake', 'x'), started('2026-10-31T09:00:00', 'judy')], submissions: [sub(1, M('2026-10-31T10:00:00'), 'judy', { decision: approve(M('2026-10-31T11:00:00')), delivery: delivery('2026-11-01T15:59:59.000Z') })] }),
  rec('R9', M('2026-10-31T08:00:00'), 'Sent', { history: [entry(M('2026-10-31T08:00:00'), 'intake', 'x'), started('2026-10-31T09:00:00', 'jefferson')], submissions: [sub(1, M('2026-10-31T10:00:00'), 'jefferson', { decision: approve(M('2026-10-31T11:00:00')), delivery: delivery('2026-11-01T16:00:00.000Z') })] }),
  // R10: an older record from before "Started handling" existed: the start is the first saved preparation (Sunday Oct 4 delivery).
  rec('R10', M('2026-10-03T09:00:00'), 'Sent', { history: [entry(M('2026-10-03T09:00:00'), 'intake', 'x'), entry(M('2026-10-03T10:00:00'), 'cryssa', 'Started / saved proposal preparation')], submissions: [sub(1, M('2026-10-03T12:00:00'), 'cryssa', { decision: approve(M('2026-10-03T13:00:00')), delivery: delivery(M('2026-10-04T10:00:00')) })] }),
];
const people = [{ id: 'cryssa', name: 'Cryssa Kate Aban' }, { id: 'jefferson', name: 'Jefferson Silot' }, { id: 'judy', name: 'Judy Villaruel' }];
const column = (result, key) => Object.fromEntries(result.buckets.filter(b => b[key]).map(b => [b.label, b[key]]));
const funnel = result => Object.fromEntries(result.funnel.map(f => [f.step, f.count]));
const timing = result => Object.fromEntries(result.timing.map(row => [row.userId, [row.created, row.avgCreateMs, row.sent, row.avgHandlingMs]]));
const min = 60000;

// ---------- DAY: Oct 26 .. Nov 8 (14 days) ----------
{
  const r = stats.computeProposalStats(records, people, 'day', NOW);
  assert.equal(r.buckets.length, 14);
  assert.equal(r.buckets[0].label, 'Oct 26');
  assert.equal(r.buckets[13].label, 'Nov 8');
  assert.equal(r.buckets[0].start, M('2026-10-26T00:00:00'), 'bucket starts are Manila midnights');
  assert.equal(r.from, M('2026-10-26T00:00:00'));
  assert.equal(r.to, M('2026-11-09T00:00:00'));
  // sent: Nov 1 R8 | Nov 2 R5,R9 (R9 at exactly Manila midnight) | Nov 4 R4 | Nov 5 R6.  R10 is outside.
  assert.deepEqual(column(r, 'sent'), { 'Nov 1': 1, 'Nov 2': 2, 'Nov 4': 1, 'Nov 5': 1 });
  assert.deepEqual(column(r, 'declined'), { 'Nov 1': 1 });
  // not yet sent = the backlog at each day's end (now for Nov 8): Oct 30 R7 | Oct 31 R7 R8 R9 | Nov 1 R1 R3 R9 (R7 declined 12:00, R8 sent 23:59:59,
  // R9 sent exactly at the next midnight, R2 received exactly at it) | Nov 2 R1 R2 R3 | Nov 3 + R4 | Nov 4 onward R1 R2 R3.
  assert.deepEqual(column(r, 'notSent'), { 'Oct 30': 1, 'Oct 31': 3, 'Nov 1': 3, 'Nov 2': 3, 'Nov 3': 4, 'Nov 4': 3, 'Nov 5': 3, 'Nov 6': 3, 'Nov 7': 3, 'Nov 8': 3 });
  // received R1-R9 (R10 is older); started R4,R5,R6,R8,R9 (R6 implied by its submission); the rest nest with the same 5.
  assert.deepEqual(funnel(r), { Received: 9, Started: 5, Submitted: 5, Approved: 5, Sent: 5 });
  // created: cryssa R4 v1 2h + v2 2.5h (anchor = the return at 14:00, first save 15:00 -> 17:30) | jefferson R5 1h, R9 1h | judy R8 1h; R6 has no start.
  // handling: cryssa R4 Nov 3 10:00 -> Nov 4 08:05 = 22h05m | jefferson R5 2h30m, R9 Oct 31 09:00 -> Nov 2 00:00 = 39h | judy R8 -> Nov 1 23:59:59 = 38h59m59s.
  assert.deepEqual(timing(r), {
    cryssa: [2, 8100000, 1, 22 * H + 5 * min],
    jefferson: [2, 3600000, 2, (2.5 * H + 39 * H) / 2],
    judy: [1, 3600000, 1, 38 * H + 59 * min + 59000],
  });
  assert.deepEqual(r.timing.map(row => row.name), ['Cryssa Kate Aban', 'Jefferson Silot', 'Judy Villaruel']);
  t.pass('DAY: sent / declined / not-yet-sent backlog per day, Manila midnight and Sunday-Monday edges, funnel 9/5/5/5/5, timing per employee (hand-computed)');
}

// ---------- WEEK: 12 weeks ending with Mon Nov 2 - Sun Nov 8 ----------
{
  const r = stats.computeProposalStats(records, people, 'week', NOW);
  assert.equal(r.buckets.length, 12);
  assert.equal(r.buckets[11].label, 'Nov 2–8');
  assert.equal(r.buckets[10].label, 'Oct 26–Nov 1');
  assert.equal(r.buckets[11].start, M('2026-11-02T00:00:00'), 'a week starts on Monday, Manila time');
  assert.equal(r.buckets[0].label, 'Aug 17–23');
  assert.deepEqual(column(r, 'sent'), { 'Sep 28–Oct 4': 1, 'Oct 26–Nov 1': 1, 'Nov 2–8': 4 }); // R10 | R8 (Sunday 23:59:59) | R4,R5,R6,R9 (R9 Monday 00:00)
  assert.deepEqual(column(r, 'declined'), { 'Oct 26–Nov 1': 1 });
  assert.deepEqual(column(r, 'notSent'), { 'Oct 26–Nov 1': 3, 'Nov 2–8': 3 }, 'R1 R3 R9 at Mon 00:00 | R1 R2 R3 now');
  assert.deepEqual(funnel(r), { Received: 10, Started: 6, Submitted: 6, Approved: 6, Sent: 6 });
  // R10 adds cryssa: created 2h (start = first saved preparation) and handling 24h. cryssa created (2h+2.5h+2h)/3 = 2h20m, handling (22h05m + 24h)/2.
  assert.deepEqual(timing(r), {
    cryssa: [3, (7200000 + 9000000 + 7200000) / 3, 2, (22 * H + 5 * min + 24 * H) / 2],
    jefferson: [2, 3600000, 2, (2.5 * H + 39 * H) / 2],
    judy: [1, 3600000, 1, 38 * H + 59 * min + 59000],
  });
  t.pass('WEEK: Monday-Sunday buckets in Manila time, funnel 10/6/6/6/6, the pre-"Started handling" record uses its first saved preparation');
}

// ---------- MONTH ----------
{
  const r = stats.computeProposalStats(records, people, 'month', NOW);
  assert.equal(r.buckets.length, 12);
  assert.equal(r.buckets[0].label, 'Dec 2025');
  assert.equal(r.buckets[11].label, 'Nov 2026');
  assert.equal(r.buckets[11].start, M('2026-11-01T00:00:00'));
  assert.deepEqual(column(r, 'sent'), { 'Oct 2026': 1, 'Nov 2026': 5 });
  assert.deepEqual(column(r, 'declined'), { 'Nov 2026': 1 });
  assert.deepEqual(column(r, 'notSent'), { 'Oct 2026': 3, 'Nov 2026': 3 }, 'R7 R8 R9 at Nov 1 00:00 | R1 R2 R3 now');
  assert.deepEqual(funnel(r), { Received: 10, Started: 6, Submitted: 6, Approved: 6, Sent: 6 });
  t.pass('MONTH: Dec 2025 .. Nov 2026, October and November counts, funnel 10/6/6/6/6');
}

// ---------- A "now" exactly at Monday 00:00 Manila starts a new week; the funnel steps are always nested ----------
{
  const r = stats.computeProposalStats(records, people, 'week', Date.parse(M('2026-11-09T00:00:00')));
  assert.equal(r.buckets[11].label, 'Nov 9–15');
  assert.equal(r.buckets[11].sent, 0);
  assert.equal(r.buckets[10].label, 'Nov 2–8');
  assert.equal(r.buckets[10].sent, 4);
  const f = r.funnel.map(item => item.count);
  assert.ok(f.every((count, i) => i === 0 || count <= f[i - 1]), 'each step is a subset of the step before it');
  // a record whose submission exists but whose history lost the start line still counts as started
  const odd = rec('ODD', M('2026-11-06T09:00:00'), 'Awaiting approval', { submissions: [sub(1, M('2026-11-06T10:00:00'), 'judy')] });
  const f2 = stats.computeProposalStats([odd], people, 'day', NOW).funnel.map(item => item.count);
  assert.deepEqual(f2, [1, 1, 1, 0, 0]);
  // explicit from/to range (Manila dates) covering Nov 2 .. Nov 4 only
  const ranged = stats.computeProposalStats(records, people, 'day', NOW, { from: Date.parse(M('2026-11-02T00:00:00')), to: Date.parse(M('2026-11-04T00:00:00')) });
  assert.deepEqual(ranged.buckets.map(b => b.label), ['Nov 2', 'Nov 3', 'Nov 4']);
  assert.deepEqual(column(ranged, 'sent'), { 'Nov 2': 2, 'Nov 4': 1 });
  t.pass('A new week begins at Manila midnight; funnel steps nest; explicit ranges work');
}

// ---------- A supervisor revision is not the preparer's creation; a manual confirmation counts for handling time ----------
{
  const revised = rec('REV', M('2026-11-06T08:00:00'), 'Sent', {
    history: [entry(M('2026-11-06T08:00:00'), 'intake', 'x'), started('2026-11-06T09:00:00', 'judy')],
    submissions: [sub(1, M('2026-11-06T10:00:00'), 'judy', { supersededBy: 2 }), sub(2, M('2026-11-06T11:00:00'), 'judy', { supervisorRevision: { by: 'emerson', fromVersion: 1 }, decision: approve(M('2026-11-06T11:30:00')), delivery: { ...delivery(M('2026-11-06T13:00:00')), confirmedManually: true } })],
  });
  const r = stats.computeProposalStats([revised], people, 'day', NOW);
  assert.deepEqual(timing(r), { judy: [1, H, 1, 4 * H] }, 'v1 counts (1h); the supervisor revision does not; handling 09:00 -> confirmed 13:00 = 4h');
  // Sent in the funnel means a delivered submission, like the Sent bucket (status alone is not enough)
  const statusOnly = rec('SO', M('2026-11-06T09:00:00'), 'Sent', { submissions: [sub(1, M('2026-11-06T10:00:00'), 'judy', { decision: approve(M('2026-11-06T11:00:00')) })] });
  assert.deepEqual(stats.computeProposalStats([statusOnly], people, 'day', NOW).funnel.map(f => f.count), [1, 1, 1, 1, 0]);
  t.pass('Supervisor revisions are skipped for creation time; manually confirmed sends count for handling time');
}

// ---------- Permissions ----------
{
  const view = async who => t.status(stats.proposalStats(who, new URLSearchParams({ period: 'day' })));
  assert.equal(await view(t.user('emerson')), 200);
  assert.equal(await view(t.user('zeo')), 200);
  for (const id of ['cryssa', 'admin', 'division-head', 'soa'])assert.equal(await view(t.user(id)), 403, id);
  assert.equal(await t.status(stats.proposalStats(t.user('emerson'), new URLSearchParams({ period: 'year' }))), 400);
  assert.equal(await t.status(stats.proposalStats(t.user('emerson'), new URLSearchParams({ period: 'day', from: '2026-11-01' }))), 400);
  const live = await stats.proposalStats(t.user('emerson'), new URLSearchParams({ period: 'week' }));
  assert.equal(live.buckets.length, 12);
  assert.equal(live.funnel.length, 5);
  const perm = await t.load('permissions');
  assert.equal(perm.canSeeAiUsage({ role: 'Admin' }), true, 'canSeeAiUsage is unchanged');
  t.pass('Head and Supervisor read the stats; Employee, Admin, Division Head, SOA get 403; bad period or half a range gets 400');
}

// ---------- "Started handling": logged once per user, without a revision bump ----------
{
  const cryssa = t.user('cryssa'), jefferson = t.user('jefferson');
  const bytes = await forms.sampleForm({ company: 'Start Log Co', sector: 'Private', industry: 'Services', address: 'Antipolo City', branch: 'Antipolo', requestDate: '2026-11-05', agentName: 'Agent', agentPhone: '09175550001', contactName: 'Contact', contactEmail: 'c@example.com', contactPhone: '09985550001', contactPosition: 'HR', existingProvider: 'None', addressee: 'Contact', addresseePosition: 'HR', requestedPlan: 'Group', payment: 'Annual', employees: '20', dependents: '0', employeeAges: '22-50', dependentAges: '', hospitals: '', dental: '' });
  const created = await service.intake(cryssa, new File([new Uint8Array(bytes)], 'start.xlsx'), 'agent@example.com');
  const act = async (who, action, tab) => activity.updateInquiryActivity(created.id, who, await t.session(who), { tab, action });
  const tabA = randomUUID(), tabB = randomUUID(), tabC = randomUUID();
  const before = await t.get(created.id);
  assert.equal((await act(cryssa, 'start', tabA)).handling, true);
  let after = await t.get(created.id);
  assert.equal(after.revision, before.revision, 'a start does not bump the revision');
  assert.equal(after.history.filter(e => e.action === 'Started handling' && e.actorId === 'cryssa').length, 1);
  await act(cryssa, 'start', tabB); // a second tab by the same user
  await act(cryssa, 'leave', tabA); await act(cryssa, 'leave', tabB);
  await act(cryssa, 'start', tabC); // a later start after leaving
  after = await t.get(created.id);
  assert.equal(after.history.filter(e => e.action === 'Started handling').length, 1, 'only the first start per user is logged');
  await act(cryssa, 'leave', tabC);
  assert.equal((await act(jefferson, 'start', randomUUID())).handling, true);
  after = await t.get(created.id);
  assert.deepEqual(after.history.filter(e => e.action === 'Started handling').map(e => e.actorId), ['cryssa', 'jefferson']);
  assert.equal(after.revision, before.revision, 'still no revision bump');
  assert.equal(activity.STARTED_HANDLING, 'Started handling');
  // The saved copy still accepts a normal save made against the old revision (nobody's open copy went stale)
  const saved = await service.saveDraft(created.id, jefferson, { revision: before.revision, fields: { ...after.fields }, templateId: '', notes: '', email: { to: '', subject: 'x', body: 'y' }, emailOverrides: [] });
  assert.equal(saved.revision, before.revision + 1);
  t.pass('First start per user writes one "Started handling" line without bumping the revision; later starts add nothing; a save on the old revision still works');
}

// ========== Feedback round 2026-11-08b: calendar periods (range=day|week|month|year), past periods (&period=), like-for-like deltas, drill-down ==========
const types = await t.load('types');
const periods = await t.load('proposal-periods');
const totals = w => ({ received: w.received, sent: w.sent, declined: w.declined, notSent: w.notSent });
const kpis = s => Object.fromEntries(['received', 'sent', 'declined', 'notSent'].map(k => [k, types.kpiDelta(s.current[k], s.previous[k], k === 'received' || k === 'sent')]));
const weekdays = s => Object.fromEntries(s.weekdays.filter(d => d.sent).map(d => [d.day, d.sent]));
const ms = text => Date.parse(M(text));

// ---------- Period keys, labels and validation (proposal-periods.ts) ----------
{
  const P = periods, ok = (range, key, now = NOW) => P.parsePeriod(range, key, now).ok;
  // labels
  assert.equal(P.periodLabel('day', ms('2026-11-07T00:00:00')), 'Sat 7 Nov 2026');
  assert.equal(P.periodLabel('week', ms('2026-11-02T00:00:00')), 'Week of 2–8 Nov 2026');
  assert.equal(P.periodLabel('week', ms('2026-10-26T00:00:00')), 'Week of 26 Oct – 1 Nov 2026', 'a week across two months');
  assert.equal(P.periodLabel('week', ms('2026-12-28T00:00:00')), 'Week of 28 Dec 2026 – 3 Jan 2027', 'a week across two years');
  assert.equal(P.periodLabel('month', ms('2026-10-01T00:00:00')), 'October 2026');
  assert.equal(P.periodLabel('year', ms('2025-01-01T00:00:00')), '2025');
  // week start (Monday, Manila) and Manila midnight edges
  assert.equal(P.periodKey('week', P.periodStart('week', NOW)), '2026-11-02', 'Sunday Nov 8 belongs to the week of Monday Nov 2');
  assert.equal(P.periodKey('week', P.periodStart('week', ms('2026-11-09T00:00:00'))), '2026-11-09', 'Monday 00:00 starts a new week');
  assert.equal(P.periodKey('week', P.periodStart('week', ms('2026-01-01T12:00:00'))), '2025-12-29', 'Thursday 1 Jan 2026 is in the week of Monday 29 Dec 2025');
  assert.equal(P.periodKey('day', P.periodStart('day', Date.parse('2026-11-01T15:59:59.999Z'))), '2026-11-01');
  assert.equal(P.periodKey('day', P.periodStart('day', Date.parse('2026-11-01T16:00:00.000Z'))), '2026-11-02', '16:00 UTC is Manila midnight');
  // stepping across month and year boundaries
  assert.equal(P.periodKey('month', P.shiftPeriod('month', ms('2026-01-01T00:00:00'), -1)), '2025-12');
  assert.equal(P.periodKey('month', P.shiftPeriod('month', ms('2025-12-01T00:00:00'), 1)), '2026-01');
  assert.equal(P.periodKey('year', P.shiftPeriod('year', ms('2026-01-01T00:00:00'), -1)), '2025');
  assert.equal(P.periodKey('day', P.shiftPeriod('day', ms('2026-03-01T00:00:00'), -1)), '2026-02-28');
  assert.equal(P.periodKey('day', P.shiftPeriod('day', ms('2028-03-01T00:00:00'), -1)), '2028-02-29', 'leap year');
  assert.equal(P.periodKey('week', P.shiftPeriod('week', ms('2027-01-04T00:00:00'), -1)), '2026-12-28');
  // validation: malformed, impossible, not a Monday, future, too old
  for (const [range, key] of [['month', '2026-13'], ['month', '2026-1'], ['day', '2026-02-30'], ['day', '2026-02-29'], ['day', 'abc'], ['day', ' 2026-11-01'], ['year', '26'], ['week', '2026-11-03'], ['month', '2026-11-01']])
    assert.equal(ok(range, key), false, `${range}=${key} is rejected`);
  assert.equal(ok('day', '2028-02-29', ms('2028-03-01T09:00:00')), true, '29 Feb in a leap year is a real day');
  assert.equal(ok('week', '2026-11-02'), true);
  for (const [range, key] of [['day', '2026-11-09'], ['week', '2026-11-09'], ['month', '2026-12'], ['year', '2027']])
    assert.match(P.parsePeriod(range, key, NOW).error, /not started yet/, `future ${range} ${key}`);
  for (const [range, key] of [['day', '2026-11-08'], ['month', '2026-11'], ['year', '2026']]) assert.equal(ok(range, key), true, 'the current period is allowed');
  // lookback: 5 years, from 1 Jan 2021 (Manila); a week reaches back to the Monday of the week holding 1 Jan 2021
  assert.equal(P.LOOKBACK_YEARS, 5);
  assert.equal(ok('year', '2021'), true); assert.match(P.parsePeriod('year', '2020', NOW).error, /goes back 5 years/);
  assert.equal(ok('month', '2021-01'), true); assert.equal(ok('month', '2020-12'), false);
  assert.equal(ok('day', '2021-01-01'), true); assert.equal(ok('day', '2020-12-31'), false);
  assert.equal(ok('week', '2020-12-28'), true); assert.equal(ok('week', '2020-12-21'), false);
  // like-for-like comparison point, with the clamp for a day the earlier month or year does not have
  assert.equal(new Date(P.sameMomentEarlier('month', ms('2026-03-15T09:00:00'))).toISOString(), M('2026-02-15T09:00:00'));
  assert.equal(new Date(P.sameMomentEarlier('month', ms('2026-03-31T15:00:00'))).toISOString(), M('2026-03-01T00:00:00'), '31 Mar compares with the whole of February');
  assert.equal(new Date(P.sameMomentEarlier('year', ms('2028-02-29T10:00:00'))).toISOString(), M('2027-03-01T00:00:00'), '29 Feb compares with all of Feb 2027');
  assert.equal(new Date(P.sameMomentEarlier('year', ms('2026-11-08T10:00:00'))).toISOString(), M('2025-11-08T10:00:00'));
  assert.equal(new Date(P.sameMomentEarlier('month', ms('2026-01-20T10:00:00'))).toISOString(), M('2025-12-20T10:00:00'), 'January compares with December of the year before');
  t.pass('Periods: labels, Monday week start, Manila midnight, month/year/leap-year stepping, malformed/impossible/non-Monday/future/too-old keys rejected, like-for-like clamp');
}

// ---------- Weekly, current week (Mon Nov 2 .. Sun Nov 8), compared like for like with Mon Oct 26 .. Sun Nov 1 10:00 ----------
//            received                 sent                          declined                not yet sent (backlog at the window's end)
// current    R2 R4 R5 R6         = 4  R5 R9(00:00 Nov 2) R4 R6 = 4  —                   = 0  R1 R2 R3 now                      = 3
// previous   R7 R8 R9            = 3  (R8 Nov 1 23:59 is later) = 0 (R7 Nov 1 12:00 later) 0  R7 R8 R9 at Sun Nov 1 10:00     = 3
{
  const r = stats.computeRangeStats(records, people, 'week', NOW), s = r.summary;
  assert.equal(r.period, 'day');
  assert.deepEqual(r.buckets.map(b => b.label), ['Nov 2', 'Nov 3', 'Nov 4', 'Nov 5', 'Nov 6', 'Nov 7', 'Nov 8']);
  assert.equal(r.buckets.some(b => b.future), false, 'Sunday is the last day and has started');
  assert.equal(s.period, '2026-11-02'); assert.equal(s.label, 'Week of 2–8 Nov 2026'); assert.equal(s.currentPeriod, '2026-11-02'); assert.equal(s.earliestPeriod, '2020-12-28');
  assert.equal(s.toDate, true); assert.equal(s.previousLabel, 'Week of 26 Oct – 1 Nov 2026');
  assert.equal(s.current.from, M('2026-11-02T00:00:00')); assert.equal(s.current.to, M('2026-11-09T00:00:00'));
  assert.equal(s.previous.from, M('2026-10-26T00:00:00')); assert.equal(s.previous.to, M('2026-11-01T10:00:00'), 'previous week up to the same moment');
  assert.deepEqual(totals(s.current), { received: 4, sent: 4, declined: 0, notSent: 3 });
  assert.deepEqual(totals(s.previous), { received: 3, sent: 0, declined: 0, notSent: 3 });
  assert.deepEqual(kpis(s).notSent, { text: '0%', tone: 'neutral', direction: 'flat' }, '3 now vs 3 by this point last week');
  assert.deepEqual(kpis(s).received, { text: '33%', tone: 'good', direction: 'up' });
  assert.deepEqual(kpis(s).sent, { text: '—', tone: 'neutral', direction: 'flat' }, 'no sends by that point last week');
  assert.deepEqual(weekdays(s), { Mon: 2, Wed: 1, Thu: 1 });
  assert.deepEqual(funnel(r), { Received: 4, Started: 3, Submitted: 3, Approved: 3, Sent: 3 });
  assert.equal(s.sentRate, 75);
  t.pass('Weekly (current): Monday-Sunday days, like-for-like previous window ends at the same moment last week, deltas, weekdays, sent rate');
}

// ---------- Weekly, past week Oct 26 .. Nov 1 (?period=2026-10-26): compared with the whole week before ----------
{
  const r = stats.computeRangeStats(records, people, 'week', NOW, '2026-10-26'), s = r.summary;
  assert.equal(s.toDate, false); assert.equal(s.label, 'Week of 26 Oct – 1 Nov 2026'); assert.equal(s.currentPeriod, '2026-11-02');
  assert.equal(s.previous.from, M('2026-10-19T00:00:00')); assert.equal(s.previous.to, M('2026-10-26T00:00:00'), 'a whole week');
  assert.deepEqual(totals(s.current), { received: 5, sent: 1, declined: 1, notSent: 3 }, 'R1 R3 R7 R8 R9 received; R8 sent; R7 declined; R1 R3 R9 waiting at Mon Nov 2 00:00');
  assert.deepEqual(totals(s.previous), { received: 0, sent: 0, declined: 0, notSent: 0 });
  assert.deepEqual(timing(r), { judy: [1, H, 1, 38 * H + 59 * min + 59000], jefferson: [1, H, 0, null] }, 'time per employee follows the period');
  t.pass('Weekly (past): ?period=2026-10-26, whole previous week, the timing table follows the selected period');
}

// ---------- Monthly: November so far vs October 1-8 10:00; October 2026 vs all of September; 28/29/31 daily buckets ----------
{
  const r = stats.computeRangeStats(records, people, 'month', NOW), s = r.summary;
  assert.equal(r.buckets.length, 30); assert.equal(r.buckets[0].label, 'Nov 1'); assert.equal(r.buckets[29].label, 'Nov 30');
  assert.equal(r.buckets.filter(b => b.future).length, 22, 'Nov 9-30 are still to come');
  assert.equal(s.previous.to, M('2026-10-08T10:00:00'));
  assert.deepEqual(totals(s.current), { received: 6, sent: 5, declined: 1, notSent: 3 });
  assert.deepEqual(totals(s.previous), { received: 1, sent: 1, declined: 0, notSent: 0 }, 'R10 (Oct 3 / sent Oct 4) is before Oct 8 10:00');
  const october = stats.computeRangeStats(records, people, 'month', NOW, '2026-10').summary;
  assert.equal(october.label, 'October 2026'); assert.equal(october.toDate, false); assert.equal(october.previousLabel, 'September 2026');
  assert.deepEqual(totals(october.current), { received: 4, sent: 1, declined: 0, notSent: 3 }, 'R7 R8 R9 were still waiting at Nov 1 00:00 (closed / sent later)');
  assert.equal(october.previous.from, M('2026-09-01T00:00:00')); assert.equal(october.previous.to, M('2026-10-01T00:00:00'));
  assert.equal(stats.computeRangeStats(records, people, 'month', NOW, '2026-10').buckets.length, 31);
  assert.equal(stats.computeRangeStats([], people, 'month', NOW, '2026-02').buckets.length, 28);
  assert.equal(stats.computeRangeStats([], people, 'month', ms('2028-06-01T00:00:00'), '2028-02').buckets.length, 29, 'February in a leap year');
  const jan = stats.computeRangeStats([rec('J', M('2025-12-31T23:59:00'), 'New inquiry'), rec('K', M('2026-01-01T00:00:00'), 'New inquiry')], people, 'month', NOW, '2026-01').summary;
  assert.equal(jan.current.received, 1, 'Jan 1 00:00 Manila is January'); assert.equal(jan.previous.received, 1, 'Dec 31 23:59 is December'); assert.equal(jan.previousLabel, 'December 2025');
  t.pass('Monthly: current month to date vs the same point last month, past month vs the whole month before, 28/29/30/31 days, the year boundary');
}

// ---------- Yearly: 2026 so far vs 2025 to Nov 8 10:00; a past year; Today in hours ----------
{
  const r = stats.computeRangeStats(records, people, 'year', NOW), s = r.summary;
  assert.equal(r.period, 'month'); assert.equal(r.buckets.length, 12); assert.equal(r.buckets[0].label, 'Jan 2026');
  assert.deepEqual(r.buckets.filter(b => b.future).map(b => b.label), ['Dec 2026']);
  assert.equal(s.label, '2026'); assert.equal(s.previous.to, M('2025-11-08T10:00:00')); assert.equal(s.current.received, 10);
  const y2025 = stats.computeRangeStats(records, people, 'year', NOW, '2025').summary;
  assert.equal(y2025.toDate, false); assert.equal(y2025.current.received, 0); assert.equal(y2025.previousLabel, '2024');
  const day = stats.computeRangeStats(records, people, 'day', NOW, '2026-11-02');
  assert.equal(day.period, 'hour'); assert.equal(day.buckets.length, 24); assert.equal(day.buckets[0].label, '12 AM'); assert.equal(day.buckets[13].label, '1 PM');
  assert.deepEqual(column(day, 'received'), { '12 AM': 1, '8 AM': 1 }, 'R2 at midnight, R5 at 08:00');
  assert.deepEqual(column(day, 'sent'), { '12 AM': 1, '11 AM': 1 }, 'R9 at midnight, R5 at 11:30');
  assert.equal(day.summary.label, 'Mon 2 Nov 2026'); assert.equal(day.summary.previousLabel, 'Sun 1 Nov 2026');
  assert.deepEqual(totals(day.summary.previous), { received: 2, sent: 1, declined: 1, notSent: 3 }, 'the whole of Sunday Nov 1; R1 R3 R9 waiting at its end');
  const today = stats.computeRangeStats(records, people, 'day', NOW);
  assert.equal(today.buckets.filter(b => b.future).length, 13, 'after 10 AM');
  assert.equal(today.summary.previous.to, M('2026-11-07T10:00:00'), 'yesterday up to the same time');
  const none = stats.computeRangeStats([], people, 'week', NOW).summary;
  assert.equal(none.sentRate, null); assert.deepEqual(totals(none.current), { received: 0, sent: 0, declined: 0, notSent: 0 });
  assert.throws(() => stats.computeRangeStats(records, people, 'year', NOW, '2027'), e => e.status === 400, 'a future year is rejected');
  assert.throws(() => stats.computeRangeStats(records, people, 'month', NOW, '2020-12'), e => e.status === 400, 'older than the lookback is rejected');
  t.pass('Yearly: months, to-date comparison, a past year; Today: 24 hourly buckets, yesterday to the same time; future and too-old periods throw 400');
}

// ---------- Not yet sent (PO 2026-11-08c): every open inquiry with no delivered submission and no closure, whatever its received date ----------
{
  const backlog = [
    rec('OLD', M('2026-06-01T09:00:00'), 'Preparing proposal'),                  // received months before the period, never sent: counts
    rec('APR', M('2026-11-03T09:00:00'), 'Approved', { submissions: [sub(1, M('2026-11-03T10:00:00'), 'judy', { decision: approve(M('2026-11-03T11:00:00')) })] }), // approved, not delivered: counts
    rec('DRY', M('2026-11-03T09:00:00'), 'Sent', { submissions: [sub(1, M('2026-11-03T10:00:00'), 'judy', { delivery: { ...delivery(M('2026-11-03T12:00:00')), dryRun: true } })] }), // a dry run is not a send: counts
    rec('DEC', M('2026-10-20T09:00:00'), 'Declined', { closure: { kind: 'declined', at: M('2026-11-04T09:00:00'), by: 'cryssa', reason: 'x' } }),
    rec('TRF', M('2026-10-20T09:00:00'), 'New inquiry', { closure: { kind: 'transferred', at: M('2026-11-05T09:00:00'), by: 'cryssa', reason: 'x', relatedId: 'OTHER' } }),
    rec('SNT', M('2026-10-25T09:00:00'), 'Sent', { submissions: [sub(1, M('2026-10-26T10:00:00'), 'judy', { decision: approve(M('2026-10-26T11:00:00')), delivery: delivery(M('2026-11-06T09:00:00')) })] }),
  ];
  // Now (Sun Nov 8 10:00): OLD APR DRY wait; DEC and TRF are closed, SNT is sent. Monthly November is compared with Oct 8 10:00, when only OLD waited.
  const month = stats.computeRangeStats(backlog, people, 'month', NOW).summary;
  assert.equal(month.current.notSent, 3, 'an unsent inquiry from before the period counts; declined, transferred and sent ones do not');
  assert.equal(month.previous.notSent, 1);
  assert.deepEqual(types.kpiDelta(month.current.notSent, month.previous.notSent, false), { text: '200%', tone: 'bad', direction: 'up' }, 'a rise is red');
  // A past period is counted at its end: at Nov 1 00:00 OLD DEC TRF SNT were all still waiting (closed / sent later); APR and DRY were not received yet.
  const october = stats.computeRangeStats(backlog, people, 'month', NOW, '2026-10').summary;
  assert.equal(october.current.notSent, 4);
  assert.equal(october.current.received, 3, 'received still counts only the period (DEC TRF SNT)');
  // The current week, day by day: Nov 2 OLD DEC TRF SNT | Nov 3 + APR DRY | Nov 4 DEC declined | Nov 5 TRF transferred | Nov 6 SNT sent | Nov 8 now.
  const week = stats.computeRangeStats(backlog, people, 'week', NOW);
  assert.deepEqual(week.buckets.map(b => b.notSent), [4, 6, 5, 4, 3, 3, 3]);
  assert.equal(week.summary.current.notSent, week.buckets.at(-1).notSent, 'the KPI is the last bucket\'s backlog, not a sum');
  // Today: the future hours carry no backlog value; the past ones do.
  const today = stats.computeRangeStats(backlog, people, 'day', NOW);
  assert.ok(today.buckets.filter(b => b.future).every(b => b.notSent === 0));
  assert.equal(today.buckets[9].notSent, 3, '9 AM bucket, counted at 10:00 = now');
  t.pass('Not yet sent: the backlog as of now (current) or the period end (past), whatever the received date; declined, transferred and sent excluded; dry runs are not sends');
}

// ---------- The route: roles and validation ----------
{
  const view = async (who, query) => t.status(stats.proposalStats(who, new URLSearchParams(query)));
  assert.equal(await view(t.user('emerson'), { range: 'month' }), 200);
  assert.equal(await view(t.user('zeo'), { range: 'year' }), 200);
  for (const id of ['cryssa', 'admin', 'division-head', 'soa']) assert.equal(await view(t.user(id), { range: 'week' }), 403, id);
  for (const query of [{ range: '30d' }, { range: '12m' }, { range: 'month', period: '2099-01' }, { range: 'month', period: 'bad' }, { range: 'week', period: '2026-11-03' }, { range: 'day', period: '2000-01-01' }, { range: 'year', period: '2026-01-01-extra' }])
    assert.equal(await view(t.user('emerson'), query), 400, JSON.stringify(query));
  const live = await stats.proposalStats(t.user('emerson'), new URLSearchParams({ range: 'month' }));
  assert.equal(live.summary.range, 'month'); assert.equal(live.summary.period, live.summary.currentPeriod); assert.equal(live.summary.weekdays.length, 7);
  const lastYear = await stats.proposalStats(t.user('emerson'), new URLSearchParams({ range: 'year', period: String(Number(live.summary.currentPeriod.slice(0, 4)) - 1) }));
  assert.equal(lastYear.summary.toDate, false);
  const old = await stats.proposalStats(t.user('emerson'), new URLSearchParams({ period: 'day' }));
  assert.equal(old.summary, undefined, 'the period form is unchanged');
  t.pass('range: Head and Supervisor 200; others 403; old ranges, malformed, non-Monday, future and too-old periods 400; the period form still works');
}

// ---------- Drill-down (item 5): one employee's summary and timeline ----------
{
  const d = stats.employeeTimeline(records, people, 'cryssa', 'week', NOW);
  const row = stats.computeRangeStats(records, people, 'week', NOW).timing.find(x => x.userId === 'cryssa');
  assert.deepEqual(d.summary, { created: row.created, sent: row.sent, declined: 0, avgCreateMs: row.avgCreateMs, avgHandlingMs: row.avgHandlingMs }, 'the summary is the Time per employee row');
  assert.deepEqual(d.summary, { created: 2, sent: 1, declined: 0, avgCreateMs: 8100000, avgHandlingMs: 22 * H + 5 * min });
  assert.equal(d.label, 'Week of 2–8 Nov 2026'); assert.equal(d.user.name, 'Cryssa Kate Aban');
  assert.deepEqual(d.proposals.map(p => p.inquiryId), ['R4', 'R6'], 'oldest first; R7 (declined Nov 1) and R10 (October) are outside this week');
  const r4 = d.proposals[0];
  assert.equal(r4.outcome, 'sent');
  assert.deepEqual(r4.events.map(e => [e.kind, e.at, e.version, e.createMs, e.handlingMs]), [
    ['received', M('2026-11-03T09:00:00'), undefined, undefined, undefined],
    ['started', M('2026-11-03T10:00:00'), undefined, undefined, undefined],
    ['submitted', M('2026-11-03T12:00:00'), 1, 2 * H, undefined],
    ['returned', M('2026-11-03T14:00:00'), 1, undefined, undefined],
    ['submitted', M('2026-11-03T17:30:00'), 2, 2.5 * H, undefined],
    ['approved', M('2026-11-04T08:00:00'), 2, undefined, undefined],
    ['sent', M('2026-11-04T08:05:00'), 2, undefined, 22 * H + 5 * min],
  ]);
  assert.deepEqual(d.proposals[1].events.map(e => e.kind), ['received', 'submitted', 'approved', 'sent'], 'R6 has no start, so no time to create or handling');
  assert.ok(d.proposals[1].events.every(e => e.createMs === undefined && e.handlingMs === undefined));
  const creates = d.proposals.flatMap(p => p.events).filter(e => e.createMs !== undefined).map(e => e.createMs);
  assert.equal(creates.length, d.summary.created); assert.equal(Math.round(creates.reduce((a, b) => a + b, 0) / creates.length), d.summary.avgCreateMs, 'the timeline adds up to the summary');
  assert.equal(d.proposals.flatMap(p => p.events).filter(e => e.handlingMs !== undefined).length, d.summary.sent);
  // past week: Cryssa declined R7 on Sunday Nov 1
  const past = stats.employeeTimeline(records, people, 'cryssa', 'week', NOW, '2026-10-26');
  assert.equal(past.summary.declined, 1);
  assert.deepEqual(past.proposals.map(p => [p.inquiryId, p.outcome, p.events.map(e => e.kind)]), [['R7', 'declined', ['received', 'declined']]]);
  // an event outside the period is still shown, marked
  const oct = stats.employeeTimeline(records, people, 'judy', 'month', NOW, '2026-10');
  assert.deepEqual(oct.proposals[0].events.map(e => [e.kind, e.inPeriod]), [['received', true], ['started', true], ['submitted', true], ['approved', true], ['sent', false]], 'R8 was sent on Nov 1');
  assert.equal(oct.summary.sent, 0, 'the send counts in November, not October');
  // empty, cap
  const idle = stats.employeeTimeline(records, people, 'judy', 'week', NOW);
  assert.deepEqual(idle.summary, { created: 0, sent: 0, declined: 0, avgCreateMs: null, avgHandlingMs: null }); assert.deepEqual(idle.proposals, []);
  const many = Array.from({ length: stats.MAX_TIMELINE + 5 }, (_, i) => rec('M' + i, M('2026-11-03T09:00:00'), 'Awaiting approval', { history: [started('2026-11-03T09:30:00', 'judy')], submissions: [sub(1, M('2026-11-03T10:00:00'), 'judy')] }));
  const capped = stats.employeeTimeline(many, people, 'judy', 'week', NOW);
  assert.equal(capped.proposals.length, stats.MAX_TIMELINE); assert.equal(capped.truncated, true); assert.equal(capped.summary.created, stats.MAX_TIMELINE + 5, 'the summary still counts everything');
  t.pass('Drill-down: summary equals the Time per employee row; chronological timeline with versions, time to create and handling; past period and decline; outside-period events marked; empty; capped list');
}

// ---------- Drill-down endpoint: the same Head/Supervisor rule, validation, unknown user ----------
{
  const get = async (who, query) => t.status(stats.proposalEmployee(who, new URLSearchParams(query)));
  assert.equal(await get(t.user('emerson'), { user: 'cryssa', range: 'week' }), 200);
  assert.equal(await get(t.user('zeo'), { user: 'cryssa', range: 'month', period: '2026-10' }), 200);
  for (const id of ['cryssa', 'jefferson', 'admin', 'division-head', 'soa']) assert.equal(await get(t.user(id), { user: 'cryssa', range: 'week' }), 403, id);
  assert.equal(await get(t.user('emerson'), { user: 'nobody-' + randomUUID(), range: 'week' }), 404);
  assert.equal(await get(t.user('emerson'), { user: 'cryssa', range: 'week', period: '2099-01-05' }), 400, 'future');
  assert.equal(await get(t.user('emerson'), { user: 'cryssa', range: 'week', period: '2026-11-03' }), 400, 'not a Monday');
  assert.equal(await get(t.user('emerson'), { range: 'week' }), 400, 'no user');
  assert.equal(await get(t.user('emerson'), { user: 'cryssa', range: '7d' }), 400, 'old range');
  const live = await stats.proposalEmployee(t.user('emerson'), new URLSearchParams({ user: 'cryssa', range: 'year' }));
  assert.equal(live.user.id, 'cryssa'); assert.ok(Array.isArray(live.proposals));
  t.pass('Drill-down endpoint: Head and Supervisor 200; Employee, Admin, Division Head, SOA 403; unknown user 404; future, non-Monday, missing user and old ranges 400');
}

console.log(t.checks.length + ' checks passed');
