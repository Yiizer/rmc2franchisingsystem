# Workspace updates — October 17, 2026

This document describes the current local workflow changes. The application still uses the shared SQLite database and private local files. Email delivery and AI assistance remain in local test mode.

## Archive and refresh optimization — October 17

- Inquiry and notification lists load 25 summaries per page. Search, division and status filters search the full matching collection on the server.
- Opening an inquiry loads its complete details and saved PDF classifications. Historical source cells, email bodies and proposal versions are no longer sent with every list refresh.
- Visible tabs check for shared changes every ten seconds and on focus. Unchanged checks return a small response; catalog/staff metadata is resent only after it changes. Late responses cannot replace a newer screen or saved revision.
- SQLite indexes narrow duplicate candidates by account, person and submitted-file hash. Existing expiry, same-agent, BOR, false-match and transaction rules remain authoritative. Derived indexes can be rebuilt from original records.
- Notification counts cover all pages. Mark all as read affects only the signed-in staff member. Duplicate links and BOR review fetch the linked inquiry directly, including records outside the current page.
- Local scaling checks cover 5,000 fictional inquiries with substantial history: about 11 KB for a cached-metadata list page and 94 bytes for an unchanged refresh. Hosting, storage capacity and concurrent conversion throughput still require separate validation.

Run `node scripts/test-workspace-scaling.mjs` without a server; it creates a fresh isolated database under `test-results/workspace-scaling/`. Run `node scripts/test-workspace-pagination-browser.mjs` against the port-5190 workspace-upgrade QA server. Browser fixtures are removed after the check, and the working port-5173 data is not used.

Optimization validation passed: 10 scaling check groups, 8 paging/browser groups, 34 client-protection checks, 17 workspace workflow groups and 9 preview/supervisor browser groups. The Webpack production build and TypeScript checks passed; focused lint had no errors (existing image-element and unused-import/destructuring warnings remain). The restarted port-5173 app retained all 12 inquiry records and 6 accounts byte for byte, and all 189 retained attachment/generated/outbox/source files matched their pre-restart checksums. The database snapshot and inventory are in the ignored `.data/backups/before-optimization-*` folder; this local database snapshot is not an off-site full-file backup.

## Client registration decisions

### Decline and archive

An open request has a **Decline request** action. Staff must record a reason of at least ten characters. The request becomes `Declined`, appears in Archives, releases its preparation lease, and keeps its original form, matching inquiry link, files and history. An approving supervisor must decline a request already in supervisor review. An approved or sent proposal cannot be declined as a new request.

### Same agent after expiry

Matching checks consider expired registrations when the incoming agent is the same as the previous agent. Matching a company/account, client/addressee or source file flags the repeat and automatically declines the new request. The record links to the expired inquiry in Archives. This also runs when a PDF import's client details are entered later.

Agent identity uses the submitted agent email when both registrations have one; otherwise it uses a normalized agent name and phone. This is a deterministic check of recorded identity, not independent authentication of the sender. Live inbox identity verification remains future integration work.

A different agent can request a client whose protection has expired, but processing remains on hold until an approving supervisor chooses **Approve new agent after expiry** and records the reason. An ordinary availability recheck cannot bypass that approval. Verified BOR is the separate staff-verified transfer path. Seeded sample inquiries do not reserve clients.

After approval, the expired record remains in Archives with a transfer link to the new registration. It does not block subsequent legitimate handovers to other agents. It still serves as expired-registration evidence if its former agent submits the client again.

### BOR transfers

For a different agent whose request conflicts with one existing registration, staff can choose **Verify BOR & transfer**. The action requires:

- The specific current registration and its revision.
- A BOR reference and verification notes.
- The original BOR as a PDF, PNG or JPEG, up to 7 MB.
- Confirmation that the staff member checked authenticity, client identity and authorization for the incoming agent.

The transfer is transactional: it archives the previous registration as `Transferred`, activates the incoming request, releases related preparation leases, and records the verifier, timestamp, reference and two-way inquiry links. The BOR is stored privately, and its download is authenticated and audited. Original proposals and previously sent messages remain unchanged.

Conflicting simultaneous changes fail instead of silently replacing another decision. A colleague's active preparation lease must finish before the transfer. Multiple matching registrations need review before a single-client BOR transfer. BOR verification is performed by staff; uploading a file does not prove that it is authentic.

The new registration reserves the client immediately. Its 30-day countdown begins with its first successful outgoing reply/proposal, following the existing timer rule.

## Template library

The three CorpoAide 2 variants (`D091`, `D092`, `D093`) are retired from new selection and recommendations. Their masters and previous proposal versions remain available for history. The original supplied catalog contains fourteen retained entries, of which eleven are active before any subsequent admin uploads.

**Admin → Proposal Templates** supports adding a template or uploading a replacement:

1. Enter the family, variant, applicable sector, premium schedules and source notes.
2. Upload a `.docx` up to 15 MB.
3. Review the PDF produced from the exact uploaded bytes.
4. Confirm the source details and publish.

Validation checks readable Word/XML structure, supported placeholders, expanded content size, macros, embedded/active objects and external relationships. Invalid templates do not become active. These checks are not a malware scanner.

Sources use immutable SHA-256 filenames under `.data/templates/`; previews are private. SQLite `template_overrides` stores the published catalog entries and `template_versions` stores staged, published and previous versions. A replacement checks the expected current source hash before publishing. Publishing a staged upload again is idempotent. Retiring a template hides it from new use without deleting files.

Backups must include both SQLite and the private file tree. The original importer and `resources/private/` remain the baseline for supplied masters; administrator-published overrides take precedence. Never replace these directories with an empty deployment image.

## Preview and customized document

The template modal uses the same current fields, selected customized copy, source version and matching saved PDF as Preview & approval. Changing the template source causes the editor to reload that version. An explicitly stale working preview remains marked until **Update preview** is clicked.

The editable Word view fits oversized benefit tables to the page content area and scales the page to the document pane. Table column proportions are retained. This changes browser display only; source Word tables and export assets are preserved. Unsupported oversized legacy VML decorative layers are omitted from the HTML edit view so they cannot obscure text; the native PDF keeps the source artwork. **PDF preview** remains the final layout check.

## Supervisor edits

Emerson, Zeo, and any active supervisor with approval permission can choose **Edit before approval**:

1. Open a separate customized review copy from the submitted version's archived master.
2. Start handling to obtain exclusive editing access.
3. Change proposal details, email text, paragraph text, rates or benefit cells.
4. Update the preview and prepare the PDF/email.
5. Choose **Save reviewed version**.
6. Review the new version, acknowledge customized changes and approve it.

The status is `Supervisor editing` while this copy is open. Employees can view it but cannot edit it. A second supervisor cannot edit or approve around the first supervisor's active lease. When the lease expires another authorized supervisor can pick it up.

The submitted master is retained even if an administrator publishes an updated library template during review. The selected plan cannot be changed during supervisor edits; return the proposal to change plans. The original submitted PDF, fields and email stay intact. The reviewed version records its parent version and editing supervisor; the earlier version records which version superseded it. Either authorized supervisor can approve the new version. **Discard supervisor edits** restores the existing submitted review without deleting the abandoned customized draft from history.

## Accounts and settings

Existing staff accounts remain. Sign-in accepts a username or email; an initial seeded account's username is its existing short ID, such as `cryssa` or `emerson`. The public login screen no longer lists all staff or displays the shared local test password.

Every staff member can change their username and password in **Settings**, with their current password required. New passwords require at least fourteen characters. Passwords use salted scrypt hashes and never appear in bootstrap responses or audit logs. Saving credentials revokes all sessions and preparation leases for that account, including the current session; the person signs in again.

**Admin → Users & Roles → Create account** requires the administrator's current password. The server creates a random temporary password, shown once, and requires the person to replace it before accessing records or taking actions. The admin should share it privately. Usernames/emails must be unique. Repeated login or password-verification failures are throttled. Account creation and credential changes produce security audit events without passwords.

Legacy demonstration passwords have not been silently changed: existing local staff should set individual credentials in Settings. MFA, forgotten-password recovery, production identity enrollment and an independent security assessment are not implemented. These controls are not a guarantee of 100% security.

## Admin monitoring and notifications

Monitoring is visible and accessible only to Admin. It reports:

- Database connectivity.
- Private storage write access.
- Converter availability, with an explicit end-to-end Word-to-PDF check.
- Email and AI provider state, clearly marked as test mode.
- Recorded AI request, input-token and output-token totals for the last thirty days.

The current assistant does not call a live AI model, so provider token totals are zero. `ai_usage` is the server-side usage ledger; a future provider integration must record actual provider-reported usage there. Connectivity results have a checked timestamp and are refreshed on request. There is no autonomous infrastructure alerting or external provider health integration yet.

Unread notification and approval counts use larger, high-contrast badges. The top-bar notification button shows the unread count.

## API additions

All paths are under `/api/operations`. Business changes use POST; access controls are enforced by the server.

| Route | Purpose |
| --- | --- |
| `POST /inquiries/:id/decline` | Reasoned decline and archive |
| `POST /inquiries/:id/bor-transfer` | Multipart verified transfer and evidence |
| `GET /file/:id/bor` | Private BOR download |
| `POST /inquiries/:id/begin-review-edit` | Create a supervisor review copy |
| `POST /inquiries/:id/cancel-review-edit` | Restore submitted review |
| Existing `save`, `generate`, `submit` | Permission-aware supervisor editing and new version |
| `POST /account-settings` | Verify current password and update own credentials |
| `POST /create-account` | Admin staff provisioning |
| `POST /template-upload` | Validate and stage a Word template with PDF preview |
| `GET /template-stage/:id` | Admin preview of the staged PDF |
| `POST /template-publish` | Publish a reviewed stage |
| `POST /template-active` | Retire/reactivate a template |
| `GET /template-history` | Admin version history |
| `GET /monitoring` | Admin service status and usage totals |
| `POST /monitoring-check` | Admin active conversion/connectivity check |

## Validation

Use a separate server on port 5190 with `RMC2_DATA_DIR=test-results/workspace-upgrade/qa-data` for `scripts/test-workspace-upgrade.mjs` and `scripts/test-workspace-upgrade-browser.mjs`. These checks create fictional records, update only the QA catalog/database, and never send external mail. Generated results and screenshots are under `test-results/workspace-upgrade/` and excluded from Git.

The checks cover role restrictions, current-password verification, session revocation, rate limits, duplicate expiry rejection, decline/archive, BOR transfer/private evidence, source replacement and history, supervisor edits across a template update, immutable prior submissions, exact delivered PDF bytes, document fitting and browser controls.

Latest validation: 17 server workflow groups and 9 browser groups passed, along with the production build, TypeScript and focused lint checks. The restarted local app retained all 12 existing inquiries and 6 staff accounts, with 11 active templates. A SQLite snapshot was saved under the private `.data/backups/` folder before restarting. QA records and uploads stayed in the separate QA database.
