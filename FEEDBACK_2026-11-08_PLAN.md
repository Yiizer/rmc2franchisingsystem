# Feedback round 2026-11-08: plan (APPROVED by the PO 2026-11-08, answers at the end of section 6)

Two items: (1) employee reminders before protection expires, (2) "Proposal dashboard" goes back to "Monitoring", with a new layout.
No code has been written yet. Open questions are in section 6; nothing in them has been guessed.

---

## 1. Employee expiry reminders

### 1.1 Where the existing reminders live

- `lib/operations/owner-view.ts` → `ownerReminders(user, records, now)`.
- **Trigger:** none of it is a cron. The function runs whenever a Division Head / SOA loads their own data: `ownerBootstrap`, `listOwnerClients` (from `GET bootstrap` and `GET clients` for owner-scoped users).
- **Rule:**
  - skip when there is no protection, the record is closed, a progress report is pending, or protection has expired;
  - `days = protectionDaysLeft(...)` (rounded up);
  - threshold is 2 when `days <= 2`, 7 when `days <= 7`, otherwise nothing.
- **Dedupe:**
  - notice id = `'reminder-' + sha256(record.id | protection.expiresAt | threshold)`;
  - `INSERT INTO notifications ... ON CONFLICT (id) DO NOTHING`;
  - `emitNotice()` (the phone push hook) runs only when the row was actually inserted.
  - So a reload, two devices or two server instances can only create the row once. An approved progress report moves `expiresAt`, which changes the id, so the reminders start again for the new period.
- **Tested in:** `scripts/test-roles-scoping.mjs` section 7.

### 1.2 How employee reminders hook in (no second system)

- **Shared rule.** In `owner-view.ts`, split the threshold check out of `ownerReminders` into one helper, `reminderDue(record, now) → {threshold, days} | null`. `ownerReminders` keeps the same behaviour and message, and keeps passing section 7 unchanged.
- **New sweep.** Add `staffProtectionReminders(now)` (same file, next to the owner one):
  - It reads all inquiries once.
  - For each record where `reminderDue` returns a result, it works out the recipients (1.3).
  - It inserts one notice with the same `ON CONFLICT DO NOTHING` pattern. The id is `'staff-reminder-' + sha256(record.id | expiresAt | threshold)`. The prefix keeps it separate from the owner's notice, which has a different recipient and message.
  - When the row is inserted, it calls `emitNotice()`, so subscribed phones get the push. The push type is `protection`, which already exists ("Protection reminders" in `push.ts`).
- **Triggers.** Both are in `app/api/operations/[[...path]]/route.ts`, and both reuse something that already runs:
  1. **The staff 30-second `GET workspace` poll** (the same request that claims the email-check slot).
     - A slot in the existing `settings` table (key `protection-reminder-slot`) is claimed atomically, the same way `claimInboxCheck` claims `inbound_cursor`. That means one read and, at most every 10 minutes, one conditional `UPDATE`.
     - The request that wins the slot runs the sweep in `after()`, so it never slows the response.
     - The sweep is idempotent either way. The slot only keeps the cost down.
  2. **The existing daily cron `/api/operations/inbound/cron`** (00:00 UTC = 8:00 AM Manila) also calls the sweep, after `checkInbox()`.
  - ⚠ **Vercel runs cron jobs on production deployments only.** On the preview test version (rmc2-test-yiizer), trigger 2 never fires, so reminders there come from trigger 1: someone on staff having the app open.
  - Owner-scoped users keep their own path. They never receive the staff notice: `notify()` and the recipient filter in 1.3 drop owner-scoped ids.
- **Server-side role check.** Neither trigger is a new endpoint. The workspace route already requires a signed-in staff user, and the cron route already checks `CRON_SECRET`.

### 1.3 Recipients

- `record.handledBy` plus `submittedBy` of the sent version (the last delivered, non-dry-run submission).
- Only users who are **active** and **not** owner-scoped.
- **Note:** `audit()` adds *every* actor to `handledBy`, so an approving Head or Supervisor is already in it. Whether they stay depends on **Q1**. If the answer is "employees only", the filter becomes `role === 'Employee'`.
- **Nobody handled it:** depends on **Q2**.

### 1.4 Message

- Title: "Protection ending soon" (the same as the owner's).
- Body: `{Client}: protection ends in {n} days ({Nov 15, 2026}). Ask the agent for a progress report or the client will be released.`
- The date is `expiresAt` formatted the app's way (`manilaTime` date part).
- `{n}` depends on **Q4**.

### 1.5 Dedupe key and storage

| What | Where |
|---|---|
| Key | `record.id \| protection.expiresAt \| threshold`, hashed into the notice id `staff-reminder-<40 hex>` |
| Stored in | the existing `notifications` table (primary key `id`), written with `ON CONFLICT (id) DO NOTHING` |
| Slot (cost only, not correctness) | `settings` row `protection-reminder-slot` → `{ at }` |

- **Why the notice id, and not a jsonb flag on the record:**
  - it is the pattern the owner reminders already use and test;
  - it is atomic across instances;
  - it needs no migration;
  - it never writes the inquiry row. A record write would bump `revision` and could give an employee who is editing a 409 "Another colleague updated this inquiry".
- **No migration.**
- On Postgres the `jsonParam()` helper is used as now; there is no `JSON.stringify(...)::jsonb`.

### 1.6 Edge cases covered

- First seen already inside 2 days: only the 2-day reminder (the same as owners).
- Pending progress report: no reminder, because protection is held.
- Closed, declined, transferred or expired client: no reminder.
- A reminder already sent, then a renewal: the new `expiresAt` gives new ids, so the 7-day and 2-day reminders come again.
- An inactive employee is skipped.

---

## 2. Monitoring redesign

### 2.1 Naming (3 strings)

- `app/operations-shell.tsx`:
  - the nav item label `'Proposal dashboard'` becomes `'Monitoring'`;
  - the breadcrumb `'Proposal dashboard'` becomes `'Monitoring'`.
- `app/operations-proposal-dashboard.tsx`:
  - the `h1` becomes "Monitoring";
  - the 403 text becomes "Monitoring is for the Head and Supervisors."
- The page key was already `'Monitoring'`.
- The Admin's service-health page is unchanged.
- `scripts/test-phase2-ui-browser.mjs:225` already expects "Monitoring", so the rename puts it back in line.

### 2.2 API: `GET monitoring/proposals?range=7d|30d|90d|12m`

- The existing `period` (and `from`/`to`) form is kept unchanged, so the current 7 test cases keep passing.
- The new `range` parameter is validated with zod (anything else gets a 400). `canSeeProposalStats` is checked first (403), as now.
- `ProposalStats` gains an optional `summary` block, filled only when `range` is given.

**Windows (Manila time)**

| Range | Current window | Trend buckets | Previous window |
|---|---|---|---|
| 7d | today and the 6 days before, to the end of today | 7 × day | the 7 days before |
| 30d | today and the 29 days before | 30 × day | the 30 days before |
| 90d | today and the 89 days before | weeks (Mon–Sun), with the first week clipped to the window | the 90 days before |
| 12m | this calendar month and the 11 before | 12 × month | the 12 months before |

**New fields and their exact definitions.** Each one is computed over the window, the same way for the current and the previous window.

| Field | Definition |
|---|---|
| `received` | inquiries with `createdAt` in the window (the same as funnel "Received") |
| `sent` | distinct inquiries with a delivered, non-dry-run submission whose `delivery.at` is in the window |
| `declined` | inquiries with `closure.kind === 'declined'` and `closure.at` in the window |
| `notStarted` | inquiries with `createdAt` in the window that are *still* "New inquiry" with no closure, as of now (the same rule as today's bucket) |
| `previous.{received,sent,declined,notStarted}` | the same four, over the previous window |
| `weekdays[7]` | Mon..Sun counts of **inquiries received** (or sent, per **Q3**) in the current window, by Manila weekday |
| `sentRate` | `funnel.Sent ÷ funnel.Received` for the current window, as a whole percent, or `null` when `received = 0`. This is the share of this period's inquiries that have been sent (a cohort). It is not "all sends ÷ all receipts", which can go over 100% when older inquiries are sent. |

- **Delta pill** (computed in the client):
  - `previous > 0`: `round((cur − prev) / prev × 100)%`;
  - green with an up arrow when it rose, red with a down arrow when it fell;
  - neutral "—" when `prev = 0`.
  - For **Declined** and **Not yet started**, going up is bad. The colour follows the *meaning* (up = red) while the arrow follows the direction. This is the recommended choice; tell us if you want plain up = green for every card.
- **Caveat on `notStarted` for the previous window:** it is measured *as of now*, so the previous period will usually look smaller (those inquiries have had more time to be started). The card's help text says "still not started".

### 2.3 Layout, card by card

Everything below uses `ops-*` tokens only. The status colours are the ones already in `operations-proposal-dashboard.css`:
- `--pd-sent` → `--ops-done`
- `--pd-declined` → `--ops-error`
- `--pd-idle` → neutral
- the `--pd-step-*` blues

Nothing is taken from the reference image's colours, logo, icons or brand.

- **Header row**
  - Left: `ops-heading`, with the h1 "Monitoring" and the one-line description.
  - Right:
    - the range segment "Last 7 days · 30 days · 90 days · 12 months" (`pd-segment`, default "Last 30 days");
    - the Charts / Numbers / Both segment (kept, stored in `rmc2.monitoringView.<userId>` as now);
    - **Export** (`ops-btn primary`, download icon);
    - Refresh (secondary, kept).
  - Below them: "Updated {time} · {from}–{to}".
- **Row 1: KPI cards** (4 × `ops-card`, in the `ops-stat` pattern)
  - The cards: Inquiries received · Proposals sent · Declined · Not yet started.
  - Each card has: the label and a small icon; a large value; the delta pill; and "vs. {n} last period".
- **Row 2**
  - **Proposals over time** (wide, about ⅔ of the row): a recharts `AreaChart` with two series, *Received* (a neutral line) and *Sent* (an `--ops-done` area), one point per bucket.
  - **Busiest day** (about ⅓): a recharts `BarChart` with 7 bars, Mon..Sun.
    - The top day is filled with the strong colour; the others are a light neutral.
    - The value is printed above the top bar.
    - If several days tie, the earliest is highlighted.
- **Row 3**
  - **Pipeline** (wide): the existing `.pd-steps` step chart, unchanged, for the range.
  - **Sent rate** (narrow): a half-circle gauge in plain SVG (no new dependency).
    - It shows the percentage in the centre and "{sent} of {received} inquiries sent".
    - It shows "—" when nothing was received.
- **Row 4: Time per employee** (full width): the existing chart and table, with the same columns and averages.
- **Numbers / Both view**
  - "Numbers" replaces each chart with its table: the buckets table, the weekday table, and the pipeline table (already exists).
  - The KPI row, the gauge value and the timing table always show.
  - "Both" shows charts and tables.
- **Not built:** the reference image's assistant card, upgrade banner, dark-mode toggle and search bar.
- **Phone (≤760px, checked at 375px)**
  - every row becomes one column;
  - the KPI cards stack one per row;
  - the header controls wrap below the title, and Export goes full width;
  - wide tables scroll inside their own `pd-scroll` region, so the page itself never scrolls sideways.
- **States**
  - **Loading:** skeleton blocks shaped like the four rows.
  - **Empty:** the KPI row shows zeros, and the cards below are replaced by the existing `Empty` ("No proposals in this period").
  - **Error:** the existing error card with **Retry**.
  - **403:** the existing no-access card, with the new wording.

### 2.4 Export (CSV)

- The CSV is built in the browser from the stats already loaded, so there is no new endpoint and no new role path.
- Its sections, in order:
  1. range and dates;
  2. the KPIs (current, previous, change);
  3. the buckets;
  4. the weekdays;
  5. the pipeline;
  6. the sent rate;
  7. time per employee (in minutes and as formatted text).
- The file name is `monitoring-{range}-{YYYY-MM-DD}.csv`. It is UTF-8 with a BOM, so Excel opens it cleanly.
- Cells that start with `= + - @` are prefixed with `'` (CSV-injection guard, for example for employee names).

---

## 3. Files touched (all within scope)

| File | Change |
|---|---|
| `lib/operations/owner-view.ts` | `reminderDue` helper, `staffProtectionReminders`, slot claim |
| `lib/operations/proposal-stats.ts` | `range` param, `summary` block (pure, in `computeProposalStats`) |
| `lib/operations/types.ts` | `ProposalStats.summary?` type |
| `app/api/operations/[[...path]]/route.ts` | call the sweep from the workspace poll (`after`) and the daily cron |
| `app/operations-proposal-dashboard.tsx` / `.css` | the new layout, Export, states |
| `app/operations-shell.tsx` | the two labels |
| `scripts/test-protection-reminders-employees.mjs` | new |
| `scripts/test-proposal-stats.mjs` | new cases added (no existing case changed) |
| `TEAM_DECISIONS.md`, `REMAINING_WORK.md` | decisions and status |

- There is no migration, no new dependency, and no change to `.env*`, `vercel.json` or `package*.json`.

---

## 4. Tests

1. **New `scripts/test-protection-reminders-employees.mjs`** (a throwaway SQLite data dir under `test-results/`, the same harness as `test-roles-scoping.mjs`):
   - **A, 7 days:** a client handled by cryssa, sent by jefferson, with 6.5 days left. One notice reaches exactly the expected recipients, with the exact message text and date.
   - **B, 2 days:** a client with 1.5 days left gets only the 2-day notice.
   - Running the sweep 3 more times creates nothing new. Two sweeps run in parallel (`Promise.all`) also create a single row.
   - **Renewal:** approve a progress report, then move the clock to 6.5 days before the *new* expiry. One new notice appears.
   - Pending report, closed, expired or more than 7 days left: no notice.
   - An inactive employee and the owner-scoped owner are never recipients.
   - The push hook is called once per inserted notice and never on a re-run (a stub registered with `setNoticeHook`).
   - The Q1 and Q2 behaviour, once decided.
   - The slot claim: two claims in the same 10 minutes, only one wins.
2. **`scripts/test-roles-scoping.mjs`:** section 7 (owner reminders) unchanged and passing. The only expected failure is still line 198.
3. **`scripts/test-proposal-stats.mjs`, new cases** (hand-computed tables in the comments, as now):
   - 7d and 30d windows, with current and previous totals;
   - delta inputs including previous = 0;
   - weekday counts across a Manila-midnight edge;
   - `sentRate` (including `null` when nothing was received);
   - 90d clipped weekly buckets;
   - 12m month windows;
   - `range=bad` gets a 400;
   - the role matrix for `range` (Head and Supervisor 200, everyone else 403).
4. **Unchanged suites:**
   - `test-no-ai-text-browser.mjs`;
   - all feedback-round scripts (`test-feedback-enrolled`, `-shared-mobile`, `test-division-team`, `test-inquiry-fields`, `test-reply-recipient`, `test-email-templates`);
   - `tsc --noEmit`;
   - eslint on the changed files compared with HEAD.
5. **Browser check:**
   - A dev server on port 5196 with `RMC2_DATA_DIR=test-results/feedback-1108/qa-data` and `RMC2_SEED_DEMO=1` (never 5173 or `.data`).
   - Desktop and 375px screenshots.
   - The toggle survives a reload.
   - Export downloads a CSV and its contents are checked.
   - The 403 state is shown as an Employee.
   - No horizontal scroll at 375px (`scrollWidth <= clientWidth`).

---

## 5. Not in this round

- No email reminders, only in-app and push.
- No change to the owners' text.
- No new date-picker beyond the 4 ranges.
- No AI wording anywhere.

---

## 6. Open questions for the PO (blocking only where marked)

- **Q1 (blocks the recipient rule).** Should the Head and Supervisors also get the employee expiry reminders, or only the employees who worked on the client?
  - Note that an approving Head or Supervisor is already in `handledBy`.
  - Options:
    - (a) everyone in `handledBy` plus the sender, whatever their role;
    - (b) Employees only;
    - (c) (b) plus always the Head and Supervisors.
- **Q2 (blocks the fallback).** If nobody handled the inquiry (for example it was imported and never opened), who gets the reminder: all active employees, or nobody?
- **Q3 (blocks "Busiest day").** Should "Busiest day" count inquiries received, or proposals sent?
- **Q4 (wording).** The trigger runs when the app is used or once a day, so a reminder can first fire at, say, 5 days left.
  - Options:
    - (a) always say "7 days" or "2 days" (the threshold);
    - (b) say the actual days left, as the owner reminders do. The date in brackets is exact either way.
  - Recommendation: (b), so the text is never wrong.
- **Q5 (minor).** The KPI delta colour for Declined and Not yet started: up = red (meaning, recommended), or up = green for every card?

### PO answers (2026-11-08)

- **Q1:** everyone involved.
  - Staff: the handlers plus the sender, and every active Head and Supervisor.
  - The client's own Division Head / SOA: through the existing owner reminder.
  - Other owners are never told about a client that isn't theirs.
- **Q2:** covered by Q1, because the Head and Supervisors always get it.
- **Q3:** "Busiest day" counts proposals sent (`weekdays` = sends by Manila weekday).
- **Q4:** the actual days left.
- **Q5:** a rise is red for Declined and Not yet started.
- **Reference image:** layout and ideas only, fitted to what coverdesk has. Do not copy features the system does not have.
