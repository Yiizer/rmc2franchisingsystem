// Feedback round 2026-11-07, items 3 and 4: proposal dashboard buckets, funnel and time per employee, plus the "Started handling" log line.
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
  // not started: Nov 1 R1 and R3 (1 ms before midnight) | Nov 2 R2 (exactly midnight)
  assert.deepEqual(column(r, 'notStarted'), { 'Nov 1': 2, 'Nov 2': 1 });
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
  t.pass('DAY: sent / declined / not-started per day, Manila midnight and Sunday-Monday edges, funnel 9/5/5/5/5, timing per employee (hand-computed)');
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
  assert.deepEqual(column(r, 'notStarted'), { 'Oct 26–Nov 1': 2, 'Nov 2–8': 1 });
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
  assert.deepEqual(column(r, 'notStarted'), { 'Nov 2026': 3 });
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

console.log(t.checks.length + ' checks passed');
