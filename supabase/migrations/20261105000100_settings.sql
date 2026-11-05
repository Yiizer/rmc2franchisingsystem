-- Phase 3: small editable app settings (first use: the division/branch table, key 'division_table', edited by the Head).
set local search_path = rmc2;

create table if not exists rmc2.settings (
  key  text collate "C" primary key,
  data jsonb not null
);

grant select, insert, update, delete on rmc2.settings to rmc2_app;
alter table rmc2.settings enable row level security;
drop policy if exists app_all on rmc2.settings;
create policy app_all on rmc2.settings for all to rmc2_app using (true) with check (true);
