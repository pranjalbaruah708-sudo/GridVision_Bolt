import { useCallback, useMemo, useRef, useState } from 'react';

import { api } from '@/services/api';
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
import type { StationCondition } from '@/types/operational';

const PAGE_SIZE = 50;
const INITIAL_PERIOD = getReportPeriodDates('today');

type LoadedReport = { filters: ReportFilterValues; page: number; total: number };

function formatIst(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function label(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function tone(status: StationCondition['status']): string {
  return status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700';
}

export function StationConditionReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [filters, setFilters] = useState<ReportFilterValues>({
    stationId: '', feederId: '', status: '', period: 'today', ...INITIAL_PERIOD,
  });
  const [resource, setResource] = useState<ReportResource<StationCondition>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station.name])), [stations]);

  const loadReport = useCallback(async (nextFilters: ReportFilterValues, page: number) => {
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(nextFilters);
    setResource((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await api.getStationConditionReportPage(
        startIso,
        endIso,
        stations.map((station) => station.id),
        page,
        PAGE_SIZE,
        nextFilters.stationId || null,
        (nextFilters.status || null) as StationCondition['status'] | null,
      );
      if (generation !== requestGeneration.current) return;
      setLoadedReport({ filters: nextFilters, page, total: result.total });
      setResource({ rows: result.rows, loading: false, error: null, generatedAt: new Date() });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Unable to generate the Station Condition report.' }));
    }
  }, [stations]);

  const generate = useCallback(() => {
    if (!resource.loading) void loadReport(filters, 0);
  }, [filters, loadReport, resource.loading]);

  const changePage = useCallback((page: number) => {
    if (loadedReport && !resource.loading && page !== loadedReport.page) void loadReport(loadedReport.filters, page);
  }, [loadReport, loadedReport, resource.loading]);

  const columns = useMemo<ReportColumn<StationCondition>[]>(() => [
    { id: 'station', label: 'Station', value: (row) => stationById.get(row.station_id) ?? 'Not recorded', csvValue: (row) => stationById.get(row.station_id) ?? '' },
    { id: 'observed', label: 'Observed (IST)', value: (row) => formatIst(row.observed_at), csvValue: (row) => formatIst(row.observed_at) },
    { id: 'category', label: 'Category', value: (row) => label(row.category), csvValue: (row) => label(row.category) },
    { id: 'area', label: 'Equipment / area', value: (row) => row.equipment_area || 'Not recorded', csvValue: (row) => row.equipment_area || '' },
    { id: 'condition', label: 'Condition', value: (row) => label(row.condition), csvValue: (row) => label(row.condition) },
    { id: 'observation', label: 'Observation', value: (row) => row.observation, csvValue: (row) => row.observation },
    { id: 'status', label: 'Status', value: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone(row.status)}`}>{label(row.status)}</span>, csvValue: (row) => label(row.status) },
    { id: 'rectified', label: 'Rectified (IST)', value: (row) => formatIst(row.rectified_at), csvValue: (row) => row.rectified_at ? formatIst(row.rectified_at) : '' },
    { id: 'entryMode', label: 'Entry mode', value: (row) => row.entry_mode, csvValue: (row) => row.entry_mode },
  ], [stationById]);

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    const open = resource.rows.filter((row) => row.status === 'OPEN').length;
    const rectified = resource.rows.filter((row) => row.status === 'RECTIFIED').length;
    const attention = resource.rows.filter((row) => row.condition === 'ATTENTION').length;
    const abnormal = resource.rows.filter((row) => row.condition === 'ABNORMAL').length;
    return [
      { label: 'Conditions recorded', value: String(loadedReport?.total ?? resource.rows.length), tone: 'blue' },
      { label: 'Open conditions', value: String(open), tone: open ? 'orange' : 'green' },
      { label: 'Rectified', value: String(rectified), tone: 'green' },
      { label: 'Attention / abnormal', value: String(attention + abnormal), tone: attention + abnormal ? 'orange' : 'slate' },
    ];
  }, [loadedReport?.total, resource.rows]);

  const loadAllRows = useCallback(async () => {
    if (!loadedReport) return [];
    const { startIso, endIso } = getReportRangeIso(loadedReport.filters);
    return loadAllReportRows(loadedReport.total, (page, pageSize) => api.getStationConditionReportPage(
      startIso,
      endIso,
      stations.map((station) => station.id),
      page,
      pageSize,
      loadedReport.filters.stationId || null,
      (loadedReport.filters.status || null) as StationCondition['status'] | null,
    ));
  }, [loadedReport, stations]);

  const activeFilters = loadedReport?.filters ?? filters;
  const stationScope = activeFilters.stationId ? stationById.get(activeFilters.stationId) ?? 'Selected station' : 'All accessible stations';

  return <ReportPageShell
    title="Station Condition Report"
    subtitle="Review recorded station and equipment observations"
    onBack={onBack}
    contentRef={contentRef}
    desktopWide
    actions={<ReportActions title="Station Condition Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf totalRows={loadedReport?.total ?? resource.rows.length} loadAllRows={loadAllRows} />}
    filters={<ReportFilters values={filters} options={{ stations, feeders: [], statusOptions: [{ value: 'OPEN', label: 'Open' }, { value: 'RECTIFIED', label: 'Rectified' }] }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
  >
    {loadedReport ? <ReportPreview
      meta={{
        title: 'Station Condition Report',
        stationScope,
        periodLabel: getReportPeriodLabel(activeFilters),
        generatedAt: resource.generatedAt ?? new Date(),
        appliedFilters: [`From ${activeFilters.fromDate}`, `To ${activeFilters.toDate}`, `Status: ${activeFilters.status || 'All'}`],
      }}
      summaryCards={summaryCards}
      resource={resource}
      columns={columns}
      rowKey={(row) => row.id}
      onRetry={generate}
      pagination={{ page: loadedReport.page, pageSize: PAGE_SIZE, totalRows: loadedReport.total, onPageChange: changePage }}
      desktopTable
    /> : <p className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</p>}
  </ReportPageShell>;
}
