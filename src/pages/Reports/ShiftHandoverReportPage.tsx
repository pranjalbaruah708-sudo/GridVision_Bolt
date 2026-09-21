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
        id: 'incomingShift',
        label: 'Incoming Shift',
        value: (row) => row.incoming_shift_name || '—',
        csvValue: (row) => row.incoming_shift_name || '',
      },
      {
        id: 'outgoingOperators',
        label: 'Outgoing Operators',
        value: (row) => <div className="min-w-64 space-y-1">{row.outgoing_operators.length ? row.outgoing_operators.map((operator) => <p key={operator.user_id} className="whitespace-normal text-xs leading-5">{operatorLine(operator, false)}</p>) : <p>Not recorded</p>}</div>,
        csvValue: (row) => row.outgoing_operators.map((operator) => operatorLine(operator, false)).join(' | '),
      },
      {
        id: 'incomingOperators',
        label: 'Incoming Operators / Oversight',
        value: (row) => <div className="min-w-72 space-y-1">{row.incoming_operators.length ? row.incoming_operators.map((operator) => <p key={operator.user_id} className="whitespace-normal text-xs leading-5">{operatorLine(operator, true)}</p>) : <p>Not recorded</p>}</div>,
        csvValue: (row) => row.incoming_operators.map((operator) => operatorLine(operator, true)).join(' | '),
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
        id: 'releaseLifecycle',
        label: 'V2 Release / Incoming Start',
        value: (row) => <div className="min-w-64 space-y-1 text-xs leading-5">{releaseLine(row).map((line) => <p key={line}>{line}</p>)}</div>,
        csvValue: (row) => releaseLine(row).join(' | '),
      },
      {
        id: 'lateSubmittedAt',
        label: 'Late Handover At',
        value: (row) => formatIst(row.late_handover_submission_time),
        csvValue: (row) => formatIst(row.late_handover_submission_time),
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
        id: 'entries',
        label: 'Initial Entries / Amendments',
        value: (row) => <div className="min-w-72 space-y-1">{row.entries.length ? row.entries.map((entry) => <p key={entry.id} className="whitespace-normal text-xs leading-5">{entryLine(entry)}</p>) : <p>{row.outgoing_notes || '—'}</p>}</div>,
        csvValue: (row) => row.entries.length ? row.entries.map(entryLine).join(' | ') : row.outgoing_notes || '',
      },
      {
        id: 'audit',
        label: 'Audit Timeline',
        value: (row) => <div className="min-w-64 space-y-1">{row.audit_events.length ? row.audit_events.map((event) => <p key={event.id} className="whitespace-normal text-xs leading-5">{event.event_type.replace(/_/g, ' ')} · {event.actor_name ?? 'System'} · {formatIst(event.occurred_at)}</p>) : <p>Legacy handover</p>}</div>,
        csvValue: (row) => row.audit_events.map((event) => `${event.event_type}; ${event.actor_name ?? 'System'}; ${formatIst(event.occurred_at)}`).join(' | '),
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

    const attention = resource.rows.flatMap((row) => row.incoming_operators).filter((operator) =>
      ['LATE_PENDING', 'MISSED', 'PENDING', 'STARTED_WITHOUT_HANDOVER', 'NOT_STARTED'].includes(operator.attention_state),
    ).length;

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
        label: 'Individual attention',
        value: String(attention),
        tone: attention ? 'orange' : 'slate',
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

function operatorLine(operator: ShiftHandoverReportRow['incoming_operators'][number], incoming: boolean): string {
  const times = incoming
    ? `${operator.duty_started_at ? `started ${formatIst(operator.duty_started_at)}` : 'not started'}${operator.accepted_at ? `; accepted ${formatIst(operator.accepted_at)}` : ''}`
    : `${operator.duty_started_at ? `started ${formatIst(operator.duty_started_at)}` : 'not started'}${operator.duty_ended_at ? `; ended ${formatIst(operator.duty_ended_at)}` : operator.still_on_duty ? '; still on duty' : ''}`;
  const comment = incoming && operator.acceptance_comments ? `; comment: ${operator.acceptance_comments}` : '';
  const blocked = operator.duty_end_blocked ? '; duty end blocked' : '';
  return `${operator.operator_name} — ${operator.attention_state.replace(/_/g, ' ')}; ${times}${comment}${blocked}`;
}

function entryLine(entry: ShiftHandoverReportRow['entries'][number]): string {
  const content = entry.body || [entry.source_type, entry.source_id].filter(Boolean).join(' ') || 'Source entry';
  return `${entry.phase}: ${content} — ${entry.author_name}, ${formatIst(entry.created_at)}`;
}

function releaseLine(row: ShiftHandoverReportRow): string[] {
  const event = (name: string) => row.audit_events.find((item) => item.event_type === name);
  const provisional = event('PROVISIONAL_HANDOVER_RECORDED');
  const released = event('FINAL_HANDOVER_RELEASED');
  const unattended = event('UNATTENDED_FINAL_HANDOVER_RELEASED');
  const firstIncoming = event('FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE');
  if (!provisional && !released && !unattended && !firstIncoming) return ['Legacy handover'];
  const lines = [
    provisional && `Provisional: ${formatIst(provisional.occurred_at)} · ${provisional.actor_name ?? 'Operator'}`,
    released && `Final release: ${formatIst(released.occurred_at)} · ${released.actor_name ?? 'Operator'}`,
    unattended && 'Awaiting incoming duty',
    firstIncoming && `First incoming actual start: ${formatIst(firstIncoming.occurred_at)}`,
  ].filter(Boolean) as string[];
  if (released && firstIncoming) {
    const minutes = Math.max(0, Math.round((new Date(firstIncoming.occurred_at).getTime() - new Date(released.occurred_at).getTime()) / 60000));
    lines.push(`Unattended duration: ${Math.floor(minutes / 60)}h ${minutes % 60}m`);
  }
  return lines;
}
