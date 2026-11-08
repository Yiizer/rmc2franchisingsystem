-- MANUAL rollback of 20261106000100_owner_index.sql. TEST project only, PO approval. Drops one index; no data is lost.
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
drop index if exists rmc2.inquiries_owner;
commit;
-- Afterwards: supabase migration repair 20261106000100 --status reverted
