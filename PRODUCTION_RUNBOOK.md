# Production cutover runbook (phase 8)

The order of steps to move RMC2 from the test version to production. Every step marked **[PO]** needs the Product
Owner's go-ahead at that moment. Nothing here contains a password, key or connection string; those live only in the
Vercel and Supabase dashboards and in git-ignored env files. Decisions behind this plan: `TEAM_DECISIONS.md`
("Production deployment decisions", 2026-11-11). Open items: `REMAINING_WORK.md`.

## 0. Before starting

- [ ] The final check (`REMAINING_WORK.md` §0 and §2) has passed on the test version.
- [ ] `phase-4-postgres` is merged into `main`. **[PO]**
- [ ] The client has created and pays for both accounts (Pro plans, about US$45/month), and has invited us as members
      **[client]**:
  - a Vercel team;
  - a Supabase organisation.
- [ ] The client has approved: the cutover date, the sample PDFs and templates, the email signature, the branch
      answers and the real staff list (name, role, email). **[client]**
- [ ] The dedicated company franchising mailbox exists, with an app password for the app's sign-in. **[client]**

## 1. Supabase production project

1. Create the project in the client's organisation, in region **Southeast Asia (Singapore)**. It must sit next to
   Vercel `sin1`. Choose **Pro**; daily backups are included. **[PO]**
2. Do **not** add schema `rmc2` to the Data API "exposed schemas".
3. Apply the migrations **one file at a time, in order**, each in one transaction, and **never with `db push`**.
   The pattern is `scripts/apply-migration-test.mjs`: copy it with the project ref changed, or use
   `psql -v ON_ERROR_STOP=1 -1 -f`. Migrations 200 and 500 end with self-checks and roll back if anything is off.
4. **Right after the first file (`20261101000000_init.sql`) and before `20261101000500`**, as the database owner:
   ```sql
   insert into rmc2.app_meta (key, value) values ('environment', 'production');
   ```
   Migration 500 stamps `test` only when no value exists. Skip this step, and production would be stamped `test`,
   so the rollback scripts' guard would let them run there. Then apply the remaining 12 files. From migration
   `20261109000000` on, only the owner can change the marker. This order was checked on a local PostgreSQL 17
   (see `REMAINING_WORK.md`).
5. Check that `select value from rmc2.app_meta where key='environment'` returns **`production`**.
6. Give `rmc2_app` a long random password, set out of band and stored only in Vercel
   (`supabase/README.md`, "Set the rmc2_app password").
7. Storage: create a **private** bucket (for example `rmc2-files`) with a **25 MB** file limit (PO decision
   2026-11-09); `scripts/set-bucket-limit-test.mjs` shows how. Leave `RMC2_STORAGE_PREFIX` empty, or use
   `production`.
8. Download the Supabase CA certificate (Project Settings > Database > SSL) for `RMC2_DATABASE_CA`.

## 2. Vercel production project

1. Create the project in the client's team, region `sin1` (from `vercel.json`). Connect GitHub only if the PO
   wants deploys from git. **[PO]**
2. Set the environment variables for **Production** only (names below). Then pull them and compare the names with
   this list; never print the values.
3. Deploy the PDF converter (`converter/`) as its own project in the same team, with its own
   `RMC2_CONVERTER_SECRET`.
4. Add the **Vercel Firewall rate-limit rule** in front of `POST /api/operations/login` (PO decision 2026-11-11).
   The app's own limits stay in place behind it.
5. Pro runs the daily cron in `vercel.json`. For every-minute inbox checks, change the schedule to `* * * * *`
   (Pro only).

### Environment variables (production)

| Name | Value / note |
|---|---|
| `RMC2_DB` | `postgres` |
| `RMC2_DATABASE_URL` | `rmc2_app` through the transaction pooler (port 6543). Secret |
| `RMC2_DATABASE_CA` | Supabase CA certificate (turns on certificate checks) |
| `RMC2_DATABASE_SSL` | `verify-full` |
| `RMC2_STORAGE` | `supabase` |
| `RMC2_SUPABASE_URL`, `RMC2_SUPABASE_SECRET_KEY` | production project. The key is secret and server-only |
| `RMC2_STORAGE_BUCKET`, `RMC2_STORAGE_PREFIX` | the private bucket; empty or `production` |
| `RMC2_CONVERTER_URL`, `RMC2_CONVERTER_SECRET`, `RMC2_CONVERTER_STORAGE_HOST` | the production converter |
| `RMC2_MAIL_MODE` | `smtp` |
| `RMC2_MAIL_ENV` | `production`, **only at go-live** (see 5). Until then `staging`, with `RMC2_MAIL_REDIRECT_TO` set |
| `RMC2_MAIL_LIVE_CONFIRM` | set only at go-live **[PO]** |
| `RMC2_SMTP_HOST`, `RMC2_SMTP_PORT`, `RMC2_SMTP_USER`, `RMC2_SMTP_APP_PASSWORD` | the company franchising mailbox. The password is secret |
| `RMC2_MAIL_FROM_NAME`, `RMC2_MAIL_FROM_ADDRESS` | as approved by the client |
| `RMC2_MAIL_CAP_PER_HOUR`, `RMC2_MAIL_CAP_PER_DAY` | agree production caps with the PO |
| `RMC2_IMAP_HOST`, `RMC2_IMAP_PORT`, `RMC2_IMAP_AUTHSERV_ID` | Gmail defaults, unless the mailbox is elsewhere |
| `RMC2_VAPID_PUBLIC_KEY`, `RMC2_VAPID_PRIVATE_KEY`, `RMC2_VAPID_SUBJECT` | **new** keys for production phone notifications |
| `CRON_SECRET` | at least 16 random characters. Secret |
| **Never set** | `RMC2_SEED_DEMO`, `RMC2_MAIL_TEST_HOOK`, `RMC2_CONVERTER_BYPASS`, `RMC2_DATA_DIR` |

`VERCEL_ENV=production` already stops demo seeding, whatever `RMC2_SEED_DEMO` says.

## 3. Templates and accounts

1. Upload and publish the proposal templates on production, **including the 13 new ones**
   (`REMAINING_WORK.md`, demo feedback round). Check each preview against the client's signed-off PDFs.
2. Create the real staff accounts with temporary passwords: the Head (Emerson), Supervisors, Employees, the IT
   Admin, and the Division Heads and SOAs with their divisions. Each person sets their own password at first
   sign-in. No demo or `check.` accounts exist on production.
3. Enter the Divisions & Branches table, with the client's branch answers.

## 4. Data import (two rehearsals, then the real one) **[PO]**

1. **Rehearsal 1 and 2:** load **made-up** data into the production project with
   `scripts/load-historical-to-postgres.mjs`, compare the counts and file hashes, then empty it again.
2. **Real import:** take a snapshot of the PC copy (`.data`) and a backup outside the repo. Then load the client
   directory, the real inquiries that are kept, and their files under the same paths. Only real records:
   no `[TEST]` or sample inquiries, and no local accounts.
3. Verify: record counts, file counts and hashes, and open several inquiries and their PDFs.
4. Keep the PC copy **read-only for 30 days**.

## 5. Go-live

1. Deploy `main` to production (`vercel deploy --prod` in the production project). **[PO]**
2. While mail is still in staging, run these checks:
   - `scripts/roles-check-online.mjs`, pointed at the production URL with the real accounts' test sign-ins;
   - one inquiry end to end, ending at the redirect inbox.
3. Switch mail to live: `RMC2_MAIL_ENV=production` and `RMC2_MAIL_LIVE_CONFIRM`, then redeploy. **[PO]**
   The "TEST VERSION" login badge disappears on its own.
4. Send one real proposal to an agent who knows it is coming, and check the Sent folder.

## 6. After go-live

- Admin: run "Scan stored files" on Monitoring after the first week. Delete leftovers only after the 24-hour second
  pass.
- Email retention runs by itself: 30, 60 and 90 days.
- Watch Problem reports, including the App errors tab, every day for the first two weeks.
- After 30 days, if nothing is missing, retire the PC copy. **[PO]**
- Wind down the test setup **[PO]**:
  - revoke the yiizer17 Gmail app password;
  - delete or transfer `rmc2-preview` and `rmc2-converter`;
  - pause the Supabase TEST project.

## Rollback

- **App:** promote the previous production deployment in Vercel (instant).
- **Mail:** set `RMC2_MAIL_ENV=staging` and redeploy. All email goes to the redirect again.
- **Database:** the rollback scripts refuse to run on production (environment marker). Restore from the Supabase
  daily backup instead **[PO]**. Since this loses up to a day of work, keep the PC copy until 30 days have passed.
