-- Phase 4 security: the app role, grants and row-level security for schema rmc2.
--
-- Model: the app (server side only) connects as rmc2_app. Nobody else gets any access:
-- anon, authenticated and PUBLIC are revoked, and rmc2 must NOT be added to the Data API's exposed
-- schemas. RLS is enabled on every table with exactly one policy for rmc2_app ("app_all"), so a later
-- accidental grant to another role still returns zero rows. App-level authorization stays in the app.
--
-- NO PASSWORD is set here. Set it out of band (see supabase/README.md):
--   ALTER ROLE rmc2_app PASSWORD '...';   -- run by the project owner, value never committed
--
-- Idempotent. Roles are cluster-wide objects, so the role is created only if missing.

-- 1. Role (no password, no inheritance, cannot bypass RLS) -------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'rmc2_app') then
    create role rmc2_app login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  -- An existing role is left as is (changing superuser/bypassrls attributes needs a superuser, which
  -- the hosted owner role is not); section 5 asserts its attributes instead.
end
$$;

-- Role defaults (apply to every new connection of this role, including through the pooler).
alter role rmc2_app set search_path = rmc2;
alter role rmc2_app set statement_timeout = '15s';
alter role rmc2_app set lock_timeout = '5s';
alter role rmc2_app set idle_in_transaction_session_timeout = '30s';

-- 2. Revoke everything from PUBLIC / anon / authenticated -------------------------------------------------------
-- anon and authenticated exist on Supabase but not on plain Postgres, so loop over what exists.

do $$
declare
  r text;
  target text;
begin
  foreach r in array array['public', 'anon', 'authenticated'] loop
    if r = 'public' or exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      target := case when r = 'public' then 'public' else quote_ident(r) end;
      execute format('revoke all on schema rmc2 from %s', target);
      execute format('revoke all on all tables in schema rmc2 from %s', target);
      execute format('revoke all on all sequences in schema rmc2 from %s', target);
      execute format('revoke all on all functions in schema rmc2 from %s', target);
      execute format('alter default privileges in schema rmc2 revoke all on tables from %s', target);
      execute format('alter default privileges in schema rmc2 revoke all on sequences from %s', target);
      execute format('alter default privileges in schema rmc2 revoke all on functions from %s', target);
    end if;
  end loop;
end
$$;

-- 3. Grants to rmc2_app (DML only; no DDL, no TRUNCATE) --------------------------------------------------------

grant usage on schema rmc2 to rmc2_app;
grant select, insert, update, delete on all tables in schema rmc2 to rmc2_app;
grant usage, select on all sequences in schema rmc2 to rmc2_app;
grant execute on all functions in schema rmc2 to rmc2_app;

-- Tables, sequences and functions created later by the migration owner get the same grants.
alter default privileges in schema rmc2 grant select, insert, update, delete on tables to rmc2_app;
alter default privileges in schema rmc2 grant usage, select on sequences to rmc2_app;
alter default privileges in schema rmc2 grant execute on functions to rmc2_app;

-- 4. Row-level security on every rmc2 table, one policy for rmc2_app --------------------------------------------
-- Not FORCEd: the owner (migrations, maintenance) bypasses RLS, rmc2_app does not.

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'rmc2' and c.relkind in ('r', 'p')
  loop
    execute format('alter table rmc2.%I enable row level security', t.relname);
    execute format('drop policy if exists app_all on rmc2.%I', t.relname);
    execute format('create policy app_all on rmc2.%I as permissive for all to rmc2_app using (true) with check (true)', t.relname);
  end loop;
end
$$;

-- 5. Assertions: fail the migration (and roll it back) if the result is not what we intend -----------------------

do $$
declare
  missing text;
  extra   text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'rmc2' and c.relkind in ('r', 'p')
    and (not c.relrowsecurity
         or not exists (select 1 from pg_catalog.pg_policies p
                        where p.schemaname = 'rmc2' and p.tablename = c.relname and p.policyname = 'app_all'));
  if missing is not null then
    raise exception 'rmc2 tables without RLS or app_all policy: %', missing;
  end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ') into extra
  from pg_catalog.pg_policies p where p.schemaname = 'rmc2' and p.policyname <> 'app_all';
  if extra is not null then
    raise exception 'unexpected rmc2 policies: %', extra;
  end if;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'rmc2_app' and (rolsuper or rolbypassrls or rolinherit)) then
    raise exception 'rmc2_app must be NOSUPERUSER NOBYPASSRLS NOINHERIT';
  end if;

  if exists (select 1 from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')
             and (pg_catalog.has_schema_privilege(rolname, 'rmc2', 'USAGE')
                  or pg_catalog.has_schema_privilege(rolname, 'rmc2', 'CREATE'))) then
    raise exception 'anon/authenticated still have access to schema rmc2';
  end if;
end
$$;
