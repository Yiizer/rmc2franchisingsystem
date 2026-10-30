# RMC2 Franchising System — hosting plan (slimmed)

Prepared 29 October 2026. This replaces the scope of `RMC2_Franchising_System_Restructuring_Plan.md` for a solo developer and a client with about 5–15 staff. It keeps that document's workflow rules and safety requirements (Sections 2, 3 and 12 there remain the reference). It drops infrastructure this client doesn't need yet.

Status: plan only. No code, data or accounts have been changed.

---

## 1. Decisions made

| Topic | Decision |
|---|---|
| App hosting | Vercel Pro (Next.js app, API, scheduled jobs, PDF converter) |
| Database, sign-in, files | Supabase Pro (PostgreSQL, Auth, private Storage) |
| Accounts | Client owns Vercel, Supabase, AI and email accounts and pays providers directly. Developer is added as a member. |
| Mailbox | Free @gmail.com today (to confirm). **Build and pilot on IMAP/SMTP with an app password; move to Google Workspace + Gmail API before full launch.** |
| Mail checking | Scheduled check every 1–2 minutes. No Google Pub/Sub push. |
| PDF output | LibreOffice output is acceptable (client to confirm with samples). Run LibreOffice in a Vercel container function. **If that fails: staff convert in Word and upload the PDF.** |
| AI (first release) | Explain why the chosen template fits; draft the agent reply email. Staff always review. No AI form extraction yet. |
| Staff sign-in | Supabase Auth with email + password. Username sign-in kept through a server lookup. Admin invites each staff member. |
| Permissions | Same as today: everyone sees all inquiries. An `area_id` column is reserved; per-area permissions come later if requested. |
| Old data | Import Client Directory history, reviews and display corrections, and proposal templates (active + retired). **Do not import [TEST] inquiries.** |
| Staging | Yes, on free tiers (Vercel preview deployments + a free Supabase project). |
| Backups | Not yet discussed with client. Offer two levels (Section 8). |
| Deadline | None set. |
| Maintenance after launch | Not decided. Price both options (Section 10). |
| UI revamp | Done first on the local version (`REVAMP_PLAN.md`). The new sidebar reserves a **Requests** item under Work for the mail inbox. |

## 2. Confirm with the client before Phase 1

1. **Mailbox type.** Is the agent inquiry address really a free @gmail.com? Do they own a domain (for Workspace later)? Is 2-Step Verification on, or can it be turned on?
2. **PDF look.** Show 3–4 real proposals converted by LibreOffice next to the Word versions. Get a written "acceptable" or a list of what isn't.
3. **Backup level.** One day of possible loss vs. 15 minutes (+$100/mo).
4. **AI provider and data.** Which provider. Confirm client data may be sent to it for the two AI features, and that the provider doesn't train on it.
5. **Staff list.** Names, emails, usernames, roles, and who can approve.

## 3. Architecture

```
Agent email ──► Gmail mailbox
                   ▲      │  (IMAP read every 1–2 min / SMTP send)
                   │      ▼
              ┌───────────────────────── Vercel ─────────────────────────┐
              │ Next.js app + API                                         │
              │ /api/jobs/mail-check   (called by schedule)               │
              │ /api/jobs/run          (generation, sending, retries)     │
              │ PDF converter: LibreOffice in a container function (beta) │
              └───────────────────────────────────────────────────────────┘
                   │                                   │
                   ▼                                   ▼
          Supabase PostgreSQL + Auth           Supabase private Storage
          (records, versions, jobs,            (forms, masters, DOCX/PDF,
           audit, notifications)                raw emails)
                   │
                   └─► AI provider (explain fit, draft email; on request only)
```

- **Mailbox connector module.** All mail access goes through one module with `listNew()`, `fetchMessage()`, `send()` and `findSentByMessageId()`.
  - Version 1 uses IMAP/SMTP (`imapflow` + `nodemailer`).
  - Version 2 uses the Gmail API after the move to Workspace.
  - Nothing else in the app changes when switching.
- **Scheduling.** Supabase Cron calls the Vercel job endpoints with a secret header every 1–2 minutes. A job table in PostgreSQL holds the real state; a call is only a wake-up.
- **Files.** Uploads go straight to private Storage through short signed upload links, which avoids Vercel's 4.5 MB request limit. Downloads use 60-second signed links after a permission check.

## 4. What we keep from the big plan

- Its list of every feature that must still work after the move, and its 30-day protection, BOR, duplicate-hold and supervisor-version rules.
- **Locking in PostgreSQL.** Lock the inquiry and its client-identity keys during save, registration, transfer, approval and send. Stale revisions are rejected with 409.
- **One delivery record per approved version.** Before sending:
  1. Mark the attempt "sending" and stamp a unique Message-ID on the email.
  2. If the result is unclear (timeout, crash), search the Sent folder for that Message-ID before any retry.
  3. Never resend blindly.

  The 30-day countdown starts only from a confirmed send time.
- **Frozen submissions.** A submitted version is fixed (fields, email, template version, DOCX and PDF). Supervisor edits create a new version.
- Import tool with a dry run first, two practice runs into staging, and a checksum for every file.
- One active system at a time at cutover, and the local copy kept read-only for 30 days.

## 5. What we cut (and why)

| Cut | Reason |
|---|---|
| Google Pub/Sub push and webhook verification | Checking every 1–2 minutes is enough for a few hundred emails a day |
| Area permission system and row-level security per area | Everyone sees everything today. Basic row security (signed-in, active staff only) stays. |
| Custom PDF renderer (120–250 h) | Replaced by a container converter, with manual Word conversion as fallback |
| In-app malware scanning | Hard to fit in Vercel. Files come from known agents. Use file-type, size and macro checks instead (accepted risk, noted for the client). |
| Separate recovery project and quarterly restore drills | Offered as an upgrade, not the default |
| AI form extraction with evaluation set | Not in the first release |
| MFA requirement | Optional at launch. Recommended for admin and supervisors later. |

## 6. Phases and effort (one developer)

Hours are rough planning ranges for one person, not quotes. The UI revamp (about 50–80 h, see `REVAMP_PLAN.md`) is separate and comes first.

| # | Phase | What gets done | Hours |
|---|---|---|---|
| 0 | Prep | Client confirmations (Section 2); create client-owned accounts; repo cleanup; hash local source and data | 8–12 |
| 1 | Proofs (go/no-go) | (a) LibreOffice in a Vercel container converts every active template; measure time and memory. (b) IMAP reads a test email with its Excel attachment; SMTP sends one with a PDF; Sent search finds it by Message-ID. | 16–30 |
| 2 | Database and storage | PostgreSQL schema; replace SQLite calls behind the existing service functions; private Storage buckets; keep the current API responses so the UI barely changes | 60–100 |
| 3 | Sign-in | Supabase Auth; username-or-email login via server lookup (generic errors, rate-limited); invites; roles and "can approve" from the database on every sensitive action; old local passwords are not imported | 16–28 |
| 4 | Workflow parity | Handling locks, drafts, client checks, protection/BOR/reports, supervisor versions, notifications, directory and history on PostgreSQL; port the existing test scripts | 40–70 |
| 5 | Mail | Mail-check job (tracks the last message UID, stores raw email + attachments); **Requests** page; "Create proposal from email"; delivery records with the unclear-send check; manual "Import agent form" stays | 35–60 |
| 6 | Hosted PDFs | Generation job using the converter; if Phase 1a fails, the manual path: download DOCX → staff save as PDF in Word → upload → app checks page count and marks "converted in Word" | 20–40 |
| 7 | AI | Template-fit explanation and draft-email suggestions from the form + selected template only; never invents rates; per-month spending cap; shows "AI unavailable" gracefully | 16–28 |
| 8 | Data import | Import tool for history, reviews, corrections and templates; two practice runs on staging; compare counts (e.g. 3,577 historical rows) and file checksums | 16–28 |
| 9 | Test, pilot, launch | Full role tests on staging; 1-week pilot (2 employees, 1 supervisor, admin); move to Workspace + Gmail API connector; cutover; handover notes | 30–50 |
| | **Total** | | **≈ 260–450 h** |

At about 15–20 focused hours a week alongside school, that's roughly 4–7 months.

**Go/no-go after Phase 1:**
- If the LibreOffice container fails, switch Phase 6 to the manual Word path before starting Phase 2.
- If IMAP fails, move to Workspace earlier.

## 7. Monthly running cost (client pays providers)

| Item | Cost |
|---|---|
| Vercel Pro (1 developer seat, includes $20 usage credit) | $20 |
| Supabase Pro (includes credit covering one small project) | $25 |
| Staging (Vercel previews + free Supabase project) | $0 |
| AI usage (two light features, about 5–15 staff) | about $1–10 |
| **Baseline total** | **about $46–55 / month** |
| Google Workspace, 1 mailbox (from launch) | about $7 |
| Optional: 15-minute recovery (Supabase point-in-time recovery) | about $100 |

Prices were checked against the providers' pages on 29 Oct 2026. Recheck before quoting; exchange rate and tax are extra.

## 8. Backup options to offer

- **Standard (default):** Supabase daily database backups (Pro keeps 7 days) plus a nightly job that copies new files from Storage into a backup bucket in the separate free project. Worst case: lose up to one day of work.
- **Upgrade (+about $100/mo):** point-in-time recovery, down to about 15 minutes of possible loss.

Before launch, do one test restore into staging, whichever option the client picks.

## 9. Mailbox details

- **Phase 1–pilot (IMAP/SMTP)**
  - Turn on 2-Step Verification on the client's Gmail and create an app password just for this app.
  - Store it as a Vercel secret only. Never put it in the database or browser.
  - Check new mail by IMAP every 1–2 minutes, tracking the last seen message ID.
  - Send with SMTP. Every outgoing email gets a unique Message-ID so the Sent folder can be searched before any retry.
- **Before full launch (Workspace)**
  - The client creates a Workspace mailbox on their domain.
  - The old @gmail.com auto-forwards to it, so agents don't need to change anything.
  - The app is marked "Internal" in Google Cloud, so there is no Google review and no 7-day token expiry.
  - Switch the connector to the Gmail API.
- **Risk:** Google may restrict app passwords in future. That's why the move to Workspace is planned rather than optional.

## 10. Support after launch (to price)

| Option | What's included |
|---|---|
| Monthly retainer | Fixed hours/month (e.g. 6–10 h) for fixes, dependency updates, account/access changes and small tweaks; response time agreed |
| Pay per request | Hourly or per-task quote when the client asks; no guaranteed response time |

Either way, the client owns all accounts, so they can bring in someone else later.

## 11. Risks to watch

1. **Vercel's container functions are in beta.** The manual Word fallback is ready.
2. **LibreOffice layout differences.** The client signs off samples in Phase 0 and again in the pilot.
3. **App password restrictions.** The Workspace move is planned.
4. **Handling locks and simultaneous edits in PostgreSQL.** Parallel-request tests are required in Phase 4.
5. **Schedule.** One developer with school commitments, and no deadline yet. Agree on monthly check-ins with the client.

## 12. Order of work

1. UI revamp on local (`REVAMP_PLAN.md`).
2. Phase 0 confirmations → Phase 1 proofs → go/no-go.
3. Phases 2–4 (database, sign-in, workflow).
4. Phases 5–7 (mail, PDFs, AI).
5. Phase 8 import rehearsals → Phase 9 pilot, Workspace switch, launch.
