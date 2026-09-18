import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import { api } from '@/services/api';
import type { AppRole } from '@/security/permissions';

export function OperatorDutyStartupPrompt({ role, enabled = true }: { role: AppRole | null; enabled?: boolean }) {
  const { user } = useAuth();
  const { activeStation, online } = useApp();
  const duty = useShiftDuty(activeStation?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [saving, setSaving] = useState(false);
  const shift = duty.currentShift;
  const assignedToShift = Boolean(user?.id && duty.plannedRoster.some((member) => member.user_id === user.id));
  const isOperator = enabled && role === 'OPERATOR' && assignedToShift;
  const started = Boolean(shift && new Date(shift.scheduled_start).getTime() <= now && new Date(shift.scheduled_end).getTime() > now);
  const key = shift ? `gridvision:duty-warning:${shift.id}` : '';
  useEffect(() => { if (!isOperator || !shift || !started || duty.myDutySession?.status === 'ON_DUTY') return; setDismissed(sessionStorage.getItem(key) === 'dismissed'); const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [isOperator, shift, started, duty.myDutySession, key]);
  if (!isOperator || !started || !shift || duty.myDutySession?.status === 'ON_DUTY') return null;
  const elapsed = Math.max(0, now - new Date(shift.scheduled_start).getTime());
  const elapsedLabel = `${Math.floor(elapsed / 3600000)}h ${Math.floor((elapsed % 3600000) / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
  const acknowledge = async (decision: 'START_DUTY' | 'CONTINUE_WITHOUT_STARTING') => { if (decision === 'CONTINUE_WITHOUT_STARTING' && (!reasonCode || (reasonCode === 'OTHER' && !reasonText.trim()))) return; setSaving(true); try { await api.recordShiftDutyWarningAcknowledgement(shift.id, decision, decision === 'CONTINUE_WITHOUT_STARTING' ? reasonCode : undefined, decision === 'CONTINUE_WITHOUT_STARTING' ? reasonText : undefined); if (decision === 'START_DUTY') await api.startShiftDuty(shift.id, 'MEMBER'); sessionStorage.setItem(key, 'dismissed'); setDismissed(true); } finally { setSaving(false); } };
  if (dismissed) return <div className="fixed inset-x-0 top-0 z-[70] border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900 shadow-sm">Shift duty not started · {duty.station?.name ?? 'Station'} · elapsed {elapsedLabel}</div>;
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-bold text-slate-900">Shift Duty Not Started</h2><p className="mt-3 text-sm leading-6 text-slate-700">Your shift at <b>{duty.station?.name ?? 'this station'}</b> started at <b>{new Date(shift.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>.</p><p className="mt-1 text-sm font-semibold text-amber-700">Elapsed time: {elapsedLabel}</p>{reasonOpen && <div className="mt-5 space-y-3"><label className="grid gap-1 text-xs font-semibold text-slate-600">Reason<select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"><option value="">Select a reason</option><option value="NOT_PRESENT">Not present</option><option value="HANDOVER_PENDING">Handover pending</option><option value="WORKING_ELSEWHERE">Working elsewhere</option><option value="TECHNICAL_ISSUE">Technical issue</option><option value="OTHER">Other</option></select></label>{reasonCode === 'OTHER' && <textarea value={reasonText} onChange={e => setReasonText(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Enter the reason" />}</div>}<div className="mt-6 grid gap-2 sm:grid-cols-2"><button type="button" disabled={!online || saving} onClick={() => void acknowledge('START_DUTY')} className="min-h-11 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Start Duty'}</button>{reasonOpen ? <button type="button" disabled={!online || saving || !reasonCode || (reasonCode === 'OTHER' && !reasonText.trim())} onClick={() => void acknowledge('CONTINUE_WITHOUT_STARTING')} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60">Confirm Continue</button> : <button type="button" onClick={() => setReasonOpen(true)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Continue Without Starting Duty</button>}</div></div></div>;
}
