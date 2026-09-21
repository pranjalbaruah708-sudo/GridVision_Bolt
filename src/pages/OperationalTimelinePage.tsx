import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowRightLeft, ClipboardCheck, Power, RefreshCw, Users, ZapOff, type LucideIcon } from 'lucide-react';
import { AppHeader } from '@/components/ui/Page';
import { HandoverAccountability } from '@/components/HandoverAccountability';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { operationalApi } from '@/services/operationalApi';
import type { OperationalEventType, OperationalQuery, OperationalScopeOption, OperationalTimelineEvent } from '@/types/operational';

const PAGE_SIZE = 50;
const MAX_LOADED = 1000;
const control = 'mt-1 block w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900';
const groups = ['All', 'Parameters', 'Interruptions', 'Alerts', 'Station Conditions', 'Shift / Handover'] as const;
type EventGroup = typeof groups[number];
const visuals: Record<OperationalEventType, { label: string; group: EventGroup; icon: LucideIcon; tone: string }> = {
  PARAMETER_ENTRY: { label: 'Parameter Entry', group: 'Parameters', icon: Activity, tone: 'bg-blue-50 text-blue-700' },
  INTERRUPTION: { label: 'Interruption Start', group: 'Interruptions', icon: ZapOff, tone: 'bg-red-50 text-red-700' },
  RESTORATION: { label: 'Restoration', group: 'Interruptions', icon: Power, tone: 'bg-emerald-50 text-emerald-700' },
  ALERT: { label: 'Parameter Alert', group: 'Alerts', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800' },
  STATION_CONDITION: { label: 'Station Condition', group: 'Station Conditions', icon: ClipboardCheck, tone: 'bg-violet-50 text-violet-700' },
  DUTY_STARTED: { label: 'Shift Duty Start', group: 'Shift / Handover', icon: Users, tone: 'bg-cyan-50 text-cyan-800' },
  DUTY_ENDED: { label: 'Shift Duty End', group: 'Shift / Handover', icon: Users, tone: 'bg-cyan-50 text-cyan-800' },
  HANDOVER_SUBMITTED: { label: 'Handover Submitted', group: 'Shift / Handover', icon: ArrowRightLeft, tone: 'bg-indigo-50 text-indigo-700' },
  HANDOVER_ACCEPTED: { label: 'Handover Accepted', group: 'Shift / Handover', icon: ArrowRightLeft, tone: 'bg-indigo-50 text-indigo-700' },
  DRAFT_CREATED: { label: 'Handover Draft Created', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-slate-100 text-slate-700' },
  DRAFT_ENTRY_ADDED: { label: 'Draft Entry Added', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-slate-100 text-slate-700' },
  DRAFT_ENTRY_EDITED: { label: 'Draft Entry Edited', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-slate-100 text-slate-700' },
  DRAFT_ENTRY_REMOVED: { label: 'Draft Entry Removed', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-slate-100 text-slate-700' },
  OUTGOING_DUTY_ENDED: { label: 'Outgoing Duty Ended', group: 'Shift / Handover', icon: Users, tone: 'bg-cyan-50 text-cyan-800' },
  TEAM_HANDOVER_ACCEPTED: { label: 'Team Handover Accepted', group: 'Shift / Handover', icon: ArrowRightLeft, tone: 'bg-emerald-50 text-emerald-700' },
  INDIVIDUAL_HANDOVER_ACCEPTED: { label: 'Individual Handover Accepted', group: 'Shift / Handover', icon: Users, tone: 'bg-emerald-50 text-emerald-700' },
  STARTED_WITHOUT_HANDOVER: { label: 'Started Without Handover', group: 'Shift / Handover', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800' },
  LATE_HANDOVER_AVAILABLE: { label: 'Late Handover Available', group: 'Shift / Handover', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800' },
  LATE_HANDOVER_ACCEPTED: { label: 'Late Handover Accepted', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-emerald-50 text-emerald-700' },
  AMENDMENT_ADDED: { label: 'Handover Amendment Added', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-violet-50 text-violet-700' },
  DUTY_END_BLOCKED_PENDING_HANDOVER: { label: 'Duty End Blocked', group: 'Shift / Handover', icon: AlertTriangle, tone: 'bg-red-50 text-red-700' },
  PROVISIONAL_HANDOVER_RECORDED: { label: 'Provisional Handover Recorded', group: 'Shift / Handover', icon: ClipboardCheck, tone: 'bg-amber-50 text-amber-800' },
  FINAL_HANDOVER_RELEASED: { label: 'Final Handover Released', group: 'Shift / Handover', icon: ArrowRightLeft, tone: 'bg-indigo-50 text-indigo-700' },
  UNATTENDED_FINAL_HANDOVER_RELEASED: { label: 'Final Handover Awaiting Incoming Duty', group: 'Shift / Handover', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800' },
  FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE: { label: 'First Incoming Duty Started', group: 'Shift / Handover', icon: Users, tone: 'bg-emerald-50 text-emerald-700' },
  SHIFT_END_PASSED_HANDOVER_PENDING: { label: 'Shift End Passed — Handover Pending', group: 'Shift / Handover', icon: AlertTriangle, tone: 'bg-red-50 text-red-700' },
};
const scopeKey = (option: OperationalScopeOption) => `${option.scope_kind}:${option.scope_id ?? ''}`;
const pretty = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const dateTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export function OperationalTimelinePage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { online, activeStationId } = useApp();
  return <div className="min-h-screen min-w-0 bg-slate-50 pb-24 lg:pb-8">
    <AppHeader title="Operational Timeline" subtitle="Read-only operational history · IST" onBack={onBack} />
    <DesktopPageContainer width="wide">
      {!online ? <p className="p-5 text-sm text-slate-600">Operational Timeline requires an online connection.</p>
        : user ? <TimelineWorkspace key={user.id} initialStationId={activeStationId} />
          : <p className="p-5 text-sm text-slate-600">Sign in to view operational history.</p>}
    </DesktopPageContainer>
  </div>;
}

function TimelineWorkspace({ initialStationId }: { initialStationId: string | null }) {
  const [options, setOptions] = useState<OperationalScopeOption[]>([]);
  const [selected, setSelected] = useState('');
  const selectedRef = useRef('');
  const initialStation = useRef(initialStationId);
  const [ready, setReady] = useState(false);
  const [scopeError, setScopeError] = useState('');
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<'TODAY' | 'THIS_MONTH' | 'CUSTOM'>('TODAY');
  const [from, setFrom] = useState(todayIst);
  const [to, setTo] = useState(todayIst);
  const [group, setGroup] = useState<EventGroup>('All');

  useEffect(() => {
    let cancelled = false;
    setReady(false); setScopeError('');
    void operationalApi.getScopeOptions().then(data => {
      if (cancelled) return;
      setOptions(data);
      // Only the initial selection may choose a default. Revoked scopes never
      // silently fall back to a broader selection on refresh.
      const prior = selectedRef.current;
      const chosen = prior ? data.find(o => scopeKey(o) === prior)
        : data.find(o => o.scope_kind === 'STATION' && o.scope_id === initialStation.current)
          ?? data.find(o => o.scope_kind === 'STATION') ?? data[0];
      if (prior && !chosen) setScopeError('The selected scope is no longer authorized. Choose an available scope.');
      setSelected(chosen ? scopeKey(chosen) : '');
      selectedRef.current = chosen ? scopeKey(chosen) : prior;
      setReady(true);
    }).catch(() => {
      if (!cancelled) { setScopeError('Unable to load authorized scopes. Please refresh to try again.'); setReady(true); }
    });
    return () => { cancelled = true; };
  }, [revision]);

  const option = options.find(o => scopeKey(o) === selected);
  const rangeError = period === 'CUSTOM' && (!from || !to || to < from || to > todayIst()
    || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))
    || Date.parse(to) - Date.parse(from) >= 366 * 86400000)
    ? 'Choose a non-future date range of at most 366 inclusive days.' : '';
  const query = useMemo<OperationalQuery | null>(() => {
    if (!option || rangeError) return null;
    const scope = option.scope_kind === 'ALL' ? { kind: 'ALL' as const }
      : option.scope_id ? { kind: option.scope_kind, id: option.scope_id } : null;
    if (!scope) return null;
    return period === 'CUSTOM' ? { period, from, to, scope } : { period, scope };
  }, [option, period, from, to, rangeError]);
  const names = useMemo(() => new Map(options.filter(o => o.scope_kind === 'STATION').map(o => [o.scope_id, o.label])), [options]);

  return <div className="space-y-4 px-4 py-4 lg:px-0">
    <section aria-label="Timeline filters" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_1.5fr_auto] lg:items-end">
        <label className="min-w-0 text-xs font-semibold text-slate-600">Period<select className={control} value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="TODAY">Today</option><option value="THIS_MONTH">This Month</option><option value="CUSTOM">Custom</option></select></label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">Scope<select className={control} value={selected} disabled={!ready} onChange={e => { setSelected(e.target.value); selectedRef.current = e.target.value; setScopeError(''); }}>
          <option value="" disabled>{ready ? 'Select an authorized scope' : 'Loading scopes…'}</option>
          {options.map(o => <option key={scopeKey(o)} value={scopeKey(o)}>{o.scope_kind === 'OFFICE' ? `${o.label} · ${pretty(o.office_type ?? 'Office')}` : o.label}</option>)}
        </select></label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">Event Type<select className={control} value={group} onChange={e => setGroup(e.target.value as EventGroup)}>{groups.map(g => <option key={g}>{g}</option>)}</select></label>
        <button type="button" onClick={() => setRevision(n => n + 1)} disabled={!ready} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-blue-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${!ready ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
      {period === 'CUSTOM' && <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:max-w-xl">
        <label className="min-w-0 text-xs font-semibold text-slate-600">From<input className={control} type="date" value={from} max={to || todayIst()} onChange={e => setFrom(e.target.value)} /></label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">To<input className={control} type="date" value={to} min={from} max={todayIst()} onChange={e => setTo(e.target.value)} /></label>
      </div>}
      {rangeError && <p role="alert" className="mt-3 text-sm text-red-700">{rangeError}</p>}
    </section>
    {scopeError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{scopeError}</p>}
    {!ready ? <p role="status" className="p-4 text-sm text-slate-600">Loading authorized scopes…</p>
      : !scopeError && options.length === 0 ? <p className="p-4 text-sm text-slate-600">No authorized operational scopes are available.</p>
        : !scopeError && query && <TimelineRows key={`${revision}:${JSON.stringify(query)}`} query={query} group={group} names={names} />}
  </div>;
}

function TimelineRows({ query, group, names }: { query: OperationalQuery; group: EventGroup; names: Map<string | null, string> }) {
  const { feeders } = useApp();
  const feederNames = useMemo(() => new Map(feeders.map(f => [f.id, f.name])), [feeders]);
  const [rows, setRows] = useState<OperationalTimelineEvent[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [more, setMore] = useState(true);
  const offset = useRef(0);
  const mounted = useRef(false);
  const locked = useRef(false);
  const generation = useRef(0);
  async function load() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const request = ++generation.current;
    try {
      const batch = await operationalApi.getTimeline(query, PAGE_SIZE, offset.current);
      if (!mounted.current || request !== generation.current) return;
      offset.current += batch.length;
      setMore(batch.length === PAGE_SIZE && offset.current < MAX_LOADED);
      setRows(previous => {
        const audits = new Map(batch.flatMap(row => row.handover ? [[row.source_id, row.handover] as const] : []));
        const unique = new Map(previous.map(row => {
          const handover = audits.get(row.source_id);
          return [`${row.event_type}:${row.source_id}`, handover ? { ...row, status: handover.status, handover } : row];
        }));
        batch.forEach(row => unique.set(`${row.event_type}:${row.source_id}`, row));
        return [...unique.values()].sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time)
          || a.event_type.localeCompare(b.event_type) || a.source_id.localeCompare(b.source_id));
      });
    } catch (cause) {
      if (!mounted.current || request !== generation.current) return;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
      if (code === '42501' || code === 'PGRST301') {
        setRows([]); offset.current = 0; setMore(false);
        setError('This scope is not authorized or your session has expired. Refresh your access or sign in again.');
      } else setError('Unable to load operational events. Please try again.');
    } finally {
      if (mounted.current && request === generation.current) { locked.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    mounted.current = true; locked.current = false; void load();
    return () => { mounted.current = false; generation.current++; };
    // This component is remounted for every query/refresh, invalidating old responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visible = rows.filter(row => group === 'All' || visuals[row.event_type]?.group === group);
  return <section aria-label="Operational events" aria-busy={busy} className="min-w-0 space-y-3">
    <p className="text-xs text-slate-500">Newest first · Times in Asia/Kolkata{group !== 'All' && ' · Event type filters loaded events; load more to search older events.'}</p>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" disabled={busy} onClick={() => void load()} className="ml-3 font-semibold underline">Retry</button></div>}
    {!busy && !error && visible.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{group !== 'All' && (more || offset.current >= MAX_LOADED) ? 'No matching events in the loaded pages. Load more or narrow the period and scope.' : 'No operational events found for the selected period and scope.'}</p>}
    <ol className="space-y-3">{visible.map(row => {
      const style = visuals[row.event_type];
      const Icon = style?.icon ?? Activity;
      const feeder = row.feeder_id ? feederNames.get(row.feeder_id) : undefined;
      return <li key={`${row.event_type}:${row.source_id}`} className="flex min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:gap-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style?.tone ?? 'bg-slate-100 text-slate-700'}`}><Icon aria-hidden="true" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1"><h2 className="text-sm font-semibold text-slate-900">{style?.label ?? row.title}</h2><time dateTime={row.event_time} className="text-xs text-slate-500">{dateTime.format(new Date(row.event_time))}</time></div>
          <p className="mt-1 text-sm font-medium text-slate-700">{names.get(row.station_id) ?? 'Authorized station'}{feeder ? ` · ${feeder}` : ''}{row.equipment_area ? ` · ${row.equipment_area}` : ''}</p>
          {row.title && row.title.toLowerCase() !== style?.label.toLowerCase() && <p className="mt-1 text-sm text-slate-700">{row.title}</p>}
          {row.details && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{row.details}</p>}
          {row.handover && <HandoverAccountability value={row.handover} side={row.event_type === 'HANDOVER_ACCEPTED' ? 'incoming' : 'outgoing'} />}
          {!row.handover && (row.severity || row.status) && <div className="mt-2 flex flex-wrap gap-2">{[row.severity, row.status].filter(Boolean).map((value, index) => <span key={index} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{pretty(value!)}</span>)}</div>}
        </div>
      </li>;
    })}</ol>
    {busy && <p role="status" className="p-4 text-center text-sm text-slate-600">Loading operational events…</p>}
    {more && !error && <button type="button" disabled={busy} onClick={() => void load()} className="min-h-11 w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-blue-700 disabled:opacity-50">{busy ? 'Loading…' : 'Load more'}</button>}
    {offset.current >= MAX_LOADED && <p className="text-sm text-slate-600">Showing up to 1,000 events. Choose a shorter period or a narrower scope to see more detail.</p>}
  </section>;
}
