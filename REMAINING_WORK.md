# Remaining work (as of 2026-11-05)

This is the one checklist of what is left before RMC2 runs on real data. Details and the reasons behind
each decision are in `TEAM_DECISIONS.md` ("FINAL-CHECK LIST" and the dated entries) and `MIGRATION_PLAN.md`.

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

**Online app in a real browser.** Online, everything so far was driven through the API only.
- [ ] The Requests page: layout, "Check mail now", the error notes, "Imported automatically".
- [ ] **Automatic import of an emailed Excel form, end to end.** Use the sample form in `test-results/Franchise-Form-Mabini-Integrated-School.xlsx`.
- [ ] An emailed PDF goes to Requests, then **Create inquiry** by hand.
- [ ] Phone and tablet layout of the online version. This was tested locally only.

**Online workflow steps never run.** Only import → PDF → submit → approve → send has been verified.
- [ ] Supervisor returns a proposal, then the employee corrects and resubmits.
- [ ] Request missing details (sends an email).
- [ ] Decline, a duplicate-client hold, and the supervisor's decision on the duplicate.
- [ ] Progress reports with attachments, and BOR / agent transfer.
- [ ] Template admin online: upload, preview, publish. Template files over 4.5 MB will fail online.
- [ ] Users & roles, account settings and password change, notifications, and the monitoring page.
- [ ] Downloads over about 4.5 MB (large PDFs and .eml files). These likely fail online until phase 5.
- [ ] Uploads over 4.5 MB. These are refused online; this is known.

**Email edge cases, with real Gmail.**
- [ ] A send failure and an "uncertain" send, with the admin confirming or retrying.
- [ ] Hitting the 5/hour or 20/day cap.
- [ ] An email with several attachments, a very large attachment, or a non-form Excel file.
- [ ] A duplicate client arriving by email.
- [ ] Inbox unreachable, or the app password revoked.

**Data and environment.**
- [ ] **The real data (`.data`, port 5173) has never run the phase 2–4 code.** Back up `.data` first, then start the local app once and check it.
- [x] The historical client directory is loaded online (2026-11-06) and the directory filters were checked there.
- [ ] Two or more people using the online version at the same time. The stress tests were stopped part-way.
- [ ] A cold start after the free Supabase project pauses (it pauses after 7 idle days).

## 1. Must do before sharing the online link with anyone else

- [x] **Rotate the demo passwords.** Done on the test project 2026-11-02: the shared password no longer works for any of the 6 accounts.
  - [x] Script `scripts/rotate-demo-passwords.mjs` sets a random password per account, signs everyone out, and writes them to the git-ignored `test-results/online-credentials/CREDENTIALS.txt` (2026-11-02).
  - [x] Ran on the test project (2026-11-02): 6 accounts rotated, all sessions cleared, verified the old password fails and the new ones match. Rerun the same command to rotate again: `node --env-file=.env.supabase.test scripts/rotate-demo-passwords.mjs --project-ref pgoiqwixaeqbxlwbmren`.
  - [x] `VERCEL_ENV=production` guard: production never seeds demo data, whatever `RMC2_SEED_DEMO` says.
  - [x] A fresh online (Vercel) seed now gets random, unknown passwords, never the shared local one.
  - [x] Password removed from `README.md`, `LOCALHOST.md` and `PROJECT_GUIDE.md` (the local tests still use it locally).
- [ ] Then create a Vercel Shareable Link (Deployment Protection) for testers' phones, and revoke it after testing.
- [ ] Optional: tidy the dashboard and Inquiries layouts so they match (page width, table style, column names "Inquiry"/"Account" and "Received"/"Updated").

## 2. Final check before any real client data or real staff use. Never skip this.

The full specialist reviews were deferred. Run all of them together over everything.

- [ ] **QA, full regression.** Compare against a `main` baseline, using the phase 2 and 3 method.
  - Run the Postgres stress tests T1–T10 from `test-results/phase4-design.md`. The QA run was stopped part-way; its scripts `scripts/test-pg-*.mjs` and `scripts/db-parity/` are committed but unverified.
  - Online checks: PDFs over 4.5 MB through the storage links, real email send, automatic email import, a PDF waiting on Requests, and an unreadable form.
- [ ] **Code review majors** (not yet fixed in code):
  - [ ] **M1, lost index enqueue.** The database fix is written in `supabase/migrations/20261101000400_index_and_bump_fixes.sql` but **not applied**.
  - [x] **M2, deadlocks at commit.** 40001/40P01 raised at COMMIT are now retried (2026-11-02, unit + live checks pass). The bump-order fix in migration 400 is still not applied (see M1).
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
  - [ ] Apply `supabase/migrations/20261101000500_security_hardening.sql`: append-only audit tables, a role connection limit, an environment marker, and stricter self-checks.
  - [ ] Verified TLS to Supabase using the Supabase CA (it is currently `ssl:'require'`, which encrypts but does not verify the certificate).
  - [ ] Login limits:
    - key on user id rather than the typed name;
    - add per-IP and global limits;
    - prune `auth_attempts`;
    - make the password hashing async;
    - consider a Vercel Firewall rule.
  - [ ] Check the guarded rollback scripts in `supabase/rollbacks/`.
  - [ ] Inbound email: review the IMAP failure modes, sender trust (show SPF/DKIM only, never treat an address as identity), and an inbox retention policy.
- [ ] **Data hygiene:**
  - backfill `generated.renderer` on old packages (otherwise there are slow cold loads on Supabase);
  - add an orphaned-file sweeper;
  - run a read-only check that every stored file key passes `assertKey`.

## 3. Product and migration phases still open (`MIGRATION_PLAN.md`)

- [ ] **Phase 5 (rest).**
  - Signed download links for browsers: PDFs over about 4.5 MB can't be downloaded through the app on Vercel yet.
  - Signed uploads for files over 4.5 MB: uploads up to 7/15 MB are refused online today.
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
