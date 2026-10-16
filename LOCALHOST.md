# RMC2 localhost web app

This version runs the basic proposal workflow with real server persistence, authenticated staff sessions, PDF/Excel intake, generated Word/PDF documents, immutable review packages and a local email outbox. Gmail delivery and proposal AI help are still simulated as agreed. There is no live mailbox, OpenAI API call or external email send.

## Run

Requirements: Node.js 22.13 or newer, npm, the private source files, and a local LibreOffice document converter. The supplied files and a checkout-local converter are already available on this computer. Edge/Chromium is used for browser tests.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173/. Production-mode local testing uses `npm run build` followed by `npm start`. Both modes use the same database directory.

## Local accounts

Choose a staff account on Login. Every initial local account has password `Rmc2Local!2026`.

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
3. Choose one of 13 supplied proposal masters. Suggestions use the requested family and sector, then prefer Standard variants; equal matches follow catalog order. The sticky **Need help with proposal?** button opens compact **AI proposal notes** in a separate right-hand column. Plan cards and arrows compare your choice with the suggestion; short form-to-plan cues explain the match, with source warnings shown as labels. A matching choice gets one confirmation card. **Use suggestion** changes the selection only when clicked. AI remains simulated, with no chat input or outside information. **Preview template** means the original supplied proposal layout; **Download template** downloads the Word source.
4. Continue to the last step. **Preview & fill proposal** is embedded in the page. All fill fields and actions fit in the pinned sidebar on desktop, including template previews; the grid adapts to shorter laptop screens. Only the document scrolls vertically. On phones, the fields move above the document. Logos, backgrounds, tables and terms come from the master. Professional titles supplied in the form are preserved in the addressee and greeting. Agent numbers appear as (+63) without the trunk 0 or a duplicate country code. Edit text boxes, then click **Update preview**: edits do not refresh the document automatically. **Show blank template** displays the unfilled original. **AI notes** in the toolbar opens template feedback; **AI · Check proposal details** shows form comparisons, invalid numbers and changed professional titles as comments in the right-hand margin. Neither opens another modal or inserts a banner above the PDF. Close the notes to restore document width. Notes share the page's vertical scrolling; phones show them above the fields. Changed values are retained in supervisor review notes. Missing or invalid required details block generation/submission.
5. The email appears below the proposal. Recipient, subject, message and preparer autofill; **Edit email** lets employees override or reset them. **Prepare PDF & email** (or **Update PDF & email**) creates the finished package. Document changes require an updated package before submission. Leaving through navigation or signing out saves unfinished work, records the workflow step, and creates one **Pick up where you left off** notification per employee/inquiry. The dashboard has recent proposal shortcuts showing the next action. Browser-close saves use a keepalive request with a session backup for unsaved edits. Server revision checks prevent stale overwrites; an interrupted connection may require reopening and saving recovered work.
6. Submit to supervisors. The exact PDF, Word document, form details, email and source hash are frozen in a numbered review version. Earlier PDFs are identified from their saved metadata and source artwork layers, then labeled Earlier PDF layout. Preview current layout provides a read-only comparison using the same source hash and frozen proposal fields with the current native renderer; it does not replace the submitted PDF or email attachment. New packages record their layout version. Drafts using an earlier renderer must use Update PDF & email before submission. The shared renderer restores source PNG header artwork where LibreOffice hides flattened layers; original Word files, proposal text, backgrounds and saved submissions stay unchanged.
7. Sign out and sign in as Emerson or Zeo. Open **Approval Queue**. Return with a correction note or choose **Approve & email agent**.
8. Approval saves one `.eml` reply with the exact approved PDF to the local outbox. No additional employee send action is needed. Download the reply from the inquiry/history.
9. To test recovery, expand **Local delivery test** before approving and enable the failure option. **Retry approved reply** reuses the existing approval/package.

Employees and supervisors can select templates, edit details, use inline proposal assistance and prepare or submit editable inquiries; there is no exclusive assignment. Admin remains read-only for proposal preparation. Submitted and approved versions stay locked, including for supervisors; return a submitted proposal for correction before editing it. My Inquiries uses actual contributions. Viewing alone does not count. Conflicting saves are rejected using revision checks rather than overwriting a colleague’s work.

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

The source collection contains 13 masters across BureauHealth, CorpoAide 2, Total CorpoShield and Total CorpoHealthCheck. Completed customer examples are not imported as general templates. Benefits/rates are preserved from proposals; conflicting TOR/MOA terms are not blended in. Unknown or unsupported values are not manufactured.

To import the supplied source files again:

```powershell
python scripts/import-proposal-masters.py --source "D:/DOWNLOADS/rmc2 files/extracted"
```

Use the available Python interpreter. Import expects exactly the 13 unfilled proposal masters. It never changes the supplied originals. On another computer, copy the private source collection or run this importer before generating proposals. The original franchise form is expected in the source tree's grandparent Downloads folder.

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

The document test checks all 13 masters for artwork/layout preservation, professional greetings, proposal dates and Philippine contact formatting. The focused exclusive-handling browser test covers read-only access, lock transitions, draft recovery and independent PDF scrolling. The customized-proposal browser check covers inline content editing, refresh, phone layout, supervisor correction and approval. Workflow checks cover authentication, concurrency, corrections, immutable versions and exact approved attachments. Gmail and AI are still local simulations.


## Exclusive inquiry handling

Click **Start handling** to unlock preparation. Only one employee or supervisor can hold the editing lock for an inquiry at a time. Everyone else has **View only** access to the original form, templates, saved proposal and history. They cannot change details, select or customize a template, save, generate a PDF, request agent details, or submit that draft. The server enforces this on every write, including checking ownership again after PDF generation. The **Current handler** column shows one active person; historical contributors remain in the inquiry’s activity history.

**Done for now** saves changes before releasing the lock. Navigating away also saves and releases it. Submitting ends preparation and releases the lock; supervisor approval remains a separate permission. After a correction request, an employee must start handling again. No permanent assignments are created.

Lock checks refresh every 10 seconds while the workspace tab is visible. A disconnected/background session expires after 90 seconds without an update. Expired sessions cannot silently take back the lock. Unsaved edits stay on the device for recovery when handling resumes. Multiple tabs for the same employee share ownership; leaving one tab does not release another active tab. Revision checks still protect against conflicting changes between their tabs. Heartbeats do not change saved timestamps, revisions or contributor history.

Run the port-5190 test server with RMC2_DATA_DIR set to test-results/exclusive-handling/qa-data, then run node scripts/test-exclusive-handling.mjs. This focused check ages only isolated test activity rows. It covers simultaneous pickup, server enforcement, read-only previews, safe release, handler labels, expiry and local draft recovery. The workflow and customized-proposal checks also acquire handling locks before preparation.
