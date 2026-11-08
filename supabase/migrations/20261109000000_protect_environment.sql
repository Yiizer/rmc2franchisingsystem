-- Security review 2026-11-09: the app role must never change the environment marker. The rollback scripts run only
-- when rmc2.app_meta.environment = 'test', so an app bug or injection that wrote 'test' on production would unlock
-- them there. rmc2_app may still read the marker and keeps writing its other keys (projection_version); the owner
-- (migrations, the production bootstrap) is unaffected. Idempotent.
set local search_path = rmc2, pg_catalog;

create or replace function rmc2.trg_protect_environment() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user = 'rmc2_app'
     and ((tg_op in ('UPDATE', 'DELETE') and old.key = 'environment') or (tg_op in ('INSERT', 'UPDATE') and new.key = 'environment')) then
    raise exception 'app_meta.environment can only be changed by the database owner' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function rmc2.trg_protect_environment() from public;

drop trigger if exists protect_environment on rmc2.app_meta;
create trigger protect_environment before insert or update or delete on rmc2.app_meta
  for each row execute function rmc2.trg_protect_environment();

-- Self-check: the trigger exists and the marker is present.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_trigger where tgname = 'protect_environment' and tgrelid = 'rmc2.app_meta'::regclass) then
    raise exception 'protect_environment trigger missing';
  end if;
  if not exists (select 1 from rmc2.app_meta where key = 'environment') then
    raise exception 'app_meta.environment missing: set it before this migration';
  end if;
end
$$;
