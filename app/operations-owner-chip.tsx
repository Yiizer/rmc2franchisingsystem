'use client';
import { Clock3, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { OwnerClient, OwnerReport } from '@/lib/operations/owner-view';

export const manilaDate = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value));

export type ProtectionView = { tone: 'protected' | 'warning' | 'urgent' | 'held' | 'expired' | 'neutral'; text: string; sub: string; days: number };
export function protectionView(client: Pick<OwnerClient, 'protection'>, now: number): ProtectionView {
  const p = client.protection;
  if (!p) return { tone: 'neutral', text: 'Protection not started', sub: '', days: 0 };
  if (p.held) return { tone: 'held', text: 'Held — report under review', sub: 'Was due ' + manilaDate(p.expiresAt), days: p.daysLeft };
  if (Date.parse(p.expiresAt) <= now) return { tone: 'expired', text: 'Protection ended', sub: manilaDate(p.expiresAt), days: 0 };
  const days = p.daysLeft, until = 'Until ' + manilaDate(p.expiresAt);
  if (days <= 2) return { tone: 'urgent', text: days <= 0 ? 'Ends today' : days + (days === 1 ? ' day left' : ' days left'), sub: until, days };
  if (days <= 7) return { tone: 'warning', text: days + ' days left', sub: until, days };
  return { tone: 'protected', text: days + ' days left', sub: until, days };
}

/** Always text plus an icon; the meter is decorative. */
export function ClientProtectionChip({ client, now, compact = false }: { client: Pick<OwnerClient, 'protection'>; now: number; compact?: boolean }) {
  const view = protectionView(client, now);
  const cls = view.tone === 'urgent' ? 'duplicate urgent' : view.tone === 'held' ? 'warning held' : view.tone;
  const Icon = view.tone === 'held' ? LockKeyhole : view.tone === 'urgent' ? TriangleAlert : view.tone === 'protected' || view.tone === 'warning' ? ShieldCheck : Clock3;
  return <span className="ops-oc-chip-wrap"><span className={'ops-client-pill ' + cls}><Icon size={14} aria-hidden="true" />{view.text}{view.tone !== 'neutral' && view.tone !== 'expired' && view.tone !== 'held' && <span className="ops-client-mini-meter" aria-hidden="true"><i style={{ width: Math.min(100, view.days / 30 * 100) + '%' }} /></span>}</span>{!compact && view.sub && <small>{view.sub}</small>}</span>;
}

export const statusTone = (status: string) => ({ 'Received': 'blue', 'Preparing proposal': 'amber', 'Waiting for your details': 'amber', 'Proposal under review': 'purple', 'Proposal approved': 'green', 'Enrolled': 'green', 'Already protected': 'amber' } as Record<string, string>)[status] || 'slate';

export function OwnerStatus({ value }: { value: string }) { return <span className={'ops-badge ' + statusTone(value)}><span className="ops-dot" />{value}</span>; }

export const lastReport = (client: OwnerClient): OwnerReport | undefined => client.progressReports[0];
export const hasPendingReport = (client: OwnerClient) => client.progressReports.some(r => r.status === 'pending');

export function ReportChip({ report }: { report?: OwnerReport }) {
  if (!report) return <span className="ops-oc-report"><span>—</span><small>No report yet</small></span>;
  if (report.status === 'pending') return <span className="ops-oc-report"><span className="ops-client-pill warning">Pending review</span><small>Filed {manilaDate(report.submittedAt)}</small></span>;
  if (report.status === 'approved') return <span className="ops-oc-report"><span className="ops-client-pill protected">Approved</span><small>{manilaDate(report.decidedAt || report.submittedAt)}</small></span>;
  return <span className="ops-oc-report"><span className="ops-client-pill duplicate">Rejected</span><small className="ops-oc-oneline" title={report.rejectReason || ''}>{report.rejectReason || 'No reason given'}</small></span>;
}
