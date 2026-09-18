import type { HandoverAccountability as Accountability } from '@/services/handoverAccountability';

const timestamp = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' IST'
  : '—';

export function HandoverAccountability({ value, side = 'history' }: { value: Accountability; side?: 'outgoing' | 'incoming' | 'history' }) {
  const outgoing = ['Outgoing Shift', value.outgoing_shift_name];
  const incoming = ['Incoming Shift', value.incoming_shift_name];
  const fields = side === 'history'
    ? [outgoing, ['Outgoing Shift In-Charge', value.outgoing_in_charge_name ?? 'Not assigned'], incoming, ['Incoming Shift In-Charge', value.incoming_in_charge_name ?? 'Not assigned']]
    : side === 'incoming'
      ? [incoming, ['Shift In-Charge', value.incoming_in_charge_name ?? 'Not assigned'], outgoing]
      : [outgoing, ['Shift In-Charge', value.outgoing_in_charge_name ?? 'Not assigned'], incoming];
  fields.push(['Submitted By', value.submitted_by_name ?? '—'], ['Submitted At', timestamp(value.submitted_at)]);
  if (value.accepted_at || value.accepted_by_name) fields.push(['Accepted By', value.accepted_by_name ?? '—'], ['Accepted At', timestamp(value.accepted_at)]);
  fields.push(['Status', value.status === 'SUBMITTED' ? 'AWAITING ACCEPTANCE' : value.status.replace(/_/g, ' ')]);
  return <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
    {fields.map(([label, text]) => <div key={label} className="min-w-0 break-words [overflow-wrap:anywhere]"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 font-medium text-slate-800">{text}</dd></div>)}
  </dl>;
}
