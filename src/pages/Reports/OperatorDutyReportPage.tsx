import { useCallback, useMemo, useRef, useState } from 'react';
import { api, type OperatorDutyReportRow } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { getReportPeriodLabel, ReportActions, ReportFilters, ReportPageShell, ReportPreview, type ReportColumn, type ReportFilterValues, type ReportResource } from '@/components/reports';
import { getTodayIstDate } from '@/components/reports/reportDates';

const formatIst = (v: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));

export function OperatorDutyReportPage({ onBack }: { onBack: () => void }) {
  const { stations } = useApp(); const contentRef = useRef<HTMLDivElement>(null);
  const today = getTodayIstDate();
  const [filters, setFilters] = useState<ReportFilterValues>({ stationId: '', feederId: '', period: 'custom', fromDate: today, toDate: today });
  const [resource, setResource] = useState<ReportResource<OperatorDutyReportRow>>({ rows: [], loading: false, error: null, generatedAt: null });
  const [operatorOptions, setOperatorOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [generatedFilters, setGeneratedFilters] = useState<ReportFilterValues | null>(null);
  const generate = useCallback(() => {
    if (resource.loading) return;
    const from = filters.fromDate; const to = filters.toDate;
    setResource(c => ({ ...c, loading: true, error: null }));
    void api.getOperatorDutyReport(from, to, filters.stationId || null, null).then(rows => {
      const options = Array.from(new Map(rows.map(r => [r.user_id, r.operator_name])).entries()).map(([value, label]) => ({ value, label })).sort((a,b) => a.label.localeCompare(b.label));
      setOperatorOptions(options); const filtered = filters.operatorId ? rows.filter(r => r.user_id === filters.operatorId) : rows;
      setResource({ rows: filtered, loading: false, error: null, generatedAt: new Date() }); setGeneratedFilters(filters);
    }).catch(e => setResource(c => ({ ...c, loading: false, error: e instanceof Error ? e.message : 'Unable to load operator duties.' })));
  }, [filters, resource.loading]);
  const columns = useMemo<ReportColumn<OperatorDutyReportRow>[]>(() => [
    { id: 'operator', label: 'Operator', value: r => r.operator_name, csvValue: r => r.operator_name },
    { id: 'station', label: 'Station', value: r => r.station_name, csvValue: r => r.station_name },
    { id: 'shift', label: 'Shift', value: r => r.shift_name, csvValue: r => r.shift_name },
    { id: 'timing', label: 'Scheduled duty', value: r => `${formatIst(r.scheduled_start)} – ${formatIst(r.scheduled_end)}`, csvValue: r => `${r.scheduled_start} – ${r.scheduled_end}` },
    { id: 'role', label: 'Role', value: r => r.duty_role === 'IN_CHARGE' ? 'Shift In-Charge' : 'Member', csvValue: r => r.duty_role },
    { id: 'state', label: 'Duty status', value: r => r.duty_state === 'OVER' ? 'Over' : r.duty_state === 'CURRENT' ? 'Current' : 'Upcoming', csvValue: r => r.duty_state },
  ], []);
  return <ReportPageShell title="Operator Duty Report" subtitle="Past, current and upcoming rostered shift duties" onBack={onBack} contentRef={contentRef} desktopWide
    actions={<ReportActions title="Operator Duty Report" contentRef={contentRef} rows={resource.rows} columns={columns} disabled={resource.loading} primaryPdf />}
    filters={<ReportFilters values={filters} options={{ stations, feeders: [], operatorOptions }} generating={resource.loading} onChange={setFilters} onGenerate={generate} desktopLayout />}>
    {generatedFilters ? <ReportPreview meta={{ title: 'Operator Duty Report', stationScope: generatedFilters.stationId ? stations.find(s => s.id === generatedFilters.stationId)?.name ?? 'Selected station' : 'All accessible stations', periodLabel: getReportPeriodLabel(generatedFilters), generatedAt: resource.generatedAt ?? new Date(), appliedFilters: [generatedFilters.operatorId ? `Operator ${operatorOptions.find(o => o.value === generatedFilters.operatorId)?.label ?? 'Selected operator'}` : 'All operators'] }} summaryCards={[]} resource={resource} columns={columns} rowKey={r => r.id + r.user_id} onRetry={generate} pageSize={20} /> : <p className="py-8 text-center text-sm text-slate-500">Select a period and generate the report.</p>}
  </ReportPageShell>;
}
