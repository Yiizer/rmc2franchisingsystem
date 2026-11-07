// One place for "who may do what". Pure and client-safe: no database, node or server imports, so the UI can import it too.
// The server enforces these on every operation; the UI only uses them to decide what to show.
import type { Staff } from './types';

export type RoleSubject = Pick<Staff, 'role' | 'canApprove'>;
type Role = Staff['role'];
const is = (user: Pick<Staff, 'role'>, ...roles: Role[]) => roles.includes(user.role);

/** Create, edit, deactivate accounts; set role and division. */
export const canManageAccounts = (user: Pick<Staff, 'role'>) => is(user, 'Head');
/** Reset a user's password to a one-time temporary password and unlock a locked-out account. */
export const canResetPassword = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Admin');
/** The Head is always an approver; a Supervisor only with the approval flag. */
export const canApproveProposal = (user: RoleSubject) => user.role === 'Head' || (user.role === 'Supervisor' && user.canApprove);
export const canDecideProgressReport = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor');
export const canPrepareProposal = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor', 'Employee');
/** Division Heads and SOAs file progress reports, only on clients they own. */
export const canFileProgressReport = (user: Pick<Staff, 'role'>) => is(user, 'DivisionHead', 'SOA');
export const canManageTemplates = (user: Pick<Staff, 'role'>) => is(user, 'Head');
/** Database, storage, converter and email health cards. */
export const canSeeSystemHealth = (user: Pick<Staff, 'role'>) => is(user, 'Admin');
export const canSeeAiUsage = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor', 'Admin');
export const canSeeIntegrations = (user: Pick<Staff, 'role'>) => is(user, 'Admin');
/** Take a lock (inquiry handling) away from a colleague. */
export const canTakeOver = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor');
export const canSeeAllInquiries = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor', 'Employee', 'Admin');
/** Division Heads and SOAs see only the clients they own, through a separate, whitelisted API. */
export const isOwnerScoped = (user: Pick<Staff, 'role'>) => is(user, 'DivisionHead', 'SOA');
/** Manual import of an agent form by staff (the Head and Supervisors review and approve instead). Owner-scoped users submit their own through the same intake. */
export const canImportInquiry = (user: Pick<Staff, 'role'>) => is(user, 'Employee', 'Admin');
export const canSubmitOwnInquiry = (user: Pick<Staff, 'role'>) => isOwnerScoped(user);
/** Read the Requests (incoming email) page. */
export const canReviewInbound = (user: Pick<Staff, 'role'>) => canPrepareProposal(user) || is(user, 'Admin');
/** Link an inquiry to a Division Head / SOA after the fact. */
export const canSetInquiryOwner = (user: Pick<Staff, 'role'>) => canPrepareProposal(user);
/** Record that a mail with an unknown outcome did or did not arrive. */
export const canConfirmDelivery = (user: Pick<Staff, 'role'>) => is(user, 'Admin', 'Head');
/** Decide a pending agent change / historical agent change (same people who approve proposals). */
export const canDecideAgentChange = canApproveProposal;
/** Roles that can never be approvers. */
export const canBeApprover = (role: Role) => role === 'Head' || role === 'Supervisor';
export const DIVISIONS = ['Division 1', 'Division 2', 'Division 3', 'Division 4', 'Division 5', 'Division 6', 'Division 7'] as const;
export const STAFF_ROLES = ['Head', 'Supervisor', 'Employee', 'DivisionHead', 'SOA', 'Admin'] as const;

// ---- Feedback round 2026-11-07 ----
/** Proposal dashboard (sent / declined / not started, funnel, time per employee): Head and Supervisors. The Admin keeps service health. */
export const canSeeProposalStats = (user: Pick<Staff, 'role'>) => is(user, 'Head', 'Supervisor');
/** A Division Head adds, deactivates and resets the SOAs of their own division (server also checks the division). */
export const canManageDivisionSoas = (user: Pick<Staff, 'role'>) => is(user, 'DivisionHead');
