import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Trophy } from 'lucide-react';
import {
  api,
  type PerformanceReportEntity,
  type PerformanceReportMetric,
  type PerformanceReportRankingRow,
  type PerformanceReportRow,
  type PerformanceReportSummary,
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
import type { Feeder } from '@/types';

const PAGE_SIZE = 50;
const INITIAL_PERIOD = getReportPeriodDates('today');
const METRICS: Array<{ value: PerformanceReportMetric; label: string }> = [
  { value: 'PEAK_MW', label: 'Peak MW' }, { value: 'AVERAGE_MW', label: 'Average MW' },
  { value: 'MIN_PF', label: 'Minimum PF' }, { value: 'INTERRUPTIONS', label: 'Interruptions' },
  { value: 'EXCEPTIONS', label: 'Parameter exceptions' }, { value: 'COMPLETENESS', label: 'Data completeness' },
];
type LoadedReport = { filters: ReportFilterValues; page: number; total: number; metric: PerformanceReportMetric };

function formatMw(value: number | null): string { return value === null ? 'Not recorded' : `${value.toFixed(2)} MW`; }
function formatPf(value: number | null): string { return value === null ? 'Not recorded' : value.toFixed(3); }
function formatDuration(minutes: number): string { const rounded = Math.max(0, Math.round(minutes)); return `${Math.floor(rounded / 60) ? `${Math.floor(rounded / 60)}h ` : ''}${rounded % 60}m`; }
function metricLabel(metric: PerformanceReportMetric): string { return METRICS.find((item) => item.value === metric)?.label ?? metric; }
function metricValue(metric: PerformanceReportMetric, value: number | null): string {
  if (value === null) return 'Not recorded';
  if (metric === 'PEAK_MW' || metric === 'AVERAGE_MW') return `${value.toFixed(2)} MW`;
  if (metric === 'MIN_PF') return value.toFixed(3);
  if (metric === 'COMPLETENESS') return `${value.toFixed(1)}%`;
  return String(Math.round(value));
}

export function PerformanceReportPage({ entity, onBack }: { entity: PerformanceReportEntity; onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({ stationId: '', feederId: '', comparisonMetric: 'PEAK_MW', period: 'today', ...INITIAL_PERIOD });
  const [resource, setResource] = useState<ReportResource<PerformanceReportRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [summary, setSummary] = useState<PerformanceReportSummary | null>(null);
  const [ranking, setRanking] = useState<PerformanceReportRankingRow[]>([]);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = stations.map((station) => station.id);
    if (ids.length === 0) { setFeeders([]); return undefined; }
    void api.getFeedersForStations(ids).then((rows) => { if (!cancelled) setFeeders(rows); }).catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues, page: number, refreshAggregates: boolean) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const metric = (nextFilters.comparisonMetric || 'PEAK_MW') as PerformanceReportMetric;
    const stationId = nextFilters.stationId || null;
    const feederId = entity === 'FEEDER' ? nextFilters.feederId || null : null;
    setResource((current) => ({ ...current, loading: true, error: null }));
    try {
      const pageRequest = api.getPerformanceReportPage(startIso, endIso, entity, metric, page, PAGE_SIZE, stationId, feederId);
      const result = refreshAggregates
        ? await Promise.all([pageRequest, api.getPerformanceReportSummary(startIso, endIso, entity, stationId, feederId), api.getPerformanceReportRanking(startIso, endIso, entity, metric, stationId, feederId)])
        : [await pageRequest, null, null] as const;
      if (generation !== requestGeneration.current) return;
      const [pageResult, nextSummary, nextRanking] = result;
      if (refreshAggregates && nextSummary && nextRanking) { setSummary(nextSummary); setRanking(nextRanking); }
      setLoadedReport({ filters: nextFilters, page, total: pageResult.total, metric });
      setResource({ rows: pageResult.rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the performance report.' }));
    }
  }, [entity]);
  const generate = useCallback(() => { if (!resource.loading && stations.length > 0) void loadReport(filters, 0, true); }, [filters, loadReport, resource.loading, stations.length]);
  const changePage = useCallback((page: number) => { if (loadedReport && !resource.loading && page !== loadedReport.page) void loadReport(loadedReport.filters, page, false); }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<PerformanceReportRow>[]>(() => [
    { id: 'name', label: entity === 'STATION' ? 'Station' : 'Feeder', value: (row) => row.entity_name, csvValue: (row) => row.entity_name },
    { id: 'peak', label: 'Peak MW', align: 'right', value: (row) => formatMw(row.peak_mw), csvValue: (row) => row.peak_mw },
    { id: 'average', label: 'Average MW', align: 'right', value: (row) => formatMw(row.average_mw), csvValue: (row) => row.average_mw },
    { id: 'pf', label: 'Minimum PF', align: 'right', value: (row) => formatPf(row.minimum_power_factor), csvValue: (row) => row.minimum_power_factor },
    { id: 'interruptions', label: 'Interruptions', align: 'right', value: (row) => String(row.interruption_count), csvValue: (row) => row.interruption_count },
    { id: 'duration', label: 'Interruption duration', align: 'right', value: (row) => formatDuration(row.interruption_duration_minutes), csvValue: (row) => row.interruption_duration_minutes },
    { id: 'exceptions', label: 'Exceptions', align: 'right', value: (row) => String(row.exception_count), csvValue: (row) => row.exception_count },
    { id: 'completeness', label: 'Completeness', align: 'right', value: (row) => `${row.completeness_percent.toFixed(1)}%`, csvValue: (row) => row.completeness_percent },
    ...(entity === 'STATION' ? [{ id: 'reporting', label: 'Feeders reporting', align: 'right' as const, value: (row: PerformanceReportRow) => String(row.feeders_reporting), csvValue: (row: PerformanceReportRow) => row.feeders_reporting }] : []),
  ], [entity]);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => summary ? [
    { label: `${entity === 'STATION' ? 'Stations' : 'Feeders'} in scope`, value: String(summary.entity_count), tone: 'blue' },
    { label: 'Peak / average load', value: formatMw(summary.peak_mw), detail: `Average ${formatMw(summary.average_mw)}`, tone: 'blue' },
    { label: 'Minimum PF', value: formatPf(summary.minimum_power_factor), tone: 'orange' },
    { label: 'Interruptions', value: String(summary.interruption_count), detail: formatDuration(summary.interruption_duration_minutes), tone: summary.interruption_count ? 'red' : 'green' },
    { label: 'Parameter exceptions', value: String(summary.exception_count), tone: summary.exception_count ? 'orange' : 'green' },
    { label: 'Data completeness', value: `${summary.completeness_percent.toFixed(1)}%`, detail: `${summary.feeders_reporting} feeders reporting`, tone: summary.completeness_percent >= 90 ? 'green' : 'orange' },
  ] : [], [entity, summary]);

  const activeFilters = loadedReport?.filters ?? filters;
  const loadAllRows = useCallback(async () => {
    if (!loadedReport) return [];
    const active = loadedReport.filters;
    const { startIso, endIso } = getReportRangeIso(active);
    return loadAllReportRows(loadedReport.total, (page, pageSize) => api.getPerformanceReportPage(
      startIso, endIso, entity, loadedReport.metric, page, pageSize, active.stationId || null,
      entity === 'FEEDER' ? active.feederId || null : null,
    ));
  }, [entity, loadedReport]);
  const title = entity === 'STATION' ? 'Station Performance Report' : 'Feeder Performance Report';
  const stationScope = activeFilters.stationId ? stations.find((station) => station.id === activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const feederScope = entity === 'FEEDER' && activeFilters.feederId ? feeders.find((feeder) => feeder.id === activeFilters.feederId)?.name ?? 'Selected feeder' : undefined;

  return <ReportPageShell
    title={title}
    subtitle="Separate operational measures, ranked by one selected metric"
    onBack={onBack}
    contentRef={contentRef}
    desktopWide
    actions={<ReportActions title={title} contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf totalRows={loadedReport?.total ?? resource.rows.length} loadAllRows={loadAllRows} />}
    filters={<ReportFilters values={filters} options={{ stations, feeders, feederApplicable: entity === 'FEEDER' && Boolean(filters.stationId), comparisonMetricOptions: METRICS }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
  >
    {loadedReport ? <ReportPreview
      meta={{ title, stationScope, feederScope, periodLabel: getReportPeriodLabel(activeFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [`From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`, `Ranking: ${metricLabel(loadedReport.metric)}`] }}
      summaryCards={summaryCards}
      resource={resource}
      columns={columns}
      rowKey={(row) => row.entity_id}
      onRetry={generate}
      pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
      desktopTable
    /> : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}
    {loadedReport && <RankingSection metric={loadedReport.metric} rows={ranking} />}
  </ReportPageShell>;
}

function RankingSection({ metric, rows }: { metric: PerformanceReportMetric; rows: PerformanceReportRankingRow[] }) {
  const lowFirst = metric === 'MIN_PF' || metric === 'COMPLETENESS';
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Trophy className="h-4 w-4 text-amber-500" />Top ranking — {metricLabel(metric)}</h2><p className="mt-1 text-[11px] text-slate-500">{lowFirst ? 'Lowest values first to highlight attention items.' : 'Highest values first.'} No composite score is used.</p>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No entities in this scope.</p> : <div className="mt-3 space-y-2">{rows.map((row, index) => <div key={row.entity_id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><span className="min-w-0 truncate text-xs font-semibold text-slate-700">{index + 1}. {row.entity_name}</span><span className="shrink-0 text-xs font-bold text-blue-700">{metricValue(metric, row.metric_value)}</span></div>)}</div>}</section>;
}
