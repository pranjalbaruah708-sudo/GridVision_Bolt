import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import type { AppRole } from '@/security/permissions';
import {
  dutyWarningAcknowledgementKey,
  millisecondsUntil,
  shouldShowScheduledDutyWarning,
} from '@/services/operatorDutyWarning';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

/**
 * Global scheduled-duty warning. Dismissal is session-local UI state only;
 * Current Shift owns every handover acceptance and duty-start mutation.
 */
export function OperatorDutyStartupPrompt({ role, onOpenCurrentShift, enabled = true }: { role: AppRole | null; onOpenCurrentShift: () => void; enabled?: boolean }) {
  const { user } = useAuth();
  const { activeStation } = useApp();
  const duty = useShiftDuty(activeStation?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const previousKeyRef = useRef<string | null>(null);
  const shift = duty.currentShift;
  const assignedToShift = Boolean(user?.id && duty.plannedRoster.some((member) => member.user_id === user.id));
  const isOperator = enabled && role === 'OPERATOR' && assignedToShift;
  const key = shift && user?.id && assignedToShift ? dutyWarningAcknowledgementKey(user.id, shift.id) : '';
  const warningActive = Boolean(isOperator && shift && shouldShowScheduledDutyWarning({
    assigned: assignedToShift,
    dutyStarted: Boolean(duty.myDutySession),
    scheduledStart: shift.scheduled_start,
    scheduledEnd: shift.scheduled_end,
    now,
  }));

  const refreshDuty = useCallback(() => {
    setNow(Date.now());
    void duty.refresh();
  }, [duty.refresh]);

  useEffect(() => {
    if (previousKeyRef.current && previousKeyRef.current !== key) sessionStorage.removeItem(previousKeyRef.current);
    previousKeyRef.current = key || null;
    setDismissed(Boolean(key && sessionStorage.getItem(key) === 'dismissed'));
  }, [key]);

  useEffect(() => {
    if (!key || duty.myDutySession?.status !== 'ON_DUTY') return;
    sessionStorage.removeItem(key);
    setDismissed(false);
  }, [duty.myDutySession?.status, key]);

  useEffect(() => {
    if (!enabled || role !== 'OPERATOR' || !user?.id || !duty.nextShift) return;
    let timer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const remaining = millisecondsUntil(duty.nextShift!.scheduled_start);
      timer = window.setTimeout(() => {
        if (remaining > MAX_TIMER_DELAY_MS) schedule();
        else refreshDuty();
      }, Math.min(remaining, MAX_TIMER_DELAY_MS));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [duty.nextShift?.id, duty.nextShift?.scheduled_start, enabled, refreshDuty, role, user?.id]);

  useEffect(() => {
    if (!warningActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [warningActive]);

  if (!warningActive || !shift) return null;

  const dismiss = () => {
    sessionStorage.setItem(key, 'dismissed');
    setDismissed(true);
  };

  return <>
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 text-center text-sm font-semibold sm:flex-row sm:gap-3">
        <span>Duty not started — go to Current Shift to review the handover and start duty.</span>
        <button type="button" onClick={onOpenCurrentShift} className="min-h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900">Go to Current Shift</button>
      </div>
    </div>
    {!dismissed && <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-5">
      <div role="dialog" aria-modal="true" aria-labelledby="scheduled-duty-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="scheduled-duty-title" className="text-xl font-bold text-slate-900">Scheduled duty has started</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">Your assigned duty has started, but you have not yet accepted the handover and started duty. Operational data entry will remain unavailable until duty is started from Current Shift.</p>
        <div className="mt-6 flex justify-end"><button type="button" onClick={dismiss} className="min-h-11 rounded-xl bg-blue-700 px-5 text-sm font-bold text-white">OK</button></div>
      </div>
    </div>}
  </>;
}
