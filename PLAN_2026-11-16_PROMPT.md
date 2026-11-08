## Objective
Make coverdesk (RMC2 Franchising System) a full working system by **Monday 2026-11-16**. On that day staff start dry runs of real work. Every user-facing flow has to work end to end, so only minor issues should appear. The work is: run the final check, close the gaps that block real use, and add five small features (listed under Target State).

## Context (carry forward, all decided by the PO on 2026-11-08)
- Repo: `D:\Codes\coverdesk`, branch `phase-4-postgres`, Next.js on Vercel plus Supabase Postgres. Read `AGENTS.md` (this Next.js version has breaking changes, so check `node_modules/next/dist/docs/` before writing Next code). Then read `REMAINING_WORK.md`, `TEAM_DECISIONS.md` and `MIGRATION_PLAN.md`.
- The test version is https://rmc2-test-yiizer.vercel.app. After every commit: `npm run build`, deploy a Vercel preview, re-alias rmc2-test, run a read-only smoke check.
- **The Monday dry runs:**
  - Staff process real inquiries in parallel with the old process. The old process stays the official one.
  - All outgoing mail goes to the staging redirect, so nothing reaches a real agent. Inbound import stays on.
  - Switching to live sending is a separate step later, and needs the PO's approval.
- **Dry-run data is wiped at cutover.** Only the client directory and the accounts are kept.
- **The final-check gate moves to this week.** All of `REMAINING_WORK.md` §0 ("Built but never tested") and §2 ("Final check": QA regression, code-review majors and minors, security, data hygiene). This reverses the 2026-11-07 deferral. Record that in `TEAM_DECISIONS.md` as your first edit.
- **Out of scope this week:**
  - Supabase Auth (phase 6)
  - live AI or OCR
  - an agent-facing portal
  - production cutover (phase 8)
  - new paid services
- postgres.js: write jsonb with `tx.json(obj)`, never `JSON.stringify(...)::jsonb`.
- The Head is Emerson Dolf Fernandez.

## Target State
1. **§0 and §2 of `REMAINING_WORK.md` are done.** Every item is either passed with evidence, fixed and re-tested, or written down as a known minor issue with a reason.
2. **Phase 5 large files work online.** Signed uploads and downloads for files over 4.5 MB (PDFs, .eml files, templates).
3. **The Head's division editor screen is built.**
4. **Real per-person staff accounts exist on the test version.**
   - Each one has a random password and is forced to change it on first sign-in.
   - The demo accounts are disabled.
   - The §1 sharing checklist is done.
5. **"Report a problem" button.**
   - It is on every staff and owner screen, and the user types a short description.
   - The report also saves the page, the role, the inquiry id when there is one, the app version and the time.
   - The Admin/Head see the reports in a list with a status (new, in progress, fixed).
   - Storage needs a migration file, which is written but **not applied** until the PO approves it.
6. **Error tracking** with a free tier or the observability already in Vercel. No new paid account without approval.
7. **Show/hide password toggle.**
   - On the login form (`app/operations-app.tsx`, the `ops-login` form) and on every other password field: the account settings in `operations-accounts.tsx` and `operations-administration.tsx`, and `operations-owner-team.tsx`.
   - It is a real `<button type="button">` with `aria-label` "Show password"/"Hide password" and `aria-pressed`.
   - Showing the password never changes the autocomplete attributes.
   - Also fix the login badge, which says "LOCAL TEST ENVIRONMENT" online.
8. **Dark mode.**
   - Choices are Light, Dark and System, with System as the default. The choice can be made in Settings and on the login screen, and is saved per device (wrap localStorage in try/catch).
   - No light flash on load: set the theme before the first paint.
   - Colours today come from `:root` tokens in `app/globals.css` and `app/operations-tokens.css`, but about 538 hex values are hardcoded across 33 CSS files. Move them to tokens first, then add a `[data-theme="dark"]` set.
   - Proposal and document previews, the PDF viewer, and generated PDFs/Word files **stay light**.
   - Text and controls meet WCAG AA contrast in both themes.
9. **The Reply-To warning.** Show "Reply-To differs from From" on the To line of emailed inquiries.

## Order of work and freeze
- **Days 1–2 (2026-11-09 and 11-10):**
  - record the decision
  - push `phase-4-postgres` as a backup (do not merge)
  - run the §0 click-throughs on the test version
  - triage the failures
  - small fixes: items 7 and 9, the badge
- **Days 3–4 (2026-11-11 and 11-12):** items 2, 3, 5, 6 and 8, plus fixes from triage. Ask the client for the email signature and the branch answers by 2026-11-11. Without them these ship as known gaps.
- **Feature freeze at the end of 2026-11-12.** After that, only bug fixes.
- **Days 5–6 (2026-11-13 and 11-14):** §2 regression (Postgres stress tests T1–T10, code-review majors, security items) and the online checks at 1440, 1366 and 375 px. Then items 4 and 1.
- **Day 7 (2026-11-15):** a full click-through of every flow in both themes, the smoke check, and the handover report.

## Scope
- Work in: `app/`, `components/`, `lib/`, `hooks/`, `scripts/`, `supabase/migrations/` (new files only) and the planning docs (`REMAINING_WORK.md`, `TEAM_DECISIONS.md`, `PROJECT_GUIDE.md`).
- Do NOT touch:
  - `.env*` files and secrets
  - `vendor/`, `converter/` and `resources/` (the proposal masters)
  - `package-lock.json`, except through an approved dependency install
  - production Vercel or Supabase projects

## Constraints
- Follow the existing conventions: `ops-` CSS classes, tokens, and the existing API route patterns.
- No new dependencies without asking.
- Deliver what is listed. No other features, refactors or abstractions.
- Delegate only independent, sizeable work to the specialists in `~/.claude/agents/`:
  - dark-mode token migration: frontend-developer
  - signed uploads: backend-developer
  - report-problem storage: database-engineer
  - the final check: qa-engineer, code-reviewer, security-engineer
- Two agents never edit the same file. Check their diffs and test output yourself before you call anything done.
- Every new screen handles the loading, empty, error and no-permission states.

## Acceptance Criteria
- [ ] Every §0 item is marked pass or fail, with evidence (a script result, a screenshot path, or a smoke-check line).
- [ ] Code-review majors M1/M2 are closed, and migration 400 is applied after approval.
- [ ] Migration 500 (security hardening) is applied after approval.
- [ ] A 7 MB and a 15 MB file upload and download on the test version.
- [ ] A test user can file a problem report, and the Head sees it in the list.
- [ ] The password toggle works by mouse and keyboard on every password field, and the field goes back to hidden after sign-in.
- [ ] Dark, Light and System all work on every screen at 1440 and 375 px.
- [ ] Dark mode has no unreadable text, no light flash on load, and documents/PDFs still render light.
- [ ] `npm run build`, `npm run typecheck` and the validation scripts in `README.md` pass. Any older failing script is listed as stale with a reason.
- [ ] The test version smoke check passes after the last deploy.

## Action Boundaries
- Go ahead without asking with: reading, editing in scope, local tests, commits on `phase-4-postgres`, preview deploys, the rmc2-test alias, and read-only online checks.
- **Stop and ask the PO before:**
  - applying any migration (one file at a time, never `db push`)
  - generating or using VAPID keys (phone push is only in scope if the PO approves them)
  - sending any email that isn't caught by the staging redirect
  - creating any outside account (error tracking included)
  - deleting a file, including `app/franchise-workspace.tsx`
  - adding a dependency
  - merging into `main`
  - anything that touches production
- If one fix fails twice in a row, stop and report it. Don't loop.

## Progress Evidence
- At the end of each day, update `REMAINING_WORK.md` with: what changed, what was verified (local or online), what wasn't checked, and the deployment URL.
- Report findings in three groups: passed, failed, not run. Say which checks were mocked and which were live.
- Base every "done" on a tool result.
- On 2026-11-15, write the final handover: known minor issues, the dry-run instructions for staff, and the steps to switch on live sending.
