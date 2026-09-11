import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Loader2, Pencil, Plus, RefreshCw, UsersRound, X } from 'lucide-react';

import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { useApp } from '@/context/AppContext';
import { api, type ShiftRole, type ShiftRosterAssignment, type StationShift } from '@/services/api';
import type { AppRole } from '@/security/permissions';

type ShiftForm = { id: string | null; name: string; start: string; end: string };
type RosterCandidate = { id: string; fullName: string };

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function dateAtMidnight(date: string) { return new Date(`${date}T00:00:00`).toISOString(); }
function endOfDate(date: string) { return new Date(`${date}T23:59:59.999`).toISOString(); }
function localDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function displayDateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function emptyForm(): ShiftForm { return { id: null, name: '', start: '', end: '' }; }
function canPlan(role: AppRole) { return role === 'FIELD_OFFICER' || role === 'ADMIN' || role === 'SUPER_ADMIN'; }
function errorMessage(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }

export function ShiftSchedulePage({ role, onBack }: { role: AppRole; onBack: () => void }) {
  const { stations, activeStationId, setActiveStationId, online } = useApp();
  const planner = canPlan(role);
  const [from, setFrom] = useState(() => isoDate(new Date()));
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 30 * 86_400_000)));
  const [shifts, setShifts] = useState<StationShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftForm | null>(null);
  const [savingShift, setSavingShift] = useState(false);
  const [rosterShift, setRosterShift] = useState<StationShift | null>(null);
  const [roster, setRoster] = useState<ShiftRosterAssignment[]>([]);
  const [candidates, setCandidates] = useState<RosterCandidate[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [savingRoster, setSavingRoster] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const scheduleRequest = useRef(0);
  const rosterRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++scheduleRequest.current;
    if (!activeStationId || !from || !to || from > to) {
      setShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const schedule = await api.getStationShiftSchedule(activeStationId, dateAtMidnight(from), endOfDate(to));
      if (request === scheduleRequest.current) setShifts(schedule);
    } catch (cause) {
      if (request === scheduleRequest.current) setError(errorMessage(cause, 'Could not load the shift schedule.'));
    } finally {
      if (request === scheduleRequest.current) setLoading(false);
    }
  }, [activeStationId, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    rosterRequest.current += 1;
    setRosterShift(null);
    setForm(null);
  }, [activeStationId]);

  const openRoster = async (shift: StationShift) => {
    const request = ++rosterRequest.current;
    setRosterShift(shift);
    setRoster([]);
    setCandidates([]);
    setRosterError(null);
    setRosterLoading(true);
    try {
      const [currentRoster, users] = await Promise.all([
        api.getShiftRoster(shift.id),
        planner ? api.getUsersAccessPage({ search: '', role: null, active: true, officeId: null, stationId: shift.station_id, page: 0, pageSize: 100 }) : Promise.resolve(null),
      ]);
      if (request !== rosterRequest.current) return;
      setRoster(currentRoster);
      setCandidates((users?.rows ?? []).map((user) => ({ id: user.id, fullName: user.full_name })));
    } catch (cause) {
      if (request === rosterRequest.current) setRosterError(errorMessage(cause, 'Could not load this shift roster.'));
    } finally {
      if (request === rosterRequest.current) setRosterLoading(false);
    }
  };

  const saveShift = async () => {
    if (!form || !activeStationId) return;
    if (!form.name.trim() || !form.start || !form.end || new Date(form.end) <= new Date(form.start)) {
      setError('Enter a shift name and a valid start and end time.');
      return;
    }
    setSavingShift(true);
    setError(null);
    try {
      await api.saveStationShift({
        id: form.id,
        stationId: activeStationId,
        shiftDate: form.start.slice(0, 10),
        shiftName: form.name.trim(),
        scheduledStart: new Date(form.start).toISOString(),
        scheduledEnd: new Date(form.end).toISOString(),
      });
      setForm(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save this shift.'));
    } finally {
      setSavingShift(false);
    }
  };

  const cancelShift = async (shift: StationShift) => {
    if (!window.confirm(`Cancel ${shift.shift_name}? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.cancelStationShift(shift.id);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not cancel this shift.'));
    }
  };

  const setAssignmentRole = (userId: string, dutyRole: ShiftRole) => setRoster((current) => current.map((assignment) => ({
    ...assignment,
    duty_role: assignment.user_id === userId ? dutyRole : dutyRole === 'IN_CHARGE' && assignment.duty_role === 'IN_CHARGE' ? 'MEMBER' : assignment.duty_role,
  })));
  const addCandidate = (userId: string) => {
    const candidate = candidates.find((item) => item.id === userId);
    if (!candidate || roster.some((item) => item.user_id === userId) || !rosterShift) return;
    setRoster((current) => [...current, { id: `new-${userId}`, shift_id: rosterShift.id, user_id: userId, full_name: candidate.fullName, duty_role: 'MEMBER', created_at: '' }]);
  };
  const saveRoster = async () => {
    if (!rosterShift) return;
    if (roster.filter((assignment) => assignment.duty_role === 'IN_CHARGE').length > 1) {
      setRosterError('Only one roster member can be designated Shift In-Charge.');
      return;
    }
    setSavingRoster(true);
    setRosterError(null);
    try {
      const saved = await api.saveStationShiftRoster(rosterShift.id, roster.map((assignment) => ({ userId: assignment.user_id, dutyRole: assignment.duty_role })));
      setRoster(saved);
      await load();
    } catch (cause) {
      setRosterError(errorMessage(cause, 'Could not save this roster.'));
    } finally {
      setSavingRoster(false);
    }
  };

  const availableCandidates = useMemo(() => candidates.filter((candidate) => !roster.some((assignment) => assignment.user_id === candidate.id)), [candidates, roster]);

  return <Screen showStatusBar={false}>
    <AppHeader title="Shift Schedule" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Shift Schedule & Roster" subtitle="Plan future station shifts and their authorised roster" />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8">
      <div className="mx-auto max-w-5xl space-y-4 lg:max-w-none">
        {!online && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Shift scheduling is available online only. Reconnect to view or change the server schedule.</p>}
        {!planner && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">You have read-only access to the scheduled shifts and roster for your authorised stations.</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><label className="text-xs font-semibold text-slate-600">Station<select value={activeStationId} onChange={(event) => setActiveStationId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">{stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="text-xs font-semibold text-slate-600">To<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><div className="flex items-end gap-2"><button type="button" onClick={() => void load()} disabled={!online || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>{planner && <button type="button" onClick={() => setForm(emptyForm())} disabled={!online || !activeStationId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-60"><Plus className="h-4 w-4" />New shift</button>}</div></div></section>
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="flex items-center gap-2 border-b border-slate-100 p-4 lg:px-5"><CalendarDays className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-900">Scheduled shifts</h2><p className="text-xs text-slate-500">Server-confirmed schedule for the selected station</p></div></div>{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : shifts.length ? <div className="divide-y divide-slate-100">{shifts.map((shift) => { const editable = planner && online && shift.status === 'SCHEDULED' && new Date(shift.scheduled_start) > new Date(); return <div key={shift.id} className="p-4 lg:flex lg:items-center lg:justify-between lg:gap-5 lg:px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{shift.shift_name}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${shift.status === 'SCHEDULED' ? 'bg-blue-50 text-blue-700' : shift.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{shift.status}</span></div><p className="mt-1 text-sm text-slate-600">{displayDateTime(shift.scheduled_start)} – {displayDateTime(shift.scheduled_end)}</p></div><div className="mt-3 flex flex-wrap gap-2 lg:mt-0"><button type="button" onClick={() => void openRoster(shift)} disabled={!online} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60"><UsersRound className="h-4 w-4" />Roster</button>{editable && <><button type="button" onClick={() => setForm({ id: shift.id, name: shift.shift_name, start: localDateTime(shift.scheduled_start), end: localDateTime(shift.scheduled_end) })} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"><Pencil className="h-4 w-4" />Edit</button><button type="button" onClick={() => void cancelShift(shift)} className="min-h-10 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700">Cancel</button></>}</div></div>; })}</div> : <p className="p-6 text-center text-sm text-slate-600">No shifts are scheduled in this date range.</p>}</section>
      </div>
    </PageBody>
    {form && <ShiftDialog form={form} saving={savingShift} onChange={setForm} onClose={() => setForm(null)} onSave={() => void saveShift()} />}
    {rosterShift && <RosterDialog shift={rosterShift} roster={roster} candidates={availableCandidates} loading={rosterLoading} saving={savingRoster} error={rosterError} canEdit={planner && online && rosterShift.status === 'SCHEDULED' && new Date(rosterShift.scheduled_start) > new Date()} onClose={() => setRosterShift(null)} onAdd={addCandidate} onRemove={(userId) => setRoster((current) => current.filter((assignment) => assignment.user_id !== userId))} onRoleChange={setAssignmentRole} onSave={() => void saveRoster()} />}
  </Screen>;
}

function ShiftDialog({ form, saving, onChange, onClose, onSave }: { form: ShiftForm; saving: boolean; onChange: (form: ShiftForm) => void; onClose: () => void; onSave: () => void }) {
  return <Dialog title={form.id ? 'Edit scheduled shift' : 'Schedule a shift'} onClose={onClose}><div className="space-y-3"><label className="block text-xs font-semibold text-slate-600">Shift name<input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="block text-xs font-semibold text-slate-600">Scheduled start<input type="datetime-local" value={form.start} onChange={(event) => onChange({ ...form, start: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="block text-xs font-semibold text-slate-600">Scheduled end<input type="datetime-local" value={form.end} onChange={(event) => onChange({ ...form, end: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={onSave} disabled={saving} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save shift'}</button></div></div></Dialog>;
}

function RosterDialog({ shift, roster, candidates, loading, saving, error, canEdit, onClose, onAdd, onRemove, onRoleChange, onSave }: { shift: StationShift; roster: ShiftRosterAssignment[]; candidates: RosterCandidate[]; loading: boolean; saving: boolean; error: string | null; canEdit: boolean; onClose: () => void; onAdd: (userId: string) => void; onRemove: (userId: string) => void; onRoleChange: (userId: string, role: ShiftRole) => void; onSave: () => void }) {
  const [selected, setSelected] = useState('');
  return <Dialog title={`Roster · ${shift.shift_name}`} onClose={onClose}><p className="text-sm text-slate-600">{displayDateTime(shift.scheduled_start)}</p>{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : <><div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">{roster.length ? roster.map((assignment) => <div key={assignment.user_id} className="flex flex-wrap items-center gap-2 p-3"><p className="min-w-32 flex-1 text-sm font-semibold text-slate-800">{assignment.full_name}</p>{canEdit ? <select value={assignment.duty_role} onChange={(event) => onRoleChange(assignment.user_id, event.target.value as ShiftRole)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="MEMBER">Member</option><option value="IN_CHARGE">Shift In-Charge</option></select> : <span className="text-sm text-slate-600">{assignment.duty_role === 'IN_CHARGE' ? 'Shift In-Charge' : 'Member'}</span>}{canEdit && <button type="button" onClick={() => onRemove(assignment.user_id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Remove ${assignment.full_name}`}><X className="h-4 w-4" /></button>}</div>) : <p className="p-4 text-sm text-slate-600">No roster members have been assigned.</p>}</div>{canEdit && <div className="mt-4 flex gap-2"><select value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Add an authorised station user</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fullName}</option>)}</select><button type="button" disabled={!selected} onClick={() => { onAdd(selected); setSelected(''); }} className="rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60">Add</button></div>}<div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Close</button>{canEdit && <button type="button" disabled={saving} onClick={onSave} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save roster'}</button>}</div></>}</Dialog>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/40 p-4 sm:grid sm:place-items-center"><div role="dialog" aria-modal="true" aria-label={title} className="mx-auto my-6 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:my-0"><div className="mb-4 flex items-start justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}
