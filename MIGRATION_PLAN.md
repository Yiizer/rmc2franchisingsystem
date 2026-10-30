# Move to Vercel + Supabase — migration plan

Status: **approved; phase 0 in progress** (2026-10-31). Decisions: PO-owned accounts during build (transfer to the client before real data), LibreOffice container + Word fallback, Supabase Auth. Built from the software architect, database
engineer and integration engineer reviews, checked against the code. Extends `HOSTING_PLAN.md` (target already
chosen there: Vercel Pro + Supabase Pro, client-owned accounts). Decisions get recorded in `TEAM_DECISIONS.md`.

## Why the app can't simply be deployed to Vercel today

| Blocker | Evidence |
|---|---|
| Database is a local SQLite file, used **synchronously** (104 `db()` calls, 32 `transaction()` calls) | `lib/operations/database.ts:1,13,46` |
| Writes are serialized by a whole-database lock (`BEGIN IMMEDIATE`); duplicate-client checks rely on it | `database.ts:46`, `PRIVACY.md` |
| Uploaded, generated and emailed files are written to local disk | `forms.ts`, `documents.ts`, `client-service.ts`, `registration-actions.ts`, `template-admin.ts`, `service.ts` |
| Proposal templates (76 MB) live in `resources/private`, which is not in git | `.gitignore:50`, `database.ts:49,54` |
| PDFs come from LibreOffice installed on this PC (14–17 s per conversion) | `document-renderer.ts:1,12` |
| Some state lives in one server's memory (converter queue, caches) | `document-renderer.ts`, `workspace-query.ts`, `historical.ts` |
| Vercel request/response bodies max 4.5 MB; several files are larger | `forms.ts:16`, file sizes |
| No scheduler (stuck-mail recovery, inbound mail checks) | `route.ts`, `service.ts` |
| Unused Cloudflare/vinext leftovers in the repo | `vite.config.ts`, `wrangler`, `db/`, `drizzle.config.ts` |

## Target

- **Supabase Postgres** (Singapore region), reached through the connection pooler with the `postgres` driver;
  JSON data as `jsonb`; per-client advisory locks + row locks replace the global SQLite lock; Row Level Security
  on with no public access (all access through the server).
- **Supabase Storage**, one private bucket keeping today's relative paths; downloads via 60-second signed links
  after the existing permission check + access log; uploads via signed upload then server-side verification.
- **Vercel functions in `sin1`** (near the Philippines), Vercel Cron every minute for sending/recovery and the
  inbox check, with job locks so runs never overlap.
- **PDF conversion** behind a `Converter` interface: LibreOffice in a Vercel container function (beta), with
  "staff export from Word and upload" as the fallback. CloudConvert only with client consent.
- **Sign-in:** Supabase Auth (invites, password reset, MFA) as its own phase after the data layer.
- **Environments:** this PC (SQLite, local outbox) · Vercel previews + a free Supabase project (synthetic test
  data only, email redirected) · production (`main`, client's Supabase Pro project).

## Phases (each one reversible; the current app and the PC/tunnel staging keep working throughout)

| # | Work | Sessions | What you can test afterwards |
|---|---|---|---|
| 0 | Remove Cloudflare leftovers, portable config, no demo accounts in production | 1 | App unchanged locally |
| 1 | Proofs: LibreOffice container renders all 11 active templates (time, memory, fonts); Gmail IMAP read | 2–3 | Side-by-side PDFs to approve |
| 2 | Async data layer (repositories + transactions), still on SQLite | 4–6 | Full regression, no visible change |
| 3 | File storage interface (local disk / Supabase) | 2–3 | No visible change |
| 4 | Postgres implementation, SQL migrations (Supabase CLI), `RMC2_DB` switch | 5–8 | **App on a Vercel preview URL** with test data |
| 5 | Converter + signed uploads/downloads | 2–4 | Uploads and PDFs online |
| 6 | Supabase Auth | 3–4 | Invites, password reset, sign-in |
| 7 | Cron jobs, inbound email, **Requests** inbox | 4–6 | Test-inbox emails become reviewable requests online |
| 8 | Two import rehearsals (synthetic), real-data import, cutover | 3–4 | Pilot with staff |

Roughly **26–39 working sessions** in total. The first online preview you can open on any device without this PC
is after phase 4.

## Inbound email (phase 7)

IMAP polling for the pilot, Gmail API for production. Every message is stored privately, de-duplicated, and
classified (new form / reply to our email / unknown) into a staff-reviewed **Requests** inbox — nothing becomes an
inquiry or progress report automatically. Test mode only processes allowlisted senders. Sender addresses aren't
trusted as identity; Gmail's SPF/DKIM/DMARC results are shown to staff.

## Data migration (phase 8)

About 487 MB of files and a 28 MB database today. Snapshot → export with checksums → load → upload files with
the same paths → verify counts, hashes and workflow parity. `[TEST]`/sample inquiries and local accounts are not
imported. **Real client data only ever goes to the client-owned production project**, never to free/test projects
or personal accounts. Cutover downtime 30–60 minutes; the PC copy stays read-only for 30 days.

## Costs (checked 2026-10-30; verify again before buying)

- Testing: Vercel previews (in the Pro team) + free Supabase project — no extra cost; free projects pause after a
  week idle.
- Production: **Vercel Pro (~US$20/month per seat) + Supabase Pro (~US$25/month) ≈ US$45/month** plus usage.
  Optional: point-in-time recovery (+US$100/month), Google Workspace later (~US$7/user/month).
- Vercel Hobby (free) is non-commercial and only runs scheduled jobs daily, so it can't host this system.

## Decisions needed from the Product Owner

1. Who owns and pays for the Vercel team and Supabase organization (client or you), and the GitHub access.
2. Budget approval (~US$45/month baseline) and backup level (daily vs 15-minute recovery).
3. PDF approach: container LibreOffice (beta) with Word-upload fallback, or CloudConvert (needs client consent).
4. Sign-in: Supabase Auth now, or keep current sign-in first.
5. Cutover date and read-only window.

Approval gates: creating accounts/projects, connecting GitHub to production, DNS, secrets, production email,
importing real data, cutover.

## Risks

Container runtime is beta (fallback: Word upload) · font/layout drift (client signs off sample PDFs) · race
conditions when locks move to Postgres (parallel-request tests) · only one system may hold mail credentials at
cutover · after the first production write, rollback means re-entering data since the last import.
