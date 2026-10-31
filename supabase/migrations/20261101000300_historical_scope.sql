-- Phase 4: workspace_versions scope 'historical', so every instance can stamp the directory cache cheaply
-- (directoryRecords reads workspace_versions.historical when the row exists). Bumped once per transaction,
-- at COMMIT, by the same deferred trigger function as the other scopes. Idempotent.
set search_path = rmc2;

insert into rmc2.workspace_versions (scope, version) values ('historical', 0)
  on conflict (scope) do nothing;

drop trigger if exists workspace_historical_accounts_bump on rmc2.historical_accounts;
create constraint trigger workspace_historical_accounts_bump
  after insert or update or delete on rmc2.historical_accounts
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('historical');

drop trigger if exists workspace_historical_imports_bump on rmc2.historical_imports;
create constraint trigger workspace_historical_imports_bump
  after insert or update or delete on rmc2.historical_imports
  deferrable initially deferred
  for each row execute function rmc2.trg_bump_workspace_version('historical');
