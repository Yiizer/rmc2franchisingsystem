# Supabase migrations (phase 4)

Postgres schema `rmc2` for the TEST project (`rmc2-test`). SQLite remains the default store
(`RMC2_DB=sqlite`). Nothing here contains a password or connection string.

| Migration | Purpose |
|---|---|
| `20261101000000_init.sql` | schema `rmc2`, tables, indexes, seed rows (`counters.inquiry=129`, `app_meta`) |
| `20261101000100_workspace_triggers.sql` | index-pending trigger, deferred version bumps, `notice_recipients` rebuild |
| `20261101000200_security.sql` | `rmc2_app` role (no password), grants, RLS + `app_all` policy, assertions |
| `20261101000300_historical_scope.sql` | `historical` version scope and its triggers |
| `20261101000400_index_and_bump_fixes.sql` | lost-enqueue fix (`DO UPDATE`), fixed lock order for the commit-time bump |
| `20261101000500_security_hardening.sql` | `service_role` revokes, connection limit, append-only audit tables, `app_meta.environment='test'`, stronger assertions |

`seed.sql` is intentionally empty. Applied migrations are never edited; every change is a new file.
All migrations are idempotent and safe on an empty project. The `rmc2` schema must NOT be added to the
Data API "exposed schemas".

## Apply (owner connection, TEST project only)

Use the owner/migration credentials, never `rmc2_app`. `db push` applies every pending file in order and
skips the ones already recorded:

```
supabase link --project-ref <ref>                 # prompts for the database password interactively
supabase db push                                  # or: supabase db push --db-url "$RMC2_DATABASE_ADMIN_URL"
```

Only the migrations directory is pushed; `rollbacks/` is never applied. Alternative, per file and in order:
`psql "$RMC2_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/<file>`.
The security migrations (200, 500) end with assertions and abort (roll back) if RLS, policies, grants or
role attributes are not as intended. Migration 500 sets `app_meta.environment = 'test'`; production must
set `'production'` in its own bootstrap before anything else, so the rollback guard can never match it.

Hygiene note: 300 uses a session-level `set search_path = rmc2;`. It is harmless (every statement in the
migrations is schema-qualified and the CLI connection is not reused by the app). New migrations use
`set local` so nothing leaks past their transaction.

## Set the `rmc2_app` password (out of band)

The role is created without a password, so it cannot log in until one is set. Generate a long random
value, store it only in the git-ignored env file, then as the owner run (in psql, not via a committed file):

```
ALTER ROLE rmc2_app PASSWORD '<generated value>';
```

Build `RMC2_DATABASE_URL` as the transaction-pooler (port 6543) URL for user `rmc2_app.<project-ref>`.
After the first connect check `SHOW search_path; SHOW statement_timeout;` through the pooler (test T1).

## Roll back (TEST project only, Product Owner approval)

App rollback needs no SQL: set `RMC2_DB=sqlite`.

Database rollback is manual and destructive. Every rollback file starts with `\set ON_ERROR_STOP on` and
`begin;`, then a guard that aborts the whole file unless the session has `SET rmc2.allow_rollback = 'yes'`
AND `rmc2.app_meta.environment = 'test'`. Run newest first, each in an owner psql session:

```
psql "$RMC2_DATABASE_ADMIN_URL"
SET rmc2.allow_rollback = 'yes';
\i supabase/rollbacks/20261101000500_security_hardening.down.sql   -- keeps the environment marker
\i supabase/rollbacks/20261101000400_index_and_bump_fixes.down.sql
\i supabase/rollbacks/20261101000300_historical_scope.down.sql
\i supabase/rollbacks/20261101000200_security.down.sql             -- drops rmc2_app, RLS, policies
\i supabase/rollbacks/20261101000100_workspace_triggers.down.sql
\i supabase/rollbacks/20261101000000_init.down.sql                 -- DROPS SCHEMA rmc2 AND ALL ITS DATA
```

Roll back only as far as needed (e.g. only 500 and 400). Afterwards mark each reverted so `db push` can
re-run it: `supabase migration repair <version> --status reverted`.

## Schema parity check

`node scripts/db-schema-parity.mjs` compares table, column and index names between a throwaway SQLite
database (created by `openDatabase`) and these migration files. If `RMC2_DATABASE_ADMIN_URL` is set it
introspects the live `rmc2` schema instead (read-only queries); `--static` forces the file parse.
