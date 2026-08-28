import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type LogBookReportSummary } from '@/services/api';
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
import type { Feeder, LogBookEntry } from '@/types';

const PAGE_SIZE = 50;
const INITIAL_PERIOD = getReportPeriodDates('today');

type LoadedReport = {
  filters: ReportFilterValues;
  page: number;
  total: number;
};

function formatIst(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function valueText(value: string | number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return typeof value === 'number' && digits !== undefined ? value.toFixed(digits) : String(value);
}

export function LogBookReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [filters, setFilters] = useState<ReportFilterValues>({
    stationId: '',
    feederId: '',
    period: 'today',
    ...INITIAL_PERIOD,
  });
  const [resource, setResource] = useState<ReportResource<LogBookEntry>>({
    rows: [], loading: false, error: null, generatedAt: null,
  });
  const [summary, setSummary] = useState<LogBookReportSummary | null>(null);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stationIds = stations.map((station) => station.id);
    if (stationIds.length === 0) {
      setFeeders([]);
      return undefined;
    }
    void api.getFeedersForStations(stationIds)
      .then((rows) => { if (!cancelled) setFeeders(rows); })
      .catch(() => { if (!cancelled) setFeeders([]); });
    return () => { cancelled = true; };
  }, [stations]);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const feederById = useMemo(() => new Map(feeders.map((feeder) => [feeder.id, feeder])), [feeders]);

  const loadReport = useCallback(async (
    nextFilters: ReportFilterValues,
    page: number,
    refreshSummary: boolean
  ) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    const stationId = nextFilters.stationId || null;
    const feederId = nextFilters.feederId || null;
    const accessibleStationIds = stations.map((station) => station.id);
    setResource((current) => ({ ...current, loading: true, error: null }));

    try {
      const pageRequest = api.getLogBookReportPage(
        startIso, endIso, accessibleStationIds, page, PAGE_SIZE, stationId, feederId
      );
      const result = refreshSummary
        ? await Promise.all([pageRequest, api.getLogBookReportSummary(startIso, endIso, stationId, feederId)])
        : [await pageRequest, summary] as const;
      if (generation !== requestGeneration.current) return;

      const [pageResult, summaryResult] = result;
      const generatedAt = new Date();
      if (refreshSummary && summaryResult) setSummary(summaryResult);
      setLoadedReport({ filters: nextFilters, page, total: pageResult.total });
      setResource({ rows: pageResult.rows, loading: false, error: null, generatedAt });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to generate the log book report.',
      }));
    }
  }, [stations, summary]);

  const generate = useCallback(() => {
    if (resource.loading || stations.length === 0) return;
    void loadReport(filters, 0, true);
  }, [filters, loadReport, resource.loading, stations.length]);

  const changePage = useCallback((page: number) => {
    if (!loadedReport || resource.loading || page === loadedReport.page) return;
    void loadReport(loadedReport.filters, page, false);
  }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<LogBookEntry>[]>(() => [
    { id: 'time', label: 'Time (IST)', value: (row) => formatIst(row.actual_event_time), csvValue: (row) => formatIst(row.actual_event_time) },
    { id: 'station', label: 'Station', value: (row) => stationById.get(row.station_id)?.name ?? 'Not recorded', csvValue: (row) => stationById.get(row.station_id)?.name ?? '' },
    { id: 'feeder', label: 'Feeder', value: (row) => row.feeder_id ? feederById.get(row.feeder_id)?.name ?? 'Not recorded' : 'Not recorded', csvValue: (row) => row.feeder_id ? feederById.get(row.feeder_id)?.name ?? '' : '' },
    { id: 'mw', label: 'MW', align: 'right', value: (row) => valueText(row.mw, 2), csvValue: (row) => row.mw },
    { id: 'mvar', label: 'MVAR', align: 'right', value: (row) => valueText(row.mvar, 2), csvValue: (row) => row.mvar },
    { id: 'voltage', label: 'Voltage (kV)', align: 'right', value: (row) => valueText(row.voltage_kv, 2), csvValue: (row) => row.voltage_kv },
    { id: 'current', label: 'Current (A)', align: 'right', value: (row) => valueText(row.current_a, 2), csvValue: (row) => row.current_a },
    { id: 'pf', label: 'PF', align: 'right', value: (row) => valueText(row.power_factor, 3), csvValue: (row) => row.power_factor },
    { id: 'frequency', label: 'Frequency (Hz)', align: 'right', value: (row) => valueText(row.frequency_hz, 2), csvValue: (row) => row.frequency_hz },
    { id: 'temperature', label: 'Transformer temp. (°C)', align: 'right', value: (row) => valueText(row.transformer_temp_c, 1), csvValue: (row) => row.transformer_temp_c },
    { id: 'oil', label: 'Oil level (%)', align: 'right', value: (row) => valueText(row.oil_level_percent, 1), csvValue: (row) => row.oil_level_percent },
    { id: 'tap', label: 'Tap position', align: 'right', value: (row) => valueText(row.tap_position), csvValue: (row) => row.tap_position },
    { id: 'weather', label: 'Weather', value: (row) => valueText(row.weather), csvValue: (row) => row.weather },
    { id: 'remarks', label: 'Remarks', value: (row) => valueText(row.remarks), csvValue: (row) => row.remarks },
    { id: 'operator', label: 'Operator', value: (row) => valueText(row.operator_id), csvValue: (row) => row.operator_id },
  ], [feederById, stationById]);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    if (!summary) return [];
    return [
      { label: 'Readings entered', value: String(summary.entered_readings), tone: 'blue' },
      { label: 'Expected readings', value: String(summary.expected_readings), tone: 'slate' },
      { label: 'Data completeness', value: `${summary.completeness_percent.toFixed(1)}%`, tone: summary.completeness_percent >= 90 ? 'green' : 'orange' },
      { label: 'Feeders reported', value: String(summary.feeders_reported), tone: 'green' },
      { label: 'Missing feeder-hours', value: String(summary.missing_feeder_hours), tone: summary.missing_feeder_hours > 0 ? 'orange' : 'green' },
    ];
  }, [summary]);

  const activeFilters = loadedReport?.filters ?? filters;
  const selectedStation = activeFilters.stationId ? stationById.get(activeFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  const selectedFeeder = activeFilters.feederId ? feederById.get(activeFilters.feederId)?.name ?? 'Selected feeder' : 'All applicable feeders';

  return (
    <ReportPageShell
      title="Daily Log Book Report"
      subtitle="Generate a scoped operational reading report"
      onBack={onBack}
      contentRef={contentRef}
      actions={<ReportActions title="Daily Log Book Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} />}
      filters={<ReportFilters values={filters} options={{ stations, feeders, feederApplicable: true }} generating={resource.loading} onChange={setFilters} onGenerate={generate} />}
    >
      {loadedReport ? (
        <ReportPreview
          meta={{
            title: 'Daily Log Book Report',
            stationScope: selectedStation,
            feederScope: selectedFeeder,
            periodLabel: getReportPeriodLabel(activeFilters),
            generatedAt: resource.generatedAt ?? new Date(),
            appliedFilters: [`From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`],
          }}
          summaryCards={summaryCards}
          resource={resource}
          columns={columns}
          rowKey={(row) => row.id}
          onRetry={generate}
          pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
        />
      ) : (
        <div className="py-8 text-center text-sm text-slate-500">Select the scope and date, then generate the report.</div>
      )}
    </ReportPageShell>
  );
}
