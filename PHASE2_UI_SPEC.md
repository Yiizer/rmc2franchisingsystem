# Phase 2 UI spec

The screens for the new roles. This builds on `DEMO_FEEDBACK_PLAN.md` (phase 2), and the ui-ux-designer wrote it on 2026-11-05.

The lead answered the designer's open questions with these defaults:
- The form upload limit is 7 MB.
- "File progress report" is disabled once protection has expired.
- The client page shows name, status, protection and proposal only.
- The role is shown as the account's role label.
- A rejected report is not edited: the owner files a new one.
- Divisions are a fixed list, Division 1 to 7, until phase 3.
- Phones use a bottom tab bar for Division Heads and SOAs.

## 0. Conventions

- **Phone layout:** `@media (max-width:760px)`. Design the Division Head / SOA screens phone-first. Tap targets are at least 44px there, so override `min-height:44px` in the new classes.
- **Page shell:** `dir-page` > `dir-page-heading` > `dir-register` > `dir-toolbar` > `dir-status-filters` / `dir-filter` pills with `<b>` counts.
- **Dates:** `manilaTime(x)` with `ageLabel(x, now)` in a `<small>` underneath.
- **Status colours:** `.ops-client-pill` (`protected` green, `warning` amber, `duplicate` red, `expired`/`neutral` grey). Orange is only for the primary next action (`ops-btn primary`).
- **Reuse:** `Modal`, `Empty`, `Status`, `ops-card`, `ops-message amber|green`, `ops-btn` (`primary`, `secondary`), `ops-link`, `ops-check`, `ops-avatar`, `ops-heading`, `toast` (sonner), `api()`, `endpoint`.
- **Live regions:** errors are `role="alert"`, loading is `role="status"`.
- **Wording:** Division Heads and SOAs never see "agent protection", only "Protection".

### Protection chip (`ClientProtectionChip`, a wrapper over `ops-client-pill`)

| Condition | Class | Text |
|---|---|---|
| More than 7 days | `protected` | `23 days left`, with `<small>Until Dec 3, 2026</small>` |
| 3 to 7 days | `warning` | `5 days left` + expiry |
| 0 to 2 days | `duplicate` (urgent) | `2 days left` / `1 day left` / `Ends today` |
| Report pending | `warning` + `LockKeyhole` | `Held — report under review`, with `<small>Was due Nov 20, 2026</small>` |
| Expired | `expired` | `Protection ended`, with `<small>Nov 3, 2026</small>` |
| Not started | `neutral` | `Protection not started` |

Always show the number as text. The meter is decorative (`aria-hidden`).

### Owner-facing statuses

Never show internal status names to Division Heads and SOAs.

| Internal | Shown | Tone |
|---|---|---|
| New inquiry | Received | blue |
| Preparing proposal, Waiting for agent details, Needs correction, Supervisor editing | In preparation | amber |
| Awaiting approval | Under review | purple |
| Approved — sending, Approved — email failed | Being sent | green |
| Sent | Enrolled (PO decision Q1, 2026-11-07; was "Proposal sent") | green |
| Declined | Declined | slate |
| Transferred | Transferred | slate |
| Archived / expired | Closed | slate |

## 1. Division Head / SOA app

### 1.0 Navigation

- **Desktop:** the sidebar shows only "My Clients" (`Users` icon) and "Submit inquiry" (`Upload` icon) under a WORK label. The topbar has the bell and an avatar menu with "Account" and "Sign out".
- **Phone:** no hamburger or drawer. A fixed bottom tab bar (`ops-tabbar`, `<nav aria-label="Main navigation">`) has 3 tabs, each at least 56px high, with `env(safe-area-inset-bottom)`:
  - My Clients
  - Submit inquiry
  - Account, which opens a small menu with "Account settings" and "Sign out"
- **Phone topbar:** brand mark and bell only, with no environment badge. Content gets `padding-bottom: calc(72px + env(safe-area-inset-bottom))`.
- **Hash routes:** `my-clients`, `my-clients/{id}`, `submit-inquiry`, `notifications`, `settings`. An unknown or disallowed hash goes to My Clients, with no error page.
- **Notifications:** for these roles, the row subtitle shows the client name, not the inquiry id.

### 1.1 My Clients

- **Heading:** "My Clients", with the line "Your clients, their protection and your progress reports."
- **Toolbar:**
  - Search: aria-label "Search my clients", placeholder "Search by client name…".
  - Sort: "Sort: Latest activity" (default), "Protection ending soonest", "Client A–Z".
  - Filter pills (single select): `All {n}`, `Protection ending {n}` (7 days or less), `Report under review {n}`, `Report rejected {n}`.
- **Desktop table** (`dir-table`; each row is a link and opens on Enter):
  1. Client, with `<small>` showing the proposal type or "Franchising inquiry". Never the id.
  2. Status (owner label)
  3. Protection (chip)
  4. Last progress report
  5. Latest activity (`manilaTime` + `ageLabel`)
  6. Chevron
- **Report cell:**
  - None: `—`, with `<small>No report yet</small>`.
  - Pending: amber "Pending review", with `<small>Filed {date}</small>`.
  - Approved: green "Approved", with the date.
  - Rejected: red "Rejected", with the reason on one line and the full text in `title`.
- **Phone cards** (`ops-client-card`): the whole card is tappable, at least 88px high. It holds the client name (2 lines max), status badge, protection chip with "Until {date}", the report chip and the latest activity. One column, 12px gap. The pills scroll sideways.
- **States:**
  - **Loading:** 3 `ops-skeleton` rows, `aria-busy`, and "Loading your clients…" for screen readers.
  - **No clients:** "No clients yet" / "When you submit an inquiry, the client will show up here with its protection dates.", plus a primary "Submit inquiry" button.
  - **No match:** "No clients match" / "Try a different name or clear the filters.", plus a "Clear filters" button.
  - **Error:** amber "We couldn't load your clients. Check your connection and try again.", plus "Try again". Keep the old list visible, dimmed.
- **Paging:** 25 per page, using the `dir-bottom` footer.

### 1.2 Client page (`my-clients/{id}`)

- **Header:** "‹ My Clients" back link, the client name as h1, and the owner status badge. On desktop, "Open sent proposal" sits on the right.
- **Layout:** desktop is a 2-column grid (main column, 360px side column). On phone the order is Protection, Proposal, Progress reports, Timeline.

**Protection panel** (reuse `ops-client-protection`): "Protection", "{n} days left" (`role="timer"`), "Protected until {date}", and a meter (0–30).
- **7 days or less** (`due`): "Protection ends soon. File a progress report to extend it by 30 days."
- **2 days or less** (`urgent`, red): "Protection ends in {n} day(s). File a progress report now.", with the file button inside the panel.
- **Held** (`held`): "Held — report under review" / "Your protection is paused while the Head or Supervisor reviews your progress report. You will be notified of the decision."
- **Expired:** "Protection ended on {date}." / "Ask franchising if you want to protect this client again."
- **Not started:** "Protection starts when the proposal is sent."
- **Always shown:** "An approved report gives you 30 days from the approval date."

**Proposal card:**
- **When sent:** "Sent {date}", plus a primary "Open sent proposal" button. It is a plain `<a target="_blank" rel="noopener">` so iPhone opens its own PDF viewer, with "Opens in a new tab" underneath.
- **Otherwise:** "Your proposal isn't ready yet. You'll get a notification when it is sent."
- **On a 404:** toast "We couldn't open the proposal. Please try again."

**Timeline ("Progress"):** newest first. Short statuses only: Received, In preparation, Under review, Enrolled, Report filed, Report approved, Report rejected, Protection extended. Each shows `manilaTime` and age. No staff names and no notes.

**Progress reports:** the heading shows the count. A primary "File progress report" button sits on the right, full width on phone.
- **Disabled while a report is pending:** use `aria-disabled` and `aria-describedby` with "You already have a report under review. You can file another after it is decided."
- **Disabled without active protection:** "You can file a progress report only while a client has active protection."
- **Each report:** reference (bold), status chip, "Filed {date}", the summary clamped to 3 lines with "Show more", and "View attachment" in a new tab.
  - Pending: "Waiting for the Head or Supervisor."
  - Approved: "Approved {date} · Protection runs until {date}".
  - Rejected: amber "Rejected {date}", "Reason: {reason}" and "You can file a new report."
- **Empty:** "No progress reports yet."

**File progress report** (a Modal; full-height sheet on phone):
- **Intro:** "Tell franchising what happened with {Client}. Once the Head or Supervisor approves, you get 30 days from the approval date."
- **Fields** (inputs use a 16px font):
  - Summary: textarea, required, 10 to 2000 characters, with a counter. Hint: "What did you do with this client? Meetings, calls, next steps."
  - Reference: required, up to 120 characters. Hint: "An email subject, meeting title or other reference we can look up."
  - Attachment (optional): `accept="application/pdf,image/*"`, with "PDF or photo, up to 7 MB." It shows name, size and "Remove".
    - Too large: "This file is {x} MB. The limit is 7 MB."
    - Wrong type: "Please choose a PDF or a photo."
- **Buttons:** "Cancel", and a primary "Send for review" that shows "Sending…" while busy. Use the existing `requestId` pattern so a retry doesn't send twice.
- **Errors:**
  - Already pending: "A report is already under review for this client."
  - No protection: "This client no longer has active protection."
  - Anything else: "We couldn't send your report. Nothing was saved. Please try again."
- **On success:** toast "Report sent for review. Your protection is held until it is decided.", the new Pending item appears, and focus moves to it.

**Not found** (also used for clients they don't own): "We couldn't find this client" / "It may have been removed, or it isn't one of your clients.", plus "Back to My Clients".

### 1.3 Submit inquiry

- **Heading:** "Submit inquiry", with "Upload the franchise inquiry form (Excel or PDF). Franchising will take it from there."
- **Drop zone** (`ops-dropzone`): a "Choose file" button at least 44px high, plus "or drag it here" on desktop. `accept=".xlsx,.xls,.pdf"`, hint "Excel or PDF, up to 7 MB. One client per form." Below it, read-only: "Filed under: {Division}".
- **Once a file is chosen:** a file row with "Remove", and the primary "Submit inquiry" button. While sending it shows "Submitting…" with a spinner.
- **Success** (green, `role="status"`, focus moves to the heading): "Inquiry submitted" / "{Client} was received on {date}. You can follow it in My Clients.", with "View client" and "Submit another".
- **Already protected** (amber, `role="alert"`): only "This client is already protected." and a "Submit a different client" button. No name, id, owner or dates.
- **Unreadable:** "We couldn't read this form. Please upload the franchise inquiry form as an Excel or PDF file."
- **Wrong type or too large:** "Please choose an Excel or PDF file." / "This file is {x} MB. The limit is 7 MB."
- **Network error:** "We couldn't submit your inquiry. Nothing was sent. Please try again." Use an idempotency key so a retry doesn't create a second inquiry.

## 2. Head / Supervisor additions

### 2.1 Approval Queue: "Progress reports" tab

- **Tab:** a third `dir-filter` after the existing two, "Progress reports {n}", for Head and Supervisor only. The nav badge counts proposals plus reports. Hash: `approval-queue/progress-reports`.
- **List:** a card list (`ops-report-list` / `ops-report-card`), oldest submitted first. Hide the Columns menu and filters. Search placeholder: "Search client or Division Head / SOA…".
- **Each card:**
  - Header: the client name (h3) and the chip.
  - "Submitted by {Name} · {Division} · {date} ({age})".
  - Summary (keep its line breaks) and Reference.
  - The attachment: file name, "View".
  - "Protection {n} days left, until {date}", and "Open client", which opens the workspace.
  - **Chip:** while a report is pending it shows "Held", with "{n} days were left".
  - **If the original date has passed:** amber note "Protection ended on {date}. If you reject this report, protection ends. If you approve, it restarts from today."
- **Approve:** confirm modal "Approve progress report?" / "Protection for {Client} will run 30 days from today, until {date}. {Name} will be notified.", with "Approve report" ("Approving…"). Then toast "Report approved. Protection runs until {date}." The card leaves, and a live region announces "Report approved. {n} reports waiting."
- **Reject** (`ops-btn danger`): modal "Reject progress report" with "Reason (shown to {Name})", required, 5 to 500 characters, with a counter. Hint: "Be specific so they can file a better report." Then toast "Report rejected. {Name} can see your reason."
- **Someone decided first (409):** "{Other name} already decided this report." The card is removed and the list refreshes.
- **States:**
  - Loading: "Loading progress reports…".
  - Empty: "No progress reports waiting" / "Reports from Division Heads and SOAs will show here for approval."
  - Error: amber, with "Try again".
- **Phone:** Approve and Reject are equal-width buttons at least 44px high, stacked at 360px and below.

### 2.2 Owner field in the inquiry workspace

- **Read-only, everywhere the inquiry is shown:** under "Agent", "Owner: {Name} <small>{Division}</small>". If there is none: "Not linked <small>Protection is counted for the agent on the form.</small>"
- **Editable** (edit modal, Account group), for Head, Supervisor and Employee while the inquiry is editable: an "Owner (Division Head / SOA)" `OwnerPicker`. It is an ARIA 1.2 combobox: Up/Down, Enter, Escape, `aria-activedescendant`.
  - **Options:** a "Not linked" option first, then "Name · Division" for active Division Heads and SOAs, with role suffix "SOA" where it applies.
  - **Matched from email:** "Linked from the sender's email."
  - **Not matched:** amber "We couldn't match the sender's email to a Division Head or SOA. Pick the owner so the 30-day protection is counted for them."
  - **When changing:** "Changing the owner changes who sees this client and who receives the protection alerts."
  - **States:** "Loading…", "No Division Head or SOA matches “{q}”", "Couldn't load the list. Try again."

### 2.3 Users & Roles

**The Head's view:**
- The heading line becomes "Create accounts and set roles. Admin accounts are managed by IT."
- Role options are Head, Supervisor, Employee, Division Head and SOA. Admin is never offered, and Admin accounts are hidden from the Head.
- A Division select appears after the role and is required for Division Head and SOA. If empty, show "Choose a division." and disable Save.
- Phone field: `type="tel"`, optional.
- Remove "Can approve". Head and Supervisor always approve.
- Nobody can change their own role or active status ("You can't change your own role.").
- **Create account:** Full name, Username, Email, Role, Division (when needed: "Choose a division for a Division Head or SOA."), Position, Phone, and the confirm password. The success screen is unchanged.

**The Admin's view:**
- A read-only list: name, email, role and status.
- Per row: "Reset password", plus "Unlock" when the account is locked.
- The heading line is "Reset a password or unlock an account in an emergency. Role changes are made by the Head."
- Reset asks "Reset password for {name}?" / "A temporary password is shown once. They must set a new one at next sign-in." The new password shows once, in the same block Create account uses.

### 2.4 Monitoring

For Head and Supervisor it shows only the AI usage section ("Monitoring" / "AI usage"), with no service cards, no checks and no "Admin only". It is a plain item under RECORDS. Admin keeps the full page.

### 2.5 Protection card in the workspace

- **Remove "Record progress report"** for everyone.
- **Show the report list always**, with "No progress reports yet." when there are none, and a status chip on each row:
  - "Filed by {Name} on {date}"
  - "Approved by {Name} on {date}"
  - "Rejected by {Name} on {date} · Reason: {reason}"
- **Pending sub text:** "Held — report under review".
- **Head and Supervisor** also get Approve and Reject on a pending report, using the same modals as 2.1.

## 3. Notifications

| Event | To | Title | In-app body | Push |
|---|---|---|---|---|
| Report submitted | Head, Supervisor | Progress report waiting | {Name} ({Division}) filed a progress report for {Client}. | Progress report waiting · {Client} |
| Report approved | Owner | Progress report approved | Your report for {Client} was approved. Protection runs until {date}. | Report approved · {Client} |
| Report rejected | Owner | Progress report rejected | Your report for {Client} was rejected. Reason: {reason} | Report rejected · {Client} |
| 7 days left | Owner | Protection ends in 7 days | Protection for {Client} ends on {date}. File a progress report to extend it. | Protection ends in 7 days · {Client} |
| 2 days left | Owner | Protection ends in 2 days | Protection for {Client} ends on {date}. File a progress report now to keep it. | Protection ends in 2 days · {Client} |

- **`noticeStyle`:** match the report and protection cases before the existing `/approved/` match.
  - "report" + approved: green, `CheckCircle2`
  - rejected: red, `TriangleAlert`
  - report submitted: blue, `FileText`
  - protection: amber, `ShieldAlert`
- **Where a tap goes:** for owners, the Client page. For Head and Supervisor, the Progress reports tab with that card in view.

## 4. New classes

Put them in `app/operations-owner-app.css` and `app/operations-report-queue.css`, using tokens from `operations-tokens.css` only:
- `ops-tabbar`
- `ops-client-card` (+ `-head`, `-meta`)
- `ops-client-protection.urgent` and `.held`, `ops-client-pill.urgent`
- `ops-report-list`, `ops-report-card`, `ops-report-meta`, `ops-report-actions`
- `ops-btn.danger`
- `ops-timeline`
- `ops-dropzone` (`.has-file`, `.dragging`), `ops-file-row`
- `ops-skeleton`
- `ops-owner-picker` (+ `-list`, `-option`)
- `ops-reason-field`, `ops-char-count`

On phones (760px and below) for these roles: hide `.ops-menu`, show `.ops-tabbar`, use cards instead of `dir-table`, make the report action buttons full width, use 16px inputs, and keep buttons at least 44px high.

## 5. Accessibility

- **Navigation:** rows and cards are links. Modals trap focus, Escape closes them unless busy, and focus returns to the button that opened them.
- **Disabled buttons:** `aria-disabled` + `aria-describedby` with the reason.
- **Live regions:** list counts, queue decisions and submit success.
- **Chips:** always text plus an icon, never colour alone, with 4.5:1 contrast.
- **Touch:** 44px targets and 8px between Approve and Reject.
- **Motion:** respect reduced motion.
- **iOS:** 16px inputs, safe-area insets, `accept` on file inputs, and PDFs as plain links.
- **Dates:** always show the full date. A `title` is never the only place information appears.

## 6. Acceptance criteria

1. **Navigation:** a Division Head or SOA sees only My Clients and Submit inquiry (desktop sidebar, or the 3-tab bar at 760px and below), plus the bell and Account. Any other hash shows My Clients.
2. **My Clients:** only their own clients, latest activity first. Search by name works. Each row or card shows name, owner status, the protection chip with days and expiry, the last report state, and the activity date and time.
3. **Chip states:** warning at 7 days or fewer, urgent at 2 or fewer, and "Held" while a report is pending, even past the old expiry.
4. **List states:** loading, no clients, no match and error all show the copy above, and Try again reloads.
5. **Phone width:** at 375px there is no sideways scroll, the list shows cards, and controls are at least 44px high.
6. **Client page:** the timeline uses short statuses, "Open sent proposal" appears only once the proposal is sent, report chips show, and a rejected report shows its reason.
7. **File progress report:** disabled while a report is pending and without protection. Validation and the 7 MB and type checks work. Success shows the toast and a Pending item.
8. **Submit inquiry:** success state on a good file. A duplicate shows only "This client is already protected." An unreadable form shows its message. A retry creates no second inquiry.
9. **Someone else's client:** shows "We couldn't find this client", the same as a missing id.
10. **Progress reports tab:** shown only to Head and Supervisor.
11. **Report cards:** client, submitter and division, time, summary, reference, attachment, days left, Approve and Reject.
12. **Decisions:** Approve gives 30 days from approval. Reject needs a reason, which the owner sees. A second decider gets "already decided".
13. **Owner field:** read-only for everyone. Editable through the picker for Head, Supervisor and Employee. An unmatched sender shows the amber note.
14. **Users & Roles (Head only):** roles never include Admin, Division is required for Division Head and SOA, phone saves, and there is no "Can approve".
15. **Admin on Users & Roles:** only Reset password and Unlock.
16. **Monitoring:** Head and Supervisor see AI usage only. Admin sees everything.
17. **Employee protection card:** no "Record progress report", and reports are read-only with chips.
18. **Notifications:** go only to the stated people. The rejection reason is in-app only.
