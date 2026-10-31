-- MANUAL rollback of 20261101000200_security.sql. Roll back 500 first.
-- TEST project only, Product Owner approval. Run as the owner in ONE psql session.
-- Effect: rmc2_app loses all access and is dropped; RLS and every policy are removed. Data is untouched.
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
declare t record; r record;
begin
  for t in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'rmc2' and c.relkind in ('r','p')
  loop
    for r in select policyname from pg_catalog.pg_policies where schemaname = 'rmc2' and tablename = t.relname loop
      execute format('drop policy if exists %I on rmc2.%I', r.policyname, t.relname);
    end loop;
    execute format('alter table rmc2.%I disable row level security', t.relname);
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'rmc2_app') then
    drop owned by rmc2_app;
    drop role rmc2_app;
  end if;
end
$$;
-- supabase migration repair 20261101000200 --status reverted
commit;


