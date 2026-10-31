-- MANUAL rollback of 20261101000000_init.sql. DESTRUCTIVE: drops schema rmc2 and EVERY table and row in it.
-- TEST project only, Product Owner approval, backup first if the data matters. Roll back 500..100 first.
-- App-level rollback needs no SQL: set RMC2_DB=sqlite.
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
drop schema if exists rmc2 cascade;
-- supabase migration repair 20261101000000 --status reverted
commit;

