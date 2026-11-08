-- MANUAL rollback of 20261105000100_settings.sql. TEST project only, PO approval. Deletes every saved setting (email templates, intake keys, push mutes).
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
drop table if exists rmc2.settings;
commit;
-- Afterwards: supabase migration repair 20261105000100 --status reverted
