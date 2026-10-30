# RMC2 deployment readiness checklist

Last reviewed: **October 17, 2026**  
Current environment: **Local testing — no production deployment approved**  
Preferred hosting approach: **Managed services without administering a VPS**

Work through the priorities in order. Related tasks can run together once their dependencies are settled.

## How to track progress

- `[x]` means completed in the current local system or supported by recorded local checks. It does **not** mean verified on production hosting.
- `[ ]` means unfinished, undecided, or awaiting verification/sign-off.
- **Required** items block live use with confidential client data.
- **Conditional** items block launch only if that feature is included in the agreed first release.
- **Later** items are improvements that can follow a successful launch unless the client makes them required.
- When completing an open item, add the owner, completion date and evidence beneath it. Reopen it if the underlying setup changes.
- Keep passwords, API keys, client documents and recovery codes out of this checklist.

Completion note format: `Owner: ___ | Completed: YYYY-MM-DD | Evidence: ___`

## Priority 0 — Confirm what we are launching

**Required. Suggested participants: project owner, client representative, Emerson and Zeo.**

- [ ] Confirm the first-release scope: employees and supervisors, supported forms, approved templates, email workflow and whether live AI is included.
- [ ] Run an initial local testing session with employees and both supervisors; record issues before finalizing the release scope.
- [ ] Approve the client ownership rules: 30 days from a successful outgoing reply, progress-report reset from its actual sent date, same-agent rejection after expiry, and supervisor approval for a different agent after expiry.
- [ ] Approve the BOR process: acceptable evidence, who may verify it, handling multiple matches, disputed transfers and escalation ownership.
- [ ] Approve duplicate handling, including false matches involving common person names or shared company names. Document the resolution path when an automatic decline is disputed.
- [ ] Confirm file-viewing permissions. Today, all active staff can view inquiry files; the handling lock restricts editing. Decide whether division or assignment restrictions are needed.
- [ ] Estimate staff count, concurrent users, monthly inquiries, document sizes and conversion volume for hosting and storage sizing.
- [ ] Agree the monthly service budget, billing owner, support contact and acceptable recovery time/data loss.

Launch decisions:

| Decision | Agreed choice | Owner | Date |
| --- | --- | --- | --- |
| First-release scope | Pending | Unassigned | — |
| Live AI at launch | Pending; may be deferred | Unassigned | — |
| Staff viewing boundaries | Pending confirmation | Unassigned | — |
| Hosting, database and file storage | Pending | Unassigned | — |
| Monthly budget and billing | Pending | Unassigned | — |
| Recovery targets and support | Pending | Unassigned | — |

## Priority 1 — Complete the production foundations

**Required before live use. Local features listed below are already implemented; their production setup remains open.**

### 1. Hosting, database and private storage

- [x] Shared local SQLite database and private document folders are connected.
- [x] Saved updates are shared between staff accounts; connected screens refresh approximately every ten seconds.
- [x] The local PDF converter is connected.
- [ ] Select managed hosting that supports the Node application and document conversion workload, or a separate managed conversion worker.
- [ ] Choose the production database: retain SQLite on durable storage with an appropriate single-instance design, or implement migration to managed PostgreSQL. Supabase is optional.
- [ ] Choose durable private document storage for originals, PDFs, Word files, template versions, BOR evidence and progress reports.
- [ ] Configure client-owned hosting/service accounts, domain, DNS, HTTPS and restricted service credentials.
- [ ] Create separate staging and production environments with separate data, secrets and email destinations.
- [ ] Make startup configuration portable; remove dependence on this computer's drive paths and converter location.
- [ ] Verify records and uploaded documents survive application restarts and redeployments.
- [ ] Document the instance/worker design. Do not add multiple app workers without verifying shared transactions, editing locks and job ownership.
- [ ] Staging (online test): a free, test-data-only trial via a Cloudflare quick tunnel from a local PC is prepared in `STAGING.md` (separate data directory, fresh random passwords, local email outbox). It is a temporary test aid, not the staging environment required above; run it only with Product Owner approval.
- [ ] Real email phase 1 (staging copy only): sends only when the Product Owner creates `.env.mail.test` (gitignored, never in `.env.local`); every message is redirected to the PO test inbox, dry run by default, capped at 5/hour and 20/day. Setup, verification and rollback (delete the file, revoke the app password) are in `STAGING.md`. No production mail is enabled.

### 2. Accounts, access and confidentiality

- [x] Admin, employee and supervisor roles are implemented, including approval permissions.
- [x] Admin can create accounts with temporary passwords that require replacement before accessing records.
- [x] Staff can change their own username/password after confirming their current password.
- [x] Password hashing, login throttling and session revocation on credential changes are implemented.
- [x] Private file downloads require an authenticated staff session; relevant downloads are logged.
- [x] Private runtime files and configuration are excluded from Git.
- [ ] Replace all shared demonstration credentials with individual production credentials and verified staff details.
- [ ] Prevent production startup from automatically creating demo accounts/sample records. Disable local-only failure simulation and test-delivery controls in production.
- [ ] Add MFA, at least for administrators and approving supervisors, and agree the policy for other staff.
- [ ] Implement secure forgotten-password recovery and recovery for a lost MFA device.
- [ ] Apply the approved viewing boundaries and test both permitted and forbidden access through the server.
- [ ] Verify account deactivation/offboarding immediately prevents access and releases editing sessions; assign an owner for periodic access reviews.
- [ ] Configure encryption for production storage and backups, protected secrets, and restricted infrastructure access. The local application does not itself encrypt its SQLite file or document bytes at rest.
- [ ] Add private malware scanning/quarantine before processing uploaded forms, BOR files, reports and Word templates. Existing file checks are not a malware scanner.
- [ ] Review dependencies, upload limits, authentication/session behavior and file access for production security; resolve critical findings before launch.
- [ ] Agree retention/deletion rules covering originals, Archives, proposal versions, audit logs and backups, plus an incident response contact/process.

### 3. Real email and trustworthy intake

- [x] Local test emails preserve the approved recipient, message and exact proposal attachment.
- [x] Excel forms can populate inquiry fields; original Excel/PDF attachments are preserved.
- [x] The local workflow includes approval, failed-delivery handling and retry controls.
- [ ] Connect the authorized business mailbox with securely stored credentials and appropriate access permissions.
- [ ] Implement and test incoming message/attachment processing, sender identity checks and duplicate-message prevention.
- [ ] Match incoming messages to the correct inquiry and agent. Do not trust a typed sender address as independent proof of identity.
- [ ] Test real outbound email with explicitly approved test recipients, including the exact approved attachment and reply/thread behavior.
- [ ] Handle provider failures, expired authorization, uncertain delivery results and retries without sending a second proposal accidentally.
- [ ] Define and verify the successful-send event that starts the 30-day timer. A failed send must not start it.
- [ ] Decide whether progress reports remain staff-recorded for launch or are automatically ingested; document the chosen operating procedure.
- [ ] Clearly separate staging/test mail from production mail and remove misleading local-test status labels in the live environment.

### 4. PDF conversion and recoverable jobs

- [x] Standard proposal autofill and editable customized copies are implemented.
- [x] Selected-template preview and approval preparation use the current proposal data/source version.
- [x] Customized benefit tables fit the browser editor's document pane.
- [x] Submitted packages retain their PDF, Word document, fields, email and source master.
- [ ] Install and verify the converter and required fonts on the chosen host.
- [ ] Check all active templates on the hosted runtime for branding, tables, rates, placeholders, page breaks and long client names.
- [ ] Test that preview, downloaded PDF, supervisor version and actual emailed attachment agree for both standard and customized proposals.
- [ ] Add restart-safe job ownership, status, retries and recovery for conversion and email work. Current process-local safeguards are not a complete distributed job system.
- [ ] Test simultaneous conversions, timeouts, service restarts and deployments during processing; confirm users receive a clear recoverable status.

The HTML editing view is not the final print layout. Some unsupported decorative Word layers are omitted there; the native PDF preserves the source artwork. Review the PDF as the final output.

### 5. Backups, monitoring and operating ownership

- [x] A manual local SQLite snapshot was taken before the latest restart.
- [x] Admin-only monitoring shows database, storage and converter checks, plus clearly labelled AI/email test states.
- [x] An AI usage ledger and admin totals screen exist; no live provider usage is currently recorded.
- [ ] Configure automated, encrypted, separate-location backups at a frequency that meets the agreed data-loss target.
- [ ] Include both database records and every referenced file, plus the private source catalog/templates and configuration needed to rebuild the system.
- [ ] Restore a backup into an isolated environment and verify originals, BOR evidence, reports, accounts, deadlines and proposal versions actually open and work.
- [ ] Configure automatic alerts for downtime, failed mail/conversion jobs, backup failures and storage exhaustion. The current checks run on request.
- [ ] Add an external availability check that can report an outage even when the application or database cannot respond.
- [ ] Configure protected operational logs and service cost/usage alerts; avoid logging passwords or unnecessary confidential content.
- [ ] Assign owners and schedules for application/dependency updates, backup review, access review, restore drills and incident handling.

## Priority 2 — Verify the complete workflow and approve release

**Required launch gate after Priority 1. Local implementation is complete for the checked features; staff acceptance on the hosted setup is still required.**

### Current workflow features

- [x] Exclusive employee handling lock; colleagues can view while another staff member edits.
- [x] Thirty-day agent protection indicator and staff-recorded progress reports that reset the deadline from the report's sent timestamp.
- [x] Account/person/file duplicate checks with links to the matching inquiry.
- [x] Decline request and Archives, with retained files and history.
- [x] Automatic decline for a same-agent repeat after expiry.
- [x] Supervisor approval for another agent after expiry, retaining a link to the expired registration.
- [x] Staff-verified BOR transfer with evidence, verifier details and linked history.
- [x] Both approving supervisors can edit a review copy, save a new version, and approve it while the prior submission remains preserved.
- [x] Admin upload of new/replacement templates, staged PDF preview, explicit publishing and source history.
- [x] CorpoAide variants are retired from new selection; historical files remain available.
- [x] Larger notification/approval counts are visible in navigation.

### Recorded local verification

- [x] Seventeen server workflow check groups passed for accounts, permissions, expiry, BOR, templates, supervisor versions and service checks.
- [x] Nine browser check groups passed for role visibility, previews, customized tables, supervisor editing, cancellation and mobile Settings.
- [x] The production build, TypeScript and focused lint checks passed. This is not a claim that every repository-wide lint check passed.
- [x] The restarted local app retained its twelve existing inquiries and six staff accounts, with eleven active supplied templates.
- [x] Archive optimization: ten scaling groups with 5,000 fictional history-heavy records and eight paging/browser groups passed. Thirty-four client-protection checks and the existing 17 workflow/9 browser groups also passed after the changes.
- [x] Before the optimization restart, a consistent SQLite snapshot and file inventory were saved. After restart, all twelve inquiry records, six accounts and 189 retained files matched their prior checksums. A local snapshot does not complete the off-site recovery requirements above.

These are the recorded October 17 results, not proof of live email, real AI, cloud storage, off-site recovery or hosted performance. Repeat affected checks when the relevant code, configuration or runtime changes.

### Hosted acceptance and release

- [ ] Have employees complete inquiry intake, handling, standard/customized preparation, submission and returned corrections in staging.
- [ ] Have Emerson and Zeo each edit, approve, decline and return proposals; verify previous versions remain accessible and unchanged.
- [ ] Test simultaneous staff sessions, competing approvals/transfers, stale screens, interrupted connections and released editing locks.
- [ ] Test expiry boundaries, late/stale reports, same-agent reapplications, different-agent approvals, false matches and BOR handovers using controlled dates and identities.
- [ ] Verify an unavailable/expired request cannot proceed through a direct server request, not just through disabled buttons.
- [ ] Confirm admin-only screens and endpoints remain restricted, and temporary/deactivated accounts cannot retrieve files.
- [ ] Obtain business-owner sign-off on current templates, rates, wording, branding and final PDFs.
- [ ] Train staff on BOR verification, duplicate decisions, progress-report recording, password recovery and support escalation.
- [ ] Prepare a migration plan and secure pre-launch backup. Exclude fictional test records from production without deleting historical business records accidentally.
- [ ] Review and commit the intended release changes; verify Git/build artifacts contain no private runtime data or secrets. Record the release version.
- [ ] Rehearse deployment and rollback, including compatibility with database changes and retained private files.
- [ ] Run a limited staff pilot with approved data and recipients, resolve blocking findings, then obtain launch approval.

Release sign-off:

| Sign-off | Status | Owner / approver | Date / evidence |
| --- | --- | --- | --- |
| Workflow and template acceptance | Pending | Unassigned | — |
| Security, access and privacy acceptance | Pending | Unassigned | — |
| Live email and document acceptance | Pending | Unassigned | — |
| Backup restore and deployment rehearsal | Pending | Unassigned | — |
| AI scope decision / acceptance if included | Pending | Unassigned | — |
| Final go-live authorization | Pending | Unassigned | — |

## Priority 3 — Live AI, if included in the first release

**Conditional. If live AI is included, complete this section before Priority 2 sign-off. Otherwise, record its deferral and accurately label or hide simulated features.**

- [x] Source-based simulated assistance and an admin usage display are available for local testing.
- [ ] Choose the provider/model, approve permitted data and retention settings, and set billing ownership and usage limits.
- [ ] Implement authenticated server-side provider calls; keep credentials out of the browser and Git.
- [ ] Record actual provider-reported token usage and establish cost/usage alerts.
- [ ] Test supported answers, wrong/missing source information, fabricated rates, conflicting templates and instructions embedded in uploaded documents.
- [ ] Preserve employee/supervisor decision authority. An AI suggestion must not authorize transfers, alter approved packages or bypass approval.
- [ ] Test timeout/provider-failure behavior so staff can continue the core workflow.
- [ ] Obtain acceptance for accuracy and confidentiality, or explicitly defer live AI for this release.

## Priority 4 — Improvements after the launch blockers

**Later by default. Promote an item to required if staff testing or the agreed launch scope establishes a need.**

- [ ] **Stable agent directory:** verified agent IDs, approved contact addresses and controlled identity changes so email variations do not create accidental new identities.
- [ ] **Expiry reminders:** scheduled staff notifications before the deadline, with timing agreed by the business.
- [ ] **Duplicate comparison view:** show matching fields and source forms side by side for faster, better-supported review.
- [ ] **Automatic progress-report intake:** identify the sender/client, prevent repeated processing and preserve the report's actual sent date. Required sooner if included in launch scope.
- [ ] **Central admin audit viewer:** search account changes, downloads, decisions and transfers with appropriate access and export controls.
- [ ] **Template effective dates and controlled rollback:** introduce a new master on an agreed date or restore an earlier master while retaining history.
- [ ] **PDF field extraction/OCR:** propose values from scanned forms with staff confirmation; manual PDF field entry remains the current fallback.
- [x] **Paged inquiry and notification lists:** 25 summaries per page, server-side search/filtering, detail-on-open and conditional shared refreshes; indexed duplicate candidate lookup. Local checks cover 5,000 history-heavy fictional records.
- [ ] **Hosted volume acceptance:** measure the agreed historical volume, simultaneous staff sessions, attachment storage and PDF queue on the chosen hosting plan. The local scaling test does not establish production capacity.

## Final deployment decision

- [ ] Priority 0 decisions are recorded.
- [ ] Priority 1 production blockers are completed with evidence.
- [ ] Priority 2 hosted acceptance and release sign-offs are complete.
- [ ] Priority 3 AI work is accepted or explicitly deferred with accurate product labels.
- [ ] Deferred items have owners and an agreed follow-up plan.
- [ ] The client has approved the launch date, support arrangement and service costs.

**Current decision: continue local/staging preparation. Production launch is not yet signed off.**

## Evidence and related documents

- `WORKSPACE_UPDATES.md` — latest implemented behavior, accounts, templates and monitoring.
- `PROJECT_GUIDE.md` — full system overview, architecture and operating notes.
- `PRIVACY.md` — file access and outstanding confidentiality controls.
- `LOCALHOST.md` — local operation and testing setup.
- Local check records: `test-results/workspace-upgrade/checks.json` and `test-results/workspace-upgrade/browser/checks.json`. These are private local test artifacts, excluded from Git.

This checklist records implementation and verification status. Checked local items do not authorize deployment or replace hosted acceptance and business sign-off.
