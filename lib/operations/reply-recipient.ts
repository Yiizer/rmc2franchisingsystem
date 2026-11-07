import { AppError } from './errors';
import { replyAddress } from './reply-address';
import type { InquiryRecord } from './types';

// ONE place decides who an outcome email (proposal sent, request missing details, decline) goes to: replyAddress (client-safe, shared with the UI).
type Source = Pick<InquiryRecord, 'source'>;
export function replyRecipientOrNull(record: Source): string | null {
  return replyAddress(record) || null;
}
export function replyRecipient(record: Source): string {
  const address = replyAddress(record);
  if (!address) throw new AppError('No reply address on this inquiry.', 422);
  return address;
}
