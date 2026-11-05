-- 1.4 Better locking: handover requests (a colleague asks the holder to release) and reservations
-- (a supervisor hands an inquiry to someone who has not opened it yet). Leases stay in inquiry_activity.
set local search_path = rmc2;

create table if not exists rmc2.inquiry_handover (
  id         text collate "C" primary key,
  inquiry_id text collate "C" not null,
  kind       text collate "C" not null check (kind in ('request', 'reserve')),
  user_id    text collate "C" not null,  -- request: the requester; reserve: the user the inquiry is reserved for
  by_user    text collate "C" not null,  -- request: the holder asked; reserve: the supervisor who assigned it
  at         text collate "C" not null,
  until_at   text collate "C" not null,
  state      text collate "C" not null
);
create index if not exists handover_inquiry on rmc2.inquiry_handover (inquiry_id, kind, at);

grant select, insert, update, delete on rmc2.inquiry_handover to rmc2_app;
alter table rmc2.inquiry_handover enable row level security;
drop policy if exists app_all on rmc2.inquiry_handover;
create policy app_all on rmc2.inquiry_handover for all to rmc2_app using (true) with check (true);
