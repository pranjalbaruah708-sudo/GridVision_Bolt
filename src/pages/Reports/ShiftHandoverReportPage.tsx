import { useCallback, useMemo, useRef, useState } from 'react';
import {
  api,
  type ShiftHandoverReportRow,
} from '@/services/api';
import { useApp } from '@/context/AppContext';
import {
  getReportPeriodDates,
  getReportPeriodLabel,
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

interface LoadedReport {
  filters: ReportFilterValues;
}

function formatIst(value: string | null): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDate(value: string): string {
  if (!value) return '—';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
  }).format(date);
}

function statusLabel(status: string): string {
  switch (status?.toUpperCase()) {
    case 'ACCEPTED':
      return 'Accepted';
    case 'SUBMITTED':
      return 'Awaiting Acceptance';
    case 'DRAFT':
      return 'Draft';
    default:
      return status
        ? status
            .toLowerCase()
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase())
        : 'Unknown';
  }
}

export function ShiftHandoverReportPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const { stations } = useApp();

  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);

  const [filters, setFilters] = useState<ReportFilterValues>({
    stationId: '',
    feederId: '',
    parameter: '',
    period: 'today',
    ...INITIAL_PERIOD,
  });

  const [resource, setResource] =
    useState<ReportResource<ShiftHandoverReportRow>>({
      rows: [],
      loading: false,
      error: null,
      generatedAt: null,
    });

  const [loadedReport, setLoadedReport] =
    useState<LoadedReport | null>(null);

  const loadReport = useCallback(
    async (nextFilters: ReportFilterValues) => {
      const generation = ++requestGeneration.current;

     

      setResource((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
     const rows = await api.getStationShiftHandoverReport(
  nextFilters.stationId || null,
  nextFilters.fromDate,
  nextFilters.toDate,
  500,
);

        if (generation !== requestGeneration.current) return;

        setLoadedReport({
          filters: { ...nextFilters },
        });

        setResource({
          rows,
          loading: false,
          error: null,
          generatedAt: new Date(),
        });
      } catch (error) {
        if (generation !== requestGeneration.current) return;

        console.error(
          'Failed to generate Shift Handover report:',
          error,
        );

        setResource((current) => ({
          ...current,
          rows: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to generate the Shift Handover report.',
        }));
      }
    },
    [],
  );

  const generate = useCallback(() => {
    if (!resource.loading && stations.length > 0) {
      void loadReport(filters);
    }
  }, [
    filters,
    loadReport,
    resource.loading,
    stations.length,
  ]);

  const columns = useMemo<
    ReportColumn<ShiftHandoverReportRow>[]
  >(
    () => [
      {
        id: 'date',
        label: 'Date',
        value: (row) => formatDate(row.outgoing_shift_date),
        csvValue: (row) => formatDate(row.outgoing_shift_date),
      },
      {
        id: 'outgoingShift',
        label: 'Outgoing Shift',
        value: (row) => row.outgoing_shift_name || '—',
        csvValue: (row) => row.outgoing_shift_name || '',
      },
      {
        id: 'outgoingIc',
        label: 'Outgoing Shift In-Charge',
        value: (row) =>
          row.outgoing_in_charge_name || 'Not assigned',
        csvValue: (row) =>
          row.outgoing_in_charge_name || 'Not assigned',
      },
      {
        id: 'incomingShift',
        label: 'Incoming Shift',
        value: (row) => row.incoming_shift_name || '—',
        csvValue: (row) => row.incoming_shift_name || '',
      },
      {
        id: 'incomingIc',
        label: 'Incoming Shift In-Charge',
        value: (row) =>
          row.incoming_in_charge_name || 'Not assigned',
        csvValue: (row) =>
          row.incoming_in_charge_name || 'Not assigned',
      },
      {
        id: 'submittedBy',
        label: 'Submitted By',
        value: (row) =>
          row.submitted_by_name || 'Not recorded',
        csvValue: (row) =>
          row.submitted_by_name || 'Not recorded',
      },
      {
        id: 'submittedAt',
        label: 'Submitted At',
        value: (row) => formatIst(row.submitted_at),
        csvValue: (row) => formatIst(row.submitted_at),
      },
      {
        id: 'acceptedBy',
        label: 'Accepted By',
        value: (row) =>
          row.accepted_by_name || 'Not accepted',
        csvValue: (row) =>
          row.accepted_by_name || 'Not accepted',
      },
      {
        id: 'acceptedAt',
        label: 'Accepted At',
        value: (row) => formatIst(row.accepted_at),
        csvValue: (row) => formatIst(row.accepted_at),
      },
      {
        id: 'status',
        label: 'Status',
        value: (row) => {
          const status = row.status?.toUpperCase();

          const classes =
            status === 'ACCEPTED'
              ? 'bg-emerald-100 text-emerald-700'
              : status === 'SUBMITTED'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-700';

          return (
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold ${classes}`}
            >
              {statusLabel(row.status)}
            </span>
          );
        },
        csvValue: (row) => statusLabel(row.status),
      },
      {
        id: 'notes',
        label: 'Outgoing Notes',
        value: (row) => row.outgoing_notes || '—',
        csvValue: (row) => row.outgoing_notes || '',
      },
      {
        id: 'comments',
        label: 'Acceptance Comments',
        value: (row) => row.acceptance_comments || '—',
        csvValue: (row) => row.acceptance_comments || '',
      },
    ],
    [],
  );

  const summaryCards = useMemo<ReportSummaryCard[]>(() => {
    const accepted = resource.rows.filter(
      (row) => row.status?.toUpperCase() === 'ACCEPTED',
    ).length;

    const awaiting = resource.rows.filter(
      (row) => row.status?.toUpperCase() === 'SUBMITTED',
    ).length;

    const other = Math.max(
      resource.rows.length - accepted - awaiting,
      0,
    );

    return [
      {
        label: 'Total handovers',
        value: String(resource.rows.length),
        tone: 'blue',
      },
      {
        label: 'Accepted',
        value: String(accepted),
        tone: accepted ? 'green' : 'slate',
      },
      {
        label: 'Awaiting acceptance',
        value: String(awaiting),
        tone: awaiting ? 'orange' : 'slate',
      },
      {
        label: 'Other status',
        value: String(other),
        tone: 'slate',
      },
    ];
  }, [resource.rows]);

  const activeFilters = loadedReport?.filters ?? filters;

  const stationScope = activeFilters.stationId
    ? stations.find(
        (station) => station.id === activeFilters.stationId,
      )?.name ?? 'Selected station'
    : 'No station selected';

  return (
    <ReportPageShell
      title="Shift Handover Report"
      subtitle="Submitted and accepted shift handovers"
      onBack={onBack}
      contentRef={contentRef}
      desktopWide
      actions={
        <ReportActions
          title="Shift Handover Report"
          contentRef={contentRef}
          rows={resource.rows}
          columns={columns}
          disabled={resource.loading || !loadedReport}
          primaryPdf
          totalRows={resource.rows.length}
        />
      }
      filters={
        <ReportFilters
          values={filters}
          options={{
            stations,
            feeders: [],
          }}
          generating={resource.loading}
          onChange={setFilters}
          onGenerate={generate}
          desktopLayout
        />
      }
    >
      {loadedReport ? (
        <ReportPreview<ShiftHandoverReportRow>
          meta={{
            title: 'Shift Handover Report',
            stationScope,
            periodLabel: getReportPeriodLabel(activeFilters),
            generatedAt: resource.generatedAt ?? new Date(),
            appliedFilters: [
              `From ${activeFilters.fromDate}`,
              `To ${activeFilters.toDate}`,
            ],
          }}
          summaryCards={summaryCards}
          resource={resource}
          columns={columns}
          rowKey={(row) => row.id}
          onRetry={generate}
          desktopTable
        />
      ) : (
        <div className="py-8 text-center text-sm text-slate-500">
          Select the station and period, then generate the report.
        </div>
      )}
    </ReportPageShell>
  );
}