// Pilot plan 2026-11-16, item 5: "Report a problem". Local only (harness, isolated SQLite), no server, nothing is sent.
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('problem-reports');
const [reports, guard] = await Promise.all(['problem-reports', 'scope-guard'].map(t.load));
const cryssa = t.user('cryssa'), head = t.user('emerson'), admin = t.user('admin'), dh = t.user('division-head'), zeo = t.user('zeo');
const reject = async (promise, status, pattern) => { await assert.rejects(promise, error => (status ? error.status === status : true) && (!pattern || pattern.test(error.message + JSON.stringify(error.issues || '')))); };

const filed = await reports.submitProblemReport(cryssa, { description: '  I clicked Generate PDF and nothing happened.\u0000 ', page: 'Inquiry Workspace', inquiryId: 'INQ-2026-00129', viewport: '1366x768' }, 'Mozilla/5.0 Test');
assert.ok(filed.id && filed.at);
t.pass('An employee files a report; the server returns its id and time');

const { reports: list } = await reports.listProblemReports(head);
const mine = list.find(r => r.id === filed.id);
assert.equal(mine.description, 'I clicked Generate PDF and nothing happened.');
assert.deepEqual([mine.status, mine.page, mine.role, mine.inquiryId, mine.viewport, mine.browser, mine.version, mine.userId], ['new', 'Inquiry Workspace', 'Employee', 'INQ-2026-00129', '1366x768', 'Mozilla/5.0 Test', 'local', 'cryssa']);
t.pass('The Head sees it with the captured context (page, role, inquiry, window, browser, version) and control characters removed');

await reject(reports.submitProblemReport(cryssa, { description: 'too short', page: 'Dashboard' }), null, /at least 10 characters/);
await reject(reports.submitProblemReport(cryssa, { description: 'Long enough description here', page: 'Dashboard', inquiryId: '../../etc' }));
await reject(reports.submitProblemReport(cryssa, { description: 'Long enough description here', page: 'Dashboard', screenshot: 'data:' }));
t.pass('Too-short descriptions, malformed inquiry ids and unknown fields are refused');

const owner = await reports.submitProblemReport(dh, { description: 'My Clients does not show my newest client.', page: 'My Clients' }, '');
assert.ok(owner.id);
assert.equal(guard.ownerRouteAllowed('POST', ['problem-reports']), true);
assert.equal(guard.ownerRouteAllowed('GET', ['problem-reports']), false);
assert.equal(guard.ownerRouteAllowed('POST', ['problem-reports', owner.id, 'status']), false);
t.pass('A Division Head can file a report, but the owner whitelist blocks reading the list and changing status');

await reject(reports.listProblemReports(cryssa), 403);
await reject(reports.listProblemReports(zeo), 403);
await reject(reports.updateProblemReport(cryssa, filed.id, { status: 'fixed' }), 403);
assert.equal((await reports.listProblemReports(admin)).reports.length, 2);
t.pass('Only the Head and Admin read the list; an Employee and a Supervisor are refused (403)');

const { report: progressed } = await reports.updateProblemReport(head, filed.id, { status: 'in-progress' });
assert.equal(progressed.status, 'in-progress'); assert.equal(progressed.updatedBy, 'emerson'); assert.ok(progressed.updatedAt);
const { report: fixed } = await reports.updateProblemReport(admin, filed.id, { status: 'fixed', note: 'Converter restarted.' });
assert.equal(fixed.status, 'fixed'); assert.equal(fixed.note, 'Converter restarted.'); assert.equal(fixed.description, mine.description);
await reject(reports.updateProblemReport(head, filed.id, { status: 'closed' }));
await reject(reports.updateProblemReport(head, 'missing-id', { status: 'fixed' }), 404);
t.pass('Status moves new → in progress → fixed with who and when; unknown statuses and ids are refused');

for (let i = 2; i < reports.PROBLEM_REPORTS_PER_DAY; i++) await reports.submitProblemReport(cryssa, { description: 'Repeated report number ' + i, page: 'Dashboard' }, '');
await reports.submitProblemReport(cryssa, { description: 'The thirtieth report today', page: 'Dashboard' }, '');
await reject(reports.submitProblemReport(cryssa, { description: 'One report too many today', page: 'Dashboard' }), 429);
t.pass('Each person can file up to ' + reports.PROBLEM_REPORTS_PER_DAY + ' reports a day');

// Item 6: app errors logged automatically into the same list.
const stack = 'TypeError: x is undefined\n    at render (https://rmc2-test.example.test/_next/static/chunks/app.js?dpl=abc:1:200)\n    at commit (https://rmc2-test.example.test/_next/static/chunks/react.js:2:10)';
const crash = { kind: 'error', source: 'error', message: 'TypeError: x is undefined', stack, page: 'Dashboard', viewport: '390x844' };
const first = await reports.submitProblemReport(cryssa, crash, 'Mozilla/5.0 Phone');
assert.equal(first.repeat, false); assert.match(first.id, /^err-[0-9a-f]{24}$/);
const again = await reports.submitProblemReport(zeo, { ...crash, inquiryId: 'INQ-2026-00131' }, 'Mozilla/5.0 Phone');
assert.equal(again.id, first.id); assert.equal(again.repeat, true);
let logged = (await reports.listProblemReports(head)).reports.find(r => r.id === first.id);
assert.deepEqual([logged.kind, logged.count, logged.userIds, logged.inquiryId, logged.status, logged.role], ['error', 2, ['cryssa', 'zeo'], 'INQ-2026-00131', 'new', 'Employee']);
assert.ok(!/example\.test|dpl=/.test(logged.stack) && logged.stack.includes('/_next/static/chunks/app.js:1:200'));
t.pass('The same crash from two people is one entry with a count of 2; the stack keeps paths without the site address or query strings');

await reports.updateProblemReport(head, first.id, { status: 'fixed' });
await reports.submitProblemReport(cryssa, crash, '');
logged = (await reports.listProblemReports(head)).reports.find(r => r.id === first.id);
assert.deepEqual([logged.status, logged.count, logged.reopened], ['new', 3, true]);
t.pass('A crash marked fixed that happens again is reopened as new');

await reject(reports.submitProblemReport(cryssa, { ...crash, formData: 'x' }));
await reject(reports.submitProblemReport(cryssa, { ...crash, source: 'console' }));
await reject(reports.submitProblemReport(cryssa, { ...crash, message: '' }));
t.pass('Crash entries with unknown fields, unknown sources or no message are refused');

const other = await reports.submitProblemReport(dh, { kind: 'error', source: 'render', message: 'Error: chart failed', page: 'My Clients' }, '');
assert.equal(other.repeat, false);
for (let i = 1; i < reports.CRASHES_PER_DAY; i++) await reports.submitProblemReport(dh, { kind: 'error', source: 'error', message: 'Error: distinct ' + i, page: 'My Clients' }, '');
await reject(reports.submitProblemReport(dh, { kind: 'error', source: 'error', message: 'Error: one too many', page: 'My Clients' }), 429);
assert.equal((await reports.submitProblemReport(dh, { kind: 'error', source: 'render', message: 'Error: chart failed', page: 'My Clients' }, '')).repeat, true);
await reports.submitProblemReport(dh, { description: 'Typed reports still work after the crash cap.', page: 'My Clients' }, '');
t.pass('Each browser opens up to ' + reports.CRASHES_PER_DAY + ' new error entries a day; repeats and typed reports are not blocked by that cap');

console.log(t.checks.length + ' checks passed');
