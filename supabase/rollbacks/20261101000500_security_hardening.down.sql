-- MANUAL rollback of 20261101000500_security_hardening.sql. Never applied automatically.
-- TEST project only, Product Owner approval. Run as the owner in ONE psql session (psql -f).
-- Effect: audit tables get app_all back and rmc2_app gets UPDATE/DELETE again, connection limit removed,
-- the environment marker is kept (later rollbacks need it). Revokes from service_role are NOT undone (they should stay).
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
do $$
declare t text;
begin
  foreach t in array array['security_events','file_access','historical_edits','historical_reviews','ai_usage'] loop
    execute format('drop policy if exists app_select on rmc2.%I', t);
    execute format('drop policy if exists app_insert on rmc2.%I', t);
    execute format('drop policy if exists app_all on rmc2.%I', t);
    execute format('create policy app_all on rmc2.%I as permissive for all to rmc2_app using (true) with check (true)', t);
    execute format('grant update, delete on rmc2.%I to rmc2_app', t);
  end loop;
end
$$;
alter role rmc2_app connection limit -1;
do $$
begin
  alter default privileges for role postgres grant execute on functions to public;
exception when insufficient_privilege or undefined_object then
  raise notice 'skipped: %', sqlerrm;
end
$$;
-- app_meta.environment is deliberately kept: the remaining rollback files need it for their guard.
-- supabase migration repair 20261101000500 --status reverted
commit;


