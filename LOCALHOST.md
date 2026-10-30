# RMC2 localhost web app

This version runs the basic proposal workflow with real server persistence, authenticated staff sessions, PDF/Excel intake, generated Word/PDF documents, immutable review packages and a local email outbox. Gmail delivery and proposal AI help are still simulated as agreed. There is no live mailbox, OpenAI API call or external email send.

## Run

Requirements: Node.js 22.13 or newer, npm, the private source files, and a local LibreOffice document converter. The supplied files and a checkout-local converter are already available on this computer. Edge/Chromium is used for browser tests.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173/. Production-mode local testing uses `npm run build` followed by `npm start`. Both modes use the same database directory.

### Reconnected local setup (October 17, 2026)

The updated checkout has the six saved inquiries recovered from the previous project's `.data` directory on `D:/Codex/2026-10-06/referenced-chatgpt-conversation-this-is-an-2/outputs/coverdesk`. Its database was restored with SQLite's backup API, including the pending WAL transactions. All 178 attachment, generated-document, archived-source and outbox files were copied and checked by SHA-256; every stored file reference resolves. Historical inquiry records and submitted packages were preserved. The original directory on D: remains untouched as a recovery copy.

The ignored `.env.local` selects this checkout's `.data` directory and the recovered LibreOffice 26.8.1.1 executable at `D:/Codex/2026-10-06/referenced-chatgpt-conversation-this-is-an-2/outputs/.rmc2-tools/office-extracted/SourceDir/LibreOffice/program/soffice.com`. Keep that converter directory available. `npm start` and `npm run dev` load this configuration automatically; use port **5173** for the restored working records. Port **5190** is reserved for a separate automated-test database and contains test fixtures.

The recovery inventory, database snapshot and verification reports are private, ignored files in `test-results/reconnect/`. Subsequent edits in the updated app are saved to its local `.data` directory; they are not synchronized back to the recovery copy on D:. This reconnects local storage and document conversion. Gmail and AI remain simulated.

Reconnect validation passed: all 13 master-layout checks, 56 workflow checks, nine customized-proposal checks and six restored-data checks. These include preview/final PDF consistency, supervisor correction and approval, exact local email attachments, and access to all 26 historical proposal files. Workflow mutations used the isolated test database; read-only checks confirmed that every restored inquiry and submission remained unchanged.

## Local accounts

Sign in with the staff username or email. Every initial local account has password `Rmc2Local!2026`.

| Account | Role |
| --- | --- |
| cryssa@rmc2.local | Employee |
| jefferson@rmc2.local | Employee |
| judy@rmc2.local | Employee |
| emerson@rmc2.local | Supervisor, can approve |
| zeo@rmc2.local | Supervisor, can approve |
| admin@rmc2.local | Admin |

These accounts are for local tests. Sessions use an HttpOnly cookie, stored token hashes and expiry. Passwords are hashed with scrypt. Approval and admin permissions are enforced in server routes.

## Test the workflow

1. Sign in as an employee. Click **Import agent form**, enter the agent reply email and upload their exact `.xlsx` or `.pdf` attachment. The downloadable filled Excel sample contains fictional data. Starting inquiries also display a workbook built from their original sample intake values using the same franchise form template. These previews and downloads are labeled Sample; they are not attachments received from an agent. This local import stands in for receiving an agent email until Gmail is connected.
2. The workspace has three steps: **Review form**, **Choose template**, and **Preview & approval**. The **Submitted form** card opens the exact stored attachment. Excel keeps its sheet layout, formatting, images and tabs; PDFs display the submitted PDF. Working corrections never modify the original. Excel intake reads mapped fields automatically. For a PDF, employees complete working details after viewing it. Everyone receives an intake notice.
3. Choose one of 11 active supplied proposal masters. Suggestions use the requested family and sector, then prefer Standard variants; equal matches follow catalog order. The sticky **Need help with proposal?** button opens compact **AI proposal notes** in a separate right-hand column. Plan cards and arrows compare your choice with the suggestion; short form-to-plan cues explain the match, with source warnings shown as labels. A matching choice gets one confirmation card. **Use suggestion** changes the selection only when clicked. AI remains simulated, with no chat input or outside information. **Preview template** means the original supplied proposal layout; **Download template** downloads the Word source.
4. Continue to the last step. **Preview & fill proposal** is embedded in the page. All fill fields and actions fit in the pinned sidebar on desktop, including template previews; the grid adapts to shorter laptop screens. Only the document scrolls vertically. On phones, the fields move above the document. Logos, backgrounds, tables and terms come from the master. Professional titles supplied in the form are preserved in the addressee and greeting. Agent numbers appear as (+63) without the trunk 0 or a duplicate country code. Edit text boxes, then click **Update preview**: edits do not refresh the document automatically. **Show blank template** displays the unfilled original. **AI notes** in the toolbar opens template feedback; **AI · Check proposal details** shows form comparisons, invalid numbers and changed professional titles as comments in the right-hand margin. Neither opens another modal or inserts a banner above the PDF. Close the notes to restore document width. Notes share the page's vertical scrolling; phones show them above the fields. Changed values are retained in supervisor review notes. Missing or invalid required details block generation/submission.
5. The email appears below the proposal. Recipient, subject, message and preparer autofill; **Edit email** lets employees override or reset them. **Prepare PDF & email** (or **Update PDF & email**) creates the finished package. Document changes require an updated package before submission. Leaving through navigation or signing out saves unfinished work, records the workflow step, and creates one **Pick up where you left off** notification per employee/inquiry. The dashboard has recent proposal shortcuts showing the next action. Browser-close saves use a keepalive request with a session backup for unsaved edits. Server revision checks prevent stale overwrites; an interrupted connection may require reopening and saving recovered work.
6. Submit to supervisors. The exact PDF, Word document, form details, email and source hash are frozen in a numbered review version. Earlier PDFs are identified from their saved metadata and source artwork layers, then labeled Earlier PDF layout. Preview current layout provides a read-only comparison using the same source hash and frozen proposal fields with the current native renderer; it does not replace the submitted PDF or email attachment. New packages record their layout version. Drafts using an earlier renderer must use Update PDF & email before submission. The shared renderer restores source PNG header artwork where LibreOffice hides flattened layers; original Word files, proposal text, backgrounds and saved submissions stay unchanged.
7. Sign out and sign in as Emerson or Zeo. Open **Approval Queue**. Return with a correction note or choose **Approve & email agent**.
8. Approval saves one `.eml` reply with the exact approved PDF to the local outbox. No additional employee send action is needed. Download the reply from the inquiry/history.
9. To test recovery, expand **Local delivery test** before approving and enable the failure option. **Retry approved reply** reuses the existing approval/package.

Employees and supervisors can prepare proposals while holding the inquiry's exclusive employee editing lease. The agent's separate 30-day client protection starts after a successful outbound reply; progress reports can renew it, and expired registrations appear in Archives. Duplicate client names, account names and uploaded files hold processing pending review. See [PRIVACY.md](PRIVACY.md) for the rules and production privacy requirements. Admin remains read-only for proposal preparation. Submitted versions remain frozen. Approving supervisors can open a separate editable review copy, prepare a new version and approve that version. My Inquiries uses actual contributions. Viewing alone does not count. Conflicting saves are rejected using revision checks rather than overwriting a colleague's work.

## Files and storage

### Customized proposals

Click **Customize** on a suggested template, or select any master and click **Customize selected template**. This creates a copy for that inquiry; the supplied master is never changed. Customized copies have amber **Customized** labels in the workspace, inquiry/approval lists, generated filename and saved versions.

In **Edit document**, click directly into paragraphs or table cells to change proposal text, rates, benefits and conditions. The toolbar controls paragraph bold/italic/underline, size, color and alignment; the restore button restores the selected original paragraph. Logos, backgrounds and template assets remain preserved. **Save details** saves the content edits; navigating away also saves the draft. **Update preview** refreshes the document from the current autofill fields and content edits. An explicitly edited paragraph keeps its customized text. The browser editing view can wrap differently from the native Word renderer: use **PDF preview** to check final pagination, then **Prepare PDF & email** before submitting.

Supervisors see an original-versus-customized change list, can flag individual edits and return them for correction, and must acknowledge reviewing customized content before approving. Flagged custom edits must be resolved or returned before approval. Approved/submitted versions freeze the customized content and exact PDF. Corrections create a new submission version. Switching to a standard template saves and archives the customized draft and makes full-content editing unavailable for the standard version. AI template matching does not validate custom coverage changes.

- `.data/rmc2.sqlite`: durable local database, including users, sessions, inquiries, notifications and outbox records.
- `.data/attachments`: exact original uploaded PDF and Excel forms.
- `.data/generated`: generated Word/PDF packages retained across revisions.
- `.data/sources`: exact source masters archived by SHA-256, retained with generated versions even when the catalog is later updated.
- `.data/outbox`: local test replies and requests for details.
- `resources/private`: original unfilled proposal masters and the original form template. This directory is ignored by Git.

The catalog retains 14 supplied masters. Eleven are active across BureauHealth, Total CorpoShield and Total CorpoHealthCheck; the three CorpoAide 2 masters are retired. Completed customer examples are not imported as general templates. Benefits/rates are preserved from proposals; conflicting TOR/MOA terms are not blended in. Unknown or unsupported values are not manufactured.

To import the supplied source files again:

```powershell
python scripts/import-proposal-masters.py --source "D:/DOWNLOADS/rmc2 files/extracted"
```

Use the available Python interpreter. Import expects exactly the 13 unfilled proposal masters. It never changes the supplied originals. On another computer, copy the private source collection or run this importer before generating proposals. The original franchise form is expected in the source tree's grandparent Downloads folder.

## Updated proposal batch (October 17, 2026)

Ten matching masters were replaced with the supplied updated versions. D097 adds **BureauHealth 7K & 5K · DepEd semiannual OP limit**. D091–D093 (CorpoAide 2) are retained for history but retired from selection. The catalog has 14 retained entries and 11 active templates. The semiannual wording in D097 describes the outpatient benefit limit; its supplied premiums remain annual. D024–D026 now correctly label the PHP 6,000 dependent premium, so the earlier principal-label warning is removed for those current versions.

Apply the reviewed batch after bootstrapping the original resources:

```powershell
python scripts/import-proposal-masters.py --updates 'D:/DOWNLOADS/updated proposal' --dry-run
python scripts/import-proposal-masters.py --updates 'D:/DOWNLOADS/updated proposal'
```

The importer validates the explicit filename-to-template mapping, preserves unrelated plans, stores masters under immutable SHA-256 filenames, saves the previous catalog under `resources/private/catalog-history/`, and publishes the catalog atomically. Original supplied files and historical packages are not overwritten. D026 has a source-layout review note for the eligibility heading near its logo/header. The mapped local importer remains available; Admin can now also add and update templates through Proposal Templates.

Updated sources make earlier prepared drafts stale; regenerate before submitting. Earlier customized drafts cannot be generated against a different master hash. Switch to standard mode and save to retain the old customized draft in its archive, then create a fresh customized copy and review/reapply any intended edits. Submitted/sent versions keep their saved files.

For replacement-specific QA, start the separate 5190 server with `RMC2_DATA_DIR` set to `test-results/template-updates/qa-data`, then run `node scripts/test-template-updates.mjs`. It covers stale custom sources, archived edits, the new variant, approval and exact local email attachment bytes.

## PDF conversion

Both live previews and generated PDFs use the preserved DOCX with a local LibreOffice engine. The app no longer recreates the proposal in HTML or removes/normalizes its floating artwork. Only supported placeholder text changes in the DOCX; original images, styles, relationships, table definitions, headers/footers and section geometry remain preserved. Preview PDFs are displayed with PDF.js in their own scroll pane. The fill fields stay beside the document while its pages scroll; the same layout applies to customized documents and template previews. A preview does not create a proposal version, change the handler or alter saved inquiry data. Partial previews leave missing placeholders visible; generation still requires complete, verified fields.

The local engine is stored alongside the app at `../.rmc2-tools/office-extracted/SourceDir/LibreOffice`, keeping its binaries outside application build traces without installing it system-wide. On another machine, install [LibreOffice](https://www.libreoffice.org/download/) and set `RMC2_OFFICE_EXECUTABLE` to its `soffice.com` (Windows) or `soffice` executable if automatic detection does not find it. The worker uses a private profile, disables macros/link updates, serializes requests and cleans up temporary input/output. A bounded in-memory cache speeds repeated previews. Conversion stays on this computer; no remote converter receives proposal data. Native office engines can paginate differently from Microsoft Word, so validate formal production outputs against the approved masters.

## Checks

Use an isolated QA database and port 5190 so tests do not alter working inquiries:

```powershell
npm run build
$env:RMC2_DATA_DIR=Join-Path (Get-Location) 'test-results/qa-data'
node node_modules/next/dist/bin/next start -p 5190 -H 127.0.0.1
```

In a second terminal:

```powershell
npm run typecheck
node scripts/test-proposal-fields.mjs
node scripts/test-proposal-document.mjs
$env:RMC2_TEST_URL='http://127.0.0.1:5190'
npm run test:workflow
node scripts/test-custom-document-integrity.mjs
node scripts/test-customized-proposals.mjs
```

The document test checks all current masters for artwork/layout preservation, professional greetings, proposal dates and Philippine contact formatting. The focused exclusive-handling browser test covers read-only access, lock transitions, draft recovery and independent PDF scrolling. The customized-proposal browser check covers inline content editing, refresh, phone layout, supervisor correction and approval. Workflow checks cover authentication, concurrency, corrections, immutable versions and exact approved attachments. Gmail and AI are still local simulations.


## Exclusive inquiry handling

Click **Start handling** to unlock preparation. Only one employee or supervisor can hold the editing lock for an inquiry at a time. Everyone else has **View only** access to the original form, templates, saved proposal and history. They cannot change details, select or customize a template, save, generate a PDF, request agent details, or submit that draft. The server enforces this on every write, including checking ownership again after PDF generation. The **Current handler** column shows one active person; historical contributors remain in the inquiry’s activity history.

**Done for now** saves changes before releasing the lock. Navigating away also saves and releases it. Submitting ends preparation and releases the lock; supervisor approval remains a separate permission. After a correction request, an employee must start handling again. No permanent assignments are created.

Lock checks refresh every 10 seconds while the workspace tab is visible. A disconnected/background session expires after 90 seconds without an update. Expired sessions cannot silently take back the lock. Unsaved edits stay on the device for recovery when handling resumes. Multiple tabs for the same employee share ownership; leaving one tab does not release another active tab. Revision checks still protect against conflicting changes between their tabs. Heartbeats do not change saved timestamps, revisions or contributor history.

Run the port-5190 test server with RMC2_DATA_DIR set to test-results/exclusive-handling/qa-data, then run node scripts/test-exclusive-handling.mjs. This focused check ages only isolated test activity rows. It covers simultaneous pickup, server enforcement, read-only previews, safe release, handler labels, expiry and local draft recovery. The workflow and customized-proposal checks also acquire handling locks before preparation.

## Current workspace features

See [WORKSPACE_UPDATES.md](WORKSPACE_UPDATES.md) for decline/archive, BOR verification, supervisor editing, account settings, admin template uploads and monitoring. Use the dedicated workspace-upgrade QA data directory for its two test scripts.

## Paged workspace and performance checks

Inquiry/notification lists now show 25 records per page, with full inquiry details loaded on opening. Shared updates still refresh every ten seconds while visible. The browser no longer requests the legacy full `/bootstrap` snapshot.

`node scripts/test-workspace-scaling.mjs` creates a fresh isolated 5,000-record test database without starting a server. `node scripts/test-workspace-pagination-browser.mjs` uses port 5190 with `RMC2_DATA_DIR=test-results/workspace-upgrade/qa-data` and verifies paging, off-page search/links, colleague updates, draft conflicts, notification counts and mobile width. Do not point either QA server or browser script at the working database.

On this Windows setup, Turbopack's CSS worker failed to start during the optimization verification. `npm run build -- --webpack` successfully built the production app using Next's supported alternative bundler. The completed build runs with the usual `npm start`. The build environment must allow worker processes to create their output files.
