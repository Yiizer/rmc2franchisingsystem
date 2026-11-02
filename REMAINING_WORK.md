# Remaining work (as of 2026-11-02)

This is the one checklist of what is left before RMC2 runs on real data. Details and the reasons behind
each decision are in `TEAM_DECISIONS.md` ("FINAL-CHECK LIST" and the dated entries) and `MIGRATION_PLAN.md`.

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
- [ ] The historical client directory is empty online (never imported to Postgres), so directory features are untested there.
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
