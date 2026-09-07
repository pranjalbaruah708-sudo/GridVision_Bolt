import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, SlidersHorizontal } from 'lucide-react';
import {
  api,
  type ParameterExceptionBreakdownRow,
  type ParameterExceptionDetailRow,
  type ParameterExceptionReportSummary,
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

const PARAMETER_LABELS: Record<string, string> = {
  MW: 'MW', MVAR: 'MVAR', VOLTAGE_KV: 'Voltage', CURRENT_A: 'Current', POWER_FACTOR: 'Power Factor',
  FREQUENCY_HZ: 'Frequency', TRANSFORMER_TEMP_C: 'Transformer Temperature', OIL_LEVEL_PERCENT: 'Oil Level',
};

function parameterLabel(code: string): string { return PARAMETER_LABELS[code] ?? code; }
function formatIst(value: string): string { return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function thresholdText(row: ParameterExceptionDetailRow): string {
  const values = [row.min_value !== null ? `Min ${row.min_value}` : null, row.max_value !== null ? `Max ${row.max_value}` : null].filter(Boolean);
  return values.join(' · ') || 'Not recorded';
}

export function ParameterExceptionReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [parameters, setParameters] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({ stationId: '', feederId: '', parameter: '', period: 'today', ...INITIAL_PERIOD });
  const [resource, setResource] = useState<ReportResource<ParameterExceptionDetailRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [summary, setSummary] = useState<ParameterExceptionReportSummary | null>(null);
  const [breakdown, setBreakdown] = useState<ParameterExceptionBreakdownRow[]>([]);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = stations.map((station) => station.id);
    if (ids.length === 0) { setFeeders([]); return undefined; }
    void api.getFeedersForStations(ids).then((rows) => { if (!cancelled) setFeeders(rows); }).catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);
  useEffect(() => {
    let cancelled = false;
    void api.getParameterExceptionParameters().then((rows) => { if (!cancelled) setParameters(rows); }).catch(() => { if (!cancelled) setParameters([]); });
    return () => { cancelled = true; };
  }, []);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues, page: number, refreshAggregates: boolean) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const stationId = nextFilters.stationId || null;
    const feederId = nextFilters.feederId || null;
    const parameter = nextFilters.parameter || null;
    setResource((current) => ({ ...current, loading: true, error: null }));
    try {
      const detailRequest = api.getParameterExceptionDetailPage(startIso, endIso, page, PAGE_SIZE, stationId, feederId, parameter);
      const result = refreshAggregates
        ? await Promise.all([detailRequest, api.getParameterExceptionReportSummary(startIso, endIso, stationId, feederId, parameter), api.getParameterExceptionBreakdown(startIso, endIso, stationId, feederId, parameter)])
        : [await detailRequest, null, null] as const;
      if (generation !== requestGeneration.current) return;
      const [details, nextSummary, nextBreakdown] = result;
      if (refreshAggregates && nextSummary && nextBreakdown) { setSummary(nextSummary); setBreakdown(nextBreakdown); }
      setLoadedReport({ filters: nextFilters, page, total: details.total });
      setResource({ rows: details.rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the Parameter Exception report.' }));
    }
  }, []);

  const generate = useCallback(() => { if (!resource.loading && stations.length > 0) void loadReport(filters, 0, true); }, [filters, loadReport, resource.loading, stations.length]);
  const changePage = useCallback((page: number) => { if (loadedReport && !resource.loading && page !== loadedReport.page) void loadReport(loadedReport.filters, page, false); }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<ParameterExceptionDetailRow>[]>(() => [
    { id: 'time', label: 'Event time (IST)', value: (row) => formatIst(row.triggered_at), csvValue: (row) => formatIst(row.triggered_at) },
    { id: 'station', label: 'Station', value: (row) => row.station_name, csvValue: (row) => row.station_name },
    { id: 'feeder', label: 'Feeder', value: (row) => row.feeder_name, csvValue: (row) => row.feeder_name },
    { id: 'parameter', label: 'Parameter', value: (row) => parameterLabel(row.parameter_code), csvValue: (row) => parameterLabel(row.parameter_code) },
    { id: 'actual', label: 'Recorded value', align: 'right', value: (row) => String(row.actual_value), csvValue: (row) => row.actual_value },
    { id: 'threshold', label: 'Configured threshold', value: (row) => thresholdText(row), csvValue: (row) => thresholdText(row) },
    { id: 'deviation', label: 'Deviation', align: 'right', value: (row) => row.deviation.toFixed(2), csvValue: (row) => row.deviation },
    { id: 'breach', label: 'Breach', value: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.breach_type === 'ABOVE_MAX' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{row.breach_type === 'ABOVE_MAX' ? 'Above max' : 'Below min'}</span>, csvValue: (row) => row.breach_type },
    { id: 'status', label: 'Status', value: () => <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">ACTIVE</span>, csvValue: (row) => row.status },
  ], []);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => summary ? [
    { label: 'Total exceptions', value: String(summary.total_exceptions), tone: 'orange' },
    { label: 'Active exceptions', value: String(summary.active_exceptions), tone: summary.active_exceptions ? 'red' : 'green' },
    { label: 'Affected stations', value: String(summary.affected_stations), tone: 'blue' },
    { label: 'Affected feeders', value: String(summary.affected_feeders), tone: 'orange' },
    { label: 'Most frequent parameter', value: summary.most_frequent_parameter ? parameterLabel(summary.most_frequent_parameter) : 'None', tone: 'slate' },
  ] : [], [summary]);

  const activeFilters = loadedReport?.filters ?? filters;
  const stationScope = activeFilters.stationId ? stations.find((station) => station.id === activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const feederScope = activeFilters.feederId ? feeders.find((feeder) => feeder.id === activeFilters.feederId)?.name ?? 'Selected feeder' : undefined;

  return <ReportPageShell
    title="Parameter Exception Report"
    subtitle="Configured feeder-threshold exceptions"
    onBack={onBack}
    contentRef={contentRef}
    desktopWide
    actions={<ReportActions title="Parameter Exception Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf />}
    filters={<ReportFilters values={filters} options={{ stations, feeders, feederApplicable: Boolean(filters.stationId), parameterOptions: parameters.map((parameter) => ({ value: parameter, label: parameterLabel(parameter) })) }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
  >
    {loadedReport ? <ReportPreview
      meta={{ title: 'Parameter Exception Report', stationScope, feederScope, periodLabel: getReportPeriodLabel(activeFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [`From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`, `Parameter: ${activeFilters.parameter ? parameterLabel(activeFilters.parameter) : 'All configured'}`] }}
      summaryCards={summaryCards}
      resource={resource}
      columns={columns}
      rowKey={(row) => row.id}
      onRetry={generate}
      pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
      desktopTable
    /> : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}

    {loadedReport && <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><p><strong>Severity is not configured.</strong> This report shows the configured breach direction and deviation from the feeder-specific threshold. Current rows in <code>parameter_alerts</code> are shown as Active.</p></div></section>}
    {loadedReport && <BreakdownSection rows={breakdown} />}
  </ReportPageShell>;
}

function BreakdownSection({ rows }: { rows: ParameterExceptionBreakdownRow[] }) {
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><SlidersHorizontal className="h-4 w-4 text-blue-700" />Exception breakdown by parameter</h2>{rows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No configured-threshold exceptions in this scope.</p> : <div className="mt-3 space-y-2">{rows.map((row) => <div key={row.parameter_code} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><span className="text-xs font-semibold text-slate-700">{parameterLabel(row.parameter_code)}</span><span className="text-[11px] text-slate-500">{row.exception_count} exceptions · {row.affected_feeders} feeders</span></div>)}</div>}</section>;
}
