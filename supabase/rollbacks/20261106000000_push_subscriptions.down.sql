-- MANUAL rollback of 20261106000000_push_subscriptions.sql. TEST project only, PO approval. Deletes every saved phone-notification device.
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
drop table if exists rmc2.push_subscriptions;
commit;
-- Afterwards: supabase migration repair 20261106000000 --status reverted
