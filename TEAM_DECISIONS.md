# Team decisions log

Decisions and lessons from the AI development team (Technical Lead + specialist agents) working on this
repo. Read this before changing UI, workflow rules or tests, so settled decisions aren't reopened and
past mistakes aren't repeated. Newest entries go at the top of each section.

Format: **Decision** — why — where it applies.

## Product decisions (approved by the Product Owner)

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
