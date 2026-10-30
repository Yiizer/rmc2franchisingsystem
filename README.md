# RMC2 Franchising System

A working Next.js application for testing the inquiry-to-proposal workflow on localhost. It includes authenticated staff accounts, shared inquiries, Excel intake, Word/PDF generation from 11 active supplied proposal masters (3 retired masters retained for history), editable email autofill, versioned supervisor review, notifications and an audit history.

Any employee can pick up an inquiry. My Inquiries shows actual contributions. Emerson or Zeo can return a proposal for correction or approve it; one approval automatically creates the finished agent reply with the approved PDF in the local test mailbox. Conflicting edits and duplicate sends are rejected.

## Start locally

Requires Node.js 22.13+, npm and the private source collection. Source files are already imported on this computer.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173/**. For the production build, use `npm run build` followed by `npm start`. On a new, empty data directory production mode creates no demo accounts; set `RMC2_SEED_DEMO=1` to get the local test accounts.

Sign in with your username or email. Initial local accounts share the password **Rmc2Local!2026**. These credentials are for local testing.

See [LOCALHOST.md](LOCALHOST.md) for account details, source import, workflow testing, storage and document conversion.

See [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for the detailed project handover: current features, permissions, workflows, architecture, APIs, testing, hosting options, maintenance and production milestones.

Use [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) to track completed local features, remaining production requirements, priorities and release sign-offs.

See [PRIVACY.md](PRIVACY.md) for the 30-day agent countdown, duplicate-client holds, progress reports, Archives, confidential-file access controls, and remaining production privacy requirements.

## Current connections

The server saves records in SQLite and private files on this computer. Data survives browser and server restarts. Gmail is a local `.eml` outbox; no external email is sent. AI assistance is simulated and uses only the form and supplied proposal sources.

The original proposal masters and uploaded forms are preserved. Benefits and rates remain sourced from proposals, with no TOR/MOA blending. Submitted versions freeze the PDF, Word document, email and source master.

Online deployment still needs managed hosting, persistent private storage, backups and production account configuration. Supabase is optional: a single hosted application can keep SQLite and share saved updates with all employees; the app checks for shared updates every 10 seconds. Live Gmail and AI integrations need separate implementation. The previous hosted static demo is separate from this server-enabled version.

## Validation

```powershell
npm run build
npm run typecheck
node scripts/test-proposal-fields.mjs
node scripts/test-form-viewer.mjs
node scripts/test-custom-document-integrity.mjs
npm run test:workflow
node scripts/test-customized-proposals.mjs
```

Run workflow/browser checks against an isolated QA server on port 5190 with its own `RMC2_DATA_DIR`; see [LOCALHOST.md](LOCALHOST.md#checks) for setup. Do not point tests at the working database. They create test inquiries and never send external email. The control check temporarily disables Zeo and restores the original permissions to verify that the last approving supervisor cannot be removed.

Private source documents, test output, database files and local configuration are excluded from Git.
