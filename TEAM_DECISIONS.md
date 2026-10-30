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

## Process

- Team roles live in `~/.claude/agents/`; playbook: `D:/AI-Skills/AI_TEAM_PLAYBOOK.md`.
- Plan → Product Owner approval → implement with file ownership → QA + code review → report.
- Specialists' "done" is not verification; the lead checks evidence (diffs, test output, screenshots).
