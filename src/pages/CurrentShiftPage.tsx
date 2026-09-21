import { useEffect, useState } from 'react';
import { ClipboardCheck, Clock3, Loader2, RefreshCw, UsersRound } from 'lucide-react';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import { useApp } from '@/context/AppContext';
import { useShiftStationScope } from '@/context/ShiftStationScopeContext';
import type { AppRole } from '@/security/permissions';
import { useAuth } from '@/hooks/useAuth';
import { useLateShiftHandover } from '@/hooks/useLateShiftHandover';
import { api, type ShiftRosterAssignment } from '@/services/api';

const dateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const shortId = (value: string) => `${value.slice(0, 8)}…`;

export function CurrentShiftPage({ onBack, onOpenHandover, role }: { onBack: () => void; onOpenHandover: () => void; role: AppRole }) {
  const shiftScope = useShiftStationScope();
  const shiftDuty = useShiftDuty(shiftScope.selectedStationId || null);
  const lateHandover = useLateShiftHandover(shiftScope.selectedStationId || null);
  const { online } = useApp();
  const { user } = useAuth();
  const { currentShift, myDutySession, operatorsOnDuty, plannedRoster, nextShift, unattendedHandover, station, loading, refreshing, error, mutating } = shiftDuty;
  const [nextRoster, setNextRoster] = useState<ShiftRosterAssignment[]>([]);
  const isOnDuty = myDutySession?.status === 'ON_DUTY';
  const assignedToShift = Boolean(user?.id && plannedRoster.some((member) => member.user_id === user.id));
  const canAttendShift = role === 'OPERATOR' && assignedToShift;
  const overdueMs = currentShift && isOnDuty ? Math.max(0, Date.now() - new Date(currentShift.scheduled_end).getTime()) : 0;
  const overdueLabel = overdueMs ? `${Math.floor(overdueMs / 3600000)}h ${Math.floor((overdueMs % 3600000) / 60000)}m` : null;

  useEffect(() => {
    let active = true;
    if (!nextShift) {
      setNextRoster([]);
      return () => { active = false; };
    }
    void api.getShiftRoster(nextShift.id)
      .then((roster) => { if (active) setNextRoster(roster); })
      .catch(() => { if (active) setNextRoster([]); });
    return () => { active = false; };
  }, [nextShift?.id]);

  const upcomingOperators = nextRoster.map((member) => member.full_name).filter(Boolean);

  return <Screen showStatusBar={false}>
    <AppHeader title="Current Shift" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Current Shift" subtitle="Server-confirmed duty and shift attendance" />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-4xl space-y-4 lg:max-w-none lg:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><label className="grid min-w-0 flex-1 gap-1.5 text-xs font-semibold text-slate-600">Station<select aria-label="Shift station" value={shiftScope.selectedStationId} onChange={(event) => shiftScope.setSelectedStationId(event.target.value)} disabled={shiftScope.loading || shiftScope.stations.length === 0} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:bg-slate-100"><option value="">{shiftScope.loading ? 'Loading authorized stations…' : 'No authorized station available'}</option>{shiftScope.stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex items-center justify-between gap-3 sm:justify-end"><p className="text-sm font-medium text-slate-600">{station?.name ?? 'No authorized station selected'}{refreshing ? ' · Updating…' : ''}</p><button type="button" onClick={() => void shiftDuty.refresh()} disabled={loading || refreshing || mutating || !shiftDuty.hasStation} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-blue-700 shadow-sm disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />Refresh</button></div></div>
      {shiftScope.error && <Alert tone="amber">{shiftScope.error}</Alert>}
      {!online && canAttendShift && <Alert tone="amber">Internet connection is required for handover review, duty start, and duty completion. Lifecycle actions are never queued.</Alert>}
      {role !== 'OPERATOR' && <Alert tone="amber">Shift attendance is recorded by Operators. Your role has read-only shift oversight.</Alert>}
      {error && <Alert>{error}</Alert>}
      {overdueLabel && <section role="alert" className="break-words rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900"><p>Your scheduled shift has ended. Handover and duty end are pending.</p><p className="mt-1">Scheduled end: {dateTime(currentShift?.scheduled_end)} · Overdue by {overdueLabel}</p></section>}
      {unattendedHandover?.status === 'OPEN' && <section role="alert" className="break-words rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-semibold leading-6 text-amber-950"><p>No active operator on duty — final handover released and awaiting incoming acceptance.</p>{canAttendShift && <button type="button" onClick={onOpenHandover} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-amber-800 px-3 text-sm font-bold text-white sm:w-auto">Review Handover</button>}</section>}
      {canAttendShift && isOnDuty && lateHandover.error && <Alert tone="amber">{lateHandover.error} Duty completion is disabled until the handover requirement is confirmed.</Alert>}
      {!shiftDuty.hasStation && !loading && !shiftScope.loading && <Empty title="No station is available" detail="A current shift can be shown after your authorized station scope is available." />}
      {loading && !currentShift && shiftDuty.hasStation && <div className="grid min-h-44 place-items-center rounded-2xl bg-white"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>}
      {!loading && shiftDuty.hasStation && !currentShift && !error && <Empty title="No shift scheduled" detail="There is no current server-scheduled shift for this station." />}
      {nextShift && <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 lg:p-5"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Next scheduled shift</p><div className="mt-1 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-bold text-slate-900">{nextShift.shift_name}</h2><p className="text-sm font-medium text-slate-700">Logical date: {nextShift.shift_date}</p></div><p className="mt-2 text-sm text-slate-700">{dateTime(nextShift.scheduled_start)} – {dateTime(nextShift.scheduled_end)}</p><p className="mt-3 border-t border-blue-100 pt-3 text-sm text-slate-700"><span className="font-semibold">Operator{upcomingOperators.length === 1 ? '' : 's'}:</span> {upcomingOperators.length ? upcomingOperators.join(', ') : 'Not assigned'}</p></section>}
      {currentShift && <>
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{overdueLabel ? 'Overdue Duty — Handover Pending' : 'Current Shift'}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{currentShift.shift_name}</h2><p className="mt-1 text-sm text-slate-600">Logical date: {currentShift.shift_date}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${overdueLabel ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{overdueLabel ? 'OVERDUE' : currentShift.status}</span></div><div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><Info label="Scheduled start" value={dateTime(currentShift.scheduled_start)} /><Info label="Scheduled end" value={dateTime(currentShift.scheduled_end)} /></div></section>
        {canAttendShift && <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-6"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-blue-600" /><h2 className="text-base font-bold text-slate-900">My Duty</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Status" value={isOnDuty ? 'On Duty' : myDutySession?.status === 'ENDED' ? 'Ended' : 'Not Started'} /><Info label="Started" value={dateTime(myDutySession?.started_at)} /><Info label="Ended" value={dateTime(myDutySession?.ended_at)} /></div>{myDutySession && <p className="mt-3 text-sm text-slate-600">Roster role: <span className="font-semibold text-slate-800">{myDutySession.shift_role === 'IN_CHARGE' ? 'Shift In-Charge' : 'Member'}</span></p>}{lateHandover.pending && <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900">Duty completion is blocked because a late handover is available and still requires your individual review and acceptance.</p>}<div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">{!myDutySession ? <button type="button" disabled={!online} onClick={onOpenHandover} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60"><ClipboardCheck className="h-4 w-4" />Review Handover</button> : isOnDuty ? <button type="button" disabled={!online || lateHandover.loading || Boolean(lateHandover.error)} onClick={onOpenHandover} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><ClipboardCheck className="h-4 w-4" />{lateHandover.pending ? 'Review Late Handover' : 'Handover Shift'}</button> : <p className="text-sm font-medium text-slate-600">Your duty session has ended for this shift.</p>}</div></section>}
        {canAttendShift && isOnDuty && lateHandover.pending && <section className="rounded-2xl border border-amber-300 bg-amber-100 p-4 shadow-sm lg:p-6"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-amber-800" /><div><h2 className="text-base font-bold text-slate-900">Late handover received — review and acceptance required.</h2><p className="mt-1 text-xs leading-5 text-amber-900">You may continue operational work, but must individually accept this handover before completing duty.</p></div></div><button type="button" onClick={onOpenHandover} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-800 px-4 text-sm font-bold text-white"><ClipboardCheck className="h-4 w-4" />Review Late Handover</button></section>}
        <Team title="Planned Roster" subtitle="Planned team and server-confirmed attendance">{plannedRoster.length ? plannedRoster.map((assignment) => { const attendance = operatorsOnDuty.find((session) => session.user_id === assignment.user_id); return <Row key={assignment.id} name={assignment.user_id === myDutySession?.user_id ? 'You' : assignment.full_name} role={assignment.duty_role} status={attendance?.status === 'ON_DUTY' ? 'On Duty' : attendance?.status === 'ENDED' ? `Ended ${dateTime(attendance.ended_at)}` : 'Not started'} />; }) : <p className="p-5 text-sm text-slate-600">No planned roster has been assigned for this shift.</p>}</Team>
        <Team title="Actual Attendance" subtitle="Duty sessions recorded for this shift">{operatorsOnDuty.length ? operatorsOnDuty.map((session) => { const planned = plannedRoster.find((assignment) => assignment.user_id === session.user_id); return <Row key={session.id} name={session.user_id === myDutySession?.user_id ? 'You' : planned?.full_name ?? `Unplanned participant ${shortId(session.user_id)}`} role={session.shift_role} status={session.status === 'ON_DUTY' ? 'On Duty' : `Ended ${dateTime(session.ended_at)}`} detail={`Started ${dateTime(session.started_at)}`} unplanned={!planned} />; }) : <p className="p-5 text-sm text-slate-600">No duty sessions have been recorded for this shift.</p>}</Team>
      </>}
    </div></PageBody>
  </Screen>;
}

function Team({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="flex items-center gap-2 border-b border-slate-100 p-4 lg:px-6"><UsersRound className="h-5 w-5 text-blue-600" /><div><h2 className="text-base font-bold text-slate-900">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div></div><div className="divide-y divide-slate-100">{children}</div></section>; }
function Row({ name, role, status, detail, unplanned }: { name: string; role: 'MEMBER' | 'IN_CHARGE'; status: string; detail?: string; unplanned?: boolean }) { return <div className="grid min-w-0 gap-1 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-4 lg:px-6"><p className="min-w-0 break-words font-semibold text-slate-800">{name}</p><p className="break-words text-slate-600">{role === 'IN_CHARGE' ? 'Shift In-Charge' : 'Member'}{unplanned && <span className="ml-1 text-amber-700">(Unplanned)</span>}</p>{detail && <p className="break-words text-slate-600">{detail}</p>}<p className={status === 'On Duty' ? 'font-semibold text-emerald-700' : status === 'Not started' ? 'font-semibold text-amber-700' : 'font-semibold text-slate-500'}>{status}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-sm font-medium text-slate-800">{value}</p></div>; }
function Alert({ children, tone = 'red' }: { children: React.ReactNode; tone?: 'red' | 'amber' }) { return <p role="alert" className={`rounded-xl px-4 py-3 text-sm font-medium ${tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{children}</p>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <section className="rounded-2xl bg-white p-6 text-center shadow-sm"><Clock3 className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-3 text-base font-bold text-slate-800">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">{detail}</p></section>; }
