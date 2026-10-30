# Inquiry workspace card and handling controls — 10/30/2026

## What changed

- Removed the More menu. The bottom-left control now starts handling, continues in this tab, releases to the queue, or explains a colleague's lock. The existing save-before-leaving guard remains in use.
- The top banner explains handling status; it no longer duplicates the handling button.
- Rebuilt Review the submitted details as a bordered white card with six fields, including Division, and a contextual follow-up strip. Missing Division is informational and included in requests for details; it does not introduce a new submission requirement.
- View/Edit details stays in the card header. Submitted form and Activity & versions stay in the inquiry summary. Prepared PDF/Word links stay beside the prepared document. Existing submitted-version links are unchanged.
- Unstarted protection is summarized in the inquiry card. Active protection, reports, duplicate-client review, archives and BOR evidence retain their existing controls.
- Received dates use MM/DD/YYYY. Cards stack on mobile, with visible footer controls and keyboard focus styling.

## Rollback

The complete pre-change source snapshot, including uncommitted and non-ignored untracked files, is saved at:

`D:\Codes\coverdesk\test-results\workspace-handling-20261030\baseline`

The path inventory is `test-results/workspace-handling-20261030/checkpoint-files.json` (284 source paths). The working branch and Git index were not committed or reset.

For a targeted rollback, compare any later edits first, then restore these four files from the same relative paths under `baseline`:

- `app/operations-workspace.tsx`
- `app/operations-workspace.css`
- `app/operations-activity.tsx`
- `app/operations-action-bar.tsx`

Rebuild and restart the app after restoring. No database rollback is needed: this change does not modify the database schema, templates, conversion logic, approval rules or user records. Browser tests used only the isolated `test-results/review-20261030/data` database, not the user's port 5193 database.

## Validation

- TypeScript checking and production build passed.
- Eight existing browser check groups passed with selectors updated only for the relocated handling control: employee/supervisor/admin navigation, legacy routes, mobile navigation, role/state controls, notification save guards and browser-error checks.
- Seven focused groups passed: responsive card and footer at 1440/1366/390 widths; read-only viewing and missing-division follow-up; colleague lock; save-before-release; submitted form/history access; supervisor edit handling; no browser errors.
- Evidence: `test-results/workspace-handling-20261030/ui/checks.json`, `focused-checks.json`, and `card-1440.png`, `card-1366.png`, `card-390.png`.
- The previous review's inquiry-filter and returned-list-sort findings are outside this UI change and remain open.
