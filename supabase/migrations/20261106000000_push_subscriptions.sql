-- Phone notifications (Web Push): one row per phone/browser subscription. Muted event types live in rmc2.settings ('push:<user id>').
set local search_path = rmc2;

create table if not exists rmc2.push_subscriptions (
  id           text collate "C" primary key,   -- sha256 of the endpoint (first 40 hex)
  user_id      text collate "C" not null,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  label        text not null,
  created_at   text collate "C" not null,
  last_used_at text collate "C" not null
);
create index if not exists push_user on rmc2.push_subscriptions (user_id);

grant select, insert, update, delete on rmc2.push_subscriptions to rmc2_app;
alter table rmc2.push_subscriptions enable row level security;
drop policy if exists app_all on rmc2.push_subscriptions;
create policy app_all on rmc2.push_subscriptions for all to rmc2_app using (true) with check (true);
