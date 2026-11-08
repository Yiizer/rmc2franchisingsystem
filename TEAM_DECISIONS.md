# Team decisions log

Decisions and lessons from the AI development team (Technical Lead + specialist agents) working on this
repo. Read this before changing UI, workflow rules or tests, so settled decisions aren't reopened and
past mistakes aren't repeated. Newest entries go at the top of each section.

Format: **Decision** — why — where it applies.

## Product decisions (approved by the Product Owner)

- **Duplicate hold needs the same company or the same file (F5)** (approved by the PO 2026-11-08, "Require company name").
  - A matching client contact or addressee name alone no longer holds an inquiry for a different company.
  - A hold now needs the same account / company (normalized) or the identical submitted file.
  - When the company also matches, a shared contact name is still listed as an extra reason.
  - Why: in the online click-through, a different company with a different agent was held only because the contact name matched. Real dry runs would hold unrelated clients.
  - Where: `duplicateClients` in `lib/operations/client-rules.ts`. Tests: `test-duplicate-company-rule` (new) and `test-client-protection` (updated).

- **Full working system by Monday 2026-11-16** (approved by the PO 2026-11-08, in a grilling session; the full plan is `PLAN_2026-11-16_PROMPT.md`).
  - **What Monday means:** staff start dry runs of real work. Every user-facing flow has to work end to end, with only minor issues left.
    - Staff process real inquiries in parallel with the old process, which stays the official one.
    - All outgoing mail goes to the staging redirect, so nothing reaches an agent. Inbound import stays on.
    - Live sending is switched on later, as a separate step with PO approval.
    - Dry-run data is wiped at cutover. Only the client directory and the accounts are kept.
  - **Reverses the 2026-11-07 deferral:** all of `REMAINING_WORK.md` §0 and §2 (the full final check) runs this week, not just before production.
  - **In scope:**
    - phase 5 large files
    - the Head's division editor
    - real per-person accounts, with the demo accounts disabled
    - a "Report a problem" button
    - free-tier error tracking
    - the Reply-To warning
    - a show/hide password toggle
    - dark mode (Light / Dark / System; documents and PDFs stay light)
    - phone push only if the PO approves the VAPID keys this week
    - the email signature and branch answers only if the client sends them by 2026-11-11
  - **Out of scope:** Supabase Auth (phase 6), live AI or OCR, an agent portal, production cutover, and new paid services.
  - **Feature freeze at the end of 2026-11-12.** After that, only bug fixes.
  - Why: the client wants a reliable system they can use for dry runs, with problems found and fixed during them.

- **2026-11-09, PO: make Emerson the Head in the real local data (`.data`).** He was still a Supervisor there, with no Head account. Set to `Head` with approval rights, matching the online test version. Backed up first (`D:Codescoverdesk-data-backup-20261109-before-head`).
- **2026-11-09, PO: the light/dark choice moves out of Settings to a toggle in the top bar** (also on the sign-in screen). With nothing chosen the app follows the device. This replaces "Settings and the login screen" in pilot plan item 8. Settings is split into Profile, Security, Notifications and Email templates tabs.

- **Monitoring feedback round 2026-11-08c** (approved by the PO 2026-11-08, "approve as proposed"). Supersedes, for the Monitoring page only, the "Still new" bullet of round 2026-11-08b and its empty-page takeover.
  - **"Still new" becomes "Not yet sent", the open backlog.**
    - Definition: an inquiry received before moment T, with no delivered submission by T (manual confirmations count, dry runs don't) and no closure (declined or transferred) by T. The received date doesn't matter.
    - T is now for the current period, and the end of the period for a past one. The backlog is rebuilt from `createdAt`, `delivery.at` and `closure.at`.
    - The delta compares the backlog at the end of the existing comparison window: like for like for the current period ("vs. 36 by this time yesterday"), the whole previous period for a past one. A rise is red.
    - The API field `notStarted` is renamed `notSent` (`ProposalWindowTotals` and the buckets). Each bucket carries the backlog at its end, so the Numbers column reads "Not yet sent (at end)" and its footer is the period-end figure, not a sum.
    - Why: the PO wants the inquiries still waiting to be sent. Option (b), "received in this period and still unsent", was rejected because it hides the old backlog (Today: 1 against a real 37).
  - **No empty-page takeover.** Every card always renders with zeros and its own hint:
    - the trend draws the 0–1 axis;
    - the pipeline shows 0 and "—";
    - Busiest day shows 0 rows on Weekly and longer, and keeps "Pick Weekly or longer to compare days" on Today;
    - Time per employee shows its header row with "No employee activity in this period".
  - **Time per employee redesign:**
    - initials disc, name and chevron as one button;
    - fixed columns, so bars start on one edge and figures end on one;
    - each average has its value over a 4px bar track;
    - no row rules, a hover tint;
    - the card shows first and last name ("Cryssa Aban"), while the dialog, tooltip and accessible name keep the full name.
  - **Elevation tokens** in `operations-tokens.css`: `--ops-shadow-card` (resting cards and KPI tiles), `--ops-shadow-raised` (tooltip), `--ops-shadow-control` (toolbar controls), `--ops-radius-chip`.
    - The KPI tiles get tinted icon chips: an 11% tint of the series colour, icon contrast ≥ 4.3:1.
    - The PO asked for chips and layered shadows explicitly. This overrides the design-taste skill's app-screen rule against icon chips and resting shadows.
  - **Layout budget:** the two card rows are now equal (`1fr 1fr`, was `1.1fr 1fr`), so Time per employee fits 3 rows at 1366×768 with no page scroll.

- **Monitoring feedback round 2026-11-08b** (approved by the PO 2026-11-08, "approve as proposed"). Supersedes, for the Monitoring page only:
  the 7/30/90-day and 12-month ranges, the CSV export (`FEEDBACK_2026-11-08_PLAN.md` §2.4) and "no new date-picker beyond the 4 ranges" (§5).
  - **Ranges are calendar periods in Manila time:** Today (24 hourly buckets) · Weekly, Monday–Sunday (7 days) · Monthly (28–31 days) · Yearly (12 months). Monthly is the default.
  - **Deltas:** a past period is compared with the whole period before it. The current, unfinished period is compared **like for like**: the previous period up to the same moment. A day the earlier month or year doesn't have clamps to that month's end (31 Mar → all of Feb; 29 Feb → all of Feb the year before).
  - **Past periods:** a ‹ › stepper, a "Jump to" picker and "Back to current". There are no future periods.
    - The URL is `?range=day|week|month|year&period=…`, next to `#monitoring`. Keys: day `YYYY-MM-DD`, week = its Monday `YYYY-MM-DD`, month `YYYY-MM`, year `YYYY`.
    - The server rejects with 400: a malformed or impossible date, a week key that isn't a Monday, a future period, and anything older than the lookback.
  - **Lookback: 5 years**, back to 1 January of (the current year − 5). That's a sanity bound, not a cost bound: every request already reads all inquiries in one snapshot.
  - **Jump to uses native controls** (a date input; month and year selects). `components/ui/calendar.tsx` was not used: the ops pages don't use shadcn, and its theme colours aren't the ops tokens.
  - **Colours:** Received / pipeline = `--ops-navy`; Sent = `--ops-action` (burnt orange); Declined = `--ops-error`; Still new = `--ops-muted`.
    - This chart use of orange is a deliberate exception to the tokens' "status colours never reuse orange" rule.
    - No hex in the dashboard files. Light theme only, since the app has no dark theme. Navy/white 16:1, orange/white 5.1:1, navy/orange 3.1:1, neutral bars on track 3.3:1.
  - **"Not yet started" becomes "Still new"** (not "Not yet sent", which would mislabel it). Same metric: received in the period and still "New inquiry" with no closure, as of now. Starting handling alone doesn't move an inquiry out; a saved draft or template does.
  - **Export is a PDF** built in the browser with `pdf-lib` (already a dependency, loaded on demand) from the numbers on screen. Colours are read from the tokens. It uses the built-in Helvetica font, so characters outside Latin-1 print as "?".
  - **Time per employee drill-down:** `GET monitoring/proposals/employee?user=&range=&period=`, with the same `canSeeProposalStats` rule (403) and 404 for an unknown user.
    - Its summary is computed by the same code as the table row, so the two always match. "Created" is labelled "Versions submitted" because a v2 counts again.
    - The timeline lists received → started → submitted / returned / approved → sent / declined, with durations. It's capped at 300 proposals.

- **Feedback round 2026-11-08** (`FEEDBACK_2026-11-08_PLAN.md`, approved 2026-11-08):
  - **Q1, who gets expiry reminders: everyone involved.** That means:
    - the employees who handled the client (`handledBy` plus the preparer of the sent version);
    - every active Head and Supervisor;
    - the client's own Division Head / SOA, who already gets the owner reminder with its own wording.
  - Owner-scoped users never get a reminder about another owner's client: that would break the "they see only their own clients" rule.
  - **Q2, nobody handled the inquiry:** the PO was unsure. The Head and Supervisors always get the reminder (Q1), so someone is always told, and no extra fallback is needed. Not all employees, to keep the noise down.
  - **Q3:** "Busiest day" counts **proposals sent** (by `delivery.at`, Manila weekday).
  - **Q4:** the reminder text says the **actual days left**, plus the exact date.
  - **Q5:** for Declined and Not yet started, a rise shows **red**, because a rise is bad there.
  - **Reference image:** use it only for layout and ideas, fitted to what coverdesk has. Do not copy features the system does not have, or its look.
  - **Monitoring redesign (PO, 2026-11-08): no page scroll on desktop.**
    - **Fit:** the page is a fixed-height grid that fits one screen at 1366×768 and up. Below 1024px wide the cards stack and the page scrolls.
    - **View toggle:** **"Both" is removed** (supersedes "the Charts / Numbers / Both toggle is kept"). Only Charts and Numbers remain. A stored "both" opens Charts.
    - **KPIs:** 5 tiles; Sent rate is now a tile.
    - **No earlier data:** the delta pill is hidden, and the tile says "No earlier data to compare".
    - **Trend:** grouped columns, with no smoothed curves.
    - **Busiest day:** horizontal rows. Under 5 sends, it shows "Too few sends to compare days" and highlights nothing.
    - **Pipeline:** left-aligned bars, with "of received", "of step before" and the biggest drop.
    - **Time per employee:** shows as many rows as fit (at most 4, most sent first). The rest are in "View all".

- **Feedback round 2026-11-07** (`FEEDBACK_2026-11-07_PLAN.md`):
  - **Enrolled:** label only. "Won" becomes "Enrolled" everywhere, with the same rows and counts; no stored enrollment status yet.
  - **Labeled-field inquiry entry:** replaces manual entry only. Imported forms keep their review screen. Typed fields are written into a real franchise-form .xlsx and go through the normal intake.
  - **Timing:** start = first "Started handling" (a new history line, written once per user per inquiry). Time to create = start → submitted for approval (`submissions[v].at`). Handling time = first start by anyone → email delivered (`delivery.at`). Both are wall-clock times, computed from the logged timestamps; averages are per employee for the chosen period.
  - **Outcome emails go to the original sender.** One helper, `replyRecipient`, resolves the recipient:
    - an email import → the address it came from;
    - a manual entry → the agent email typed on the record;
    - linked to a Division Head / SOA → their account email.
    - The proposal email's To line is read-only.
  - **Decline emails the agent.** Pressing Decline opens an email form: "Email the agent" is on by default and the message can be edited. **Request missing details** also emails the original sender. *Return for correction* stays internal.
  - **AI:** the AI notes and the proposal help/assistant are hidden. The rule-based checker and suggestions stay, renamed "Proposal checks" and "Suggested templates", with no AI wording.
  - **Proposal dashboard:** for the Head and Supervisors. The Admin keeps service health.
  - **Division Heads manage SOAs in their own division:** create, deactivate and reset password. Reactivation is for the Head only (the recommendation, as Q8 was not answered).
  - **My email templates:** each staff member saves their own proposal, details and decline wording, including the sign-off. They are stored per user in `settings`, and only the owner can read them.
- **Final testing waits until just before production deployment (2026-11-07).** The never-tested items and the full final check (`REMAINING_WORK.md` sections 0 and 2) run together as one gate before phase 8 cutover, not now. Until then, keep building features and testing each change as it is made. Real staff use and real production data still need that gate first.
- **Demo feedback round (2026-11-05)**: the full list is in `DEMO_FEEDBACK_PLAN.md`.
  - **Roles:** Head (Emerson Dolf Fernandez), Supervisor (Zeo), Employee, Division Head, SOA and a hidden IT Admin. Only the Head manages accounts and templates.
  - **Inquiries and protection:** Division Heads / SOAs send every inquiry and own the 30-day protection. They see only their own clients.
  - **Progress reports:** one approval from the Head or Supervisor resets the 30 days, counted from the approval.
  - **Real data:** the PO accepted loading the real client directory onto the test version before the final security check.
  - **Supersedes:** "Protection belongs to the agent on the original form" and "Dates stay MM/DD/YYYY". Dates now show as "Nov 5, 2026, 2:14 PM".
- **Division Head and SOA (2026-11-06):**
  - A Division Head is the head of the sales branches in their division. An SOA is a Sales Operations Assistant, with the same access as a Division Head for now.
  - New forms get their division from the form's branch, using the Divisions & Branches table: "Lipa 2" → Division 4, and "Baliuag" → Baliwag Bulacan in Division 2.
  - A linked Division Head or SOA's own division wins.
  - Unclear or unlisted branches stay "Unconfirmed" for staff to set. The original form text is kept.
- **Inquiry locking v2 (2026-11-05)**:
  - **Lock lifetime:** the lock lasts 3 minutes without a heartbeat. Hidden tabs keep it, and it is released after 15 minutes idle.
  - **Request handover:** limited to one request per person every 5 minutes.
  - **Take over:** Supervisor, later the Head. It goes to the person taking over, or as a 15-minute reservation for an Employee (table `inquiry_handover`).
  - **Unchanged:** decline, BOR and client review keep their looser 90-second check (PO decision).
- **Email pull-in every 30 seconds (2026-11-05)** while the app is open. The poll that wins the check slot tells the client to refresh about 6 seconds later.
- **Proposal PDFs "jumbled" (found 2026-11-05)**:
  - The demo files had all their fonts embedded, so the text itself was fine.
  - What looked jumbled was page flow: headings stranded at the bottom of a page, tables splitting across pages, and cramped rows. The November template versions fix this.
  - Total CorpoShield (D094) and Total CorpoShield PEC Covered (D096) put Emerson's signature in the page header, so it prints on most pages over the text. The new versions of both files still do this.
  - Customize no longer counts tab-stop settings as text.

- **Client ownership: first request claims the client** (2026-10-30) — once an agent has a request for a
  client, processed or not, no other agent may handle that client. Another agent can take it only after
  the first agent failed to follow up and their protection expired. Newer requests from other agents are
  held; this must be prevented, not just flagged.
- **Completed work is never put on hold** (2026-10-30) — a sent/approved (registered) inquiry stays clear;
  only the newer incoming request is held. Legacy records where two registrations already overlap show an
  "Also registered on INQ-x" note to **all staff**; nothing is blocked.
- **Account age colours** (2026-10-30) — 0–30 days green "New", 31–90 blue "Established", 91–365 amber
  "Mature", 366+ or invalid grey "Needs attention". Age is not protection; protection has its own chip.
- **AI proposal checker stays available to employees and supervisors** on submitted proposals (2026-10-30).
- **Releasing or overriding a claim needs an approving supervisor** (2026-10-30, from the security review) —
  "Confirm different clients" while the other registration is active, and declining a request that is
  registered, protected, or blocking another held request. Employees see the control disabled with a reason;
  the server returns 403. BOR transfer and after-expiry approval flows are unchanged.
- **Protection belongs to the agent on the original form** (2026-10-30) — protection identity comes from the
  source form fields, so editing the working agent fields can't move protection to another agent.
- **Source tab removed from the Client Directory panel** (2026-10-30) — edit history moved into Overview; the
  raw spreadsheet cell/colour evidence is no longer shown.
- **One place for actions on a submitted proposal** (2026-10-30) — the bottom action bar holds every action
  (Approve & email agent, Return, Edit before approval, Retry approved reply, Download email). The status card
  has no buttons; the document header has exactly one Open PDF, one Word and one AI checker.

- **Dates stay MM/DD/YYYY** (2026-10-30) — matches the client's Excel register; locked by
  `scripts/test-workspace-advisors.mjs` and `scripts/test-directory-model.mjs`. Native date inputs follow
  the OS region and may show DD/MM; that is expected and not a bug.
- **Keep merged feature branches** (2026-10-30) — `ui-revamp-ux-fixes` was kept after merging PR #2.
- **Real email, phase 1** (2026-10-30) — Gmail SMTP + app password via `nodemailer`, from a **new dedicated
  Gmail account**. Only the **online test copy (5180)** may send, and only when the PO creates the separate
  mail env file; every message is **redirected to the PO's test inbox** (original recipient shown in the
  subject/body only). The real-data copy (5173) stays on the simulated outbox and never gets mail credentials.
  Both the approved reply and "Request missing details" send for real (outbox-first; protection and "Sent"
  only after Gmail accepts). Caps: 5/hour, 20/day (DB-backed). App passwords are for the pilot only —
  production needs Workspace/OAuth or a transactional provider with SPF/DKIM/DMARC.
- **Test sender changed to the PO's own personal Gmail** (2026-10-30; address kept out of git, see `.env.mail.test`) — chosen by the PO instead of a
  dedicated account, for testing only. Test mail is also redirected to that address. Its app password lives
  only in `.env.mail.test` on this PC and must be revoked when testing ends.
- **PDF proof moved to Vercel** (2026-10-31, PO decision, replaces the WSL plan): templates will live in the cloud
  in production anyway, and the PO owns the accounts during build. Guardrails: a separate throwaway Vercel project
  (not the app repo, no Git auto-deploy), templates bundled into the function only (never public files), access
  protected (Vercel Authentication + secret), project deleted after the proof with PO confirmation.
- **Phase 1 proofs** (2026-10-31, superseded for the PDF part): the LibreOffice-on-Linux proof runs locally in WSL so
  the private templates never leave the PC (the PO installs WSL); the inbox proof reads the PO's test Gmail **read-only**, only the app's own
  `[TEST →` emails plus a Sent-folder lookup by Message-ID. Don't deploy the full app to Vercel before phase 4.
- **Migration decisions** (2026-10-31, see `MIGRATION_PLAN.md`): the PO owns and pays for the Vercel and Supabase
  accounts during building/testing and transfers them to the client **before any real client data is imported**;
  PDFs via LibreOffice in a Vercel container with the "export from Word and upload" fallback (no CloudConvert);
  Supabase Auth for sign-in, as its own phase after the data move; phase 0 (cleanup + portable config) approved.
- **Target hosting remains Vercel + Supabase** (2026-10-30) — needs a migration first (SQLite → Postgres, files →
  Supabase Storage, LibreOffice → container/CloudConvert, mail polling → scheduled job). Plan with architect +
  database engineer before coding; Vercel Hobby is non-commercial (verify terms). Inbound email (reading the
  Gmail inbox) is approved as the next phase.
- **First online test runs free on a Cloudflare quick tunnel from this PC** (2026-10-30) — production build on
  port 5180 with its own test data (`test-results/staging-data`) and rotated passwords; see `STAGING.md`.
  Real `.data` is never exposed. Render's free tier was rejected: no persistent disk (data lost on restart).

## UI conventions

- **Template cards: "Select template" is the filled navy action; "Customize" is a quiet outline**
  (2026-10-30, PR #2).
- **Step subtitles describe real state** — step 1 "Details complete" (not "confirmed") until a version is
  submitted; step 3 "Not prepared yet" / "PDF needs updating" / "PDF prepared" (PR #2).
- **No developer jargon in staff UI** — e.g. "no tokens" was replaced with
  "Simulated AI · staff review required" (PR #2).
- **Step 3 fields panel on desktop (≥1181px) is 280px and single-column**; Save changes / Update preview
  never wrap (PR #2).
- **Phone action bar is two rows**; button labels never wrap (PR #2).
- **Top-right avatar menu opens under the avatar on desktop**; phones use the drawer (PR #2).

## Technical lessons (don't repeat)

- **Client state is derived on every read** (`clientState` in `lib/operations/client-rules.ts`), not stored.
  Rules about holds must be fixed there, and in `updateClientReview` / `activity.ts`, which read the saved
  `clientReview` too. `isRegistered(record)` = protection or an approved submission.
- **Index projections (`inquiry-index.ts` `clientProjection`) drop most fields** — anything the rules read
  from *other* records must survive the projection. Stale projections are re-queued at startup in
  `workspace-schema.ts`.
- **The fixed action bar's height varies** — clearance uses the measured `--ops-action-bar-h` set by
  `operations-action-bar.tsx`; `operations-conflict.css` had a `padding-bottom:0` for held layouts that
  silently beat it.
- **Only one `next dev` can run per project folder.** To QA on 5190, stop the 5173 server first, and copy the
  data with SQLite's backup API (`.data` has a live WAL) into `test-results/<name>/qa-data`.
- **PDF proof on Vercel, run 2 — PASSED (2026-10-31)**: the official LibreOffice **26.8.1** .deb (same as the PC,
  sha256-verified, full package set — removing Impress breaks `ogltrans`; also needs `libglib2.0-0`) in the Vercel
  container: page counts match on **11/11**, text 96.5–99 % similar, 9–10 of 14–15 pages identical, the D023 page-3
  heading is back above the table, 8–30 s per template on Hobby (2 GB). Remaining drift is font substitution only
  (Cambria→Caladea metric-compatible; Arial→Noto Sans in the header — map Arial→Liberation Sans via fontconfig in
  phase 5). Decision pending PO/client sign-off on sample PDFs; the Word-upload fallback stays.
- **PDF proof on Vercel, run 1 (2026-10-31)**: the Vercel container runtime works on Hobby — all 11 templates
  converted in 7–22 s each (local 9–22 s), 2 GB was enough, protected preview. But Debian stable ships
  LibreOffice **7.4.7** (local is 26.8) and fonts fall back (Cambria→Caladea, Calibri→Carlito, Arial/Times→Liberation,
  Aptos/Tahoma→DejaVu): page counts matched in only 1 of 11, text 93–96 % similar, and on D023 page 3 the product
  heading moved **below** the premium table. Not acceptable for client proposals as-is. Next: newer LibreOffice
  in the image, then compare again; the "export from Word and upload" fallback stays.
- A first `vercel deploy` on a new project goes to **production** even without `--prod`; use `--target=preview`.
  In Git Bash set `MSYS_NO_PATHCONV=1` before `vercel curl /api/...` (it rewrites `/api` into a Windows path).
- **`vercel link` inside this repo auto-connects the GitHub repo** (2026-10-31) — it linked the throwaway
  `rmc2-pdf-proof` project to `Yiizer/rmc2franchisingsystem` (main), which would deploy on every push. Caught and
  removed with `vercel git disconnect` before any deployment. After linking anything, check `link` via
  `vercel api /v9/projects/<id>` and disconnect unless Git deploys are intended.
- **IMAP proof passed (2026-10-31)**: the sending app password also works for IMAP; `readOnly:true` (EXAMINE) never
  sets `\Seen`; UIDVALIDITY + UID checkpointing works; bodyStructure gives attachment type/size without downloading;
  `\Sent` can be searched by exact Message-ID (use the special-use flag, not the localized name "[Gmail]/Sent Mail");
  the same Message-ID can exist in INBOX and Sent, so dedup per folder. Script: `test-results/proofs/imap/probe.mjs`.
- **The UI loads `GET /api/operations/workspace` (`workspace-query.ts`), not `/bootstrap`** — a field added only to
  bootstrap never reaches the screens (the email badge showed "LOCAL" while SMTP was on). Add shared payload fields to
  `workspaceView`, and have QA check the real browser, not just the API.
- **Google app passwords are 16 lowercase letters shown with spaces** — a normal Gmail password is always rejected
  (first live attempt failed with AUTH), and pasted spaces must be stripped (`mail-config.ts` now does). First live
  test send to the redirected test inbox succeeded on 2026-10-30; staging was set back to dry run afterwards.
- **Mail states:** dry runs never mark Sent or start protection (they leave "Approved — sending" + `mailDryRun`, and
  Retry sends for real); an uncertain send can only be resolved by an Admin ("Confirm sent…" / "Not received…",
  both audited with a reason). Real nodemailer connection failures report `ESOCKET`/`CONN`.
- **Absolutely positioned children escape `overflow:auto` scrollers** unless the scroller is `position:relative`.
  Hidden `.sr-only` labels in table headers widened the whole page at tablet widths; scroll wrappers
  (`.dash-queue-scroll`, `.dir-table-scroll`) are now positioned. Always sweep 768px too — the sidebar is
  still visible there, so toolbars need to wrap.
- **Verify specialists' claims in the code** — a developer reported a component "rendered" when it was only
  defined; the code reviewer caught it. Grep for usage, not just definitions.

- **CSS specificity fights**: `operations-tokens.css` uses `.ops-app.ops-app .ops-btn:is(...)` (0,4,0+).
  A workspace rule with lower specificity silently loses some properties — e.g. "Release to queue" became
  white-on-mint on hover. Check computed styles in the browser, not just the stylesheet.
- **`.ops-app label+label{margin-top:17px}`** (operations.css) offsets grid labels; grids must reset it
  with `.ops-app .ops-form-grid label{margin:0}`-level specificity.
- **Autofill refreshes are not user edits** — don't `setDirty(true)` from effects that only re-derive
  values; it locks Decline and lights up Save draft right after Start handling.
- **Accessible names differ from visible text** on template cards ("Select <template name>"); tests should
  match by visible text or the full accessible name.
- **Handling leases last 90 seconds** after a tab closes. A test that crashes mid-run leaves a lease, and
  the next run sees "Continue in this tab". Release handling at the end of tests.
- **Never review or test against port 5173** (real recovered records). Use an isolated data dir, e.g.
  `RMC2_DATA_DIR=test-results/<name>/qa-data` on port 5190.
- **The sign-in form is a username/email text field**, not the old account dropdown; older browser test
  scripts still select from a dropdown and need updating before they run.

### Async data layer (phase 2, 2026-10-31)

- **All data access is `await db.get/all/run/exec` and `await transaction(fn)`** (`lib/operations/store.ts`).
  A check-then-write that must be atomic (duplicate client, revision, "keep one approving supervisor") goes
  inside `transaction()`; awaits between separate statements can now interleave with other requests.
- **Never await slow I/O inside a transaction** (PDF generation, SMTP, `fetch`, `arrayBuffer`, file uploads).
  The transaction holds the one global write lock; do the slow work first, then re-check inside the transaction
  (the `generate` pattern).
- **Avoid `Promise.all` of writes inside a transaction.** If one rejects, the transaction rolls back; the store
  now makes any sibling's later statement throw ("issued after its transaction was rolled back") instead of
  silently autocommitting. Reads in `Promise.all` are fine.
- **Statements outside a transaction queue FIFO on the lock** (not "wait until idle"), so a stream of
  transactions cannot starve polls.
- **Accepted for the SQLite phase:** multi-read endpoints (`bootstrap`, `workspace`, inquiry details, directory)
  no longer read one snapshot; caches self-correct on the next poll. In the Postgres phase give them a
  REPEATABLE READ read-only transaction. `activeInquiryActivity` prunes inside a transaction on every poll
  (microseconds on SQLite; revisit with Postgres). Login rate-limit check and failure record are separate
  statements; make them one transaction before any transaction can span I/O (security review in phase 4).
- **File storage rule (phase 3 design, 2026-10-31):** never call `files()` inside `transaction()`. Write the file
  first under a fresh unique key (uuid or content hash), then commit the row that references it; a row may only
  reference a key whose `put` resolved. If the transaction fails, best-effort delete per-request keys; never delete
  content-addressed keys (`sources/<sha>`, `templates/<sha>`). Orphans are harmless (sweep later, phase 8+).
- **Phase 3 QA findings (2026-10-31), for later phases:**
  - Legacy packages without `generated.renderer` cost one storage read each on a cold cache (Supabase: ~0.4–0.8 s
    per package; 3.3 s first bootstrap for 4). **Backfill `generated.renderer` during the phase 8 import.**
  - Before cutover, run a read-only check that every stored file key passes `assertKey` (a failing key would now
    return 400 instead of the file).
  - Orphaned objects accumulate (a workflow run left 37 unreferenced generated/source objects); a sweeper
    (`list` minus referenced keys) is needed before production (phase 8).
  - A cold LibreOffice profile can take ~72 s for the first conversion, close to the 90 s timeout; warm the
    converter at startup or raise the first-run timeout when the converter moves (phase 5).
  - Run storage e2e against Supabase with `RMC2_STORAGE_PREFIX=selftest/e2e-<run>/` and delete the prefix after.
- **FINAL-CHECK LIST (deferred by the Product Owner on 2026-10-31 to save usage).** Phases 4 onward are built
  lean, with quick checks only. Everything below MUST run before any real client data or real staff use. Never skip it.
  - Full QA, including the Postgres stress tests T1–T10 from `test-results/phase4-design.md`. The QA run stopped
    part-way. Its scripts `scripts/test-pg-*.mjs` and `scripts/db-parity/` are committed but unverified.
  - Code review and security review over everything together.
  - Code-review majors, not yet fixed in code:
    - M1, lost index enqueue: the DB fix is written in migration 400, not applied.
    - M2, retry 40001/40P01 raised at COMMIT, in `store-postgres.ts`.
  - Code-review minors:
    - lock order: lease and `idx-sync`, sorted `lease:` locks;
    - wrap the poll's prune in try/catch;
    - batch the reindex;
    - activity filter by inquiry;
    - `updateOwnAccount` re-reads the user;
    - `requestDetails` takes the `ck:` lock;
    - NUL stripping for all writes;
    - log-safe `mapPgError`.
  - Security:
    - Apply migration 500 (hardening).
    - Verified TLS with the Supabase CA.
    - Login limits keyed on user id, plus per-IP and global, prune `auth_attempts`, async scrypt.
    - Demo seed only via a manual script with random passwords, a `VERCEL_ENV=production` guard, and remove the shared password from the README.
    - Safer rollbacks are written; check them.
  - Preview: before sharing the link with anyone, rotate the demo passwords. The shared one is in the code.
- **Vercel preview (2026-10-31):**
  - Project `rmc2-preview` on Hobby, not connected to Git, deployed with `vercel deploy --target=preview`.
  - Stable alias https://rmc2-test-yiizer.vercel.app; set it again after each deploy with `vercel alias set <url> rmc2-test-yiizer.vercel.app`.
  - The preview env holds Postgres, Supabase storage and the `preview/` prefix. Mail is simulated, and PDFs are offline until phase 5.
  - Templates are bundled privately via `outputFileTracingIncludes` and `.vercelignore`. Vercel CLI uploads git-ignored `resources/private` when `.vercelignore` exists.
  - Lessons:
    - The Vercel-only guards must skip `NEXT_PHASE=phase-production-build`.
    - `vercel link` writes `VERCEL_OIDC_TOKEN` into `.env.local`.
- **Inbound email, lean phase 7 (2026-10-31):**
  - **Reading:** IMAP read-only on `INBOX` of the test account, using the sending app password.
  - **Requests page:** **PO decision (2026-10-31): agents email forms in and the system imports them automatically.** An email with an Excel franchise form becomes an inquiry through the normal intake, recorded as "Email intake (automatic)". PDFs and other emails wait on the Requests page with "Create inquiry", because a PDF could be anything. An unreadable form also waits there, with the reason shown.
  - **Import:** "Create inquiry" runs the normal intake on an attachment.
  - **When it checks:** an automatic check every 2 minutes while anyone has the app open (`after()` on the workspace poll, one claim per slot via `inbound_cursor.checked_at`), plus "Check mail now" and a daily cron at `/api/operations/inbound/cron` (`CRON_SECRET`).
  - **Lessons:**
    - Vercel Cron runs only on PRODUCTION deployments, so previews rely on the button.
    - **Online PDF files exceed Vercel's 4.5 MB body cap.** Convert through short-lived Supabase signed links (`/convert-url`), never in the request body.
    - Test mode redirects our own replies into the same inbox; those are skipped.
  - **Final check:**
    - review the IMAP failure modes;
    - sender trust (show SPF/DKIM only, never treat the address as identity);
    - the inbox retention policy.
- **Online PDFs and real email on the preview (2026-10-31, approved by the PO):**
  - Converter: `converter/`, a separate Vercel container project `rmc2-converter`, alias `rmc2-converter-yiizer.vercel.app`, behind Vercel Authentication.
    - The app passes `RMC2_CONVERTER_BYPASS` for Vercel protection and `RMC2_CONVERTER_SECRET` for the converter's own check.
    - **`vercel env add` via stdin can store a trailing newline: always `.trim()` secrets read from env.**
  - Mail: `RMC2_MAIL_ENV=staging` with dry-run off.
    - All mail is redirected to the yiizer17 test inbox, with caps of 5 per hour and 20 per day.
    - `RMC2_DATA_DIR=/tmp/rmc2-preview` on Vercel. The staging guard refuses sending from `<cwd>/.data`.
    - SMTP from Vercel to Gmail port 465 is unverified until the first approval sends.
- **Postgres on the TEST project (phase 4, 2026-10-31):**
  - The three `supabase/migrations` files were applied to schema `rmc2`, with the security self-check passing.
  - The `rmc2_app` password is generated into `.env.supabase.test` as `RMC2_DATABASE_URL` (transaction pooler, port 6543). The owner connection for migrations is `RMC2_DATABASE_ADMIN_URL` (session pooler, port 5432). Neither is ever printed.
  - Verified live:
    - role defaults: `search_path` rmc2, timeouts 15s/5s/30s
    - DDL is denied to the app
    - transaction-scoped advisory locks work through the transaction pooler
    - every table has RLS
    - `anon` and `authenticated` are denied
    - the Data API does not expose `rmc2`
    - the 31 adapter checks pass live, including deadlock retry and lock-timeout 503
- **Use postgres.js 3.4.7, not 4.0.0** (2026-10-31). v4 hangs forever when more queries than `max` queue up behind
  the Supabase transaction pooler (6543); v3 completes the same load in ~0.8 s. `queue_timeout` isn't a real
  option, so bound pool waits ourselves. Always test "more parallel requests than pool connections" live.
- **Pasting connection strings:** Supabase shows `[YOUR-PASSWORD]`. When filling it in, remove the square brackets as well; leaving them gives "password authentication failed".
- **Supabase TEST project** (2026-10-31, PO's free org "RMC2 Testing", Singapore): ref `pgoiqwixaeqbxlwbmren`,
  private bucket `rmc2-test-files`, credentials only in git-ignored `.env.supabase.test`
  (`RMC2_SUPABASE_URL`, `RMC2_SUPABASE_SECRET_KEY`). Synthetic test files only, never real client data. Use the
  **secret** key (`sb_secret_…`); the publishable key gets "row-level security" 403s. Free projects pause after
  a week idle (resume from the dashboard).
- **Create schema when the connection opens, never lazily per request** behind an "installed" flag. The lazy
  historical schema could run inside a request's transaction, roll back, and leave the flag set: two first-ever
  requests on a new database both got 500 "no such table: historical_accounts" (pre-existing, fixed 2026-10-31).
- **Phase 2 QA method:** run each failing e2e script against a baseline build of `main` too; identical failures
  are stale scripts, not regressions. Scripts that edit SQLite directly (e.g. `test-exclusive-handling` expiring
  leases) need the server on their own `test-results/<script>/qa-data` dir and a fresh dir per run.

## Process

- Team roles live in `~/.claude/agents/`; playbook: `D:/AI-Skills/AI_TEAM_PLAYBOOK.md`.
- **Use the graphify code graph for context** (2026-10-31): `graphify update .` (code only, offline, respects
  `.gitignore`, output in the gitignored `graphify-out/`), then `graphify query "<question>" --budget 1500`,
  `graphify path "A" "B"` or `graphify explain "X"` before broad greps. Re-run `update` after large changes, and
  tell specialist agents to query it first.
- Plan → Product Owner approval → implement with file ownership → QA + code review → report.
- Specialists' "done" is not verification; the lead checks evidence (diffs, test output, screenshots).


## 2026-11-09: Storage bucket file size limit 25 MB (PO)

- The test bucket `rmc2-test-files` now refuses objects over 25 MB (it was unlimited, so the project default of 50 MB applied).
- **Why 25, not 15:** the app allows 15 MB of attachments per email, and the saved .eml copy is about a third larger. The app's own upload limit stays 15 MB.
- **Production:** set the same limit on the production bucket at cutover (`scripts/set-bucket-limit-test.mjs` is the TEST-only version).
