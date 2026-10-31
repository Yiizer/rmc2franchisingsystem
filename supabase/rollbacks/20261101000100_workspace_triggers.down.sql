-- MANUAL rollback of 20261101000100_workspace_triggers.sql. Roll back 400 and 300 first.
-- TEST project only, Product Owner approval. Run as the owner in ONE psql session.
-- Effect: triggers and functions removed; data untouched, but workspace_versions stops advancing and
-- notice_recipients stops following notifications until re-applied.
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
drop trigger if exists workspace_inquiries_pending on rmc2.inquiries;
drop trigger if exists workspace_inquiries_bump on rmc2.inquiries;
drop trigger if exists workspace_users_bump on rmc2.users;
drop trigger if exists workspace_template_overrides_bump on rmc2.template_overrides;
drop trigger if exists workspace_notifications_bump on rmc2.notifications;
drop trigger if exists workspace_notifications_recipients on rmc2.notifications;
drop function if exists rmc2.trg_inquiry_index_pending();
drop function if exists rmc2.trg_bump_workspace_version();
drop function if exists rmc2.trg_notice_recipients();
-- supabase migration repair 20261101000100 --status reverted
commit;

