# RMC2 staging (online test) runbook

A temporary, free, **test-data-only** copy of the app, served from this Windows PC and exposed through a Cloudflare quick tunnel so testers on other devices can try it. It is not the production or the managed staging environment described in `DEPLOYMENT_CHECKLIST.md`.

## Rules

- **Test data only.** The staging instance uses its own data directory (`test-results/staging-data`, gitignored). Never point it at `.data`, never copy real records, client files or real emails into it. The scripts refuse `.data`.
- The real local instance on port **5173** (`npm run dev`) is untouched and must stay private. Staging uses port **5180**.
- Email stays in the local outbox; nothing is sent. Provider keys (CloudConvert, OpenAI) are blanked for the staging process. The PDF converter path (`RMC2_OFFICE_EXECUTABLE`) is kept so document previews work.
- Ask the Product Owner before sharing the URL; testers must be told not to upload real client documents.

## One-time setup

```powershell
winget install --id Cloudflare.cloudflared      # installs cloudflared (no account needed)
npm run build                                    # safe while the 5173 dev server runs; build keeps .next/dev
node scripts/staging-setup.mjs                   # seeds a fresh DB, sets random passwords, prints the credentials file path
```

`staging-setup.mjs` options: `--data-dir <dir>` (must be under `test-results/` or `staging-data/` and gitignored), `--rotate` (issue new passwords and log everybody out), `--port` (temporary seeding port, default 5181). Rerunning without `--rotate` changes nothing. Passwords are written only to `<data dir>\STAGING_CREDENTIALS.txt`; they are never printed. The shared local password from `LOCALHOST.md` does not work on staging.

## Start

Terminal 1 (app):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-staging.ps1
```

Check http://127.0.0.1:5180/ locally and sign in with one account from the credentials file.

Terminal 2 (tunnel, only after the pre-share checklist below):

```powershell
cloudflared tunnel --url http://127.0.0.1:5180
```

cloudflared prints a random `https://<words>.trycloudflare.com` URL. Open it yourself and log in once before sharing; login must succeed (the app checks that the page origin matches the host, and the tunnel supplies the matching `Host` and `X-Forwarded-Proto: https` headers; session cookies become `Secure` automatically). If login returns "Use the application on the same origin", stop and report it to the lead; do not loosen anything.

## Share

Send testers the URL and one account each (separate channel from the URL if possible, for example a chat message directly to them). Prefer giving employees the Employee accounts and only the testers who need it the Supervisor/Admin accounts. Never post the credentials file or URL publicly.

## Real email (test inbox)

By default staging simulates email (local outbox). Phase 1 lets the staging copy send real mail, but only to the Product Owner's test inbox. The real-data server on 5173 never gets mail credentials.

Product Owner steps (on this PC only; never paste the password or the filled-in file into chat, Slack or tickets):

1. Create a dedicated Gmail account for testing (not a personal or company mailbox).
2. Turn on 2-Step Verification for it.
3. Create an app password: https://support.google.com/accounts/answer/185833
4. Copy `.env.mail.test.example` to `.env.mail.test` in the repo root and fill it in (test account, app password, your test inbox for both `RMC2_MAIL_ALLOWLIST` and `RMC2_MAIL_REDIRECT_TO`). Keep `RMC2_MAIL_DRY_RUN=1` at first.
5. Restrict the file to your Windows user (run in PowerShell from the repo root):

   ```powershell
   icacls .env.mail.test /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
   ```

6. Restart staging (Ctrl+C, then `scripts\start-staging.ps1`). The script prints `Mail: smtp -> redirected to te***@..., DRY RUN`. Without the file it prints `Mail: local (simulated)`.
7. Verify: in the app the mail badge reads "TEST EMAIL · to <your inbox>". With dry run on, nothing is sent.
8. For the approved live window only, set `RMC2_MAIL_DRY_RUN=0` and restart. Set it back to `1` afterwards.

Safeguards: every message is redirected to the test inbox and the allowlist applies; sending is capped at 5 per hour and 20 per day; the script forces `RMC2_MAIL_ENV=staging`, clears any mail variables from the shell, and refuses to start if `.env`, `.env.local` or the other Next env files contain `RMC2_MAIL_` or `RMC2_SMTP_` keys.

Turn off: delete or rename `.env.mail.test` and restart staging. Rotate or revoke: delete the app password in your Google account (Security, 2-Step Verification, App passwords), then create a new one if needed and update the file.

## Stop, rotate, reset

- **Stop:** press Ctrl+C in both terminals. The URL dies immediately and is never reused.
- **Rotate passwords / log everyone out:** `node scripts/staging-setup.mjs --rotate`, then restart the app (no restart needed for password changes, but running sessions are deleted).
- **Reset all test data:** stop the app, delete `test-results\staging-data`, rerun `node scripts/staging-setup.mjs`.
- **Rollback / teardown:** stop both processes, delete `test-results\staging-data`, optionally `winget uninstall Cloudflare.cloudflared`. No DNS, accounts or cloud resources are created, so there is nothing else to undo. If the app build is suspect, the 5173 dev instance is unaffected; rebuild with `npm run build`.

## Limits

- The PC must stay on, awake and online; sleeping or closing the terminals ends the test.
- The URL changes on every tunnel restart; testers need the new one.
- A quick tunnel has no Cloudflare Access login, so the app passwords are the only gate. The URL is unguessable but not secret once shared. Login is rate limited (8 failures per 15 minutes per login name, `lib/operations/accounts.ts`), which does not stop an attacker locking out a known account.
- Quick tunnels are for testing only: no uptime guarantee and a limit of 200 concurrent requests. Do not use for real client data or as production.
- Uploaded files land in the staging data directory on this PC; any signed-in tester can upload files.

## Pre-share checklist

- [ ] `git status` shows no staging data or credentials staged (the directory is ignored).
- [ ] `node scripts/staging-setup.mjs` printed a credentials file; the documented local password is rejected.
- [ ] Staging runs on 127.0.0.1:5180 with `RMC2_DATA_DIR` set to the staging directory (the start script prints it); `.data` is not referenced.
- [ ] Login works through the trycloudflare URL; you have signed out again.
- [ ] Testers know: test data only, no real client documents, no real email addresses.
- [ ] Product Owner approved the time window; you know how to stop (Ctrl+C) and rotate.
