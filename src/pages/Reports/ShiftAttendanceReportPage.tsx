import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  UserRoundCheck,
} from 'lucide-react';

import {
  api,
  type ShiftDutySession,
  type ShiftRosterAssignment,
  type StationShift,
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

type AttendanceReportRow = {
  id: string;

  station_id: string;
  station_name: string;

  shift_id: string;
  shift_name: string;
  shift_date: string;

  scheduled_start: string | null;
  scheduled_end: string | null;

  user_id: string;
  operator_name: string;

  shift_role: string;

  started_at: string;
  ended_at: string | null;

  status: string;

  duration_minutes: number | null;
};

type LoadedReport = {
  filters: ReportFilterValues;
  total: number;
};

function formatIst(value: string | null): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDate(value: string): string {
  if (!value) return '—';

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
  }).format(date);
}

function roleLabel(role: string): string {
  if (role === 'IN_CHARGE') {
    return 'Shift In-Charge';
  }

  if (role === 'MEMBER') {
    return 'Member';
  }

  return role || '—';
}

function durationMinutes(
  startedAt: string,
  endedAt: string | null
): number | null {
  if (!endedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    end < start
  ) {
    return null;
  }

  return Math.round((end - start) / 60000);
}

function durationText(minutes: number | null): string {
  if (minutes === null) {
    return 'On duty';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes} min`;
  }

  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}

function getDaysBetween(
  fromDate: string,
  toDate: string
): string[] {
  const result: string[] = [];

  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return result;
  }

  const cursor = new Date(start);

  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

function uniqueById<T extends { id: string }>(
  rows: T[]
): T[] {
  return Array.from(
    new Map(rows.map((row) => [row.id, row])).values()
  );
}

export function ShiftAttendanceReportPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const { stations } = useApp();

  const contentRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);

  const [filters, setFilters] =
    useState<ReportFilterValues>({
      stationId: '',
      feederId: '',
      parameter: '',
      period: 'today',
      ...INITIAL_PERIOD,
    });

  const [resource, setResource] =
    useState<ReportResource<AttendanceReportRow>>({
      rows: [],
      loading: false,
      error: null,
      generatedAt: null,
    });

  const [loadedReport, setLoadedReport] =
    useState<LoadedReport | null>(null);
  const [operatorOptions, setOperatorOptions] = useState<Array<{ value: string; label: string }>>([]);

  const loadReport = useCallback(
    async (nextFilters: ReportFilterValues) => {
      if (!nextFilters.stationId) {
        setResource((current) => ({
          ...current,
          loading: false,
          error:
            'Select a station before generating the Shift Attendance report.',
        }));

        return;
      }

      const generation = ++requestGeneration.current;

      setResource((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const days = getDaysBetween(
          nextFilters.fromDate,
          nextFilters.toDate
        );

        if (days.length === 0) {
          throw new Error(
            'The selected report period is invalid.'
          );
        }

        /*
         * Attendance RPC is day-based.
         *
         * Fetch each selected day and combine the results.
         * This intentionally uses the existing authenticated
         * server RPC instead of bypassing Shift authorization.
         */
        const attendanceByDay =
          await Promise.all(
            days.map((day) =>
              api.getStationShiftAttendance(
                nextFilters.stationId,
                day
              )
            )
          );

        if (generation !== requestGeneration.current) {
          return;
        }

        const attendance =
          uniqueById(attendanceByDay.flat());

        /*
         * Load the shift schedule for the same period so the
         * report can show shift names and scheduled times.
         */
        let shifts: StationShift[] = [];

        try {
          shifts =
            await api.getStationShiftSchedule(
              nextFilters.stationId,
              nextFilters.fromDate,
              nextFilters.toDate
            );
        } catch {
          /*
           * Attendance remains usable even if schedule metadata
           * cannot be enriched.
           */
          shifts = [];
        }

        if (generation !== requestGeneration.current) {
          return;
        }

        const shiftMap =
          new Map(
            shifts.map((shift) => [
              shift.id,
              shift,
            ])
          );

        /*
         * Roster contains the operator display names.
         * Fetch each involved shift only once.
         */
        const shiftIds =
          Array.from(
            new Set(
              attendance.map(
                (session) => session.shift_id
              )
            )
          );

        const rosterResults =
          await Promise.all(
            shiftIds.map(async (shiftId) => {
              try {
                const roster =
                  await api.getShiftRoster(shiftId);

                return {
                  shiftId,
                  roster,
                };
              } catch {
                return {
                  shiftId,
                  roster: [] as ShiftRosterAssignment[],
                };
              }
            })
          );

        if (generation !== requestGeneration.current) {
          return;
        }

        const rosterMap =
          new Map(
            rosterResults.map(
              ({ shiftId, roster }) => [
                shiftId,
                roster,
              ]
            )
          );

        const stationName =
          stations.find(
            (station) =>
              station.id ===
              nextFilters.stationId
          )?.name ?? 'Selected station';

        const allReportRows: AttendanceReportRow[] =
          attendance
            .map((session: ShiftDutySession) => {
              const shift =
                shiftMap.get(session.shift_id);

              const roster =
                rosterMap.get(
                  session.shift_id
                ) ?? [];

              const rosterMember =
                roster.find(
                  (member) =>
                    member.user_id ===
                    session.user_id
                );

              return {
                id: session.id,

                station_id:
                  session.station_id,

                station_name: stationName,

                shift_id:
                  session.shift_id,

                shift_name:
                  shift?.shift_name ??
                  'Shift not recorded',

                shift_date:
                  shift?.shift_date ??
                  session.started_at.slice(0, 10),

                scheduled_start:
                  shift?.scheduled_start ?? null,

                scheduled_end:
                  shift?.scheduled_end ?? null,

                user_id:
                  session.user_id,

                operator_name:
                  rosterMember?.full_name ??
                  'Unplanned operator',

                shift_role:
                  session.shift_role,

                started_at:
                  session.started_at,

                ended_at:
                  session.ended_at,

                status:
                  session.status,

                duration_minutes:
                  durationMinutes(
                    session.started_at,
                    session.ended_at
                  ),
              };
            })
            .sort(
              (a, b) =>
                new Date(
                  b.started_at
                ).getTime() -
                new Date(
                  a.started_at
                ).getTime()
            );

        const operators = new Map<string, string>();
        for (const row of allReportRows) {
          operators.set(row.user_id, row.operator_name);
        }
        setOperatorOptions(Array.from(operators, ([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label)));
        const reportRows = nextFilters.operatorId
          ? allReportRows.filter((row) => row.user_id === nextFilters.operatorId)
          : allReportRows;

        setLoadedReport({
          filters: nextFilters,
          total: reportRows.length,
        });

        setResource({
          rows: reportRows,
          loading: false,
          error: null,
          generatedAt: new Date(),
        });
      } catch (error) {
        if (generation !== requestGeneration.current) {
          return;
        }

        setLoadedReport(null);

        setResource((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to generate the Shift Attendance report.',
        }));
      }
    },
    [stations]
  );

  const generate = useCallback(() => {
    if (resource.loading) {
      return;
    }

    void loadReport(filters);
  }, [
    filters,
    loadReport,
    resource.loading,
  ]);

  const columns =
    useMemo<
      ReportColumn<AttendanceReportRow>[]
    >(
      () => [
        {
          id: 'date',
          label: 'Shift date',
          value: (row) =>
            formatDate(row.shift_date),
          csvValue: (row) =>
            formatDate(row.shift_date),
        },
        {
          id: 'shift',
          label: 'Shift',
          value: (row) =>
            row.shift_name,
          csvValue: (row) =>
            row.shift_name,
        },
        {
          id: 'operator',
          label: 'Operator',
          value: (row) =>
            row.operator_name,
          csvValue: (row) =>
            row.operator_name,
        },
        {
          id: 'role',
          label: 'Duty role',
          value: (row) =>
            roleLabel(row.shift_role),
          csvValue: (row) =>
            roleLabel(row.shift_role),
        },
        {
          id: 'start',
          label: 'Start duty (IST)',
          value: (row) =>
            formatIst(row.started_at),
          csvValue: (row) =>
            formatIst(row.started_at),
        },
        {
          id: 'end',
          label: 'End duty (IST)',
          value: (row) =>
            row.ended_at
              ? formatIst(row.ended_at)
              : 'Not ended',
          csvValue: (row) =>
            row.ended_at
              ? formatIst(row.ended_at)
              : 'Not ended',
        },
        {
          id: 'duration',
          label: 'Duration',
          value: (row) =>
            durationText(
              row.duration_minutes
            ),
          csvValue: (row) =>
            durationText(
              row.duration_minutes
            ),
        },
        {
          id: 'status',
          label: 'Status',
          value: (row) => (
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                row.status === 'ENDED'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-100 text-blue-700'
              }`}
            >
              {row.status === 'ENDED'
                ? 'ENDED'
                : 'ON DUTY'}
            </span>
          ),
          csvValue: (row) =>
            row.status,
        },
      ],
      []
    );

  const summaryCards =
    useMemo<ReportSummaryCard[]>(() => {
      if (!loadedReport) {
        return [];
      }

      const rows = resource.rows;

      const operators =
        new Set(
          rows.map(
            (row) => row.user_id
          )
        ).size;

      const shifts =
        new Set(
          rows.map(
            (row) => row.shift_id
          )
        ).size;

      const completed =
        rows.filter(
          (row) =>
            row.status === 'ENDED'
        ).length;

      const onDuty =
        rows.filter(
          (row) =>
            row.status === 'ON_DUTY'
        ).length;

      return [
        {
          label: 'Attendance records',
          value: String(rows.length),
          tone: 'blue',
        },
        {
          label: 'Operators',
          value: String(operators),
          tone: 'slate',
        },
        {
          label: 'Shifts covered',
          value: String(shifts),
          tone: 'orange',
        },
        {
          label: 'Completed duty',
          value: String(completed),
          tone: 'green',
        },
        {
          label: 'Currently on duty',
          value: String(onDuty),
          tone:
            onDuty > 0
              ? 'orange'
              : 'slate',
        },
      ];
    }, [
      loadedReport,
      resource.rows,
    ]);

  const activeFilters =
    loadedReport?.filters ?? filters;

  const stationScope =
    activeFilters.stationId
      ? stations.find(
          (station) =>
            station.id ===
            activeFilters.stationId
        )?.name ??
        'Selected station'
      : 'Select station';

  /*
   * All report rows are already loaded because the existing
   * attendance RPC is day-based rather than paginated.
   * ReportActions can therefore use the current result set
   * directly for complete PDF/CSV generation.
   */
  const loadAllRows =
    useCallback(async () => {
      return resource.rows;
    }, [resource.rows]);

  return (
    <ReportPageShell
      title="Shift Attendance Report"
      subtitle="Operator duty attendance and shift participation"
      onBack={onBack}
      contentRef={contentRef}
      desktopWide
      actions={
        <ReportActions
          title="Shift Attendance Report"
          contentRef={contentRef}
          rows={resource.rows}
          columns={columns}
          disabled={
            resource.loading ||
            !loadedReport
          }
          primaryPdf
          totalRows={
            loadedReport?.total ??
            resource.rows.length
          }
          loadAllRows={loadAllRows}
        />
      }
      filters={
        <ReportFilters
          values={filters}
         options={{
         stations,
            feeders: [],
            operatorOptions,
            }}
          generating={resource.loading}
          onChange={setFilters}
          onGenerate={generate}
          desktopLayout
        />
      }
    >
      {loadedReport ? (
        <>
          <ReportPreview
            meta={{
              title:
                'Shift Attendance Report',

              stationScope,

              periodLabel:
                getReportPeriodLabel(
                  activeFilters
                ),

              generatedAt:
                resource.generatedAt ??
                new Date(),

              appliedFilters: [
                `From ${activeFilters.fromDate}`,
                `To ${activeFilters.toDate}`,
                ...(activeFilters.operatorId
                  ? [`Operator ${operatorOptions.find((option) => option.value === activeFilters.operatorId)?.label ?? 'Selected operator'}`]
                  : []),
              ],
            }}
            summaryCards={
              summaryCards
            }
            resource={resource}
            columns={columns}
            rowKey={(row) =>
              row.id
            }
            onRetry={generate}
            desktopTable
          />

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 text-blue-700" />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Period
                  </p>

                  <p className="mt-1 text-xs font-semibold text-slate-800">
                    {getReportPeriodLabel(
                      activeFilters
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <UserRoundCheck className="mt-0.5 h-4 w-4 text-blue-700" />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Attendance
                  </p>

                  <p className="mt-1 text-xs font-semibold text-slate-800">
                    {
                      resource.rows
                        .length
                    }{' '}
                    duty records
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Completed
                  </p>

                  <p className="mt-1 text-xs font-semibold text-slate-800">
                    {
                      resource.rows.filter(
                        (row) =>
                          row.status ===
                          'ENDED'
                      ).length
                    }{' '}
                    records
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 text-orange-700" />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Open duty
                  </p>

                  <p className="mt-1 text-xs font-semibold text-slate-800">
                    {
                      resource.rows.filter(
                        (row) =>
                          row.status ===
                          'ON_DUTY'
                      ).length
                    }{' '}
                    records
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="py-8 text-center text-sm text-slate-500">
          Select a station and
          period, then generate the
          report.
        </div>
      )}
    </ReportPageShell>
  );
}
