# Demo feedback plan: roles, protection approval, locking, email speed, PDFs, divisions

Agreed with the Product Owner on 2026-11-05, in a grilling session after the client demo. Nothing here is built yet.
Build it in three phases. Each phase ends with a check and a deploy to the online test version.

---

## Decisions (what we agreed)

| Topic | Decision |
|---|---|
| Roles | **Head**, **Supervisor**, **Employee**, **Division Head**, **SOA**, plus a hidden **IT Admin**. |
| Head | **Emerson Dolf Fernandez** (his existing account becomes Head). Sees everything. **Only the Head** manages accounts and Proposal Templates. Approves proposals and progress reports. On Monitoring, sees AI usage only. |
| Supervisor | Zeo. Same as the Head, except **no** account management and **no** templates. |
| Employee | Same as today, minus "Record progress report". |
| IT Admin | Database, system health and Integrations (email settings). For accounts, can **only** reset a password or unlock an account in an emergency. No templates. Hidden from the business roles. |
| Division Head / SOA | Same access for now; the difference will be defined later. They log in and see **only their own clients**: status, days of protection left, expiry, the sent proposal PDF, and their progress reports. They can submit inquiries in the app. |
| Who sends inquiries | **Division Heads and SOAs send every inquiry now**; agents no longer send to franchising directly. Agents report to their Division Head / SOA, who emails franchising or submits in the app. The inquiry links to the Division Head / SOA account by sender email, or through a picker when the email doesn't match. |
| Protection owner | The 30 days belong to the Division Head / SOA account. The field agent on the form stays as information. |
| Progress report | Filed by Division Heads / SOAs only. Attachment optional. **One** approval from the Head **or** the Supervisor resets the 30 days, counted **from the approval date**. One rejection rejects it, and the reason is shown. Protection is **held** while a report is waiting. |
| Alerts | In-app only. Reports go to the Head and Supervisor; decisions go to the owner. Reminders 7 days and 2 days before protection ends. |
| Duplicate client (Division Head / SOA view) | They see only "Already protected": no other owner's name and no details. *(Default; the PO skipped this question.)* |
| Division on an account | Each Division Head / SOA account has a division, and their inquiries are filed under it. *(Default; the PO skipped this question.)* |
| Old directory records | Division Heads / SOAs see new inquiries only. |
| Locking | The lock stays while the inquiry is open, even if the handler switches tabs. It drops on release, on close, or after 15 minutes idle. A clear lock flag. **Request handover** for anyone else. **Take over** for the Head and Supervisor, to themselves or to an Employee they pick. Decline, BOR transfer and client review keep their current check. |
| Email speed | Check every 30 seconds while the app is open, check when someone opens it, and refresh right after mail is found. |
| Date and time | Date, time **and year** everywhere: "Nov 5, 2026, 2:14 PM", with the relative time ("5m ago") smaller underneath. |
| Sorting | **Latest activity first** is the default in the client directory, the Inquiries list and My Clients. Activity is the newest of received, approved, sent, progress report approved, or any status change, so a 3-day-old inquiry approved today is on top. Old records use their sheet date. The dashboard queue keeps its "needs action first" order. |
| Phone notifications | Installable web app with push notifications, built for **iPhone first** (Add to Home Screen, iOS 16.4+). Each person turns it on in Account settings and can mute any event type. Events: new inquiry or email arrived, approval needed, decision made, protection expiring, handover requested or taken over. The lock screen shows the event and client name only ("Proposal approved · Lakeside School"). |
| PDF | Full fix: the real demo file, online fonts, the Customize tab-spacing bug, the 12 new templates, and a page-by-page comparison. |
| Divisions | An editable table, loaded with the PO's list. Old records are sorted by **today's** table, with the original text shown beside them. Two filters: Division → Branch, and Category (the sheet). |
| Real directory online | **PO decision 2026-11-05:** load the real client directory onto the test version as is, before the final security check, because the client wants to see it there. The PO accepts the risk. |
| Email signature | On hold until the client replies. |

---

## Phase 1: fixes from the demo

### 1.1 Faster email pull-in
- `lib/operations/inbound.ts`: `AUTO_CHECK_MS` 2 min → **30 s**. The existing slot claim on `inbound_cursor.checked_at` keeps it to one IMAP login per 30 s across all users.
- "Check on open" comes free: the first workspace poll after the app opens triggers `after(autoCheckInbox)` (`app/api/operations/[[...path]]/route.ts:55`).
- Quick refresh: when a poll wins the check slot, the server returns a flag. The client refreshes again about 5 s later, so the import appears without waiting for the next 10 s poll (`app/use-operations-workspace.ts`).
- Requests page (`app/operations-requests.tsx`): add the same 10 s refresh while the tab is visible. Today it loads only once.
- **Done when:** with the app open, a test email with a form appears on the dashboard within 45 s, and there are no more than 2 IMAP logins a minute.

### 1.2 Date and time everywhere
- One formatter in `lib/operations/types.ts`: `manilaStamp()` → "Nov 5, 2026, 2:14 PM" (Asia/Manila, always with the year), shown above `ageLabel()`.
- Apply it in:
  - `app/operations-dashboard-queue.tsx` (Received, Updated)
  - `app/operations-inquiry-list.tsx` (Updated)
  - `app/operations-workspace.tsx` (the heading shows the date only today)
  - `app/operations-requests.tsx`
  - the directory and progress-report lists
- **Done when:** no list shows only a relative age or only a date.

### 1.3 The jumbled PDF
The PO saw it in the **proposal preview and on the approval screen**, so the cause is the PDF itself or how the app draws it.
1. **Find the cause on the real file.**
   - Find the demo package on the test project.
   - Download its saved PDF and open it outside the app.
   - Run `pdffonts` and render the pages.
   - Decide whether the file is broken or the in-app viewer is.
2. **Online fonts** (`converter/Dockerfile`):
   - Add a fontconfig alias file:
     - Arial / Arial MT → Liberation Sans
     - Times New Roman → Liberation Serif
     - Cambria → Caladea
     - Calibri → Carlito
     - Tahoma → DejaVu Sans
     - Aptos → Carlito
     - MS Mincho → Noto Serif CJK
   - Check that ₱ renders in the body font.
   - Redeploy `rmc2-converter`.
3. **Customize tab-spacing bug** (`lib/operations/custom-documents.ts` `tokens()`):
   - Stop counting `w:tab` inside `w:pPr/w:tabs` as text.
   - Treat docx-preview's em space (U+2003) as a tab.
   - Add a unit test on the D023/D024 rate-table paragraphs ("Annual Benefit Limit (ABL)").
4. **pdf.js preview** (`app/operations-saved-pdf.tsx`, `app/operations-document-editor.tsx`): set `standardFontDataUrl` and `cMapUrl` as a safety net, and check that the text-layer CSS loads on the approval screen.
5. **New templates.** Publish 12 replacements through the Template admin staging flow (`stageTemplate` with `expectedHash`). Don't overwrite files: generation checks `sourceHash`.

   | New file | Replaces | Change |
   |---|---|---|
   | BUREAUHEALTH 7K & 5K - 001 | D024 | Flu Shot "FREE for BureauHealth 7,000 only", layout |
   | 7K & 5K PEC & DREADED COVERED - 001 | D025 | same |
   | 7K & 5K PEC COVERED - 001 | D026 | same |
   | 7K & 5K DEPED SEMI ANNUAL OP LIMIT - 001 | D097 | same |
   | TOTAL CORPOHEALTHCHECK - 001 | D054 | layout only |
   | TOTAL CORPOHEALTHCHECK PEC & DREADED - 001 | D055 | quote fix, layout |
   | TOTAL CORPOHEALTHCHECK PEC COVERED - 001 | D056 | layout only |
   | CORPOAIDE 2 - 001 | D091 | quote and period fix, layout |
   | CORPOAIDE 2 PEC AND DREADED - 001 | D092 | quote fix, layout |
   | CORPOAIDE 2 PEC COVERED - 001 | D093 | quote and period fix, layout |
   | TOTAL CORPOSHIELD - 001 | D094 | layout only |
   | TOTAL CORPOSHIELD PEC & DREADED - 001 | D095 | layout only |
   | TOTAL CORPOSHIELD PEC COVERED - 001 | D096 | layout only |

   - **Skipped:** BUREAUHEALTH 4,250 (identical to D023), and every `DONE` folder (15 real client proposals from September, not templates).
   - **Watch:** the new headers layer their logos differently, so `restoreHeaderArtwork` (`lib/operations/office-artwork.ts:33`) may skip them. Check the header logos on every template, and fix the rule if they're missing or doubled.
6. **Compare.** Generate a filled proposal and a customized proposal for every template, on localhost and online. Compare page counts and page images, using the method in `test-results/proofs/vercel-pdf`.
- **Done when:**
  - the demo cause is explained and fixed;
  - every template matches localhost and online in page count, with no text overlapping logos;
  - the Customize edit of a rate-table row saves correctly.

### 1.4 Better locking
- **Lifetime.** The client keeps heartbeating while the inquiry is open, including in a hidden tab (the browser slows it to about once a minute). The server's lease time goes from 90 s to about 3 min, so a closed tab still frees the lock quickly. The client releases the lock after **15 minutes without keyboard or mouse activity**. Files: `lib/operations/activity.ts`, `app/operations-activity.tsx`.
- **Lock flag.** "🔒 Cryssa · 12m" in the list, the preview card and the workspace header. The time counts from `started_at`.
- **Request handover.**
  - New activity action `request-handover`.
  - It notifies the holder, and their tab shows a banner with **Release** / **Keep working**.
  - Limit: one request per person per inquiry every 5 minutes.
- **Take over** (Head and Supervisor):
  - New action `take-over` with an optional `targetUserId` (an active Employee, Head or Supervisor).
  - It clears the holder's lease and reserves the inquiry for the target for 15 minutes until they open it.
  - It notifies the old holder and the target, and writes an audit entry.
  - Needs a small change to `inquiry_activity` (a reserved lease that has no session yet), as a migration for both Postgres and SQLite.
- Decline, BOR transfer and client review keep their current check.
- **Done when:**
  - switching to Gmail for 5 minutes keeps the lock;
  - closing the tab frees it within about 3 minutes;
  - request handover and take over work between two browsers, and the server refuses take over from an Employee.

---

## Phase 2: roles, scoped views and progress-report approval

### 2.1 Roles and one permission module
- `StaffRole` = `Head | Supervisor | Employee | DivisionHead | SOA | Admin` (`lib/operations/types.ts`).
- New `lib/operations/permissions.ts` with one function per capability:
  - `canManageAccounts`
  - `canApproveProposal`
  - `canDecideProgressReport`
  - `canSeeAllInquiries`
  - `canManageTemplates`
  - `canSeeSystemHealth`
  - `canSeeAiUsage`
  - `canPrepareProposal`
  - `canFileProgressReport`
  - `canTakeOver`
- Replace the scattered role checks with these, on the server (`service.ts`, `client-service.ts`, `registration-actions.ts`, `supervisor-edit.ts`, `historical.ts`, `accounts.ts`, `monitoring.ts`, `template-admin.ts`, the route) and in the UI (`operations-shell.tsx` nav, `operations-app.tsx` pages, the workspace components).
- Who can do what:

  | | Head | Supervisor | Employee | Division Head / SOA | IT Admin |
  |---|---|---|---|---|---|
  | Manage accounts | ✓ | | | | password reset / unlock only |
  | Approve proposals | ✓ | ✓ | | | |
  | Decide progress reports | ✓ | ✓ | | | |
  | Prepare proposals | ✓ | ✓ | ✓ | | |
  | File progress reports | | | | ✓ (own clients) | |
  | Templates page | ✓ | | | | |
  | Monitoring | AI usage | AI usage | | | full |
  | Integrations | | | | | ✓ |
  | Take over a lock | ✓ | ✓ | | | |
  | See all inquiries | ✓ | ✓ | ✓ | own only | ✓ |

- **Account changes:**
  - New fields: `division` (Division Head / SOA) and `phone` (kept for the signature later).
  - Emerson Dolf Fernandez (`emerson`, currently an approving Supervisor) → Head.
  - Account management moves from the Admin to the Head. The Admin keeps only password reset and unlock.
  - New "Division Head" and "SOA" sample accounts in Division 4, with random passwords written to the git-ignored credentials file (extend `scripts/rotate-demo-passwords.mjs`).
  - All of this is a migration for both stores.

### 2.2 Linking inquiries to a Division Head / SOA
- New `ownerId` on the inquiry.
- How it gets set:
  - **Email intake:** the sender address matches an active Division Head / SOA (case-insensitive) → linked.
  - **In-app submission** by a Division Head / SOA → linked to themselves.
  - **Manual import or no match** → an "Owner (Division Head / SOA)" picker in the Account section.
- Division auto-fills from the owner.
- Protection uses the owner account. Old records keep the form agent.

### 2.3 Data scoping (security-critical)
- A Division Head / SOA gets **404** on anything they don't own. This is enforced on the server, on every read:
  - the workspace query and inquiry by id
  - file and PDF downloads, and progress-report attachments
  - the directory and history
  - notifications and activity
  - search
- No AI chat or assistant for these roles, because its sources could leak other clients.
- On a duplicate, they see "Already protected" only.
- **A security-engineer review is required before this phase is deployed.**

### 2.4 Division Head / SOA screens
- **My Clients:** client, status, days of protection left, expiry, and the state of the last report.
- **Client page:** status timeline, sent proposal PDF, progress reports, and **File progress report**.
- **Submit inquiry:** upload the franchise form. It goes through the normal intake and duplicate check.

### 2.5 Progress-report approval
- `AgentProgressReport` adds `status` (pending, approved, rejected), `submittedBy`, `decidedBy`, `decidedAt` and `rejectReason`. Existing reports are marked approved (legacy).
- API:
  - `POST inquiries/:id/progress-report`: owner only.
  - New `POST inquiries/:id/progress-report/:reportId/decision`: Head or Supervisor; approve, or reject with a reason.
- **On approve:** `activityAt = decidedAt` and `expiresAt = decidedAt + 30 days` (`lib/operations/client-service.ts`).
- **Hold:** while a report is pending, the client is not treated as expired (`client-rules.ts`). If it's rejected after the date has passed, protection ends at the decision.
- Remove the Employee's "Record progress report" button (`app/operations-client-protection.tsx`).
- **Approval Queue:** a "Progress reports" tab with a count, for the Head and Supervisor.
- **Notifications:** only the Head, the Supervisor and the owner (today it's every active user).
- **Reminders:** at 7 and 2 days left, created when the owner loads the app, at most once per threshold. There's no extra cron on Hobby.
- **Done when:**
  - a Division Head files a report and Zeo approves it → 30 days from the approval;
  - a rejection shows the reason;
  - a pending report holds protection past the old date;
  - an Employee can't file a report, and the server refuses it.

### 2.6 Phone notifications (installable web app + push)
The app has none of this today: no web app manifest, no service worker, no push. It comes after 2.5, because several events only exist once the new roles do.
- **Installable app:**
  - `app/manifest.ts` (name, icons, `display: standalone`, theme color);
  - a service worker in `public/sw.js` that only handles `push` and `notificationclick` (no offline caching of client data);
  - the iPhone meta tags and icons in `app/layout.tsx`.
- **Push:**
  - Web Push with VAPID keys we generate ourselves; no outside provider. The keys go in Vercel env vars (`RMC2_VAPID_PUBLIC_KEY`, `RMC2_VAPID_PRIVATE_KEY`). **Ask the PO before adding them.**
  - Send with the `web-push` package.
  - A new table `push_subscriptions` (user, endpoint, keys, device label, muted event types, created and last-used dates), as a migration for both stores. Remove a subscription when the push service answers 404 or 410.
- **Hook:** the existing in-app `notify()` also sends a push to the recipients' subscriptions, filtered by their muted types. It's fire-and-forget through `after()`, so a slow push never blocks a request.
- **Events → who gets them:**
  - new inquiry imported, or an email waiting on Requests → Employees
  - proposal or progress report waiting → Head and Supervisor
  - proposal approved or returned, progress report approved or rejected → whoever submitted it
  - protection 7 and 2 days → the owner
  - handover requested or taken over → the lock holder and the target
- **Lock screen text:** the event and client name only, never amounts, contacts or attachments. Tapping it opens that inquiry. Division Heads and SOAs only get pushes about their own clients, under the same scoping as 2.3.
- **Account settings:**
  - "Phone notifications": **Turn on** (asks iOS for permission) or Turn off on this device, a mute toggle per event type, and a list of the person's devices with Remove.
  - On iPhone, if the app isn't installed yet, show the steps: Share → Add to Home Screen → open from the icon → Turn on.
- **Guide:** a one-page iPhone install guide in `PHONE_NOTIFICATIONS.md`.
- **Done when:**
  - on a real iPhone (iOS 16.4+), installed from the online test version, each of the five event types arrives with the right text;
  - tapping one opens the right inquiry;
  - muting an event type stops it;
  - a Division Head never gets a push about someone else's client.

---

## Phase 3: divisions and the client directory

### 3.1 Division table
- New tables: `divisions`, `branches` (branch → division) and `branch_aliases` (spelling → branch). Migrations for both stores.
- Loaded with:

  | Division | Branches |
  |---|---|
  | 1 | Tanauan, Cebu Mandaue, Cebu APM Centrale |
  | 2 | Baguio, Baliwag Bulacan, Valenzuela, Ilagan Isabela |
  | 3 | Cainta |
  | 4 | Antipolo, Taytay, Lipa 1, Lipa 2, La Union |
  | 5 | Quezon City, Cubao |
  | 6 | (none yet) |
  | 7 | Bicol Region |

- Obvious aliases are pre-filled: "Div IV / Antipolo" → Antipolo, Baliuag → Baliwag, QC → Quezon City, and so on.
- Everything unclear goes to **Unassigned** until the client answers (see the list below).
- A **Divisions & branches** page for the Head: rename, move branches, add branches, and map unassigned spellings.

### 3.2 Directory
- Each old record's division comes from its branch through today's table, with the original text shown beside it.
- **Category filter** (from the sheet):
  - AMAPHIL
  - Division sheets
  - IWC
  - Logistics
  - SOA/MOA (the 4 SOAMOAAMAPHIL sheets plus SOAMOAIWC)
  - Customized Proposal
  - Generated MOAs
  - Completed accounts
- Filters: Division → Branch, and Category, added to `lib/operations/directory-clients.ts` and `app/operations-directory*.tsx`.
- **Sorting:**
  - The default changes from "Client A–Z" to **Latest activity first**.
  - For live inquiries, "activity" today is only `updatedAt`. Add a `lastActivityAt`: the newest of received, approved, sent, progress report approved, or any status change. Old records use their sheet date.
  - The other options stay: A–Z, oldest activity, and a new "Protection ending soon".
  - The same default goes on the Inquiries list and My Clients.
  - Each row shows the activity date and time ("Approved · Nov 5, 2026, 2:14 PM") so the order makes sense.
- **Importer fix:** two SOA/MOA sheets have a client name in A1, so that client is dropped (`scripts/import-historical-accounts.py`). Detect the real header row.
- **Online load:** a script copies the historical rows from the local SQLite to the test project's Postgres. The PO accepted the risk (see the decisions table).
- **Done when:**
  - the directory online shows all 3,577 records (plus the two recovered ones) under the right Division and Category;
  - unassigned records are visible and countable.

### 3.3 Deferred
- **Email signature:** waiting for the client's example.

---

## Questions to send the client (branches that don't fit the table)

1. **Division 6:** 74 old records say "DIV 6" but name Lipa or Antipolo (Division 4 on the list). That's 22 of the 23 rows on the DIVISION VI sheet. Is Division 6 a Lipa/Antipolo group, or should they move to Division 4?
2. **Places not on the list:**
   - Tacloban (22)
   - Gensan (9)
   - Iloilo (7)
   - Batangas (6)
   - Laguna (5)
   - Bacolod (2)
   - Sta. Mesa, Sta. Rosa, Western Visayas, Bohol (1 each)
3. **"T1" team label** (133 records, usually with Antipolo): which division?
4. **Two divisions in one record:** "Tanauan Branch and Lipa 1" (4), "Lipa / Tanauan" (1), "QC (Cainta)" (1).
5. **Old division label disagrees with the list:**
   - "DIV I / Lipa" (4)
   - "DIV IV – Cebu" (2)
   - Baguio, Valenzuela or Bulacan labelled Division 3 (6)
   - Cainta labelled Division 2 (1)
6. **OK to assume these?**
   - Plain "Cebu" → Division 1
   - Plain "Lipa" → Division 4
   - "Bulacan" → Baliwag Bulacan
   - "Bicol Branch" → Division 7
7. **No branch at all:** LOGISTICS (59) and SOAMOAIWC (82) have no branch column. Should they stay Unassigned?
8. **Newer directory:** the workbook sent on 2026-11-05 is identical to the one imported on 2026-10-20. Is there a newer export?
9. **Email signature:** please send an example.

---

## How it gets built and checked

- **Order:** phase 1, then phase 2, then phase 3. Each phase gets typecheck and unit tests, browser checks on localhost and online, then a deploy to the test version (`vercel deploy --target=preview` + re-alias).
- **Who** (per the team playbook):
  - Phase 1: the lead, plus a backend developer for locking.
  - Phase 2: a database engineer for the migrations, backend and frontend developers on separate files, then **security-engineer** and QA on the scoping.
  - Phase 3: a database engineer plus a frontend developer.
  - A code review at the end of each phase.
- **Negative tests that must pass in phase 2:** a Division Head opening another owner's inquiry by id, file link, search, notification or directory entry gets nothing. An Employee filing a progress report is refused. A Supervisor can't manage accounts.
- **Risks:**
  - Gmail may throttle 30 s checks: watch for login errors and fall back to 60 s.
  - Hidden-tab timers vary by browser: test in Chrome and on a phone.
  - **Real client data on a test project** before the security check (the PO's call).
  - Data leaks through side paths (notifications, search, AI chat, attachments): covered by the phase 2 review.
- **After this:** log the decisions in `TEAM_DECISIONS.md` and update `REMAINING_WORK.md`. The final check (section 2 of `REMAINING_WORK.md`) still applies before real staff use.
