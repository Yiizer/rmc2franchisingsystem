# Remaining work (updated 2026-11-13)

This is the one checklist of what is left. Decisions and reasons: `TEAM_DECISIONS.md`. Cutover steps: `PRODUCTION_RUNBOOK.md`.
The dated sections below this list are the history of what was done and how it was checked.

## TO-DO TO GO-LIVE (2026-11-13)

**PO** = Product Owner, **client** = RMC2, **dev** = done in this repo. Monday 16 Nov is a real beta on the test version;
production must be fully working by Tuesday 24 Nov.

### Done 2026-11-13 (the PO away; see the dated section "Divisions, design check, security fixes…" below)
- [x] Problem Reports: IT Admin only (the Head no longer sees it).
- [x] Divisions & Branches redesigned. The Head can add and delete divisions; a division with people assigned cannot be deleted.
- [x] Every screen checked for layout and contrast, as every role, desktop and phone, light and dark; fixes made.
- [x] "Create inquiry from this email" on Requests.
- [x] Security review: Next.js upgraded, push endpoints restricted, tighter role checks, security headers.
- [x] The move-to-production script, rehearsed on made-up data.

### A. Before the beta on Monday 16 Nov
- [ ] **PO:** send the company franchising mailbox (address and app password), due Sat 14 Nov.
- [ ] **dev:** switch live email on with it:
  - SMTP settings, `RMC2_MAIL_ENV=production`, `RMC2_MAIL_LIVE_CONFIRM`, caps 60/hour and 300/day;
  - deploy, then send one test email to an address the PO chooses. **[PO go-ahead]**
- [ ] **PO decision:** the first check of a new mailbox reads its **last 14 days** and imports any franchise forms it finds by itself. Import those, or start from the switch-over?
- [ ] **PO:** send the real staff list (name, role, email; division for Division Heads and SOAs).
- [ ] **dev:** create the accounts with temporary passwords, switch off the 6 demo accounts, and delete the 4 `check.` accounts.
- [ ] **client:** the email signature. **dev:** put it in the email templates.
- [ ] **PO:** send testers the shareable link (`test-results/online-credentials/SHARE-LINK.txt`), their sign-in, and a note to use **Report a problem** for anything wrong.
- [ ] **PO decision, risks of running real work on the test setup:**
  - Vercel Hobby is for non-commercial use;
  - the free Supabase project has no backups you can restore, and pauses after 7 idle days;
  - inbox checks run only while someone has the app open; the cron is daily.
  - **No backups on this PC** (PO, 2026-11-13). A nightly backup to this PC was set up, then cancelled at the PO's request the same day: the task was removed, and the two copies and the local restore rehearsal files were deleted. **Decided (PO, 2026-11-13): "No backup for now."** TEST runs the beta with no restorable backup; the PO accepts the risk of losing beta work if the TEST project fails. Revisit if production slips past 2026-11-24 (option: Supabase Pro on TEST, daily backups, about US$25/month).
- [x] Test inquiries and test emails cleared from TEST (2026-11-13).
- [x] Shareable link checked, the live caps made configurable, the runbook schedule set (2026-11-13).

### B. During the beta, 16–20 Nov
- [ ] **dev:** read Problem reports and App errors every day; fix and deploy the same day; test each fix.
- [ ] **dev:** try it on real phones (iPhone Safari, Android Chrome).
- [ ] **dev:** run the Admin's "Unused stored files" scan and delete after 24 hours. Leftovers are expected from the clear-out of 2026-11-13.
- [ ] **dev:** watch the email send counts against the caps; watch for "uncertain" sends and confirm them.

### C. Production setup, 18–21 Nov
- [ ] **client:** create the Vercel Pro team and the Supabase Pro organisation and invite us, **by Wed 18 Nov at the latest**.
- [ ] **dev:** set up the Supabase project (Singapore):
  - migrations one file at a time, with `environment=production` set right after the first;
  - the `rmc2_app` password;
  - a private bucket with a 25 MB limit.
- [ ] **PO:** download the Supabase CA certificate. **dev:** set `RMC2_DATABASE_CA` and `RMC2_DATABASE_SSL=verify-full`.
- [ ] **dev:** set up the Vercel project:
  - production env vars (runbook table);
  - the PDF converter project;
  - the Firewall rate-limit rule on sign-in;
  - the inbox cron every minute;
  - new phone-notification keys.
- [ ] **PO decision:** a custom domain (for example `franchising.<client domain>`) or the `vercel.app` address; and whether production also sits behind Vercel protection.
- [ ] **dev:** write the TEST → production move script (runbook §4). It skips fictional records and demo accounts, keeps the counter, and copies the files under the same keys.
- [ ] **dev:** rehearse the move twice: counts, file hashes, open inquiries and PDFs, then empty production again.
- [ ] **dev:** check all 13 active templates' PDFs on production against the client's signed-off samples. **client:** sign off the sample PDFs.

### D. Final check, 22–23 Nov
- [ ] **dev:** run the full regression on production with mail redirected:
  - every test in `scripts/`;
  - the stress tests through `scripts/pg-local.mjs`;
  - the online checks (roles, large files, email edge cases).
- [ ] **dev:** a final security review: auth, file access, inbound email and env/secrets.
- [ ] **PO:** merge `phase-4-postgres` into `main`, then sign off for go-live.

### E. Go-live, Tue 24 Nov **[PO]**
- [ ] Freeze TEST: mail back to staging, and staff stop work.
- [ ] Back up TEST, move the real data to production, and verify it.
- [ ] Deploy `main` to production, switch production mail live, and send one test email.
- [ ] Staff move to the production address; check every account can sign in.

### F. After go-live
- [ ] Watch Problem reports daily for two weeks. Run the stored-files sweep after the first week.
- [ ] After 30 days, pause the TEST Supabase project, delete or transfer `rmc2-preview` and `rmc2-converter`, and revoke the yiizer17 Gmail app password.
- [ ] Later: Supabase Auth (self-service password reset, MFA); a "Create inquiry from this email" button for emails with no attachment; font mapping (Arial → Liberation Sans); fix or retire the old tests `test-directory-model` and `test-workspace-advisors`; remove the leftover AI CSS.

## Divisions, design check, security fixes, Create inquiry from email, move script (2026-11-13, PO: "do everything without me")

- **Problem Reports are for the IT Admin only** (PO). Changed in the server (`canSeeProblemReports`), the menu, the confirmation text and the tests. Everyone can still file a report. `test-problem-reports` 11/11; `roles-check-online` now expects the Head to be refused.
- **Divisions & Branches, redesigned and easier to use** (PO: "more premium… hard to use… divisions can be deleted or added"):
  - **Layout:** two panes, divisions on the left with branch counts, people assigned and directory clients; the selected division on the right. Summary tiles, branches as rows, other spellings as tags (Enter or comma adds, × removes). Moving or removing a branch from its row, a search across all branches, a save bar only while there are unsaved changes, and a picker on phones.
  - **Add and delete divisions.** A division keeps its name once saved. It cannot be deleted while a Division Head or SOA belongs to it: the page explains why, and the server refuses (409), under the same lock as account changes. Records filed under a deleted division keep the name as text and sort as Unassigned.
  - **Division names now come from the saved table everywhere:** account forms, the directory filters and counts, and old-record labels such as "Div 8". The inquiry "Edit details" dropdown used to stop at Division 5; that is fixed too. `scripts/test-division-edit.mjs` 4/4 (new).
  - **Checked in the browser** (light, dark, 390 px): add Division 8 with a branch and a spelling, save, the delete rules, search, and phone layout without sideways scroll.
- **Design check of every screen.** An in-page audit covered every menu page for all 6 roles, at 1440 and 390 px, light and dark, plus an open inquiry, Settings and Notifications. It checked for sideways scroll, content off screen, unnamed buttons, broken images, error alerts and WCAG AA contrast.
  - **Fixed:**
    - the footer text (2.77:1, 9–10 px), now the muted colour at 11 px;
    - the "Not started" pill (4.45);
    - tab counts (4.08);
    - the Integrations descriptions (3.76);
    - Monitoring "Connected" (4.47);
    - **the colour legend ran off the right edge on phones and tablets**, so it now opens as a bottom sheet.
  - **Not app problems:** flags from paused CSS transitions in the background preview pane (checked by reloading in the theme), screen-reader-only labels, and dropdowns.
- **Create inquiry from this email** (on Requests, for Employees and the Admin): for an email with the details in its text and no usable form.
  - **How it works:** it opens the fill-in form with the agent's name and email from the sender, and the email's text beside it. It creates the inquiry through the normal intake (duplicate checks, notifications, origin "email"), and marks the email imported.
  - **Reply-To handling:** the agent email is pre-filled from the From address. If staff change it, the existing "Reply-To differs from From" warning shows.
  - New emails keep up to 5,000 characters of text; retention clears it.
  - `scripts/test-inbound-create.mjs` 3/3 (new): an Employee creates; a second create gives 409; the Head, a Division Head and bad details are refused and the email goes back to "To review". Checked in the browser end to end.
- **Security review (security-engineer, read-only): no Critical or High in the app code.** Fixed:
  - **M1:** `next` 16.3.4 → **16.4.3**, which fixes the critical and high advisories; `npm audit fix` covered the build-time packages. **Left on purpose:** `zod` (the fix is the major 4.x rewrite; Vercel's 4.5 MB request cap limits the risk) and `uuid` inside `exceljs` (the affected functions aren't used). Revisit after go-live.
  - **M2:** phone-notification endpoints are limited to the browsers' push services (FCM, Apple, Mozilla, Windows). `test-push-endpoint` passes.
  - **L1:** declining needs an Employee, Supervisor or Head even without the decline email, and so does correcting directory records (the IT Admin could do both).
  - **L3:** expired sessions are now deleted.
  - **L4:** the error log keeps only the error name and code.
  - **L6:** security headers on every response: `frame-ancestors 'self'`, X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy, HSTS. The app still frames its own PDF route.
  - **Still open:**
    - **M3:** account lockout and the site-wide pause are known trade-offs; the Vercel Firewall rule at production covers them.
    - **M4:** the warning for unverified senders is already shown on the To line.
    - **L2:** a total-bytes cap per inbox check.
    - **L5:** one app password for sending and reading.
- **Move to production:** `scripts/move-to-production.mjs` plus `scripts/rehearse-move-local.mjs` (see `PRODUCTION_RUNBOOK.md` §4).
  - **Rehearsal on made-up data:** 6 inquiries and 12 files moved and verified. The default plan leaves out fictional inquiries and demo accounts, and a second move is refused.
  - **Fixed in `pg-local.mjs`:** it now refuses to start when its ports are taken. Another server answering on 5190 had made a first rehearsal run against the wrong data.
- **Tests:**
  - 38/40 standalone tests pass; `test-directory-model` and `test-workspace-advisors` are old and fail as before.
  - `test-workflow` 53/53; `test-client-protection` 48/48 and `test-workspace-upgrade` 17/17 (earlier today).
  - Postgres HTTP 21/21 and concurrency 16/16 (earlier today).

## Real beta from Monday 2026-11-16, production by 2026-11-24 (PO 2026-11-13)

The decisions are in `TEAM_DECISIONS.md`. The beta runs on the current test version, with real emails to agents and access through the shareable link.
- **Access:** the shareable link from the 2026-11-04 demo is still active and never expires. The PO chose to keep it, so it is now the beta testers' link. Saved in the git-ignored `test-results/online-credentials/SHARE-LINK.txt`.
  - Checked: without it, Vercel's login (302); with it, the app's sign-in page (200).
  - It is attached to the alias, so it survives every re-alias.
- **Sending caps for real use:** live mode used to be fixed at 5/hour and 20/day. Now `RMC2_MAIL_CAP_PER_HOUR` and `_PER_DAY` work in live mode too, up to 100/500. PO choice: **60/hour, 300/day**, set when live email is switched on. `test-mail-transport` 16/16 (new caps check).
- **Fictional inquiries cleared from TEST** (PO: "Yes, delete them"), with `scripts/clear-test-inquiries-online.mjs`. It lists by default, flags anything that doesn't look fictional, backs up, then deletes in one checked transaction.
  - All 26 were demo or test records (`INQ-2026-00141` to `00154`, `00281` to `00292`). `00154` (the demo form emailed in for the 11-06 import check) and `00284` (yesterday's hand-imported test PDF) were checked by hand.
  - Deleted: 26 inquiries, 59 notifications, 225 recipient rows, 76 index keys, 26 summaries, 12 outbox rows, and the 2 retired "Online Check Plan" templates. Backup in `test-results/clear-test-inquiries/` (git-ignored).
  - **Kept:** the client directory (3,579), 13 active templates, all 12 accounts, and the append-only audit rows. Stored files go through the Admin's sweep after 24 hours.
  - After: `roles-check-online` 37/37, 0 inquiries.
- **Still needed before Monday:**
  - [ ] **The company mailbox** (the PO sends it 2026-11-14), then switch live email on this weekend (PO). Settings: `RMC2_MAIL_ENV=production`, `RMC2_MAIL_LIVE_CONFIRM`, SMTP set to the company mailbox, caps 60/300. Agents then email their forms to the company mailbox.
  - [ ] **The real staff list**, then create the accounts and switch off the 6 demo accounts and the `check.` ones.
  - [ ] **The email signature** (client).
  - [x] **The 13 test emails on Requests cleared** (PO, 2026-11-13), with `scripts/clear-test-emails-online.mjs`, after a backup.
    - They were 9 edge-check emails, the 6 Nov demo form, a Google security alert and two newsletters.
    - The inbox cursor is kept. Afterwards Requests lists 0, "Check mail now" connects and adds 0, and `roles-check-online` passes 37/37.

## Email edge cases, inbox failures, days left (2026-11-12)

- **Online on TEST** (`scripts/email-edge-online.mjs`, fictional data; 9 test emails sent from the test mailbox to itself, plus 6 details requests to the redirect). 9/9:
  - **Several attachments:** the form and two PDFs are kept, the Word file is not, and the form imports by itself (`INQ-2026-00281`).
  - **7 attachments:** 5 are kept.
  - **A 16 MB email:** skipped with "too large to read here. Open it in the mailbox."
  - **An 8 MB attachment:** not stored.
  - **A non-form workbook:** waits on Requests with the layout reason.
  - **A PDF renamed to .xlsx:** not kept.
  - **The same client emailed by two agents:** the first is clear, the second is held (`00282` / `00283`).
  - **An emailed PDF goes to Requests, then an Employee creates the inquiry** (`00284`). The Head is refused (403): creating inquiries is an Employee/Admin step.
  - **Sending cap:** 6 details requests went through, because TEST still runs the demo-day caps (`RMC2_MAIL_CAP_PER_HOUR=30`, `_PER_DAY=100`, set 2026-11-05). The 5/20 boundary is checked locally (`test-mail-service`). **PO decision open:** keep the raised caps for the dry runs, or go back to 5/20.
- **Fixed:** the cap refusal always said "5 per hour, 20 per day". It now names the configured limits.
- **Failed and uncertain sends:** they can't be forced on TEST without changing its mail settings (PO: no). Covered locally by `test-mail-service` 9/9 (fake transport: failed, uncertain, confirm sent, not received, retry).
- **Inbox down and app password revoked, simulated locally** (`scripts/test-inbound-down.mjs` 4/4, new; a fake IMAP server that refuses the sign-in like Gmail):
  - the message says the app password may have been revoked, with no credentials in it;
  - Requests gets the failure count and reason;
  - after 4 failures the automatic check waits 10 minutes, while "Check mail now" still tries;
  - with the inbox down the reason changes to "could not be reached".
- **Days left (fixed):** counted in Manila calendar days to the end date, so clients ending on the same date show the same number at any hour. It is at least 1 while protection runs and 0 once it ends. Tests on reminders, owner view and roles pass.
- **`PHASE2_UI_SPEC.md`:** the owner status is "Enrolled".
- **Fixed, from the 4.5 MB work's known list: two parallel requests with one upload id could both use it.**
  - The first request to insert an `upload-used:` row wins; the others get 409 "already used".
  - Claims older than an upload's 1-hour life are removed by a key range.
  - `test-large-files` 11/11 (new check: 3 at once, one gets the file, two get 409).

## Postgres stress tests on a local copy, two bugs fixed, cutover runbook (2026-11-12)

PO decisions 2026-11-12: T4, T5 and T10 run only on a throwaway local database, never on TEST. Email edge cases may run on TEST, to the redirect inbox. The inbox-down cases are simulated locally.
- **`scripts/pg-local.mjs` (new):** a throwaway PostgreSQL 17 on 127.0.0.1, with UTF-8 like Supabase and the three Supabase roles.
  - It applies all 13 migrations one by one, starts two `next start` instances sharing one deployment id, runs a test against them, then deletes everything.
  - `embedded-postgres` (17.10.0-beta.17, PO approved the download) is installed outside the repo and is not a project dependency.
- **Results on the local copy:**
  - `test-pg-http` 21/21: T3, T4, T5, T6h, T8, T10.
  - `test-pg-concurrency` 16/16: T1, T2, T6, T7. On a local database the pooler-port check reports "not applicable".
  - **T3, T4, T5 and T10 are now valid.** Fixes were in the tests: T5 for the per-account and per-IP sign-in keys (`next start` sets `x-forwarded-for` like Vercel, so the IP limit applies); T10 for account changes that only the Head may make.
- **Bug 1, fixed: a closed transaction connection could crash the server** (the "postgres.js socket error" seen once on 11-09). When Postgres ends a transaction left idle (30 seconds), postgres.js 3.4.x still writes COMMIT or ROLLBACK to the dead socket once the body finishes. That write throws from a timer and ends the process; 3.4.9 has the same code. `store-postgres.ts` now never hands a body on a dead connection back to the driver. The caller already got its 503, and the server has already rolled back. T1's idle test now passes, and the suite runs on to the end.
- **Bug 2, fixed: two agents could both get "clear" for the same client.** Who was first is decided by `createdAt`, but intake set it *before* waiting for the client lock. A request that started first but got the lock second counted as earlier than the one that had just committed, ignored it, and stayed clear. T2 showed this in 5 of 7 runs, on the committed code too; it hardly shows on TEST, where the network spreads requests out.
  - **Fix:** under the lock, the new inquiry is dated after every match it finds, whatever the clocks say (`intake` in `service.ts`).
  - **After the fix:** T2 6/6 in 5 runs in a row; SQLite `test-client-protection` 48/48 and `test-workflow` 53/53.
- **Production runbook:** `PRODUCTION_RUNBOOK.md` (new). The environment marker order was checked on the local copy: with `environment=production` set right after the first migration, it stays `production` after all 13, and `rmc2_app` is refused when it tries to change it (42501).
- **Portable SQL:** the last `LIKE` queries were replaced with byte ranges (`owner-view.ts`, `problem-reports.ts`, the intake key prune in `service.ts`, `file-sweep.ts`). `test-phase4-callsites` now passes 15/15; it failed on HEAD.
- **Other out-of-date tests fixed:**
  - `test-store-postgres`: the paused-project message.
  - `test-storage` 45/45: progress reports are filed by the owner.
  - `test-config`: 8 seeded accounts.
- **Local regression (2026-11-12):** all 34 standalone tests pass, except `test-directory-model` (old fixture databases) and `test-workspace-advisors` (its own module loader is broken). Both failed the same way before today. `test-proposal-document` needs `node --env-file=.env.local`. Server tests: `test-client-protection` 48/48, `test-workflow` 53/53, `test-workspace-upgrade` 17/17.

## Unused stored files: scan and delete for the Admin (2026-11-11)

- **What:** `lib/operations/file-sweep.ts` and an "Unused stored files" card at the bottom of the Admin's Monitoring page. `GET stored-files`, `POST stored-files/scan` and `POST stored-files/delete` are Admin only. Nothing is deleted automatically.
- **Rules:**
  - **Folders:** only the folders the app writes record files into are looked at (attachments, bor, generated, inbound, outbox, sources, templates). On this computer the store's root is the data directory, so this keeps the SQLite database, `backups/`, `historical-sources/` and `runtime/` out of reach. The first test run showed the database files listed as unused before this rule was added.
  - **In use:** a file is in use when its full name, or any id or hash in its name, appears in any text column of any table, or in `catalog.json` (template masters are named by their hash).
  - **Two passes:** a file is deleted only if a scan at least 24 hours earlier also found it unused, and it is still unused when the Admin deletes, because storage records no write times. At most 500 per run. Each deletion is logged in `security_events`.
- **Why it matters:** regenerating a proposal replaces the package without deleting the old PDF and Word files. In the real local data, a read-only count found 63 such packages (126 files), plus 6 template masters and 17 forms and emails from 2026-10-10 that nothing refers to, in `runtime/` or anywhere else.
- **Checked locally:**
  - `scripts/test-file-sweep.mjs` 6/6 (new): the name rules, Admin only, the database and other folders never listed, the 24-hour wait, a file that gains a reference before deletion is kept, the log entry, and the status.
  - Browser on a QA copy: a scan found 20 of 48 unused (all regenerated packages). With the scan backdated, the confirmation dialog deleted those 20, and all 7 package files still in use and the database stayed.
  - `tsc`, build and lint pass.
- **Online** (commit `29ce6ec`, deployment `rmc2-preview-efyfhjsiz`, aliased to rmc2-test; `roles-check-online` 37/37):
  - `scripts/stored-files-scan-online.mjs` (scan only, never deletes): the Head is refused (403).
  - The Admin's scan works on Postgres: 143 stored files, 62 unused (attachments 31, bor 4, generated 20, inbound 2, outbox 5). They are ready from 2026-11-12 23:10 Manila.
  - The 11-09 audit counted 36. The rest most likely belong to the 126 fictional inquiries deleted later that day, whose files were deliberately kept.
- **Deleted on TEST, 2026-11-12 23:12 Manila.** The PO said 2026-11-12 to delete them unless the checks would use them; no check can, since no record points to them.
  - Run with `node scripts/stored-files-scan-online.mjs --delete` (the Admin's delete route): 62 ready, 62 deleted, so 110 stored files are left.
  - A new scan found 3 unused files in `outbox/`, ready from 2026-11-13 23:12. They were not deleted.
  - **Afterwards:** `roles-check-online` 37/37 and `large-files-check-online` 4/4. All 8 TEST inquiries with a proposal still serve their PDF.

## Inbound email retention, and approval notices for the Head (2026-11-11; commit `f87ea03`, live on deployment `rmc2-preview-h85ry287h`, aliased to rmc2-test; `roles-check-online` 37/37)

- **Retention (PO decision 2026-11-11: 30 / 60 / 90 days):** `pruneInbound` in `lib/operations/inbound.ts` runs from the inbox check, at most once an hour per server.
  - **Cleared after:** 30 days for a skipped email, counted from when it was skipped; 60 days for one nobody handled; 90 days for an imported one, counted from the import.
  - **What clearing does:** the app's copy of the email and its stored attachments are deleted. A small row stays (id, Message-ID, dates, inquiry link; no sender, subject, text or file names), so the same email is never stored twice.
  - **Not affected:** the inquiry keeps its own copy of the form. The original stays in Gmail, which the app only reads.
  - **Cleared emails** no longer show on Requests. An email being imported is never touched.
  - **Age:** new emails record `storedAt`, and the age is the latest of the Date header, `storedAt` and the handled time, so a backdated Date header can't make an email disappear early.
  - No migration was needed: `cleared` is a new value of the existing `state` text column.
  - **Checked:** `scripts/test-inbound-retention.mjs` 5/5 (new): each limit one day either side, attachments deleted, the kept row has no personal data, the Message-ID stays unique, a backdated header, an email being imported, the Requests list, and a second run. `test-inbound-safety` 4/4 and `test-inbound-auth` 5/5 still pass.
- **Bug fixed: the Head got no "Proposal awaiting approval" notice.** Only Supervisors with approval rights were notified, a rule from before Emerson became Head on 2026-11-05. It now notifies everyone who can approve (`canApproveProposal`: the Head, and Supervisors with approval rights). `test-workflow` passes 53/53 end to end. `test-workspace-upgrade` passes 17/17, roles scoping 30/30.

## AI removed for the first release (2026-11-11, PO: "we will remove ai for now"; commit `7b5577f`, live on deployment `rmc2-preview-9dr1vzyjv`, aliased to rmc2-test)

The production decisions from the same day are in `TEAM_DECISIONS.md` ("Production deployment decisions").
- **Removed:** the `AI_FEATURES` switch (it had hidden these since 2026-11-07) and everything behind it:
  - the "AI notes" button and panel in the proposal editor (`operations-ai-notes.*`, `operations-proposal-help.tsx`);
  - the simulated proposal assistant (`POST inquiries/<id>/chat`, `chat()` and `getProposalHelp`);
  - AI token usage in Monitoring, and the "AI" row on Integrations.
- **Monitoring** (`GET monitoring`) is now Admin only. The Head and Supervisors used to get an AI-usage-only answer there, now 403. Their Monitoring page is the proposal dashboard, which is unchanged.
- **Unused old prototype deleted:** 15 files the app never loads (`app/admin.tsx`, `workspace.tsx`, `simple-workspace.tsx`, `model.ts`, `chatgpt-auth.ts`, `franchise-workspace.tsx` and the files only they used), plus two browser tests for the AI panel.
- **Kept:** the rule-based "Suggested templates" (fixed matching rules, labelled "Staff review required"). The `ai_usage` table stays in both databases, since dropping it would need a migration; nothing reads or writes it any more. Old records keep their `chat` field.
- **Checked locally:**
  - `tsc` passes, `npm run build` passes and `theme:check` passes. Lint: no new problems in the changed files (one fewer).
  - `test-roles-scoping` 30/30, `test-proposal-stats` 16/16, `test-problem-reports` 11/11, `test-login-limits` 7/7, `test-large-files` 10/10, `test-division-team` 9/9, `test-workspace-upgrade` 17/17.
  - Browser, fresh QA data on port 5190:
    - the Admin's Monitoring and Integrations show no AI;
    - the Head's proposal dashboard loads and calls only `monitoring/proposals`;
    - the proposal editor has no AI button or panel, and the D023 preview renders its 14 pages.
- **Out of date, not caused by this change:** `test-workflow` now runs past the old assistant step (23 checks), then stops at "emerson receives approval notice", because Emerson is Head since the roles restructure. Its notice loop now covers only the accounts it signs in. `test-pg-http` drops its two chat probes.
- **Online:** `npm run build` passed first; `roles-check-online` 37/37 across the 6 roles (the Admin's `monitoring` 200, the Head's proposal dashboard 200). No migration was needed.

## Online-check inquiries deleted from TEST (2026-11-09, PO: "Yes, delete them")

- `INQ-2026-00155` to `00174`: all 20 were confirmed fictional by name ("Pilot Check", "Check …", "Large File Check"), and no other record referred to them. Deleted with 60 index keys, 20 summaries, 42 notifications and 3 outbox rows, in one transaction that checked every count before committing. **14 inquiries left on TEST.**
- Online afterwards: `roles-check-online` 37/37; the Dashboard, inquiry lists and a directory search show none of them.

## Security follow-ups, tests and final pass (2026-11-09; commits `d43d495`, `2c3d2ba`; deployment `rmc2-preview-6fxew8is5`)

- **Done:**
  - all 13 rollbacks are guarded, with no BOM, and listed newest first in `supabase/README.md`;
  - migration `20261109000000_protect_environment` is applied to TEST: as `rmc2_app`, three attempts to change the label were refused (42501), and `projection_version` is still writable;
  - inbox health warning and back-off, stuck imports released, attachment content checks, and the workbook safety check (`test-inbound-safety` 4/4).
- **Outdated tests fixed (qa-engineer):** exclusive handling 10, workspace upgrade 17, mail service 9, roles scoping 31. No app bugs.
- **Final pass (read-only, online):**
  - 19 staff pages × light/dark × 1440/1366/phone (473 px in the pane): 114 loads, all clean;
  - `scripts/roles-check-online.mjs` 37/37 across the 6 roles.
- **Handover report:** `HANDOVER_2026-11-09.md`.

## Portal Submit inquiry: fill-in form only (commit `0b61766`; live on deployment `rmc2-preview-6qn1943cf`, aliased to rmc2-test)

- PO, 2026-11-09: Division Heads and SOAs no longer see "Upload form". The page opens straight on the fill-in form, with "Filed under: <division>" below it. Franchising staff keep upload and fill-in in "Import an agent's form".
- **Checked locally** (port 5190, Division Head): no tabs or upload box, 23 fields, one "Submit inquiry" button, no sideways scroll. **Online:** the served code has the new page text and not the old.

## Final check, 2026-11-09 batch (commits `2549aca`, `fd17179`; live on deployment `rmc2-preview-ivdry14o7`, aliased to rmc2-test)

- **Code-review minors, done:**
  - **batched reindex:** the index sync works in set-based batches of 200. `scripts/test-index-batch.mjs` 4/4 shows it builds exactly the same summaries and keys as one inquiry at a time (454 inquiries, 1350 keys, 3 batches, deletes across a batch edge).
  - **activity query filtered by inquiry:** single-inquiry reads now filter in SQL.
- **Found and fixed while testing:** a late heartbeat could bring back an expired handling lock, depending on whether clean-up had just run. Now only a live lock is refreshed. `test-exclusive-handling`: its 4 API checks pass. It was also updated for the 2026-11-08 "Started handling" history entry. Its browser part still waits for an old "Browse templates" button (stale selector).
- **Inquiry numbers use the Manila year** (00:30 on 1 January Manila time gives the new year).
- **Verified TLS to Supabase: code ready, not switched on.** Set `RMC2_DATABASE_CA` to the Supabase CA certificate (Project Settings > Database > SSL), optionally with `RMC2_DATABASE_SSL=verify-full`. Then the certificate and host name are checked. Needs the PO to download the certificate and approve the env change. `scripts/test-db-connection.mjs` 8/8.
- **Cold start:** a paused free Supabase project does not wake by itself (someone restores it in the dashboard). The app now answers a plain 503 "may be paused" instead of a 500. It still retries readiness on every request (the failure is not cached). Not tried against a really paused project. Daily dry-run use keeps it from pausing.
- **Data hygiene (read-only, `scripts/storage-audit-test.mjs`):** 145 stored files on TEST, all names pass `assertKey`. 36 are referenced by no record, not even by id (attachments 11, generated 16, inbound 2, outbox 5, sources 2): leftovers from earlier test resets. Nothing deleted. The bucket is wiped at cutover.
  - **Renderer backfill:** not needed. Only packages made before the marker lack it, and they are all fictional test data wiped at cutover. New packages always carry it.
- **Security review (security-engineer, read-only)**
  - **Fixed in inbound email:**
    - a sender is verified (and auto-linked to a Division Head / SOA) only on DMARC pass aligned with the From domain. SPF + DKIM pass for another domain was enough before, so a forged From could link an inquiry to a real agent;
    - Authentication-Results is read token by token, so sender text cannot fake a result;
    - an unreadable email is listed as skipped and no longer blocks later mail; the cursor is saved even if the loop stops;
    - oldest emails are read first (a burst over 25 was dropped before);
    - emails over 15 MB are not downloaded, and at most 5 attachments are kept per email.
    - `scripts/test-inbound-auth.mjs` 5/5. "Check mail now" online: connected, 0 new.
    - Note: Gmail addresses pass DMARC, so Division Heads / SOAs emailing from Gmail still link automatically. A company domain without DMARC imports unlinked, for staff to link.
  - **Still open, from the same review:**
    - [ ] **migration 500 stamps any database `test` by default.** If production is migrated without first setting `environment=production`, the rollback scripts would pass their guard there. Must be handled in the phase 8 runbook: set the marker before 500, or change 500 before production.
    - [ ] rollback files missing for 20261105000000, 20261105000100, 20261106000000 and 20261106000100; the README run order misses 1108 and 600.
    - [ ] `rmc2_app` can overwrite `app_meta.environment` (low).
    - [ ] a UTF-8 BOM on six rollback files (may stop psql; dry-run them locally).
    - [ ] inbound: an error banner and back-off when the inbox keeps failing; a reaper for messages stuck in "importing".
    - [ ] inbound: hold auto-imports without DMARC pass for a staff click (PO call).
    - [ ] inbound: magic-byte checks on attachments, and an Excel size cap before parsing.
    - [ ] **inbound retention: there is none.** Proposal for the PO: skipped emails 30 days; unhandled 60 days; imported emails' copies deleted at 90 days, keeping a small record for duplicate checks.
- **Stress tests T1–T10 (qa-engineer, on TEST):**
  - **Passed:** T1 (7/7; once, a postgres.js socket error after an idle-in-transaction test, not reproduced), T2, T6, T7 (239 writes, 0 stale), T8 (no torn reads), T9 (11/11, audit tables append-only), `test-phase4-pg-sql` and `test-store-postgres` (41).
  - **Not valid yet:** T3, T4, T5 and T10. Reasons: runner setup; T4 assumed the old roles; T5 ignores the new per-IP limit. T4, T5 and T10 change accounts on the database the dry runs will use, so they wait for the PO, or for a throwaway database.
  - **Incident:** a script bug in the agent's T4 clean-up wrote Emerson's and Zeo's account data as a JSON string for a few minutes, so online sign-in returned 500. The agent restored both from its snapshot. Sign-in now also survives a malformed account row (`fd17179`).
  - **QA-PG test data deleted from TEST** (PO: "Yes, delete them", 2026-11-09), in one transaction that checked every count before committing:
    - 106 inquiries (`INQ-2026-00175` to `00280`, all named "QA-PG ..."), plus 316 index keys, 105 summaries, 1 pending index row, 190 notifications, 4 activity rows and 1 outbox row;
    - 34 real test inquiries left, and none of them referred to a QA-PG id;
    - online afterwards: bootstrap, workspace and the directory load for Emerson and Cryssa with no QA-PG records.
    - **Kept:** 49 security events and 50 file-access rows (audit tables are append-only), and those inquiries' stored files (the bucket is wiped at cutover).

## Settings tabs and the top-bar theme toggle (commit `da3d7ca`; live on the test version since 2026-11-09)

- **Settings** (`app/operations-settings.tsx`) is split into Profile, Security, Notifications and Email templates
  tabs. Accounts that must set a password see only Security. Username and password save separately through the
  same `account-settings` call, and both still sign out every session.
- **Theme:** the Appearance card is gone. A sun/moon toggle sits in the top bar and on the sign-in screen. With
  nothing saved, the app still follows the device setting.
- **Checked:**
  - Locally: typecheck, `theme:check` and the browser in light, dark and at 375 px.
  - **Online** (deployment `rmc2-preview-d13156rny`, aliased to rmc2-test): read-only check only. The page loads
    (200), the new Settings and toggle text is in the served bundle, the old Appearance text is not, and the API
    still refuses requests that aren't signed in (401). Nobody signed in online for this check.

## Pilot plan item 2: files over 4.5 MB (commit `071ef49`; live on the test version since 2026-11-09)

Vercel caps a function's request and response at 4.5 MB. Files over 4 MB now skip the function both ways.
- **Uploads:** `api()` in `app/operations-common.tsx` asks `POST uploads/start` for a signed upload link, sends the
  file straight to private storage, and calls the normal route with `file__upload`. `resolveUploads`
  (`lib/operations/large-files.ts`) swaps the real file back in before any existing check runs. This covers intake,
  BOR transfer, template upload and Division Head progress reports, with no screen changes.
  - Keys are built from the signed-in user, so nobody can claim another person's upload.
  - Uploads expire after an hour, are deleted once used, and are capped at 15 MB (checked again after reading).
  - Each person gets at most 20 upload links an hour, counted when issued and logged in `file_access` as
    `upload-start`, and at most 10 unfinished uploads.
  - The type comes from the extension; routes still check the bytes.
- **Downloads:** after the route's permission check and the access log, a 302 to a 60-second signed link
  (`no-store`, `no-referrer`, named for downloads). This covers the 12 private-file routes. Large email
  attachments on Requests are parked under `transfer/down` and linked.
- **Clean-up:** transfer files older than an hour are swept after workspace responses, at most every 10 minutes per
  server.
- **On this computer** nothing changes: there are no signed links, and files go through the app as before.
- **Checked:**
  - `scripts/test-large-files.mjs`: 10/10, local and simulated signed storage.
  - `test-client-protection`: 48/48 over HTTP.
  - **Online:** `scripts/large-files-check-online.mjs` 4/4.
    - A 6.1 MB form is refused the old way (HTTP 413).
    - The same form goes in through a signed link and became `INQ-2026-00161` (a fictional test inquiry). Its upload
      id can't be reused.
    - It downloads through the signed link byte for byte.
    - Small files still download directly.
  - **From the browser (as the Head):** the PUT to storage returned 200, and the PDF viewer's `fetch` follows the
    redirect (6.1 MB), so storage allows the cross-site calls both ways.
  - A security-engineer review found no critical or high issues. The medium findings are fixed: issued-link cap,
    size re-check, scheduled sweep, type not taken from the browser.
- **Bucket limit (PO decision 2026-11-09: 25 MB, not 15 MB):** `rmc2-test-files` had no limit of its own (project default 50 MB). A
  saved email can reach about 21 MB (15 MB of attachments, about a third larger once encoded), so 15 MB would have silently
  dropped those copies. `scripts/set-bucket-limit-test.mjs` set it on the TEST project only. After the change:
  - 26 MB is refused, both directly and through a signed upload link (HTTP 400);
  - 15 MB and 1 KB are accepted;
  - the bucket is still private.
  **Production needs the same setting at cutover.**
- **Known, not fixed:**
  - Two parallel requests with the same upload id could both use it (the person's own file, low risk).
  - The upload is consumed before the route's own permission and validation checks, so a refused file has to be
    chosen again.
  - Excel form previews over 4.5 MB still go through the function.
  - A real template over 4 MB hasn't been uploaded yet.

## Pilot plan item 8: dark mode (commits `4e22f2b`, `891e214`; live on the test version since 2026-11-09)

- **Choice:** Light, Dark or System (default System). It's on the login screen (icons, top right) and in
  Settings → Appearance for staff and Division Heads / SOAs. It's saved per device in localStorage; in private mode
  it holds for that visit only. System keeps following the device while the app is open.
- **No flash:** an inline script in `<head>` (`app/theme-script.ts`) sets `data-theme` before the first paint.
- **Colours:** `scripts/theme-tokenize.mjs` moved all 1,864 hardcoded colours in `app/*.css` to
  `var(--dk-<role>-<hex>,<original>)`, so light mode keeps exactly its old colours. It generates
  `app/operations-theme-dark.css`, whose dark values come from the role (text, background, line, shadow), plus a few
  hand-written fixes (`FIXES` in the script). **New CSS:** write colours as usual, then run
  `node scripts/theme-tokenize.mjs`; `npm run theme:check` fails while any raw colour is left.
  - The dark file is imported from `globals.css`, not `layout.tsx`: Tailwind replaces `var(--x,fallback)` with the
    fallback when `--x` isn't declared in its own bundle.
- **Stays light:** proposal document pages, the template preview paper, submitted-form PDFs and sheets, email
  previews. Saved-PDF pages are canvases, so they stay white while their frame follows the theme.
- **Checked:**
  - A contrast audit (every visible text element against its real background, WCAG AA 4.5:1, or 3:1 for large text)
    passed with no failures on:
    - 13 staff screens plus an inquiry, at desktop and 375 px;
    - 5 Division Head screens at 375 px;
    - 11 screens on the test version.
  - The audit was confirmed to catch a planted failure.
  - Light mode returns the original colours.
  - The loading screen is already dark on reload, so there's no flash.
  - The switch works by mouse and keyboard, and System follows a live device change.
  - The real proposal PDF (`INQ-2026-00155`) shows white in dark mode on the test version.
- **Not checked:**
  - The template-preview paper with real pages, because the converter isn't running locally. A style check confirmed
    the paper area is white with dark text in dark mode.
  - Hover and focus states, and every dialog, one by one.
  - Real phones (iPhone Safari, Android Chrome).

## Pilot plan item 6: error tracking (commit `0d9afe6`; live on the test version since 2026-11-09)

PO decision 2026-11-09: use our own logging, not an outside service (no Sentry account, no cost).

- **What it does:** uncaught errors, unhandled promise rejections and screens that fail to draw are logged
  automatically into the same `problem_reports` table. No migration was needed: an app error is a row whose id
  starts with `err-` and whose data has `kind: 'error'`. The Head and Admin see them on the **App errors** tab of
  Problem reports, with a count, first and last time, who hit it, the page, the open inquiry, the app version,
  the window, the browser and a short stack.
- **Limits:** one entry per distinct error per app version. Repeats add to its count, and an error marked Fixed
  that happens again is reopened as New. At most 20 new error entries per person a day; these do not count
  against the 30 typed reports. The browser sends at most 5 per page load, ignores browser-extension errors,
  "Script error." and ResizeObserver noise, and skips server answers that were already shown to the person.
  Stacks keep 12 frames without the site address or query strings. Form contents are never sent.
- **Blank screens:** `app/error.tsx` now shows "Something went wrong on this screen" with Try again and
  Reload page, and logs the error.
- **Checks:** `scripts/test-problem-reports.mjs` 11/11 (4 new: dedupe and count, reopen after fixed, refused
  input, the daily cap). Locally on `next start`: an uncaught error and an unhandled promise were both logged
  and shown on the tab. Online as the Head: a deliberate test error was logged with version `0d9afe6`, shown on
  the tab, and marked Fixed.
- **Not checked:** the "Something went wrong" screen was built and compiled but not triggered in a browser
  (no screen currently fails to draw). It will show the first time one does.

## Pilot plan item 5: Report a problem (live on the test version since 2026-11-08)

- **Migration `20261108000000` applied to TEST** (PO approved 2026-11-08) with the new `scripts/apply-migration-test.mjs`: one file, in a transaction, test project only. Afterwards:
  - the columns are `id`, `at`, `user_id`, `status` and `data`, with indexes `problem_reports_at` and `problem_reports_user_at`, and row level security is on;
  - `rmc2_app` also has DELETE, from the schema's default privileges, not from this file. The app never deletes reports.
- **Deployment:** `rmc2-preview-7vzybmfm2-yiizer.vercel.app` (commit `c31078e`), aliased to https://rmc2-test-yiizer.vercel.app. `npm run build` passed first.
- **Online checks:**
  - **In the browser as the Head:**
    - a report sent from `INQ-2026-00155` stored page, role, inquiry, version `c31078e` and window `964x846`;
    - it shows in Problem reports, and changing it to Fixed records who made the change.
  - **`pilot-check-online` "Problem reports" check, 1/1:**
    - a Division Head files (201);
    - the Division Head, an Employee and a Supervisor are refused the list (403), and an Employee can't change a status;
    - the Admin sees the new report, and the Head marks it fixed.
- **Not checked online:** the form on a real phone; the 30-a-day cap (checked locally only).

- **What it does:**
  - A life-buoy button sits in the top bar of every staff and Division Head / SOA screen. It opens a short form; the description is the only typed text.
  - The app adds the page, the inquiry (from `#inquiry/<id>` or `#my-clients/<id>`), the role, the app version (commit), the window size and the browser.
  - No screenshots and no form contents are sent. Each person can send up to 30 reports a day.
  - **Problem reports** (Head under Manage, Admin under Admin) lists them newest first. Tabs: New / In progress / Fixed / All. Changing a status records who and when.
- **Storage:**
  - table `problem_reports` (`lib/operations/database.ts` for local SQLite; `supabase/migrations/20261108000000_problem_reports.sql` for Postgres; a guarded rollback in `supabase/rollbacks/`);
  - code in `lib/operations/problem-reports.ts` and `app/operations-report-problem.tsx`.
- **API:**
  - `POST problem-reports`: everyone signed in, owners included (added to the owner whitelist);
  - `GET problem-reports` and `POST problem-reports/<id>/status`: Head and Admin only.
- **Verified locally:**
  - `tsc` passes; the new files are lint-clean, and the changed files have the same lint errors as HEAD;
  - `test-problem-reports` 7/7 (new);
  - `db-schema-parity --static` OK (the older `inquiries_owner` index is now listed as an expected Postgres-only index);
  - the other harness tests pass; `test-roles-scoping` fails only at its known line 198.
  - **Browser on port 5197** (a fresh QA data dir, `next start`):
    - an Employee sends from an open inquiry and sees the confirmation;
    - an Employee has no menu item and gets 403 on the list;
    - the Head sees the report with its inquiry link, changes it to In progress, and the tabs update;
    - a Division Head can send (201) but not read the list (403);
    - 375px has no horizontal scroll.
  - Found and fixed during the check:
    - the form was hidden under the sidebar (it is now rendered on `<body>`);
    - the inquiry was not captured (it is now read from the address).
- **Next:**
  - [x] Migration applied to TEST, deployed and smoke checked (see above).
  - [ ] Item 6: error tracking.

## Pilot plan for 2026-11-16, day 1 (commit `747c4eb`; live on the test version)

The plan is `PLAN_2026-11-16_PROMPT.md`, and the decision is in `TEAM_DECISIONS.md`: §0 and §2 now run this week, with a feature freeze at the end of 2026-11-12. `phase-4-postgres` was pushed to origin as a backup and not merged.
- **What changed:**
  - **Show/hide password** on all 10 password fields: login, Account settings, Users & roles, and My team. `PasswordInput` lives in `operations-common.tsx`.
  - **The login badge follows where mail goes:**
    - "LOCAL TEST ENVIRONMENT" locally;
    - "TEST VERSION" online while mail is redirected;
    - no badge once `RMC2_MAIL_ENV=production`.
    - `app/page.tsx` reads this at build time.
  - **Reply-To warning:**
    - An emailed inquiry whose Reply-To differs from From stores `source.replyToFrom`.
    - The email To line then shows "Reply-To differs from From…".
    - Older records and Division Head / SOA submissions show nothing.
- **Deployment:** `rmc2-preview-c23vmlydn-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `npm run build` passed first. No migration was needed.
- **Online read-only check:** the page carries `environment: test`; signed-out `session` and `workspace` return 401. No sign-in smoke check was run.
- **Verified locally:**
  - `tsc` passes; lint errors in the changed files are the same as HEAD;
  - `test-reply-to-warning` 4/4 (new) and `test-reply-recipient` 7/7.
  - Browser checks on port 5196 with QA data:
    - the toggle by mouse and keyboard (Space), with `aria-label` and `aria-pressed` switching;
    - autocomplete hints unchanged;
    - sign-in works with the password shown;
    - the badge reads "LOCAL TEST ENVIRONMENT";
    - at 375px the toggle sits inside the field, with no horizontal scroll.
- **Not checked:**
  - the Reply-To warning on screen (needs an inquiry with a chosen template; part of the §0 click-through);
  - the toggle on the owner app's My team dialogs in a browser;
  - the online login screen in a browser.
- QA data note: `INQ-QA-0019` in `test-results/feedback-1108/qa-data` was edited by hand (sender and `replyToFrom`) for this check.

## Monitoring round 2026-11-08c (commit `784db4e`, not pushed; live on the test version)

Decisions are in `TEAM_DECISIONS.md` (Monitoring feedback round 2026-11-08c).
- **What changed:**
  - "Still new" becomes "Not yet sent", the open backlog as of now (a past period: at its end); API field `notStarted` → `notSent`
  - no empty-page takeover: every card shows zeros with its own hint
  - Time per employee redesigned
  - elevation tokens and a polish pass
- **Deployment:** `rmc2-preview-g5ya0iqra-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `npm run build` passed first. No migration was needed.
- **Online read-only smoke check: 12/12 passed** (`vercel curl`, sign-ins and GETs only). It covered:
  - `notSent` (and no `notStarted`) in the totals and buckets for all four ranges
  - the KPI equals the last started bucket
  - future buckets are 0, and a past month is counted at its end
  - Supervisor 200, Employee 403, a future period 400
  - the drill-down, and the old `?period=` form
- **Checked locally only:**
  - zero-data Today and Weekly
  - every range at 1366×768 with no page scroll, and 375px
  - the drill-down by mouse and keyboard
  - the PDF text label
- **Not checked:**
  - a click-through on the online version
  - the PDF layout visually
  - a real phone

## Monitoring round 2026-11-08b (commit `09d57e5`, not pushed; live on the test version)

Decisions are in `TEAM_DECISIONS.md` (Monitoring feedback round 2026-11-08b).
- **What changed:**
  - calendar ranges Today / Weekly / Monthly / Yearly
  - past periods via `?range=&period=`, with a 5-year lookback
  - token-only colours (navy / orange)
  - "Still new"
  - PDF export
  - the Time per employee drill-down
- **Deployment:** `rmc2-preview-bphhw0y79-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `next build` passed first. No migration was needed.
- **Online read-only smoke check: 16/16 passed** (`vercel curl`, sign-ins and GETs only). It covered:
  - all four ranges and a past week
  - future, old-range and too-old periods rejected with 400
  - the drill-down for the Head and a Supervisor
  - 403 for an Employee and 404 for an unknown user
  - the old `?period=` form unchanged
- **Checked locally only:**
  - the browser click-through: stepping, reload, Jump to, the drill-down by mouse and keyboard
  - a PDF for a past period
- **Not checked:**
  - the multi-page PDF (more employees than fit on page 1)
  - a click-through on the online version
  - a real phone

## Feedback round 2026-11-08: `FEEDBACK_2026-11-08_PLAN.md` (commit `61ba764`, pushed; live on the test version)

**Live on the test version since 2026-11-08** (PO asked):
- Deployment: `rmc2-preview-3e8dhwcqf-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `next build` passed first. No migration was needed.
- **Online read-only smoke check: 12/12 passed** (`vercel curl`, sign-ins and GETs only):
  - Head: Monitoring for all 4 ranges (30d: 14 received, 5 sent, 2 declined, 2 not started, sent rate 36%, 3 employees timed);
  - Supervisor: 200;
  - Employee: 403;
  - an unknown range: 400;
  - the old `period` form: unchanged;
  - signed out: 401.
- **Not done online:**
  - no browser click-through;
  - the staff reminder sweep has not been triggered on purpose, to avoid sending pushes. It runs on its own the first time staff open the app (the poll, once per 10 minutes).

**Monitoring redesign, no page scroll (2026-11-08): commit `0e7898d`, live on the test version.**
- **Deployment:** `rmc2-preview-ofaj7x76r-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `next build` passed first.
- **Online read-only smoke check: 12/12** (the same checks as above).
- **Not checked online:** no browser click-through of the new layout on the test version.
- **What changed:** only `app/operations-proposal-dashboard.tsx` and `.css`. No API, type or library change. Details are in `TEAM_DECISIONS.md` (2026-11-08 round).
- **Verified locally:**
  - `tsc` passes, and the file has 0 lint errors.
  - `test-proposal-stats` 12/12; `test-protection-reminders-employees` 6/6; `test-no-ai-text-browser` 54 screens.
  - On port 5196: no page scroll and no clipped card for 7d / 30d / 90d / 12m, in both Charts and Numbers, at 1440×900 and 1366×768.
  - 375px: no horizontal scroll.
  - A stored "both" opens Charts; Numbers survives a reload; Export downloads the CSV.
  - With 7 employees: "View all (7)" and the dialog work, and Escape closes it.
- Screenshots: `test-results/feedback-1108/redesign-*.png`.
- **Not checked:**
  - windows shorter than 620px (the page scrolls normally there, by design);
  - real data with more than 3 employees (only injected rows were tried).

**Built:**
1. **Staff expiry reminders.**
   - Who gets them: the employees who handled the client (`handledBy` + the preparer of the sent version) and every active Head and Supervisor, at 7 and 2 days left.
   - Wording: "{Client}: protection ends in {n} days ({date}). Ask the agent for a progress report or the client will be released."
   - Same rule and dedupe as the owner reminders (`reminderDue` in `owner-view.ts`). The notice id is a hash of client + expiry + threshold, inserted with `ON CONFLICT DO NOTHING`. No migration.
   - Triggers:
     - the staff 30-second `workspace` poll, at most once per 10-minute slot (`settings` key `protection-reminder-slot:<n>`), run in `after()`;
     - the daily `/inbound/cron`.
   - Division Heads / SOAs keep their own reminder, unchanged, and never get a staff notice.
2. **Monitoring** (renamed from "Proposal dashboard").
   - `GET monitoring/proposals?range=7d|30d|90d|12m` adds `summary`: current and previous totals, sends per weekday, and the sent rate. `received` was also added per bucket. The old `period` form is unchanged.
   - New layout:
     - header with the range control, Export (CSV) and Refresh;
     - 4 KPI cards with delta pills;
     - Proposals over time next to Busiest day;
     - Pipeline next to the Sent rate gauge;
     - Time per employee.
   - The Charts / Numbers / Both toggle is kept.

**Verified locally:**
- `tsc` passes. 0 lint errors in the changed files (the same as HEAD).
- New tests:
  - `test-protection-reminders-employees` 6/6;
  - `test-proposal-stats` 12/12 (5 new range cases with hand-computed tables).
- `test-roles-scoping` fails only at the accepted line 198. A throwaway copy with only that line changed passes 30/30, including section 7 (owner reminders).
- Feedback-round scripts all pass: enrolled 7, shared-mobile 5, division-team 9, inquiry-fields 6, reply-recipient 7, email-templates 5.
- `test-no-ai-text-browser` passes: 54 screens.
- Dev server checks (port 5196, `test-results/feedback-1108/qa-data`, with 121 extra sample inquiries):
  - desktop and 375px, with no horizontal scroll;
  - the toggle survives a reload;
  - the Export CSV contents were checked;
  - Retry recovers from an error;
  - the Employee gets 403 and has no nav item;
  - the live poll created the staff reminders, and cryssa saw them in Notifications.
- Screenshots are in `test-results/feedback-1108/`.

**Open:**
- [ ] Staff reminders not yet seen firing on Postgres/TEST: check the Notifications of a handler once staff have used the app.
- [ ] Vercel cron jobs run on **production only**. On the preview test version, reminders come only from the staff poll (someone on staff has the app open).
- [ ] Days left is rounded up (`protectionDaysLeft`). Two clients ending on the same calendar date can read "6 days" and "7 days", depending on the hour.


**Live on the test version since 2026-11-08** (PO asked):
- Deployment: `rmc2-preview-m5rx9sxbu-yiizer.vercel.app`, aliased to https://rmc2-test-yiizer.vercel.app. `next build` passed first. No migration was needed.
- **Online read-only smoke check: 15/15 passed** (`vercel curl` against the TEST database):
  - all role sign-ins;
  - the dashboard on Postgres (12 months, funnel 14/9/7/5/5, 3 employees timed);
  - the Employee getting 403 on the dashboard;
  - email templates;
  - the Division Head's My team, with the SOA and Head-route 403s;
  - the directory (99 Enrolled);
  - the inquiry list after the summary rebuild.
- **Not done online:**
  - no click-through in a browser;
  - no decline email or staging-redirect send;
  - no fill-in-details inquiry created.

**Built:** all 10 items.
1. "Won" is now "Enrolled".
2. Shared-mobile flag.
3. Proposal dashboard for Head and Supervisors (charts, numbers, step chart).
4. Timing per employee.
5. Division Head manages SOAs in their own division.
6. Owner My Clients rebuilt on the employee dashboard parts.
7. "Fill in details" inquiry entry.
8. AI hidden.
9. Outcome emails go to the original sender, and decline now emails the agent.
10. My email templates.

**Verified locally:**
- `tsc` passes. No changed file gained a lint error compared with HEAD.
- New tests pass:
  - `test-feedback-enrolled` (7)
  - `test-feedback-shared-mobile` (5)
  - `test-proposal-stats` (7)
  - `test-division-team` (9)
  - `test-inquiry-fields` (6)
  - `test-reply-recipient` (7)
  - `test-email-templates` (5)
  - `test-no-ai-text-browser`: 53 screens across all 6 roles.
- HTTP route permissions were checked on a local dev server (port 5195, data in `test-results/feedback-1107/qa-data`).
- Browser checks at desktop and 375px:
  - the dashboard and its view toggle surviving a reload;
  - fill-in entry and the shared-mobile flag;
  - decline email to the original sender (local mailbox);
  - templates and Save as my template;
  - My team;
  - My Clients;
  - the Enrolled and Archived tabs.
- Code review and security review were run, and their findings fixed.

**Open:**
- [ ] **PO decision:** `scripts/test-roles-scoping.mjs:198` still expects the owner status "Proposal sent". It is now "Enrolled" (PO decision Q1). With only that expectation changed, the script passes 30/30.
  - `test-phase2-ui-browser.mjs` and `revamp-navigation.mjs` need the same kind of text update: the "My team" nav item, "Proposal dashboard", and the "Enrolled" tab.
- [ ] Not run on Postgres or TEST at all.
  - The `PROJECTION_VERSION` bump (1→2, so existing rows get `sharedMobile`) re-queues every inquiry for the summary index on the first start after deploy.
  - The new "Started handling" write takes the row lock, then the lease. That matches saveDraft and take-over, but it is not load-tested (`test-pg-concurrency`).
- [ ] The decline email has not been sent through real SMTP, dry run or staging redirect. Only local mail mode was tested.
- [ ] **Known low risk:** for emailed forms, the reply address comes from Reply-To/From as before. An unverified Reply-To could make the decline, details and proposal emails go to that address. Consider showing "Reply-To differs from From" on the To line.
- [ ] The manual-entry reply address is fixed at intake. Fixing a typo in the agent email later does not change where emails go.
- [ ] `app/franchise-workspace.tsx` (the old prototype with AI wording) is unreachable. Delete it with the PO's OK.
- [ ] Update `PHASE2_UI_SPEC.md`: the owner status "Proposal sent" is now "Enrolled".
- [ ] Older scripts that fail identically on HEAD, so they are not caused by this round: `test-directory-model` (stale fixture DBs), `test-workspace-advisors`, `test-mail-service` (confirmSent by Head), `test-config` (8 seeded users).

## Demo feedback round (2026-11-05): `DEMO_FEEDBACK_PLAN.md`

**Phase 1 is done and live on the test version** (commit `42cae43`, not pushed):
- **Email pull-in:** every 30 seconds.
- **Dates:** "Nov 5, 2026, 2:14 PM" everywhere.
- **Locking v2:** handover requests and take-over. Migration `20261105000000` is applied to the TEST project only.
- **Customize:** fixed the tab-stop bug.
- **Converter:** font aliases.
- **Templates:** 13 new versions published online.
  - D094 and D096 were published as fixed copies, with the header signature moved into the letter body (`scripts/fix-header-signature.mjs`).
  - The client's own files still have the signature in the header: tell the client.

**Not done or not verified in phase 1:**
- [ ] **When moving to production (phase 8):** publish the 13 new templates again on the production project.
  - Use `scripts/stage-new-templates.mjs` (then `PUBLISH=<stage ids>`), with the fixed D094/D096 copies from `scripts/fix-header-signature.mjs`.
  - Alternatively, replace the bundled `resources/private` files and the catalog hashes.
  - The PC copy (port 5173) does not need updating: the deployed version is the one in use (PO, 2026-11-06).
- [ ] Page-by-page comparison of localhost vs online PDFs for the new templates. Only the online previews were checked visually.
- [ ] `scripts/test-exclusive-handling.mjs` fails at the viewer's template step ("Browse templates"). Not yet checked against `main` to see whether this was already failing.
- [ ] The pdf.js `standardFontDataUrl` safety net was skipped: the demo PDFs embed all their fonts.
- [ ] Inbound check: the follow-up refresh comes about 6 seconds after a slot is won, and a slow IMAP import may show only on the next 10-second poll.

**Phase 2 (done, commit `f963db5`, live on test 2026-11-06):**
- **Server side done:**
  - Roles, `lib/operations/permissions.ts`, linking inquiries to owners, the Division Head / SOA whitelist (`scope-guard.ts`), `my-clients` endpoints and progress-report approval.
  - Security review fixes:
    - auto-link only on DMARC or SPF+DKIM pass from `mx.google.com`;
    - only an approver can change an owner once the client is linked or protected;
    - a pending report holds protection for 7 days at most, and refiling stops after 2 rejections;
    - Admin can reset Employees only;
    - at least one active Head must remain;
    - Division Heads / SOAs can submit 20 inquiries a day;
    - no existence oracle.
  - Tests: `scripts/test-roles-scoping.mjs` passes 29/29.
- **Screens:** built against `PHASE2_UI_SPEC.md`; `scripts/test-phase2-ui-browser.mjs` passes. The online smoke test on 2026-11-06 passed 27/27.
- [x] Ran `scripts/seed-division-accounts.mjs` on the test project (2026-11-06): Emerson is Head, and the Division Head (`divisionhead@rmc2.local`) and SOA accounts exist. Fixed its jsonb bug (`a18633a`).
- [x] Phone notifications (2.6), live on test 2026-11-06 (commit `a4fbe18`):
  - VAPID keys are in the Vercel preview env, and the push table is applied to TEST. See `PHONE_NOTIFICATIONS.md`.
  - Verified locally in Edge: turn on, test push accepted by the push service, a handover request pushes automatically.
  - Not yet verified on a real iPhone.
  - The test version needs a Vercel share link for testers' phones.
- [x] Done from the security review (2026-11-06, `7f183e7`):
  - 20 progress reports a day per owner;
  - an `ownerId` index (migration `20261106000100`, applied to TEST);
  - the Head re-enters their password for role and deactivation changes;
  - temporary-password sessions cannot read Requests;
  - an owner picker on manual import.
- [x] **Rule (a), PO decision 2026-11-06 (`4dbcce6`):** once a supervisor approves a new agent after expiry, older held requests stay on hold when rechecked.

**Phase 3 (done, commit `f963db5`, live on test 2026-11-06):**
- **Division table:**
  - `lib/operations/divisions.ts` classifies branch text with today's table.
  - Editable by the Head through `GET/POST divisions`. It is stored in the new `settings` table (migration `20261105000100`, applied to TEST).
- **Directory:**
  - Division and Category filters with counts. The default sort is latest activity.
  - The "Division · Branch" column shows the original text when it differs or is unclear.
- **Local register tally:** 3,002 of 3,577 records get a division. 575 are Unassigned: 300 blank, plus the places, the team label and the mixed records that are on the client question list.
- **Importer fix:** it now keeps the client in A1 on two SOA/MOA sheets, giving 3,579 records. The scratch copy is in `test-results/importer-check/data`. The local `.data` register has not been re-imported; that needs the PO's OK.
- [x] Loaded online on 2026-11-06: 3,579 rows (`load-historical-to-postgres.mjs --source test-results/importer-check/data/rmc2.sqlite --apply`). The PO accepted the real-data risk.
- [x] Head's **Divisions & Branches** screen (2026-11-06): edit branches and spellings, move a branch, add or remove one. Division names stay Division 1 to 7. Checked in the browser: Head only, a saved spelling re-sorts the directory, phone width works.
- [ ] Waiting on the client: unmapped branches, Division 6, the team label, and whether a newer workbook exists.

## Where things stand

- **Branch:** `phase-4-postgres` (pushed, **not merged**). `main` has phases 0–3 (PRs #5, #6, #7).
- **Online test version:** https://rmc2-test-yiizer.vercel.app
  - Hosting: Vercel project `rmc2-preview` on Hobby, deployed from this PC with `vercel deploy --target=preview`, then re-aliased.
  - Data: Supabase TEST project (ref `pgoiqwixaeqbxlwbmren`), Postgres schema `rmc2` and private bucket `rmc2-test-files` under `preview/`.
  - Data state: made-up only (6 demo accounts and the 14 real proposal templates, which are bundled privately).
  - Behind Vercel Authentication (only the `yiizer` account can open it).
- **Online PDF converter:** Vercel container project `rmc2-converter` (`converter/`), running LibreOffice 26.8.1.
- **Email:**
  - Sending is real but in staging mode: every email is redirected to `yiizer17@gmail.com`, with caps of 5 per hour and 20 per day.
  - Pulling reads the same inbox read-only. Excel forms are imported automatically; everything else goes to the Requests page.
- **Working online, verified end to end:**
  - importing a form, plus automatic import from email
  - client duplicate checks
  - online PDF generation
  - submit and approve
  - the real email being Sent
- **Weekly Claude usage was about 86% on 2026-10-31.** The reset is on Nov 5. The full reviews below were deferred to save usage.

## 0. Built but never tested (try these first)

**Second online check, 2026-11-09 (`scripts/section0-more-online.mjs`): 6/6 passed through the API on the TEST version, plus browser checks.**
- Fictional data only. No email was sent.
- **Passed:**
  - **BOR transfer:** an Employee (Jefferson) asked for the agent change on a held request (`INQ-2026-00168`). It waited for approval, Zeo approved it, `INQ-2026-00167` became Transferred and the new request was clear. The inquiry page shows "Client assigned by verified BOR".
  - **Template admin:** a copy of D054 was uploaded as a new template, the preview PDF came back (17 pages), an Employee was refused publishing (403), the Head published it, Employees saw it, then it was retired again. It stays in the list as a retired "Online Check Plan".
  - **Accounts:** the Head created an Employee. On the temporary password the account sees only an empty shell (no inquiries, no templates; the directory is 403). It set its own password, the temporary one stopped working, and once the Head deactivated it, sign-in failed (401).
  - **Notifications:** list, then mark all read.
  - **Two people at once:** two agents sent the same new client at the same moment. Both got their own reference and exactly one was held. Two staff pressed Start handling together: one got it, the other was told who is handling it (423).
- **In the browser online (signed in as the Head):**
  - **Requests:** both tabs, "Check mail now" ("No new email"), a newsletter skipped automatically, and a form imported automatically.
  - **Automatic import of an emailed Excel form** had already happened: the email of 2026-11-06 became `INQ-2026-00154`.
  - **Phone (375px) and tablet (768px):** 17 pages at 375px and 15 at 768px, with no page scroll and no error alert. Wide parts (status tab strips, tables) scroll inside their own box.
- **Real local data (`.data`):** backed up to `D:Codescoverdesk-data-backup-20261109` (outside the repo) first. Started once with `next start` on port 5173; mail stays on this computer. Sign-in, bootstrap (12 inquiries), workspace, directory, Monitoring, divisions, email templates, Requests and opening an inquiry all work. The upgrade wrote to `rmc2.sqlite-wal`.
- **Issues found:**
  - [x] **F6, fixed:** the footer said "Saved on the local server" on the online version. It now says "Saved online" there and "Saved on this computer" locally. Live on deployment `rmc2-preview-izpy57yut` (aliased to rmc2-test), checked in the browser after a reload.
  - [x] **F7, fixed 2026-11-09 (PO: "Yes, make him Head"):** in the real local data, Emerson was still a **Supervisor** and there was no Head account, so nobody there could manage accounts, divisions, templates or problem reports. His account is now `role: Head, canApprove: true`, the same change `scripts/seed-division-accounts.mjs` made online. Nothing else changed. The database files from just before the edit are in `D:Codescoverdesk-data-backup-20261109-before-head`. Checked on `next start` port 5173: he signs in as Head, and Problem reports (403 before), Divisions, email templates, template history, Monitoring and Requests all return 200.
- **Left on the TEST database:** `INQ-2026-00162` to `00168` (fictional, wiped at cutover). Three deactivated accounts `check.11081953`, `check.11081955` and `check.11081957`: accounts are **kept** at cutover, so delete them with the demo accounts (item 4).

**Online check, 2026-11-08 (`scripts/pilot-check-online.mjs`): 9/9 passed through the API on the TEST version.**
- Fictional data only, with 3 emails sent to the test inbox.
- The checks fell over twice along the way, and both times the cause was the script, not the app:
  - every form had the same client contact, so the app correctly held them as duplicates;
  - the script called the wrong routes.
- **Passed:**
  - **return and resubmit:** `INQ-2026-00155` was prepared with D054, submitted, returned by Zeo, corrected, and v2 resubmitted;
  - **approve and send:** the Head approved v2, the status became Sent, and the 30-day protection started;
  - **request missing details:** `INQ-2026-00159` became Waiting for agent details, and the email was sent;
  - **decline with email:** `INQ-2026-00160`, with the decline email sent through staging SMTP to the redirect;
  - **duplicate hold:** a second agent for the same client (`INQ-2026-00158`) is held, and a recheck keeps the hold;
  - **progress report:** the Division Head filed one with a PDF attachment, which was stored, and the Head approved it. A second report while one is pending is refused (409).
  - **pages load:** bootstrap/users, workspace, Monitoring (Head 200, Employee 403), directory, divisions and email templates;
  - **Requests:** the list loads, and "Check mail now" connects (0 new);
  - **downloads:** the sent PDF (471 KB) and the .eml (646 KB).
- **In a browser online:**
  - the login shows "TEST VERSION" and the password toggle;
  - at 375px there is no horizontal scroll and the toggle sits inside the field.
- **Browser click-through, signed in as the Head (the PO signed in in the pane):**
  - All 17 pages load with no error alert and no horizontal scroll at 964px: Dashboard, the Inquiries tabs, Requests, the Approval Queue and its tabs, Client Directory, Closed, Monitoring, Users & roles, Divisions & Branches, Proposal templates, Notifications, Settings and Integrations.
  - At 375px, 12 key pages have no page scroll.
  - **Duplicate decision:** "Confirm different clients" on `INQ-2026-00156`, with a reason and the checkbox. It shows "Client check cleared", the hold lifts, and Start handling is enabled.
  - **The sent proposal (`INQ-2026-00155`)** at 1366×768 and at 375px: the status card, the PDF loads (200) and Download email is shown.
- **Issues found (triage):**
  - [x] **F1, fixed in commit `a16824e`: reloading dropped the open inquiry.**
    - Opening an inquiry now writes `#inquiry/<id>`. A reload, a pasted link, or a link opened while signed out (after sign-in) reopens it.
    - An unknown id shows "Inquiry not found" and keeps the current page. "Open existing inquiry" on the duplicate card links there too.
    - **Checked locally on port 5197** (a fresh QA data dir with `next start`): open, reload, a hash link while signed in, an unknown id, the sidebar, and a link while signed out.
    - **Checked online** on `rmc2-preview-i345ttcjq-yiizer.vercel.app` (aliased to rmc2-test): `#inquiry/INQ-2026-00155` opens and survives a reload.
    - **Not checked:** a supervisor opening an Awaiting-approval inquiry from a link. There was no such record, and the routing rule is unchanged.
  - [x] **F2, fixed in `b989a19`:** the dropdowns now wrap two to a row on phones (checked locally at 375px). Before: Client Directory at 375px squeezes two filter dropdowns to bare arrows.
  - [x] **F3, fixed in `b989a19`:** the card now stacks by its own width (a container query). Checked online at 964px: one column, headline at full width. Before: at about 960px wide (a tablet, or a narrow window), the "Sent" status card on the review step wraps into a tall narrow column. It is fine at 1366px.
  - [x] **F4, fixed in `b989a19`:** `GET session` returns only `scoped`. Checked locally (staff 200 with no `my-clients` call; the Division Head still gets My Clients) and online (staff load: `session` 200, no 404). Before: every page load requests `GET my-clients` first (the owner check). Staff get a 404, which shows as a console error. Harmless, but it clutters error tracking (item 6).
  - [x] **F5, PO decided "Require company name" (2026-11-08).** A hold now needs the same company or the same file. A shared contact name alone no longer holds.
    - Checks: `test-duplicate-company-rule` 4/4 (new), and `test-client-protection` 48/48 on a QA `next start` server on port 5190.
    - Three test steps assumed the old rule and were updated: the name-only hold, the false-match clearance (now on a same-company record), and the PDF save step.
    - A stale step where an Employee changed the owner of a protected client now uses the Head, as the owner rule from `f963db5` requires.
    - Other harness tests pass. `test-roles-scoping` fails only at its known line 198.
    - **Online** (`rmc2-preview-iz4ayxpra-yiizer.vercel.app`, aliased to rmc2-test):
      - `INQ-2026-00158` (same company) is still held.
      - `INQ-2026-00157` (contact name only) stayed held until a Recheck. After the Recheck it is clear, with 0 matches.
    - By design, old holds lift only on Recheck or a supervisor decision (`client-rules.ts:102`). Records held before 2026-11-08 under the name-only rule need one Recheck.
  - Test records `INQ-2026-00155` to `00160` stay on the TEST database. They are wiped at cutover.
- **Not run yet:**
  - BOR / agent transfer;
  - template upload/publish;
  - the auto-import of an emailed form (someone has to email the sample form to the test inbox);
  - the send-failure, cap and inbox-down cases;
  - ~~files over 4.5 MB (phase 5)~~ done 2026-11-09, see "Pilot plan item 2" at the top;
  - concurrent users and a cold start.

**Online app in a real browser.** Online, everything so far was driven through the API only.
- [x] The Requests page: layout, "Check mail now", "Imported automatically" (2026-11-09). The error notes were not seen: no failing email arrived.
- [x] **Automatic import of an emailed Excel form, end to end** (`INQ-2026-00154`, 2026-11-06). Use the sample form in `test-results/Franchise-Form-Mabini-Integrated-School.xlsx`.
- [ ] An emailed PDF goes to Requests, then **Create inquiry** by hand.
- [x] Phone and tablet layout of the online version (2026-11-09, 375px and 768px).

**Online workflow steps never run.** Only import → PDF → submit → approve → send has been verified.
- [x] Supervisor returns a proposal, then the employee corrects and resubmits (2026-11-08, API).
- [x] Request missing details (sends an email) (2026-11-08, API).
- [x] Decline, a duplicate-client hold, and the supervisor's decision on the duplicate (2026-11-08, API and browser).
- [x] Progress reports with attachments (2026-11-08) and BOR / agent transfer (2026-11-09). The expired-registration transfer was not run online: it needs a registration that has really expired.
- [x] Template admin online: upload, preview, publish, retire (2026-11-09). (Large template uploads now go through signed links, so they're no longer capped at 4.5 MB; not yet tried with a real template over 4 MB.)
- [x] Users & roles, account settings and password change, notifications, and the monitoring page (2026-11-09).
- [x] Downloads over about 4.5 MB: a 302 to a 60-second signed link (2026-11-09, `scripts/large-files-check-online.mjs`).
- [x] Uploads over 4.5 MB: through a signed upload link (2026-11-09, same script, and from the browser).

**Email edge cases, with real Gmail.**
- [ ] A send failure and an "uncertain" send, with the admin confirming or retrying.
- [ ] Hitting the 5/hour or 20/day cap.
- [ ] An email with several attachments, a very large attachment, or a non-form Excel file.
- [ ] A duplicate client arriving by email.
- [ ] Inbox unreachable, or the app password revoked.

**Data and environment.**
- [x] **The real data (`.data`, port 5173) has run the new code once (2026-11-09; see F7).** Back up `.data` first, then start the local app once and check it.
- [x] The historical client directory is loaded online (2026-11-06) and the directory filters were checked there.
- [~] Two or more people using the online version at the same time: two same-moment races pass (2026-11-09). The full stress tests T1–T10 are in §2. The stress tests were stopped part-way.
- [ ] A cold start after the free Supabase project pauses (it pauses after 7 idle days).

## 1. Must do before sharing the online link with anyone else

- [x] **Rotate the demo passwords.** Done on the test project 2026-11-02: the shared password no longer works for any of the 6 accounts.
  - [x] Script `scripts/rotate-demo-passwords.mjs` sets a random password per account, signs everyone out, and writes them to the git-ignored `test-results/online-credentials/CREDENTIALS.txt` (2026-11-02).
  - [x] Ran on the test project (2026-11-02): 6 accounts rotated, all sessions cleared, verified the old password fails and the new ones match. Rerun the same command to rotate again: `node --env-file=.env.supabase.test scripts/rotate-demo-passwords.mjs --project-ref pgoiqwixaeqbxlwbmren`.
  - [x] `VERCEL_ENV=production` guard: production never seeds demo data, whatever `RMC2_SEED_DEMO` says.
  - [x] A fresh online (Vercel) seed now gets random, unknown passwords, never the shared local one.
  - [x] Password removed from `README.md`, `LOCALHOST.md` and `PROJECT_GUIDE.md` (the local tests still use it locally).
- [ ] Then create a Vercel Shareable Link (Deployment Protection) for testers' phones, and revoke it after testing.
- [x] Tidy the layouts so they match (2026-11-09, PO: "every page", with the staff Dashboard as the standard). `app/operations-page-standard.css` sets the heading, cards, tables and status tabs for every page, staff app and Division Head / SOA portal. "Account" is now "Inquiry" in the inquiry lists and on My Clients. Column choices (Received or Updated) stay each person's own.
  - Also fixed: the portal's upload box made Submit inquiry scroll sideways (a hidden file input was full width).
  - **Checked locally** (port 5196): 13 staff pages and 5 portal pages all measure the Dashboard values (title 28px/750, subtitle 14px, card corners 12px with no shadow, table headers 11px with 18px 20px padding, rows 14px with 22px 20px), no sideways scroll at 1024px or 375px, and dark mode uses the dark tokens. **Not seen with rows:** My Clients' table, as the local Division Head has no clients. Screenshots were not possible because the app window was hidden. **Online** (deployment `rmc2-preview-6hj5rvybl`, aliased to rmc2-test): Dashboard, Inquiries, Approval Queue, Closed, Monitoring and Problem reports read the same values, the first column is "Inquiry", and nothing scrolls sideways.

## 2. Final check before any real client data or real staff use. Never skip this.

The full specialist reviews were deferred. Run all of them together over everything.

- [ ] **QA, full regression.** Compare against a `main` baseline, using the phase 2 and 3 method.
  - Run the Postgres stress tests T1–T10 from `test-results/phase4-design.md`. The QA run was stopped part-way; its scripts `scripts/test-pg-*.mjs` and `scripts/db-parity/` are committed but unverified.
  - Online checks: PDFs over 4.5 MB through the storage links, real email send, automatic email import, a PDF waiting on Requests, and an unreadable form.
- [ ] **Code review majors** (not yet fixed in code):
  - [x] **M1, lost index enqueue.** `supabase/migrations/20261101000400_index_and_bump_fixes.sql` **applied to TEST on 2026-11-09** (PO: "Yes, apply both"), through `scripts/apply-migration-test.mjs` in one transaction. Both trigger functions read back with the new code.
  - [x] **M2, deadlocks at commit.** 40001/40P01 raised at COMMIT are now retried (2026-11-02, unit + live checks pass). The bump-order fix in migration 400 is applied on TEST since 2026-11-09 (see M1).
- [ ] **Code review minors:**
  - [x] lock order (2026-11-02): decline, client review and request-details now take `lease:` before the duplicate lookup's `idx-sync`. A lease known only after matching (the previous registration) still comes later; that rare deadlock is detected and retried (40P01). Typecheck only, not run end to end.
  - [x] try/catch around the poll's activity prune (2026-11-02)
  - batched reindex
  - activity query filtered by inquiry
  - [x] `updateOwnAccount` re-reads the user and refuses a deactivated account (2026-11-02; typecheck only, not run end to end)
  - [x] `requestDetails` takes the client (`ck:`) and `lease:` locks first (2026-11-02; typecheck only)
  - [x] strip NUL characters on every write: the Postgres store drops NULs and `\u0000` escapes from every string parameter (2026-11-02; unit + live check on a temp table)
  - [x] log-safe `mapPgError`: any other server error becomes a detail-free 500, logs carry the code only (2026-11-02)
- [ ] **Security:**
  - [x] Apply `supabase/migrations/20261101000500_security_hardening.sql`: append-only audit tables, a role connection limit, an environment marker, and stricter self-checks. **Applied to TEST on 2026-11-09**, after re-checking that the app still never updates or deletes rows in the audit tables, and that every newer table uses the standard `app_all` policy that the self-check expects.
    - Its own self-checks passed. Read back afterwards: `rmc2_app` connection limit 60 (was none); the five audit tables have `app_insert, app_select` only and the app can no longer update, delete or truncate them; `app_meta.environment` = `test`.
    - After both migrations, online: `section0-more-online.mjs` 6/6 (BOR, template publish, account create and deactivate, notifications, two same-moment races) and `large-files-check-online.mjs` 4/4.
    - Rollbacks exist in `supabase/rollbacks/` and were not needed.
    - **Production:** both files still have to be applied there as part of the phase 8 setup.
  - [ ] Verified TLS to Supabase using the Supabase CA (it is currently `ssl:'require'`, which encrypts but does not verify the certificate).
  - [x] Login limits (commit `8ea0c07`, 2026-11-09; live on deployment `rmc2-preview-pog0dqggk`, aliased to rmc2-test):
    - [x] counted on the account id, so a username and its email share one count of 8 per 15 minutes (unknown names count on the typed text);
    - [x] per IP: 60 attempts per 15 minutes (a whole office may share one address), not reset by a correct password. The address is the first `x-forwarded-for` entry, which Vercel sets;
    - [x] site-wide: more than 300 wrong passwords in 15 minutes pauses all sign-ins for 15 minutes. Trade-off: a spread-out attack can make everyone wait;
    - [x] finished `auth_attempts` rows are pruned (on about 1 sign-in in 20);
    - [x] password hashing and checks use async scrypt; old hashes still verify;
    - [ ] a Vercel Firewall rate-limit rule: needs a dashboard change, so it waits for the PO before production;
    - **Checked:** `scripts/test-login-limits.mjs` 7/7 locally. `test-roles-scoping` now plants its lockout under the per-account key and still fails only at its known line 198. Division team, problem reports, email templates, duplicate rule and large files pass. **Online:** Emerson, Cryssa and Zeo sign in, and a made-up name is refused (429) on its 9th wrong try.
  - [ ] Check the guarded rollback scripts in `supabase/rollbacks/`.
  - [ ] Inbound email: review the IMAP failure modes, sender trust (show SPF/DKIM only, never treat an address as identity), and an inbox retention policy.
- [ ] **Data hygiene:**
  - backfill `generated.renderer` on old packages (otherwise there are slow cold loads on Supabase);
  - add an orphaned-file sweeper;
  - run a read-only check that every stored file key passes `assertKey`.

## 3. Product and migration phases still open (`MIGRATION_PLAN.md`)

- [ ] **Phase 5 (rest).**
  - ~~Signed download and upload links for files over 4.5 MB~~ done 2026-11-09 (commit `071ef49`).
  - The "export from Word and upload" fallback.
  - Font mapping (Arial → Liberation Sans).
  - **Client sign-off on the sample PDFs** in `test-results/proofs/vercel-pdf/out`.
- [ ] **Phase 6: Supabase Auth.** Invites, password reset, MFA. This replaces the app's own login and needs per-user database policies.
- [ ] **Phase 7 (rest).**
  - The scheduled inbox check runs only on a production deployment (daily on Hobby). Every-minute checks need Vercel Pro (about US$20/month).
  - Today the inbox is checked every 2 minutes only while someone has the app open.
  - Move from the shared test Gmail to a **dedicated company franchising mailbox**, with live mode approved separately (`RMC2_MAIL_ENV=production`, `RMC2_MAIL_LIVE_CONFIRM`).
- [ ] **Phase 8: import and cutover.**
  - Two import rehearsals with made-up data, then the real-data import into the **client-owned production** Supabase project. Never into the test project or personal accounts.
  - Then cutover, with the PC copy kept read-only for 30 days.
- [ ] **Accounts and cost (Product Owner decisions):**
  - who owns and pays for the production Vercel team and Supabase organisation;
  - Vercel Pro and Supabase Pro, about US$45/month;
  - the backup level;
  - the cutover date.

## 4. Housekeeping

- [ ] Merge `phase-4-postgres` into `main` **after** the final check (section 2).
- [ ] When testing ends:
  - revoke the yiizer17 Gmail app password;
  - delete the Vercel projects `rmc2-preview` and `rmc2-converter`, or move them to the client team;
  - pause or delete the Supabase TEST project.
- [ ] The old Cloudflare staging copy (`scripts/start-staging.ps1` plus the tunnel) is replaced by the Vercel test version, so stop it.
- [ ] Older browser test scripts have stale selectors or need missing data, and fail the same way on `main`. Update or retire them.
- [ ] Next session: start by reading this file, `TEAM_DECISIONS.md` and `MIGRATION_PLAN.md`.

## 5. Mobile fixes (noted 2026-11-02, build on Thursday 2026-11-05)

The three layout fixes apply only at phone width (760px and below). The desktop layout does not change.

- [ ] **Before building anything, check every item properly and question it.**
  - Open each problem in the app at phone width and confirm it happens the way it's described here. Take screenshots.
  - Question each plan and its assumptions, such as what "not the go" meant for the checker. Bring the questions to the product owner before writing code.
  - After each fix, check it again in the app with the same screens. Don't mark an item done until that check passes.

- [x] **Sent proposals: no inline PDF on phones.** Done 2026-11-04 (`SentProposalCard`, checked at 375px and desktop).
  - Now: the review step (`app/operations-workspace.tsx`, the `ops-ws-package` card) always shows `SavedProposalPdf`, which downloads the PDF and draws every page with pdf.js. On a phone this is slow, uses data, and the pages are too small to read.
  - Plan: once the proposal is sent, phones get a short file card instead: file name, page count, a full-width **Open PDF** button (opens in the phone's own viewer) and **Word**. Use a `matchMedia('(max-width:760px)')` check so pdf.js never loads on phones. The **Email to agent** tab stays as it is.
  - Decided 2026-11-02: only sent proposals. Drafts and records awaiting approval keep the inline preview on phones.
- [ ] **"Check proposal details" at the top of the document card.** (a) done 2026-11-04: hidden once sent. (b) still open: ask the PO first.
  - Now: on phones the card header stacks the tabs, then Open PDF / Word / Check proposal details on two rows. The check results then appear above the document and push it down.
  - Plan:
    - (a) Hide the checker once the proposal is sent, because nothing can be changed by then.
    - (b) Before sending, phones show one header row: tabs, Open PDF and Word. The checker moves into its own card **below** the document. Its results open in that card, not above the PDF.
  - Confirm with the product owner that this is what "not the go" meant.
- [x] **Bottom bar overflows for supervisors.** Done 2026-11-04: one row, main action + More menu (checked at 375px and desktop).
  - Now: `ActionBar` (`app/operations-action-bar.tsx`) puts the handling controls and Save on the left. When a record is awaiting approval, the right side holds Return for correction, Edit before approval and Approve. At 375px this wraps to 3–4 rows and covers much of the screen. The page padding grows to match (`--ops-action-bar-h`).
  - Plan: on phones, keep at most two rows:
    - row 1: the main action at full width (Approve & send), with a **⋯ More** button beside it. More opens the existing `.ops-more` menu, which holds Return for correction and Edit before approval.
    - row 2: the handling control and Save, compact.
  - Use the same pattern for the admin Not received… / Confirm sent… pair.
- [ ] Verify at 360px and 390px wide:
  - supervisor approving a record;
  - staff member on a draft;
  - a sent record.
- [x] **Protection shows "31d left" right after approval.** Done 2026-11-04: capped at 30 (`renderNow` refresh not done; the cap covers it). This is not a phone-only bug.
  - Cause: the workspace freezes the current time when the page opens (`renderNow`, `app/operations-workspace.tsx:37`). Protection starts later, at approval, so its end date is a little more than 30 days after that frozen time. `protectionDaysLeft` (`lib/operations/client-rules.ts:28`) rounds up with `Math.ceil`, which turns this into 31.
  - Fix:
    - Refresh `renderNow` whenever the record changes.
    - Cap `protectionDaysLeft` at `CLIENT_PROTECTION_DAYS`, so a small difference between the phone's clock and the server's can never show 31 either.
    - Add a unit test: protection started 1 minute after "now" shows 30.
- [ ] Update `scripts/test-workspace-compact-browser.mjs`. It clicks the checker inside `.ops-saved-pdf-toolbar`, which this change moves.

## 6. Demo prep (2026-11-04, client demo on 2026-11-05)

- Online demo data: `scripts/demo-seed-online.mjs` (8 fictional clients, one per state) and `scripts/demo-check-online.mjs`
  (Pacific Crest Builders, customized and sent). Run sheet: `DEMO_SCRIPT.md`. Forms to email live: `scripts/demo-email-forms.mjs`.
- Verified online through the API: inbox check, Requests list, customized proposal to email, duplicate recheck, password change.
- Still not clicked through in a browser online.
- Demo-day mail caps on the preview: `RMC2_MAIL_CAP_PER_HOUR=30`, `RMC2_MAIL_CAP_PER_DAY=100` (staging only, max 60/200). Remove after the demo if wanted.
- Requests: no-reply senders, mailing lists and bulk mail with no form attached are now skipped automatically (listed under All).
- [ ] After the demo: revoke the Vercel Shareable Link; optionally rotate the demo passwords.
- [ ] Gap: an agent email with details in the body and no attachment can't become an inquiry from Requests (staff must fill the blank form). Consider "Create inquiry from this email".
