import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, ChevronRight, ClipboardList, Loader2, RefreshCw, X, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type DashboardAttentionItem, type DashboardOperationalSummary, type DashboardTodayLoadTrendRow } from '@/services/api';
import ScreenExportMenu from '@/components/ScreenExportMenu';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { DesktopSection } from '@/components/layout/DesktopSection';
import { ResponsiveCardGrid } from '@/components/layout/ResponsiveCardGrid';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/services/supabase';
import { cachedFreshness, formatCacheAge, readOperationalSnapshot, writeOperationalSnapshot } from '@/services/operationalReadCache';

const IST_TIME_ZONE = 'Asia/Kolkata';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 12;
const TriangleAlert = AlertTriangle;
const DASHBOARD_REALTIME_TABLES = ['interruptions', 'parameter_alerts', 'log_book_entries'] as const;

type DashboardTarget = 'alerts' | 'analytics';
type ResourceState<T> = { data: T | null; loading: boolean; error: string | null; key: string | null; updatedAt: number | null };
type CacheEntry<T> = { data: T; updatedAt: number };
type FillStatus = DashboardTodayLoadTrendRow['fill_status'];
type TrendPoint = DashboardTodayLoadTrendRow & { label: string; tooltipValue: number; emptyValue: number | null };
type OperationalStatus = { label: string; detail: string; tone: 'green' | 'orange' | 'red' | 'slate' };

const emptyResource = <T,>(): ResourceState<T> => ({ data: null, loading: false, error: null, key: null, updatedAt: null });

function getTodayBoundsIST(): { startIso: string; endIso: string; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${date}T00:00:00+05:30`);
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 86400000).toISOString(), date };
}

function formatIstTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function formatLastUpdated(value: number | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}

function cacheRead<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | null {
  const item = cache.get(key);
  if (!item) return null;
  cache.delete(key);
  cache.set(key, item);
  return item;
}

function cacheWrite<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.delete(key);
  cache.set(key, { data, updatedAt: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function StatusDot({ status }: { status: FillStatus }) {
  const color = status === 'FULL' ? '#2563EB' : status === 'PARTIAL' ? '#F59E0B' : '#94A3B8';
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: TrendPoint }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const status = row.fill_status === 'FULL' ? 'Complete' : row.fill_status === 'PARTIAL' ? 'Partial' : row.fill_status === 'FUTURE' ? 'Not expected yet' : 'Missing';
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"><p className="text-[11px] font-bold text-slate-600">{row.label} hrs</p><p className="mt-1 text-sm font-extrabold text-blue-700">{row.total_mw === null ? '—' : `${row.total_mw.toFixed(2)} MW`}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">{status} · {row.entered_feeders}/{row.expected_feeders} feeders</p></div>;
}

function TimelineDot({ cx, cy, payload, active = false }: { cx?: number; cy?: number; payload?: TrendPoint; active?: boolean }) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const color = payload.fill_status === 'FULL' ? '#2563EB' : payload.fill_status === 'PARTIAL' ? '#F59E0B' : '#94A3B8';
  return <circle cx={cx} cy={cy} r={active ? 5 : 3.5} fill={color} stroke="#FFFFFF" strokeWidth={active ? 2.5 : 2} />;
}

function UpdatingOverlay({ loading, hasData, error, onRetry }: { loading: boolean; hasData: boolean; error: string | null; onRetry: () => void }) {
  if (loading && hasData) return <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500" aria-live="polite"><Loader2 className="h-3 w-3 animate-spin" />Updating…</div>;
  if (error && hasData) return <button type="button" onClick={onRetry} className="absolute right-3 top-3 rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600">Could not refresh — Retry</button>;
  return null;
}

function DashboardCard({ title, subtitle, loading, hasData, error, onRetry, children }: { title: string; subtitle?: string; loading?: boolean; hasData?: boolean; error?: string | null; onRetry?: () => void; children: ReactNode }) {
  return <section className="relative mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-busy={loading}><UpdatingOverlay loading={Boolean(loading)} hasData={Boolean(hasData)} error={error ?? null} onRetry={onRetry ?? (() => undefined)} /><div className="mb-4 pr-24"><h3 className="text-sm font-semibold text-gray-900">{title}</h3>{subtitle && <p className="mt-1 text-[11px] text-gray-500">{subtitle}</p>}</div>{children}</section>;
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: 'blue' | 'red' | 'orange' | 'green' }) {
  const styles = { blue: 'bg-blue-50 text-blue-700', red: 'bg-red-50 text-red-600', orange: 'bg-orange-50 text-orange-600', green: 'bg-emerald-50 text-emerald-600' }[tone];
  return <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm lg:p-4"><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${styles}`}>{icon}</div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-400">{label}</p><p className="mt-2 text-lg font-extrabold leading-none text-slate-900 lg:text-2xl">{value}</p><p className="mt-1 truncate text-[10px] font-medium text-slate-500 lg:text-xs">{detail}</p></div></div></div>;
}

function LoadingBlock({ label }: { label: string }) { return <div className="flex min-h-28 items-center justify-center gap-2 text-xs font-semibold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }
function attentionCopy(item: DashboardAttentionItem): string { if (item.issue_type === 'INTERRUPTION') return `${item.issue_count} open interruption${item.issue_count === 1 ? '' : 's'}`; if (item.issue_type === 'PARAMETER_ALERT') return `${item.issue_count} active parameter alert${item.issue_count === 1 ? '' : 's'}`; return `Logbook completeness ${item.completeness_percent?.toFixed(1) ?? '0'}%`; }

export function DashboardLogbookPage({ onBack, onNavigate }: { onBack: () => void; onNavigate: (target: DashboardTarget) => void }) {
  const { online, pending } = useApp();
  const [cacheUserId, setCacheUserId] = useState<string | null>(null);
  const exportContentRef = useRef<HTMLDivElement>(null);
  const summaryCache = useRef(new Map<string, CacheEntry<DashboardOperationalSummary>>());
  const trendCache = useRef(new Map<string, CacheEntry<DashboardTodayLoadTrendRow[]>>());
  const attentionCache = useRef(new Map<string, CacheEntry<DashboardAttentionItem[]>>());
  const summaryGeneration = useRef(0); const trendGeneration = useRef(0); const attentionGeneration = useRef(0);
  const [summary, setSummary] = useState<ResourceState<DashboardOperationalSummary>>(emptyResource());
  const [trend, setTrend] = useState<ResourceState<DashboardTodayLoadTrendRow[]>>(emptyResource());
  const [attention, setAttention] = useState<ResourceState<DashboardAttentionItem[]>>(emptyResource());
  const [usingDashboardCache, setUsingDashboardCache] = useState(false);
  useEffect(() => { let active = true; void supabase.auth.getSession().then(({ data }) => { if (active) setCacheUserId(data.session?.user.id ?? null); }); return () => { active = false; }; }, []);

  const refreshSummary = useCallback(async (force = false) => {
    if (!cacheUserId) return; const { startIso, endIso, date } = getTodayBoundsIST(); const key = `dashboardSummary|ALL|${date}`; const persisted = readOperationalSnapshot<DashboardOperationalSummary>(cacheUserId, key); const memoryCached = cacheRead(summaryCache.current, key); const cached = memoryCached ?? (persisted ? { data: persisted.value, updatedAt: Date.parse(persisted.cachedAt) } : null); if (!memoryCached && persisted) setUsingDashboardCache(true); const fresh = Boolean(online && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS); const generation = ++summaryGeneration.current;
    if (cached) setSummary({ data: cached.data, loading: !fresh || force, error: null, key, updatedAt: cached.updatedAt }); else setSummary((previous) => ({ ...previous, loading: true, error: null, key }));
    if (!online) { setUsingDashboardCache(Boolean(cached)); setSummary((previous) => ({ ...previous, loading: false, error: cached ? null : 'No cached dashboard data is available on this device. Connect once to load the dashboard.', key })); return; }
    if (fresh && !force && !usingDashboardCache) return;
    try { const data = await api.getDashboardOperationalSummary(startIso, endIso); if (generation !== summaryGeneration.current) return; const snapshot = writeOperationalSnapshot(cacheUserId, key, data); cacheWrite(summaryCache.current, key, data); setUsingDashboardCache(false); setSummary({ data, loading: false, error: null, key, updatedAt: Date.parse(snapshot.cachedAt) }); }
    catch (error) { if (generation !== summaryGeneration.current) return; setSummary((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load summary.', key })); }
  }, [cacheUserId, online, usingDashboardCache]);
  const refreshTrend = useCallback(async (force = false) => {
    if (!cacheUserId) return; const { startIso, endIso, date } = getTodayBoundsIST(); const key = `dashboardTrend|ALL|${date}`; const persisted = readOperationalSnapshot<DashboardTodayLoadTrendRow[]>(cacheUserId, key); const cached = cacheRead(trendCache.current, key) ?? (persisted ? { data: persisted.value, updatedAt: Date.parse(persisted.cachedAt) } : null); const fresh = Boolean(online && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS); const generation = ++trendGeneration.current;
    if (cached) setTrend({ data: cached.data, loading: !fresh || force, error: null, key, updatedAt: cached.updatedAt }); else setTrend((previous) => ({ ...previous, loading: true, error: null, key }));
    if (!online) { setTrend((previous) => ({ ...previous, loading: false, error: cached ? null : 'No cached load timeline is available.', key })); return; }
    if (fresh && !force) return;
    try { const data = await api.getDashboardTodayLoadTrend(startIso, endIso); if (generation !== trendGeneration.current) return; const snapshot = writeOperationalSnapshot(cacheUserId, key, data); cacheWrite(trendCache.current, key, data); setTrend({ data, loading: false, error: null, key, updatedAt: Date.parse(snapshot.cachedAt) }); }
    catch (error) { if (generation !== trendGeneration.current) return; setTrend((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load today’s trend.', key })); }
  }, [cacheUserId, online]);
  const refreshAttention = useCallback(async (force = false) => {
    if (!cacheUserId) return; const { startIso, endIso, date } = getTodayBoundsIST(); const key = `dashboardAttention|ALL|${date}`; const persisted = readOperationalSnapshot<DashboardAttentionItem[]>(cacheUserId, key); const cached = cacheRead(attentionCache.current, key) ?? (persisted ? { data: persisted.value, updatedAt: Date.parse(persisted.cachedAt) } : null); const fresh = Boolean(online && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS); const generation = ++attentionGeneration.current;
    if (cached) setAttention({ data: cached.data, loading: !fresh || force, error: null, key, updatedAt: cached.updatedAt }); else setAttention((previous) => ({ ...previous, loading: true, error: null, key }));
    if (!online) { setAttention((previous) => ({ ...previous, loading: false, error: cached ? null : 'No cached attention items are available.', key })); return; }
    if (fresh && !force) return;
    try { const data = await api.getDashboardAttentionItems(startIso, endIso, 5); if (generation !== attentionGeneration.current) return; const snapshot = writeOperationalSnapshot(cacheUserId, key, data.slice(0, 5)); cacheWrite(attentionCache.current, key, data); setAttention({ data, loading: false, error: null, key, updatedAt: Date.parse(snapshot.cachedAt) }); }
    catch (error) { if (generation !== attentionGeneration.current) return; setAttention((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load attention items.', key })); }
  }, [cacheUserId, online]);
  const refreshAll = useCallback(() => { void refreshSummary(true); void refreshTrend(true); void refreshAttention(true); }, [refreshAttention, refreshSummary, refreshTrend]);
  useEffect(() => { void refreshSummary(); void refreshTrend(); void refreshAttention(); }, [refreshAttention, refreshSummary, refreshTrend]);
  const refreshFromRealtime = useCallback((changedTables: ReadonlySet<(typeof DASHBOARD_REALTIME_TABLES)[number]>) => {
    const logbookChanged = changedTables.has('log_book_entries');
    if (logbookChanged || changedTables.has('interruptions') || changedTables.has('parameter_alerts')) {
      void refreshSummary(true);
      void refreshAttention(true);
    }
    if (logbookChanged) void refreshTrend(true);
  }, [refreshAttention, refreshSummary, refreshTrend]);
  useRealtimeRefresh({ channelName: 'dashboard-operational-refresh', tables: DASHBOARD_REALTIME_TABLES, onRefresh: refreshFromRealtime });

  const trendPoints = useMemo<TrendPoint[]>(() => (trend.data ?? []).map((row) => ({ ...row, label: `${String(row.hour_no).padStart(2, '0')}:00`, tooltipValue: row.total_mw ?? 0, emptyValue: row.total_mw === null ? 0 : null })), [trend.data]);
  const completeHours = useMemo(() => trendPoints.filter((row) => row.fill_status === 'FULL').length, [trendPoints]);
  const expectedHours = useMemo(() => trendPoints.filter((row) => row.fill_status !== 'FUTURE').length, [trendPoints]);
  const peakPoint = useMemo(() => trendPoints.filter((row) => row.total_mw !== null).reduce<TrendPoint | null>((peak, row) => !peak || Number(row.total_mw) > Number(peak.total_mw) ? row : peak, null), [trendPoints]);
  const operationalStatus = useMemo<OperationalStatus>(() => {
    if (!summary.data) return { label: 'Status unavailable', detail: 'Waiting for today’s operational summary.', tone: 'slate' };
    if (summary.data.open_interruptions > 0) return { label: 'Active interruptions', detail: `${summary.data.open_interruptions} open across ${summary.data.interruption_stations} affected station${summary.data.interruption_stations === 1 ? '' : 's'}.`, tone: 'red' };
    if (summary.data.active_parameter_alerts > 0) return { label: 'Attention required', detail: `${summary.data.active_parameter_alerts} active alert${summary.data.active_parameter_alerts === 1 ? '' : 's'} affecting ${summary.data.alert_feeders} feeder${summary.data.alert_feeders === 1 ? '' : 's'}.`, tone: 'orange' };
    if (summary.data.completeness_percent < 100) return { label: 'Attention required', detail: `Operations are clear; today’s logbook is ${summary.data.completeness_percent.toFixed(1)}% complete.`, tone: 'orange' };
    return { label: 'Normal', detail: 'No open interruptions or active parameter alerts.', tone: 'green' };
  }, [summary.data]);
  const isRefreshing = summary.loading || trend.loading || attention.loading; const hasSummary = Boolean(summary.data);
  const freshness = online && !usingDashboardCache ? 'LIVE' : cachedFreshness(summary.updatedAt ? new Date(summary.updatedAt).toISOString() : null);
  const freshnessLabel = online && !usingDashboardCache ? `Live · Updated ${formatLastUpdated(summary.updatedAt)}` : summary.updatedAt ? `${online ? '' : 'Offline · '}Cached · Updated ${formatCacheAge(new Date(summary.updatedAt).toISOString())}` : 'Offline · No cached dashboard data';

  return <>
    <div className="lg:invisible lg:pointer-events-none lg:fixed lg:-left-[10000px] lg:top-0 lg:h-screen lg:w-[390px] lg:overflow-hidden lg:[contain:strict]">
    <div className="flex min-h-screen flex-col bg-[#EEF3F8]">
    <header className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] px-4 pb-4 pt-[22px] text-white shadow-md"><div className="flex items-center justify-between gap-3"><button type="button" onClick={onBack} className="rounded-full p-1 transition hover:bg-white/10 active:scale-95" aria-label="Back to Module Selection"><ArrowLeft size={24} /></button><div className="min-w-0 flex-1 text-center"><h1 className="truncate text-xl font-bold">Dashboard</h1><p className="mt-0.5 truncate text-[11px] font-medium text-blue-100">Real-time overview of grid operations</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => onNavigate('alerts')} className="relative rounded-full p-1 transition hover:bg-white/10 active:scale-95" aria-label="Open alerts"><Bell size={22} />{(summary.data?.active_parameter_alerts ?? 0) > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold">{summary.data?.active_parameter_alerts}</span>}</button><ScreenExportMenu contentRef={exportContentRef} title="GridVision Operational Dashboard" /></div></div></header>
    <main ref={exportContentRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-800">Operational Overview</h2><p className="mt-1 text-[11px] font-medium text-slate-500">All accessible stations · Today (IST)</p></div><button type="button" onClick={refreshAll} disabled={isRefreshing || !online} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-blue-700 shadow-sm disabled:opacity-70" aria-label={isRefreshing ? 'Refreshing dashboard' : 'Refresh dashboard'} title={isRefreshing ? 'Refreshing' : 'Refresh'} aria-busy={isRefreshing}><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /></button></div><p className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-2 w-2 rounded-full ${freshness === 'LIVE' ? 'bg-emerald-500' : freshness === 'RECENT_CACHE' ? 'bg-amber-500' : 'bg-red-500'}`} />{freshnessLabel}</p>{!online && pending > 0 ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">{pending} local change{pending === 1 ? ' is' : 's are'} pending sync and not yet reflected in server dashboard totals.</p> : null}
      <section className={`grid grid-cols-2 gap-3 transition-opacity ${summary.loading && hasSummary ? 'opacity-80' : ''}`} aria-busy={summary.loading}>{summary.loading && !hasSummary ? <div className="col-span-2 rounded-2xl bg-white"><LoadingBlock label="Loading operational summary…" /></div> : <><MetricCard icon={<Zap className="h-5 w-5" />} label="Peak Load Today" value={summary.data?.peak_mw === null || summary.data?.peak_mw === undefined ? '—' : `${summary.data.peak_mw.toFixed(2)} MW`} detail={summary.data?.peak_time ? `at ${formatIstTime(summary.data.peak_time)} hrs` : 'No MW reading yet'} tone="blue" /><MetricCard icon={<TriangleAlert className="h-5 w-5" />} label="Open Interruptions" value={String(summary.data?.open_interruptions ?? '—')} detail={`${summary.data?.interruption_stations ?? 0} station${(summary.data?.interruption_stations ?? 0) === 1 ? '' : 's'} affected`} tone="red" /><MetricCard icon={<AlertTriangle className="h-5 w-5" />} label="Active Alerts" value={String(summary.data?.active_parameter_alerts ?? '—')} detail={`${summary.data?.alert_feeders ?? 0} feeder${(summary.data?.alert_feeders ?? 0) === 1 ? '' : 's'} affected`} tone="orange" /><MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Data Completeness" value={summary.data ? `${summary.data.completeness_percent.toFixed(1)}%` : '—'} detail={summary.data ? `${summary.data.entered_feeder_hours}/${summary.data.expected_feeder_hours} feeder-hours` : 'Loading status'} tone="green" /></>}</section>{summary.error && !hasSummary && <RetryMessage message="Could not load the operational summary." onRetry={() => void refreshSummary(true)} />}
      <DashboardCard title="Attention Required" subtitle="Current issues needing review" loading={attention.loading} hasData={Boolean(attention.data)} error={attention.error} onRetry={() => void refreshAttention(true)}>{attention.loading && !attention.data ? <LoadingBlock label="Loading current issues…" /> : attention.data?.length ? <div className="divide-y divide-slate-100">{attention.data.map((item) => { const target: DashboardTarget = item.issue_type === 'COMPLETENESS' ? 'analytics' : 'alerts'; const tone = item.severity === 'HIGH' ? 'bg-red-50 text-red-600' : item.severity === 'MEDIUM' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-700'; const icon = item.issue_type === 'INTERRUPTION' ? <TriangleAlert className="h-4 w-4" /> : item.issue_type === 'PARAMETER_ALERT' ? <AlertTriangle className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />; return <button key={`${item.issue_type}-${item.station_id}`} type="button" onClick={() => onNavigate(target)} className="flex w-full items-center gap-3 py-3 text-left transition active:bg-slate-50"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{item.station_name}</span><span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{attentionCopy(item)}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone}`}>{item.severity}</span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></button>; })}</div> : <p className="py-3 text-center text-xs font-medium text-emerald-600">No current issues require attention.</p>}{attention.error && !attention.data && <RetryMessage message="Could not load attention items." onRetry={() => void refreshAttention(true)} />}</DashboardCard>
      <DashboardCard title="Today’s Load (MW)" subtitle={`Complete: ${completeHours} / ${expectedHours} expected hours`} loading={trend.loading} hasData={Boolean(trend.data)} error={trend.error} onRetry={() => void refreshTrend(true)}>{trend.loading && !trend.data ? <LoadingBlock label="Loading today’s load trend…" /> : <><div className="mb-3 flex flex-wrap gap-3 text-[10px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><StatusDot status="FULL" />Complete</span><span className="flex items-center gap-1.5"><StatusDot status="PARTIAL" />Partial</span><span className="flex items-center gap-1.5"><StatusDot status="EMPTY" />Missing</span></div><div className={`h-56 rounded-2xl bg-slate-50 px-1 py-3 transition-opacity ${trend.loading ? 'opacity-80' : ''}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendPoints} margin={{ top: 8, right: 6, left: -14, bottom: 0 }}><defs><linearGradient id="dashboardLoadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} /><stop offset="95%" stopColor="#2563EB" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={9} interval={2} /><YAxis tickLine={false} axisLine={false} fontSize={9} width={45} /><Tooltip content={<TrendTooltip />} /><Area type="linear" dataKey="total_mw" stroke="#2563EB" strokeWidth={3} fill="url(#dashboardLoadGradient)" connectNulls={false} dot={{ r: 3, fill: '#2563EB', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div><div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-100 bg-slate-50 py-2"><TrendStat label="Peak Load" value={peakPoint?.total_mw === null || !peakPoint ? '—' : `${peakPoint.total_mw.toFixed(2)} MW`} /><TrendStat label="Peak Hour" value={peakPoint?.label ?? '—'} /><TrendStat label="Complete Hours" value={`${completeHours}/${expectedHours}`} /></div></>}{trend.error && !trend.data && <RetryMessage message="Could not load today’s trend." onRetry={() => void refreshTrend(true)} />}</DashboardCard>
      <DashboardCard title="System Status" subtitle="Reporting coverage for today" loading={summary.loading} hasData={hasSummary} error={summary.error} onRetry={() => void refreshSummary(true)}>{summary.loading && !hasSummary ? <LoadingBlock label="Loading system status…" /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><SystemMetric label="Stations Reporting" value={`${summary.data?.stations_reporting ?? 0} / ${summary.data?.total_stations ?? 0}`} tone="blue" /><SystemMetric label="Feeders Reporting" value={`${summary.data?.feeders_reporting ?? 0} / ${summary.data?.total_feeders ?? 0}`} tone="green" /><SystemMetric label="Open Interruptions" value={String(summary.data?.open_interruptions ?? 0)} tone="red" /><SystemMetric label="Parameter Alerts" value={String(summary.data?.active_parameter_alerts ?? 0)} tone="orange" /></div>}</DashboardCard>
    </main></div>
    </div>
    <DesktopDashboard
      summary={summary}
      trend={trend}
      attention={attention}
      trendPoints={trendPoints}
      completeHours={completeHours}
      expectedHours={expectedHours}
      peakPoint={peakPoint}
      operationalStatus={operationalStatus}
      isRefreshing={isRefreshing}
      onRefresh={refreshAll}
      onRetrySummary={() => void refreshSummary(true)}
      onRetryTrend={() => void refreshTrend(true)}
      onRetryAttention={() => void refreshAttention(true)}
      onBack={onBack}
      onNavigate={onNavigate}
      online={online}
      pending={pending}
      freshnessLabel={freshnessLabel}
      freshness={freshness}
    />
  </>;
}

type DesktopDashboardProps = {
  summary: ResourceState<DashboardOperationalSummary>;
  trend: ResourceState<DashboardTodayLoadTrendRow[]>;
  attention: ResourceState<DashboardAttentionItem[]>;
  trendPoints: TrendPoint[];
  completeHours: number;
  expectedHours: number;
  peakPoint: TrendPoint | null;
  operationalStatus: OperationalStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
  onRetrySummary: () => void;
  onRetryTrend: () => void;
  onRetryAttention: () => void;
  onBack: () => void;
  onNavigate: (target: DashboardTarget) => void;
  online: boolean;
  pending: number;
  freshnessLabel: string;
  freshness: ReturnType<typeof cachedFreshness> | 'LIVE';
};

function DesktopDashboard({ summary, trend, attention, trendPoints, completeHours, expectedHours, peakPoint, operationalStatus, isRefreshing, onRefresh, onRetrySummary, onRetryTrend, onRetryAttention, onBack, onNavigate, online, pending, freshnessLabel, freshness }: DesktopDashboardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const hasSummary = Boolean(summary.data);

  return <div className="hidden min-h-screen bg-[#EEF3F8] lg:block">
    <div ref={contentRef}>
      <DesktopPageContainer width="wide">
        <header className="flex items-center justify-between gap-6 border-b border-slate-200 bg-white px-5 py-5 text-slate-900 [&_[data-export-exclude]]:border-blue-700 [&_[data-export-exclude]]:bg-blue-700 [&_[data-export-exclude]]:text-white">
          <button type="button" onClick={onBack} className="hidden" aria-label="Back to Module Selection" data-report-exclude><ArrowLeft className="h-6 w-6" /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-extrabold tracking-tight">Dashboard</h1><p className="mt-1 truncate text-sm font-medium text-slate-500">Real-time overview of grid operations</p></div>
          <div className="flex items-center gap-3" data-report-exclude>
            <button type="button" onClick={() => onNavigate('alerts')} className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" aria-label="Open alerts"><Bell className="h-5 w-5" />{(summary.data?.active_parameter_alerts ?? 0) > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{summary.data?.active_parameter_alerts}</span>}</button>
            <ScreenExportMenu contentRef={contentRef} title="GridVision Operational Dashboard" />
            <button type="button" onClick={onRefresh} disabled={isRefreshing || !online} className="grid h-10 w-10 place-items-center rounded-xl bg-blue-700 text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-70" aria-label={isRefreshing ? 'Refreshing dashboard' : 'Refresh dashboard'} title={isRefreshing ? 'Refreshing' : 'Refresh'} aria-busy={isRefreshing}><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
          </div>
        </header>

        <div className="py-6">
          <OperationalStatusBanner status={operationalStatus} loading={summary.loading && !hasSummary} />
          <div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold text-slate-900">Operational overview</h2><p className="mt-1 text-xs font-medium text-slate-500">All accessible stations · Today (IST)</p></div><p className="flex items-center gap-1.5 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${freshness === 'LIVE' ? 'bg-emerald-500' : freshness === 'RECENT_CACHE' ? 'bg-amber-500' : 'bg-red-500'}`} />{freshnessLabel}</p></div>{!online && pending > 0 ? <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{pending} local change{pending === 1 ? ' is' : 's are'} pending sync and not yet reflected in server dashboard totals.</p> : null}

          {summary.loading && !hasSummary ? <div className="rounded-2xl bg-white"><LoadingBlock label="Loading operational summary…" /></div> : <ResponsiveCardGrid columns="2" className="xl:grid-cols-4">
            <MetricCard icon={<Zap className="h-5 w-5" />} label="Total Stations" value={String(summary.data?.total_stations ?? '—')} detail={`${summary.data?.stations_reporting ?? 0} reporting today`} tone="blue" />
            <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Feeders Reporting" value={`${summary.data?.feeders_reporting ?? 0}/${summary.data?.total_feeders ?? 0}`} detail={`${summary.data?.completeness_percent.toFixed(1) ?? '0.0'}% data complete`} tone="green" />
            <MetricCard icon={<TriangleAlert className="h-5 w-5" />} label="Open Interruptions" value={String(summary.data?.open_interruptions ?? '—')} detail={`${summary.data?.interruption_stations ?? 0} stations affected`} tone="red" />
            <MetricCard icon={<AlertTriangle className="h-5 w-5" />} label="Active Alerts" value={String(summary.data?.active_parameter_alerts ?? '—')} detail={`${summary.data?.alert_feeders ?? 0} feeders affected`} tone="orange" />
          </ResponsiveCardGrid>}
          {summary.error && !hasSummary && <RetryMessage message="Could not load the operational summary." onRetry={onRetrySummary} />}

          <div className="mt-6 grid grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] items-start gap-5">
            <DesktopPanel title="Today’s load timeline" subtitle={`Complete: ${completeHours} / ${expectedHours} expected hours`} loading={trend.loading} hasData={Boolean(trend.data)} error={trend.error} onRetry={onRetryTrend}>
              {trend.loading && !trend.data ? <LoadingBlock label="Loading today’s load trend…" /> : <>
                <div className="mb-3 flex flex-wrap gap-4 text-[10px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><StatusDot status="FULL" />Complete</span><span className="flex items-center gap-1.5"><StatusDot status="PARTIAL" />Partial</span><span className="flex items-center gap-1.5"><StatusDot status="EMPTY" />Empty</span></div>
                <div className="h-64 rounded-2xl border border-slate-100 bg-slate-50 px-2 py-4" role="img" aria-label="Hourly load line graph for today">
                  <ResponsiveContainer width="100%" height="100%"><LineChart data={trendPoints} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}><CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval={2} /><YAxis tickLine={false} axisLine={false} fontSize={10} width={48} /><Tooltip content={<TrendTooltip />} /><Line type="linear" dataKey="total_mw" stroke="#2563EB" strokeWidth={3} connectNulls={false} dot={<TimelineDot />} activeDot={<TimelineDot active />} isAnimationActive={false} /><Line type="linear" dataKey="emptyValue" stroke="transparent" connectNulls={false} dot={<TimelineDot />} activeDot={<TimelineDot active />} isAnimationActive={false} legendType="none" /></LineChart></ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-100 bg-slate-50 py-3"><TrendStat label="Peak Load" value={peakPoint?.total_mw === null || !peakPoint ? '—' : `${peakPoint.total_mw.toFixed(2)} MW`} /><TrendStat label="Peak Hour" value={peakPoint?.label ?? '—'} /><TrendStat label="Complete Hours" value={`${completeHours}/${expectedHours}`} /></div>
              </>}
              {trend.error && !trend.data && <RetryMessage message="Could not load today’s trend." onRetry={onRetryTrend} />}
            </DesktopPanel>

            <DesktopPanel title="Attention required" subtitle="Active station issues" loading={attention.loading} hasData={Boolean(attention.data)} error={attention.error} onRetry={onRetryAttention}>
              {attention.loading && !attention.data ? <LoadingBlock label="Loading current issues…" /> : attention.data?.length ? <div className="divide-y divide-slate-100">{attention.data.map((item) => { const target: DashboardTarget = item.issue_type === 'COMPLETENESS' ? 'analytics' : 'alerts'; const tone = item.severity === 'HIGH' ? 'bg-red-50 text-red-600' : item.severity === 'MEDIUM' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-700'; return <button key={`${item.issue_type}-${item.station_id}`} type="button" onClick={() => onNavigate(target)} className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-slate-50"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}><AlertTriangle className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{item.station_name}</span><span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{attentionCopy(item)}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone}`}>{item.severity}</span></button>; })}</div> : <p className="py-8 text-center text-sm font-semibold text-emerald-600">No current issues require attention.</p>}
              {attention.error && !attention.data && <RetryMessage message="Could not load attention items." onRetry={onRetryAttention} />}
            </DesktopPanel>
          </div>

          <DesktopSection title="Today’s operational status" spacing="compact" className="mt-6">
            <div className="grid grid-cols-2 gap-4">
              <DesktopPanel title="Reporting coverage" subtitle="Station and feeder data received today" loading={summary.loading} hasData={hasSummary} error={summary.error} onRetry={onRetrySummary}><div className="grid grid-cols-2 gap-3"><SystemMetric label="Stations Reporting" value={`${summary.data?.stations_reporting ?? 0} / ${summary.data?.total_stations ?? 0}`} tone="blue" /><SystemMetric label="Feeders Reporting" value={`${summary.data?.feeders_reporting ?? 0} / ${summary.data?.total_feeders ?? 0}`} tone="green" /></div></DesktopPanel>
              <DesktopPanel title="Operational impact" subtitle="Current interruptions and alerts" loading={summary.loading} hasData={hasSummary} error={summary.error} onRetry={onRetrySummary}><div className="grid grid-cols-2 gap-3"><SystemMetric label="Affected Stations" value={String(summary.data?.interruption_stations ?? 0)} tone="red" /><SystemMetric label="Alert Feeders" value={String(summary.data?.alert_feeders ?? 0)} tone="orange" /></div></DesktopPanel>
            </div>
          </DesktopSection>
        </div>
      </DesktopPageContainer>
    </div>
  </div>;
}

function OperationalStatusBanner({ status, loading }: { status: OperationalStatus; loading: boolean }) {
  const styles = {
    green: { shell: 'border-emerald-200 bg-emerald-50', icon: 'bg-emerald-600 text-white', label: 'text-emerald-800' },
    orange: { shell: 'border-amber-200 bg-amber-50', icon: 'bg-amber-500 text-white', label: 'text-amber-900' },
    red: { shell: 'border-red-200 bg-red-50', icon: 'bg-red-600 text-white', label: 'text-red-800' },
    slate: { shell: 'border-slate-200 bg-white', icon: 'bg-slate-400 text-white', label: 'text-slate-800' },
  }[status.tone];
  const Icon = status.tone === 'green' ? CheckCircle2 : status.tone === 'red' ? TriangleAlert : status.tone === 'orange' ? AlertTriangle : Loader2;

  return <section className={`mb-5 flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-sm ${styles.shell}`} aria-live="polite"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${styles.icon}`}><Icon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Grid status today</p><p className={`mt-1 text-lg font-extrabold ${styles.label}`}>{status.label}</p><p className="mt-0.5 text-xs font-medium text-slate-600">{status.detail}</p></div></section>;
}

function DesktopPanel({ title, subtitle, loading, hasData, error, onRetry, children }: { title: string; subtitle: string; loading: boolean; hasData: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  return <section className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-busy={loading}><UpdatingOverlay loading={loading} hasData={hasData} error={error} onRetry={onRetry} /><div className="mb-4 pr-24"><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div>{children}</section>;
}

function TrendStat({ label, value }: { label: string; value: string }) { return <div className="min-w-0 px-2 text-center"><p className="truncate text-[9px] font-medium text-slate-400">{label}</p><p className="mt-1 truncate text-xs font-extrabold text-slate-700">{value}</p></div>; }
function SystemMetric({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'green' | 'red' | 'orange' }) { const color = { blue: 'text-blue-700', green: 'text-emerald-600', red: 'text-red-600', orange: 'text-orange-600' }[tone]; return <div className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-[10px] font-semibold text-slate-500">{label}</p><p className={`mt-1 text-base font-extrabold ${color}`}>{value}</p></div>; }
function RetryMessage({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600"><span>{message}</span><button type="button" onClick={onRetry} className="shrink-0 underline">Retry</button></div>; }
