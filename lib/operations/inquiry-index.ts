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
// Keep only the approved decisions so isRegistered() also holds for approved-but-undelivered records.
function registeredSubmissions(record: InquiryRecord) {
  return record.submissions.filter(item => item.decision?.action === 'approve').map(item => ({version: item.version, decision: item.decision})) as unknown as InquiryRecord['submissions'];
}
function clientProjection(record: InquiryRecord): InquiryRecord {
  const keys = ['company', 'contactName', 'addressee', 'agentName', 'agentEmail', 'agentPhone'];
  const fields = (values: Record<string, string>) => Object.fromEntries(keys.map(key => [key, values[key] || '']));
  return {
    id: record.id, revision: record.revision, status: record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    fields: fields(record.fields), source: {...record.source, cells: [], fields: fields(record.source.fields)},
    closure: record.closure, protection: protectionFor(record) || undefined, clientReview: record.clientReview,
    email: {to: '', subject: '', body: ''}, emailOverrides: [], templateId: '',
    handledBy: [], submissions: registeredSubmissions(record), history: [], chat: [], detailRequests: [],
    notes: '', returnNote: '', returnFlags: [],
  };
}

export async function synchronizeInquiryIndex() {
  if (!await db.get('SELECT id FROM inquiry_index_pending LIMIT 1')) return;
  // Runs inside a transaction (joining the caller's when there is one), so no other request can
  // interleave. The SAVEPOINT keeps index changes rolling back with a failed BOR transfer or
  // conflicting update without discarding the caller's earlier work.
  await db.transaction(async () => {
    await db.exec('SAVEPOINT inquiry_projection');
    try {
      const pending = await db.all<{id: string}>('SELECT id FROM inquiry_index_pending');
      for (const {id} of pending) {
        await db.run('DELETE FROM inquiry_keys WHERE inquiry_id=?', id);
        const row = await db.get<{data: string}>('SELECT data FROM inquiries WHERE id=?', id);
        if (!row) await db.run('DELETE FROM inquiry_summaries WHERE id=?', id);
        else {
          const record: InquiryRecord = JSON.parse(row.data);
          await db.run('INSERT INTO inquiry_summaries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,summary=excluded.summary', id, JSON.stringify(clientProjection(record)), JSON.stringify(inquirySummary(record)));
          if (!isSampleForm(record.source)) for (const [kind, value] of clientIdentityKeys(record)) await db.run('INSERT OR IGNORE INTO inquiry_keys VALUES (?,?,?)', id, kind, value);
        }
        await db.run('DELETE FROM inquiry_index_pending WHERE id=?', id);
      }
      await db.exec('RELEASE inquiry_projection');
    } catch (error) {
      await db.exec('ROLLBACK TO inquiry_projection; RELEASE inquiry_projection');
      throw error;
    }
  });
}

export async function matchingInquiries(record: InquiryRecord): Promise<InquiryRecord[]> {
  if (isSampleForm(record.source)) return [];
  await synchronizeInquiryIndex();
  const keys = clientIdentityKeys(record);
  if (!keys.length) return [];
  const where = keys.map(() => '(k.kind=? AND k.value=?)').join(' OR ');
  const rows = await db.all(`SELECT DISTINCT s.id,s.data FROM inquiry_keys k JOIN inquiry_summaries s ON s.id=k.inquiry_id WHERE ${where}`,...keys.flat()) as {data: string}[];
  return rows.map(row => JSON.parse(row.data));
}
