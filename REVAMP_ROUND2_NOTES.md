# UI revamp, round 2 — October 29, 2026

Implements `REVAMP_ROUND2_PLAN.md`: orange is back as the main action color, there are clear color indicators for handling, a collapsible sidebar, and the Client Directory layout on Inquiries, Closed and the Approval Queue.

## What changed

**Colors and buttons** (`operations-tokens.css`)
- **Orange main buttons.** Main actions (Continue, Send to supervisor, Approve, Import agent form, Open inquiry) use RMC2 orange `#ff791f` with bold navy text. Navy on this orange measures 6.1:1; white on it fails (2.6:1).
- **Blue means available.** Start handling is solid blue. "Pick up" in the dashboard queue is a blue outline. The "Available" tag in lists is blue.
- **Green means yours.** While you handle an inquiry, a green card shows "You're handling this inquiry". It holds a green-outline **Save & release** button, which replaces "Done for now" (same behavior: saves the draft and frees the inquiry). Save changes and the "Yours" tag are green too.
- **Amber means a colleague is handling it.** The card reads "<name> is handling this inquiry · view only".
- **Other button levels.**
  - Secondary: white with a navy outline.
  - Danger: red outline.
  - Disabled: gray.
- **Notifications.** "Approved" notifications are now violet, so they're distinct from "sent" (green).
- **Color legend.** A "Colors" button on every list explains buttons, handling, status and protection colors.
- **Contrast.** Every new text/background pair is 5.0:1 or higher.

**Inquiry page right panel** (`operations-next-action.tsx`, `operations-activity.tsx/.css`, `operations-workspace.tsx`)
- **Order:** handling card, then one main button, then secondary buttons.
- **Arrows:** Continue to template / Continue to preview show an arrow.
- **Sent inquiries:** Download email is a secondary button.
- **Protection block:** on the review step it's left-aligned.

**Dashboard queue** (`operations-dashboard-queue.tsx`)

| Situation | Button |
|---|---|
| You're handling it, or supervisor decision | Orange **Continue** / **Review** |
| Free to pick up | Blue-outline **Pick up** |
| A colleague is handling it, or on hold | Secondary **View** |

**Collapsible sidebar** (`operations-shell.tsx/.css`)
- **Collapse button:** next to the logo. It shrinks the sidebar to a 72px icon rail with tooltips on hover and keyboard focus. Counts become small badges, and the account menu opens to the side.
- **Remembered:** the choice is saved on that computer (`localStorage`, safe if storage is blocked).
- **Inquiry page:** it collapses automatically there without changing the saved choice. Expanding it manually on that page is respected until you leave.
- **Active item:** orange marker and orange icon. The Approval Queue count is orange.
- **Phones:** keep the slide-in drawer. Opening it now focuses the first visible item.

**Lists in the Client Directory style** (new `operations-inquiry-list.tsx/.css`)
- **Inquiries tabs, with live counts:** Mine · All · To prepare · Awaiting approval · On hold. Employees start on Mine; supervisors and admin on All.
- **Closed tabs:** Sent · Archived.
- **Approval Queue tabs:** Waiting · Returned for correction.
- **Toolbar:**
  - search
  - Filters (status/reason + division, with a count)
  - Sort: newest, oldest, recently updated, account A–Z
  - Columns (choice remembered per list)
  - Colors
- **Rows:** clicking a row opens the inquiry, as before. The preview icon at the end of each row opens a side panel showing:
  - status
  - handling card
  - next step
  - protection
  - key details
  - an orange **Open inquiry** button

  Up/down arrows move between inquiries; Escape closes.
- **Phones:** each row becomes a card.
- **Server** (`lib/operations/workspace-query.ts`, `types.ts`):
  - optional `sort` query value
  - `tabCounts` for list views
  - a `Returned Proposals` view (status *Needs correction*)

  No schema, permission, workflow or data changes.

**Tests updated:**
- **Renamed button:** "Done for now" → "Save & release".
- **New text:** "Handling: you" → "You're handling this inquiry".
- **New selectors:** list rows use `.ops-inq-table`, and the `revamp-navigation.mjs` tab helper looks in `.dir-status-filters`.
- **Main-action check:** `test-revamp.mjs` now checks `.ops-next-main` (exactly one main action) rather than the orange class, because Start handling is blue by design.

## Not changed

- `operations-inquiry-table.tsx` and `operations-lists.css` are no longer imported but were left in place. Delete them once you're happy.

## Verification (in a separate copy, QA data only)

- TypeScript and the production build passed. There were no new lint errors in the changed files.
- `scripts/test-revamp.mjs` passed all 8 groups against the new build: role navigation and default tabs, legacy hashes, Closed filters, mobile drawer focus, per-state main actions (including employee/supervisor/admin and phone), notifications, no browser errors, and no horizontal overflow at 1440, 1366 and 390 wide.
- Screenshots were checked at 1440×900, 1366×768 and 390×844 for employee, supervisor and admin. They are in `test-results/revamp-round2/screens/`.
- **Not run here** (they need the 5190 isolated server and fixtures on your PC): the other updated browser tests (`test-exclusive-handling`, `test-workspace-*`, `test-activity-scroll`, `test-conflict-revamp`). Run them before relying on this build.

## Rollback

- **Baseline copies.** The pre-change version of every file this round modified is saved under `test-results/revamp-round2/baseline/` (same relative paths). To undo one file, copy it back from there.
- **New files.** Delete `app/operations-inquiry-list.tsx` and `app/operations-inquiry-list.css` only if you restore `app/operations-app.tsx` too.
- **No git.** Nothing was committed or tagged in git.
