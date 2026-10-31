# Confidential files and client protection

## What the application enforces

- Original forms, progress-report attachments, generated proposals and local email files are stored under the private `RMC2_DATA_DIR`, outside `public/`.
- Private originals and local databases are excluded from Git. The GitHub repository currently contains application code, not the working files or records.
- File routes require an active authenticated staff session. Deactivated and expired sessions cannot retrieve files. An inquiry ID or copied download URL does not grant public access.
- All active franchising staff can view inquiries and their files, as required by the shared workspace. The employee handling lease limits editing, not viewing. Supervisors/administrators control false-positive duplicate reviews.
- File responses use private/no-store caching, same-origin resource restrictions, safe download names and content-type protection.
- Original form, saved PDF/Word/email, archived-master and progress-report retrievals are recorded in the SQLite `file_access` table with the staff ID, inquiry ID, file kind and timestamp. Access events do not change the inquiry, handler or approval version. Original template retrievals are logged separately.
- Progress reports accept PDF/PNG/JPEG attachments up to 7 MB, check their file signatures, use generated private filenames, and retain the uploaded bytes. These checks are not a malware scanner.
- Progress-report recording and duplicate decisions retain the actor, timestamps and reason/reference in the audit history.
- AI assistance and email delivery are still simulated/local test features. No live AI provider receives these files through the current app.
- All data files go through one storage layer. By default (`RMC2_STORAGE=local`) they stay under `RMC2_DATA_DIR` as described above. With `RMC2_STORAGE=supabase` they live in a private Supabase Storage bucket instead: the bucket must not be public (the admin health check reports a public bucket as unhealthy), the Supabase secret key is used by the server only and is never sent to the browser, and Supabase encrypts stored data at rest. Staff still reach files only through the authenticated, access-logged routes above.

## Before using confidential production data online

1. Replace the local demonstration accounts and shared published test password with individual production identities. Admin account creation, credential changes, session revocation and login throttling now exist. Add MFA, recovery and production enrollment policies; the public account selector has been removed.
2. Use HTTPS and private persistent storage. Require encryption for the database, document storage and off-site backups; this application does not itself encrypt the current SQLite file or document bytes at rest.
3. Keep encryption keys and credentials outside Git, public folders and application logs. Limit infrastructure access to the people responsible for operations.
4. Revisit which staff can view which files if the organization needs stricter division/account boundaries. The current shared workspace intentionally permits all active franchising staff to view files.
5. Scan uploads in a private malware-scanning service or quarantined worker before processing. Do not send confidential files to public scanning services without authorization. Add upload limits at the hosting/proxy layer as well as in the application.
6. Back up both the SQLite database and private file tree, encrypt the backups, and test restores. A database-only backup will not include document bytes. Protect audit logs and define their retention and review process.
7. Define retention, deletion and access-review policies. Archives preserve records; they do not delete data or make it public. Removing live data must account for historical versions, logs and backups.
8. If real AI is connected, approve the provider, retention settings and permitted fields first. Send only the information needed for the requested check. Live email requires verified recipients and appropriate permission scopes.

The repository being private is a useful additional control for source code. It does not replace private file storage, access checks, encryption or production authentication. If a secret or confidential file is ever committed, removing its latest copy does not remove it from Git history.

These deployment measures are based on [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), and [cryptographic storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

## Client protection rules

- A client registration is separate from the employee editing lease. Client ownership belongs to the agent recorded on the inquiry.
- The first successful proposal delivery or request-for-details reply starts 30 consecutive days. Failed sends, approval alone, browsing and staff edits do not start or extend the countdown. The current send event is a local-test delivery, not a live Gmail confirmation.
- Further outgoing replies do not silently extend an existing deadline. A progress report from the registered agent resets it to the report's sent timestamp plus 30 days. The original start date remains available.
- Staff record the report after checking its sender, sent date, reference and progress summary. The sender must match the registered agent email. Future, stale and out-of-window report dates are rejected. Recording a report after protection has expired is rejected; it cannot reclaim a client from a new agent. Live mailbox ingestion is not implemented yet.
- Repeating the same report request is idempotent. Reports keep the recording employee, receipt timestamp, reference, summary and optional original attachment.
- Completed work is never held: a record whose proposal was approved (including sending or email-failed) or whose protection has started is treated as registered and stays clear even if its client details match another registration. Such matches are shown only as informational "also registered" overlaps and block nothing. A newer request from another agent stays on hold until the first claim is closed or its protection expires.
- On expiry the old inquiry appears in **Archives** and becomes read-only for preparation. The original workflow status, forms, reports, emails, decisions and submission versions remain intact. Another agent may submit a new form, but processing waits for an approving supervisor to approve the new registration. A staff-verified BOR is a separate transfer path.
- Archives are computed from stored deadlines, so the rule continues across restarts and does not require an always-open browser or a scheduled job. Connected screens refresh shared data every ten seconds; server checks use the current time on each action.
- A normalized account/company match, normalized client/contact/addressee-name match, or identical uploaded file flags an import. Comparisons include immutable submitted identity values as well as working details; punctuation, casing, common company abbreviations and professional titles are normalized.
- Active same-agent repeats and different-agent conflicts go on hold and link to the existing inquiry. A repeat from the same agent after expiry is automatically declined and archived. Original duplicate files are preserved as evidence; they do not become processable second registrations.
- The server prevents duplicate pickup, saving, customization, generation, submission, approval, sending and countdown renewal. UI disabling is not the only enforcement.
- PDF intake without identifiable client details is held until staff enter and save those details. It cannot proceed to proposal preparation first. Identical PDFs can be flagged by their file hash before identification.
- A supervisor with approval permission or an administrator can confirm different clients after reviewing the forms and recording a reason. That exception applies only to the reviewed pair of identities, works in both directions, and is invalidated by identity changes. It is not a transfer override for the same protected client.
- Previously flagged submissions stay on hold after another inquiry expires. Staff can explicitly recheck availability; if a new agent has already registered, the conflict still blocks them. Concurrent registrations are checked inside a SQLite write transaction.
- Starting demonstration rows are not actual submitted registrations and do not reserve real clients. Real imported forms use the rules above.

## Verification without production files

Run a freshly built server on port 5190 with `RMC2_DATA_DIR` pointing to `test-results/client-protection/qa-data`, then run:

```powershell
node scripts/test-client-protection.mjs
node scripts/test-client-protection-browser.mjs
```

The checks generate fictional workbooks and PDFs in the isolated QA directory. They cover exact expiry, agent conflicts, same-agent repeats, false matches, PDF identification, progress dates, idempotency, immutable sent data, archived access, simultaneous registrations and authenticated private downloads. No external email is sent.
