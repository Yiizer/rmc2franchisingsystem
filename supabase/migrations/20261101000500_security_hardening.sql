-- Phase 4 security hardening, from the security review. Builds on 20261101000200_security.sql (applied,
-- not edited). Idempotent. If 200 is ever re-run it recreates app_all on the append-only tables;
-- re-run this file afterwards.
set local search_path = rmc2, pg_catalog;

-- 1. Revoke from service_role too (the 200 loop covered public, anon, authenticated) -----------------------
-- service_role bypasses RLS, so table grants are the only barrier. Skipped where the role does not exist.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on schema rmc2 from service_role;
    revoke all on all tables in schema rmc2 from service_role;
    revoke all on all sequences in schema rmc2 from service_role;
    revoke all on all functions in schema rmc2 from service_role;
    alter default privileges in schema rmc2 revoke all on tables from service_role;
    alter default privileges in schema rmc2 revoke all on sequences from service_role;
    alter default privileges in schema rmc2 revoke all on functions from service_role;
  end if;
end
$$;

-- 2. Future functions: no implicit EXECUTE for PUBLIC ----------------------------------------------------------
-- An in-schema default-privilege revoke cannot remove the global PUBLIC default, so this is the
-- owner-wide form. NOTE: it applies to every schema's future functions created by postgres in this
-- database. Guarded: if the hosted owner is not allowed (or the role is absent) it only raises a notice,
-- and existing functions are already revoked by the 200 migration.
do $$
begin
  alter default privileges for role postgres revoke execute on functions from public;
exception when insufficient_privilege or undefined_object then
  raise notice 'could not change postgres default function privileges (%): skipped', sqlerrm;
end
$$;

-- 3. Connection limit ------------------------------------------------------------------------------------------
alter role rmc2_app connection limit 60;

-- 4. Append-only audit tables ------------------------------------------------------------------------------------
-- The app code only INSERTs and SELECTs these (checked: lib/operations and app/api have no UPDATE or DELETE
-- on them). rmc2_app loses UPDATE/DELETE and gets per-command policies (select + insert) instead of app_all.
-- mail_sends keeps DELETE (reserveSend prunes it). ai_usage has no writer in the app yet; kept insertable.
do $$
declare
  t text;
begin
  foreach t in array array['security_events', 'file_access', 'historical_edits', 'historical_reviews', 'ai_usage'] loop
    execute format('revoke update, delete, truncate on rmc2.%I from rmc2_app', t);
    execute format('drop policy if exists app_all on rmc2.%I', t);
    execute format('drop policy if exists app_select on rmc2.%I', t);
    execute format('drop policy if exists app_insert on rmc2.%I', t);
    execute format('create policy app_select on rmc2.%I as permissive for select to rmc2_app using (true)', t);
    execute format('create policy app_insert on rmc2.%I as permissive for insert to rmc2_app with check (true)', t);
  end loop;
end
$$;

-- 5. Environment marker --------------------------------------------------------------------------------------------
-- Rollback scripts refuse to run unless this is 'test'. Production sets 'production' in its own bootstrap
-- (this migration never overwrites an existing value).
insert into rmc2.app_meta (key, value) values ('environment', 'test')
  on conflict (key) do nothing;

-- 6. Assertions -------------------------------------------------------------------------------------------------------
do $$
declare
  audit constant text[] := array['security_events', 'file_access', 'historical_edits', 'historical_reviews', 'ai_usage'];
  bad text;
  r   text;
  app oid := (select oid from pg_catalog.pg_roles where rolname = 'rmc2_app');
begin
  -- RLS on, and exactly the expected policy set per table.
  select string_agg(c.relname, ', ') into bad
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'rmc2' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'rmc2 tables without RLS: %', bad; end if;

  select string_agg(c.relname, ', ') into bad
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'rmc2' and c.relkind in ('r', 'p')
    and (select coalesce(string_agg(p.policyname, ',' order by p.policyname), '')
         from pg_catalog.pg_policies p where p.schemaname = 'rmc2' and p.tablename = c.relname)
        is distinct from (case when c.relname = any (audit) then 'app_insert,app_select' else 'app_all' end);
  if bad is not null then raise exception 'unexpected policy set on: %', bad; end if;

  -- Role attributes.
  if exists (select 1 from pg_catalog.pg_roles where oid = app
             and (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb or rolreplication)) then
    raise exception 'rmc2_app has a forbidden role attribute';
  end if;
  if (select rolconnlimit from pg_catalog.pg_roles where oid = app) <> 60 then
    raise exception 'rmc2_app connection limit is not 60';
  end if;
  if exists (select 1 from pg_catalog.pg_auth_members where member = app) then
    raise exception 'rmc2_app has role memberships';
  end if;

  -- rmc2_app owns nothing in rmc2.
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'rmc2' and c.relowner = app)
     or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'rmc2' and p.proowner = app)
     or exists (select 1 from pg_catalog.pg_namespace n where n.nspname = 'rmc2' and n.nspowner = app) then
    raise exception 'rmc2_app owns objects in rmc2';
  end if;

  -- No table privilege at all for anon / authenticated / service_role; no PUBLIC schema ACL.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      select string_agg(c.relname, ', ') into bad
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'rmc2' and c.relkind in ('r', 'p')
        and pg_catalog.has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
      if bad is not null then raise exception '% has privileges on rmc2 tables: %', r, bad; end if;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_namespace n, lateral pg_catalog.aclexplode(n.nspacl) a
             where n.nspname = 'rmc2' and a.grantee = 0) then
    raise exception 'schema rmc2 has a PUBLIC ACL entry';
  end if;

  -- Append-only really is append-only; mail_sends can still prune.
  select string_agg(t, ', ') into bad from unnest(audit) t
  where pg_catalog.has_table_privilege('rmc2_app', 'rmc2.' || t, 'UPDATE,DELETE,TRUNCATE');
  if bad is not null then raise exception 'rmc2_app can still modify append-only tables: %', bad; end if;
  if not pg_catalog.has_table_privilege('rmc2_app', 'rmc2.mail_sends', 'DELETE') then
    raise exception 'rmc2_app lost DELETE on mail_sends (reserveSend needs it)';
  end if;

  if not exists (select 1 from rmc2.app_meta where key = 'environment') then
    raise exception 'app_meta.environment missing';
  end if;
end
$$;
