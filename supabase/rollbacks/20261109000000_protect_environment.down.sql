-- MANUAL rollback of 20261109000000_protect_environment.sql. TEST project only, PO approval. Removes the marker protection; no data is lost.
\set ON_ERROR_STOP on
begin;
do $guard$
declare env text;
begin
  if coalesce(current_setting('rmc2.allow_rollback', true), '') <> 'yes' then
    raise exception 'refusing to run: first execute  SET rmc2.allow_rollback = ''yes'';  in this session';
  end if;
  execute 'select value from rmc2.app_meta where key = ''environment''' into env;
  if env is distinct from 'test' then
    raise exception 'refusing to run: app_meta.environment is %, expected test', coalesce(env, 'missing');
  end if;
end
$guard$;
drop trigger if exists protect_environment on rmc2.app_meta;
drop function if exists rmc2.trg_protect_environment();
commit;
-- Afterwards: supabase migration repair 20261109000000 --status reverted
