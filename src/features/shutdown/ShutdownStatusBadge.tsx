import type { ShutdownStatus } from './types';

const TONES: Record<ShutdownStatus, string> = {
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 ring-amber-200', APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200', REJECTED: 'bg-red-50 text-red-700 ring-red-200', CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const LABELS: Record<ShutdownStatus, string> = { PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

export function ShutdownStatusBadge({ status }: { status: ShutdownStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${TONES[status]}`}>{LABELS[status]}</span>;
}
