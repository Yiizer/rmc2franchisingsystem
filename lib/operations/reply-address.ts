import { isStrictEmail } from './types';

// Client-safe (no server imports): the one rule for "who does an outcome email go to". The UI shows this on the read-only To line and
// reply-recipient.ts (server) uses it, so the two can never differ. It reads only what was fixed at intake: source.sender (the address the
// inquiry came from, or the owner's account email when linked, or the agent email typed on a manual entry), then, for records from before
// source.sender existed, the untouched original form's agent email. Later edits of fields.agentEmail never move it.
export function replyAddress(record: { source: { sender?: string; fields: Record<string, string> } }): string {
  const address = (record.source.sender || record.source.fields?.agentEmail || '').trim();
  return isStrictEmail(address) ? address : '';
}
