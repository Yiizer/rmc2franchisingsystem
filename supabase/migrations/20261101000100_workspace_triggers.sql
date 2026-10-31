-- Phase 4 triggers: the Postgres equivalents of installWorkspaceIndexes (workspace-schema.ts).
--
--   1. inquiries -> inquiry_index_pending          immediate, per row (never lose an enqueue)
--   2. version bumps per scope                     DEFERRED constraint triggers (fire at COMMIT)
--   3. notifications -> notice_recipients rebuild  immediate, per row
--
-- Differences from SQLite, deliberate:
--   * The version bump runs once per transaction per scope, not once per row (a transaction-local flag
--     de-duplicates it). Readers only compare stamps for change, so +1 per transaction is enough, and
--     a bulk import does not rewrite one hot row thousands of times.
--   * Deferred, so the row lock on workspace_versions is held only for the commit instant, not for the
--     whole transaction, and a rolled-back transaction bumps nothing.
--   Cost: two transactions that touch different scopes in opposite orders can deadlock (40P01);
--   the app's outer-transaction retry covers it.
--
-- All functions pin search_path and schema-qualify everything. They run as the invoking role
-- (rmc2_app), which holds the needed table grants.

-- 1. inquiries -> inquiry_index_pending ---------------------------------------------------------------

create or replace function rmc2.trg_inquiry_index_pending() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  insert into rmc2.inquiry_index_pending (id)
  values (case when tg_op = 'DELETE' then old.id else new.id end)
  on conflict (id) do nothing;
  return null;
end;
$$;

drop trigger if exists workspace_inquiries_pending on rmc2.inquiries;
create trigger workspace_inquiries_pending
  after insert or update or delete on rmc2.inquiries
  for each row execute function rmc2.trg_inquiry_index_pending();

-- 2. Deferred version bumps ------------------------------------------------------------------------------

create or replace function rmc2.trg_bump_workspace_version() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  scope_name text := tg_argv[0];
  flag       text := 'rmc2.bumped_' || tg_argv[0];
begin
  -- Once per transaction per scope. set_config(..., true) is transaction-local and is undone with
  -- the transaction (or sub-transaction) that set it.
  if coalesce(current_setting(flag, true), '') = '1' then
    return null;
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

-- scope 'inquiries'
drop trigger if exists workspace_inquiries_bump on rmc2.inquiries;
create constraint trigger workspace_inquiries_bump
  after insert or update or delete on rmc2.inquiries
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('inquiries');

-- scope 'metadata': users and template_overrides
drop trigger if exists workspace_users_bump on rmc2.users;
create constraint trigger workspace_users_bump
  after insert or update or delete on rmc2.users
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('metadata');

drop trigger if exists workspace_template_overrides_bump on rmc2.template_overrides;
create constraint trigger workspace_template_overrides_bump
  after insert or update or delete on rmc2.template_overrides
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('metadata');

-- scope 'notifications'
drop trigger if exists workspace_notifications_bump on rmc2.notifications;
create constraint trigger workspace_notifications_bump
  after insert or update or delete on rmc2.notifications
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('notifications');

-- 3. notifications -> notice_recipients --------------------------------------------------------------------

-- Rebuilds the rows for one notification from data.recipientIds / data.readBy.
-- Malformed (non-array) lists are treated as empty rather than failing the write.
create or replace function rmc2.trg_notice_recipients() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  delete from rmc2.notice_recipients where notice_id = case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op <> 'DELETE' then
    insert into rmc2.notice_recipients (notice_id, user_id, is_read, at)
    select distinct new.id,
           r.value,
           case when exists (
             select 1
             from jsonb_array_elements_text(
               case when jsonb_typeof(new.data->'readBy') = 'array' then new.data->'readBy' else '[]'::jsonb end
             ) as rb(value)
             where rb.value = r.value
           ) then 1 else 0 end,
           coalesce(new.data->>'at', '')
    from jsonb_array_elements_text(
      case when jsonb_typeof(new.data->'recipientIds') = 'array' then new.data->'recipientIds' else '[]'::jsonb end
    ) as r(value)
    on conflict (notice_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists workspace_notifications_recipients on rmc2.notifications;
create trigger workspace_notifications_recipients
  after insert or update or delete on rmc2.notifications
  for each row execute function rmc2.trg_notice_recipients();

-- Backfill (as installWorkspaceIndexes does on every start). No-ops on an empty project. ------------------

insert into rmc2.inquiry_index_pending (id)
  select i.id from rmc2.inquiries i
  where not exists (select 1 from rmc2.inquiry_summaries s where s.id = i.id)
  on conflict (id) do nothing;

insert into rmc2.notice_recipients (notice_id, user_id, is_read, at)
  select distinct n.id, r.value,
         case when n.data->'readBy' @> to_jsonb(r.value) then 1 else 0 end,
         coalesce(n.data->>'at', '')
  from rmc2.notifications n,
       jsonb_array_elements_text(
         case when jsonb_typeof(n.data->'recipientIds') = 'array' then n.data->'recipientIds' else '[]'::jsonb end
       ) as r(value)
  on conflict (notice_id, user_id) do nothing;
