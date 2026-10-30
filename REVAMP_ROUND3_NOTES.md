# UI revamp, round 3 — October 30, 2026

Follows `RMC2_Client_Directory___Revamp.pdf`, with the grouped sidebar from round 2 kept as requested.

## Changes

**Colors (from the PDF)**
- **Main buttons:** burnt orange `#c3410c` with white text (5.2:1 contrast), e.g. Import agent form, Start handling, Continue, Approve.
- **Sidebar:**
  - navy `#0d2142`
  - active item is solid burnt orange with white text
  - counts are orange
  - the collapse button is kept
- **Canvas and panels:** canvas `#f7f8fc`; panels use the Client Directory side-panel neutrals.

**Clickable rows**
- **Dashboard inquiry queue:** the whole row opens the inquiry. There are no buttons; the row shows a hover tint, the name turns orange and a chevron appears. Keyboard: Tab to a row, Enter or Space opens it.
- **Agent column:** shows a plain protection note ("Protection not started", "Protection 18d left", "On hold · duplicate client").
- **Your drafts:** the whole row opens the draft, with a chevron (no Resume button).

**Inquiry page (PDF layout)**
- **Header:**
  - breadcrumb "Inquiries / INQ-…"
  - title
  - status line with "INQ · Received <date>"
- **Not handling:**
  - With nobody handling, a full-width amber banner reads "Nobody is handling this inquiry", with an orange **Start handling** button.
  - With a colleague handling, the banner reads "<name> is handling this inquiry · view only".
- **While handling:** the header shows "● Handling: you" and **Release to queue**, which replaces Save & release (same behavior: saves the draft and frees the inquiry).
- **Steps:** step cards with a status line under each step:
  - "Details confirmed"
  - "Standard selected" / "Not chosen yet"
  - "Waiting for approval" / "Sent to agent"
- **Inquiry card (right):** client, agent, division, received, agent protection, handling, the submitted form with View, and Activity & versions.
- **Sticky bottom bar:**
  - **⋯ More:** view form, edit details, request missing details, open PDF/Word, activity.
  - **Save draft:** renamed from Save changes.
  - **Main action on the right**, disabled with "Start handling to continue." until you handle the inquiry.
  - **Supervisors** get Return for correction, Edit before approval and **Approve** in the bar.
- **Topbar:** shows just "Inquiries" on this page, because the page has its own breadcrumb.

**Line endings**
- Files that originally used Windows line endings (CRLF) are written back with CRLF again. This includes files from round 2 that had been changed to LF, so git diffs show only real changes.

**Tests**
- `test-revamp.mjs`: Start handling is now looked for in the banner; the bar's main action must be disabled until handling starts.
- Other browser tests: text updated to "Handling: you" and "Release to queue".

## Verification (separate copy, QA data only)

- TypeScript and the production build passed.
- `scripts/test-revamp.mjs` passed all 8 groups, including no horizontal overflow at 1440, 1366 and 390 wide, and no browser errors.
- Screenshots were checked at desktop and phone sizes for employee and supervisor.
- **Lint:** `operations-workspace.tsx` gains React-compiler warnings of the same kind it already had ("refs during render"); they don't affect the build.
- **Not run here:** the other browser tests (they need your isolated 5190 server and fixtures).

## Rollback

- **Previous versions:** every file this round replaced was saved first under `test-results/revamp-round3/baseline/`.
- **New file:** `app/operations-action-bar.tsx`.
