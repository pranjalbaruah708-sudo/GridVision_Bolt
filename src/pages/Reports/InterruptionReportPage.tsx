import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Clock3, GitBranch, MapPin } from 'lucide-react';
import {
  api,
  type InterruptionReportBreakdownRow,
  type InterruptionReportSummary,
  type InterruptionReportTrendRow,
  type InterruptionStatus,
} from '@/services/api';
import { useApp } from '@/context/AppContext';
import {
  getReportPeriodDates,
  getReportPeriodLabel,
  getReportRangeIso,
  loadAllReportRows,
  ReportActions,
  ReportFilters,
  ReportPageShell,
  ReportPreview,
  type ReportColumn,
  type ReportFilterValues,
  type ReportResource,
  type ReportSummaryCard,
} from '@/components/reports';
import type { Feeder, Interruption } from '@/types';

const PAGE_SIZE = 50;
const INITIAL_PERIOD = getReportPeriodDates('today');

type LoadedReport = { filters: ReportFilterValues; page: number; total: number };
type Aggregates = {
  summary: InterruptionReportSummary;
  trend: InterruptionReportTrendRow[];
  causes: InterruptionReportBreakdownRow[];
  stations: InterruptionReportBreakdownRow[];
  feeders: InterruptionReportBreakdownRow[];
};

function formatIst(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'Not recorded';
  const rounded = Math.max(0, Math.round(minutes));
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const mins = rounded % 60;
  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${mins}m`.trim();
}

function interruptionDuration(row: Interruption): number | null {
  if (row.current_status === 'OPEN') return (Date.now() - new Date(row.interruption_start).getTime()) / 60000;
  if (row.interruption_end) return (new Date(row.interruption_end).getTime() - new Date(row.interruption_start).getTime()) / 60000;
  return row.duration_minutes;
}

function statusTone(status: string): string {
  if (status === 'OPEN') return 'bg-red-100 text-red-700';
  if (status === 'RESTORED') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}

export function InterruptionReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [causes, setCauses] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({
    stationId: '', feederId: '', status: '', cause: '', grouping: 'STATION', period: 'today', ...INITIAL_PERIOD,
  });
  const [resource, setResource] = useState<ReportResource<Interruption>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stationIds = stations.map((station) => station.id);
    if (stationIds.length === 0) {
      setFeeders([]);
      return undefined;
    }
    void api.getFeedersForStations(stationIds).then((rows) => { if (!cancelled) setFeeders(rows); }).catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);

  useEffect(() => {
    let cancelled = false;
    void api.getInterruptionReportCauses().then((rows) => { if (!cancelled) setCauses(rows); }).catch(() => { if (!cancelled) setCauses([]); });
    return () => { cancelled = true; };
  }, []);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const feederById = useMemo(() => new Map(feeders.map((feeder) => [feeder.id, feeder])), [feeders]);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues, page: number, refreshAggregates: boolean) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const stationId = nextFilters.stationId || null;
    const feederId = nextFilters.feederId || null;
    const status = (nextFilters.status || null) as InterruptionStatus | null;
    const cause = nextFilters.cause || null;
    setResource((current) => ({ ...current, loading: true, error: null }));

    try {
      const detailRequest = api.getInterruptionReportPage(startIso, endIso, stations.map((station) => station.id), page, PAGE_SIZE, stationId, feederId, status, cause);
      const result = refreshAggregates
        ? await Promise.all([
          detailRequest,
          api.getInterruptionReportSummary(startIso, endIso, stationId, feederId, status, cause),
          api.getInterruptionReportTrend(startIso, endIso, stationId, feederId, status, cause),
          api.getInterruptionReportBreakdown(startIso, endIso, 'CAUSE', stationId, feederId, status, cause),
          api.getInterruptionReportBreakdown(startIso, endIso, 'STATION', stationId, feederId, status, cause),
          api.getInterruptionReportBreakdown(startIso, endIso, 'FEEDER', stationId, feederId, status, cause),
        ])
        : [await detailRequest, null, null, null, null, null] as const;
      if (generation !== requestGeneration.current) return;

      const [details, summary, trend, causeRows, stationRows, feederRows] = result;
      if (refreshAggregates && summary && trend && causeRows && stationRows && feederRows) {
        setAggregates({ summary, trend, causes: causeRows, stations: stationRows, feeders: feederRows });
      }
      setLoadedReport({ filters: nextFilters, page, total: details.total });
      setResource({ rows: details.rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the interruption report.' }));
    }
  }, [stations]);

  const generate = useCallback(() => {
    if (resource.loading || stations.length === 0) return;
    void loadReport(filters, 0, true);
  }, [filters, loadReport, resource.loading, stations.length]);
  const changePage = useCallback((page: number) => {
    if (!loadedReport || resource.loading || page === loadedReport.page) return;
    void loadReport(loadedReport.filters, page, false);
  }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<Interruption>[]>(() => [
    { id: 'station', label: 'Station', value: (row) => stationById.get(row.station_id)?.name ?? 'Not recorded', csvValue: (row) => stationById.get(row.station_id)?.name ?? '' },
    { id: 'feeder', label: 'Feeder', value: (row) => row.feeder_id ? feederById.get(row.feeder_id)?.name ?? 'Not recorded' : 'Not recorded', csvValue: (row) => row.feeder_id ? feederById.get(row.feeder_id)?.name ?? '' : '' },
    { id: 'start', label: 'Start (IST)', value: (row) => formatIst(row.interruption_start), csvValue: (row) => formatIst(row.interruption_start) },
    { id: 'end', label: 'Restored / end (IST)', value: (row) => row.interruption_end ? formatIst(row.interruption_end) : 'Ongoing', csvValue: (row) => row.interruption_end ? formatIst(row.interruption_end) : '' },
    { id: 'duration', label: 'Duration', align: 'right', value: (row) => formatDuration(interruptionDuration(row)), csvValue: (row) => interruptionDuration(row)?.toFixed(1) ?? '' },
    { id: 'cause', label: 'Cause', value: (row) => row.cause || 'Not recorded', csvValue: (row) => row.cause },
    { id: 'status', label: 'Status', value: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(row.current_status)}`}>{row.current_status}</span>, csvValue: (row) => row.current_status },
    { id: 'etr', label: 'ETR (IST)', value: (row) => row.etr ? formatIst(row.etr) : 'Not recorded', csvValue: (row) => row.etr ? formatIst(row.etr) : '' },
    { id: 'operator', label: 'Operator', value: (row) => row.operator_name || 'Not recorded', csvValue: (row) => row.operator_name || '' },
    { id: 'remarks', label: 'Remarks', value: (row) => row.remarks || 'Not recorded', csvValue: (row) => row.remarks },
  ], [feederById, stationById]);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    if (!aggregates) return [];
    const { summary } = aggregates;
    return [
      { label: 'Total interruptions', value: String(summary.total_interruptions), tone: 'blue' },
      { label: 'Open interruptions', value: String(summary.open_interruptions), tone: summary.open_interruptions ? 'red' : 'green' },
      { label: 'Total duration', value: formatDuration(summary.total_duration_minutes), tone: 'orange' },
      { label: 'Average restoration', value: formatDuration(summary.average_restoration_minutes), tone: 'slate' },
      { label: 'Longest interruption', value: formatDuration(summary.longest_interruption_minutes), tone: 'orange' },
    ];
  }, [aggregates]);

  const activeFilters = loadedReport?.filters ?? filters;
  const loadAllRows = useCallback(async () => {
    if (!loadedReport) return [];
    const active = loadedReport.filters;
    const { startIso, endIso } = getReportRangeIso(active);
    return loadAllReportRows(loadedReport.total, (page, pageSize) => api.getInterruptionReportPage(
      startIso, endIso, stations.map((station) => station.id), page, pageSize,
      active.stationId || null, active.feederId || null, (active.status || null) as InterruptionStatus | null, active.cause || null,
    ));
  }, [loadedReport, stations]);
  const stationScope = activeFilters.stationId ? stationById.get(activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const feederScope = activeFilters.feederId ? feederById.get(activeFilters.feederId)?.name ?? 'Selected feeder' : 'All applicable feeders';
  const highlightedBreakdown = activeFilters.grouping === 'FEEDER' ? aggregates?.feeders : activeFilters.grouping === 'CAUSE' ? aggregates?.causes : aggregates?.stations;

  return (
    <ReportPageShell
      title="Interruption Report"
      subtitle="Review events, restoration and outage duration"
      onBack={onBack}
      contentRef={contentRef}
      desktopWide
      actions={<ReportActions title="Interruption Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf totalRows={loadedReport?.total ?? resource.rows.length} loadAllRows={loadAllRows} />}
      filters={<ReportFilters values={filters} options={{
        stations, feeders, feederApplicable: true,
        statusOptions: [{ value: 'OPEN', label: 'Open' }, { value: 'RESTORED', label: 'Restored' }],
        causeOptions: causes.map((cause) => ({ value: cause, label: cause })),
        groupingOptions: [{ value: 'STATION', label: 'Station' }, { value: 'FEEDER', label: 'Feeder' }, { value: 'CAUSE', label: 'Cause' }],
      }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
    >
      {loadedReport ? (
        <ReportPreview
          meta={{ title: 'Interruption Report', stationScope, feederScope, periodLabel: getReportPeriodLabel(activeFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [
            `From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`,
            `Status: ${activeFilters.status || 'All'}`, `Cause: ${activeFilters.cause || 'All'}`,
          ] }}
          summaryCards={summaryCards}
          resource={resource}
          columns={columns}
          rowKey={(row) => row.id}
          onRetry={generate}
          pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
          desktopTable
        />
      ) : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}

      {loadedReport && aggregates && (
        <section className="mt-4 space-y-3" aria-label="Interruption aggregate sections">
          <TrendSection rows={aggregates.trend} />
          <BreakdownSection title={`Grouped by ${(activeFilters.grouping || 'STATION').toLowerCase()}`} icon={<GitBranch className="h-4 w-4" />} rows={highlightedBreakdown ?? []} />
          <BreakdownSection title="Cause breakdown" icon={<AlertTriangle className="h-4 w-4" />} rows={aggregates.causes} />
          <div className="grid gap-3 md:grid-cols-2">
            <BreakdownSection title="Top affected stations" icon={<MapPin className="h-4 w-4" />} rows={aggregates.stations} />
            <BreakdownSection title="Top affected feeders" icon={<Clock3 className="h-4 w-4" />} rows={aggregates.feeders} />
          </div>
        </section>
      )}
    </ReportPageShell>
  );
}

function TrendSection({ rows }: { rows: InterruptionReportTrendRow[] }) {
  const maximum = Math.max(1, ...rows.map((row) => row.interruption_count));
  return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-bold text-slate-800">Period trend</h2>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No interruption events in this period.</p> : <div className="mt-3 space-y-2">{rows.slice(-14).map((row) => <div key={row.date} className="grid grid-cols-[76px_1fr_auto] items-center gap-2 text-xs"><span className="text-slate-500">{row.date}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${(row.interruption_count / maximum) * 100}%` }} /></div><span className="font-bold text-slate-700">{row.interruption_count}</span></div>)}</div>}</section>;
}

function BreakdownSection({ title, icon, rows }: { title: string; icon: ReactNode; rows: InterruptionReportBreakdownRow[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">{icon}{title}</h2>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No data for this scope.</p> : <div className="mt-3 space-y-2">{rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><span className="min-w-0 truncate text-xs font-semibold text-slate-700">{row.label}</span><span className="shrink-0 text-[11px] text-slate-500">{row.interruption_count} events · {formatDuration(row.duration_minutes)}</span></div>)}</div>}</section>;
}
