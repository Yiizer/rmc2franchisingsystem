# Mockup UI refinement — October 29, 2026

## Changes

- Client Directory defaults to Client, Status, Agent · Branch and Last activity. Full workbook columns, server pagination, source-sheet filters and matching links remain available.
- Search, Filters with a count, Sort and Columns share one toolbar. Status groups use compact tabs with live counts.
- Client details use a summary strip, three tabs and collapsed source records. Documents and payments are in an expandable Overview section. Source evidence, timeline deduplication and audited display corrections are retained.
- Dashboard shows a compact metric strip, inquiry queue and personal drafts. Queue actions open the existing workspace; handling still starts through its guarded Start handling control. A colleague's active lock stays view-only.
- Sent today opens only records sent on the current Manila date. To prepare excludes blocked records, matching its metric.
- Dates remain MM/DD/YYYY. Account age never sets expiry. Historical status colors retain their source-specific meanings.
- Phone details cover the viewport and retain keyboard focus. Tables scroll within their containers.

## Rollback checkpoint

The source before this change, including uncommitted and non-ignored untracked work, is captured in the local Git tag `local-mockup-baseline-20261029-202011` (commit `a26d4de4dadc8cb0b2aaec8c6a6e8f06be057c58`). The working branch and index were not committed or reset.

Consistent SQLite backups are in:

- `test-results/mockup-refinement/baseline/real.sqlite`: original `.data` database.
- `test-results/mockup-refinement/baseline/test.sqlite`: the existing port 5193 test database.

This update does not migrate the database or change original source documents. Test writes use `test-results/mockup-refinement/qa-data` on port 5194. Port 5193 retains its existing test database.

To roll back, first save any subsequent work. Consult `test-results/mockup-refinement/rollback-files.json` for the exact files touched and their before/after hashes. Restore only files that existed at the checkpoint using `git restore --source=local-mockup-baseline-20261029-202011 --worktree -- <file paths>`. Remove only the new files listed in that manifest, after confirming they have no later edits. Rebuild and restart the test app. Do not reset the whole repository or restore an old database over newer records; source rollback does not require database rollback.

## Verification

Validation results and desktop/mobile screenshots are saved under `test-results/mockup-refinement/`. See `mockup-checks.json`, `directory-checks.json` and `workflow-browser/checks.json` for completed checks. Validation passed: TypeScript and the production build; 4 mockup/browser groups; 9 directory/API/browser groups; and 9 existing employee/supervisor workspace browser groups. The checks cover filters, extra columns, pagination, timeline/source access, historical edit auditing and stale-write rejection, duplicate matching, desktop/mobile layout, keyboard opening, template previews, handling locks, optional proposal checks and decline-to-archive. Original historical rows (3,577), inquiries (12) and historical review records match the backup. These are targeted regression checks, not a claim that every possible system action was exercised.

