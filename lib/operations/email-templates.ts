import { z } from 'zod';
import { AppError, db, jsonParam, transaction } from './database';
import { canPrepareProposal } from './permissions';
import type { EmailTemplatesResponse, MyEmailTemplates, Staff } from './types';

// Each staff member's own wording for the three agent emails (feedback round 2026-11-07, item 10).
// Stored in settings('email_templates:<userId>') like the division table (division-store.ts): no migration, never part of Staff.
// The id always comes from the session, so a user can only ever read or write their own key.
const keyOf = (userId: string) => 'email_templates:' + userId;

/** Today's built-in wording as placeholders. For details and decline there was no built-in text, so these are plain sensible defaults. */
export const DEFAULT_EMAIL_TEMPLATES: EmailTemplatesResponse['defaults'] = {
  proposal: {
    subject: 'Proposal — {company} — {proposalName}',
    body: 'Dear {agentName},\n\nPlease find attached the {proposalName} proposal for {company}, prepared from the submitted franchise form.\n\nPlease review the attached proposal for the complete rates, benefits and coverage conditions. Let us know if you need any clarification.\n\nBest regards,\n{myName}\nFranchising Operations\nRMC2 Consultancy Corporation',
  },
  details: {
    body: 'Dear {agentName},\n\nThank you for your inquiry for {company}. To prepare the proposal we still need a few details. Please reply to this email with the missing information.\n\nBest regards,\n{myName}\nFranchising Operations\nRMC2 Consultancy Corporation',
  },
  decline: {
    body: 'Dear {agentName},\n\nThank you for your inquiry for {company}. We are unable to proceed with this request.\n\nBest regards,\n{myName}\nFranchising Operations\nRMC2 Consultancy Corporation',
  },
};

export type PlaceholderValues = { agentName: string; company: string; proposalName: string; myName: string };
/** Plain text replacement of the four known placeholders in one pass (a value is never searched again). Any other {braces} stay as typed. Nothing is executed. */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(/\{(agentName|company|proposalName|myName)\}/g, (_match, name: keyof PlaceholderValues) => values[name]);
}

const noNul = (value: string) => !value.includes('\0');
const subject = z.string().trim().min(1).max(250).refine(value => !/[\r\n\u2028\u2029]/.test(value), 'The subject must be one line.').refine(noNul, 'Invalid character.');
const body = z.string().min(1).max(10000).refine(noNul, 'Invalid character.');
const saveSchema = z.object({
  proposal: z.object({ subject, body }).strict().nullable().optional(),
  details: z.object({ body }).strict().nullable().optional(),
  decline: z.object({ body }).strict().nullable().optional(),
}).strict();

function allowed(user: Pick<Staff, 'role'>) {
  if (!canPrepareProposal(user)) throw new AppError('Email templates are for the Head, Supervisors and Employees.', 403);
}
/** The saved templates of one user ({} when none). Unreadable data counts as none. */
export async function loadMyEmailTemplates(userId: string): Promise<MyEmailTemplates> {
  const row = await db.get<{ data: string }>('SELECT data FROM settings WHERE key=?', keyOf(userId));
  if (!row) return {};
  try { const parsed = JSON.parse(row.data) as MyEmailTemplates; return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}
export async function getEmailTemplates(user: Staff): Promise<EmailTemplatesResponse> {
  allowed(user);
  return { mine: await loadMyEmailTemplates(user.id), defaults: DEFAULT_EMAIL_TEMPLATES };
}
/** Partial update of the caller's own templates. A kind set to null is reset to the default; a kind left out is unchanged. */
export async function saveEmailTemplates(user: Staff, input: unknown): Promise<EmailTemplatesResponse> {
  allowed(user);
  const patch = saveSchema.parse(input);
  const mine = await transaction(async () => {
    await db.lock('email-templates:' + user.id);
    const next: MyEmailTemplates = { ...(await loadMyEmailTemplates(user.id)) };
    for (const kind of ['proposal', 'details', 'decline'] as const) {
      const value = patch[kind];
      if (value === null) delete next[kind];
      else if (value) (next as Record<string, unknown>)[kind] = value;
    }
    next.updatedAt = new Date().toISOString();
    await db.run('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', keyOf(user.id), jsonParam(next));
    return next;
  });
  return { mine, defaults: DEFAULT_EMAIL_TEMPLATES };
}
