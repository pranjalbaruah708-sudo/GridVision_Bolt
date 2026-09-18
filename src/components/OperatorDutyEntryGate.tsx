import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import type { AppRole } from '@/security/permissions';

/** Prevents routine operator writes until the operator has started the active shift. */
export function OperatorDutyEntryGate({ children, role }: { children: ReactNode; role: AppRole }) {
  const { user } = useAuth();
  const { activeStation } = useApp();
  const duty = useShiftDuty(activeStation?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  const isOperator = role === 'OPERATOR';
  const activeShift = Boolean(duty.currentShift && new Date(duty.currentShift.scheduled_start).getTime() <= now && new Date(duty.currentShift.scheduled_end).getTime() > now);
  const assignedToShift = Boolean(user?.id && duty.plannedRoster.some((member) => member.user_id === user.id));
  useEffect(() => { if (!activeShift) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [activeShift]);

  if (!isOperator) return <>{children}</>;
  if (!activeStation || duty.loading || !duty.loaded) {
    const message = duty.error
      ? 'Shift duty authorization could not be confirmed. Refresh the page and try again.'
      : 'Checking shift duty authorization…';
    return <EntryBlockedNotice title="Entry authorization required" message={message} />;
  }
  if (!activeShift) return <>{children}</>;
  if (!assignedToShift) {
    return <EntryBlockedNotice title="Entry not authorised" message="You are currently not authorised to make entries as your duty is not scheduled now." />;
  }
  if (duty.myDutySession?.status === 'ON_DUTY') return <>{children}</>;
  const shift = duty.currentShift;
  const elapsed = shift ? Math.max(0, now - new Date(shift.scheduled_start).getTime()) : 0;
  const elapsedLabel = `${Math.floor(elapsed / 3600000)}h ${Math.floor((elapsed % 3600000) / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
  return <div className="min-h-screen bg-slate-50 p-5 lg:p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /><div><h1 className="text-lg font-bold text-slate-900">Duty must be started before entering records</h1><p className="mt-2 text-sm leading-6 text-slate-600">The current shift at <b>{duty.station?.name ?? 'this station'}</b> started at <b>{shift ? new Date(shift.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</b>. Elapsed time: <b className="text-amber-700">{elapsedLabel}</b>.</p><p className="mt-3 text-sm text-slate-600">Parameter, interruption, logbook, condition, and handover entries remain disabled until you start duty. You may continue viewing other application information. When no shift is active, normal entry access is available.</p></div></div></div></div>;
}

function EntryBlockedNotice({ title, message }: { title: string; message: string }) {
  return <div className="min-h-screen bg-slate-50 p-5 lg:p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /><div><h1 className="text-lg font-bold text-slate-900">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{message}</p></div></div></div></div>;
}
