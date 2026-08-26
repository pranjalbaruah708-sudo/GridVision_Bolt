import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  CSSProperties,
  ReactNode,
} from 'react';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock3,
  Network,
  Timer,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

import { api } from '@/services/api';
import { useApp } from '@/context/AppContext';

import type {
  Feeder,
  Interruption,
} from '@/types';

/* =========================================================
   CONSTANTS
========================================================= */

const periods = [
  '7 Days',
  '15 Days',
  '30 Days',
  '3 Months',
  'Custom',
] as const;

type Period =
  (typeof periods)[number];

type DateRange = {
  startDate: string;
  endDate: string;
};

type BucketMode =
  | 'DAY'
  | 'MONTH';

type TrendMetric =
  | 'COUNT'
  | 'DURATION';

type RankingMetric =
  | 'COUNT'
  | 'DURATION'
  | 'AVERAGE';

type CauseMetric =
  | 'COUNT'
  | 'DURATION';

const PIE_COLORS = [
  '#1976D2',
  '#14B8A6',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#64748B',
  '#10B981',
  '#EC4899',
];

/* =========================================================
   TYPES
========================================================= */

type FeederRow =
  Feeder & {
    active?: boolean;
  };

type StationStat = {
  stationId: string;
  stationName: string;
  count: number;
  durationMinutes: number;
  averageMinutes: number;
};

type FeederStat = {
  feederId: string;
  feederName: string;
  stationId: string;
  stationName: string;
  count: number;
  durationMinutes: number;
  averageMinutes: number;
};

type TrendPoint = {
  key: string;
  label: string;
  count: number;
  durationHours: number;
  durationMinutes: number;
};

type CausePoint = {
  name: string;
  count: number;
  durationMinutes: number;
};

type DurationBand = {
  name: string;
  count: number;
  percentage: number;
};

type RankedItem = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  secondaryText?: string;
};

/* =========================================================
   DATE HELPERS
========================================================= */

function pad2(
  value: number
): string {
  return String(
    value
  ).padStart(
    2,
    '0'
  );
}

function getTodayIST():
  string {
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

function parseDateOnly(
  value: string
): Date {
  const [
    year,
    month,
    day,
  ] =
    value
      .split('-')
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day
    )
  );
}

function dateToString(
  date: Date
): string {
  return [
    date.getUTCFullYear(),

    pad2(
      date.getUTCMonth() +
        1
    ),

    pad2(
      date.getUTCDate()
    ),
  ].join('-');
}

function addDays(
  value: string,
  days: number
): string {
  const date =
    parseDateOnly(
      value
    );

  date.setUTCDate(
    date.getUTCDate() +
      days
  );

  return dateToString(
    date
  );
}

function addYears(
  value: string,
  years: number
): string {
  const date =
    parseDateOnly(
      value
    );

  date.setUTCFullYear(
    date.getUTCFullYear() +
      years
  );

  return dateToString(
    date
  );
}

function daysBetween(
  startDate: string,
  endDate: string
): number {
  const start =
    parseDateOnly(
      startDate
    ).getTime();

  const end =
    parseDateOnly(
      endDate
    ).getTime();

  return Math.floor(
    (
      end -
      start
    ) /
      86_400_000
  ) + 1;
}

function formatDate(
  value: string
): string {
  return new Intl.DateTimeFormat(
    'en-IN',
    {
      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric',

      timeZone:
        'UTC',
    }
  ).format(
    parseDateOnly(
      value
    )
  );
}

function getPeriodRange(
  period: Period,
  customRange: DateRange
): DateRange {
  const today =
    getTodayIST();

  if (
    period ===
    'Custom'
  ) {
    return customRange;
  }

  if (
    period ===
    '7 Days'
  ) {
    return {
      startDate:
        addDays(
          today,
          -6
        ),

      endDate:
        today,
    };
  }

  if (
    period ===
    '15 Days'
  ) {
    return {
      startDate:
        addDays(
          today,
          -14
        ),

      endDate:
        today,
    };
  }

  if (
    period ===
    '30 Days'
  ) {
    return {
      startDate:
        addDays(
          today,
          -29
        ),

      endDate:
        today,
    };
  }

  const current =
    parseDateOnly(
      today
    );

  const start =
    new Date(
      Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth() -
          2,
        1
      )
    );

  return {
    startDate:
      dateToString(
        start
      ),

    endDate:
      today,
  };
}

function getBucketMode(
  period: Period,
  range: DateRange
): BucketMode {
  if (
    period ===
    '3 Months'
  ) {
    return 'MONTH';
  }

  if (
    period ===
      'Custom' &&
    daysBetween(
      range.startDate,
      range.endDate
    ) >
      31
  ) {
    return 'MONTH';
  }

  return 'DAY';
}

function timestampToISTDate(
  timestamp: string
): string {
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
      new Date(
        timestamp
      )
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

function getBucketKey(
  date:
    string,
  mode:
    BucketMode
): string {
  return mode ===
    'MONTH'
    ? date.slice(
        0,
        7
      )
    : date;
}

function getBucketLabel(
  date:
    string,
  mode:
    BucketMode
): string {
  const value =
    parseDateOnly(
      date
    );

  if (
    mode ===
    'MONTH'
  ) {
    return new Intl.DateTimeFormat(
      'en-IN',
      {
        month:
          'short',

        year:
          '2-digit',

        timeZone:
          'UTC',
      }
    ).format(
      value
    );
  }

  return new Intl.DateTimeFormat(
    'en-IN',
    {
      day:
        '2-digit',

      month:
        'short',

      timeZone:
        'UTC',
    }
  ).format(
    value
  );
}

function createBuckets(
  range:
    DateRange,
  mode:
    BucketMode
): Array<{
  key: string;
  label: string;
}> {
  const result:
    Array<{
      key: string;
      label: string;
    }> = [];

  if (
    mode ===
    'DAY'
  ) {
    let cursor =
      range.startDate;

    while (
      cursor <=
      range.endDate
    ) {
      result.push({
        key:
          cursor,

        label:
          getBucketLabel(
            cursor,
            'DAY'
          ),
      });

      cursor =
        addDays(
          cursor,
          1
        );
    }

    return result;
  }

  const start =
    parseDateOnly(
      range.startDate
    );

  const end =
    parseDateOnly(
      range.endDate
    );

  const cursor =
    new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        1
      )
    );

  const last =
    new Date(
      Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        1
      )
    );

  while (
    cursor <=
    last
  ) {
    const value =
      dateToString(
        cursor
      );

    result.push({
      key:
        value.slice(
          0,
          7
        ),

      label:
        getBucketLabel(
          value,
          'MONTH'
        ),
    });

    cursor.setUTCMonth(
      cursor.getUTCMonth() +
        1
    );
  }

  return result;
}

/* =========================================================
   INTERRUPTION HELPERS
========================================================= */

function getDurationMinutes(
  row:
    Interruption
): number {
  if (
    row.duration_minutes !==
      null &&
    row.duration_minutes !==
      undefined
  ) {
    return Math.max(
      0,
      Number(
        row.duration_minutes
      )
    );
  }

  const start =
    new Date(
      row.interruption_start
    ).getTime();

  const end =
    row.interruption_end
      ? new Date(
          row.interruption_end
        ).getTime()
      : Date.now();

  if (
    Number.isNaN(
      start
    ) ||
    Number.isNaN(
      end
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    (
      end -
      start
    ) /
      60_000
  );
}

function formatDuration(
  minutes:
    number
): string {
  const rounded =
    Math.max(
      0,
      Math.round(
        minutes
      )
    );

  const hours =
    Math.floor(
      rounded /
        60
    );

  const mins =
    rounded %
    60;

  return `${pad2(
    hours
  )}:${pad2(
    mins
  )}`;
}

function getCause(
  row:
    Interruption
): string {
  const cause =
    row.cause?.trim();

  return cause ||
    'Others';
}

function formatEventDate(
  timestamp:
    string
): string {
  return new Intl.DateTimeFormat(
    'en-IN',
    {
      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric',

      timeZone:
        'Asia/Kolkata',
    }
  ).format(
    new Date(
      timestamp
    )
  );
}

function formatEventTime(
  timestamp:
    string | null
): string {
  if (
    !timestamp
  ) {
    return 'Open';
  }

  return new Intl.DateTimeFormat(
    'en-IN',
    {
      hour:
        '2-digit',

      minute:
        '2-digit',

      hour12:
        false,

      timeZone:
        'Asia/Kolkata',
    }
  ).format(
    new Date(
      timestamp
    )
  );
}

function causeColor(
  cause:
    string
): string {
  const lower =
    cause.toLowerCase();

  if (
    lower.includes(
      'equipment'
    )
  ) {
    return '#DC2626';
  }

  if (
    lower.includes(
      'overload'
    )
  ) {
    return '#7C3AED';
  }

  if (
    lower.includes(
      'external'
    )
  ) {
    return '#F59E0B';
  }

  if (
    lower.includes(
      'schedule'
    )
  ) {
    return '#2563EB';
  }

  return '#64748B';
}

/* =========================================================
   MAIN
========================================================= */

export default function InterruptionAnalysis() {
  const {
    stations,
  } =
    useApp();

  /* =======================================================
     DATA
  ======================================================= */

  const [
    interruptions,
    setInterruptions,
  ] =
    useState<
      Interruption[]
    >([]);

  const [
    feeders,
    setFeeders,
  ] =
    useState<
      FeederRow[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  /* =======================================================
     GLOBAL FILTERS
  ======================================================= */

  const [
    selectedStationId,
    setSelectedStationId,
  ] =
    useState(
      'ALL'
    );

  const [
    period,
    setPeriod,
  ] =
    useState<Period>(
      '7 Days'
    );

  const [
    customRange,
    setCustomRange,
  ] =
    useState<DateRange>({
      startDate:
        addDays(
          getTodayIST(),
          -6
        ),

      endDate:
        getTodayIST(),
    });

  const [
    customOpen,
    setCustomOpen,
  ] =
    useState(
      false
    );

  const [
    modalStartDate,
    setModalStartDate,
  ] =
    useState(
      ''
    );

  const [
    modalEndDate,
    setModalEndDate,
  ] =
    useState(
      ''
    );

  const [
    modalError,
    setModalError,
  ] =
    useState(
      ''
    );

  /* =======================================================
     VIEW MODES
  ======================================================= */

  const [
    trendMetric,
    setTrendMetric,
  ] =
    useState<TrendMetric>(
      'COUNT'
    );

  const [
    stationMetric,
    setStationMetric,
  ] =
    useState<RankingMetric>(
      'COUNT'
    );

  const [
    causeMetric,
    setCauseMetric,
  ] =
    useState<CauseMetric>(
      'COUNT'
    );

  const [
    feederMetric,
    setFeederMetric,
  ] =
    useState<RankingMetric>(
      'COUNT'
    );

  /* =======================================================
     DRILL DOWN
  ======================================================= */

  const [
    drillStationId,
    setDrillStationId,
  ] =
    useState(
      ''
    );

  const [
    selectedFeederId,
    setSelectedFeederId,
  ] =
    useState(
      ''
    );

  /* =======================================================
     LOAD DATA ONCE
  ======================================================= */

  const loadData =
    useCallback(
      async () => {
        setLoading(
          true
        );

        setError(
          null
        );

        try {
          const [
            interruptionRows,
            feederRows,
          ] =
            await Promise.all([
              api.getInterruptions(),
              api.getFeeders(),
            ]);

          setInterruptions(
            interruptionRows
          );

          setFeeders(
            feederRows as
              FeederRow[]
          );
        } catch (e) {
          console.error(
            'Failed to load interruption analysis:',
            e
          );

          setError(
            e instanceof Error
              ? e.message
              : 'Failed to load interruption analysis.'
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(() => {
    void loadData();
  }, [
    loadData,
  ]);

  /* =======================================================
     LOOKUPS
  ======================================================= */

  const stationNameMap =
    useMemo(
      () =>
        new Map(
          stations.map(
            (
              station
            ) => [
              station.id,
              station.name,
            ]
          )
        ),
      [
        stations,
      ]
    );

  const feederMap =
    useMemo(
      () =>
        new Map(
          feeders.map(
            (
              feeder
            ) => [
              feeder.id,
              feeder,
            ]
          )
        ),
      [
        feeders,
      ]
    );

  /* =======================================================
     DATE RANGE
  ======================================================= */

  const range =
    useMemo(
      () =>
        getPeriodRange(
          period,
          customRange
        ),
      [
        period,
        customRange,
      ]
    );

  const bucketMode =
    useMemo(
      () =>
        getBucketMode(
          period,
          range
        ),
      [
        period,
        range,
      ]
    );

  /* =======================================================
     VALID PERIOD DATA

     Cancelled interruptions are excluded.
  ======================================================= */

  const periodRows =
    useMemo(
      () =>
        interruptions.filter(
          (
            row
          ) => {
            if (
              row.current_status ===
              'CANCELLED'
            ) {
              return false;
            }

            const date =
              timestampToISTDate(
                row.interruption_start
              );

            return (
              date >=
                range.startDate &&
              date <=
                range.endDate
            );
          }
        ),
      [
        interruptions,
        range,
      ]
    );

  /* =======================================================
     CURRENT GLOBAL SCOPE
  ======================================================= */

  const filteredRows =
    useMemo(
      () => {
        if (
          selectedStationId ===
          'ALL'
        ) {
          return periodRows;
        }

        return periodRows.filter(
          (
            row
          ) =>
            row.station_id ===
            selectedStationId
        );
      },
      [
        periodRows,
        selectedStationId,
      ]
    );

  /* =======================================================
     EXECUTIVE SUMMARY
  ======================================================= */

  const summary =
    useMemo(
      () => {
        const totalDuration =
          filteredRows.reduce(
            (
              sum,
              row
            ) =>
              sum +
              getDurationMinutes(
                row
              ),
            0
          );

        const stationsAffected =
          new Set(
            filteredRows.map(
              (
                row
              ) =>
                row.station_id
            )
          ).size;

        const feedersAffected =
          new Set(
            filteredRows
              .map(
                (
                  row
                ) =>
                  row.feeder_id
              )
              .filter(
                (
                  value
                ):
                  value is string =>
                    Boolean(
                      value
                    )
              )
          ).size;

        const open =
          filteredRows.filter(
            (
              row
            ) =>
              row.current_status ===
              'OPEN'
          ).length;

        return {
          total:
            filteredRows.length,

          totalDuration,

          averageDuration:
            filteredRows.length >
            0
              ? totalDuration /
                filteredRows.length
              : 0,

          stationsAffected,

          feedersAffected,

          open,
        };
      },
      [
        filteredRows,
      ]
    );

  /* =======================================================
     TREND
  ======================================================= */

  const trendData =
    useMemo<
      TrendPoint[]
    >(
      () => {
        const buckets =
          createBuckets(
            range,
            bucketMode
          );

        const map =
          new Map<
            string,
            {
              count: number;
              durationMinutes: number;
            }
          >();

        for (
          const row of
          filteredRows
        ) {
          const date =
            timestampToISTDate(
              row.interruption_start
            );

          const key =
            getBucketKey(
              date,
              bucketMode
            );

          const current =
            map.get(
              key
            ) ?? {
              count:
                0,

              durationMinutes:
                0,
            };

          current.count +=
            1;

          current.durationMinutes +=
            getDurationMinutes(
              row
            );

          map.set(
            key,
            current
          );
        }

        return buckets.map(
          (
            bucket
          ) => {
            const value =
              map.get(
                bucket.key
              ) ?? {
                count:
                  0,

                durationMinutes:
                  0,
              };

            return {
              key:
                bucket.key,

              label:
                bucket.label,

              count:
                value.count,

              durationMinutes:
                value.durationMinutes,

              durationHours:
                Number(
                  (
                    value.durationMinutes /
                    60
                  ).toFixed(
                    2
                  )
                ),
            };
          }
        );
      },
      [
        filteredRows,
        range,
        bucketMode,
      ]
    );

  /* =======================================================
     STATION STATISTICS
  ======================================================= */

  const stationStats =
    useMemo<
      StationStat[]
    >(
      () => {
        const map =
          new Map<
            string,
            {
              count: number;
              durationMinutes: number;
            }
          >();

        for (
          const row of
          filteredRows
        ) {
          const current =
            map.get(
              row.station_id
            ) ?? {
              count:
                0,

              durationMinutes:
                0,
            };

          current.count +=
            1;

          current.durationMinutes +=
            getDurationMinutes(
              row
            );

          map.set(
            row.station_id,
            current
          );
        }

        return Array.from(
          map.entries()
        )
          .map(
            ([
              stationId,
              value,
            ]) => ({
              stationId,

              stationName:
                stationNameMap.get(
                  stationId
                ) ??
                'Unknown Station',

              count:
                value.count,

              durationMinutes:
                value.durationMinutes,

              averageMinutes:
                value.count >
                0
                  ? value.durationMinutes /
                    value.count
                  : 0,
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              b.count -
              a.count
          );
      },
      [
        filteredRows,
        stationNameMap,
      ]
    );

  /* =======================================================
     STATION RANKING ITEMS
  ======================================================= */

  const stationRankingItems =
    useMemo<
      RankedItem[]
    >(
      () => {
        const result =
          stationStats.map(
            (
              row
            ) => {
              if (
                stationMetric ===
                'DURATION'
              ) {
                return {
                  id:
                    row.stationId,

                  label:
                    row.stationName,

                  value:
                    row.durationMinutes,

                  displayValue:
                    formatDuration(
                      row.durationMinutes
                    ),
                };
              }

              if (
                stationMetric ===
                'AVERAGE'
              ) {
                return {
                  id:
                    row.stationId,

                  label:
                    row.stationName,

                  value:
                    row.averageMinutes,

                  displayValue:
                    formatDuration(
                      row.averageMinutes
                    ),
                };
              }

              return {
                id:
                  row.stationId,

                label:
                  row.stationName,

                value:
                  row.count,

                displayValue:
                  String(
                    row.count
                  ),
              };
            }
          );

        return result.sort(
          (
            a,
            b
          ) =>
            b.value -
            a.value
        );
      },
      [
        stationStats,
        stationMetric,
      ]
    );

  /* =======================================================
     CAUSE ANALYSIS
  ======================================================= */

  const causeData =
    useMemo<
      CausePoint[]
    >(
      () => {
        const map =
          new Map<
            string,
            {
              count: number;
              durationMinutes: number;
            }
          >();

        for (
          const row of
          filteredRows
        ) {
          const cause =
            getCause(
              row
            );

          const current =
            map.get(
              cause
            ) ?? {
              count:
                0,

              durationMinutes:
                0,
            };

          current.count +=
            1;

          current.durationMinutes +=
            getDurationMinutes(
              row
            );

          map.set(
            cause,
            current
          );
        }

        return Array.from(
          map.entries()
        )
          .map(
            ([
              name,
              value,
            ]) => ({
              name,

              count:
                value.count,

              durationMinutes:
                value.durationMinutes,
            })
          )
          .sort(
            (
              a,
              b
            ) => {
              if (
                causeMetric ===
                'DURATION'
              ) {
                return (
                  b.durationMinutes -
                  a.durationMinutes
                );
              }

              return (
                b.count -
                a.count
              );
            }
          );
      },
      [
        filteredRows,
        causeMetric,
      ]
    );

  const causePieData =
    useMemo(
      () =>
        causeData.map(
          (
            item
          ) => ({
            name:
              item.name,

            value:
              causeMetric ===
              'COUNT'
                ? item.count
                : item.durationMinutes,
          })
        ),
      [
        causeData,
        causeMetric,
      ]
    );

  /* =======================================================
     DURATION DISTRIBUTION
  ======================================================= */

  const durationDistribution =
    useMemo<
      DurationBand[]
    >(
      () => {
        const counts = [
          0,
          0,
          0,
          0,
          0,
        ];

        for (
          const row of
          filteredRows
        ) {
          const minutes =
            getDurationMinutes(
              row
            );

          if (
            minutes <
            15
          ) {
            counts[0] +=
              1;
          } else if (
            minutes <
            30
          ) {
            counts[1] +=
              1;
          } else if (
            minutes <
            60
          ) {
            counts[2] +=
              1;
          } else if (
            minutes <
            120
          ) {
            counts[3] +=
              1;
          } else {
            counts[4] +=
              1;
          }
        }

        const labels = [
          '< 15 min',
          '15–30 min',
          '30–60 min',
          '1–2 hrs',
          '> 2 hrs',
        ];

        return labels.map(
          (
            name,
            index
          ) => ({
            name,

            count:
              counts[index],

            percentage:
              filteredRows.length >
              0
                ? (
                    counts[index] /
                    filteredRows.length
                  ) *
                  100
                : 0,
          })
        );
      },
      [
        filteredRows,
      ]
    );

  /* =======================================================
     DRILL STATION INITIALIZATION
  ======================================================= */

  useEffect(() => {
    if (
      selectedStationId !==
      'ALL'
    ) {
      if (
        drillStationId !==
        selectedStationId
      ) {
        setDrillStationId(
          selectedStationId
        );
      }

      return;
    }

    const stillValid =
      drillStationId &&
      stations.some(
        (
          station
        ) =>
          station.id ===
          drillStationId
      );

    if (
      stillValid
    ) {
      return;
    }

    setDrillStationId(
      stationStats[0]
        ?.stationId ??
        stations[0]
          ?.id ??
        ''
    );
  }, [
    selectedStationId,
    drillStationId,
    stationStats,
    stations,
  ]);

  /* =======================================================
     DRILL DOWN ROWS
  ======================================================= */

  const drillRows =
    useMemo(
      () =>
        periodRows.filter(
          (
            row
          ) =>
            row.station_id ===
            drillStationId
        ),
      [
        periodRows,
        drillStationId,
      ]
    );

  const selectedDrillStation =
    stations.find(
      (
        station
      ) =>
        station.id ===
        drillStationId
    );

  /* =======================================================
     DRILL STATION SUMMARY
  ======================================================= */

  const drillSummary =
    useMemo(
      () => {
        const duration =
          drillRows.reduce(
            (
              total,
              row
            ) =>
              total +
              getDurationMinutes(
                row
              ),
            0
          );

        return {
          count:
            drillRows.length,

          duration,

          average:
            drillRows.length >
            0
              ? duration /
                drillRows.length
              : 0,
        };
      },
      [
        drillRows,
      ]
    );

  /* =======================================================
     FEEDER STATS FOR SELECTED STATION
  ======================================================= */

  const feederStats =
    useMemo<
      FeederStat[]
    >(
      () => {
        const map =
          new Map<
            string,
            {
              count: number;
              durationMinutes: number;
            }
          >();

        for (
          const row of
          drillRows
        ) {
          if (
            !row.feeder_id
          ) {
            continue;
          }

          const current =
            map.get(
              row.feeder_id
            ) ?? {
              count:
                0,

              durationMinutes:
                0,
            };

          current.count +=
            1;

          current.durationMinutes +=
            getDurationMinutes(
              row
            );

          map.set(
            row.feeder_id,
            current
          );
        }

        return Array.from(
          map.entries()
        )
          .map(
            ([
              feederId,
              value,
            ]) => {
              const feeder =
                feederMap.get(
                  feederId
                );

              return {
                feederId,

                feederName:
                  feeder?.name ??
                  'Unknown Feeder',

                stationId:
                  drillStationId,

                stationName:
                  selectedDrillStation
                    ?.name ??
                  'Unknown Station',

                count:
                  value.count,

                durationMinutes:
                  value.durationMinutes,

                averageMinutes:
                  value.count >
                  0
                    ? value.durationMinutes /
                      value.count
                    : 0,
              };
            }
          )
          .sort(
            (
              a,
              b
            ) =>
              b.count -
              a.count
          );
      },
      [
        drillRows,
        feederMap,
        drillStationId,
        selectedDrillStation,
      ]
    );

  /* =======================================================
     FEEDER RANKING
  ======================================================= */

  const feederRankingItems =
    useMemo<
      RankedItem[]
    >(
      () => {
        const result =
          feederStats.map(
            (
              row
            ) => {
              if (
                feederMetric ===
                'DURATION'
              ) {
                return {
                  id:
                    row.feederId,

                  label:
                    row.feederName,

                  value:
                    row.durationMinutes,

                  displayValue:
                    formatDuration(
                      row.durationMinutes
                    ),
                };
              }

              if (
                feederMetric ===
                'AVERAGE'
              ) {
                return {
                  id:
                    row.feederId,

                  label:
                    row.feederName,

                  value:
                    row.averageMinutes,

                  displayValue:
                    formatDuration(
                      row.averageMinutes
                    ),
                };
              }

              return {
                id:
                  row.feederId,

                label:
                  row.feederName,

                value:
                  row.count,

                displayValue:
                  String(
                    row.count
                  ),
              };
            }
          );

        return result.sort(
          (
            a,
            b
          ) =>
            b.value -
            a.value
        );
      },
      [
        feederStats,
        feederMetric,
      ]
    );

  /* =======================================================
     FEEDER INITIALIZATION
  ======================================================= */

  useEffect(() => {
    if (
      feederStats.length ===
      0
    ) {
      if (
        selectedFeederId
      ) {
        setSelectedFeederId(
          ''
        );
      }

      return;
    }

    const exists =
      feederStats.some(
        (
          feeder
        ) =>
          feeder.feederId ===
          selectedFeederId
      );

    if (
      !exists
    ) {
      setSelectedFeederId(
        feederStats[0]
          .feederId
      );
    }
  }, [
    feederStats,
    selectedFeederId,
  ]);

  /* =======================================================
     SELECTED FEEDER
  ======================================================= */

  const selectedFeeder =
    feederStats.find(
      (
        feeder
      ) =>
        feeder.feederId ===
        selectedFeederId
    );

  const selectedFeederRows =
    useMemo(
      () =>
        drillRows
          .filter(
            (
              row
            ) =>
              row.feeder_id ===
              selectedFeederId
          )
          .sort(
            (
              a,
              b
            ) =>
              new Date(
                b.interruption_start
              ).getTime() -
              new Date(
                a.interruption_start
              ).getTime()
          ),
      [
        drillRows,
        selectedFeederId,
      ]
    );

  /* =======================================================
     TOP PROBLEM FEEDERS ACROSS GLOBAL SCOPE
  ======================================================= */

  const topProblemFeeders =
    useMemo<
      FeederStat[]
    >(
      () => {
        const map =
          new Map<
            string,
            {
              count: number;
              durationMinutes: number;
              stationId: string;
            }
          >();

        for (
          const row of
          filteredRows
        ) {
          if (
            !row.feeder_id
          ) {
            continue;
          }

          const current =
            map.get(
              row.feeder_id
            ) ?? {
              count:
                0,

              durationMinutes:
                0,

              stationId:
                row.station_id,
            };

          current.count +=
            1;

          current.durationMinutes +=
            getDurationMinutes(
              row
            );

          map.set(
            row.feeder_id,
            current
          );
        }

        return Array.from(
          map.entries()
        )
          .map(
            ([
              feederId,
              value,
            ]) => {
              const feeder =
                feederMap.get(
                  feederId
                );

              return {
                feederId,

                feederName:
                  feeder?.name ??
                  'Unknown Feeder',

                stationId:
                  value.stationId,

                stationName:
                  stationNameMap.get(
                    value.stationId
                  ) ??
                  'Unknown Station',

                count:
                  value.count,

                durationMinutes:
                  value.durationMinutes,

                averageMinutes:
                  value.count >
                  0
                    ? value.durationMinutes /
                      value.count
                    : 0,
              };
            }
          )
          .sort(
            (
              a,
              b
            ) =>
              b.count -
              a.count
          )
          .slice(
            0,
            3
          );
      },
      [
        filteredRows,
        feederMap,
        stationNameMap,
      ]
    );

  /* =======================================================
     CUSTOM PERIOD
  ======================================================= */

  function handlePeriodChange(
    value:
      Period
  ) {
    if (
      value ===
      'Custom'
    ) {
      setModalStartDate(
        customRange.startDate
      );

      setModalEndDate(
        customRange.endDate
      );

      setModalError(
        ''
      );

      setCustomOpen(
        true
      );

      return;
    }

    setPeriod(
      value
    );
  }

  function applyCustomRange() {
    if (
      !modalStartDate ||
      !modalEndDate
    ) {
      setModalError(
        'Please select both start and end dates.'
      );

      return;
    }

    if (
      modalStartDate >
      modalEndDate
    ) {
      setModalError(
        'Start date cannot be after end date.'
      );

      return;
    }

    if (
      modalEndDate >
      getTodayIST()
    ) {
      setModalError(
        'Future dates cannot be selected.'
      );

      return;
    }

    if (
      modalEndDate >
      addYears(
        modalStartDate,
        1
      )
    ) {
      setModalError(
        'The selected period cannot exceed one year.'
      );

      return;
    }

    setCustomRange({
      startDate:
        modalStartDate,

      endDate:
        modalEndDate,
    });

    setPeriod(
      'Custom'
    );

    setCustomOpen(
      false
    );
  }

  /* =======================================================
     LOADING / ERROR
  ======================================================= */

  if (
    loading
  ) {
    return (
      <MessageCard>
        Loading interruption analysis…
      </MessageCard>
    );
  }

  if (
    error
  ) {
    return (
      <MessageCard>
        <div
          style={{
            color:
              '#DC2626',

            fontWeight:
              700,

            marginBottom:
              10,
          }}
        >
          Failed to load interruption analysis
        </div>

        <div
          style={{
            marginBottom:
              14,
          }}
        >
          {error}
        </div>

        <button
          type="button"
          onClick={() =>
            void loadData()
          }
          style={
            primaryButtonStyle
          }
        >
          Retry
        </button>
      </MessageCard>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <>
      <style>
        {`
          .gv-ia-root {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding-bottom: 130px;
          }

          .gv-ia-filter-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 150px;
            gap: 10px;
          }

          .gv-ia-summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }

          .gv-ia-two-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .gv-ia-top-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px;
          }

          .gv-ia-summary-value {
            font-size: 20px;
            font-weight: 800;
            color: #0F172A;
            line-height: 1.1;
          }

          .gv-ia-clickable {
            transition: background .15s ease, transform .15s ease;
          }

          .gv-ia-clickable:active {
            transform: scale(.99);
          }

          @media (max-width: 850px) {
            .gv-ia-two-grid {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 620px) {
            .gv-ia-summary-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .gv-ia-top-grid {
              grid-template-columns: 1fr;
            }

            .gv-ia-filter-grid {
              grid-template-columns: minmax(0, 1fr) 125px;
            }

            .gv-ia-summary-value {
              font-size: 18px;
            }
          }
        `}
      </style>

      <div className="gv-ia-root">

        {/* =================================================
            GLOBAL FILTER
        ================================================== */}

        <div
          className="gv-ia-filter-grid"
        >
          <select
            value={
              selectedStationId
            }

            onChange={(
              event
            ) =>
              setSelectedStationId(
                event.target.value
              )
            }

            style={
              mainSelectStyle
            }
          >
            <option value="ALL">
              All Stations
            </option>

            {stations.map(
              (
                station
              ) => (
                <option
                  key={
                    station.id
                  }

                  value={
                    station.id
                  }
                >
                  {
                    station.name
                  }
                </option>
              )
            )}
          </select>

          <PeriodSelect
            value={
              period
            }

            onChange={
              handlePeriodChange
            }
          />
        </div>

        {period ===
          'Custom' && (
          <CustomRangeChip
            range={
              customRange
            }

            onClick={() => {
              setModalStartDate(
                customRange.startDate
              );

              setModalEndDate(
                customRange.endDate
              );

              setCustomOpen(
                true
              );
            }}
          />
        )}

        {/* =================================================
            EXECUTIVE SUMMARY
        ================================================== */}

        <Card>
          <SectionHeading
            icon={
              <TrendingUp
                size={
                  18
                }
              />
            }

            title="Executive Summary"
          />

          <div
            className="gv-ia-summary-grid"
          >
            <SummaryTile
              icon={
                <Zap
                  size={
                    20
                  }
                />
              }

              iconBackground="#E3F2FD"
              iconColor="#1976D2"

              label="Total Interruptions"

              value={
                String(
                  summary.total
                )
              }
            />

            <SummaryTile
              icon={
                <Clock3
                  size={
                    20
                  }
                />
              }

              iconBackground="#E0F2F1"
              iconColor="#009688"

              label="Total Duration"

              value={`${formatDuration(
                summary.totalDuration
              )} hrs`}
            />

            <SummaryTile
              icon={
                <Timer
                  size={
                    20
                  }
                />
              }

              iconBackground="#FFF3E0"
              iconColor="#FB8C00"

              label="Avg Duration"

              value={`${formatDuration(
                summary.averageDuration
              )} hrs`}
            />

            <SummaryTile
              icon={
                <Building2
                  size={
                    20
                  }
                />
              }

              iconBackground="#F3E8FF"
              iconColor="#7C3AED"

              label="Stations Affected"

              value={
                String(
                  summary.stationsAffected
                )
              }
            />

            <SummaryTile
              icon={
                <Network
                  size={
                    20
                  }
                />
              }

              iconBackground="#E0F7FA"
              iconColor="#0891B2"

              label="Feeders Affected"

              value={
                String(
                  summary.feedersAffected
                )
              }
            />

            <SummaryTile
              icon={
                <AlertTriangle
                  size={
                    20
                  }
                />
              }

              iconBackground="#FEE2E2"
              iconColor="#DC2626"

              label="Open Interruptions"

              value={
                String(
                  summary.open
                )
              }
            />
          </div>
        </Card>

        {/* =================================================
            TREND
        ================================================== */}

        <Card>
          <div
            style={
              sectionHeaderWithControlStyle
            }
          >
            <SectionHeading
              icon={
                <TrendingUp
                  size={
                    18
                  }
                />
              }

              title="Interruption Trend"
              noMargin
            />

            <SegmentedToggle
              options={[
                {
                  value:
                    'COUNT',
                  label:
                    'Number',
                },
                {
                  value:
                    'DURATION',
                  label:
                    'Duration',
                },
              ]}

              value={
                trendMetric
              }

              onChange={(
                value
              ) =>
                setTrendMetric(
                  value as
                    TrendMetric
                )
              }
            />
          </div>

          <div
            style={{
              height:
                260,

              marginTop:
                12,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart
                data={
                  trendData
                }
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={
                    false
                  }
                />

                <XAxis
                  dataKey="label"
                  fontSize={
                    10
                  }
                  interval="preserveStartEnd"
                />

                <YAxis
                  fontSize={
                    10
                  }

                  allowDecimals={
                    trendMetric ===
                    'DURATION'
                  }
                />

                <Tooltip
                  formatter={(
                    value
                  ) => {
                    if (
                      trendMetric ===
                      'DURATION'
                    ) {
                      return [
                        `${Number(
                          value
                        ).toFixed(
                          2
                        )} hrs`,
                        'Duration',
                      ];
                    }

                    return [
                      Number(
                        value
                      ),
                      'Interruptions',
                    ];
                  }}
                />

                <Bar
                  dataKey={
                    trendMetric ===
                    'COUNT'
                      ? 'count'
                      : 'durationHours'
                  }

                  fill="#1976D2"

                  radius={[
                    6,
                    6,
                    0,
                    0,
                  ]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* =================================================
            STATION + CAUSE
        ================================================== */}

        <div
          className="gv-ia-two-grid"
        >
          {/* ===============================================
              STATION PERFORMANCE
          ================================================ */}

          <Card>
            <div
              style={
                sectionHeaderWithControlStyle
              }
            >
              <SectionHeading
                icon={
                  <Building2
                    size={
                      18
                    }
                  />
                }

                title="Station Performance"
                noMargin
              />

              <MetricSelect
                value={
                  stationMetric
                }

                onChange={(
                  value
                ) =>
                  setStationMetric(
                    value as
                      RankingMetric
                  )
                }
              />
            </div>

            <div
              style={{
                marginTop:
                  16,
              }}
            >
              {stationRankingItems.length ===
              0 ? (
                <NoData />
              ) : (
                <RankedBarList
                  items={
                    stationRankingItems
                  }

                  selectedId={
                    drillStationId
                  }

                  onSelect={(
                    id
                  ) =>
                    setDrillStationId(
                      id
                    )
                  }
                />
              )}
            </div>

            <div
              style={
                helperTextStyle
              }
            >
              Tap a station to drill down to its feeders.
            </div>
          </Card>

          {/* ===============================================
              CAUSE ANALYSIS
          ================================================ */}

          <Card>
            <div
              style={
                sectionHeaderWithControlStyle
              }
            >
              <SectionHeading
                icon={
                  <AlertTriangle
                    size={
                      18
                    }
                  />
                }

                title="Cause Analysis"
                noMargin
              />

              <select
                value={
                  causeMetric
                }

                onChange={(
                  event
                ) =>
                  setCauseMetric(
                    event.target
                      .value as
                      CauseMetric
                  )
                }

                style={
                  smallSelectStyle
                }
              >
                <option value="COUNT">
                  By Number
                </option>

                <option value="DURATION">
                  By Duration
                </option>
              </select>
            </div>

            {causePieData.length ===
            0 ? (
              <NoData />
            ) : (
              <>
                <div
                  style={{
                    height:
                      225,
                  }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <PieChart>
                      <Pie
                        data={
                          causePieData
                        }

                        dataKey="value"
                        nameKey="name"

                        innerRadius={
                          48
                        }

                        outerRadius={
                          78
                        }

                        paddingAngle={
                          1
                        }
                      >
                        {causePieData.map(
                          (
                            item,
                            index
                          ) => (
                            <Cell
                              key={
                                item.name
                              }

                              fill={
                                PIE_COLORS[
                                  index %
                                    PIE_COLORS.length
                                ]
                              }
                            />
                          )
                        )}
                      </Pie>

                      <Tooltip
                        formatter={(
                          value
                        ) => {
                          if (
                            causeMetric ===
                            'DURATION'
                          ) {
                            return [
                              formatDuration(
                                Number(
                                  value
                                )
                              ),
                              'Duration',
                            ];
                          }

                          return [
                            Number(
                              value
                            ),
                            'Interruptions',
                          ];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div
                  style={{
                    display:
                      'flex',

                    flexDirection:
                      'column',

                    gap:
                      8,
                  }}
                >
                  {causeData.map(
                    (
                      cause,
                      index
                    ) => {
                      const total =
                        causeMetric ===
                        'COUNT'
                          ? causeData.reduce(
                              (
                                sum,
                                item
                              ) =>
                                sum +
                                item.count,
                              0
                            )
                          : causeData.reduce(
                              (
                                sum,
                                item
                              ) =>
                                sum +
                                item.durationMinutes,
                              0
                            );

                      const value =
                        causeMetric ===
                        'COUNT'
                          ? cause.count
                          : cause.durationMinutes;

                      const percentage =
                        total >
                        0
                          ? (
                              value /
                              total
                            ) *
                            100
                          : 0;

                      return (
                        <div
                          key={
                            cause.name
                          }

                          style={
                            legendRowStyle
                          }
                        >
                          <div
                            style={
                              legendLeftStyle
                            }
                          >
                            <span
                              style={{
                                width:
                                  10,

                                height:
                                  10,

                                borderRadius:
                                  '50%',

                                flexShrink:
                                  0,

                                background:
                                  PIE_COLORS[
                                    index %
                                      PIE_COLORS.length
                                  ],
                              }}
                            />

                            <span>
                              {
                                cause.name
                              }
                            </span>
                          </div>

                          <strong>
                            {causeMetric ===
                            'COUNT'
                              ? cause.count
                              : formatDuration(
                                  cause.durationMinutes
                                )}

                            {' '}

                            (
                            {percentage.toFixed(
                              0
                            )}
                            %)
                          </strong>
                        </div>
                      );
                    }
                  )}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* =================================================
            DURATION DISTRIBUTION + DRILL DOWN
        ================================================== */}

        <div
          className="gv-ia-two-grid"
        >
          {/* ===============================================
              DURATION DISTRIBUTION
          ================================================ */}

          <Card>
            <SectionHeading
              icon={
                <Timer
                  size={
                    18
                  }
                />
              }

              title="Duration Distribution"
            />

            <div
              style={{
                display:
                  'flex',

                flexDirection:
                  'column',

                gap:
                  15,
              }}
            >
              {durationDistribution.map(
                (
                  item
                ) => (
                  <div
                    key={
                      item.name
                    }
                  >
                    <div
                      style={{
                        display:
                          'flex',

                        justifyContent:
                          'space-between',

                        gap:
                          10,

                        marginBottom:
                          5,

                        fontSize:
                          12,
                      }}
                    >
                      <span
                        style={{
                          fontWeight:
                            600,

                          color:
                            '#334155',
                        }}
                      >
                        {
                          item.name
                        }
                      </span>

                      <span
                        style={{
                          color:
                            '#475569',
                        }}
                      >
                        {
                          item.count
                        }{' '}
                        (
                        {item.percentage.toFixed(
                          0
                        )}
                        %)
                      </span>
                    </div>

                    <div
                      style={
                        progressTrackStyle
                      }
                    >
                      <div
                        style={{
                          ...progressFillStyle,

                          width:
                            `${Math.max(
                              item.percentage,
                              item.count >
                                0
                                ? 3
                                : 0
                            )}%`,

                          background:
                            '#14B8A6',
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </Card>

          {/* ===============================================
              DRILL DOWN
          ================================================ */}

          <Card>
            <div
              style={{
                display:
                  'flex',

                justifyContent:
                  'space-between',

                alignItems:
                  'center',

                gap:
                  10,

                marginBottom:
                  14,
              }}
            >
              <SectionHeading
                icon={
                  <Network
                    size={
                      18
                    }
                  />
                }

                title={`Drill Down${
                  selectedDrillStation
                    ? `: ${selectedDrillStation.name}`
                    : ''
                }`}

                noMargin
              />
            </div>

            {selectedStationId ===
              'ALL' && (
              <select
                value={
                  drillStationId
                }

                onChange={(
                  event
                ) =>
                  setDrillStationId(
                    event.target.value
                  )
                }

                style={{
                  ...mainSelectStyle,

                  marginBottom:
                    14,
                }}
              >
                {stations.map(
                  (
                    station
                  ) => (
                    <option
                      key={
                        station.id
                      }

                      value={
                        station.id
                      }
                    >
                      {
                        station.name
                      }
                    </option>
                  )
                )}
              </select>
            )}

            <div
              className="gv-ia-summary-grid"
              style={{
                marginBottom:
                  16,
              }}
            >
              <SmallStat
                label="Interruptions"

                value={
                  String(
                    drillSummary.count
                  )
                }

                color="#1976D2"
              />

              <SmallStat
                label="Total Duration"

                value={
                  formatDuration(
                    drillSummary.duration
                  )
                }

                color="#0F9D8A"
              />

              <SmallStat
                label="Avg Duration"

                value={
                  formatDuration(
                    drillSummary.average
                  )
                }

                color="#F59E0B"
              />
            </div>

            <div
              style={
                sectionHeaderWithControlStyle
              }
            >
              <div
                style={{
                  fontWeight:
                    700,

                  fontSize:
                    13,

                  color:
                    '#1E293B',
                }}
              >
                Feeder Performance
              </div>

              <MetricSelect
                value={
                  feederMetric
                }

                onChange={(
                  value
                ) =>
                  setFeederMetric(
                    value as
                      RankingMetric
                  )
                }
              />
            </div>

            <div
              style={{
                marginTop:
                  12,
              }}
            >
              {feederRankingItems.length ===
              0 ? (
                <NoData text="No feeder-level interruptions for this station." />
              ) : (
                <RankedBarList
                  items={
                    feederRankingItems
                  }

                  selectedId={
                    selectedFeederId
                  }

                  onSelect={(
                    id
                  ) =>
                    setSelectedFeederId(
                      id
                    )
                  }

                  showChevron
                />
              )}
            </div>
          </Card>
        </div>

        {/* =================================================
            FEEDER DETAIL
        ================================================== */}

        {selectedFeeder && (
          <Card>
            <SectionHeading
              icon={
                <Zap
                  size={
                    18
                  }
                />
              }

              title={
                selectedFeeder
                  .feederName
              }

              subtitle={
                selectedFeeder
                  .stationName
              }
            />

            <div
              className="gv-ia-summary-grid"
              style={{
                marginBottom:
                  18,
              }}
            >
              <SmallStat
                label="Interruptions"

                value={
                  String(
                    selectedFeeder.count
                  )
                }

                color="#1976D2"
              />

              <SmallStat
                label="Total Duration"

                value={
                  formatDuration(
                    selectedFeeder.durationMinutes
                  )
                }

                color="#0F9D8A"
              />

              <SmallStat
                label="Avg Duration"

                value={
                  formatDuration(
                    selectedFeeder.averageMinutes
                  )
                }

                color="#F59E0B"
              />
            </div>

            <div
              style={{
                fontWeight:
                  700,

                fontSize:
                  13,

                color:
                  '#1E293B',

                marginBottom:
                  10,
              }}
            >
              Recent Interruptions
            </div>

            {selectedFeederRows.length ===
            0 ? (
              <NoData />
            ) : (
              <div
                style={{
                  display:
                    'flex',

                  flexDirection:
                    'column',

                  gap:
                    8,
                }}
              >
                {selectedFeederRows
                  .slice(
                    0,
                    6
                  )
                  .map(
                    (
                      row
                    ) => {
                      const cause =
                        getCause(
                          row
                        );

                      return (
                        <div
                          key={
                            row.id
                          }

                          style={
                            eventRowStyle
                          }
                        >
                          <div
                            style={{
                              minWidth:
                                0,

                              flex:
                                1,
                            }}
                          >
                            <div
                              style={{
                                fontWeight:
                                  700,

                                fontSize:
                                  12,

                                color:
                                  '#1E293B',
                              }}
                            >
                              {formatEventDate(
                                row.interruption_start
                              )}
                            </div>

                            <div
                              style={{
                                marginTop:
                                  3,

                                fontSize:
                                  11,

                                color:
                                  '#64748B',
                              }}
                            >
                              {formatEventTime(
                                row.interruption_start
                              )}

                              {' → '}

                              {formatEventTime(
                                row.interruption_end
                              )}

                              {' · '}

                              {formatDuration(
                                getDurationMinutes(
                                  row
                                )
                              )}
                            </div>
                          </div>

                          <span
                            style={{
                              padding:
                                '4px 7px',

                              borderRadius:
                                7,

                              background:
                                `${causeColor(
                                  cause
                                )}18`,

                              color:
                                causeColor(
                                  cause
                                ),

                              fontSize:
                                10,

                              fontWeight:
                                700,

                              maxWidth:
                                130,

                              overflow:
                                'hidden',

                              textOverflow:
                                'ellipsis',

                              whiteSpace:
                                'nowrap',
                            }}
                          >
                            {
                              cause
                            }
                          </span>
                        </div>
                      );
                    }
                  )}
              </div>
            )}
          </Card>
        )}

        {/* =================================================
            TOP PROBLEMS
        ================================================== */}

        <Card>
          <SectionHeading
            icon={
              <AlertTriangle
                size={
                  18
                }
              />
            }

            title="Top Problems"

            subtitle="Highest interruption frequency during the selected period"
          />

          <div
            className="gv-ia-top-grid"
          >
            <div>
              <div
                style={
                  problemHeadingStyle
                }
              >
                Top Problem Stations
              </div>

              {stationStats
                .slice(
                  0,
                  3
                )
                .map(
                  (
                    row,
                    index
                  ) => (
                    <ProblemRow
                      key={
                        row.stationId
                      }

                      rank={
                        index +
                        1
                      }

                      title={
                        row.stationName
                      }

                      primary={`${row.count} interruptions`}

                      secondary={`${formatDuration(
                        row.durationMinutes
                      )} hrs`}
                    />
                  )
                )}

              {stationStats.length ===
                0 && (
                <NoData />
              )}
            </div>

            <div>
              <div
                style={
                  problemHeadingStyle
                }
              >
                Top Problem Feeders
              </div>

              {topProblemFeeders.map(
                (
                  row,
                  index
                ) => (
                  <ProblemRow
                    key={
                      row.feederId
                    }

                    rank={
                      index +
                      1
                    }

                    title={`${row.feederName} (${row.stationName})`}

                    primary={`${row.count} interruptions`}

                    secondary={`${formatDuration(
                      row.durationMinutes
                    )} hrs`}
                  />
                )
              )}

              {topProblemFeeders.length ===
                0 && (
                <NoData />
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ===================================================
          CUSTOM DATE MODAL
      ==================================================== */}

      {customOpen && (
        <CustomDateModal
          startDate={
            modalStartDate
          }

          endDate={
            modalEndDate
          }

          error={
            modalError
          }

          onStartDateChange={(
            value
          ) => {
            setModalStartDate(
              value
            );

            setModalError(
              ''
            );
          }}

          onEndDateChange={(
            value
          ) => {
            setModalEndDate(
              value
            );

            setModalError(
              ''
            );
          }}

          onCancel={() =>
            setCustomOpen(
              false
            )
          }

          onApply={
            applyCustomRange
          }
        />
      )}
    </>
  );
}

/* =========================================================
   CARD
========================================================= */

function Card({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div
      style={{
        background:
          '#FFFFFF',

        borderRadius:
          18,

        padding:
          16,

        border:
          '1px solid #E2E8F0',

        boxShadow:
          '0 4px 14px rgba(15,23,42,.07)',
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   SECTION HEADING
========================================================= */

function SectionHeading({
  icon,
  title,
  subtitle,
  noMargin = false,
}: {
  icon:
    ReactNode;

  title:
    string;

  subtitle?:
    string;

  noMargin?:
    boolean;
}) {
  return (
    <div
      style={{
        display:
          'flex',

        alignItems:
          'center',

        gap:
          9,

        marginBottom:
          noMargin
            ? 0
            : 14,
      }}
    >
      <div
        style={{
          width:
            34,

          height:
            34,

          borderRadius:
            12,

          display:
            'grid',

          placeItems:
            'center',

          color:
            '#1976D2',

          background:
            '#E3F2FD',

          flexShrink:
            0,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          minWidth:
            0,
        }}
      >
        <div
          style={{
            fontWeight:
              750,

            color:
              '#172554',

            fontSize:
              15,
          }}
        >
          {title}
        </div>

        {subtitle && (
          <div
            style={{
              marginTop:
                2,

              color:
                '#64748B',

              fontSize:
                10,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   SUMMARY TILE
========================================================= */

function SummaryTile({
  icon,
  iconBackground,
  iconColor,
  label,
  value,
}: {
  icon:
    ReactNode;

  iconBackground:
    string;

  iconColor:
    string;

  label:
    string;

  value:
    string;
}) {
  return (
    <div
      style={{
        border:
          '1px solid #E2E8F0',

        borderRadius:
          13,

        padding:
          12,

        background:
          '#FFFFFF',

        minHeight:
          92,
      }}
    >
      <div
        style={{
          display:
            'flex',

          alignItems:
            'center',

          gap:
            8,

          marginBottom:
            9,
        }}
      >
        <div
          style={{
            width:
              34,

            height:
              34,

            borderRadius:
              '50%',

            display:
              'grid',

            placeItems:
              'center',

            background:
              iconBackground,

            color:
              iconColor,

            flexShrink:
              0,
          }}
        >
          {icon}
        </div>

        <div
          style={{
            fontSize:
              10,

            lineHeight:
              1.25,

            color:
              '#475569',

            fontWeight:
              600,
          }}
        >
          {label}
        </div>
      </div>

      <div className="gv-ia-summary-value">
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   SMALL STAT
========================================================= */

function SmallStat({
  label,
  value,
  color,
}: {
  label:
    string;

  value:
    string;

  color:
    string;
}) {
  return (
    <div
      style={{
        border:
          '1px solid #E2E8F0',

        borderRadius:
          10,

        padding:
          '9px 8px',

        textAlign:
          'center',

        background:
          '#F8FAFC',
      }}
    >
      <div
        style={{
          fontSize:
            9,

          color:
            '#64748B',

          marginBottom:
            4,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontWeight:
            800,

          fontSize:
            16,

          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   PERIOD SELECT
========================================================= */

function PeriodSelect({
  value,
  onChange,
}: {
  value:
    Period;

  onChange:
    (
      value:
        Period
    ) => void;
}) {
  const displayValue =
    value ===
    'Custom'
      ? '__CUSTOM_ACTIVE__'
      : value;

  return (
    <select
      value={
        displayValue
      }

      onChange={(
        event
      ) => {
        const selected =
          event.target.value;

        if (
          selected ===
          '__CUSTOM_ACTIVE__'
        ) {
          return;
        }

        onChange(
          selected as
            Period
        );
      }}

      style={{
        ...mainSelectStyle,

        width:
          '100%',
      }}
    >
      {value ===
        'Custom' && (
        <option
          value="__CUSTOM_ACTIVE__"
          disabled
        >
          Custom
        </option>
      )}

      {periods.map(
        (
          item
        ) => (
          <option
            key={
              item
            }

            value={
              item
            }
          >
            {item}
          </option>
        )
      )}
    </select>
  );
}

/* =========================================================
   METRIC SELECT
========================================================= */

function MetricSelect({
  value,
  onChange,
}: {
  value:
    RankingMetric;

  onChange:
    (
      value:
        string
    ) => void;
}) {
  return (
    <select
      value={
        value
      }

      onChange={(
        event
      ) =>
        onChange(
          event.target.value
        )
      }

      style={
        smallSelectStyle
      }
    >
      <option value="COUNT">
        Count
      </option>

      <option value="DURATION">
        Total Duration
      </option>

      <option value="AVERAGE">
        Avg Duration
      </option>
    </select>
  );
}

/* =========================================================
   SEGMENTED TOGGLE
========================================================= */

function SegmentedToggle({
  options,
  value,
  onChange,
}: {
  options:
    Array<{
      value: string;
      label: string;
    }>;

  value:
    string;

  onChange:
    (
      value:
        string
    ) => void;
}) {
  return (
    <div
      style={{
        display:
          'flex',

        border:
          '1px solid #CBD5E1',

        borderRadius:
          9,

        overflow:
          'hidden',

        flexShrink:
          0,
      }}
    >
      {options.map(
        (
          option
        ) => {
          const active =
            option.value ===
            value;

          return (
            <button
              key={
                option.value
              }

              type="button"

              onClick={() =>
                onChange(
                  option.value
                )
              }

              style={{
                border:
                  'none',

                padding:
                  '7px 10px',

                background:
                  active
                    ? '#1565C0'
                    : '#FFFFFF',

                color:
                  active
                    ? '#FFFFFF'
                    : '#475569',

                fontWeight:
                  700,

                fontSize:
                  10,

                cursor:
                  'pointer',
              }}
            >
              {
                option.label
              }
            </button>
          );
        }
      )}
    </div>
  );
}

/* =========================================================
   RANKED BAR LIST
========================================================= */

function RankedBarList({
  items,
  selectedId,
  onSelect,
  showChevron = false,
}: {
  items:
    RankedItem[];

  selectedId?:
    string;

  onSelect?:
    (
      id:
        string
    ) => void;

  showChevron?:
    boolean;
}) {
  const maxValue =
    Math.max(
      ...items.map(
        (
          item
        ) =>
          item.value
      ),
      1
    );

  return (
    <div
      style={{
        display:
          'flex',

        flexDirection:
          'column',

        gap:
          12,
      }}
    >
      {items.map(
        (
          item,
          index
        ) => {
          const selected =
            item.id ===
            selectedId;

          const width =
            (
              item.value /
              maxValue
            ) *
            100;

          return (
            <button
              key={
                item.id
              }

              type="button"

              className="gv-ia-clickable"

              onClick={() =>
                onSelect?.(
                  item.id
                )
              }

              style={{
                border:
                  'none',

                background:
                  selected
                    ? '#EFF6FF'
                    : 'transparent',

                borderRadius:
                  10,

                padding:
                  '7px 6px',

                cursor:
                  onSelect
                    ? 'pointer'
                    : 'default',

                textAlign:
                  'left',
              }}
            >
              <div
                style={{
                  display:
                    'grid',

                  gridTemplateColumns:
                    '24px minmax(85px, 135px) 1fr auto',

                  alignItems:
                    'center',

                  gap:
                    8,
                }}
              >
                <div
                  style={{
                    color:
                      '#64748B',

                    fontWeight:
                      700,

                    fontSize:
                      11,
                  }}
                >
                  {index +
                    1}.
                </div>

                <div
                  style={{
                    minWidth:
                      0,

                    color:
                      '#1E293B',

                    fontSize:
                      11,

                    fontWeight:
                      selected
                        ? 750
                        : 600,

                    overflow:
                      'hidden',

                    textOverflow:
                      'ellipsis',

                    whiteSpace:
                      'nowrap',
                  }}
                >
                  {
                    item.label
                  }
                </div>

                <div
                  style={
                    progressTrackStyle
                  }
                >
                  <div
                    style={{
                      ...progressFillStyle,

                      width:
                        `${Math.max(
                          width,
                          item.value >
                            0
                            ? 3
                            : 0
                        )}%`,

                      background:
                        '#1976D2',
                    }}
                  />
                </div>

                <div
                  style={{
                    minWidth:
                      26,

                    display:
                      'flex',

                    alignItems:
                      'center',

                    justifyContent:
                      'flex-end',

                    gap:
                      3,

                    color:
                      '#1E293B',

                    fontSize:
                      11,

                    fontWeight:
                      750,

                    whiteSpace:
                      'nowrap',
                  }}
                >
                  {
                    item.displayValue
                  }

                  {showChevron && (
                    <ChevronRight
                      size={
                        14
                      }
                    />
                  )}
                </div>
              </div>
            </button>
          );
        }
      )}
    </div>
  );
}

/* =========================================================
   PROBLEM ROW
========================================================= */

function ProblemRow({
  rank,
  title,
  primary,
  secondary,
}: {
  rank:
    number;

  title:
    string;

  primary:
    string;

  secondary:
    string;
}) {
  return (
    <div
      style={{
        display:
          'grid',

        gridTemplateColumns:
          '25px 1fr auto',

        alignItems:
          'center',

        gap:
          8,

        padding:
          '9px 0',

        borderBottom:
          '1px solid #F1F5F9',
      }}
    >
      <div
        style={{
          width:
            22,

          height:
            22,

          borderRadius:
            '50%',

          display:
            'grid',

          placeItems:
            'center',

          background:
            '#E2E8F0',

          color:
            '#334155',

          fontWeight:
            700,

          fontSize:
            10,
        }}
      >
        {rank}
      </div>

      <div
        style={{
          minWidth:
            0,
        }}
      >
        <div
          style={{
            color:
              '#1E293B',

            fontSize:
              11,

            fontWeight:
              700,

            overflow:
              'hidden',

            textOverflow:
              'ellipsis',

            whiteSpace:
              'nowrap',
          }}
        >
          {title}
        </div>

        <div
          style={{
            marginTop:
              2,

            color:
              '#64748B',

            fontSize:
              9,
          }}
        >
          {secondary}
        </div>
      </div>

      <div
        style={{
          padding:
            '4px 7px',

          borderRadius:
            7,

          background:
            '#FEE2E2',

          color:
            '#DC2626',

          fontSize:
            10,

          fontWeight:
            700,

          whiteSpace:
            'nowrap',
        }}
      >
        {primary}
      </div>
    </div>
  );
}

/* =========================================================
   NO DATA
========================================================= */

function NoData({
  text =
    'No interruption data for the selected period.',
}: {
  text?:
    string;
}) {
  return (
    <div
      style={{
        minHeight:
          110,

        display:
          'grid',

        placeItems:
          'center',

        textAlign:
          'center',

        color:
          '#94A3B8',

        fontSize:
          11,

        padding:
          16,
      }}
    >
      {text}
    </div>
  );
}

/* =========================================================
   MESSAGE CARD
========================================================= */

function MessageCard({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div
      style={{
        background:
          '#FFFFFF',

        borderRadius:
          18,

        padding:
          30,

        textAlign:
          'center',

        color:
          '#64748B',

        border:
          '1px solid #E2E8F0',

        boxShadow:
          '0 4px 12px rgba(15,23,42,.08)',
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   CUSTOM RANGE CHIP
========================================================= */

function CustomRangeChip({
  range,
  onClick,
}: {
  range:
    DateRange;

  onClick:
    () => void;
}) {
  return (
    <button
      type="button"

      onClick={
        onClick
      }

      style={{
        alignSelf:
          'flex-start',

        display:
          'inline-flex',

        alignItems:
          'center',

        gap:
          7,

        padding:
          '7px 10px',

        borderRadius:
          9,

        border:
          '1px solid #BFDBFE',

        background:
          '#EFF6FF',

        color:
          '#1D4ED8',

        fontSize:
          10,

        fontWeight:
          700,

        cursor:
          'pointer',
      }}
    >
      <CalendarDays
        size={
          14
        }
      />

      {formatDate(
        range.startDate
      )}

      {' — '}

      {formatDate(
        range.endDate
      )}
    </button>
  );
}

/* =========================================================
   CUSTOM DATE MODAL
========================================================= */

function CustomDateModal({
  startDate,
  endDate,
  error,
  onStartDateChange,
  onEndDateChange,
  onCancel,
  onApply,
}: {
  startDate:
    string;

  endDate:
    string;

  error:
    string;

  onStartDateChange:
    (
      value:
        string
    ) => void;

  onEndDateChange:
    (
      value:
        string
    ) => void;

  onCancel:
    () => void;

  onApply:
    () => void;
}) {
  const today =
    getTodayIST();

  const maxEndDate =
    startDate
      ? (
          addYears(
            startDate,
            1
          ) <
          today
            ? addYears(
                startDate,
                1
              )
            : today
        )
      : today;

  return (
    <div
      style={{
        position:
          'fixed',

        inset:
          0,

        zIndex:
          1000,

        background:
          'rgba(15,23,42,.52)',

        display:
          'flex',

        alignItems:
          'center',

        justifyContent:
          'center',

        padding:
          18,
      }}

      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          width:
            '100%',

          maxWidth:
            390,

          background:
            '#FFFFFF',

          borderRadius:
            20,

          overflow:
            'hidden',

          boxShadow:
            '0 24px 60px rgba(15,23,42,.28)',
        }}
      >
        <div
          style={{
            background:
              'linear-gradient(135deg,#0D47A1,#1565C0)',

            color:
              '#FFFFFF',

            padding:
              '16px 18px',

            display:
              'flex',

            justifyContent:
              'space-between',

            alignItems:
              'center',
          }}
        >
          <div
            style={{
              display:
                'flex',

              alignItems:
                'center',

              gap:
                10,
            }}
          >
            <CalendarDays
              size={
                20
              }
            />

            <div>
              <div
                style={{
                  fontWeight:
                    700,

                  fontSize:
                    16,
                }}
              >
                Custom Date Range
              </div>

              <div
                style={{
                  fontSize:
                    10,

                  opacity:
                    0.85,

                  marginTop:
                    2,
                }}
              >
                Maximum period: 1 year
              </div>
            </div>
          </div>

          <button
            type="button"

            onClick={
              onCancel
            }

            style={{
              border:
                'none',

              width:
                32,

              height:
                32,

              borderRadius:
                '50%',

              display:
                'grid',

              placeItems:
                'center',

              background:
                'rgba(255,255,255,.14)',

              color:
                '#FFFFFF',

              cursor:
                'pointer',
            }}
          >
            <X
              size={
                18
              }
            />
          </button>
        </div>

        <div
          style={{
            padding:
              18,
          }}
        >
          <label
            style={
              modalLabelStyle
            }
          >
            Start Date
          </label>

          <input
            type="date"

            value={
              startDate
            }

            max={
              endDate ||
              today
            }

            onChange={(
              event
            ) =>
              onStartDateChange(
                event.target.value
              )
            }

            style={
              modalInputStyle
            }
          />

          <label
            style={{
              ...modalLabelStyle,

              marginTop:
                16,
            }}
          >
            End Date
          </label>

          <input
            type="date"

            value={
              endDate
            }

            min={
              startDate ||
              undefined
            }

            max={
              maxEndDate
            }

            onChange={(
              event
            ) =>
              onEndDateChange(
                event.target.value
              )
            }

            style={
              modalInputStyle
            }
          />

          <div
            style={{
              marginTop:
                9,

              color:
                '#64748B',

              fontSize:
                10,

              lineHeight:
                1.4,
            }}
          >
            Future dates are not permitted and the selected period cannot exceed one year.
          </div>

          {error && (
            <div
              style={{
                marginTop:
                  10,

                padding:
                  '8px 10px',

                borderRadius:
                  8,

                background:
                  '#FEF2F2',

                color:
                  '#B91C1C',

                fontSize:
                  11,

                fontWeight:
                  600,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display:
                'flex',

              gap:
                10,

              marginTop:
                20,
            }}
          >
            <button
              type="button"

              onClick={
                onCancel
              }

              style={{
                ...secondaryButtonStyle,

                flex:
                  1,
              }}
            >
              Cancel
            </button>

            <button
              type="button"

              onClick={
                onApply
              }

              style={{
                ...primaryButtonStyle,

                flex:
                  1,
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   STYLES
========================================================= */

const mainSelectStyle:
  CSSProperties = {
    width:
      '100%',

    minWidth:
      0,

    padding:
      '10px 12px',

    borderRadius:
      10,

    border:
      '1px solid #CBD5E1',

    background:
      '#FFFFFF',

    color:
      '#334155',

    fontSize:
      12,

    outline:
      'none',
  };

const smallSelectStyle:
  CSSProperties = {
    maxWidth:
      145,

    padding:
      '7px 8px',

    borderRadius:
      8,

    border:
      '1px solid #CBD5E1',

    background:
      '#FFFFFF',

    color:
      '#334155',

    fontSize:
      10,

    outline:
      'none',
  };

const sectionHeaderWithControlStyle:
  CSSProperties = {
    display:
      'flex',

    alignItems:
      'center',

    justifyContent:
      'space-between',

    gap:
      10,
  };

const progressTrackStyle:
  CSSProperties = {
    width:
      '100%',

    height:
      7,

    borderRadius:
      999,

    background:
      '#E2E8F0',

    overflow:
      'hidden',
  };

const progressFillStyle:
  CSSProperties = {
    height:
      '100%',

    borderRadius:
      999,
  };

const helperTextStyle:
  CSSProperties = {
    marginTop:
      12,

    paddingTop:
      9,

    borderTop:
      '1px solid #F1F5F9',

    color:
      '#64748B',

    fontSize:
      9,

    textAlign:
      'center',
  };

const legendRowStyle:
  CSSProperties = {
    display:
      'flex',

    alignItems:
      'center',

    justifyContent:
      'space-between',

    gap:
      10,

    color:
      '#475569',

    fontSize:
      10,
  };

const legendLeftStyle:
  CSSProperties = {
    display:
      'flex',

    alignItems:
      'center',

    gap:
      7,

    minWidth:
      0,
  };

const eventRowStyle:
  CSSProperties = {
    display:
      'flex',

    alignItems:
      'center',

    gap:
      10,

    border:
      '1px solid #E2E8F0',

    background:
      '#F8FAFC',

    borderRadius:
      10,

    padding:
      '9px 10px',
  };

const problemHeadingStyle:
  CSSProperties = {
    fontWeight:
      750,

    fontSize:
      12,

    color:
      '#334155',

    marginBottom:
      4,
  };

const modalLabelStyle:
  CSSProperties = {
    display:
      'block',

    marginBottom:
      6,

    color:
      '#475569',

    fontSize:
      11,

    fontWeight:
      700,
  };

const modalInputStyle:
  CSSProperties = {
    width:
      '100%',

    boxSizing:
      'border-box',

    padding:
      '10px 12px',

    border:
      '1px solid #CBD5E1',

    borderRadius:
      10,

    fontSize:
      14,

    outline:
      'none',
  };

const primaryButtonStyle:
  CSSProperties = {
    border:
      'none',

    borderRadius:
      10,

    padding:
      '10px 16px',

    background:
      '#1565C0',

    color:
      '#FFFFFF',

    fontWeight:
      700,

    cursor:
      'pointer',
  };

const secondaryButtonStyle:
  CSSProperties = {
    border:
      '1px solid #CBD5E1',

    borderRadius:
      10,

    padding:
      '10px 16px',

    background:
      '#FFFFFF',

    color:
      '#475569',

    fontWeight:
      700,

    cursor:
      'pointer',
  };