# Inquiry workspace UI and rollback guide

Updated: 10/18/2026

## Current behavior

### Template selection

- Up to three suggested cards appear by default. These are local catalog matches and consume no paid AI tokens.
- `View all templates` switches the card area to the complete family-filtered catalog. `Back to suggestions` returns to the suggestions. Opening the catalog starts in the selected family, or the first available family.
- Selection never changes automatically. The selected template remains named beside `Continue to preview`, even when it is outside the suggested three.
- Cards have revision-verified descriptions, a green selected state, Preview and Select actions on one row, and Customize underneath. Updated/unverified masters use the family/variant fallback description.
- At a content width of 780px or greater, cards use three equal columns; narrower areas use one column.
- Missing matches and empty catalogs explain how to proceed without manufacturing a recommendation.

### Two simulated AI helpers

**AI template advisor**, above the template cards, runs only when the user presses `Explain recommendation`, `Check selected template` or `Review again`. It compares the requested family and explicit coverage variant, account sector, annual-payment restrictions and known dependent restrictions. It reports one of:

- Matches known requirements
- Another template fits better
- Needs review

It provides up to three reasons and buttons to preview the relevant sources. Unrecognized plans, missing fields, unavailable sources and custom content require review. Outpatient limits are not treated as proof of premium payment frequency. This is a simulated catalog review, not underwriting or a live language-model response.

**AI proposal checker** stays beside the proposal fields. The user presses `Check proposal details` to compare the current working details with the original submitted form. Results appear directly above the sticky controls. Changes invalidate the previous result and display `Details changed · check again` until rerun. Required-field validation continues independently.

For submitted and historical proposals, the checker appears beside the saved-PDF controls and compares the selected submitted snapshot, not current working fields. A replaced catalog master is not substituted for an older submitted master. Customized-content acknowledgement stays separate from autofill checks.

Both helpers visibly say **AI simulated · no tokens**. No paid provider, new database schema, or public API was added. Default suggestions can refresh locally; explicit reviews are never run by page load, typing, navigation or polling.

### Visible actions and handling

- The `More` menus are removed.
- `Change template` and `Use standard version` sit beside the proposal heading. When browsing with a customized copy, the standard-version action also appears beside the selected-template summary.
- `Update PDF & email` is a visible secondary preparation action when a current package exists.
- `Discard supervisor edits` appears in a labelled Supervisor editing section.
- Handling has its own status row and full-width button: blue Start handling, teal Done for now, and bold green `you`. Editing supervisors use the same handling block.
- Handling and next-step actions are separated by a divider and use matching widths. The next-step label is `Choose template`.
- Save changes remains green beside the fields. Save, Update preview and Check proposal details stay visible while the fields and PDF scroll independently.
- Locks, customized-copy confirmations, preserved versions, PDF generation and supervisor approval requirements remain in force.

### Statuses and dates

Shared status colors apply in lists and the workspace: New inquiry is blue, Preparing proposal amber, Awaiting approval / Supervisor editing purple, and Sent green. Labels accompany every color.

App timestamps use **MM/DD/YYYY**, 12-hour time and Asia/Manila timezone. For example, `02/04/2026, 9:30 AM` means February 4. Relative ages remain. Stored ISO values, native date-picker behavior and original document/PDF dates are unchanged.

## Current rollback checkpoint

Before this revision, all non-ignored source, including existing uncommitted and untracked files, was saved locally:

- Tag: `local-workspace-advisors-baseline-2026-10-18`
- Commit: `fba4af808078e336d996e264067ab23d072530e2`
- Metadata: `test-results/workspace-advisors/baseline/checkpoint.json`
- Branch HEAD and the actual staging index were left untouched. Nothing was pushed.
- Private files, databases, environment secrets, dependencies and test outputs are excluded.

To undo only this revision, first inspect any subsequent edits. From `D:\Codes\coverdesk`, restore these files:

```powershell
git restore --source=local-workspace-advisors-baseline-2026-10-18 --worktree -- app/operations-workspace-templates.tsx app/operations-workspace.tsx app/operations-workspace.css app/operations-activity.tsx app/operations-activity.css app/operations-document-editor.tsx app/operations-proposal-checks.tsx app/operations-proposal-checks.css app/operations-saved-pdf.tsx lib/operations/suggestions.ts lib/operations/types.ts scripts/test-workspace-design-browser.mjs scripts/test-workspace-upgrade-browser.mjs scripts/test-workspace-cards-browser.mjs scripts/test-workspace-compact-browser.mjs UI_WORKSPACE_REDESIGN.md
node node_modules/next/dist/bin/next build --webpack
```

Restart the app after rebuilding. The new `scripts/test-workspace-advisors.mjs` can remain unused, or be removed after checking for later edits. This rollback does not affect the database or saved documents. Do not reset the entire repository.

Earlier checkpoints remain available:

| Before revision | Local tag | Commit |
| --- | --- | --- |
| Compact cards and sticky controls | `local-workspace-compact-baseline-2026-10-18` | `d568a6f01f6117fb1dcb6c6116f564bcdb35ec2d` |
| Clear template cards | `local-workspace-cards-baseline-2026-10-18` | `7c6899e219a3bbed5090992fa780d53d64b9f535` |
| Full workspace specification | `local-workspace-spec-baseline-2026-10-18` | `e0b2090f124e0167506c4ff869ef835f363e0522` |
| First workspace redesign | `local-ui-baseline-2026-10-17` | `6384b72402d02e403b852f2c19694347c94495e3` |

## Validation and screenshots

Passed: **30 browser check groups**, **6 matching/date check groups**, TypeScript checking and the webpack production build. No browser JavaScript errors were reported. The normal data stayed unchanged: **12 inquiries, 6 accounts and 198 saved files**.

Browser checks use a separate SQLite backup and private-file copy under `test-results/workspace-advisors/qa-data`, served on port 5190. They must never target the normal app database on port 5173. Approval tests send only to the local test mailbox.

```powershell
node scripts/test-workspace-advisors.mjs
node scripts/test-workspace-design-browser.mjs
node scripts/test-workspace-upgrade-browser.mjs
node scripts/test-workspace-cards-browser.mjs
node scripts/test-workspace-compact-browser.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --webpack
```

Run the upgrade suite before the compact suite: the latter reads the former's submitted-version fixture. Fixtures use unique client names to avoid accidentally triggering the real duplicate-client rule.

Evidence is stored under `test-results/workspace-advisors/`:

- `rule-checks.json`: matching/differing/unavailable recommendations, explicit variants, missing details, restrictions, signature stability and numeric Manila dates across midnight/year/leap-day boundaries.
- `browser/`: handling locks, duplicate/BOR/decline flows, selection, preview, original form, missing fields and mobile layout.
- `end-to-end/`: PDF preview/prepared-byte equality, supervisor version preservation, discard, approval flags and local delivery.
- `edge-cases/`: text contrast, busy controls, custom-copy confirmations, long names, empty catalogs and view-only permissions.
- `controls/`: default cards, explicit keyboard-triggered reviews, stale form/catalog results, selected-template preservation outside the suggestions, numeric dates, aligned handling actions, independent scrolling, sticky field controls and submitted/history checks.
- `completion.json`: final test totals and normal-data verification.

## Font source

IBM Plex Sans is bundled under `app/fonts/`, with its SIL Open Font License at `app/fonts/OFL.txt`. The UI makes no runtime requests to a font CDN.


## October 20, 2026 — workspace refinements and historical directory

Implemented the updated plan in `WORKSPACE_REFINEMENTS_PLAN.md`.

- Suggested cards appear first, with View all templates and a compact, dismissible/reopenable advisor below them. Advice/checks still run locally, only on explicit requests; no paid AI integration was added.
- Standard decline controls sit below the form review. Duplicate resolution retains its decline action at the end of its options, without a duplicate footer action.
- Proposal fields use page scrolling. Save/update/check actions follow the fields without covering them; the PDF stays independently scrollable and sticky on desktop. Mobile stacks the panes. Buttons at the field list's end are intentionally not always on screen.
- Comparison rows show Same, Different or Not supplied, with agent, existing status, protection context, and the original matching reasons.
- Employees may clear a specific false match with a reason of at least 10 non-blank characters. Other matches remain unresolved; the decision is recorded in activity history.
- BOR and expired-registration transfers now require approving-supervisor authorization. Employee requests preserve current ownership until approval. Approval rechecks revisions, identities and handling locks. Pending requests can be rejected with a reason.
- A new inquiry cannot retroactively block an earlier registration. Existing holds, expiry and transfer restrictions remain in place.
- Sent attribution uses the recorded delivery actor for new deliveries. Older records fall back to the known PDF preparer rather than inventing a sender. Finished records show Completed in the handler column.

### Historical data

The original XLSX was imported into private local SQLite storage, with an unchanged copy retained under `.data/historical-sources/<SHA256>/`. Nothing was published or uploaded to a third-party service.

- **3,577 named historical rows**, across 17 populated sheets (18 source sheets including the empty Division VII).
- **2,535 normalized account names**, not verified unique clients; **1,042 repeated-name rows** retained as history.
- The Markdown's 3,592 data-row count includes 15 rows with no usable account name. Those remain in the original workbook and are enumerated in the import report. Two additional rows containing only legends are excluded. Two unusual first-row account headers are reported for manual review, not silently imported as accounts.
- Source values, sheet, Excel row number, date labels, raw status/remarks and cell fills are preserved. Source-status filters describe explicit text as Reported expired / Reported closed deal / Reported on hold / Reported waiting. Unknown or color-only status stays Unknown / needs review. These labels do not imply current ownership or eligibility.
- Repeating the same import keeps IDs/counts stable and preserves review history. Changed workbooks form separate source batches; they are not silently merged into verified clients.
- Client Directory provides authenticated search, source/status filters, 25-row pagination and related source records. Inquiry lists show a historical-match indicator; the workspace provides Open history and per-record reviews.
- Historical matches are advisory review flags, not automatic declines or protection timers. Confirmed same-client agent-change requests do pause processing until the supervisor decides. A rejected or stale agent-change approval does not permit processing. Changing client/agent details invalidates the approval.
- Clearing a historical false match does not clear a separate live-system duplicate or change ownership. Historical matching uses account-name columns; this workbook does not provide a reliably identified client-person field for matching.

Import reports and test evidence: `test-results/workspace-refinements/`. Sensitive reports and workbooks remain ignored by Git.

### Rollback checkpoint

Saved before editing, including all non-ignored uncommitted and untracked source:

- Tag: `local-workspace-refinements-baseline-2026-10-20`
- Commit: `c1b43f4e1403f191f0a7688f37635bd09360272d`
- Metadata: `test-results/workspace-refinements/baseline/checkpoint.json`
- Consistent SQLite backup: `test-results/workspace-refinements/baseline/rmc2.sqlite`
- Branch HEAD and the real staging index were not changed. Nothing was pushed.

To roll back, first preserve any later edits and consult `test-results/workspace-refinements/rollback-files.json`. Restore only its `restore` paths from this tag using `git restore --source=local-workspace-refinements-baseline-2026-10-20 --worktree -- <paths>`. Its `added` paths did not exist in the checkpoint; move those files to a backup location outside the source tree if reverting. Do not reset the entire repository or remove earlier uncommitted work. Rebuild and restart after restoring source.

Source-only rollback can leave the additive historical tables and private source copies in place; the previous application ignores them. For an exact database rollback, stop the app and make a fresh consistent backup first. Only restore the baseline database if losing all activity since this checkpoint is intended. Prefer keeping the additive tables when later inquiries/reviews exist. Do not overwrite a running SQLite database or copy its WAL files independently.

### Validation

- Production build and TypeScript checking passed.
- 11 directory/permissions/matching/browser check groups passed, including unauthorized access, reason requirements, per-match clearance, chronology, BOR and expiry approval, historical approval invalidation, desktop/mobile and zero browser JavaScript errors.
- 2 short-screen editor checks passed: fields do not scroll internally or overlap controls; PDF scrolling remains independent; mobile has no page overflow.
- 9 existing end-to-end browser checks passed, including custom tables, identical preview/prepared PDF bytes, preserved supervisor versions, approval flags, local delivery and account/template/admin screens.
- 6 local recommendation/date rule checks passed.
- Repeated import retained 3,577 rows and existing reviews.
- All **12 pre-existing local inquiry records were verified byte-for-byte unchanged** after import. Tests used a separate database/files on port 5190; no test inquiries were added to the normal database.

Commands: `node scripts/test-workspace-refinements.mjs`, `node scripts/test-workspace-refinements-editor.mjs`, `node scripts/test-workspace-upgrade-browser.mjs`, `node scripts/test-workspace-advisors.mjs`, and `node node_modules/next/dist/bin/next build --webpack`. Browser tests require the isolated server on port 5190. The historical importer defaults to dry-run and requires explicit `--apply` to write to the selected data directory.

## Client Directory register — 21 October 2026

A new checkpoint was saved before changing the directory, including all current uncommitted source and a consistent database backup.

- Tag: `local-directory-register-baseline-20261021-032036`
- Commit: `9c6480fa2e922365be76830c07fbb311b4f090f2`
- Backup: `test-results/directory-register/baseline/rmc2.sqlite`
- Exact restore/new-file manifest: `test-results/directory-register/rollback-files.json`
- Implementation, validation and rollback details: [Client Directory register](CLIENT_DIRECTORY_REGISTER.md).

The register now includes colored historical statuses, full remarks, current/saved account ages, source-specific columns and organized history details. Metadata enrichment retains historical IDs and reviews. Do not restore the entire database merely to revert the UI; that would discard later work. Restore only the listed source files, account for new files and any subsequent edits, rebuild and restart.
