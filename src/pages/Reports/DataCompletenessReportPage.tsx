import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Building2, RadioTower } from 'lucide-react';
import {
  api,
  type DataCompletenessMissingRow,
  type DataCompletenessReportBreakdownRow,
  type DataCompletenessReportSummary,
  type DataCompletenessReportTrendRow,
} from '@/services/api';
import { useApp } from '@/context/AppContext';
import {
  getReportPeriodDates,
  getReportPeriodLabel,
  getReportRangeIso,
  ReportActions,
  ReportFilters,
  ReportPageShell,
  ReportPreview,
  type ReportColumn,
  type ReportFilterValues,
  type ReportResource,
  type ReportSummaryCard,
} from '@/components/reports';
import type { Feeder } from '@/types';

const PAGE_SIZE = 50;
const INITIAL_PERIOD = getReportPeriodDates('today');
type LoadedReport = { filters: ReportFilterValues; page: number; total: number };
type Aggregates = { summary: DataCompletenessReportSummary; stations: DataCompletenessReportBreakdownRow[]; feeders: DataCompletenessReportBreakdownRow[]; trend: DataCompletenessReportTrendRow[] };

function statusTone(status: 'FULL' | 'PARTIAL' | 'EMPTY'): string {
  return status === 'FULL' ? 'bg-emerald-100 text-emerald-700' : status === 'PARTIAL' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700';
}

function thresholdValue(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 90;
}

export function DataCompletenessReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({ stationId: '', feederId: '', period: 'today', threshold: '90', ...INITIAL_PERIOD });
  const [resource, setResource] = useState<ReportResource<DataCompletenessMissingRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = stations.map((station) => station.id);
    if (ids.length === 0) { setFeeders([]); return undefined; }
    void api.getFeedersForStations(ids).then((rows) => { if (!cancelled) setFeeders(rows); }).catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const feederById = useMemo(() => new Map(feeders.map((feeder) => [feeder.id, feeder])), [feeders]);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues, page: number, refreshAggregates: boolean) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const stationId = nextFilters.stationId || null;
    const feederId = nextFilters.feederId || null;
    const threshold = thresholdValue(nextFilters.threshold);
    setResource((current) => ({ ...current, loading: true, error: null }));
    try {
      const missingRequest = api.getDataCompletenessMissingPage(startIso, endIso, page, PAGE_SIZE, stationId, feederId);
      const result = refreshAggregates
        ? await Promise.all([
          missingRequest,
          api.getDataCompletenessReportSummary(startIso, endIso, threshold, stationId, feederId),
          api.getDataCompletenessStationBreakdown(startIso, endIso, stationId, feederId),
          api.getDataCompletenessFeederBreakdown(startIso, endIso, stationId, feederId),
          api.getDataCompletenessReportTrend(startIso, endIso, stationId, feederId),
        ])
        : [await missingRequest, null, null, null, null] as const;
      if (generation !== requestGeneration.current) return;
      const [missing, summary, stationRows, feederRows, trend] = result;
      if (refreshAggregates && summary && stationRows && feederRows && trend) setAggregates({ summary, stations: stationRows, feeders: feederRows, trend });
      setLoadedReport({ filters: nextFilters, page, total: missing.total });
      setResource({ rows: missing.rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the Data Completeness report.' }));
    }
  }, []);

  const generate = useCallback(() => {
    if (resource.loading || stations.length === 0) return;
    void loadReport(filters, 0, true);
  }, [filters, loadReport, resource.loading, stations.length]);
  const changePage = useCallback((page: number) => {
    if (!loadedReport || resource.loading || page === loadedReport.page) return;
    void loadReport(loadedReport.filters, page, false);
  }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<DataCompletenessMissingRow>[]>(() => [
    { id: 'date', label: 'Date (IST)', value: (row) => row.date, csvValue: (row) => row.date },
    { id: 'hour', label: 'Expected hour', value: (row) => `${String(row.hour).padStart(2, '0')}:00`, csvValue: (row) => `${String(row.hour).padStart(2, '0')}:00` },
    { id: 'station', label: 'Station', value: (row) => row.station_name, csvValue: (row) => row.station_name },
    { id: 'feeder', label: 'Feeder', value: (row) => row.feeder_name, csvValue: (row) => row.feeder_name },
    { id: 'status', label: 'Status', value: () => <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700">MISSING</span>, csvValue: (row) => row.status },
  ], []);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    if (!aggregates) return [];
    const { summary } = aggregates;
    const threshold = thresholdValue(loadedReport?.filters.threshold);
    return [
      { label: 'Expected feeder-hours', value: String(summary.expected_feeder_hours), tone: 'slate' },
      { label: 'Entered feeder-hours', value: String(summary.entered_feeder_hours), tone: 'blue' },
      { label: 'Overall completeness', value: `${summary.completeness_percent.toFixed(1)}%`, tone: summary.completeness_percent >= threshold ? 'green' : 'orange' },
      { label: `Stations below ${threshold}%`, value: String(summary.stations_below_threshold), tone: summary.stations_below_threshold ? 'orange' : 'green' },
      { label: `Feeders below ${threshold}%`, value: String(summary.feeders_below_threshold), tone: summary.feeders_below_threshold ? 'red' : 'green' },
    ];
  }, [aggregates, loadedReport?.filters.threshold]);

  const activeFilters = loadedReport?.filters ?? filters;
  const stationScope = activeFilters.stationId ? stationById.get(activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const feederScope = activeFilters.feederId ? feederById.get(activeFilters.feederId)?.name ?? 'Selected feeder' : undefined;

  return (
    <ReportPageShell
      title="Data Completeness Report"
      subtitle="Review expected feeder-hours and reporting gaps"
      onBack={onBack}
      contentRef={contentRef}
      desktopWide
      actions={<ReportActions title="Data Completeness Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf />}
      filters={<ReportFilters values={filters} options={{ stations, feeders, feederApplicable: Boolean(filters.stationId), thresholdApplicable: true }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
    >
      {loadedReport ? <ReportPreview
        meta={{ title: 'Data Completeness Report', stationScope, feederScope, periodLabel: getReportPeriodLabel(activeFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [
          `From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`, `Below threshold: ${thresholdValue(activeFilters.threshold)}%`,
        ] }}
        summaryCards={summaryCards}
        resource={resource}
        columns={columns}
        rowKey={(row) => `${row.date}|${row.hour}|${row.feeder_id}`}
        onRetry={generate}
        pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
      /> : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}

      {loadedReport && aggregates && <section className="mt-4 space-y-3" aria-label="Completeness breakdowns">
        <TrendSection rows={aggregates.trend} />
        <div className="grid gap-3 md:grid-cols-2">
          <BreakdownSection title="Station completeness" icon={<Building2 className="h-4 w-4" />} rows={aggregates.stations} />
          <BreakdownSection title="Feeder completeness" icon={<RadioTower className="h-4 w-4" />} rows={aggregates.feeders} />
        </div>
      </section>}
    </ReportPageShell>
  );
}

function TrendSection({ rows }: { rows: DataCompletenessReportTrendRow[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><BarChart3 className="h-4 w-4 text-blue-700" />Daily completeness trend</h2>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No expected hours in this period.</p> : <div className="mt-3 space-y-2">{rows.slice(-14).map((row) => <div key={row.date} className="grid grid-cols-[76px_1fr_auto] items-center gap-2 text-xs"><span className="text-slate-500">{row.date}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${row.fill_status === 'FULL' ? 'bg-emerald-500' : row.fill_status === 'PARTIAL' ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${row.completeness_percent}%` }} /></div><span className="font-bold text-slate-700">{row.completeness_percent.toFixed(0)}%</span></div>)}</div>}</section>;
}

function BreakdownSection({ title, icon, rows }: { title: string; icon: ReactNode; rows: DataCompletenessReportBreakdownRow[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">{icon}{title}</h2>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No active feeders in this scope.</p> : <div className="mt-3 space-y-2">{rows.slice(0, 10).map((row) => <div key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><span className="min-w-0 truncate text-xs font-semibold text-slate-700">{row.name}</span><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(row.fill_status)}`}>{row.completeness_percent.toFixed(1)}%</span></div>)}</div>}</section>;
}
