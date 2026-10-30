import type { DatabaseSync } from 'node:sqlite';

// Derived indexes can always be rebuilt from the original records. Triggers also
// cover imports and maintenance tools that write directly to SQLite.
export function installWorkspaceIndexes(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_versions (scope TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO workspace_versions(scope) VALUES ('inquiries'),('metadata'),('notifications');
    CREATE TABLE IF NOT EXISTS inquiry_index_pending (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS inquiry_summaries (id TEXT PRIMARY KEY, data TEXT NOT NULL, summary TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiry_keys (inquiry_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(inquiry_id,kind,value));
    CREATE INDEX IF NOT EXISTS inquiry_keys_lookup ON inquiry_keys(kind,value,inquiry_id);
    CREATE TABLE IF NOT EXISTS notice_recipients (notice_id TEXT NOT NULL, user_id TEXT NOT NULL, is_read INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY(notice_id,user_id));
    CREATE INDEX IF NOT EXISTS notice_recipient_page ON notice_recipients(user_id,at DESC,notice_id DESC);
    CREATE INDEX IF NOT EXISTS notice_recipient_unread ON notice_recipients(user_id,is_read);
    CREATE INDEX IF NOT EXISTS activity_inquiry ON inquiry_activity(inquiry_id,started_at,user_id);
    CREATE INDEX IF NOT EXISTS notice_inquiry ON notifications(json_extract(data,'$.inquiryId'),json_extract(data,'$.title'));
  `);
  for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
    const row = action === 'DELETE' ? 'OLD' : 'NEW';
    database.exec(`CREATE TRIGGER IF NOT EXISTS workspace_inquiries_${action} AFTER ${action} ON inquiries BEGIN
      INSERT OR IGNORE INTO inquiry_index_pending(id) VALUES (${row}.id);
      UPDATE workspace_versions SET version=version+1 WHERE scope='inquiries';
    END;`);
    for (const table of ['users', 'template_overrides']) {
      database.exec(`CREATE TRIGGER IF NOT EXISTS workspace_${table}_${action} AFTER ${action} ON ${table} BEGIN
        UPDATE workspace_versions SET version=version+1 WHERE scope='metadata';
      END;`);
    }
    database.exec(`CREATE TRIGGER IF NOT EXISTS workspace_notifications_${action} AFTER ${action} ON notifications BEGIN
      DELETE FROM notice_recipients WHERE notice_id=${row}.id;
      ${action === 'DELETE' ? '' : `INSERT INTO notice_recipients(notice_id,user_id,is_read,at)
        SELECT NEW.id, recipients.value, EXISTS(SELECT 1 FROM json_each(NEW.data,'$.readBy') WHERE value=recipients.value), json_extract(NEW.data,'$.at')
        FROM json_each(NEW.data,'$.recipientIds') recipients;`}
      UPDATE workspace_versions SET version=version+1 WHERE scope='notifications';
    END;`);
  }
  database.exec(`
    INSERT OR IGNORE INTO inquiry_index_pending SELECT id FROM inquiry_summaries WHERE json_extract(summary,'$.status')='Sent' AND json_extract(summary,'$.preparedBy') IS NULL;
    INSERT OR IGNORE INTO inquiry_index_pending SELECT id FROM inquiries WHERE id NOT IN (SELECT id FROM inquiry_summaries);
    INSERT OR IGNORE INTO notice_recipients(notice_id,user_id,is_read,at)
      SELECT n.id,r.value,EXISTS(SELECT 1 FROM json_each(n.data,'$.readBy') WHERE value=r.value),json_extract(n.data,'$.at')
      FROM notifications n, json_each(n.data,'$.recipientIds') r;
  `);
}
