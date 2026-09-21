import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import type { AppRole } from '@/security/permissions';

/** Prevents routine operator writes until the operator has started the active shift. */
export function OperatorDutyEntryGate({ children, role, stationId, allowRosteredPreDutyHandover = false, onOpenCurrentShift, onClose }: { children: ReactNode; role: AppRole; stationId?: string | null; allowRosteredPreDutyHandover?: boolean; onOpenCurrentShift?: () => void; onClose?: () => void }) {
  const { user } = useAuth();
  const { activeStation } = useApp();
  const duty = useShiftDuty(stationId === undefined ? activeStation?.id ?? null : stationId);
  const [now, setNow] = useState(() => Date.now());
  const isOperator = role === 'OPERATOR';
  const activeShift = Boolean(duty.currentShift && new Date(duty.currentShift.scheduled_start).getTime() <= now && new Date(duty.currentShift.scheduled_end).getTime() > now);
  const assignedToShift = Boolean(user?.id && duty.plannedRoster.some((member) => member.user_id === user.id));
  useEffect(() => { if (!activeShift) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [activeShift]);
  useEffect(() => {
    if (!isOperator || !duty.nextShift) return;
    const delay = Math.max(0, new Date(duty.nextShift.scheduled_start).getTime() - Date.now());
    const id = window.setTimeout(() => {
      setNow(Date.now());
      void duty.refresh();
    }, Math.min(delay, 2_147_000_000));
    return () => window.clearTimeout(id);
  }, [duty.nextShift?.id, duty.nextShift?.scheduled_start, duty.refresh, isOperator]);
  if (!isOperator) return <>{children}</>;
  if (!(stationId === undefined ? activeStation?.id : stationId) || !duty.loaded) {
    const message = duty.error
      ? 'Shift duty authorization could not be confirmed. Refresh the page and try again.'
      : 'Checking shift duty authorization…';
    return <EntryBlockedNotice title="Entry authorization required" message={message} />;
  }
  if (!activeShift) return <>{children}</>;
  if (!assignedToShift) {
    return <EntryBlockedNotice title="Entry not authorised" message="You are currently not authorised to make entries as your duty is not scheduled now." />;
  }
  if (duty.myDutySession?.status === 'ON_DUTY' || (allowRosteredPreDutyHandover && assignedToShift)) return <>{children}</>;
  const shift = duty.currentShift;
  const elapsed = shift ? Math.max(0, now - new Date(shift.scheduled_start).getTime()) : 0;
  const elapsedLabel = `${Math.floor(elapsed / 3600000)}h ${Math.floor((elapsed % 3600000) / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
  return <div className="min-h-screen bg-slate-50 p-5 lg:p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /><div><h1 className="text-lg font-bold text-slate-900">Duty must be started before entering records</h1><p className="mt-2 text-sm leading-6 text-slate-600">Your scheduled duty has started, but duty has not been started. Go to Current Shift to review the handover and start duty.</p><p className="mt-2 text-sm text-slate-600">Elapsed time: <b className="text-amber-700">{elapsedLabel}</b>.</p><div className="mt-5 flex flex-wrap gap-2">{onOpenCurrentShift && <button type="button" onClick={onOpenCurrentShift} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white">Go to Current Shift</button>}{onClose && <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">Close</button>}</div></div></div></div></div>;
}

function EntryBlockedNotice({ title, message }: { title: string; message: string }) {
  return <div className="min-h-screen bg-slate-50 p-5 lg:p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /><div><h1 className="text-lg font-bold text-slate-900">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{message}</p></div></div></div></div>;
}
