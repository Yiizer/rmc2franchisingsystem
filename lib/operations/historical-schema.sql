CREATE TABLE IF NOT EXISTS historical_accounts (
 id TEXT PRIMARY KEY, batch TEXT NOT NULL, sheet TEXT NOT NULL, source_row INTEGER NOT NULL,
 account TEXT NOT NULL, account_key TEXT NOT NULL, agent TEXT NOT NULL, branch TEXT NOT NULL,
 status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(batch,sheet,source_row)
);
CREATE INDEX IF NOT EXISTS historical_account_key ON historical_accounts(account_key);
CREATE INDEX IF NOT EXISTS historical_sheet ON historical_accounts(sheet,status);
CREATE TABLE IF NOT EXISTS historical_reviews (
 id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, historical_id TEXT NOT NULL, identity TEXT NOT NULL,
 outcome TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS historical_review_inquiry ON historical_reviews(inquiry_id,historical_id,identity,at);
CREATE TABLE IF NOT EXISTS historical_imports (id TEXT PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, report TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS historical_edits (
 id TEXT PRIMARY KEY, historical_id TEXT NOT NULL, field TEXT NOT NULL,
 old_value TEXT, new_value TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS historical_edit_record ON historical_edits(historical_id,at);
