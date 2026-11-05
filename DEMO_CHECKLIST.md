# Demo checklist

- **Link:** https://rmc2-test-yiizer.vercel.app (the test version)
- **Passwords:** `test-results/online-credentials/CREDENTIALS.txt` (git-ignored). Open it on the presenting PC only.
- **Sign in:** on the presenting browser beforehand with the Vercel account (`yiizer`), or create a revocable Vercel share link.
- **Reset the demo data:** `node --env-file=.env.supabase.test scripts/demo-reset-online.mjs --project-ref pgoiqwixaeqbxlwbmren --apply` backs up, removes and recreates all demo inquiries. It sends 5 emails to the test inbox. Last run: 2026-11-06.

## Accounts (all `@rmc2.local`)

| Role | Sign in as | What they see |
|---|---|---|
| Head | emerson | Everything, plus Users & Roles, Divisions & Branches, Proposal Templates, Monitoring (AI usage) and approvals |
| Supervisor | zeo | Everything except accounts and templates; approvals |
| Employee | cryssa, jefferson, judy | Inquiries, preparing proposals, Requests |
| Division Head | divisionhead@rmc2.local (Division 4) | My Clients, Submit inquiry |
| SOA | soa (Division 4) | My Clients, Submit inquiry |
| IT Admin | admin | Monitoring (full), Integrations, password resets for Employees |

Use separate browsers or private windows for people shown side by side.

## The demo inquiries (fictional, created 2026-11-06)

| Inquiry | State | Use it to show |
|---|---|---|
| Northstar Logistics (00141) | New inquiry, Division 5 filled from the branch "Cubao" | The whole process live: handle, choose template, PDF, submit |
| Lakeside Manufacturing (00142) | Preparing proposal, PDF ready | A draft in progress |
| Sunrise Cooperative (00143) | Waiting for agent details. Branch "Tacloban" is not on the list, so the division stays Unconfirmed | Request missing details; an unlisted branch |
| Bayani Elementary School (00144) | Awaiting approval | **zeo or emerson approves live** (this sends one email) |
| Cedar Digital Services (00145) | Needs correction, returned by Zeo | Return and resubmit |
| Harbor Point Hotel (00146) | Sent, Division Head, report already approved | A finished client with report history |
| Rizal Coastal Foods (00147) | Sent, Division Head, 30 days left, no report | **The Division Head files a report live**, and Zeo approves it |
| Pacific Crest Builders (00148) | Sent, SOA, report waiting ("Held") | Approval Queue → **Progress reports** tab |
| Meridian Packaging (00149) | Sent, SOA, **5 days left** | The protection warning and the reminder |
| Silverline Trading (00150) | Declined | Closed records with the reason |
| Northstar Logistics (00151) | On hold: the same client from another agent | Duplicate handling |
| Golden Harvest Agri Coop (00152) | New inquiry submitted in the app by the Division Head | A Division Head submission |
| Rizal Coastal Foods (00153) | SOA submitted a client the Division Head already protects | The SOA sees only "This client is already protected." |

## Suggested order (about 20 minutes)

1. **Roles:** sign in as the Division Head. Only My Clients and Submit inquiry appear: Harbor Point, Rizal Coastal and Golden Harvest. The SOA sees their own three.
2. **Progress report:**
   - The Division Head opens **Rizal Coastal Foods** → **File progress report**. It shows "Held — report under review".
   - Zeo: Approval Queue → **Progress reports** → Approve. The Division Head sees Approved, with 30 days from today.
3. **Approval Queue:** Pacific Crest's report is already waiting there too.
4. **Warning:** the SOA's Meridian Packaging shows 5 days left in amber, plus a reminder notification.
5. **Locking (cryssa and jefferson):**
   - cryssa starts handling Northstar (00141).
   - jefferson sees the lock flag and presses **Request handover**.
   - cryssa answers **Release** or **Keep working**.
   - zeo shows **Take over**.
6. **Proposal and approval:** zeo approves **Bayani Elementary School**. Optionally, cryssa prepares Northstar with a new template and shows the clean PDF.
7. **Client Directory:** 3,579 real records. Filter by **Division** and **Category**; latest activity is first.
8. **Head:** Users & Roles (a role change asks for Emerson's password) and Divisions & Branches.
9. **Fast email (optional):** email a franchise form to the test inbox. It appears in about 30–45 seconds, and its division fills from the branch.
10. **Phone notifications (optional, laptop Chrome or Edge):** Account settings → Turn on → **Send a test**.

## Known limits (say so if asked)

- **Phone notifications:** not yet tried on a real iPhone. Steps are in `PHONE_NOTIFICATIONS.md`.
- **Email signature:** waiting for the client's example.
- **Unassigned clients:** about 413 old clients are under Unassigned until the client answers the branch questions.
- **Email:** in test mode. Everything goes to the test inbox, with hourly and daily caps. Keep sends to a handful.
- **Real data on a test system:** the directory holds real client data (PO decision).

## Before the presentation

- [ ] Open the link and sign in once as each account you will use.
- [ ] Have a sample form ready to email or upload, e.g. `test-results/Franchise-Form-Mabini-Integrated-School.xlsx`.
- [x] Demo data reset and checked on 2026-11-06. Every state was confirmed online.
