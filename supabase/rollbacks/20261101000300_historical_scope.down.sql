-- MANUAL rollback of 20261101000300_historical_scope.sql: removes the 'historical' version scope and its triggers.
-- The app falls back to its time-based directory cache stamp. TEST project only, PO approval.
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
drop trigger if exists workspace_historical_accounts_bump on rmc2.historical_accounts;
drop trigger if exists workspace_historical_imports_bump on rmc2.historical_imports;
delete from rmc2.workspace_versions where scope = 'historical';
-- supabase migration repair 20261101000300 --status reverted
commit;

