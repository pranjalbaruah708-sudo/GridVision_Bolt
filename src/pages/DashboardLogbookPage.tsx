import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ArrowLeft,
  CalendarDays,
  Home,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
  CircleDot,
} from 'lucide-react';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

import { useApp } from '@/context/AppContext';
import { api } from '@/services/api';

/* =========================================================
   DATE OPTIONS
========================================================= */

const DATE_OPTIONS = [
  'Today',
  'Yesterday',
  'Last 7 Days',
];

/* =========================================================
   TYPES
========================================================= */

type FillStatus =
  | 'EMPTY'
  | 'PARTIAL'
  | 'FULL';

type AppRole =
  | 'OPERATOR'
  | 'FIELD_OFFICER'
  | 'ADMIN';

type LoadReading = {
  station_id: string;
  feeder_id: string | null;
  actual_event_time: string;
  mw: number | null;
};

type HourStatus = {
  hour: number;
  entered: number;
  total: number;
  status: FillStatus;
};

type HourlyLoad = {
  hour: number;
  label: string;

  /*
   * NULL means that no feeder entry exists
   * for this hour.
   *
   * Actual 0 MW remains numeric 0 and is
   * therefore treated as a genuine reading.
   */
  mw: number | null;

  /*
   * Invisible helper series.
   *
   * This lets Recharts show the tooltip
   * even when mw = null.
   */
  tooltipValue: number;

  entered: number;
  total: number;

  status: FillStatus;
};

/* =========================================================
   HELPERS
========================================================= */

function pad2(
  value: number
): string {
  return String(value).padStart(
    2,
    '0'
  );
}

/* =========================================================
   TODAY IN INDIA
========================================================= */

function getTodayIST(): string {
  const formatter =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Asia/Kolkata',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      }
    );

  const parts =
    formatter.formatToParts(
      new Date()
    );

  const year =
    parts.find(
      (part) =>
        part.type ===
        'year'
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        'month'
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        'day'
    )?.value;

  return `${year}-${month}-${day}`;
}

/* =========================================================
   CURRENT IST HOUR
========================================================= */

function getCurrentHourIST(): number {
  const hour =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'Asia/Kolkata',

        hour:
          '2-digit',

        hourCycle:
          'h23',
      }
    ).format(
      new Date()
    );

  return Number(hour);
}

/* =========================================================
   GET IST HOUR FROM TIMESTAMPTZ
========================================================= */

function getHourIST(
  timestamp: string
): number {
  const hour =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'Asia/Kolkata',

        hour:
          '2-digit',

        hourCycle:
          'h23',
      }
    ).format(
      new Date(timestamp)
    );

  return Number(hour);
}

/* =========================================================
   BUILD ALL-STATIONS COMPLETION STATUS

   Used when FIELD_OFFICER / ADMIN selects
   "All Stations".

   An hour is:

   FULL
   → every active feeder has an entry

   PARTIAL
   → at least one feeder has an entry,
     but not every feeder

   EMPTY
   → no feeder has an entry
========================================================= */

function buildAllStationsHourStatus(
  readings: LoadReading[],
  feederIds: string[]
): HourStatus[] {
  const totalFeeders =
    new Set(
      feederIds
    ).size;

  const entriesByHour =
    new Map<
      number,
      Set<string>
    >();

  for (
    const reading of
    readings
  ) {
    if (
      !reading.feeder_id
    ) {
      continue;
    }

    const hour =
      getHourIST(
        reading.actual_event_time
      );

    let feederSet =
      entriesByHour.get(
        hour
      );

    if (
      !feederSet
    ) {
      feederSet =
        new Set<string>();

      entriesByHour.set(
        hour,
        feederSet
      );
    }

    feederSet.add(
      reading.feeder_id
    );
  }

  return Array.from(
    {
      length: 24,
    },
    (
      _,
      hour
    ) => {
      const entered =
        entriesByHour.get(
          hour
        )?.size ??
        0;

      let status:
        FillStatus =
          'EMPTY';

      if (
        entered === 0
      ) {
        status =
          'EMPTY';
      } else if (
        totalFeeders > 0 &&
        entered >=
          totalFeeders
      ) {
        status =
          'FULL';
      } else {
        status =
          'PARTIAL';
      }

      return {
        hour,
        entered,
        total:
          totalFeeders,
        status,
      };
    }
  );
}

/* =========================================================
   CUSTOM GRAPH DOT

   FULL     = blue
   PARTIAL  = orange
   EMPTY    = no dot
========================================================= */

function LoadTrendDot(
  props: any
) {
  const {
    cx,
    cy,
    payload,
  } = props;

  if (
    typeof cx !==
      'number' ||
    typeof cy !==
      'number'
  ) {
    return null;
  }

  const row =
    payload as HourlyLoad;

  /* EMPTY */

  if (
    row.status ===
    'EMPTY'
  ) {
    return null;
  }

  /* PARTIAL */

  if (
    row.status ===
    'PARTIAL'
  ) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="#F59E0B"
        stroke="#FFFFFF"
        strokeWidth={2}
      />
    );
  }

  /* FULL */

  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill="#2563EB"
      stroke="#FFFFFF"
      strokeWidth={1.5}
    />
  );
}

/* =========================================================
   CUSTOM TOOLTIP
========================================================= */

function LoadTrendTooltip({
  active,
  payload,
  label,
}: any) {
  if (
    !active ||
    !payload ||
    payload.length ===
      0
  ) {
    return null;
  }

  const row =
    payload[0]
      ?.payload as
      HourlyLoad;

  if (!row) {
    return null;
  }

  return (
    <div
      style={{
        minWidth:
          145,

        background:
          '#FFFFFF',

        border:
          '1px solid #E2E8F0',

        borderRadius:
          12,

        padding:
          '10px 12px',

        boxShadow:
          '0 8px 20px rgba(15,23,42,.12)',
      }}
    >
      <div
        style={{
          fontSize:
            11,

          fontWeight:
            700,

          color:
            '#475569',
        }}
      >
        {label} Hrs
      </div>

      {/* EMPTY */}

      {row.status ===
      'EMPTY' ? (
        <>
          <div
            style={{
              marginTop:
                5,

              fontSize:
                12,

              fontWeight:
                700,

              color:
                '#111827',
            }}
          >
            No feeder data
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                10,

              color:
                '#64748B',
            }}
          >
            No MW data has been entered for any feeder during this hour.
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              marginTop:
                5,

              fontSize:
                15,

              fontWeight:
                800,

              color:
                '#1D4ED8',
            }}
          >
            {Number(
              row.mw ?? 0
            ).toFixed(
              2
            )}{' '}
            MW
          </div>

          <div
            style={{
              marginTop:
                5,

              fontSize:
                10,

              fontWeight:
                700,

              color:
                row.status ===
                'FULL'
                  ? '#059669'
                  : '#D97706',
            }}
          >
            {row.status ===
            'FULL'
              ? 'All feeder data entered'
              : 'Partial feeder data'}
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                10,

              color:
                '#64748B',
            }}
          >
            {row.entered} of{' '}
            {row.total}{' '}
            feeders entered
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export function DashboardLogbookPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const {
    stations,
    activeStationId,
  } = useApp();

  /* =======================================================
     USER ROLE
  ======================================================= */

  const [
    userRole,
    setUserRole,
  ] = useState<
    AppRole | null
  >(null);

  const [
    roleLoading,
    setRoleLoading,
  ] = useState(
    true
  );

  /* =======================================================
     DASHBOARD STATION FILTER

     IMPORTANT:

     This is local to DashboardLogbookPage.

     We deliberately do NOT put "ALL" into the
     application's global activeStationId.
  ======================================================= */

  const [
    dashboardStationId,
    setDashboardStationId,
  ] = useState(
    ''
  );

  /* =======================================================
     DATE FILTER
     Present dashboard UI retained.
  ======================================================= */

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(
    'Today'
  );

  /* =======================================================
     TREND DATA
  ======================================================= */

  const [
    loadReadings,
    setLoadReadings,
  ] = useState<
    LoadReading[]
  >([]);

  const [
    hourStatuses,
    setHourStatuses,
  ] = useState<
    HourStatus[]
  >([]);

  const [
    trendLoading,
    setTrendLoading,
  ] = useState(
    false
  );

  const [
    trendError,
    setTrendError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     LOAD ROLE
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadRole() {
      setRoleLoading(
        true
      );

      try {
        const role =
          await api.getMyRole();

        if (
          cancelled
        ) {
          return;
        }

        setUserRole(
          role
        );
      } catch (e) {
        console.error(
          'Failed to determine dashboard role:',
          e
        );

        if (
          !cancelled
        ) {
          setUserRole(
            null
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setRoleLoading(
            false
          );
        }
      }
    }

    void loadRole();

    return () => {
      cancelled =
        true;
    };
  }, []);

  /* =======================================================
     DEFAULT DASHBOARD STATION

     OFFICER / ADMIN
     → ALL

     OPERATOR
     → assigned/current station
  ======================================================= */

  useEffect(() => {
    if (
      roleLoading ||
      !userRole
    ) {
      return;
    }

    if (
      userRole ===
        'FIELD_OFFICER' ||
      userRole ===
        'ADMIN'
    ) {
      setDashboardStationId(
        'ALL'
      );

      return;
    }

    if (
      userRole ===
      'OPERATOR'
    ) {
      setDashboardStationId(
        activeStationId ||
          stations[0]?.id ||
          ''
      );
    }
  }, [
    roleLoading,
    userRole,
    activeStationId,
    stations,
  ]);

  /* =======================================================
     CAN USER VIEW ALL?
  ======================================================= */

  const canViewAllStations =
    userRole ===
      'FIELD_OFFICER' ||
    userRole ===
      'ADMIN';

  /* =======================================================
     LOAD TREND
  ======================================================= */

  const loadTrend =
    useCallback(
      async () => {
        if (
          !dashboardStationId
        ) {
          setLoadReadings(
            []
          );

          setHourStatuses(
            []
          );

          return;
        }

        setTrendLoading(
          true
        );

        setTrendError(
          null
        );

        try {
          const today =
            getTodayIST();

          const isAllStations =
            dashboardStationId ===
            'ALL';

          /* ===============================================
             ALL STATIONS
          ================================================ */

          if (
            isAllStations
          ) {
            const [
              readings,
              allFeeders,
            ] =
              await Promise.all([
                api.getStationLoadTrend(
                  null,
                  today
                ),

                api.getFeeders(),
              ]);

            const typedReadings =
              readings as
                LoadReading[];

            /*
             * Ignore feeder records explicitly marked
             * inactive when active is available.
             *
             * If active is undefined in the current type/
             * database response, the feeder is retained.
             */

            const activeFeederIds =
              allFeeders
                .filter(
                  (
                    feeder
                  ) =>
                    feeder.active !==
                    false
                )
                .map(
                  (
                    feeder
                  ) =>
                    feeder.id
                );

            const statuses =
              buildAllStationsHourStatus(
                typedReadings,
                activeFeederIds
              );

            setLoadReadings(
              typedReadings
            );

            setHourStatuses(
              statuses
            );

            return;
          }

          /* ===============================================
             SINGLE STATION
          ================================================ */

          const [
            readings,
            statuses,
          ] =
            await Promise.all([
              api.getStationLoadTrend(
                dashboardStationId,
                today
              ),

              api.getOperatorDayHourStatus(
                dashboardStationId,
                today
              ),
            ]);

          setLoadReadings(
            readings as
              LoadReading[]
          );

          setHourStatuses(
            statuses as
              HourStatus[]
          );
        } catch (e) {
          console.error(
            'Failed to load station load trend:',
            e
          );

          setLoadReadings(
            []
          );

          setHourStatuses(
            []
          );

          setTrendError(
            e instanceof Error
              ? e.message
              : 'Failed to load station load trend.'
          );
        } finally {
          setTrendLoading(
            false
          );
        }
      },
      [
        dashboardStationId,
      ]
    );

  useEffect(() => {
    void loadTrend();
  }, [
    loadTrend,
  ]);

  /* =======================================================
     STATUS LOOKUP
  ======================================================= */

  const hourStatusMap =
    useMemo(
      () => {
        const map =
          new Map<
            number,
            HourStatus
          >();

        for (
          const status of
          hourStatuses
        ) {
          map.set(
            Number(
              status.hour
            ),
            status
          );
        }

        return map;
      },
      [
        hourStatuses,
      ]
    );

  /* =======================================================
     SUM MW BY HOUR

     For one station:
     → sum all feeders in that station.

     For ALL:
     → loadReadings contains entries from every station,
       therefore this same calculation sums every feeder
       of every station.
  ======================================================= */

  const hourlyLoad =
    useMemo<
      HourlyLoad[]
    >(
      () => {
        const currentHour =
          getCurrentHourIST();

        const totals =
          new Map<
            number,
            number
          >();

        for (
          const reading of
          loadReadings
        ) {
          const hour =
            getHourIST(
              reading.actual_event_time
            );

          if (
            hour >
            currentHour
          ) {
            continue;
          }

          if (
            reading.mw ===
              null ||
            reading.mw ===
              undefined
          ) {
            continue;
          }

          totals.set(
            hour,
            (
              totals.get(
                hour
              ) ?? 0
            ) +
              Number(
                reading.mw
              )
          );
        }

        return Array.from(
          {
            length:
              currentHour +
              1,
          },

          (
            _,
            hour
          ) => {
            const status =
              hourStatusMap.get(
                hour
              );

            const fillStatus =
              status?.status ??
              'EMPTY';

            const mw =
              fillStatus ===
              'EMPTY'
                ? null
                : Number(
                    (
                      totals.get(
                        hour
                      ) ?? 0
                    ).toFixed(
                      2
                    )
                  );

            return {
              hour,

              label:
                `${pad2(
                  hour
                )}:00`,

              mw,

              /*
               * Invisible tooltip support.
               */
              tooltipValue:
                0,

              entered:
                status?.entered ??
                0,

              total:
                status?.total ??
                0,

              status:
                fillStatus,
            };
          }
        );
      },
      [
        loadReadings,
        hourStatusMap,
      ]
    );

  /* =======================================================
     PEAK LOAD
  ======================================================= */

  const peakData =
    useMemo(
      () => {
        const available =
          hourlyLoad.filter(
            (
              item
            ) =>
              item.mw !==
              null
          );

        if (
          available.length ===
          0
        ) {
          return null;
        }

        return available.reduce(
          (
            highest,
            current
          ) =>
            Number(
              current.mw
            ) >
            Number(
              highest.mw
            )
              ? current
              : highest
        );
      },
      [
        hourlyLoad,
      ]
    );

  const peakLoad =
    peakData?.mw ??
    0;

  const peakHour =
    peakData?.label ??
    '—';

  /* =======================================================
     DASHBOARD STATION NAME
  ======================================================= */

  const dashboardStationName =
    dashboardStationId ===
    'ALL'
      ? 'All Stations'
      : stations.find(
          (
            station
          ) =>
            station.id ===
            dashboardStationId
        )?.name ??
        'Station';

  /* =======================================================
     COMPLETION COUNTS
  ======================================================= */

  const fullHours =
    useMemo(
      () =>
        hourlyLoad.filter(
          (
            item
          ) =>
            item.status ===
            'FULL'
        ).length,
      [
        hourlyLoad,
      ]
    );

  const partialHours =
    useMemo(
      () =>
        hourlyLoad.filter(
          (
            item
          ) =>
            item.status ===
            'PARTIAL'
        ).length,
      [
        hourlyLoad,
      ]
    );

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div
      style={{
        minHeight:
          '100vh',

        background:
          '#EEF3F8',

        display:
          'flex',

        flexDirection:
          'column',
      }}
    >
      {/* ===================================================
          HEADER
      ==================================================== */}

      <div
        style={{
          background:
            'linear-gradient(135deg,#0D47A1,#1565C0)',

          color:
            'white',

          padding:
            '16px',

          paddingTop:
            '22px',

          borderBottomLeftRadius:
            '22px',

          borderBottomRightRadius:
            '22px',

          boxShadow:
            '0 4px 12px rgba(0,0,0,.18)',
        }}
      >
        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            justifyContent:
              'space-between',
          }}
        >
          <button
            type="button"

            onClick={
              onBack
            }

            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"

            aria-label="Back to Module Selection"
          >
            <ArrowLeft
              size={
                24
              }
            />
          </button>

          <h2
            style={{
              margin:
                0,

              fontSize:
                24,

              fontWeight:
                700,
            }}
          >
            Digital Log Book
          </h2>

          <CalendarDays
            size={
              24
            }
          />
        </div>
      </div>

      {/* ===================================================
          BODY
      ==================================================== */}

      <div
        style={{
          flex:
            1,

          overflowY:
            'auto',

          padding:
            16,

          paddingBottom:
            100,
        }}
      >
        {/* =================================================
            EXECUTIVE SUMMARY
        ================================================== */}

        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            justifyContent:
              'space-between',

            gap:
              12,

            marginBottom:
              14,
          }}
        >
          <div>
            <h2
              style={{
                margin:
                  0,

                fontSize:
                  16,

                fontWeight:
                  700,

                color:
                  '#1E293B',
              }}
            >
              Executive Summary
            </h2>

            <p
              style={{
                margin:
                  '3px 0 0',

                fontSize:
                  11,

                color:
                  '#64748B',
              }}
            >
              Current operational overview
            </p>
          </div>

          <select
            value={
              selectedDate
            }

            onChange={(
              e
            ) =>
              setSelectedDate(
                e.target.value
              )
            }

            style={{
              border:
                '1px solid #CBD5E1',

              borderRadius:
                12,

              padding:
                '9px 12px',

              background:
                '#ffffff',

              color:
                '#334155',

              fontSize:
                12,

              fontWeight:
                600,

              outline:
                'none',
            }}
          >
            {DATE_OPTIONS.map(
              (
                date
              ) => (
                <option
                  key={
                    date
                  }

                  value={
                    date
                  }
                >
                  {
                    date
                  }
                </option>
              )
            )}
          </select>
        </div>

        {/* =================================================
            STATION SELECTOR
        ================================================== */}

        <div
          style={{
            marginBottom:
              16,
          }}
        >
          <div
            style={{
              fontSize:
                10,

              textTransform:
                'uppercase',

              letterSpacing:
                '.08em',

              color:
                '#94A3B8',

              fontWeight:
                700,

              marginBottom:
                8,
            }}
          >
            Station
          </div>

          <div
            style={{
              display:
                'flex',

              gap:
                10,

              overflowX:
                'auto',

              paddingBottom:
                4,
            }}
          >
            {/* ALL STATIONS
                Officer/Admin only */}

            {canViewAllStations && (
              <button
                type="button"

                onClick={() =>
                  setDashboardStationId(
                    'ALL'
                  )
                }

                style={{
                  border:
                    'none',

                  outline:
                    'none',

                  cursor:
                    'pointer',

                  whiteSpace:
                    'nowrap',

                  padding:
                    '9px 16px',

                  borderRadius:
                    22,

                  fontWeight:
                    600,

                  fontSize:
                    12,

                  transition:
                    '.25s',

                  background:
                    dashboardStationId ===
                    'ALL'
                      ? '#1565C0'
                      : '#ffffff',

                  color:
                    dashboardStationId ===
                    'ALL'
                      ? '#ffffff'
                      : '#475569',

                  boxShadow:
                    dashboardStationId ===
                    'ALL'
                      ? '0 3px 8px rgba(21,101,192,.25)'
                      : '0 2px 6px rgba(0,0,0,.06)',
                }}
              >
                All Stations
              </button>
            )}

            {stations.map(
              (
                station
              ) => (
                <button
                  key={
                    station.id
                  }

                  type="button"

                  onClick={() =>
                    setDashboardStationId(
                      station.id
                    )
                  }

                  style={{
                    border:
                      'none',

                    outline:
                      'none',

                    cursor:
                      'pointer',

                    whiteSpace:
                      'nowrap',

                    padding:
                      '9px 16px',

                    borderRadius:
                      22,

                    fontWeight:
                      600,

                    fontSize:
                      12,

                    transition:
                      '.25s',

                    background:
                      dashboardStationId ===
                      station.id
                        ? '#1565C0'
                        : '#ffffff',

                    color:
                      dashboardStationId ===
                      station.id
                        ? '#ffffff'
                        : '#475569',

                    boxShadow:
                      dashboardStationId ===
                      station.id
                        ? '0 3px 8px rgba(21,101,192,.25)'
                        : '0 2px 6px rgba(0,0,0,.06)',
                  }}
                >
                  {
                    station.name
                  }
                </button>
              )
            )}
          </div>
        </div>

        {/* =================================================
            KPI CARDS
        ================================================== */}

        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={
              <Home className="h-5 w-5 text-slate-600" />
            }

            label="Total Stations"

            value={String(
              stations.length
            )}

            tone="slate"
          />

          <MetricCard
            icon={
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            }

            label="Online Stations"

            value="34"

            tone="green"
          />

          <MetricCard
            icon={
              <AlertTriangle className="h-5 w-5 text-red-500" />
            }

            label="Active Alarms"

            value="7"

            tone="red"
          />

          <MetricCard
            icon={
              <Zap className="h-5 w-5 text-blue-600" />
            }

            label="Peak Load Today"

            value={`${Number(
              peakLoad
            ).toFixed(
              2
            )} MW`}

            tone="blue"
          />

          <MetricCard
            icon={
              <Activity className="h-5 w-5 text-orange-500" />
            }

            label="Today's Interruptions"

            value="5"

            tone="orange"
          />

          <MetricCard
            icon={
              <CircleDot className="h-5 w-5 text-violet-500" />
            }

            label="Overloaded Feeders"

            value="3"

            tone="violet"
          />
        </div>

        {/* =================================================
            PEAK LOAD TREND
        ================================================== */}

        <DashboardCard
          title="Peak Load Trend (MW)"
          subtitle={`Hourly summed feeder load — ${dashboardStationName}`}
        >
          <div
            style={{
              display:
                'flex',

              flexWrap:
                'wrap',

              gap:
                12,

              marginBottom:
                12,

              fontSize:
                10,

              fontWeight:
                700,

              color:
                '#64748B',
            }}
          >
            <ChartLegend
              color="#2563EB"
              label="Complete"
            />

            <ChartLegend
              color="#F59E0B"
              label="Partial"
            />

            <ChartLegend
              color="#CBD5E1"
              label="No Data"
              hollow
            />
          </div>

          <div className="rounded-2xl bg-slate-50 px-2 py-4">
            {trendLoading ? (
              <div className="flex h-56 items-center justify-center text-xs font-semibold text-slate-400">
                Loading hourly load data…
              </div>
            ) : trendError ? (
              <div className="flex h-56 items-center justify-center px-4 text-center text-xs font-semibold text-red-500">
                {trendError}
              </div>
            ) : (
              <div
                style={{
                  width:
                    '100%',

                  height:
                    240,
                }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <AreaChart
                    data={
                      hourlyLoad
                    }

                    margin={{
                      top:
                        10,

                      right:
                        8,

                      left:
                        -10,

                      bottom:
                        0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="dashboardLoadGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#2563EB"
                          stopOpacity={
                            0.28
                          }
                        />

                        <stop
                          offset="95%"
                          stopColor="#2563EB"
                          stopOpacity={
                            0
                          }
                        />
                      </linearGradient>
                    </defs>

                    <CartesianGrid
                      strokeDasharray="3 3"

                      vertical={
                        false
                      }

                      stroke="#E2E8F0"
                    />

                    <XAxis
                      dataKey="label"

                      tickLine={
                        false
                      }

                      axisLine={
                        false
                      }

                      fontSize={
                        9
                      }

                      interval={
                        hourlyLoad.length >
                        12
                          ? 2
                          : 0
                      }
                    />

                    <YAxis
                      tickLine={
                        false
                      }

                      axisLine={
                        false
                      }

                      fontSize={
                        9
                      }

                      width={
                        48
                      }

                      tickFormatter={(
                        value
                      ) =>
                        Number(
                          value
                        ).toFixed(
                          0
                        )
                      }
                    />

                    <Tooltip
                      content={
                        <LoadTrendTooltip />
                      }
                    />

                    {/* Invisible tooltip helper */}

                    <Area
                      type="linear"

                      dataKey="tooltipValue"

                      stroke="transparent"

                      fill="transparent"

                      strokeWidth={
                        0
                      }

                      dot={
                        false
                      }

                      activeDot={
                        false
                      }

                      isAnimationActive={
                        false
                      }
                    />

                    {/* Real MW curve */}

                    <Area
                      type="monotone"

                      dataKey="mw"

                      stroke="#2563EB"

                      strokeWidth={
                        3
                      }

                      fill="url(#dashboardLoadGradient)"

                      connectNulls={
                        true
                      }

                      dot={
                        <LoadTrendDot />
                      }

                      activeDot={{
                        r:
                          6,

                        strokeWidth:
                          2,

                        stroke:
                          '#FFFFFF',
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* LOAD SUMMARY */}

            <div
              style={{
                marginTop:
                  10,

                display:
                  'grid',

                gridTemplateColumns:
                  'repeat(3,1fr)',

                gap:
                  8,

                borderTop:
                  '1px solid #E2E8F0',

                paddingTop:
                  12,
              }}
            >
              <TrendSummary
                label="Peak Load"

                value={`${Number(
                  peakLoad
                ).toFixed(
                  2
                )} MW`}

                color="#1D4ED8"
              />

              <TrendSummary
                label="Peak Hour"

                value={
                  peakHour
                }
              />

              <TrendSummary
                label="Complete Hours"

                value={`${fullHours}`}

                color="#059669"
              />
            </div>

            {partialHours >
              0 && (
              <div
                style={{
                  marginTop:
                    10,

                  padding:
                    '8px 10px',

                  borderRadius:
                    10,

                  background:
                    '#FFFBEB',

                  border:
                    '1px solid #FDE68A',

                  color:
                    '#92400E',

                  fontSize:
                    10,

                  lineHeight:
                    1.4,

                  fontWeight:
                    600,
                }}
              >
                {partialHours}{' '}
                hour
                {partialHours ===
                1
                  ? ''
                  : 's'}{' '}
                contain partial feeder data. Orange points therefore represent incomplete station-load totals.
              </div>
            )}
          </div>
        </DashboardCard>

        {/* =================================================
            VOLTAGE STATUS
        ================================================== */}

        <DashboardCard
          title="Voltage Status"
          subtitle="Voltage compliance across monitored points"
        >
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative h-40 w-40 flex-shrink-0">
              <svg
                viewBox="0 0 120 120"

                className="h-full w-full"
              >
                <circle
                  cx="60"
                  cy="60"
                  r="40"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="16"
                />

                <circle
                  cx="60"
                  cy="60"
                  r="40"
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="16"
                  strokeDasharray="231 251"
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                />

                <circle
                  cx="60"
                  cy="60"
                  r="40"
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="16"
                  strokeDasharray="15 251"
                  strokeDashoffset="-231"
                  transform="rotate(-90 60 60)"
                />

                <circle
                  cx="60"
                  cy="60"
                  r="40"
                  fill="none"
                  stroke="#f87171"
                  strokeWidth="16"
                  strokeDasharray="5 251"
                  strokeDashoffset="-246"
                  transform="rotate(-90 60 60)"
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-gray-900">
                  92%
                </span>

                <span className="text-[10px] text-gray-400">
                  Normal
                </span>
              </div>
            </div>

            <div className="w-full flex-1 space-y-2">
              <StatusRow
                color="bg-emerald-500"
                title="Normal"
                label="92%"
                subtitle="0.95 - 1.05 p.u."
              />

              <StatusRow
                color="bg-orange-500"
                title="Low"
                label="6%"
                subtitle="< 0.95 p.u."
              />

              <StatusRow
                color="bg-red-500"
                title="High"
                label="2%"
                subtitle="> 1.05 p.u."
              />
            </div>
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}

/* =========================================================
   CHART LEGEND
========================================================= */

function ChartLegend({
  color,
  label,
  hollow = false,
}: {
  color: string;
  label: string;
  hollow?: boolean;
}) {
  return (
    <div
      style={{
        display:
          'flex',

        alignItems:
          'center',

        gap:
          5,
      }}
    >
      <span
        style={{
          width:
            9,

          height:
            9,

          borderRadius:
            '50%',

          background:
            hollow
              ? '#FFFFFF'
              : color,

          border:
            hollow
              ? `2px solid ${color}`
              : 'none',
        }}
      />

      {label}
    </div>
  );
}

/* =========================================================
   TREND SUMMARY
========================================================= */

function TrendSummary({
  label,
  value,
  color =
    '#334155',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        minWidth:
          0,
      }}
    >
      <div
        style={{
          fontSize:
            9,

          color:
            '#94A3B8',

          whiteSpace:
            'nowrap',
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            3,

          fontSize:
            12,

          fontWeight:
            800,

          color,

          overflow:
            'hidden',

          textOverflow:
            'ellipsis',

          whiteSpace:
            'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   DASHBOARD CARD
========================================================= */

function DashboardCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
        </h3>

        {subtitle && (
          <p className="mt-1 text-[11px] text-gray-500">
            {subtitle}
          </p>
        )}
      </div>

      {children}
    </div>
  );
}

/* =========================================================
   METRIC CARD
========================================================= */

function MetricCard({
  icon,
  label,
  value,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;

  tone?:
    | 'slate'
    | 'green'
    | 'red'
    | 'blue'
    | 'orange'
    | 'violet';
}) {
  const toneClasses:
    Record<
      string,
      string
    > = {
      slate:
        'text-slate-900',

      green:
        'text-emerald-600',

      red:
        'text-red-600',

      blue:
        'text-blue-600',

      orange:
        'text-orange-600',

      violet:
        'text-violet-600',
    };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-slate-50">
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-400">
            {label}
          </p>

          <p
            className={`mt-2 text-lg font-bold leading-none ${toneClasses[tone]}`}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   STATUS ROW
========================================================= */

function StatusRow({
  color,
  title,
  label,
  subtitle,
}: {
  color: string;
  title: string;
  label: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${color}`}
        />

        <div>
          <p className="text-xs font-semibold text-gray-800">
            {title}
          </p>

          <p className="text-[10px] text-gray-400">
            {subtitle}
          </p>
        </div>
      </div>

      <span className="text-xs font-bold text-gray-700">
        {label}
      </span>
    </div>
  );
}