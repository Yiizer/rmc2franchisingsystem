# UI/UX revamp plan — October 29, 2026

This plan covers the revamp agreed after the full UI/UX review on October 29, 2026: the sidebar, a shared design foundation, the list pages, the dashboard, the inquiry workspace, notifications and admin pages.

It changes **presentation and navigation only**. The workflow, permissions, handling locks, duplicate holds, approval rules, database schema and API stay as they are. The one exception is a small server tweak to the dashboard queue count (Phase 4).

## Starting point (what the review found)

- **No single design system.** There are three competing token layers:
  - `globals.css` sets a teal shadcn theme with Arial.
  - `operations.css` redefines navy and orange inline, also with Arial.
  - `operations-tokens.css` sets IBM Plex and a third palette.

  On top of that sit about 25 CSS files (~240 KB), more than 1,000 unique hex colors and 86 `!important` rules. This is why pages feel slightly different from each other.
- **The sidebar has 8–12 items that overlap.**
  - My Inquiries and Inquiries are the same table with a filter.
  - History and Archives are both "finished" lists.
  - Notifications duplicates the top-bar bell.
  - Settings sits among the work items.
  - Inquiries and Client Directory share the same icon.
  - On a 1366×768 laptop the admin sidebar scrolls the user and sign-out footer off-screen.
- **Mixed action colors.** Primary buttons are dark orange (Dashboard), bright orange (other pages), blue ("Start handling") and navy ("Choose template", "Continue").
- **Inquiry workspace problems.**
  - "Start handling" and "Choose template" compete as two equal primary buttons. On a phone "Start handling" is buried below the overview.
  - The step bar shows step 2 as not done on submitted proposals.
  - There is an empty gap under "Client protection & progress reports".
- **List tables.** Every row is a bordered box with a thick left stripe. "Agent protection" mixes the countdown with the agent's name. "Import agent form" appears on History and Archives. History shows a status filter even though every row is Sent.
- **Smaller issues.**
  - The dashboard queue badge says 8, but 7 rows show for supervisors.
  - The "Review proposal" button pokes past the card edge.
  - The 4th draft sits alone on its own row.
  - Every notification uses the same bell icon, and unread items are marked only with a left stripe.
  - The Archives empty state uses the wrong copy.
  - "Check the server log" errors are shown to staff.
  - The Monitoring cards use colored left stripes.

## Ground rules

1. **Checkpoint first.** Tag the current source the same way as the mockup refinement, e.g. `local-revamp-baseline-YYYYMMDD`. Back up `.data/rmc2.sqlite` before starting. Do not reset the repository.
2. **Never test against the real database.** Run visual and browser checks on a QA server with its own data folder (port 5194, `test-results/revamp/qa-data`).
3. **Keep URLs working.** Old hashes (`#my-inquiries`, `#history`, `#archives`, `#notifications`) must redirect to their new homes.
4. **Keep server view names.** The server views in `lib/operations/workspace-query.ts` (`My Inquiries`, `Inquiries`, `History`, `Archives`, `Approval Queue`) stay unchanged. The new tabs map onto them, so no server changes are needed for navigation.
5. **One phase at a time.** Each phase ends with a typecheck, a production build, the existing workflow tests and screenshots at 1440×900, 1366×768 and 390×844 before the next phase starts.
6. **Follow AGENTS.md.** This project runs Next.js 16. Check `node_modules/next/dist/docs/` before touching routing, layout or anything framework-specific.

## Phase overview

| # | Phase | Main files | Size |
|---|---|---|---|
| 0 | Checkpoint and QA setup | git tag, QA data folder | XS |
| 1 | Design foundation (tokens, type, buttons, status colors) | `operations-tokens.css`, `globals.css`, `operations.css`, `operations-mockup.css` | L |
| 2 | Sidebar and app shell | `operations-app.tsx`, new `operations-shell.css` | M |
| 3 | List pages (Inquiries, Closed, Approval Queue) | `operations-app.tsx` (`InquiryTable`, headings), `operations-common.tsx` | M |
| 4 | Dashboard | `operations-app.tsx`, `operations-dashboard-queue.tsx`, `workspace-query.ts` (count) | S |
| 5 | Inquiry workspace | `operations-workspace.tsx`, `operations-workspace-steps.tsx`, `operations-workspace.css` | L |
| 6 | Notifications | `operations-app.tsx`, new `operations-notifications.tsx` | S–M |
| 7 | Admin, Monitoring and Settings | `operations-administration.tsx/.css` | S |
| 8 | Copy, empty states and test data | `operations-common.tsx`, the API error mapping | S |
| 9 | QA, cleanup and handover | `scripts/test-*.mjs`, `REVAMP_NOTES.md` | M |

Rough effort: about 7–10 working days for one person, with Phases 1 and 5 the largest.

---

## Phase 1 — Design foundation

**Goal:** one source of truth for color, type, spacing and controls, so every later phase uses it instead of adding more one-off CSS.

### 1.1 Tokens

Rewrite `operations-tokens.css` as the only token file, organized in these groups:

- **Brand:** navy `#0a2047` (shell), orange `#ff791f` (brand accent: logo, active marker, focus highlights).
- **Action:** one primary action color. Recommended: navy for solid primary buttons, with orange kept as the brand accent. This matches the existing "Continue" and "Choose template" buttons and reads calmer for an operations tool. Confirm in *Decisions needed*.
- **Neutrals:** ink, muted text, rules, surface, canvas. Muted text must reach at least 4.5:1 contrast on its background; several current grays fail.
- **Status:** one set used everywhere. Each status gets a text color and a tint:
  - New inquiry: blue
  - Preparing: amber
  - Awaiting approval: violet
  - Needs correction: red
  - Sent: green
  - On hold / duplicate: red outline
  - Archived: neutral
- **Type scale:** 12 / 13 / 14 / 16 / 20 / 28. IBM Plex Sans everywhere.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Radius:** 6px for controls, 10px for cards.
- **Shadows:** one card shadow, one popover shadow.
- **z-index scale:** sidebar, sticky, drawer backdrop, drawer, modal, toast.

Then:

- Point the shadcn variables in `globals.css` (`--primary`, `--ring`, `--sidebar-*`, `--font-sans`) at these tokens, so teal and Arial disappear.
- Remove the duplicate variable block and Arial from the top of `operations.css`.

### 1.2 Controls

- **Buttons:** standardize `.ops-btn` into four variants and replace the blue, dark-orange and ad-hoc primaries:
  - `primary` (solid action color)
  - `secondary` (outline)
  - `ghost` (text only)
  - `danger`
- **Status pill:** one `Status` component style in `operations-common.tsx` (dot + label, tint background), used by every table and header.
- **Focus:** a visible focus ring on every control, using the brand accent.

### 1.3 Remove the side-stripe pattern

Replace every `border-left: 3–6px` accent with one of: a full 1px border, a tinted background or a leading icon. Current spots include task cards, notices, monitoring cards, the approval-wait box and the email/approved banners.

### 1.4 CSS consolidation (incremental)

- Don't rewrite all 25 files at once. As each later phase touches a screen, move its rules onto the tokens.
- Delete overrides that only existed to fight older rules. Target: fewer than 20 `!important` rules by the end of Phase 9.
- `operations-mockup.css` should be emptied into the proper files by the end and then deleted.

**Done when:**
- Only one primary button color appears anywhere.
- Plex renders everywhere.
- No side stripes remain.
- Existing screens look the same or better at all three sizes.

---

## Phase 2 — Sidebar and app shell

### 2.1 New navigation structure

```
RMC2 · Franchising Operations

WORK
  Dashboard            (layout-dashboard)
  Inquiries            (inbox)              tabs: Mine · All
  Approval queue  [3]  (clipboard-check)    supervisors with approval permission only

RECORDS
  Client directory     (contact / book-user)
  Closed               (archive)            tabs: Sent · Archived

ADMIN                  (collapsible, admin only)
  Monitoring           (activity)
  Users & roles        (users-round)
  Proposal templates   (file-text)
  Integrations         (plug)

──────────────
[CK] Cryssa Kate Aban · Employee      ▾   → menu: Settings · Sign out
```

- **Merged and moved:**
  - My Inquiries and Inquiries become **Inquiries** with *Mine / All* tabs. Default tab: *Mine* for employees, *All* for supervisors.
  - History and Archives become **Closed** with *Sent / Archived* tabs.
  - Notifications leaves the sidebar; the top-bar bell is the entry point (Phase 6).
  - Settings moves into the user menu.
  - Monitoring moves into the Admin group.
- **Visual fixes:**
  - Every item gets a distinct icon.
  - Counts appear only where they need action: the Approval queue count, and optionally Inquiries > Mine when items are waiting on the user.
- **Server mapping:**
  - The *Mine* tab requests the `My Inquiries` view; *All* requests `Inquiries`.
  - The *Sent* tab requests `History`; *Archived* requests `Archives`.

### 2.2 Visual treatment

- **Active item:** a subtle lighter-navy background, a 2px orange marker inset on the left, and white text. This replaces the solid burnt-orange fill. (An inset marker on a nav item is a selection indicator, not a decorative card stripe.)
- **Group labels:** one quiet style for WORK / RECORDS / ADMIN. No extra eyebrow labels anywhere else.
- **Layout:** a fixed header (brand) and footer (user), with only the nav list scrolling between them. This fixes the 1366×768 admin case where sign-out fell off-screen.
- **Desktop collapse:** optional (icons only, with tooltips), remembered per device in `localStorage` inside try/catch. Nice to have; can slip to after Phase 9.

### 2.3 Top bar

- **Breadcrumb:** "Inquiries / INQ-2026-00143" style, so the workspace shows where you are.
- **"LOCAL · TEST MAILBOX" badge:** keep it, but make it smaller and quieter. Hide it once live Gmail is connected.
- **Bell:** opens the notifications dropdown (Phase 6).
- **Avatar:** opens the same user menu as the sidebar footer.

### 2.4 Mobile drawer

- Keep the slide-in drawer, and add:
  - a backdrop that closes it on tap
  - Escape to close
  - focus kept inside the drawer while open, then returned to the menu button on close
- Close the drawer automatically after navigating.

### 2.5 Routing

- `go()` keeps writing hashes. Add `#inquiries/mine`, `#inquiries/all`, `#closed/sent` and `#closed/archived`.
- Map old hashes on load:
  - `#my-inquiries` → `#inquiries/mine`
  - `#history` → `#closed/sent`
  - `#archives` → `#closed/archived`
  - `#notifications` → open the full notifications page
  - `#settings` → Settings
- The "leave guard" for unsaved workspace edits must still run on every nav, tab and menu click.

**Done when:**
- Each role sees its expected item set (employee 5, supervisor 6, admin 5 + Admin group).
- Sign-out is visible at 1366×768 without scrolling.
- Old hashes land on the right tab.
- Unsaved-edit warnings still fire.
- The drawer works with keyboard and touch.

---

## Phase 3 — List pages (Inquiries, Closed, Approval queue)

### 3.1 Page header

- Title, a one-line description, then tabs directly under the title.
- **"Import agent form"** appears only on Dashboard and Inquiries, never on Closed or Approval queue.
- **Filters** show only when they mean something:
  - Closed > Sent: no status filter (search + division only).
  - Archived: a reason filter (Expired / Declined / Transferred) instead of statuses.

### 3.2 Table restyle (`InquiryTable`)

- **Flat rows:** a single 1px divider between rows, a hover tint and a full-row click target. No per-row boxes, no left stripes. Target row height about 64px, down from about 90px.
- **Columns:**
  1. **Account:** name, reference number underneath, and a small "Customized" tag when it applies.
  2. **Status:** pill plus the next step underneath.
  3. **Handler:** avatar initials and name, or "Available to pick up" / "On hold".
  4. **Agent:** name only.
  5. **Protection:** the countdown chip only ("18d left", "Not started", "Duplicate · on hold"). This splits the current "Agent protection" column.
  6. **Received:** date, with age underneath.
  7. **Updated:** relative time.
- Drop the **Division** column when every row on the page reads "Unconfirmed", or move division under the account name. Decide once real data has divisions.
- **Phone:** keep the existing card layout, but match the new style (no stripe, tighter spacing, protection chip in the top-right).

### 3.3 Approval queue

Same table, sorted oldest-first as now. Add a "Waiting" column showing time since submission, and give it emphasis after 24 hours.

### 3.4 Empty states

Use a message written for each view (see Phase 8).

**Done when:**
- Mine and All, plus Sent and Archived, show the same records the old pages did. Verify by comparing IDs against the old views on the QA data.
- Pagination still works.
- No horizontal page scroll at 390px.

---

## Phase 4 — Dashboard

1. **Queue count.** The badge uses `attentionCount` (8) while `attention` holds 7 rows for supervisors. In `workspace-query.ts`, either return the full list up to the display limit, or show "Showing 7 of 8 · View all". The badge must match what is visible.
2. **Action column.** Give it a fixed width so "Review proposal" fits inside the card. Use short labels: Continue / Open / Review / View.
3. **Agent column.** Remove the protection chip from under the agent's name (it lives on the Inquiries table now). Add a single "Yours" tag where the user is the handler.
4. **Stat strip.**
   - Keep the four numbers, but make each one a link to its filtered list (New, To prepare, Awaiting approval, Sent today). Part of this already exists.
   - Drop the amber dots, or use them only when a number needs attention.
5. **Your drafts.** Change from a 3-column card grid to a compact list: account, stage, saved time and a "Resume" button. This fixes the lone 4th draft and reads faster.
6. **Phone.** The queue becomes stacked cards (the same component as the Inquiries mobile cards) instead of a table cut off at the Status column.

**Done when:**
- The count matches the visible rows for every role.
- Nothing overflows at 1366px.
- At 390px every status and action is visible without sideways scrolling.

---

## Phase 5 — Inquiry workspace

### 5.1 One primary action, aware of the stage

Add a `NextAction` component in the right panel (and the sticky bottom bar on phones) that shows exactly **one** solid primary button, chosen from the record and user state:

| State | Primary button | Secondary |
|---|---|---|
| Nobody handling, user may handle | Start handling | View form |
| Colleague handling | — (shows "Handled by X · view only") | Request handover (if that flow exists) |
| Handling, step 1 | Continue to template | Save draft |
| Handling, step 2 | Continue to preview | Save draft |
| Handling, step 3 | Send for approval | Save draft |
| Awaiting approval, supervisor | Approve | Edit before approval · Return for correction |
| Awaiting approval, employee | — ("Waiting for supervisor") | — |
| Sent | Download email | Open PDF |
| Duplicate / identify client | Open existing inquiry / Identify client | — |

- Reuse the existing guards and lock messages (`actionLock`, `canEditInquiry`, `clientBlocked`). This is a presentation change only.
- **Phone:** the sticky bar shows the same single action. "Start handling" is no longer buried under the overview.

### 5.2 Step bar

- Work out step completion from the record's status as well as local state:
  - Once a version is submitted, *Review form* and *Choose template* both show as done.
  - "Choose template" currently relies only on `!!selected`, which is why it looks undone on submitted proposals.
- Keep the three steps, but make clicking a disabled step explain why ("Start handling to choose a template").

### 5.3 Layout

- **Right panel order:**
  1. Next action (5.1)
  2. Handler status
  3. Client protection chip
  4. Submitted form
  5. Inquiry overview (client, agent, division, received)
  6. Activity & versions
- Fix the empty gap under "Client protection & progress reports". Make it a compact one-line row with the shield icon, the agent name and "30 days starts after the reply is sent".
- Remove the duplicated agent in the key details grid; it is already shown in the overview.
- Move "Close this request / Decline request" into a quieter "More actions" menu or the page footer, with the confirm dialog kept.
- **PDF preview failure:**
  - Show "The preview couldn't load. Open the PDF, or try again."
  - Log the technical detail to the server only.

### 5.4 Supervisor review

- Group Approve / Edit before approval / Return for correction as one action block.
- Approve is the only solid button.
- "Approval sends this version to the agent" stays directly under it.

**Done when:**
- Every row in the table above shows exactly one solid button, checked on QA records in each state.
- The step bar is correct for New, Preparing, Awaiting approval and Sent.
- On phone, the main action is visible without scrolling.
- The existing handling-lock, stale-write and supervisor-edit tests still pass.

---

## Phase 6 — Notifications

1. **Bell dropdown** (top bar):
   - shows the latest 6 notifications, with unread first
   - "Mark all as read" and "See all" links
   - opening a notification marks it read and opens the inquiry (same as now)
2. **Full page:** kept and reached from "See all". It is not a sidebar item.
3. **Types with their own icons and colors:**
   - New inquiry
   - Duplicate / on hold
   - Needs correction
   - Approved
   - Reply sent
   - Draft reminder ("Pick up where you left off")

   Map these from the existing notification titles in a small helper. If titles vary, add a `kind` field when notifications are created; old rows fall back to "general".
4. **Unread state:** a dot plus a light tint background instead of the left stripe.
5. **Grouping:** by day ("Today", "Yesterday", dates). Add an *Unread only* toggle.

**Done when:**
- Unread counts match on the bell and the page.
- Reading a notification in the dropdown updates the count without a reload.
- Each type is recognizable without reading the title.

---

## Phase 7 — Admin, Monitoring and Settings

- **Monitoring:**
  - Five service cards in one even row on desktop, or 3 + 2 with matched widths.
  - Status is shown by icon and label color; no left stripes.
  - "Last checked" sits next to the "Run connectivity checks" button.
- **AI usage:** keep the three numbers, but show one sentence instead of empty boxes while AI is in test mode ("AI is in test mode; no paid requests yet").
- **Users & roles, Proposal templates, Integrations:** apply the new table and button styles. No behavior changes.
- **Settings:** already the cleanest page. Apply the tokens, and put the shield icon next to the heading or drop it.

---

## Phase 8 — Copy, empty states and test data

- **Empty state messages** by view (`Empty` gets a `hint` prop):
  - Inquiries > Mine: "Inquiries you start or edit will show here."
  - Inquiries > All: "No inquiries yet. Import an agent form to start."
  - Approval queue: "Nothing waiting for approval."
  - Closed > Sent: "Sent proposals will show here."
  - Closed > Archived: "Expired, declined and transferred requests will show here."
- **Errors:** never show "check the server log" to staff. Map server errors to plain-language messages with a retry option, and keep the details in the server log only.
- **Test data before any client demo:**
  - Remove or reword the profane correction note on INQ-2026-00126.
  - Make sure every test record is clearly marked `[TEST]`, or clear them out.
- **Terms:** use the same names everywhere. "Proposal template" vs "proposal master" vs "reference": pick one for staff-facing text (suggested: *proposal template*).

---

## Phase 9 — QA, cleanup and handover

1. **Update browser tests** that click by the old labels or hashes (`My Inquiries`, `History`, `Archives`, sidebar `Notifications`, `Settings`). Check them with: `grep -l "My Inquiries\|Archives\|History" scripts/test-*.mjs`.
2. **Add `scripts/test-revamp.mjs`.** It logs in as employee, supervisor and admin on the QA server and checks:
   - the sidebar items for each role
   - old-hash redirects
   - exactly one solid primary button in the workspace for each state
   - the dashboard count matches its rows
   - no horizontal scroll at 390px
   - sign-out visible at 1366×768

   It also saves screenshots to `test-results/revamp/`.
3. **Run everything:** typecheck, build, `npm run test:workflow` and the existing browser test groups, all against the QA data folder.
4. **Accessibility pass:**
   - contrast on muted text and pills
   - keyboard through the sidebar, tabs, dropdown and workspace actions
   - reduced motion for the drawer and dropdown
5. **Cleanup:**
   - delete `operations-mockup.css` once emptied
   - remove dead CSS for the removed nav items
   - count the remaining `!important` rules
6. **Handover:** write `REVAMP_NOTES.md` in the same format as `MOCKUP_UI_REFINEMENT.md`:
   - what changed
   - the rollback tag and files touched
   - validation results
   - screenshots

---

## Decisions needed before starting

1. **Primary action color:** navy (recommended; orange stays as brand accent) or orange?
2. **Approval queue:** a separate sidebar item for supervisors (recommended), or a third tab inside Inquiries?
3. **Default Inquiries tab:** *Mine* for employees and *All* for supervisors (recommended), or *All* for everyone?
4. **Name for finished work:** "Closed" (recommended), "Completed" or "Records"?
5. **Desktop sidebar collapse to icons:** include now, or after the revamp?
6. **Test data:** clear the `[TEST]` inquiries before the client demo, or keep them clearly labeled?

## Suggested order and checkpoints

1. Phases 0–1 → screenshot review → *you approve the look*.
2. Phase 2 (sidebar) → screenshot review.
3. Phases 3–4 (lists + dashboard).
4. Phase 5 (workspace) → full workflow test with all three roles.
5. Phases 6–8.
6. Phase 9 → handover notes, then demo to RMC2.
