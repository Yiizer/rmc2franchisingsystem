-- Phase 7 (lean): inbound email. Messages read from the test inbox (read-only IMAP) wait here for staff review;
-- nothing becomes an inquiry automatically. Same RLS/grant pattern as every rmc2 table.
set local search_path = rmc2;

create table if not exists rmc2.inbound_messages (
  id text collate "C" primary key,
  message_id text collate "C" not null unique,
  received_at text collate "C" not null,
  state text collate "C" not null,
  data jsonb not null
);
create index if not exists inbound_received on rmc2.inbound_messages (received_at);

create table if not exists rmc2.inbound_cursor (
  mailbox text collate "C" primary key,
  uidvalidity text collate "C" not null,
  last_uid bigint not null,
  checked_at text collate "C" not null
);

grant select, insert, update, delete on rmc2.inbound_messages, rmc2.inbound_cursor to rmc2_app;
alter table rmc2.inbound_messages enable row level security;
alter table rmc2.inbound_cursor enable row level security;
drop policy if exists app_all on rmc2.inbound_messages;
drop policy if exists app_all on rmc2.inbound_cursor;
create policy app_all on rmc2.inbound_messages for all to rmc2_app using (true) with check (true);
create policy app_all on rmc2.inbound_cursor for all to rmc2_app using (true) with check (true);
