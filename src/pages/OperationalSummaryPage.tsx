import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { AppHeader } from '@/components/ui/Page';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { operationalApi } from '@/services/operationalApi';
import type { OperationalOpenCondition, OperationalQuery, OperationalScopeOption, OperationalSummary } from '@/types/operational';

const control = 'mt-1 block w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900';
const scopeKey = (option: OperationalScopeOption) => `${option.scope_kind}:${option.scope_id ?? ''}`;
const pretty = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// Only date-input validation/defaults are local; period boundaries come from RPC.
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const displayTime = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function OperationalSummaryPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { online, activeStationId } = useApp();
  return <div className="min-h-screen min-w-0 bg-slate-50 pb-24 lg:pb-8">
    <AppHeader title="Operational Summary" subtitle="Operational activity and current attention" onBack={onBack} />
    <DesktopPageContainer width="wide">
      {!online ? <p className="p-5 text-sm text-slate-600">Operational Summary requires an online connection.</p>
        : user ? <SummaryWorkspace key={user.id} initialStationId={activeStationId} />
          : <p className="p-5 text-sm text-slate-600">Sign in to view operational summaries.</p>}
    </DesktopPageContainer>
  </div>;
}
function SummaryWorkspace({ initialStationId }: { initialStationId: string | null }) {
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


  useEffect(() => {
    let cancelled = false;
    setReady(false); setScopeError('');
    void operationalApi.getScopeOptions().then(data => {
      if (cancelled) return;
      const stationOptions = data.filter(option => option.scope_kind === 'STATION');
      setOptions(stationOptions);
      // Only the initial selection may choose a default. Revoked scopes never
      // silently fall back to a broader selection on refresh.
      const prior = selectedRef.current;
      const chosen = prior ? stationOptions.find(o => scopeKey(o) === prior)
        : stationOptions.find(o => o.scope_id === initialStation.current)
          ?? stationOptions[0];
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

  return <div className="space-y-4 px-4 py-4 lg:px-0">
    <section aria-label="Summary filters" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto] lg:items-end">
        <label className="min-w-0 text-xs font-semibold text-slate-600">Period<select className={control} value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="TODAY">Today</option><option value="THIS_MONTH">This Month</option><option value="CUSTOM">Custom</option></select></label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">Scope<select className={control} value={selected} disabled={!ready} onChange={e => { setSelected(e.target.value); selectedRef.current = e.target.value; setScopeError(''); }}>
          <option value="" disabled>{ready ? 'Select an authorized scope' : 'Loading scopes…'}</option>
          {options.map(o => <option key={scopeKey(o)} value={scopeKey(o)}>{o.scope_kind === 'OFFICE' ? `${o.label} · ${pretty(o.office_type ?? 'Office')}` : o.label}</option>)}
        </select></label>
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
        : !scopeError && query && <SummaryResult key={`${revision}:${JSON.stringify(query)}`} query={query} />}
  </div>;
}

function SummaryResult({ query }: { query: OperationalQuery }) {
  const [summary, setSummary] = useState<OperationalSummary | null>(null);
  const [openConditions, setOpenConditions] = useState<OperationalOpenCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setSummary(null);
    void Promise.all([operationalApi.getSummary(query), operationalApi.getOpenConditions(query)]).then(([result, conditions]) => {
      if (!cancelled) { setSummary(result); setOpenConditions(conditions); }
    }).catch(cause => {
      if (cancelled) return;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
      setError(code === '42501' || code === 'PGRST301'
        ? 'This scope is not authorized or your session has expired. Refresh your access or sign in again.'
        : 'Unable to load the operational summary. Please try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, attempt]);
  if (loading) return <p role="status" className="p-5 text-sm text-slate-600">Loading operational summary…</p>;
  if (error) return <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" className="ml-3 min-h-11 font-semibold underline" onClick={() => setAttempt(n => n + 1)}>Retry</button></div>;
  if (!summary) return null;

  const activity: Array<[string, number]> = [
    ['Parameter Entries', summary.parameter_entries], ['Interruptions Started', summary.interruptions_started],
    ['Restorations', summary.restorations], ['Parameter Alerts', summary.alerts], ['Station Conditions Observed', summary.conditions_observed],
  ];
  const shifts: Array<[string, number]> = [
    ['Duty Starts', summary.duty_starts], ['Duty Ends', summary.duty_ends],
    ['Handovers Submitted', summary.handovers_submitted], ['Handovers Accepted', summary.handovers_accepted],
  ];
  const cards: Array<[string, number]> = [
    ['Parameter Entries', summary.parameter_entries], ['Interruptions Started', summary.interruptions_started],
    ['Parameter Alerts', summary.alerts], ['Conditions Observed', summary.conditions_observed], ['Current Open Conditions', summary.current_open_conditions],
  ];
  const noActivity = [...activity, ...shifts].every(([, count]) => count === 0);
  return <section aria-label="Operational summary results" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 text-xs leading-5 text-slate-600">
        <p>{summary.station_count.toLocaleString('en-IN')} authorized station{summary.station_count === 1 ? '' : 's'} in scope</p>
        <p>Period: {displayTime(summary.start_at)} to {displayTime(summary.end_at)} IST (end exclusive)</p>
        <p>As of {displayTime(summary.as_of)} IST</p>
      </div>
      <a href="#/more/operational-timeline" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700">View Timeline<ArrowRight aria-hidden="true" className="h-4 w-4" /></a>
    </div>
    {noActivity && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No operational activity found for the selected period and scope.</p>}
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([label, count]) => <div key={label} className={`min-w-0 rounded-2xl border p-4 ${label === 'Current Open Conditions' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-2 break-words text-2xl font-bold text-slate-900">{count.toLocaleString('en-IN')}</p>
      {label === 'Current Open Conditions' && <p className="mt-1 text-xs text-amber-900">Current state, across all dates</p>}
    </div>)}</div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2"><CountSection title="Operational Activity" rows={activity} /><CountSection title="Shift & Handover" rows={shifts} /></div>
    <section className="rounded-2xl border border-amber-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Current Attention</h2>
      {openConditions.length === 0 ? <p className="mt-2 text-sm text-slate-700">No open Station Conditions in the selected scope.</p> : <div className="mt-3 divide-y divide-amber-100">{openConditions.map(condition => <div key={condition.id} className="py-3 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{condition.station_name}{condition.equipment_area ? ` · ${condition.equipment_area}` : ''}</p><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">{pretty(condition.condition)}</span></div><p className="mt-1 text-xs text-slate-600">{pretty(condition.category)} · {displayTime(condition.observed_at)} IST</p><p className="mt-1 text-sm text-slate-700">{condition.observation}</p></div>)}</div>}
      <p className="mt-1 text-xs text-slate-500">Current open conditions are independent of the selected historical period. Activity counts above refer only to that period.</p>
    </section>
  </section>;
}

function CountSection({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="mb-2 font-semibold text-slate-900">{title}</h2><dl className="divide-y divide-slate-100">{rows.map(([label, count]) => <div key={label} className="flex min-w-0 items-start justify-between gap-4 py-2.5 text-sm"><dt className="text-slate-600">{label}</dt><dd className="shrink-0 font-semibold tabular-nums text-slate-900">{count.toLocaleString('en-IN')}</dd></div>)}</dl></section>;
}


