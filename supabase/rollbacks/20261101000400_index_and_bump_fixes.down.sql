-- MANUAL rollback of 20261101000400_index_and_bump_fixes.sql: restores the two trigger functions to the
-- versions from 20261101000100 (including the lost-enqueue race and the commit-time deadlock risk).
-- TEST project only, Product Owner approval. Run as the owner in ONE psql session.
\set ON_ERROR_STOP on
begin;

-- Guard first: aborts the whole file unless BOTH hold. Set the first in this same psql session beforehand:
--   SET rmc2.allow_rollback = 'yes';
--   rmc2.app_meta has environment = 'test'
do $guard$
declare env text;
begin
  if coalesce(current_setting('rmc2.allow_rollback', true), '') <> 'yes' then
    raise exception 'refusing to run: first execute  SET rmc2.allow_rollback = ''yes'';  in this session';
  end if;
  if to_regclass('rmc2.app_meta') is null then
    raise exception 'refusing to run: rmc2.app_meta not found, cannot confirm this is the test environment';
  end if;
  execute 'select value from rmc2.app_meta where key = ''environment''' into env;
  if env is distinct from 'test' then
    raise exception 'refusing to run: app_meta.environment is %, expected test', coalesce(env, 'missing');
  end if;
end
$guard$;
create or replace function rmc2.trg_inquiry_index_pending() returns trigger
language plpgsql set search_path = pg_catalog
as $f$
begin
  insert into rmc2.inquiry_index_pending (id)
  values (case when tg_op = 'DELETE' then old.id else new.id end)
  on conflict (id) do nothing;
  return null;
end;
$f$;

create or replace function rmc2.trg_bump_workspace_version() returns trigger
language plpgsql set search_path = pg_catalog
as $f$
declare
  scope_name text := tg_argv[0];
  flag       text := 'rmc2.bumped_' || tg_argv[0];
begin
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
$f$;
-- supabase migration repair 20261101000400 --status reverted
commit;

