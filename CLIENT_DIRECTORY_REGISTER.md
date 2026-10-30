# Client Directory and duplicate review revamp

Updated October 25, 2026. This section supersedes the earlier row-based directory notes retained below.

## Current behavior

- The directory combines live accounts and historical accounts in a full-height register with internal table scrolling, a pinned footer, 50 clients per page, source/agent/branch/sheet filters, removable filter chips, sorting and a Columns control.
- Historical rows group by their original account key. Latest valid recorded date wins, with source row as the tie-breaker. Every source record is retained. Distinct historical agents are counted once in the additional-agent badge.
- Live accounts group by normalized account name. A live group joins history only through a latest, non-stale `same` review. Unreviewed matches stay separate and show a Possible match button; confirmed distinct records remain separate. Supervisor agent-change decisions retain their existing workflow and are not treated as an implicit merge.
- Status filters count clients, not source rows: Active (blue), Won (green), Lost (red), Not started (gray), Needs review (amber). Badges retain their specific status wording. Historical status does not establish current eligibility or ownership.
- The right-hand detail panel keeps the register visible and supports previous/next clients. Overview preserves all mapped fields; Timeline collapses exact repeated sheet/agent/date/status/remarks entries with a count; Documents & payments appears only when populated; Source retains original cells, formulas, colors and display-edit history.
- Any active staff member can correct a historical-only record's display status, remarks, agent, branch, plan or account name. A reason of at least 10 characters is required. Edits target an explicit source row and use optimistic concurrency. Original JSON, matching keys, review identities, ownership and protection remain unchanged. Live/combined clients are edited through their inquiry.
- Duplicate conflicts show one comparison at a time with match chips. Resolved chips remain marked during that review. Account and client are always visible, the agent row is highlighted, and the suggested action reflects same-agent, protected, expired and pending-decision cases.
- BOR transfers still require one unresolved live match, as enforced by the existing server. The visible selected match is passed into the BOR dialog. Multiple matches must be reviewed first; no transfer or approval rules were weakened.
- The duplicate sidebar has one hold action. Request details can be expanded below the conflict card. Historical matches use the same card and detail panel; same-agent matches suggest Same client, other matches suggest Further verification.

## Interfaces and storage

- GET `/api/operations/directory`: grouped, server-paginated clients; `source=all|live|historical`, `group=active|won|lost|notStarted|review`, search, sheet, agent, branch, sort, page. Returns group counts and page size 50.
- GET `/api/operations/directory/client/:key`: all source records and inquiry summaries for a group. Keys must be URL encoded. A source-record ID is also accepted for existing history links.
- GET `/api/operations/directory/:id`: remains available, adding projected display corrections and audit history.
- POST `/api/operations/directory/:id/edit`: `{field,value,reason,expectedAt}`; authenticated staff only. Conflicting versions return 409; unsupported fields and short reasons return 400.
- `historical_edits` is an append-only overlay table, installed lazily with the historical schema. No source-record update or destructive migration is performed.
- Directory cache invalidates on import report, Manila day, inquiry version, historical review and edit changes; time-sensitive protection refreshes at minute boundaries.

## Rollback

- Source checkpoint (includes pre-existing uncommitted source): `local-directory-revamp-baseline-20261025`.
- Database snapshot: `test-results/directory-revamp/baseline/rmc2.sqlite`, created with SQLite's consistent backup API.
- Changed-file hashes and whether each path existed: `test-results/directory-revamp/rollback-files.json`.
- Restore only manifest-listed files from the checkpoint after preserving later work. Remove only files listed as newly created by this change. The checkpoint did not move the branch or change the real Git index.
- Database restoration is normally unnecessary: the overlay table is additive and original records are untouched. Never overwrite an active database. A full restore would lose subsequent activity; retain newer inquiries, reviews and edits first.
- All test mutations use `test-results/directory-revamp/qa-data` on port 5192. No generated PDF sample repairs were applied to the running proposal engine.

## Validation records

Completed on October 25 against isolated databases on ports 5192 and 5193:

- Production build and TypeScript checks passed.
- 8 workbook/model groups, 9 directory API/browser groups, 6 conflict workflow groups, 8 existing registration safeguard groups, 9 existing workspace browser groups, and 3 supplemental historical-view checks passed.
- Covered same/different agents, selected-match BOR, expiry approval, stale reviews and edits, original source preservation, older-row correction search, 50-client pagination, status counts, exact duplicate timeline collapsing, pinned columns/footer, desktop/mobile layouts, template selection, PDF preview, handling locks and decline-to-archive.
- The single-match comparison and actions fit a 1366×768 viewport. The directory has no page-level scroll at the tested desktop size. Phone tables scroll horizontally inside their own regions.
- Real-data integrity: all 3,577 historical source rows, all 12 existing inquiries and the historical review table are unchanged from the pre-change backup.
- Results: `model-checks.json`, `directory-checks.json`, `conflict-checks.json`, `registration-checks.json`, `supplemental-browser-checks.json`, `design-browser/checks.json`, and `real-data-integrity.json` under the evaluation folder.

See `test-results/directory-revamp/` for model, directory API/browser and conflict checks, screenshots and the rollback manifest. Relevant test scripts are `scripts/test-directory-model.mjs`, `scripts/test-directory-revamp.mjs`, `scripts/test-conflict-revamp.mjs`, `scripts/test-workspace-refinements.mjs` and `scripts/test-workspace-design-browser.mjs`. Test databases are isolated; old mutable QA databases should not be reused as a pristine baseline.

---

## Prior register implementation (October 21; retained for historical reference)

# Client Directory register

Updated 21 October 2026. This change is limited to historical account viewing and import metadata; live inquiry, ownership, proposal, approval and protection rules are unchanged.

## Viewing the directory

The register shows Account, Recorded date, Account age, Agent, Branch/division, Plan, Historical status and Remarks. Scroll horizontally for the remaining columns and View details. The account column and headings remain visible while scrolling.

- Status buttons filter the register and show counts for the current search, sheet, agent and branch, before the status filter.
- Search covers account, agent, branch, plan, serial number and remarks.
- Source sheets include all 18 workbook tabs, including the empty DIVISION VII.
- Columns exposes additional fields found in the chosen source: document tracking, requirements, enrollees, contract/payment values, preparer, serial numbers, coverage and delivery dates, and meaningful unnamed columns.
- View details groups the full data into account/people, status/remarks, documents/requirements, payments/enrollment, dates/delivery and source history. Repeated account names remain separate source rows.

## Status interpretation

| Label | Color |
| --- | --- |
| Closed deal | Purple |
| Expired / Disapproved | Red, with distinct labels |
| On hold / Pending / Needs review | Amber, with distinct labels/icons |
| Processing | Blue |
| Waiting for presentation | Teal |
| Sent / Done | Green |
| To do / Not recorded | Gray |

Explicit status and remarks take precedence over fill color. For example, a red cell with On hold remarks displays On hold. Conflicting or qualified status text remains Needs review. Unrecognized remarks remain fully visible with a review indicator.

Color meanings are applied only to the status column in GENERATED MOAs and IWC, where the workbook contains a legend. A red GENERATED MOAs status is ambiguous (Disapproved/Expired) and remains Needs review; IWC's red legend explicitly means Disapproved. Unknown colors elsewhere never invent a business outcome. Empty cells without reliable evidence remain Not recorded.

The original colors, cached values and formulas remain in Source history. Legend entries under GENERATED MOAs' Total Contract Price heading and IWC's Content Meaning column are retained as legend evidence, excluded from account financial fields.

## Dates and age

Current age uses Manila calendar days since the explicit Date, Date Sent or Date Enrolled field. The saved Excel age is retained separately. Closure, coverage effectivity/expiry, payment and delivery dates are not substituted for an absent account date. Ambiguous numeric source dates, invalid dates and future dates are explicitly labeled. Valid dates display MM/DD/YYYY. Aging never expires a registration or changes its agent; the 30-day protection workflow remains separate.

## Data and interfaces

- 3,577 existing historical record IDs, 2,535 normalized names and 1,042 repeated-name rows are preserved. All 18 sheets are represented. Previously excluded unnamed/header/legend rows remain traceable in the original workbook and import report; no invented accounts are created.
- The importer still defaults to a dry run. Its opt-in apply now enriches each historical JSON record with headers, formula text, number formats, resolved source fills and legend roles. No tables or historical-review identities are replaced. The same workbook retains the same IDs; re-import refreshes the import report.
- GET /api/operations/directory adds agent, branch and sort filters (account, date-new, date-old, age-old, age-new), expanded row fields, status counts, column choices and an asOf date. It returns at most 25 records per page.
- GET /api/operations/directory/:id adds the same presentation fields and grouped source data, preserving raw values and related history.
- Source projections are cached on the server by import report and Manila date; filtering, sorting and pagination happen on the server. Only the current page and filter metadata reach the browser. Refreshing after a re-import invalidates the projection through its changed report. Historical source editing through the UI is not enabled.

## Validation

Completed against an isolated copy at test-results/directory-register/qa-data on port 5191:

- 8 model/data checks: source-row IDs, all original cell values/fills, all 18 sheets, inquiries/reviews unchanged, text/color precedence, legend exclusion, calendar age, ambiguous/future dates, coverage-date separation, financial values and extra columns.
- 8 API/browser checks: authentication, 25-row pagination, status counts, remarks search, agent/sheet filters, age ordering, empty sheets, grouped details, sticky headings/account, long-name wrapping, mobile overflow, keyboard controls, touch targets and no JavaScript errors.
- 11 existing workspace regression groups: predecessor matching, per-record reasoned clearance, historical holds, supervisor agent decisions, BOR and expired reassignment, stale identity, shared history viewer, template advice and desktop/mobile behavior.
- Production Next.js build and TypeScript checks passed. An initial sandbox filesystem restriction was resolved by running the build with the required filesystem access.

Screenshots and machine-readable results are under test-results/directory-register (ignored by Git). Use register-desktop.png, register-mobile.png and directory-detail.png for the directory UI. Existing regression screenshots are stored alongside them.

## Rollback

Source checkpoint: local-directory-register-baseline-20261021-032036
Commit: 9c6480fa2e922365be76830c07fbb311b4f090f2
Database backup: test-results/directory-register/baseline/rmc2.sqlite
Manifest: test-results/directory-register/rollback-files.json

The checkpoint includes uncommitted source without moving the branch or changing the real Git index. Restore only manifest-listed existing files from the checkpoint and remove only listed new files when intentionally reverting this change. Review and preserve any subsequent work first. Rebuild and restart the app afterward.

Database restoration is normally unnecessary: the source changes are backward compatible with enriched JSON. A full database restore would also discard later inquiries and reviews, so use the backup only for a deliberately selected data rollback with the app stopped and newer data preserved. Never overwrite a running SQLite database or copy its main file alone while WAL writes are active.
