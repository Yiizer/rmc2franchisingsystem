# Feedback round 2026-11-07: plan

Status: **approved by the PO on 2026-11-07**, with the answers below. Item 10 was added at the same time.

## PO answers (2026-11-07)

| # | Answer |
|---|---|
| Q1 | **1A, label only.** "Won" becomes "Enrolled" everywhere, with the same rows and counts. |
| Q2 | **Manual entry only.** Imported forms keep today's review screen. |
| Q3 | Start = first **Started handling** (a new log line). Proposal created = **submitted for approval**. Sent = **email delivered** (`delivery.at`). The times come from those logged timestamps, so the system computes how long each proposal took. |
| Q4 | **Yes.** Pressing Decline opens an email form: "Email the agent" is on by default and the message can be edited. It goes to the original sender, with the same staging redirect and caps. |
| Q5 | **Request missing details** = email the agent, at the address the inquiry came from. |
| Q6 | **Hide** the AI notes and the proposal help/assistant. **Keep** the rule-based checker and suggestions, renamed "Proposal checks" and "Suggested templates", with no AI badge or Sparkles icon. The shared-mobile warning shows in Proposal checks. |
| Q7 | **Head and Supervisors** see the proposal dashboard. The Admin keeps service health. |
| Q8 | Not answered. The recommendation stands: **deactivate only**, and the Head reactivates. |
| Q9 | **Yes.** The To line is read-only and shows the resolved original sender. For a manual entry, the agent email typed into the form is that sender. |
| New | **Item 10:** each staff member can create and save their own email template (greeting, wording, sign-off such as "Best regards, Cryssa"), so they don't have to edit it every time. |

Branch `phase-4-postgres`. Stack: Next 16.3.4 (read `node_modules/next/dist/docs/` before any Next-specific code),
React 19, postgres.js 3.4.7, SQLite locally. **Charts:** `recharts` 3.8 is already installed and has `BarChart` and
`FunnelChart`, so **no new dependency is needed**.

**Schema:** none of the 9 items needs a new table or column. The new data lives inside the existing jsonb `inquiries.data`
(optional fields), and the view preference is stored in the browser (see item 3). **So no migration is planned, and nothing
has to be applied to the TEST project.** If a PO answer changes this (for example 1B with a reporting index), the
migration will be a new file and I will ask before applying it.

---

## Open questions (please answer before I build)

Questions 1, 2 and 3 come from the brief. Questions 4 to 9 came up while reading the code. Each has my recommendation;
"OK" to all recommendations is a valid answer.

| # | Item | Question | Recommendation |
|---|---|---|---|
| Q1 | 1 | Does **"Enrolled" replace the "Won" label only, or is it a new stored status with a date enrolled?** Today "Won" = historical *Closed deal* + historical *Sent / Done* + live inquiries with status *Sent*. A live *Sent* inquiry only means the proposal email went out, so the client is not necessarily enrolled yet. | **1A, label only**, for this round: "Won" becomes "Enrolled" everywhere, with the same rows and counts. If you want real enrollment tracking, choose **1B**: a "Mark enrolled" action with a date; only marked records count as Enrolled, and *Sent* stays "Proposal sent" (Active). |
| Q2 | 7 | Does the labeled-field entry **replace only the manual-entry screen, or also change how imported Excel forms are reviewed?** | **Manual entry only.** Imported forms keep today's review screen. |
| Q3 | 4 | **Which events count as "start creating" and "sent"?** (The definitions I propose are in item 4.) | Start = **first "Started handling"** (a new log line). Proposal created = **submitted for approval**. Sent = **email delivered** (`delivery.at`). |
| Q4 | 9 | **Decline does not send any email today.** It only archives the request and notifies staff. Should decline now email the agent? | **Yes.** The decline dialog gets "Email the agent" (on by default) with an editable message. It goes to the original sender, with the same staging redirect and caps. |
| Q5 | 9 | "**Return**": a supervisor's *Return for correction* goes to the employee inside the app, not to the agent. Did "return" mean the **Request missing details** email? | **Yes, it means Request missing details.** Return for correction stays internal. |
| Q6 | 8 | Some "AI" features are really fixed rules: the proposal checker (missing fields, rates), the template suggestions, and the proposal help. Should these be **removed entirely, or kept with the AI wording removed**? | **Hide** the AI notes panel and the proposal help/assistant. **Keep** the rule-based proposal checker and template suggestions, renamed "Proposal checks" and "Suggested templates", with no AI badge or Sparkles icon. The shared-mobile warning (item 2) shows in Proposal checks. |
| Q7 | 3 | Who sees the proposal dashboard: the **Head only, or approving Supervisors too?** Supervisors' Monitoring page shows only AI usage today, so it would be empty after item 8. | **Head and Supervisors.** The Admin keeps service health. |
| Q8 | 5 | Can a Division Head also **reactivate** an SOA they deactivated? | **No, deactivate only** (as requested). The Head can reactivate. |
| Q9 | 9 | Today staff can type a different "To" address on the proposal email. With "one helper resolves the recipient", should that override go away? | **Yes.** The To line shows the resolved original sender and is read-only. If a different address is truly needed, staff correct the agent email on the record for a manual entry, or ask a supervisor. |

---

## Item 1: Enrolled

**Today:** `lib/operations/directory-model.ts:79` defines the group `won:{label:'Won'}`. `statusGroup()` maps `closed`/`sent` to it,
and `directory-clients.ts:75` maps live `Sent` to it. **There is no export** in the directory or the inquiry lists today,
so "exports" means nothing extra unless an export is added later.

**1A (recommended):**
- Change the group label to `Enrolled`. The key stays `won`, so saved filters and URLs keep working.
- Directory rows in the group show the status label "Enrolled"; the original source text stays in the record detail, as the evidence.
- The filter chip and counts read "Enrolled (n)". The counts are unchanged, so they still add up to the total.
- Inquiry lists: rows with status `Sent` show the pill "Enrolled" in the History tab and the status filter, and the tab is renamed "Enrolled".
- The workspace delivery card keeps "Proposal emailed", because it describes the email itself.
- Owner view (`owner-view.ts:39`): "Proposal sent" becomes "Enrolled".

**1B (if chosen):**
- Add `enrollment?:{at,by,note}` to `InquiryRecord` (jsonb, no migration).
- Add `POST inquiries/:id/enrolled` for the Head/Supervisor, with an audit entry.
- Historical `closed` rows count as Enrolled, using their `dateEnrolled` field when present. Historical `sent` and live `Sent` rows without enrollment count as Active, "Proposal sent".

**Files:** `lib/operations/directory-model.ts`, `directory-clients.ts`, `owner-view.ts`, `app/operations-common.tsx` (`Status`), `operations-inquiry-list.tsx`, `operations-directory*.tsx`.

**Test:**
- `scripts/test-feedback-enrolled.mjs`: every won key maps to "Enrolled", and the group counts sum to the total on a seeded mix.
- Browser check of the directory and History at desktop and 375px.

## Item 2: Shared mobile flag

**Rule:** the inquiry is flagged when the client mobile equals the agent mobile after both are normalized.
- **Client mobile:** `fields.contactPhone`.
- **Agent mobile:** `ownerAgent.phone` when the inquiry is linked to a Division Head / SOA, otherwise `fields.agentPhone`.
- **Normalizing:** keep the digits only, drop a leading `0063`, `63` or `0`, and compare only when 10 digits remain. So `0917 123 4567`, `+63 917-123-4567` and `9171234567` are equal.
- A blank number on either side never flags.
- The normalizer moves out of `client-rules.ts:45` into an exported `phMobileKey()`, so that `samePerson` keeps the same behaviour and the flag uses the same rule.

**Where it shows:**
- `InquirySummary.sharedMobile?:true`, computed in `workspace-query.ts`. The lists show an amber "Shared mobile" chip in the Account cell.
- The workspace shows an amber banner on the inquiry: "The client's mobile number is the same as the agent's (0917…). Check that the client details are the client's own."
- Proposal checks show a warning line. The client-review panel shows a non-blocking note next to the duplicate matches.

**It never blocks:**
- It is not added to `missingFields`/`documentIssues` blockers.
- It does not change `clientReview.state` and does not affect submit or approve.
- Owner-scoped users don't see it (their view never shows internal checks).

**Files:** `lib/operations/client-rules.ts`, `types.ts`, `workspace-query.ts`, `app/operations-inquiry-table.tsx`, `operations-workspace.tsx`, `operations-proposal-checks.tsx`, `operations-client-comparison.tsx`.

**Test:**
- `scripts/test-feedback-shared-mobile.mjs`: the format matrix (0917…, +63917…, 917…, with spaces and dashes) flags; a different number, a blank number or a landline does not; an owner-linked inquiry uses the owner's phone.
- An end-to-end import of a matching form shows `sharedMobile` in the list API, and submit is still allowed.

## Item 3: Head monitoring dashboard

**Endpoint:** `GET monitoring/proposals?period=day|week|month&from=&to=`, in a new module `lib/operations/proposal-stats.ts`.
- Head and Supervisors (Q7) get it. Everyone else gets 403, and owner-scoped users are already blocked by the whitelist.
- The default ranges are the last 14 days, the last 12 weeks and the last 12 months.
- All bucketing uses Manila time, and weeks run Monday to Sunday.

**What is counted** (each inquiry once per bucket):

| Bucket | Counted when |
|---|---|
| **Sent** | the delivered submission's `delivery.at` falls in the bucket |
| **Declined** | `closure.kind==='declined'` and `closure.at` falls in the bucket |
| **Not yet started** | `createdAt` falls in the bucket and the inquiry is still `New inquiry` with no closure |

**Funnel** (inquiries received in the selected range):
- Received, then Started (has a "Started handling" or preparation entry), then Submitted (≥1 submission), then Approved (a decision is approve), then Sent.
- Each step is a subset of the step before it.

**Response:**
- `{period, buckets:[{label,start,sent,declined,notStarted}], funnel:[{step,count}], timing:{…item 4…}, asOf}`.
- It reads `inquiries.data` in one snapshot and computes in JS. That is fine at today's scale (hundreds of rows); this note marks where to move to SQL if it ever grows.

**Screen:** the "Monitoring" page for the Head and Supervisors becomes **"Proposal dashboard"**.
- Controls: a Day/Week/Month segmented control and a **Charts / Numbers / Both** toggle.
- **Charts:** a stacked bar per bucket (Sent green, Declined red, Not started gray, with a legend and tooltips) and a recharts `FunnelChart`, which reads as a step chart with counts and the percentage from the previous step.
- **Numbers:** the same data as `ops-table` tables, plus a totals row.
- **The toggle persists per user** in `localStorage['rmc2.monitoringView.'+user.id]`, read inside try/catch and defaulting to Both. This survives a reload on the same browser. (Server-side storage across devices is possible through the `settings` table if wanted; not planned.)
- **States:** a skeleton while loading, "No proposals in this period" when empty, an error card with Retry, and a no-permission message.
- **Phone width:** the charts stack and the tables scroll inside their card.

**Files:**
- New: `lib/operations/proposal-stats.ts`, `app/operations-proposal-dashboard.tsx` and `.css`.
- Changed: `app/operations-app.tsx`, `operations-shell.tsx` (nav label), the route file, `permissions.ts` (adds `canSeeProposalStats`; `canSeeAiUsage` stays for the test).

**Test:**
- `scripts/test-proposal-stats.mjs` seeds fixed-timestamp inquiries across day, week and month edges (including Manila midnight and a Sunday/Monday boundary) and checks every bucket and funnel count by hand.
- Browser check: the toggle survives a reload; desktop and 375px screenshots.

## Item 4: Timing stats per employee

**Events used.** All of these exist today except the first.

| Name | Source | Notes |
|---|---|---|
| **Started handling** (new) | a history entry `Started handling`, written by `updateInquiryActivity` on `start` | Written only the first time each user starts that inquiry, without a revision bump, the same way `logHandover` does. |
| Fallback start for older records | the first history entry by that user whose action starts with `Started / saved proposal preparation` or `Updated inquiry details` | For records from before this change. |
| **Submitted** | `submissions[v].at` (by `submissions[v].submittedBy`) | |
| **Sent** | `submissions[v].delivery.at`, for the delivered version | |

**Definitions (Q3):**
- **(a) Time to create a proposal (per version v):** from the submitter's first *Started handling* after the earlier of creation (v1) or the decision on v−1 (v2+), to `submissions[v].at`. It is credited to `submittedBy`, and counted in the period by its submit date.
- **(b) Handling time:** from the first *Started handling* by any staff member on the inquiry, to `delivery.at` of the sent version. It is credited to the preparer of the sent version (`submittedBy`), and counted in the period by its sent date.
- Both are **wall-clock time**, including nights and weekends. They are shown as "2h 15m" or "1d 4h".
- **Averages:** the mean of each employee's values in the selected period, shown with n.
- **Skipped:** inquiries with no start event, and declined, transferred or unsent inquiries for (b).
- "Confirmed manually" sends count, using the confirmation time.

**Screen:** a "Time per employee" table on the proposal dashboard.
- Columns: Employee · Proposals created · Avg time to create · Proposals sent · Avg handling time.
- It follows the same period selector. In "Charts" view, a horizontal bar of the averages is shown.

**Docs:** the definitions above go into `TEAM_DECISIONS.md` after the PO answers Q3.

**Files:** `lib/operations/activity.ts` (one log line), `proposal-stats.ts`, the dashboard component.

**Test:** `scripts/test-proposal-stats.mjs` seeds 3 employees with known timestamps, including a returned and resubmitted version and a record without a start event, and checks the computed values and averages against a hand-computed table that is kept in the script.

## Item 5: Division Head manages SOAs

**Permission:** add `canManageDivisionSoas(user)`, true for `DivisionHead` only.
- `canManageAccounts`/`canResetPassword` stay unchanged, so the existing matrix in `test-roles-scoping.mjs` still passes.

**New module `lib/operations/division-team.ts`.** Every function re-reads the acting user from the database: the user must be an active Division Head with a division.

| Function | What it does |
|---|---|
| `listTeam(dh)` | The SOAs where `division===dh.division`: name, username, email, phone, active, mustChangePassword. |
| `createSoa(dh,{name,username,email,position,phone,currentPassword})` | The role is forced to `SOA` and the division to `dh.division`. Returns a one-time temporary password. It uses the same validation, uniqueness and password rules as `createAccount`; the shared bits are exported from `accounts.ts`, which is otherwise unchanged. |
| `deactivateSoa(dh,{id,currentPassword})` | Ends the target's sessions, the same as a Head deactivation. |
| `resetSoaPassword(dh,{id,currentPassword})` | Gives a temporary password and unlocks the account. |

**Rules:**
- The target must be an SOA in the same division. Anything else (another division, a non-SOA, an unknown id) gets the **same 403 message**, so no account's existence is leaked.
- Deactivate and reset need the Division Head's own password again, matching the Head's rule.
- Every action writes a `securityEvent`.
- The daily limits stay as they are.

**Routes:** `GET my-team`, and `POST my-team/create`, `my-team/:id/deactivate`, `my-team/:id/reset-password`.
- These are **new names**, added to the `ownerRouteAllowed` whitelist. The existing test still requires `create-account` and `reset-password` to be refused for owner roles, and they stay refused.
- An SOA passes the whitelist but gets 403 from `canManageDivisionSoas`, so it is enforced server-side twice over (route and service).

**Screen:** "My team" in the Division Head's sidebar only.
- An `ops-table` like Users & Roles, with "Add SOA", "Reset password" and "Deactivate".
- The temporary password is shown once in a dialog.
- It has loading, empty ("No SOAs in Division 3 yet"), error and no-permission states.

**Files:** `lib/operations/division-team.ts` (new), `accounts.ts` (export helpers), `permissions.ts`, `scope-guard.ts`, the route file, `app/operations-owner-team.tsx` (new), `operations-owner-app.tsx`, `operations-shell.tsx`.

**Test:** `scripts/test-division-team.mjs`.
- A Division Head creates an SOA in their own division; a `division` sent in the body is ignored.
- A Division Head trying to deactivate or reset an SOA in another division, a Supervisor, a Division Head, or an unknown id gets 403 every time.
- An SOA gets 403 on all 4 routes.
- Deactivation ends the target's sessions; a wrong password gets 403.
- Then re-run `scripts/test-roles-scoping.mjs`.

## Item 6: Uniform Division Head / SOA dashboard

- The owner app's **My Clients** page (`operations-owner-clients.tsx`) is rebuilt on the employee dashboard's parts:
  - the `ops-heading` header;
  - the `ops-stats` cards (Received · In preparation · Under review · Enrolled · Protection expiring);
  - the `ops-table` / `ops-inquiry-table` styles and column naming ("Account", "Status", "Received", "Updated").
- The phone layout uses the same card-row pattern as the Inquiries list.
- No data changes: it stays on the whitelisted `my-clients` API, with the owner-facing status names from `PHASE2_UI_SPEC.md`.
- The new "My team" page (item 5) uses the Users & Roles table style.
- Division Heads and SOAs have no monitoring screen today, and none is requested beyond this. If you want a division-level count screen for Division Heads, that would be a later addition.

**Files:** `app/operations-owner-clients.tsx`, `operations-owner-app.css`, possibly `operations-owner-client.tsx` (header only).

**Test:** browser screenshots of the employee dashboard and My Clients side by side, at desktop and 375px; `scripts/test-phase2-ui-browser.mjs` still passes.

## Item 7: Inquiry entry with labeled fields

**Screen:** the "Import agent form" modal (Employee/Admin) and the Division Head / SOA "Submit inquiry" page get two tabs: **Upload form** (as today) and **Fill in details**.

"Fill in details" is a grid of labeled text fields in the same groups as `FORM_GROUPS`:
- **Account:** account name, sector (select: Private / DepEd / Government), nature of business, address, branch, request date.
- **Agent and contact:** agent name, agent email, agent mobile, client contact, client email, client mobile, client position, addressee, addressee position.
- **Coverage:** requested plan, existing provider, payment (select: Annual / Semiannual / …), employees, dependents, age ranges, hospitals, dental.

It has 2 columns on desktop and 1 at 375px. Required fields are marked, and errors show inline. "Agent email" is the reply address (item 9).

**Server:** `POST intake-fields` with JSON `{fields, ownerId?, idempotencyKey}`.
- The fields are checked by zod against exactly the **Excel mapping keys** in `forms.ts`, plus `sector`, with length limits.
- The existing writer `sampleForm(fields)` builds a real franchise-form `.xlsx`. That file then goes through the **unchanged `intake()`**, so parsing, duplicate checks, division fill, the owner daily cap and notifications are all identical to an emailed form.
- The record gets `source.origin='manual'`; the file name is "Manual entry – {Account}.xlsx".
- Division Heads / SOAs get it through the whitelist, with the sender forced to their own email, as `intake` does today.
- An idempotency key stops a double click from creating two inquiries.

**Files:** `lib/operations/forms.ts` (export the mapping keys), `service.ts` (a small `intakeFields` wrapper), `scope-guard.ts`, the route file, `app/operations-inquiry-entry.tsx` (new, shared), `operations-app.tsx`, `operations-owner-submit.tsx`.

**Test:** `scripts/test-inquiry-fields.mjs`.
- The typed fields round-trip into `record.fields` the same as importing the same values as an Excel file.
- An unknown key gets 400.
- An owner's 21st submission in a day gets 429.
- A duplicate client is held the same way as an import.
- Browser check of both tabs at desktop and 375px.

## Item 8: AI removed

**Approach:** one constant, `AI_FEATURES=false`, in a new `lib/operations/features.ts`. Every AI surface checks it and renders nothing. The components and API paths stay in place, so they can be deleted later in one change.

| Surface | Change |
|---|---|
| `operations-document-editor.tsx`: "AI notes" toggle and the `ProposalAiNotes` panel | hidden |
| `operations-proposal-help.tsx`: "AI suggestion" and the proposal assistant (`chat`) | hidden (Q6) |
| "AI proposal checker" / "Simulated AI · staff review required" in `operations-proposal-checks.tsx`, `operations-saved-pdf.tsx`, `operations-document-editor.tsx`, `operations-workspace.tsx:187` | renamed "Proposal checks", badge and Sparkles removed (Q6) |
| "AI template advisor" in `operations-workspace-templates.tsx` | renamed "Suggested templates", no badge (Q6) |
| The AI usage card on Monitoring (`operations-administration.tsx`) | removed from the UI. `monitoring()` keeps returning `ai`, because `test-roles-scoping.mjs` checks its keys. |
| The "AI provider" row in the Admin service list (`monitoring.ts`) and the Integrations page | removed from display |
| Login footer "Email and AI services remain in test mode" (`operations-app.tsx:67`) | becomes "Email remains in test mode" |
| `integrations.ai` in the bootstrap response (route file) | left in the API, not displayed |
| `app/franchise-workspace.tsx` ("AI assistance", "Run AI extraction") | **Unreachable today:** nothing imports it (it is the old prototype). Left as it is; listed for deletion later, which needs your OK. |

**Test:**
- A new `scripts/test-no-ai-text.mjs` signs in as each role in the browser, visits every page and an inquiry workspace, and fails if the visible text or aria-labels match `/\bAI\b/`.
- It also greps the reachable `app/operations-*.tsx` for visible "AI" strings.

## Item 9: Reply to the original sender

**One helper:** `replyRecipient(record)` in `lib/operations/reply-recipient.ts`, for **all** outbound outcome emails:
1. If `source.origin==='manual'`: use `fields.agentEmail` (the agent email on the record).
2. Otherwise use `source.sender`. This is a new optional field written at intake: the email address the form was imported from, or the Division Head / SOA account email when linked, as `inbound.ts:188` already decides.
3. For records from before this change: `source.fields.agentEmail`. The parsers already set this to the sender at intake (`forms.ts:28,39`), and the source copy is never edited.
4. If none of these is a safe email address, the send is refused with "No reply address on this inquiry".

**Used by:**
- the proposal-sent email (`defaultEmail`/outbox at approval, `service.ts:133`);
- request details (`service.ts:301`, today `fields.agentEmail`);
- the new decline email (Q4).

`saveDraft` stops accepting a `to` override (Q9), and the UI shows To as read-only. Staging redirect and caps are unchanged.

**Files:** `lib/operations/reply-recipient.ts` (new), `types.ts` (`SourceForm.sender`, `origin`), `forms.ts`, `service.ts`, `registration-actions.ts` (decline email), `app/operations-registration-actions.tsx` (decline dialog checkbox), the email-draft UI.

**Test:** `scripts/test-reply-recipient.mjs`, using local mail mode with a capture transport.
- **An email-imported inquiry:** the agentEmail field is later edited to something else, yet decline, request-details and proposal-sent all go to the original sender.
- **A manual entry:** all three go to the record's agent email.
- **An owner-linked inquiry:** all three go to the owner's account email.
- A `to` override in `saveDraft` is ignored.
- A source search confirms that no outcome path builds its own `to`.
- **No real email is sent**: the script runs on local mode only. A real staging send (redirected to the test inbox) waits for your OK.

## Item 10: My email templates (added by the PO on 2026-11-07)

**Goal:** each staff member saves their own wording for the 3 agent emails, so the email form is already filled in their way and they don't retype the sign-off each time. The 3 emails are:
- the **proposal email** (sent on approval);
- **request missing details**;
- **decline**.

**Storage:** the existing `settings` table, with the key `email_templates:<userId>`.
- No migration. It uses the same insert/upsert pattern as `division-store.ts`.
- It is never added to `Staff`: the users list goes to every client, and nobody should see other people's templates.
- The data is `{proposal?:{subject,body}, details?:{body}, decline?:{body}, updatedAt}`.

**Placeholders:** `{agentName}`, `{company}`, `{proposalName}`, `{myName}`.
- The server fills them in with plain text replacement; nothing is executed, and unknown `{…}` is left as it is.
- Limits: subject up to 300 characters and body up to 10,000.

**API** (`lib/operations/email-templates.ts`): `GET email-templates` returns your own templates plus the built-in defaults. `POST email-templates` saves your own; a `null` for a kind resets it to the default.
- Only for users who can prepare proposals or decline (Head, Supervisor, Employee). Admin, Division Head and SOA get 403, and Division Heads / SOAs are also blocked by the route whitelist.
- A user can only ever read or write their own key. The id comes from the session, never from the request body.

**How it is used:**
- **Proposal email:** wherever `defaultEmail(...)` builds the automatic draft (`saveDraft`, `generate`), it uses the **preparer's** saved template when one exists. The To line still comes from `replyRecipient` (item 9). Per-email edits still work as they do today.
- **Request details and Decline dialogs:** the body is prefilled from the user's saved template. It can be edited for that one email, and "Save as my template" stores the edited text.
- **Settings → "My email templates":** one card per email. It has a subject (proposal only) and body editor, a placeholder hint, a live preview using sample values, Save, and Reset to default. It handles loading, error and no-permission states, and works at 375px.

**Test:** `scripts/test-email-templates.mjs`.
- Saving and reading your own template works.
- Another user's templates are never returned.
- Admin, Division Head and SOA get 403.
- The placeholders are filled in.
- A proposal generated by a user with a saved template uses it, and one generated by a user without uses the default.
- The details and decline emails use the dialog text that was sent.

---

## Build order and tracks (after approval)

The tracks share no files, and the lead checks every handoff with diffs and test output.

1. **Contracts first (lead):** add the type additions to `types.ts` (`sharedMobile`, `SourceForm.sender/origin`) and the response shapes above.
2. **Backend track:** items 2, 4, 5 and 9, plus the item 3 stats endpoint and the item 7 server.
   - Owns: `lib/operations/{client-rules,activity,proposal-stats,division-team,accounts,reply-recipient,forms,service,registration-actions,scope-guard,permissions,workspace-query,monitoring,features}.ts` and the route file.
3. **Frontend track:** items 1, 3, 6, 7 and 8 (UI).
   - Owns: `app/operations-*.tsx/.css`, plus `directory-model.ts`, `directory-clients.ts` and `owner-view.ts` (item 1 labels).
4. **QA and code review:** all the new scripts and `test-roles-scoping.mjs`; typecheck and lint; browser screenshots at desktop and 375px; a security review of item 5 and the `intake-fields` route.

**Docs when done:**
- Append each PO answer (Q1–Q9) and the item 4 definitions to `TEAM_DECISIONS.md`.
- Update `REMAINING_WORK.md`.

**Stop and ask before:** applying any migration to the TEST project (none planned), deploying, sending a real email, deleting `franchise-workspace.tsx`, adding a dependency, and committing or pushing.
