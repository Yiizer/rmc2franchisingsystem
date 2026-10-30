import { db } from './database';
import { clientIdentityKeys, protectionFor } from './client-rules';
import { isSampleForm } from './types';
import type { InquiryRecord, InquirySummary } from './types';

export function inquirySummary(record: InquiryRecord): InquirySummary {
  return {
    id: record.id, revision: record.revision, status: record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    fields: Object.fromEntries(['company', 'division', 'agentName', 'contactName', 'addressee'].map(key => [key, record.fields[key] || ''])),
    templateId: record.templateId, handledBy: record.handledBy,
    workProgress: record.workProgress, customized: !!record.customization,
    submittedAt: record.submissions.at(-1)?.at,
    deliveredAt: record.submissions.at(-1)?.delivery?.at,
    preparedBy: record.submissions.at(-1)?.generated.preparedBy,
    approvedBy: record.submissions.at(-1)?.decision?.action==='approve'?record.submissions.at(-1)?.decision?.actorId:undefined,
    sentBy: record.submissions.at(-1)?.delivery?.sentBy,
  };
}

// Only identifying data and registration rules belong in this projection.
// Full history, document versions, source cells, emails and edited content are
// read from the authoritative inquiry only when its workspace is opened.
function clientProjection(record: InquiryRecord): InquiryRecord {
  const keys = ['company', 'contactName', 'addressee', 'agentName', 'agentEmail', 'agentPhone'];
  const fields = (values: Record<string, string>) => Object.fromEntries(keys.map(key => [key, values[key] || '']));
  return {
    id: record.id, revision: record.revision, status: record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    fields: fields(record.fields), source: {...record.source, cells: [], fields: fields(record.source.fields)},
    closure: record.closure, protection: protectionFor(record) || undefined, clientReview: record.clientReview,
    email: {to: '', subject: '', body: ''}, emailOverrides: [], templateId: '',
    handledBy: [], submissions: [], history: [], chat: [], detailRequests: [],
    notes: '', returnNote: '', returnFlags: [],
  };
}

export function synchronizeInquiryIndex() {
  const database = db();
  if (!database.prepare('SELECT id FROM inquiry_index_pending LIMIT 1').get()) return;
  // SAVEPOINT works both on reads and inside a registration transaction. Index
  // changes roll back with a failed BOR transfer or conflicting update.
  database.exec('SAVEPOINT inquiry_projection');
  try {
    const pending = database.prepare('SELECT id FROM inquiry_index_pending').all() as {id: string}[];
    const read = database.prepare('SELECT data FROM inquiries WHERE id=?');
    const save = database.prepare('INSERT INTO inquiry_summaries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,summary=excluded.summary');
    const key = database.prepare('INSERT OR IGNORE INTO inquiry_keys VALUES (?,?,?)');
    for (const {id} of pending) {
      database.prepare('DELETE FROM inquiry_keys WHERE inquiry_id=?').run(id);
      const row = read.get(id) as {data: string} | undefined;
      if (!row) database.prepare('DELETE FROM inquiry_summaries WHERE id=?').run(id);
      else {
        const record: InquiryRecord = JSON.parse(row.data);
        save.run(id, JSON.stringify(clientProjection(record)), JSON.stringify(inquirySummary(record)));
        if (!isSampleForm(record.source)) for (const [kind, value] of clientIdentityKeys(record)) key.run(id, kind, value);
      }
      database.prepare('DELETE FROM inquiry_index_pending WHERE id=?').run(id);
    }
    database.exec('RELEASE inquiry_projection');
  } catch (error) {
    database.exec('ROLLBACK TO inquiry_projection; RELEASE inquiry_projection');
    throw error;
  }
}

export function matchingInquiries(record: InquiryRecord): InquiryRecord[] {
  if (isSampleForm(record.source)) return [];
  synchronizeInquiryIndex();
  const keys = clientIdentityKeys(record);
  if (!keys.length) return [];
  const where = keys.map(() => '(k.kind=? AND k.value=?)').join(' OR ');
  const rows = db().prepare(`SELECT DISTINCT s.id,s.data FROM inquiry_keys k JOIN inquiry_summaries s ON s.id=k.inquiry_id WHERE ${where}`).all(...keys.flat()) as {data: string}[];
  return rows.map(row => JSON.parse(row.data));
}
