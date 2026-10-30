# UI revamp — October 29, 2026

## Changes

- One shared palette and IBM Plex Sans for the interface. Navy primary actions, orange navigation/focus accents, consistent status colors, readable muted text and outlined secondary actions. Original proposal-document typography is retained.
- Navigation groups work and records. Inquiries contains Mine/All, Closed contains Sent/Archived, supervisors keep Approval Queue, and administrators have a collapsible Admin group. Settings and Sign out are in the account menu; the account footer stays visible on laptop screens.
- Legacy hashes redirect to their new tabs. Navigation retains the existing save-before-leaving guard. The mobile drawer supports Escape, focus containment and focus return.
- Inquiry tables use flat rows with separate Handler, Agent and Protection columns. Approval Queue shows time waiting. Closed removes irrelevant import/status controls and offers archived-reason filtering.
- Dashboard counts match the rows shown, with the total stated separately. Row actions fit their column, drafts use a compact list, and phone rows become cards.
- The inquiry workspace has one stage-aware Next action. Handling, preparation, submission, supervisor approval and download actions reuse their existing guards. The same control stays visible at the bottom on phones. Submitted proposals show the first two steps complete. Decline remains in an explicit footer or duplicate-review section.
- The bell opens up to six notifications, unread first. The full page supports day grouping and unread-only viewing. Notification navigation honors failed-save blocking before marking a notification read.
- Monitoring uses evenly sized cards and a compact AI test-mode explanation. Settings and admin controls use the shared styling.
- PDF preview failures and unexpected API failures use plain-language messages. Technical server failures remain in the server log. Obsolete shell/notification styles were removed, and `operations-mockup.css` was replaced by `operations-dashboard.css`.

## Scope and decisions

Navy actions, a separate supervisor queue, Mine as the employee default, All for supervisors/admin, and Closed for finished records follow the plan's recommended choices. Optional desktop icon collapse is deferred. Existing sample records are retained.

No schema, authentication, matching, ownership, approval, document-generation, source-template or live-service changes. Server changes are limited to an internal Expired filter for paginated Archives, the requested plain-language error mapping, and consistent proposal-template wording. Dashboard counts were corrected in the interface using the existing total and visible records, so no dashboard endpoint change was necessary.

The UI stylesheet count is **19 `!important` declarations**: 18 retained for document editing/rendering and one print visibility rule. Document styles and source colors are deliberately separate from interface tokens.

## Rollback checkpoint

Before editing, all tracked source and non-ignored untracked source, including uncommitted changes, were saved in local Git tag **`local-revamp-baseline-20261029-220506`**, commit **`37780e9ee50e55622528f47c3d7e25dfd9f11948`**. The working branch and index were not reset or committed.

Consistent database backups:

- `test-results/revamp/baseline/real.sqlite` — original `.data/rmc2.sqlite`.
- `test-results/revamp/baseline/test.sqlite` — the user's existing port 5193 test database.

The exact added, removed and modified files and normalized content hashes are in `test-results/revamp/rollback-files.json`. This distinguishes this revamp from earlier uncommitted work.

To revert, first save any newer work. Restore only the manifest's previously existing files with `git restore --source=local-revamp-baseline-20261029-220506 --worktree -- <paths>`. Remove only its newly added files after checking they have no subsequent edits. Rebuild and restart. Do not reset the entire repository or overwrite newer database records. Source rollback does not require database rollback.

## Validation

All test writes use `test-results/revamp/qa-data` on port **5194**. Port **5193** retains `test-results/directory-revamp/design-data` for user testing. No paid AI, CloudConvert or live email calls are used.

Final regression results are recorded below. Per-phase builds, browser results and role screenshots are under `test-results/revamp/phase1` through `phase8` and `final-build`.

- TypeScript and production build: passed for all phases and final cleanup.
- Existing workspace browser groups: nine passed per completed phase, covering duplicate/BOR review, mobile controls, original form, template selection and preview, handling locks, optional checks and decline-to-archive.
- Full lifecycle: **54 checks passed**, including all **11 active templates**, exact approved PDF/email bytes, immutable versions, correction/resubmission, stale decisions and send retry. Retired templates remain available as source history and are excluded from new generation tests.
- Directory API/browser regression: **9 groups passed**. Historical-review and agent-transfer API regression: **8 groups passed**.
- Customized workflow browser regression: **9 groups passed**, including table fit, byte-identical preview/prepared PDF, supervisor edits creating a new version, discard, required custom review, correction flags and local-test delivery.
- Final UI regression: role navigation, legacy hashes, visible counts, keyboard focus, state-aware actions and notification save guards passed, including admin and archived view-only states. The final screenshot set contains **45 images**.
- Short-screen editor regression: **2 groups passed**. Fields and actions remain usable, the PDF scrolls independently, and the phone layout has no horizontal overflow.
- The shared muted/action/status text pairs exceed WCAG AA 4.5:1. See `test-results/revamp/contrast.json`.
- Original data integrity: **12 inquiries, 3,577 historical rows and historical-review records match the pre-change backup**. See `test-results/revamp/data-integrity.json`.
- The correction note on INQ-2026-00126 is already empty in the saved test database, and its record contains no matching profanity. Original historical records and submitted evidence were not rewritten. New test fixtures are labeled `[TEST]` where created through the workflow tests.

## Screenshots and test entry points

- `test-results/revamp/final/`: final role, list, workspace, notification, settings and monitoring screenshots at 1440×900, 1366×768 and 390×844.
- `test-results/revamp/final-build/workflow/`: original-form, duplicate, template cards and proposal-check screenshots.
- `scripts/test-revamp.mjs`: role navigation, legacy hashes, counts, workspace actions, mobile focus and notification checks.
- `scripts/test-workflow.mjs`: complete local proposal lifecycle and active-template conversions; configurable isolated URL.
- `scripts/revamp-navigation.mjs`: shared navigation helper for the updated browser tests.

These are targeted regression checks, not a guarantee against every possible production issue. Migration and deployment remain separate work.

## Inquiry card and handling controls — 10/30/2026

See [WORKSPACE_HANDLING_NOTES.md](WORKSPACE_HANDLING_NOTES.md) for the latest workspace changes, pre-change source checkpoint and validation. The earlier checkpoints above remain available.
