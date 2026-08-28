import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BarChart3 } from 'lucide-react';
import { api, type LoadEnergyReportSummary, type LoadEnergyReportSeriesRow } from '@/services/api';
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

const INITIAL_PERIOD = getReportPeriodDates('today');
type LoadedReport = { filters: ReportFilterValues; interval: 'HOURLY' | 'DAILY' };

function formatMw(value: number | null): string {
  return value === null ? 'Not recorded' : `${value.toFixed(2)} MW`;
}

function formatIst(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function isOneDay(filters: Pick<ReportFilterValues, 'fromDate' | 'toDate'>): boolean {
  return filters.fromDate === filters.toDate;
}

function statusTone(status: LoadEnergyReportSeriesRow['fill_status']): string {
  if (status === 'FULL') return 'bg-emerald-100 text-emerald-700';
  if (status === 'PARTIAL') return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-700';
}

export function LoadEnergyReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({
    stationId: '', feederId: '', period: 'today', grouping: 'HOURLY', ...INITIAL_PERIOD,
  });
  const [resource, setResource] = useState<ReportResource<LoadEnergyReportSeriesRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [summary, setSummary] = useState<LoadEnergyReportSummary | null>(null);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = stations.map((station) => station.id);
    if (ids.length === 0) {
      setFeeders([]);
      return undefined;
    }
    void api.getFeedersForStations(ids).then((rows) => { if (!cancelled) setFeeders(rows); }).catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);

  useEffect(() => {
    const grouping = isOneDay(filters) ? 'HOURLY' : 'DAILY';
    setFilters((current) => current.grouping === grouping ? current : { ...current, grouping });
  }, [filters.fromDate, filters.toDate]);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const feederById = useMemo(() => new Map(feeders.map((feeder) => [feeder.id, feeder])), [feeders]);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const interval = isOneDay(nextFilters) ? 'HOURLY' : 'DAILY';
    const stationId = nextFilters.stationId || null;
    const feederId = nextFilters.feederId || null;
    setResource((current) => ({ ...current, loading: true, error: null }));
    try {
      const [nextSummary, rows] = await Promise.all([
        api.getLoadEnergyReportSummary(startIso, endIso, stationId, feederId),
        api.getLoadEnergyReportSeries(startIso, endIso, interval, stationId, feederId),
      ]);
      if (generation !== requestGeneration.current) return;
      setSummary(nextSummary);
      setLoadedReport({ filters: nextFilters, interval });
      setResource({ rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the Load & Energy report.' }));
    }
  }, []);

  const generate = useCallback(() => {
    if (resource.loading || stations.length === 0) return;
    void loadReport(filters);
  }, [filters, loadReport, resource.loading, stations.length]);

  const columns = useMemo<ReportColumn<LoadEnergyReportSeriesRow>[]>(() => [
    { id: 'interval', label: 'Interval (IST)', value: (row) => loadedReport?.interval === 'HOURLY' ? formatIst(row.bucket_start) : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(row.bucket_start)), csvValue: (row) => loadedReport?.interval === 'HOURLY' ? formatIst(row.bucket_start) : row.bucket_start.slice(0, 10) },
    { id: 'peak', label: 'Peak MW', align: 'right', value: (row) => formatMw(row.peak_mw), csvValue: (row) => row.peak_mw },
    { id: 'minimum', label: 'Minimum MW', align: 'right', value: (row) => formatMw(row.minimum_mw), csvValue: (row) => row.minimum_mw },
    { id: 'average', label: 'Average MW', align: 'right', value: (row) => formatMw(row.average_mw), csvValue: (row) => row.average_mw },
    { id: 'entered', label: 'Entered', align: 'right', value: (row) => String(row.entered_feeder_hours), csvValue: (row) => row.entered_feeder_hours },
    { id: 'expected', label: 'Expected', align: 'right', value: (row) => String(row.expected_feeder_hours), csvValue: (row) => row.expected_feeder_hours },
    { id: 'complete', label: 'Completeness', align: 'right', value: (row) => `${row.completeness_percent.toFixed(1)}%`, csvValue: (row) => row.completeness_percent },
    { id: 'status', label: 'Status', value: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(row.fill_status)}`}>{row.fill_status}</span>, csvValue: (row) => row.fill_status },
  ], [loadedReport?.interval]);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    if (!summary) return [];
    return [
      { label: 'Peak MW', value: formatMw(summary.peak_mw), detail: summary.peak_time ? formatIst(summary.peak_time) : undefined, tone: 'blue' },
      { label: 'Minimum MW', value: formatMw(summary.minimum_mw), detail: summary.minimum_time ? formatIst(summary.minimum_time) : undefined, tone: 'slate' },
      { label: 'Average MW', value: formatMw(summary.average_mw), tone: 'blue' },
      { label: 'Estimated Energy', value: summary.energy_eligible && summary.estimated_energy_mwh !== null ? `${summary.estimated_energy_mwh.toFixed(2)} MWh` : 'Not available', detail: summary.energy_eligible ? 'Hourly MW × 1 hour' : 'Requires complete hourly MW readings', tone: summary.energy_eligible ? 'green' : 'orange' },
      { label: 'Data completeness', value: `${summary.completeness_percent.toFixed(1)}%`, detail: `${summary.entered_feeder_hours} / ${summary.expected_feeder_hours} feeder-hours`, tone: summary.completeness_percent >= 90 ? 'green' : 'orange' },
    ];
  }, [summary]);

  const activeFilters = loadedReport?.filters ?? filters;
  const stationScope = activeFilters.stationId ? stationById.get(activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const feederScope = activeFilters.feederId ? feederById.get(activeFilters.feederId)?.name ?? 'Selected feeder' : undefined;
  const chartRows = resource.rows.map((row) => ({
    label: loadedReport?.interval === 'HOURLY'
      ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(row.bucket_start))
      : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' }).format(new Date(row.bucket_start)),
    mw: row.average_mw,
    status: row.fill_status,
  }));

  return (
    <ReportPageShell
      title="Load & Energy Report"
      subtitle="Compact load, energy and data-completeness analysis"
      onBack={onBack}
      contentRef={contentRef}
      actions={<ReportActions title="Load & Energy Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} />}
      filters={<ReportFilters values={filters} options={{
        stations, feeders, feederApplicable: Boolean(filters.stationId),
        groupingOptions: [{ value: isOneDay(filters) ? 'HOURLY' : 'DAILY', label: isOneDay(filters) ? 'Hourly (single day)' : 'Daily (selected range)' }],
      }} generating={resource.loading} onChange={setFilters} onGenerate={generate} />}
    >
      {loadedReport ? (
        <ReportPreview
          meta={{ title: 'Load & Energy Report', stationScope, feederScope, periodLabel: getReportPeriodLabel(activeFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [
            `From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`, `Interval: ${loadedReport.interval === 'HOURLY' ? 'Hourly' : 'Daily'}`,
          ] }}
          summaryCards={summaryCards}
          resource={resource}
          columns={columns}
          rowKey={(row) => row.bucket_start}
          onRetry={generate}
          pageSize={31}
        />
      ) : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}

      {loadedReport && resource.rows.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><BarChart3 className="h-4 w-4 text-blue-700" />{loadedReport.interval === 'HOURLY' ? 'Hourly load profile' : 'Daily load profile'}</h2>
          <p className="mt-1 text-xs text-slate-500">Average MW per displayed interval. Gaps are retained when MW was not recorded.</p>
          <div className="mt-3 h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartRows} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}><defs><linearGradient id="load-energy-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => typeof value === 'number' ? `${value.toFixed(2)} MW` : 'Not recorded'} /><Area type="monotone" dataKey="mw" stroke="#2563eb" fill="url(#load-energy-area)" strokeWidth={2} connectNulls={false} /></AreaChart></ResponsiveContainer></div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><Activity className="h-3.5 w-3.5 text-blue-700" />FULL = all expected feeder readings; PARTIAL = some readings; EMPTY = none.</div>
        </section>
      )}
    </ReportPageShell>
  );
}
