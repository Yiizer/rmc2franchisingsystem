import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db, safeStorage } from './database';
import type { Staff } from './types';

// Access events are separate from preparation history: viewing a confidential
// file must never claim the inquiry or count as editing it.
export async function privateFile(user:Staff,inquiryId:string,kind:string,relative:string){
  const bytes=readFileSync(safeStorage(relative));
  await logFileAccess(user,inquiryId,kind);
  return bytes;
}
export async function logFileAccess(user:Staff,inquiryId:string,kind:string){await db.run('INSERT INTO file_access(id,user_id,inquiry_id,kind,at) VALUES(?,?,?,?,?)',randomUUID(),user.id,inquiryId,kind,new Date().toISOString());}
