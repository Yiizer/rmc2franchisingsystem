import { db, inquiry, jsonParam } from './database';
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

/**
 * Projects every queued inquiry into inquiry_summaries / inquiry_keys. Claims first: with work pending it takes the
 * `idx-sync` lock, then DELETE ... RETURNING takes the ids, so two requests never project the same ids and an
 * inquiry changed meanwhile is simply queued again by its trigger (no lost enqueue). Runs inside a transaction
 * (joining the caller's); a failure rolls the claim back with it. Must not run inside snapshot(): call it first.
 */
export async function synchronizeInquiryIndex() {
  if (!await db.get('SELECT id FROM inquiry_index_pending LIMIT 1')) return;
  await db.transaction(async () => {
    await db.lock('idx-sync');
    const pending = await db.all<{id: string}>('DELETE FROM inquiry_index_pending RETURNING id');
    for (const {id} of pending) {
      await db.run('DELETE FROM inquiry_keys WHERE inquiry_id=?', id);
      const row = await db.get<{data: string}>('SELECT data FROM inquiries WHERE id=?', id);
      if (!row) await db.run('DELETE FROM inquiry_summaries WHERE id=?', id);
      else {
        const record: InquiryRecord = JSON.parse(row.data);
        await db.run('INSERT INTO inquiry_summaries (id,data,summary) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,summary=excluded.summary', id, jsonParam(clientProjection(record)), jsonParam(inquirySummary(record)));
        if (!isSampleForm(record.source)) for (const [kind, value] of clientIdentityKeys(record)) await db.run('INSERT INTO inquiry_keys (inquiry_id,kind,value) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, kind, value);
      }
    }
  });
}

/** `sync:false` is for read-only contexts (snapshot): the caller ran synchronizeInquiryIndex() beforehand. */
export async function matchingInquiries(record: InquiryRecord, sync = true): Promise<InquiryRecord[]> {
  if (isSampleForm(record.source)) return [];
  if (sync) await synchronizeInquiryIndex();
  const keys = clientIdentityKeys(record);
  if (!keys.length) return [];
  const where = keys.map(() => '(k.kind=? AND k.value=?)').join(' OR ');
  const rows = await db.all(`SELECT s.id,s.data FROM inquiry_summaries s WHERE s.id IN (SELECT k.inquiry_id FROM inquiry_keys k WHERE ${where})`,...keys.flat()) as {data: string}[];
  return rows.map(row => JSON.parse(row.data));
}

// ---- Duplicate-client registry locks (Postgres) -------------------------------------------------------------
// Two requests for the same client must not both pass the "no registration yet" check. Every registration-affecting
// transaction first takes a transaction-scoped advisory lock on each identity key of the record (`ck:<kind>:<value>`),
// in sorted order, and only then reads the matching registrations. For an edit, lock the union of the old and new keys.
// RMC2_PG_GLOBAL_REGISTRY_LOCK=1 swaps this for one global lock (fallback if per-key locking misbehaves in production).
export function registryLockKeys(...records: Pick<InquiryRecord, 'fields' | 'source'>[]): string[] {
  const keys = new Set<string>();
  for (const record of records) if (!isSampleForm(record.source)) for (const [kind, value] of clientIdentityKeys(record)) keys.add(`ck:${kind}:${value}`);
  if (!keys.size) return [];
  return process.env.RMC2_PG_GLOBAL_REGISTRY_LOCK === '1' ? ['ck:global'] : [...keys].sort();
}
export async function lockRegistry(...records: Pick<InquiryRecord, 'fields' | 'source'>[]) {
  if (db.dialect !== 'postgres') return;
  const keys = registryLockKeys(...records);
  if (keys.length) await db.lock(...keys);
}
/**
 * Reads an inquiry, locks its client identity keys (plus those of any proposed new version), then reads it again so
 * everything after the lock sees what earlier lock holders committed. Call first inside the transaction.
 * SQLite: plain read (its global write lock already serialises).
 */
export async function lockedInquiry(id: string, proposed?: (current: InquiryRecord) => Pick<InquiryRecord, 'fields' | 'source'> | undefined): Promise<InquiryRecord> {
  const first = await inquiry(id);
  if (db.dialect !== 'postgres') return first;
  await lockRegistry(first, ...[proposed?.(first)].filter((item): item is Pick<InquiryRecord, 'fields' | 'source'> => !!item));
  return inquiry(id);
}