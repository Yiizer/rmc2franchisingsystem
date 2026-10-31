-- Phase 4 init: schema rmc2, mirroring the SQLite tables created by openDatabase (database.ts),
-- installWorkspaceIndexes (workspace-schema.ts) and historical-schema.sql.
--
-- Conventions
--   * Everything is schema-qualified; this file does not depend on search_path.
--   * Ordered / compared keys and ISO-8601 timestamps are `text collate "C"` so ordering and
--     comparison are byte-wise, exactly like SQLite's default BINARY collation.
--   * SQLite JSON text columns are jsonb. Strip \u0000 before writing (jsonb rejects it).
--   * Column order matches SQLite, because some call sites still INSERT positionally.
--   * Idempotent: safe to apply twice and safe on an empty project. No data is dropped.
--
-- Triggers are in 20261101000100_workspace_triggers.sql; roles, grants and RLS in 20261101000200_security.sql.

create schema if not exists rmc2;

-- Core tables (database.ts) ------------------------------------------------------------------

create table if not exists rmc2.security_events (
  id       text collate "C" primary key,
  at       text collate "C" not null,
  actor_id text collate "C" not null,
  action   text not null
);

-- window_start / blocked_until are epoch milliseconds.
create table if not exists rmc2.auth_attempts (
  key           text collate "C" primary key,
  failures      integer not null,
  window_start  bigint  not null,
  blocked_until bigint  not null
);

create table if not exists rmc2.template_versions (
  id          text collate "C" primary key,
  template_id text collate "C" not null,
  data        jsonb not null,
  state       text  not null,
  actor_id    text collate "C" not null,
  at          text collate "C" not null
);

create table if not exists rmc2.template_overrides (
  id   text collate "C" primary key,
  data jsonb not null
);

create table if not exists rmc2.ai_usage (
  id            text collate "C" primary key,
  at            text collate "C" not null,
  provider      text not null,
  model         text not null,
  input_tokens  integer not null,
  output_tokens integer not null
);

create table if not exists rmc2.users (
  id       text collate "C" primary key,
  data     jsonb not null,
  password text  not null
);

create table if not exists rmc2.sessions (
  token   text collate "C" primary key,
  user_id text collate "C" not null,
  expires text collate "C" not null
);

create table if not exists rmc2.inquiries (
  id       text collate "C" primary key,
  revision integer not null,
  data     jsonb   not null
);

create table if not exists rmc2.notifications (
  id   text collate "C" primary key,
  data jsonb not null
);

create table if not exists rmc2.inquiry_activity (
  session    text collate "C" not null,
  tab        text collate "C" not null,
  inquiry_id text collate "C" not null,
  user_id    text collate "C" not null,
  started_at text collate "C" not null,
  seen_at    text collate "C" not null,
  primary key (session, tab)
);

create table if not exists rmc2.file_access (
  id         text collate "C" primary key,
  user_id    text collate "C" not null,
  inquiry_id text collate "C" not null,
  kind       text not null,
  at         text collate "C" not null
);

create table if not exists rmc2.outbox (
  id         text collate "C" primary key,
  inquiry_id text collate "C" not null,
  version    integer not null,
  kind       text    not null,
  status     text    not null,
  data       jsonb   not null,
  unique (inquiry_id, version, kind)
);

-- Moved out of the lazy DDL in service.ts (SQLite creates it on first mail send).
create table if not exists rmc2.mail_sends (
  id        text collate "C" primary key,
  at        text collate "C" not null,
  kind      text not null,
  outbox_id text collate "C" not null
);

-- Workspace index tables (workspace-schema.ts) --------------------------------------------------

create table if not exists rmc2.workspace_versions (
  scope   text collate "C" primary key,
  version bigint not null default 0
);

create table if not exists rmc2.inquiry_index_pending (
  id text collate "C" primary key
);

create table if not exists rmc2.inquiry_summaries (
  id      text collate "C" primary key,
  data    jsonb not null,
  summary jsonb not null
);

create table if not exists rmc2.inquiry_keys (
  inquiry_id text collate "C" not null,
  kind       text collate "C" not null,
  value      text collate "C" not null,
  primary key (inquiry_id, kind, value)
);

-- is_read stays 0/1 (portable SQL with SQLite).
create table if not exists rmc2.notice_recipients (
  notice_id text collate "C" not null,
  user_id   text collate "C" not null,
  is_read   integer not null,
  at        text collate "C" not null,
  primary key (notice_id, user_id)
);

-- Historical directory (historical-schema.sql) ----------------------------------------------------

create table if not exists rmc2.historical_accounts (
  id         text collate "C" primary key,
  batch      text collate "C" not null,
  sheet      text collate "C" not null,
  source_row integer not null,
  account    text not null,
  account_key text collate "C" not null,
  agent      text not null,
  branch     text not null,
  status     text not null,
  data       jsonb not null,
  unique (batch, sheet, source_row)
);

-- seq replaces SQLite's implicit rowid for insertion-order reads. It is the LAST column so that
-- positional 8-value INSERTs keep working; new code should list columns.
create table if not exists rmc2.historical_reviews (
  id            text collate "C" primary key,
  inquiry_id    text collate "C" not null,
  historical_id text collate "C" not null,
  identity      text collate "C" not null,
  outcome       text not null,
  actor         text not null,
  at            text collate "C" not null,
  reason        text not null,
  seq           bigint generated always as identity
);

create table if not exists rmc2.historical_imports (
  id     text collate "C" primary key,
  at     text collate "C" not null,
  source text not null,
  report jsonb not null
);

create table if not exists rmc2.historical_edits (
  id            text collate "C" primary key,
  historical_id text collate "C" not null,
  field         text not null,
  old_value     text,
  new_value     text not null,
  actor         text not null,
  at            text collate "C" not null,
  reason        text not null,
  seq           bigint generated always as identity
);

-- New in Postgres ------------------------------------------------------------------------------------

-- Atomic counters: UPDATE rmc2.counters SET n=n+1 WHERE name='inquiry' RETURNING n.
-- 'inquiry' starts at 129 (the demo seed uses INQ-2026-00126..00129), so the first number issued is 130.
-- When importing real data, set n to the highest existing inquiry number first.
create table if not exists rmc2.counters (
  name text collate "C" primary key,
  n    bigint not null
);

-- Key/value metadata; schema_version is checked at startup (fail closed), projection_version
-- triggers a reindex of inquiry_summaries/inquiry_keys when the code's version differs.
create table if not exists rmc2.app_meta (
  key   text collate "C" primary key,
  value text not null
);

-- Indexes (all of the SQLite ones, same names) -------------------------------------------------------

create index if not exists inquiry_keys_lookup on rmc2.inquiry_keys (kind, value, inquiry_id);
create index if not exists notice_recipient_page on rmc2.notice_recipients (user_id, at desc, notice_id desc);
create index if not exists notice_recipient_unread on rmc2.notice_recipients (user_id, is_read);
create index if not exists activity_inquiry on rmc2.inquiry_activity (inquiry_id, started_at, user_id);
create index if not exists notice_inquiry on rmc2.notifications ((data->>'inquiryId'), (data->>'title'));
create index if not exists historical_account_key on rmc2.historical_accounts (account_key);
create index if not exists historical_sheet on rmc2.historical_accounts (sheet, status);
create index if not exists historical_review_inquiry on rmc2.historical_reviews (inquiry_id, historical_id, identity, at);
create index if not exists historical_edit_record on rmc2.historical_edits (historical_id, at);
-- Postgres-only: mail caps count recent sends by time (service.ts), and seq reads are ordered.
create index if not exists mail_sends_at on rmc2.mail_sends (at);
create index if not exists historical_review_seq on rmc2.historical_reviews (seq);
create index if not exists historical_edit_seq on rmc2.historical_edits (seq);

-- Seed rows ---------------------------------------------------------------------------------------------

insert into rmc2.workspace_versions (scope) values ('inquiries'), ('metadata'), ('notifications')
  on conflict (scope) do nothing;
insert into rmc2.counters (name, n) values ('inquiry', 129)
  on conflict (name) do nothing;
insert into rmc2.app_meta (key, value) values ('schema_version', '1'), ('projection_version', '1')
  on conflict (key) do nothing;
