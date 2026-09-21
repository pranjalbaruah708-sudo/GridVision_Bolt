import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, type ExecutiveSummaryAttentionRow, type ExecutiveSummaryReport } from '@/services/api';
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

const INITIAL_PERIOD = getReportPeriodDates('today');

function formatMw(value: number | null): string { return value === null ? 'Not recorded' : `${value.toFixed(2)} MW`; }
function formatIst(value: string): string { return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatDuration(minutes: number): string { const rounded = Math.max(0, Math.round(minutes)); return `${Math.floor(rounded / 60) ? `${Math.floor(rounded / 60)}h ` : ''}${rounded % 60}m`; }
function issueLabel(issue: ExecutiveSummaryAttentionRow['issue_type']): string { return issue === 'OPEN_INTERRUPTION' ? 'Open interruption' : issue === 'PARAMETER_EXCEPTION' ? 'Parameter exception' : 'Low completeness'; }

export function ExecutiveSummaryReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [filters, setFilters] = useState<ReportFilterValues>({ stationId: '', feederId: '', period: 'today', ...INITIAL_PERIOD });
  const [resource, setResource] = useState<ReportResource<ExecutiveSummaryAttentionRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [summary, setSummary] = useState<ExecutiveSummaryReport | null>(null);
  const [generatedFilters, setGeneratedFilters] = useState<ReportFilterValues | null>(null);

  const generate = useCallback(() => {
    if (resource.loading || stations.length === 0) return;
    const generation = ++requestGeneration.current;
    const { startIso, endIso } = getReportRangeIso(filters);
    const stationId = filters.stationId || null;
    setResource((current) => ({ ...current, loading: true, error: null }));
    void Promise.all([api.getExecutiveSummaryReport(startIso, endIso, stationId), api.getExecutiveSummaryAttention(startIso, endIso, stationId)])
      .then(([nextSummary, rows]) => {
        if (generation !== requestGeneration.current) return;
        setSummary(nextSummary);
        setGeneratedFilters(filters);
        setResource({ rows, loading: false, error: null, generatedAt: new Date() });
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current) return;
        setResource((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to generate the Executive Summary report.' }));
      });
  }, [filters, resource.loading, stations.length]);

  const columns = useMemo<ReportColumn<ExecutiveSummaryAttentionRow>[]>(() => [
    { id: 'entity', label: 'Station / feeder', value: (row) => row.entity_name, csvValue: (row) => row.entity_name },
    { id: 'scope', label: 'Scope', value: (row) => row.entity_type === 'STATION' ? 'Station' : 'Feeder', csvValue: (row) => row.entity_type },
    { id: 'issue', label: 'Attention item', value: (row) => issueLabel(row.issue_type), csvValue: (row) => issueLabel(row.issue_type) },
    { id: 'count', label: 'Count / missing slots', align: 'right', value: (row) => String(row.issue_count), csvValue: (row) => row.issue_count },
    { id: 'completeness', label: 'Completeness', align: 'right', value: (row) => row.completeness_percent === null ? '—' : `${row.completeness_percent.toFixed(1)}%`, csvValue: (row) => row.completeness_percent },
  ], []);
  const summaryCards = useMemo<ReportSummaryCard[]>(() => summary ? [
    { label: 'Peak load', value: formatMw(summary.peak_mw), detail: summary.peak_time ? formatIst(summary.peak_time) : undefined, tone: 'blue' },
    { label: 'Average load', value: formatMw(summary.average_mw), tone: 'blue' },
    { label: 'Minimum voltage', value: summary.minimum_voltage_kv === null ? 'Not recorded' : `${summary.minimum_voltage_kv.toFixed(2)} kV`, detail: summary.minimum_voltage_time ? formatIst(summary.minimum_voltage_time) : undefined, tone: 'blue' },
    { label: 'Open / total interruptions', value: `${summary.open_interruptions} / ${summary.total_interruptions}`, detail: formatDuration(summary.total_interruption_duration_minutes), tone: summary.open_interruptions ? 'red' : 'green' },
    { label: 'Active / period exceptions', value: `${summary.active_parameter_exceptions} / ${summary.total_parameter_exceptions}`, tone: summary.active_parameter_exceptions ? 'orange' : 'green' },
    { label: 'Data completeness', value: `${summary.completeness_percent.toFixed(1)}%`, detail: `${summary.entered_feeder_hours} / ${summary.expected_feeder_hours} feeder-hours`, tone: summary.completeness_percent >= 90 ? 'green' : 'orange' },
    { label: 'Stations reporting', value: `${summary.stations_reporting} / ${summary.total_stations}`, tone: 'blue' },
    { label: 'Feeders reporting', value: `${summary.feeders_reporting} / ${summary.total_feeders}`, tone: 'blue' },
  ] : [], [summary]);

  const scope = generatedFilters?.stationId ? stations.find((station) => station.id === generatedFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations';
  return <ReportPageShell
    title="Executive Summary Report"
    subtitle="Concise management overview of operational conditions"
    onBack={onBack}
    contentRef={contentRef}
    desktopWide
    actions={<ReportActions title="Executive Summary Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf />}
    filters={<ReportFilters values={filters} options={{ stations, feeders: [] }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}
  >
    {generatedFilters ? <ReportPreview
      meta={{ title: 'Executive Summary Report', stationScope: scope, periodLabel: getReportPeriodLabel(generatedFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [`From ${generatedFilters.fromDate}`, `To ${generatedFilters.toDate}`] }}
      summaryCards={summaryCards}
      resource={resource}
      columns={columns}
      rowKey={(row) => row.id}
      onRetry={generate}
      pageSize={5}
    /> : <div className="py-8 text-center text-sm text-slate-500">Select the scope and period, then generate the report.</div>}
    {generatedFilters && <p className="mt-4 flex items-center gap-2 text-[11px] text-slate-500"><AlertCircle className="h-3.5 w-3.5" />Attention items are prioritised: open interruptions, parameter exceptions, then stations below 90% completeness.</p>}
  </ReportPageShell>;
}
