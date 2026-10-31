-- Phase 4 fixes from the code review. Replaces two trigger functions from
-- 20261101000100_workspace_triggers.sql (that file is applied and is not edited). Idempotent.
-- Triggers keep their names and bindings, so create or replace is enough.
set local search_path = rmc2, pg_catalog;

-- (a) Lost index enqueue --------------------------------------------------------------------------------
-- ON CONFLICT (id) DO NOTHING does not lock an existing inquiry_index_pending row. A sync could then
-- claim the pending row (DELETE ... RETURNING) and project the data it can see while this writer's
-- change is still uncommitted; the writer's insert was skipped as a "duplicate" of the row that is
-- about to vanish, so the re-enqueue is lost and the projection stays stale.
-- DO UPDATE takes the row lock: it waits for a concurrent claim to commit, then re-inserts the row
-- (or, if the claim is not yet done, makes the claimer wait for this transaction). Either way the
-- row exists after this transaction commits, and the next sync projects the committed data.
create or replace function rmc2.trg_inquiry_index_pending() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  insert into rmc2.inquiry_index_pending (id)
  values (case when tg_op = 'DELETE' then old.id else new.id end)
  on conflict (id) do update set id = excluded.id;
  return null;
end;
$$;

-- (b) Commit-time deadlock in the deferred version bump --------------------------------------------------
-- Correction to the intent comment in 20261101000100: the deferred bump does NOT hold its
-- workspace_versions row lock only "for the commit instant". It locks one row per scope as the
-- deferred triggers fire at COMMIT, in first-touch order, and holds each until the transaction ends.
-- Two transactions touching scopes in opposite order (A: inquiries then notifications, B: notifications
-- then inquiries) could therefore deadlock at COMMIT, which cannot be retried safely.
-- Fix: the first bump in a transaction locks ALL workspace_versions rows in a fixed order (scope), so
-- every committer acquires the locks in the same order and cannot form a cycle. The bump is still
-- once per transaction per scope; the cost is that committers that bump anything are serialised for
-- the short commit window.
create or replace function rmc2.trg_bump_workspace_version() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  scope_name text := tg_argv[0];
  flag       text := 'rmc2.bumped_' || tg_argv[0];
begin
  if coalesce(current_setting(flag, true), '') = '1' then
    return null;
  end if;
  if coalesce(current_setting('rmc2.bump_locked', true), '') <> '1' then
    perform 1 from rmc2.workspace_versions order by scope for update;
    perform set_config('rmc2.bump_locked', '1', true);
  end if;
  update rmc2.workspace_versions set version = version + 1 where scope = scope_name;
  if not found then
    insert into rmc2.workspace_versions (scope, version) values (scope_name, 1)
      on conflict (scope) do update set version = workspace_versions.version + 1;
  end if;
  perform set_config(flag, '1', true);
  return null;
end;
$$;
