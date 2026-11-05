# Demo checklist (presentation, 2026-11-06 10:00)

- **Link:** https://rmc2-test-yiizer.vercel.app (the test version)
- **Passwords:** `test-results/online-credentials/CREDENTIALS.txt`, which is git-ignored and never shared. Open it on the presenting PC only.
- **Sign in:** on the presenting browser beforehand, using the Vercel account (`yiizer`), or create a revocable Vercel share link.

## Accounts (all `@rmc2.local`)

| Role | Account | What they see |
|---|---|---|
| Head | emerson | Everything, Users & Roles, Proposal Templates, Monitoring (AI usage), approvals |
| Supervisor | zeo | Everything except accounts and templates; approvals |
| Employee | cryssa, jefferson, judy | Inquiries, preparing proposals, Requests |
| Division Head | divisionhead@rmc2.local (Division 4) | My Clients, Submit inquiry only. Already linked: Rizal Coastal Foods (Sent, 30 days left), untouched for the live report demo |
| SOA | soa (Division 4) | My Clients, Submit inquiry only. Linked: Pacific Crest Builders (it already has one approved report, from the 2026-11-06 smoke test) |
| IT Admin | admin | Monitoring (full), Integrations, password resets for Employees |

Use separate browsers or private windows for each person you show side by side (for example Edge for cryssa, Chrome for zeo).

## Suggested order (about 20 minutes)

1. **Fast email pull-in (Requests / dashboard).** Send a franchise form by email to the test inbox. It appears in about 30–45 seconds, and the times show as "Nov 6, 2026, 9:58 AM".
2. **Locking (two browsers: cryssa and jefferson).**
   - cryssa: Start handling.
   - jefferson sees "Cryssa … is handling this inquiry · 2m" and presses **Request handover**.
   - cryssa sees the request with **Release** / **Keep working**.
   - zeo opens the inquiry and shows **Take over**.
3. **Proposal PDF.** Prepare a proposal with an updated template (e.g. Total CorpoHealthCheck). The preview is clean: tables stay together and the signature appears only on page 1.
4. **Division Head flow (division-head).**
   - **Submit inquiry:** upload a franchise form.
   - **My Clients:** the client appears with its status.
   - **Duplicate test:** submit the same client as `soa`. They see only "This client is already protected."
5. **Progress report.**
   - **Set up first:** a Sent client owned by division-head. Link the owner from an Employee account before protection starts.
   - **division-head:** file a progress report. It shows as "Held — report under review".
   - **zeo:** Approval Queue → **Progress reports** → Approve. The 30 days restart from today.
   - **division-head:** sees Approved and the new date.
6. **Client Directory.** 3,579 real records:
   - Filter by **Division** (e.g. Division 4) and **Category** (AMAPHIL, SOA / MOA, …). The default sort is latest activity.
   - Unclear branches show the original text, and Unassigned shows the ones waiting on the client.
7. **Roles.**
   - emerson: Users & Roles. Create an account with the Division select.
   - zeo: show that Users & Roles and Templates are not there.

## Known limits (say so if asked)

- **Phone notifications:** not built yet. Next step, iPhone first.
- **Email signature:** waiting for the client's example.
- **Division table:** 575 old records sit under Unassigned until the client answers the branch questions (blank rows, Tacloban, Gensan, Iloilo, Batangas, the team label, and records naming two divisions).
- **Email:** in test mode. Every email goes to the test inbox. Sending is capped per hour and per day; the demo-day caps are set on the test project (`RMC2_MAIL_CAP_PER_HOUR` / `_PER_DAY`). Keep the number of sends small.
- **Test data:** the directory is real client data on a test system (PO decision).

## Before 10:00

- [ ] Open the link and sign in once as each account you will use.
- [x] One Sent client ready for the Division Head (step 5 setup). `scripts/demo-link-owner-clients.mjs` was run on 2026-11-06.
- [x] Online smoke test on 2026-11-06 passed 27/27: logins for all six roles, the Division Head's restricted view and refusals, the sent PDF, report → approval → 30 days, the directory and the Head's AI-only monitoring.
- [ ] Have the sample form `test-results/Franchise-Form-Mabini-Integrated-School.xlsx` (or another) ready to email and upload.
- [ ] Check the email cap is not used up: look on the Requests page.
