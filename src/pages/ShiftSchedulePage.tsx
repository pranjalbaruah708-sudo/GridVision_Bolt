import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Loader2, Pencil, Plus, RefreshCw, Repeat, UsersRound, X } from 'lucide-react';

import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { useApp } from '@/context/AppContext';
import { useShiftStationScope } from '@/context/ShiftStationScopeContext';
import { api, type ShiftRosterAssignment, type StationShift, type StationShiftPatternRepeatResult } from '@/services/api';
import type { AppRole } from '@/security/permissions';

type ShiftForm = { id: string | null; name: string; start: string; end: string };
type RosterCandidate = { id: string; fullName: string };

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function dateAtMidnight(date: string) { return new Date(`${date}T00:00:00`).toISOString(); }
function endOfDate(date: string) { return new Date(`${date}T23:59:59.999`).toISOString(); }
function addDaysToDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function addMonthsToDate(date: string, months: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const targetMonth = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const targetLastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(value.getUTCDate(), targetLastDay))).toISOString().slice(0, 10);
}
function dateAtIstMidnight(date: string) { return new Date(`${date}T00:00:00+05:30`).toISOString(); }
function daysBetweenDates(start: string, end: string) { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000); }
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
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const { stations, selectedStationId: activeStationId, setSelectedStationId: setActiveStationId } = shiftScope;
  const planner = canPlan(role);
  const [from, setFrom] = useState(() => isoDate(new Date()));
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 30 * 86_400_000)));
  const [shifts, setShifts] = useState<StationShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftForm | null>(null);
  const [savingShift, setSavingShift] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatOutcome, setRepeatOutcome] = useState<StationShiftPatternRepeatResult[] | null>(null);
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
    if (shiftScope.loading) return;
    if (!activeStationId || !from || !to || from > to) {
      setShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const schedule = await api.getStationShiftSchedule(activeStationId, dateAtMidnight(from), endOfDate(to));
      if (request === scheduleRequest.current) {
        setShifts([...schedule].sort((left, right) => {
          const startOrder = new Date(right.scheduled_start).getTime() - new Date(left.scheduled_start).getTime();
          return startOrder || new Date(right.scheduled_end).getTime() - new Date(left.scheduled_end).getTime();
        }));
      }
    } catch (cause) {
      if (request === scheduleRequest.current) setError(errorMessage(cause, 'Could not load the shift schedule.'));
    } finally {
      if (request === scheduleRequest.current) setLoading(false);
    }
  }, [activeStationId, from, shiftScope.loading, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    rosterRequest.current += 1;
    setRosterShift(null);
    setForm(null);
    setRepeatOpen(false);
    setRepeatOutcome(null);
  }, [activeStationId]);

  const repeatPattern = async (input: { patternFrom: string; patternTo: string; durationValue: number; durationUnit: 'days' | 'months' }) => {
    if (!activeStationId) throw new Error('Select an authorized station before repeating a pattern.');
    setError(null);
    const results = await api.repeatStationShiftPattern({
      stationId: activeStationId,
      patternFrom: input.patternFrom,
      patternTo: input.patternTo,
      durationValue: input.durationValue,
      durationUnit: input.durationUnit,
    });
    const horizonExclusive = input.durationUnit === 'days'
      ? addDaysToDate(input.patternFrom, input.durationValue)
      : addMonthsToDate(input.patternFrom, input.durationValue);
    setRepeatOutcome(results);
    setFrom(input.patternFrom);
    setTo(addDaysToDate(horizonExclusive, -1));
    setRepeatOpen(false);
  };

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
        planner ? api.getUsersAccessPage({ search: '', role: 'OPERATOR', active: true, officeId: null, stationId: shift.station_id, page: 0, pageSize: 100 }) : Promise.resolve(null),
      ]);
      if (request !== rosterRequest.current) return;
      // Equal-operator shifts do not expose an in-charge role. Saving this
      // roster writes every member using the equal MEMBER role.
      setRoster(currentRoster.map((assignment) => ({ ...assignment, duty_role: 'MEMBER' })));
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

  const addCandidate = (userId: string) => {
    const candidate = candidates.find((item) => item.id === userId);
    if (!candidate || roster.some((item) => item.user_id === userId) || !rosterShift) return;
    setRoster((current) => [...current, { id: `new-${userId}`, shift_id: rosterShift.id, user_id: userId, full_name: candidate.fullName, duty_role: 'MEMBER', created_at: '' }]);
  };
  const saveRoster = async () => {
    if (!rosterShift) return;
    setSavingRoster(true);
    setRosterError(null);
    try {
      const saved = await api.saveStationShiftRoster(rosterShift.id, roster.map((assignment) => ({ userId: assignment.user_id, dutyRole: 'MEMBER' })));
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
        {shiftScope.error && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{shiftScope.error}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        {repeatOutcome && <section role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">Pattern repeated: {repeatOutcome.filter((row) => row.outcome === 'CREATED').length} shifts created; {repeatOutcome.filter((row) => row.outcome === 'SKIPPED').length} skipped because they were in the past or conflicted.</p>{repeatOutcome.some((row) => row.omitted_roster_count > 0) && <p className="mt-1">{repeatOutcome.reduce((total, row) => total + row.omitted_roster_count, 0)} roster assignment(s) were omitted because those users are no longer active Operators assigned to this station.</p>}{repeatOutcome.some((row) => row.outcome === 'SKIPPED') && <ul className="mt-2 list-inside list-disc">{repeatOutcome.filter((row) => row.outcome === 'SKIPPED').slice(0, 8).map((row, index) => <li key={`${row.seed_shift_id}-${row.shift_date}-${index}`}>{row.shift_name} · {row.shift_date}: {row.skipped_reason}</li>)}</ul>}{repeatOutcome.filter((row) => row.outcome === 'SKIPPED').length > 8 && <p className="mt-1">Showing the first 8 skipped occurrences.</p>}</section>}
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><label className="text-xs font-semibold text-slate-600">Station<select value={activeStationId} onChange={(event) => setActiveStationId(event.target.value)} disabled={shiftScope.loading || stations.length === 0} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-100"><option value="">{shiftScope.loading ? 'Loading authorized stations…' : 'No authorized station available'}</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="text-xs font-semibold text-slate-600">To<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><div className="flex flex-wrap items-end gap-2"><button type="button" onClick={() => void load()} disabled={!online || shiftScope.loading || loading || !activeStationId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>{planner && <><button type="button" onClick={() => { setRepeatOutcome(null); setRepeatOpen(true); }} disabled={!online || !activeStationId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-sm font-bold text-blue-700 disabled:opacity-60"><Repeat className="h-4 w-4" />Repeat pattern</button><button type="button" onClick={() => setForm(emptyForm())} disabled={!online || !activeStationId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-60"><Plus className="h-4 w-4" />New shift</button></>}</div></div></section>
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="flex items-center gap-2 border-b border-slate-100 p-4 lg:px-5"><CalendarDays className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-900">Scheduled shifts</h2><p className="text-xs text-slate-500">Server-confirmed schedule for the selected station</p></div></div>{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : shifts.length ? <div className="divide-y divide-slate-100">{shifts.map((shift) => { const editable = planner && online && shift.status === 'SCHEDULED' && new Date(shift.scheduled_start) > new Date(); return <div key={shift.id} className="p-4 lg:flex lg:items-center lg:justify-between lg:gap-5 lg:px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{shift.shift_name}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${shift.status === 'SCHEDULED' ? 'bg-blue-50 text-blue-700' : shift.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{shift.status}</span></div><p className="mt-1 text-sm text-slate-600">{displayDateTime(shift.scheduled_start)} – {displayDateTime(shift.scheduled_end)}</p></div><div className="mt-3 flex flex-wrap gap-2 lg:mt-0"><button type="button" onClick={() => void openRoster(shift)} disabled={!online} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60"><UsersRound className="h-4 w-4" />Roster</button>{editable && <><button type="button" onClick={() => setForm({ id: shift.id, name: shift.shift_name, start: localDateTime(shift.scheduled_start), end: localDateTime(shift.scheduled_end) })} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"><Pencil className="h-4 w-4" />Edit</button><button type="button" onClick={() => void cancelShift(shift)} className="min-h-10 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700">Cancel</button></>}</div></div>; })}</div> : <p className="p-6 text-center text-sm text-slate-600">No shifts are scheduled in this date range.</p>}</section>
      </div>
    </PageBody>
    {form && <ShiftDialog form={form} saving={savingShift} onChange={setForm} onClose={() => setForm(null)} onSave={() => void saveShift()} />}
    {repeatOpen && <RepeatPatternDialog stationId={activeStationId} defaultFrom={from} defaultTo={to} onClose={() => setRepeatOpen(false)} onRepeat={repeatPattern} />}
    {rosterShift && <RosterDialog shift={rosterShift} roster={roster} candidates={availableCandidates} loading={rosterLoading} saving={savingRoster} error={rosterError} canEdit={planner && online && rosterShift.status === 'SCHEDULED' && new Date(rosterShift.scheduled_start) > new Date()} onClose={() => setRosterShift(null)} onAdd={addCandidate} onRemove={(userId) => setRoster((current) => current.filter((assignment) => assignment.user_id !== userId))} onSave={() => void saveRoster()} />}
  </Screen>;
}

function RepeatPatternDialog({ stationId, defaultFrom, defaultTo, onClose, onRepeat }: {
  stationId: string;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onRepeat: (input: { patternFrom: string; patternTo: string; durationValue: number; durationUnit: 'days' | 'months' }) => Promise<void>;
}) {
  const [patternFrom, setPatternFrom] = useState(defaultFrom);
  const [patternTo, setPatternTo] = useState(defaultTo);
  const [durationUnit, setDurationUnit] = useState<'days' | 'months'>('months');
  const [durationValue, setDurationValue] = useState(3);
  const [seedShifts, setSeedShifts] = useState<StationShift[]>([]);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previewRequest = useRef(0);

  useEffect(() => {
    const request = ++previewRequest.current;
    if (!stationId || !patternFrom || !patternTo || patternFrom > patternTo) {
      setSeedShifts([]);
      setLoadingSeed(false);
      setSeedError('Choose a valid inclusive date range for the seed pattern.');
      return () => { previewRequest.current += 1; };
    }
    setLoadingSeed(true);
    setSeedError(null);
    void api.getStationShiftSchedule(
      stationId,
      dateAtIstMidnight(patternFrom),
      dateAtIstMidnight(addDaysToDate(patternTo, 1)),
    ).then((rows) => {
      if (request !== previewRequest.current) return;
      const eligible = rows.filter((shift) => shift.status !== 'CANCELLED' && shift.shift_date >= patternFrom && shift.shift_date <= patternTo);
      setSeedShifts(eligible);
      if (!eligible.length) setSeedError('No non-cancelled shifts were found in this seed pattern range.');
    }).catch((cause) => {
      if (request === previewRequest.current) {
        setSeedShifts([]);
        setSeedError(errorMessage(cause, 'Could not load the selected seed pattern.'));
      }
    }).finally(() => {
      if (request === previewRequest.current) setLoadingSeed(false);
    });
    return () => { previewRequest.current += 1; };
  }, [patternFrom, patternTo, stationId]);

  const maxDuration = durationUnit === 'days' ? 366 : 12;
  const durationIsValid = Number.isInteger(durationValue) && durationValue >= 1 && durationValue <= maxDuration;
  const horizonExclusive = durationIsValid
    ? durationUnit === 'days' ? addDaysToDate(patternFrom, durationValue) : addMonthsToDate(patternFrom, durationValue)
    : '';
  const completeSeedEndExclusive = patternTo ? addDaysToDate(patternTo, 1) : '';
  const horizonIncludesSeed = Boolean(horizonExclusive && completeSeedEndExclusive && horizonExclusive > completeSeedEndExclusive);
  const cycleDays = patternFrom && patternTo && patternFrom <= patternTo ? daysBetweenDates(patternFrom, patternTo) + 1 : 0;
  let generatedCount = 0;
  if (horizonIncludesSeed && cycleDays > 0) {
    for (const shift of seedShifts) {
      let offsetDays = cycleDays;
      let occurrenceDate = addDaysToDate(shift.shift_date, offsetDays);
      while (occurrenceDate < horizonExclusive) {
        generatedCount += 1;
        offsetDays += cycleDays;
        occurrenceDate = addDaysToDate(shift.shift_date, offsetDays);
      }
    }
  }
  const throughDate = horizonExclusive ? addDaysToDate(horizonExclusive, -1) : '';
  const canSubmit = !loadingSeed && !seedError && seedShifts.length > 0 && durationIsValid && horizonIncludesSeed && generatedCount > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onRepeat({ patternFrom, patternTo, durationValue, durationUnit });
    } catch (cause) {
      setSubmitError(errorMessage(cause, 'Could not repeat this shift pattern.'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (value: string) => new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00+05:30`));

  return <Dialog title="Repeat shift pattern" onClose={onClose}>
    <div className="space-y-4">
      <p className="text-sm leading-5 text-slate-600">Choose the inclusive dates containing the schedule you entered. That complete sequence repeats at the same interval.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">Pattern from<input type="date" value={patternFrom} max={patternTo} onChange={(event) => setPatternFrom(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800" /></label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">Pattern through<input type="date" value={patternTo} min={patternFrom} onChange={(event) => setPatternTo(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">Total horizon<input type="number" min={1} max={maxDuration} value={durationValue} onChange={(event) => setDurationValue(Number(event.target.value))} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800" /></label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">Duration unit<select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value as 'days' | 'months')} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"><option value="days">Days (up to 366)</option><option value="months">Calendar months (up to 12)</option></select></label>
      </div>
      {loadingSeed && <p className="text-sm text-slate-600">Loading shifts in the seed range…</p>}
      {seedError && !loadingSeed && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{seedError}</p>}
      {durationIsValid && !horizonIncludesSeed && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">The total horizon must include the full seed pattern and at least one repeat.</p>}
      {horizonIncludesSeed && seedShifts.length > 0 && <section className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950"><p className="font-semibold">Preview through {formatDate(throughDate)}</p><p className="mt-1">Seed shifts: {seedShifts.length} · Potential new occurrences: {generatedCount.toLocaleString()} · Total shift slots in the horizon: {(seedShifts.length + generatedCount).toLocaleString()}</p><p className="mt-1 text-xs text-blue-800">Past or overlapping occurrences will be skipped and listed after generation. Shift times use Asia/Kolkata. Matching valid Operator rosters are copied to repeated shifts.</p></section>}
      {submitError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={() => void submit()} disabled={!canSubmit} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60"><Repeat className="h-4 w-4" />{submitting ? 'Repeating…' : 'Repeat pattern'}</button></div>
    </div>
  </Dialog>;
}

function ShiftDialog({ form, saving, onChange, onClose, onSave }: { form: ShiftForm; saving: boolean; onChange: (form: ShiftForm) => void; onClose: () => void; onSave: () => void }) {
  return <Dialog title={form.id ? 'Edit scheduled shift' : 'Schedule a shift'} onClose={onClose}><div className="space-y-3"><label className="block text-xs font-semibold text-slate-600">Shift name<input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="block text-xs font-semibold text-slate-600">Scheduled start<input type="datetime-local" value={form.start} onChange={(event) => onChange({ ...form, start: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><label className="block text-xs font-semibold text-slate-600">Scheduled end<input type="datetime-local" value={form.end} onChange={(event) => onChange({ ...form, end: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800" /></label><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={onSave} disabled={saving} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save shift'}</button></div></div></Dialog>;
}

function RosterDialog({ shift, roster, candidates, loading, saving, error, canEdit, onClose, onAdd, onRemove, onSave }: { shift: StationShift; roster: ShiftRosterAssignment[]; candidates: RosterCandidate[]; loading: boolean; saving: boolean; error: string | null; canEdit: boolean; onClose: () => void; onAdd: (userId: string) => void; onRemove: (userId: string) => void; onSave: () => void }) {
  const [selected, setSelected] = useState('');
  return <Dialog title={`Roster · ${shift.shift_name}`} onClose={onClose}><p className="text-sm text-slate-600">{displayDateTime(shift.scheduled_start)}</p>{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : <><div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">{roster.length ? roster.map((assignment) => <div key={assignment.user_id} className="flex flex-wrap items-center gap-2 p-3"><p className="min-w-32 flex-1 text-sm font-semibold text-slate-800">{assignment.full_name}</p><span className="text-sm text-slate-600">Member</span>{canEdit && <button type="button" onClick={() => onRemove(assignment.user_id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Remove ${assignment.full_name}`}><X className="h-4 w-4" /></button>}</div>) : <p className="p-4 text-sm text-slate-600">No roster members have been assigned.</p>}</div>{canEdit && <div className="mt-4 flex gap-2"><select value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Add an authorised station user</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fullName}</option>)}</select><button type="button" disabled={!selected} onClick={() => { onAdd(selected); setSelected(''); }} className="rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60">Add</button></div>}<div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Close</button>{canEdit && <button type="button" disabled={saving} onClick={onSave} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save roster'}</button>}</div></>}</Dialog>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/40 p-4 sm:grid sm:place-items-center"><div role="dialog" aria-modal="true" aria-label={title} className="mx-auto my-6 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:my-0"><div className="mb-4 flex items-start justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}
