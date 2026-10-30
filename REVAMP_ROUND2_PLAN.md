# UI revamp, round 2 — colors, buttons, sidebar, directory pattern

Prepared 29 October 2026 after reviewing the updated build on `http://127.0.0.1:5193`. It builds on `REVAMP_PLAN.md`; the decisions below replace that plan's "navy as main action" recommendation.

## What the current build shows

- **Orange is almost gone.** Sign in, Import agent form, every Continue and Start handling are navy. Orange only survives as a thin active marker in the sidebar and on the step number.
- **Buttons don't tell you what's going on.** Almost everything is either navy-solid or white-outline, so nothing signals "available", "yours" or "waiting".
  - The right panel ("Continue to template", "View form", "Handling: you", "Done for now") has no color cue for handling.
  - On the Dashboard, your own inquiry ("Yours") gets the *weaker* outline Continue while other people's get solid buttons. It should be the opposite.
- **The old handling colors were lost.** Start handling used to be solid blue (`#2459a6`), Done for now solid green (`#0f6b61`), your handling badge green and a colleague's amber.
- **The sidebar has no collapse button.**
- **Client Directory works well:**
  - search, filters, sort and columns in one toolbar
  - status tabs with counts
  - a details side panel
  - the table scrolls inside its card

  This is the direction to copy.
- **Smaller issues:**
  - The protection block on the inquiry page is centered and floats in empty space.
  - "Open in your other tab" sits alone with no context.

## Decisions

| Topic | Decision |
|---|---|
| Orange | **Back as the main action color.** Navy stays for the shell and secondary buttons. |
| Color indicators | One shared system for status pills, handling state, protection countdown and notification types |
| Start handling | **Solid blue**, as before (means "available to pick up") |
| While handling | **Green handling card** ("You're handling this") with a green-outline **Save & release** button. Orange stays the only solid button. |
| "Done for now" | Renamed **Save & release** (saves the draft and frees the inquiry for colleagues). Behavior unchanged. |
| Sidebar | Collapse button to icon-only rail; remember the choice on that computer; auto-collapse on the inquiry page |
| Directory pattern | Reuse on **Inquiries, Closed and Approval queue** |

## 1. Color system

### Contrast check (white text unless noted)

| Color | With white text | With navy `#0a2047` text |
|---|---|---|
| Brand orange `#ff791f` | 2.6:1 ✗ | **6.1:1 ✓** |
| Burnt orange `#c2410c` | **5.2:1 ✓** | 3.1:1 |
| Blue `#2459a6` | **6.9:1 ✓** | — |
| Green `#0f6b61` | **6.4:1 ✓** | — |

The old bright orange buttons with white text were hard to read (2.6:1; the readable minimum for normal text is 4.5:1).

**Recommended main button:** brand orange `#ff791f` fill with **navy bold text**. It keeps the iconic RMC2 orange and matches the logo (orange + navy). Hover darkens to about `#f06a0f`.

**Alternative:** burnt orange `#c2410c` with white text, if white text is preferred. It's darker and less "iconic".

### Tokens (in `operations-tokens.css`)

**Brand / action**
- `--action` `#ff791f`
- `--action-hover` `#f06a0f`
- `--action-ink` `#0a2047`
- `--shell` `#0a2047`
- `--secondary-ink` `#0a2047`

**Handling**

| State | Fill | Tint | Ink |
|---|---|---|---|
| Available | `#2459a6` | `#eaf1fb` | `#1d4b8f` |
| You | `#0f6b61` | `#e7f5ef` | `#11633b` |
| Colleague | — | `#fff2dc` | `#885314` |

**Status** (text color + tint pairs)

| Status | Color |
|---|---|
| New inquiry | blue |
| Preparing | amber |
| Awaiting approval | violet |
| Needs correction | red |
| Sent | green |
| On hold / duplicate | red outline |
| Archived / closed | gray |

**Protection countdown**

| State | Color |
|---|---|
| More than 7 days left | green |
| 7 days or less | amber |
| Expired / duplicate hold | red |
| Not started | gray |

**Notification types** (icon + color)

| Type | Color |
|---|---|
| New inquiry | blue |
| Duplicate / hold | red |
| Needs correction | red |
| Approved | violet |
| Reply sent | green |
| Draft reminder | amber |

### Rules

- **Color plus another cue, always.** Every color is paired with an icon or label (dot + text, icon + text), so meaning never depends on color alone.
- **Reserved meanings.**
  - Orange is never a status color; it only means "do this next".
  - Green appears only for "yours / sent / plenty of time".
  - Red only for problems.
- **One legend.** Add a small "What the colors mean" popover (an info icon on Inquiries) for new staff.

## 2. Buttons

| Level | Look | Used for |
|---|---|---|
| Main | Orange fill, navy bold text | The one next step on a screen: Continue, Send for approval, Approve, Import agent form, Sign in |
| Start handling | Blue fill, white text | Only when an inquiry is available to pick up |
| Secondary | White fill, navy 1px border, navy text | View form, Open PDF, Filters, View all |
| Handling secondary | White fill, green border, green text | Save & release |
| Quiet | Text only, navy, underline on hover | Back, Show details, Cancel |
| Danger | White fill, red border, red text | Decline request, Remove |

- **One main button per area.** At most one orange button per panel or card. List rows show orange only on rows that are yours or need your action.
- **Dashboard queue.**
  - Your own inquiry ("Yours"): orange **Continue**.
  - Others available: blue-outline **Pick up**.
  - Colleague handling: secondary **View**.
- **Same height everywhere.** 40px desktop, 44px phone, for every level.

## 3. Inquiry page right panel

| State | Panel content (top to bottom) |
|---|---|
| Nobody handling | Gray note "No one is handling this" → **Start handling** (blue) → View form (secondary) |
| You're handling, step 1 | **Green card**: ✓ "You're handling this · draft saved 2m ago" + **Save & release** (green outline) → **Continue to template →** (orange) → View form |
| You're handling, step 2 | Green card → **Continue to preview →** (orange) |
| You're handling, step 3 | Green card → **Send for approval** (orange) |
| Colleague handling | **Amber card**: 🔒 "Cryssa is handling this · view only" → View form |
| Awaiting approval (employee) | Violet note "Waiting for supervisor" |
| Awaiting approval (supervisor) | **Approve** (orange) → Edit before approval · Return for correction (secondary) |
| Sent | Green note "Sent to agent · date" → Download email (secondary) |

Also:
- Replace "Open in your other tab" with a clear line inside the green card ("Also open in another tab"), or remove it.
- Make the protection block a compact left-aligned row: shield icon, agent name, countdown chip.

## 4. Collapsible sidebar

- **Toggle button.** A collapse/expand button at the top of the sidebar next to the logo (chevron icon with `aria-expanded`). Keyboard shortcut `[` optional.
- **Collapsed state.** A 72px icon rail:
  - logo mark only
  - icons with tooltips on hover and keyboard focus
  - badges become small dots
  - user avatar at the bottom opens the user menu
- **Remember the choice.** Save it in `localStorage` (wrapped in try/catch; if storage is blocked, default to expanded).
- **Auto-collapse on the inquiry page.**
  - Opening an inquiry collapses the sidebar for that page only, without overwriting the saved preference.
  - Leaving the page restores the saved state.
  - If the user expands it manually on the inquiry page, respect that until they leave.
- **Phone.** Unchanged: the slide-in drawer.
- **Content width.** The main content uses the freed space (wider form and PDF preview). No layout jump: animate width with a short ease-out, and turn it off for reduced motion.

## 5. Reusing the Client Directory pattern

Extract shared pieces from `operations-directory-*` into reusable components first, then apply them:

- `ListToolbar`: search, Filters (with count), Sort, Columns
- `StatusTabs`: tabs with live counts
- `DetailPanel`: right side panel with prev/next/close
- The table-in-card with internal scroll and pagination

| Page | Tabs | Side panel |
|---|---|---|
| Inquiries | Mine · All · To prepare · Awaiting approval · On hold (with counts) | Inquiry preview: status, handler card, protection, key details, **Open inquiry** (orange) |
| Closed | Sent · Archived (with counts) | Sent version, email, archive reason |
| Approval queue | Waiting · Returned (with counts) | Proposal summary; **Review** (orange) opens the full page |

- Clicking a row opens the side panel. Double-click or "Open inquiry" goes to the full workspace.
- Columns follow the Directory default (4–5 key columns), with more under Columns.

## 6. Skills to use while building

- **web-design-skill-router** → lead skill: **impeccable** (existing interface).
  - `colorize` for the token system and indicators
  - `layout` for the right panel and sidebar
  - `polish` and `audit` for the final pass: contrast, keyboard, phone width
- No other design lead skills, to avoid conflicting styles.

## 7. Phases

| # | Work | Main files | Hours |
|---|---|---|---|
| A | Color tokens + button levels; replace navy main buttons with orange; restore blue/green handling colors; status/protection/notification palettes; legend popover | `operations-tokens.css`, `operations.css`, `operations-common.tsx`, `operations-activity.*`, `operations-client-protection.*` | 10–16 |
| B | Right panel states (table in Section 3); Save & release rename; protection row; Dashboard queue button logic | `operations-workspace.tsx/.css`, `operations-activity.tsx`, `operations-dashboard-queue.tsx` | 8–14 |
| C | Collapsible sidebar (rail, tooltips, remember, auto-collapse on inquiry page) | `operations-app.tsx`, sidebar CSS | 6–10 |
| D | Extract Directory components; apply to Inquiries, Closed, Approval queue | `operations-directory-*.tsx`, `operations-app.tsx` | 14–24 |
| E | QA: contrast check of every token pair, keyboard, 1440 / 1366×768 / 390 screenshots, update browser tests for renamed button and new tabs | `scripts/test-*.mjs` | 6–10 |
| | **Total** | | **≈ 44–74 h** |

Work on the QA server (port 5193/5194 test data), never the real `.data` database. Take a git tag before Phase A.

## 8. Still to confirm

1. **Main button text color.** Navy on bright orange (recommended, iconic and readable) or white on burnt orange?
2. **Shortcut.** A keyboard shortcut for the sidebar toggle, or button only?
3. **Inquiries default tab.** *Mine* for employees, *All* for supervisors (as in `REVAMP_PLAN.md`)?
