-- "Report a problem" (pilot plan 2026-11-16, item 5): one row per report a signed-in user files from any screen.
-- data holds the description and the context the app captured (page, role, inquiry id, app version, viewport,
-- browser, status note). Only the Head and Admin read and update reports; everyone signed in can file one.
set local search_path = rmc2;

create table if not exists rmc2.problem_reports (
  id         text collate "C" primary key,   -- random UUID
  at         text collate "C" not null,      -- ISO time filed
  user_id    text collate "C" not null,
  status     text collate "C" not null check (status in ('new', 'in-progress', 'fixed')),
  data       text not null                   -- JSON
);
create index if not exists problem_reports_at on rmc2.problem_reports (at);
create index if not exists problem_reports_user_at on rmc2.problem_reports (user_id, at);

grant select, insert, update on rmc2.problem_reports to rmc2_app;
alter table rmc2.problem_reports enable row level security;
drop policy if exists app_all on rmc2.problem_reports;
create policy app_all on rmc2.problem_reports for all to rmc2_app using (true) with check (true);
