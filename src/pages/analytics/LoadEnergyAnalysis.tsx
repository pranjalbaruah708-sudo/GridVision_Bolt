import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  CSSProperties,
  ReactNode,
} from "react";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Clock3,
  Database,
  Gauge,
  Info,
  RefreshCw,
  Thermometer,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";

import { api } from "@/services/api";

import type {
  LoadAnalysisOverviewRow,
  LoadAnalysisFeederDailyProfileRow,
  LoadAnalysisParameterHealthDetailRow,
  LoadAnalysisParameterHealthRow,
  LoadAnalysisRankingRow,
  ParameterHealthDetailMetric,
} from "@/services/api";

import type {
  Feeder,
  Station,
} from "@/types";

/* =========================================================
   TYPES
========================================================= */

type Period =
  | "Last 7 Days"
  | "Last 15 Days"
  | "Last 30 Days"
  | "Last 3 Months"
  | "Custom";

type CustomRange = {
  startDate: string;
  endDate: string;
};

type FillStatus =
  | "EMPTY"
  | "PARTIAL"
  | "FULL"
  | "FUTURE";

type LoadAnalysisRow = {
  id: string;
  station_id: string;
  feeder_id: string | null;
  operator_id: string | null;
  actual_event_time: string;

  mw: number | null;
  mvar: number | null;
  voltage_kv: number | null;
  current_a: number | null;
  power_factor: number | null;
  frequency_hz: number | null;
  transformer_temp_c: number | null;
  oil_level_percent: number | null;
  tap_position: number | null;

  weather: string | null;
  remarks: string | null;
  updated_at: string;
};

type SummaryMetric = {
  value: number | null;
  timestamp: string | null;
};

type HourAggregate = {
  key: string;
  timestamp: string;
  label: string;
  value: number | null;
  status: FillStatus;
  entered: number;
  expected: number;
};

type DailyTrendRow = {
  date: string;
  label: string;
  value: number | null;
  timestamp: string | null;
  status: FillStatus;
};

type RankingMetric =
  | "PEAK_MW"
  | "MIN_PF"
  | "COMPLETENESS";

type RankingRow = {
  id: string;
  name: string;
  value: number | null;
  completeness: number;
};

type FeederParameter =
  | "MW"
  | "MVAR"
  | "VOLTAGE"
  | "CURRENT"
  | "PF";

type FeederChartRow = {
  hour: number;
  label: string;
  value: number | null;
  status: FillStatus;
  row: LoadAnalysisRow | null;
};

type FeederDayIndex = {
  byHour: Map<number, LoadAnalysisRow>;
  series: Record<FeederParameter, FeederChartRow[]>;
};

type FeederRangeChartRow = FeederChartRow & {
  date: string;
  sourceTime: string | null;
};

type HeatmapCell = {
  date: string;
  hour: number;
  status: FillStatus;
  entered: number;
  expected: number;
  missingFeederIds: string[];
};

type SelectedHeatmapCell =
  HeatmapCell | null;

type AnalyticsResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  key: string | null;
  fetchedAt: number | null;
};

type RetryableResource =
  | "overview"
  | "ranking"
  | "health"
  | "healthDetails"
  | "feederDay"
  | "feederRange";

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
  lastAccessedAt: number;
};

/* =========================================================
   CONSTANTS
========================================================= */

const PERIODS: Period[] = [
  "Last 7 Days",
  "Last 15 Days",
  "Last 30 Days",
  "Last 3 Months",
  "Custom",
];

// Temporary performance-test switch. Keep false until the heatmap is re-enabled.
const HEATMAP_ENABLED_FOR_PERFORMANCE_TEST = false;
const ANALYTICS_CACHE_LIMIT = 60;
const TODAY_CACHE_TTL_MS = 5 * 60 * 1000;

function createAnalyticsResource<T>(): AnalyticsResource<T> {
  return { data: null, loading: false, error: null, key: null, fetchedAt: null };
}

function normalizeAnalyticsScope(value: string | null | undefined): string {
  return value ? value : "ALL";
}

function isRangeCurrent(range: CustomRange): boolean {
  return range.endDate >= getTodayIST();
}

function getAnalyticsCacheKey(
  resource: string,
  stationId: string | null | undefined,
  feederId: string | null | undefined,
  startIso: string,
  endIso: string
): string {
  return `${resource}|${normalizeAnalyticsScope(stationId)}|${normalizeAnalyticsScope(feederId)}|${startIso}|${endIso}`;
}

function getFeederDayCacheKey(feederId: string, istDate: string): string {
  return `feederDay|${feederId}|${istDate}`;
}

function getFeederRangeCacheKey(
  feederId: string,
  parameter: FeederParameter,
  startIso: string,
  endIso: string
): string {
  return `feederRange|${feederId}|${parameter}|${startIso}|${endIso}`;
}

function getHealthDetailCacheKey(
  metric: ParameterHealthDetailMetric,
  stationId: string | null,
  feederId: string | null,
  startIso: string,
  endIso: string
): string {
  return getAnalyticsCacheKey(
    `healthDetails:${metric}`,
    stationId,
    feederId,
    startIso,
    endIso
  );
}

function readAnalyticsCache<T>(cache: Map<string, CacheEntry<T>>, key: string, isCurrent: boolean): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  if (isCurrent && Date.now() - entry.fetchedAt > TODAY_CACHE_TTL_MS) return null;
  return entry.data;
}

function writeAnalyticsCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now(), lastAccessedAt: Date.now() });
  if (cache.size <= ANALYTICS_CACHE_LIMIT) return;
  const oldest = [...cache.entries()].reduce((previous, candidate) =>
    candidate[1].lastAccessedAt < previous[1].lastAccessedAt ? candidate : previous
  );
  cache.delete(oldest[0]);
}

const RANKING_OPTIONS: {
  value: RankingMetric;
  label: string;
}[] = [
  {
    value: "PEAK_MW",
    label: "Peak MW",
  },
  {
    value: "MIN_PF",
    label: "Min PF",
  },
  {
    value: "COMPLETENESS",
    label: "Data Completeness",
  },
];

const FEEDER_PARAMETERS: {
  value: FeederParameter;
  label: string;
  unit: string;
}[] = [
  {
    value: "MW",
    label: "MW",
    unit: "MW",
  },
  {
    value: "MVAR",
    label: "MVAR",
    unit: "MVAR",
  },
  {
    value: "VOLTAGE",
    label: "Voltage",
    unit: "kV",
  },
  {
    value: "CURRENT",
    label: "Current",
    unit: "A",
  },
  {
    value: "PF",
    label: "PF",
    unit: "",
  },
];

const BLUE = "#2563EB";
const ORANGE = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#16A34A";
const GREY = "#CBD5E1";

/*
 * Only use thresholds that are universal enough for the
 * current application.
 *
 * Voltage/current/temperature alarm thresholds are NOT
 * hard-coded here because those should depend on equipment
 * and voltage level/configuration.
 */
const PF_ATTENTION_LEVEL = 0.9;

/* =========================================================
   DATE HELPERS
========================================================= */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getTodayIST(): string {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );

  const parts =
    formatter.formatToParts(
      new Date()
    );

  const year =
    parts.find(
      (part) =>
        part.type === "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type === "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type === "day"
    )?.value;

  return `${year}-${month}-${day}`;
}

function getCurrentHourIST(): number {
  return Number(
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hourCycle: "h23",
      }
    ).format(new Date())
  );
}

function addDays(
  dateString: string,
  days: number
): string {
  const [
    year,
    month,
    day,
  ] = dateString
    .split("-")
    .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCDate(
    date.getUTCDate() +
      days
  );

  return [
    date.getUTCFullYear(),
    pad2(
      date.getUTCMonth() + 1
    ),
    pad2(
      date.getUTCDate()
    ),
  ].join("-");
}

function addYears(
  dateString: string,
  years: number
): string {
  const [
    year,
    month,
    day,
  ] = dateString
    .split("-")
    .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCFullYear(
    date.getUTCFullYear() +
      years
  );

  return [
    date.getUTCFullYear(),
    pad2(
      date.getUTCMonth() + 1
    ),
    pad2(
      date.getUTCDate()
    ),
  ].join("-");
}

function getPeriodRange(
  period: Period,
  customRange: CustomRange
): CustomRange {
  if (period === "Custom") {
    return customRange;
  }

  const today =
    getTodayIST();

  let days = 7;

  if (
    period ===
    "Last 15 Days"
  ) {
    days = 15;
  } else if (
    period ===
    "Last 30 Days"
  ) {
    days = 30;
  } else if (
    period ===
    "Last 3 Months"
  ) {
    days = 90;
  }

  return {
    startDate:
      addDays(
        today,
        -(days - 1)
      ),

    endDate:
      today,
  };
}

function getDatesInRange(
  startDate: string,
  endDate: string
): string[] {
  const dates: string[] = [];

  let current =
    startDate;

  while (
    current <= endDate
  ) {
    dates.push(current);

    current =
      addDays(
        current,
        1
      );
  }

  return dates;
}

function getISTDate(
  timestamp: string
): string {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );

  const parts =
    formatter.formatToParts(
      new Date(timestamp)
    );

  const year =
    parts.find(
      (part) =>
        part.type === "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type === "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type === "day"
    )?.value;

  return `${year}-${month}-${day}`;
}

function getISTHour(
  timestamp: string
): number {
  return Number(
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hourCycle: "h23",
      }
    ).format(
      new Date(timestamp)
    )
  );
}

function formatDate(
  date: string
): string {
  if (!date) {
    return "—";
  }

  const [
    year,
    month,
    day,
  ] = date
    .split("-")
    .map(Number);

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    )
  );
}

function formatShortDate(
  date: string
): string {
  if (!date) {
    return "";
  }

  const [
    year,
    month,
    day,
  ] = date
    .split("-")
    .map(Number);

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
    }
  ).format(
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    )
  );
}

function formatTimestamp(
  timestamp: string | null
): string {
  if (!timestamp) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }
  ).format(
    new Date(timestamp)
  );
}

function expectedHoursForDate(
  date: string
): number {
  const today =
    getTodayIST();

  if (date > today) {
    return 0;
  }

  if (date === today) {
    return (
      getCurrentHourIST() + 1
    );
  }

  return 24;
}

/* =========================================================
   DATABASE RANGE
========================================================= */

function rangeToIso(
  range: CustomRange
): {
  startIso: string;
  endIso: string;
} {
  const start =
    new Date(
      `${range.startDate}T00:00:00+05:30`
    );

  const endDate =
    addDays(
      range.endDate,
      1
    );

  const end =
    new Date(
      `${endDate}T00:00:00+05:30`
    );

  return {
    startIso:
      start.toISOString(),

    endIso:
      end.toISOString(),
  };
}

function deduplicateLatestFeederHours(
  rows: LoadAnalysisRow[]
): LoadAnalysisRow[] {
  const latestByFeederHour = new Map<string, LoadAnalysisRow>();

  for (const row of rows) {
    if (!row.feeder_id) {
      continue;
    }

    const key = `${row.feeder_id}|${getISTDate(row.actual_event_time)}|${getISTHour(row.actual_event_time)}`;
    const current = latestByFeederHour.get(key);

    if (!current || row.updated_at >= current.updated_at) {
      latestByFeederHour.set(key, row);
    }
  }

  return Array.from(latestByFeederHour.values()).sort(
    (left, right) =>
      left.actual_event_time.localeCompare(right.actual_event_time) ||
      left.updated_at.localeCompare(right.updated_at)
  );
}

/* =========================================================
   COMPLETENESS HELPERS
========================================================= */

function buildExpectedFeederSet(
  feeders: Feeder[],
  stationId: string
): Set<string> {
  return new Set(
    feeders
      .filter(
        (feeder) =>
          !stationId ||
          feeder.station_id ===
            stationId
      )
      .map(
        (feeder) =>
          feeder.id
      )
  );
}

function getScopeCompleteness(
  rows: LoadAnalysisRow[],
  expectedFeederIds: Set<string>,
  range: CustomRange
): {
  entered: number;
  expected: number;
  percent: number;
} {
  const entered =
    new Set<string>();

  let expected = 0;

  for (
    const date of
    getDatesInRange(
      range.startDate,
      range.endDate
    )
  ) {
    expected +=
      expectedFeederIds.size *
      expectedHoursForDate(
        date
      );
  }

  for (
    const row of rows
  ) {
    if (
      !row.feeder_id ||
      !expectedFeederIds.has(
        row.feeder_id
      )
    ) {
      continue;
    }

    const date =
      getISTDate(
        row.actual_event_time
      );

    const hour =
      getISTHour(
        row.actual_event_time
      );

    const expectedHours =
      expectedHoursForDate(
        date
      );

    if (
      expectedHours === 0 ||
      hour >= expectedHours
    ) {
      continue;
    }

    entered.add(
      `${row.feeder_id}|${date}|${hour}`
    );
  }

  return {
    entered:
      entered.size,

    expected,

    percent:
      expected > 0
        ? Math.min(
            100,
            (entered.size /
              expected) *
              100
          )
        : 0,
  };
}

function getHourStatus(
  rows: LoadAnalysisRow[],
  expectedFeederIds:
    Set<string>,
  date: string,
  hour: number
): {
  status: FillStatus;
  entered: number;
  expected: number;
  missingFeederIds: string[];
} {
  const today =
    getTodayIST();

  if (
    date > today ||
    (
      date === today &&
      hour >
        getCurrentHourIST()
    )
  ) {
    return {
      status: "FUTURE",
      entered: 0,
      expected: 0,
      missingFeederIds: [],
    };
  }

  const enteredIds =
    new Set<string>();

  for (
    const row of rows
  ) {
    if (
      !row.feeder_id ||
      !expectedFeederIds.has(
        row.feeder_id
      )
    ) {
      continue;
    }

    if (
      getISTDate(
        row.actual_event_time
      ) !== date ||
      getISTHour(
        row.actual_event_time
      ) !== hour
    ) {
      continue;
    }

    enteredIds.add(
      row.feeder_id
    );
  }

  const expected =
    expectedFeederIds.size;

  const missingFeederIds =
    Array.from(
      expectedFeederIds
    ).filter(
      (id) =>
        !enteredIds.has(id)
    );

  if (expected === 0) {
    return {
      status: "EMPTY",
      entered: 0,
      expected: 0,
      missingFeederIds,
    };
  }

  if (
    enteredIds.size === 0
  ) {
    return {
      status: "EMPTY",
      entered: 0,
      expected,
      missingFeederIds,
    };
  }

  if (
    enteredIds.size >=
    expected
  ) {
    return {
      status: "FULL",
      entered:
        enteredIds.size,
      expected,
      missingFeederIds,
    };
  }

  return {
    status: "PARTIAL",
    entered:
      enteredIds.size,
    expected,
    missingFeederIds,
  };
}

/* =========================================================
   HOURLY MW AGGREGATION
========================================================= */

function buildHourlyMw(
  rows: LoadAnalysisRow[],
  expectedFeederIds:
    Set<string>
): HourAggregate[] {
  const groups =
    new Map<
      string,
      {
        date: string;
        hour: number;
        total: number;
        mwCount: number;
        feederIds: Set<string>;
        timestamp: string;
      }
    >();

  for (
    const row of rows
  ) {
    /*
     * Analytics is feeder based.
     * feeder_id = null rows are deliberately excluded.
     */
    if (
      !row.feeder_id ||
      !expectedFeederIds.has(
        row.feeder_id
      )
    ) {
      continue;
    }

    const date =
      getISTDate(
        row.actual_event_time
      );

    const hour =
      getISTHour(
        row.actual_event_time
      );

    const key =
      `${date}|${hour}`;

    const current =
      groups.get(key) ?? {
        date,
        hour,
        total: 0,
        mwCount: 0,
        feederIds:
          new Set<string>(),
        timestamp:
          row.actual_event_time,
      };

    current.feederIds.add(
      row.feeder_id
    );

    if (
      row.mw !== null
    ) {
      current.total +=
        Number(row.mw);

      current.mwCount += 1;
    }

    groups.set(
      key,
      current
    );
  }

  return Array.from(
    groups.values()
  )
    .sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        ) ||
        a.hour - b.hour
    )
      .map(
      (group) => {
        const entered = group.feederIds.size;
        const expected = expectedFeederIds.size;
        const status: FillStatus =
          expected === 0 || entered === 0
            ? "EMPTY"
            : entered >= expected
              ? "FULL"
              : "PARTIAL";

        return {
          key:
            `${group.date}|${group.hour}`,

          timestamp:
            group.timestamp,

          label:
            `${formatShortDate(
              group.date
            )} ${pad2(
              group.hour
            )}:00`,

          value:
            group.mwCount > 0
              ? Number(
                  group.total.toFixed(
                    3
                  )
                )
              : null,

          status,

          entered:
            entered,

          expected:
            expected,
        };
      }
    );
}

/* =========================================================
   DAILY PEAK TREND
========================================================= */

function buildDailyTrend(
  hourly: HourAggregate[],
  range: CustomRange
): DailyTrendRow[] {
  return getDatesInRange(
    range.startDate,
    range.endDate
  ).map(
    (date) => {
      const values =
        hourly.filter(
          (row) =>
            row.key.startsWith(
              `${date}|`
            ) &&
            row.value !== null
        );

      if (
        values.length === 0
      ) {
        return {
          date,
          label:
            formatShortDate(
              date
            ),
          value: null,
          timestamp: null,
          status: "EMPTY",
        };
      }

      const peak =
        values.reduce(
          (
            highest,
            current
          ) =>
            (
              current.value ??
              -Infinity
            ) >
            (
              highest.value ??
              -Infinity
            )
              ? current
              : highest
        );

      const hasPartial =
        values.some(
          (row) =>
            row.status ===
            "PARTIAL"
        );

      const allFull =
        values.every(
          (row) =>
            row.status ===
            "FULL"
        );

      return {
        date,
        label:
          formatShortDate(
            date
          ),
        value:
          peak.value,
        timestamp:
          peak.timestamp,
        status:
          allFull
            ? "FULL"
            : hasPartial
              ? "PARTIAL"
              : peak.status,
      };
    }
  );
}

/* =========================================================
   SUMMARY METRICS
========================================================= */

function findPeakDemand(
  hourly: HourAggregate[]
): SummaryMetric {
  const rows =
    hourly.filter(
      (row) =>
        row.value !== null
    );

  if (
    rows.length === 0
  ) {
    return {
      value: null,
      timestamp: null,
    };
  }

  const peak =
    rows.reduce(
      (
        highest,
        current
      ) =>
        (
          current.value ??
          -Infinity
        ) >
        (
          highest.value ??
          -Infinity
        )
          ? current
          : highest
    );

  return {
    value:
      peak.value,
    timestamp:
      peak.timestamp,
  };
}

function findMinimumMetric(
  rows: LoadAnalysisRow[],
  getter:
    (
      row: LoadAnalysisRow
    ) => number | null
): SummaryMetric {
  let best:
    LoadAnalysisRow | null =
      null;

  let bestValue:
    number | null =
      null;

  for (
    const row of rows
  ) {
    if (!row.feeder_id) {
      continue;
    }

    const value =
      getter(row);

    if (
      value === null ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    if (
      bestValue === null ||
      value < bestValue
    ) {
      bestValue = value;
      best = row;
    }
  }

  return {
    value:
      bestValue,

    timestamp:
      best
        ? best.actual_event_time
        : null,
  };
}

function findMaximumMetric(
  rows: LoadAnalysisRow[],
  getter:
    (
      row: LoadAnalysisRow
    ) => number | null
): SummaryMetric {
  let best:
    LoadAnalysisRow | null =
      null;

  let bestValue:
    number | null =
      null;

  for (
    const row of rows
  ) {
    if (!row.feeder_id) {
      continue;
    }

    const value =
      getter(row);

    if (
      value === null ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    if (
      bestValue === null ||
      value > bestValue
    ) {
      bestValue = value;
      best = row;
    }
  }

  return {
    value:
      bestValue,

    timestamp:
      best
        ? best.actual_event_time
        : null,
  };
}

/* =========================================================
   FEEDER PROFILE
========================================================= */

function getParameterValue(
  row: LoadAnalysisRow,
  parameter: FeederParameter
): number | null {
  switch (parameter) {
    case "MW":
      return row.mw;

    case "MVAR":
      return row.mvar;

    case "VOLTAGE":
      return row.voltage_kv;

    case "CURRENT":
      return row.current_a;

    case "PF":
      return row.power_factor;
  }
}

function buildFeederDayIndex(
  rows: LoadAnalysisRow[],
  date: string
): FeederDayIndex {
  const byHour = new Map<number, LoadAnalysisRow>();

  for (const row of deduplicateLatestFeederHours(rows)) {
    if (getISTDate(row.actual_event_time) === date) {
      byHour.set(getISTHour(row.actual_event_time), row);
    }
  }

  const parameters: FeederParameter[] = [
    "MW",
    "MVAR",
    "VOLTAGE",
    "CURRENT",
    "PF",
  ];
  const series = {} as Record<FeederParameter, FeederChartRow[]>;

  for (const parameter of parameters) {
    series[parameter] = Array.from({ length: 24 }, (_, hour) => {
      const isFuture =
        date > getTodayIST() ||
        (date === getTodayIST() && hour > getCurrentHourIST());
      const row = byHour.get(hour) ?? null;

      return {
        hour,
        label: `${pad2(hour)}:00`,
        value: row ? getParameterValue(row, parameter) : null,
        status: isFuture ? "FUTURE" : row ? "FULL" : "EMPTY",
        row,
      };
    });
  }

  return { byHour, series };
}

/* =========================================================
   HEATMAP
========================================================= */

function buildHeatmap(
  rows: LoadAnalysisRow[],
  expectedFeederIds:
    Set<string>,
  range: CustomRange
): HeatmapCell[] {
  const cells:
    HeatmapCell[] = [];

  for (
    const date of
    getDatesInRange(
      range.startDate,
      range.endDate
    )
  ) {
    for (
      let hour = 0;
      hour < 24;
      hour += 1
    ) {
      const result =
        getHourStatus(
          rows,
          expectedFeederIds,
          date,
          hour
        );

      cells.push({
        date,
        hour,
        ...result,
      });
    }
  }

  return cells;
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function LoadEnergyAnalysis() {
  const resourceGenerations = useRef<Record<string, number>>({});
  const resourceActiveKeys = useRef<Record<string, string>>({});
  const overviewCache = useRef(new Map<string, CacheEntry<LoadAnalysisOverviewRow>>());
  const trendCache = useRef(new Map<string, CacheEntry<DailyTrendRow[]>>());
  const rankingCache = useRef(new Map<string, CacheEntry<LoadAnalysisRankingRow[]>>());
  const healthCache = useRef(new Map<string, CacheEntry<LoadAnalysisParameterHealthRow>>());
  const healthDetailCache = useRef(new Map<string, CacheEntry<LoadAnalysisParameterHealthDetailRow[]>>());
  const feederDayCache = useRef(new Map<string, CacheEntry<LoadAnalysisRow[]>>());
  const feederRangeCache = useRef(new Map<string, CacheEntry<LoadAnalysisFeederDailyProfileRow[]>>());

  const [overviewResource, setOverviewResource] = useState<AnalyticsResource<LoadAnalysisOverviewRow>>(createAnalyticsResource);
  const [trendResource, setTrendResource] = useState<AnalyticsResource<DailyTrendRow[]>>(createAnalyticsResource);
  const [rankingResource, setRankingResource] = useState<AnalyticsResource<LoadAnalysisRankingRow[]>>(createAnalyticsResource);
  const [healthResource, setHealthResource] = useState<AnalyticsResource<LoadAnalysisParameterHealthRow>>(createAnalyticsResource);
  const [healthDetailResource, setHealthDetailResource] = useState<AnalyticsResource<LoadAnalysisParameterHealthDetailRow[]>>(createAnalyticsResource);
  const [feederDayResource, setFeederDayResource] = useState<AnalyticsResource<LoadAnalysisRow[]>>(createAnalyticsResource);
  const [feederRangeResource, setFeederRangeResource] = useState<AnalyticsResource<LoadAnalysisFeederDailyProfileRow[]>>(createAnalyticsResource);
  const serverTrend = trendResource.data ?? [];
  const trendLoading = trendResource.loading;
  const trendError = trendResource.error;
  const overviewLoading = overviewResource.loading;
  const rankingLoading = rankingResource.loading;
  const healthLoading = healthResource.loading;
  const feederDetailLoading = feederDayResource.loading;
  const rows = feederDayResource.data ?? [];
  const [resourceRetryVersions, setResourceRetryVersions] = useState<Record<RetryableResource, number>>({
    overview: 0,
    ranking: 0,
    health: 0,
    healthDetails: 0,
    feederDay: 0,
    feederRange: 0,
  });

  const beginResourceRequest = useCallback((resource: string, key: string): number => {
    const next = (resourceGenerations.current[resource] ?? 0) + 1;
    resourceGenerations.current[resource] = next;
    resourceActiveKeys.current[resource] = key;
    return next;
  }, []);

  const isCurrentResourceGeneration = useCallback((resource: string, generation: number, key: string): boolean =>
    resourceGenerations.current[resource] === generation &&
    resourceActiveKeys.current[resource] === key, []);
  const retryResource = useCallback((resource: RetryableResource) => {
    const key =
      resource === "overview"
        ? overviewResource.key
        : resource === "ranking"
          ? rankingResource.key
          : resource === "health"
            ? healthResource.key
            : resource === "healthDetails"
              ? healthDetailResource.key
            : resource === "feederDay"
              ? feederDayResource.key
              : feederRangeResource.key;

    if (key) {
      const cache =
        resource === "overview"
          ? overviewCache.current
          : resource === "ranking"
            ? rankingCache.current
            : resource === "health"
              ? healthCache.current
              : resource === "healthDetails"
                ? healthDetailCache.current
              : resource === "feederDay"
                ? feederDayCache.current
                : feederRangeCache.current;
      cache.delete(key);
    }

    setResourceRetryVersions((current) => ({
      ...current,
      [resource]: current[resource] + 1,
    }));
  }, [feederDayResource.key, feederRangeResource.key, healthDetailResource.key, healthResource.key, overviewResource.key, rankingResource.key]);
  const [
    stations,
    setStations,
  ] = useState<
    Station[]
  >([]);

  const [
    feeders,
    setFeeders,
  ] = useState<
    Feeder[]
  >([]);

  const [
    selectedStationId,
    setSelectedStationId,
  ] = useState("");

  const [
    selectedFeederId,
    setSelectedFeederId,
  ] = useState("");

  const [
    period,
    setPeriod,
  ] = useState<Period>(
    "Last 7 Days"
  );

  const [
    customRange,
    setCustomRange,
  ] = useState<CustomRange>({
    startDate:
      addDays(
        getTodayIST(),
        -6
      ),

    endDate:
      getTodayIST(),
  });

  const [
    lookupError,
    setLookupError,
  ] = useState<
    string | null
  >(null);

  const [
    rankingMetric,
    setRankingMetric,
  ] =
    useState<RankingMetric>(
      "PEAK_MW"
    );

  const [
    feederParameter,
    setFeederParameter,
  ] =
    useState<FeederParameter>(
      "MW"
    );

  const [
    feederProfileDate,
    setFeederProfileDate,
  ] = useState(
    getTodayIST()
  );

  const [
    feederProfileStartDate,
    setFeederProfileStartDate,
  ] = useState(
    getTodayIST()
  );

  const [
    feederProfileEndDate,
    setFeederProfileEndDate,
  ] = useState(
    getTodayIST()
  );

  const [
    feederProfileRangeError,
    setFeederProfileRangeError,
  ] = useState<string | null>(null);

  const [
    showCustomModal,
    setShowCustomModal,
  ] = useState(false);

  const [
    modalStartDate,
    setModalStartDate,
  ] = useState(
    customRange.startDate
  );

  const [
    modalEndDate,
    setModalEndDate,
  ] = useState(
    customRange.endDate
  );

  const [
    modalError,
    setModalError,
  ] = useState("");

  const [
    selectedHeatmapCell,
    setSelectedHeatmapCell,
  ] =
    useState<SelectedHeatmapCell>(
      null
    );

  const [
    selectedHourRow,
    setSelectedHourRow,
  ] =
    useState<
    LoadAnalysisRow | null
  >(null);

  const [
    selectedHealthMetric,
    setSelectedHealthMetric,
  ] = useState<
    ParameterHealthDetailMetric | null
  >(null);

  const [
    pendingRangeSourceTime,
    setPendingRangeSourceTime,
  ] = useState<string | null>(null);

  const controlsBusy =
    overviewLoading || trendLoading || rankingLoading || healthLoading;

  /* =======================================================
     RANGE
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

  /* =======================================================
     LOAD LOOKUPS
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadLookups() {
      try {
        const [
          stationRows,
          feederRows,
        ] =
          await Promise.all([
            api.getStations(),
            api.getFeeders(),
          ]);

        if (cancelled) {
          return;
        }

        setStations(
          stationRows
        );

        setFeeders(
          feederRows.filter(
            (feeder) =>
              feeder.active !==
              false
          )
        );
      } catch (e) {
        console.error(
          "Failed to load analysis lookups:",
          e
        );

        if (!cancelled) {
          setLookupError(
            e instanceof Error
              ? e.message
              : "Failed to load stations/feeders."
          );
        }
      }
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, []);

  /* =======================================================
     SELECTED STATION FEEDERS
  ======================================================= */

  const selectedStationFeeders =
    useMemo(
      () =>
        selectedStationId
          ? feeders.filter(
              (feeder) =>
                feeder.station_id ===
                selectedStationId
            )
          : [],
      [
        feeders,
        selectedStationId,
      ]
    );

  /* =======================================================
     RESET FEEDER WHEN STATION CHANGES
  ======================================================= */

  useEffect(() => {
    if (
      !selectedStationId
    ) {
      setSelectedFeederId(
        ""
      );

      return;
    }

    if (
      selectedFeederId &&
      selectedStationFeeders.some(
        (feeder) =>
          feeder.id ===
          selectedFeederId
      )
    ) {
      return;
    }

    setSelectedFeederId(
      ""
    );
  }, [
    selectedStationId,
    selectedStationFeeders,
    selectedFeederId,
  ]);

  /* =======================================================
     PROFILE DATE
  ======================================================= */

  useEffect(() => {
    setFeederProfileDate(
      range.endDate
    );
    setFeederProfileStartDate(
      range.endDate
    );
    setFeederProfileEndDate(
      range.endDate
    );
    setFeederProfileRangeError(null);
  }, [
    range.startDate,
    range.endDate,
  ]);


  /* =========================================================
   LOAD AGGREGATED LOAD TREND FROM DATABASE

   The load trend is calculated by PostgreSQL through the
   get_load_analysis_daily_trend RPC.

   This avoids downloading thousands of log_book_entries
   merely to construct the trend curve.
========================================================= */

const loadTrend = useCallback(
  async (forceRefresh = false) => {
    const { startIso, endIso } = rangeToIso(range);
    const stationId = selectedStationId || null;
    const feederId = selectedFeederId || null;
    const key = getAnalyticsCacheKey(
      "trend",
      stationId,
      feederId,
      startIso,
      endIso
    );
    const cached = forceRefresh
      ? null
      : readAnalyticsCache(
          trendCache.current,
          key,
          isRangeCurrent(range)
        );
    const generation = beginResourceRequest("trend", key);

    setTrendResource((current) => ({
      data: cached ?? current.data,
      loading: !cached || forceRefresh,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached && !forceRefresh) {
      return;
    }

    try {
      const result = await api.getLoadAnalysisDailyTrend(
        startIso,
        endIso,
        stationId,
        feederId
      );
      const byDate = new Map(
        result.map((row) => [row.trend_date, row])
      );
      const completed: DailyTrendRow[] = getDatesInRange(
        range.startDate,
        range.endDate
      ).map((date) => {
        const row = byDate.get(date);

        if (!row) {
          return {
            date,
            label: formatShortDate(date),
            value: null,
            timestamp: null,
            status: "EMPTY",
          };
        }

        return {
          date,
          label: formatShortDate(date),
          value: row.peak_mw,
          timestamp: row.peak_time,
          status: row.fill_status,
        };
      });

      if (!isCurrentResourceGeneration("trend", generation, key)) {
        return;
      }

      writeAnalyticsCache(trendCache.current, key, completed);
      setTrendResource({
        data: completed,
        loading: false,
        error: null,
        key,
        fetchedAt: Date.now(),
      });
    } catch (requestError) {
      if (!isCurrentResourceGeneration("trend", generation, key)) {
        return;
      }

      console.error("Failed to load aggregated load trend:", requestError);
      setTrendResource((current) => ({
        ...current,
        loading: false,
        error:
          requestError instanceof Error
            ? requestError.message
            : "Failed to load load trend.",
        key,
      }));
    }
  },
  [
    beginResourceRequest,
    isCurrentResourceGeneration,
    range,
    selectedStationId,
    selectedFeederId,
  ]
);
  /* =======================================================
     FEEDER-DAY DETAIL
  ======================================================= */

  useEffect(() => {
    if (!selectedFeederId) {
      beginResourceRequest("feederDay", "NONE");
      setFeederDayResource(createAnalyticsResource<LoadAnalysisRow[]>());
      setSelectedHourRow(null);
      return;
    }

    const key = getFeederDayCacheKey(selectedFeederId, feederProfileDate);
    const cached = readAnalyticsCache(
      feederDayCache.current,
      key,
      feederProfileDate === getTodayIST()
    );
    const generation = beginResourceRequest("feederDay", key);
    const dayRange = {
      startDate: feederProfileDate,
      endDate: feederProfileDate,
    };
    const { startIso, endIso } = rangeToIso(dayRange);

    setSelectedHourRow(null);
    setFeederDayResource((current) => ({
      data: cached ?? current.data,
      loading: !cached,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached) {
      return;
    }

    void api.getLoadAnalysisFeederDayReadings(
      selectedFeederId,
      startIso,
      endIso
    )
      .then((data) => {
        if (!isCurrentResourceGeneration("feederDay", generation, key)) {
          return;
        }

        const feederDayRows = data as LoadAnalysisRow[];
        writeAnalyticsCache(feederDayCache.current, key, feederDayRows);
        setFeederDayResource({
          data: feederDayRows,
          loading: false,
          error: null,
          key,
          fetchedAt: Date.now(),
        });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("feederDay", generation, key)) {
          return;
        }

        setFeederDayResource((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not load feeder-day readings.",
          key,
        }));
      });
  }, [
    beginResourceRequest,
    feederProfileDate,
    isCurrentResourceGeneration,
    resourceRetryVersions.feederDay,
    selectedFeederId,
  ]);

  /* =======================================================
     FEEDER RANGE PROFILE

     Multi-day feeder charts use a compact server aggregate. Detailed raw
     readings remain limited to feederDayResource above.
  ======================================================= */

  const feederProfileRangeIsValid =
    feederProfileStartDate >= range.startDate &&
    feederProfileEndDate <= range.endDate &&
    feederProfileStartDate <= feederProfileEndDate;

  const feederProfileIsRange =
    feederProfileStartDate !== feederProfileEndDate;

  useEffect(() => {
    if (!selectedFeederId || !feederProfileIsRange) {
      beginResourceRequest("feederRange", "NONE");
      setFeederRangeResource(createAnalyticsResource<LoadAnalysisFeederDailyProfileRow[]>());
      return;
    }

    if (!feederProfileRangeIsValid) {
      beginResourceRequest("feederRange", "INVALID");
      setFeederRangeResource((current) => ({
        ...current,
        loading: false,
        error: "Choose dates within the selected analysis period.",
        key: "INVALID",
      }));
      return;
    }

    const profileRange = {
      startDate: feederProfileStartDate,
      endDate: feederProfileEndDate,
    };
    const { startIso, endIso } = rangeToIso(profileRange);
    const key = getFeederRangeCacheKey(
      selectedFeederId,
      feederParameter,
      startIso,
      endIso
    );
    const cached = readAnalyticsCache(
      feederRangeCache.current,
      key,
      isRangeCurrent(profileRange)
    );
    const generation = beginResourceRequest("feederRange", key);

    setFeederRangeResource((current) => ({
      data: cached ?? current.data,
      loading: !cached,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached) {
      return;
    }

    void api.getLoadAnalysisFeederDailyProfile(
      selectedFeederId,
      startIso,
      endIso,
      feederParameter
    )
      .then((data) => {
        if (!isCurrentResourceGeneration("feederRange", generation, key)) {
          return;
        }

        writeAnalyticsCache(feederRangeCache.current, key, data);
        setFeederRangeResource({
          data,
          loading: false,
          error: null,
          key,
          fetchedAt: Date.now(),
        });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("feederRange", generation, key)) {
          return;
        }

        setFeederRangeResource((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not load feeder range profile.",
          key,
        }));
      });
  }, [
    beginResourceRequest,
    feederParameter,
    feederProfileEndDate,
    feederProfileIsRange,
    feederProfileRangeIsValid,
    feederProfileStartDate,
    isCurrentResourceGeneration,
    range.endDate,
    range.startDate,
    resourceRetryVersions.feederRange,
    selectedFeederId,
  ]);

  useEffect(() => {
  void loadTrend();
}, [loadTrend]);

  useEffect(() => {
    const { startIso, endIso } = rangeToIso(range);
    const stationId = selectedStationId || null;
    const feederId = selectedFeederId || null;
    const key = getAnalyticsCacheKey("overview", stationId, feederId, startIso, endIso);
    const cached = readAnalyticsCache(overviewCache.current, key, isRangeCurrent(range));
    const generation = beginResourceRequest("overview", key);

    setOverviewResource((current) => ({
      data: cached ?? current.data,
      loading: true,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached) {
      setOverviewResource((current) => ({ ...current, loading: false, data: cached, key, fetchedAt: Date.now() }));
      return;
    }

    void api.getLoadAnalysisOverview(startIso, endIso, stationId, feederId)
      .then((data) => {
        if (!isCurrentResourceGeneration("overview", generation, key)) return;
        writeAnalyticsCache(overviewCache.current, key, data);
        setOverviewResource({ data, loading: false, error: null, key, fetchedAt: Date.now() });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("overview", generation, key)) return;
        setOverviewResource((current) => ({ ...current, loading: false, error: requestError instanceof Error ? requestError.message : "Could not refresh summary.", key }));
      });
  }, [beginResourceRequest, isCurrentResourceGeneration, range, resourceRetryVersions.overview, selectedFeederId, selectedStationId]);

  useEffect(() => {
    const { startIso, endIso } = rangeToIso(range);
    const stationId = selectedStationId || null;
    const resourceName = stationId ? "feederRanking" : "stationRanking";
    const key = getAnalyticsCacheKey(
      resourceName,
      stationId,
      null,
      startIso,
      endIso
    );
    const cached = readAnalyticsCache(
      rankingCache.current,
      key,
      isRangeCurrent(range)
    );
    const generation = beginResourceRequest("ranking", key);

    setRankingResource((current) => ({
      data: cached ?? current.data,
      loading: !cached,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached) {
      return;
    }

    void api.getLoadAnalysisRanking(startIso, endIso, stationId)
      .then((data) => {
        if (!isCurrentResourceGeneration("ranking", generation, key)) {
          return;
        }

        writeAnalyticsCache(rankingCache.current, key, data);
        setRankingResource({
          data,
          loading: false,
          error: null,
          key,
          fetchedAt: Date.now(),
        });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("ranking", generation, key)) {
          return;
        }

        setRankingResource((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not refresh performance ranking.",
          key,
        }));
      });
  }, [beginResourceRequest, isCurrentResourceGeneration, range, resourceRetryVersions.ranking, selectedStationId]);

  useEffect(() => {
    const { startIso, endIso } = rangeToIso(range);
    const stationId = selectedStationId || null;
    const feederId = selectedFeederId || null;
    const key = getAnalyticsCacheKey(
      "health",
      stationId,
      feederId,
      startIso,
      endIso
    );
    const cached = readAnalyticsCache(
      healthCache.current,
      key,
      isRangeCurrent(range)
    );
    const generation = beginResourceRequest("health", key);

    setHealthResource((current) => ({
      data: cached ?? current.data,
      loading: !cached,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : current.fetchedAt,
    }));

    if (cached) {
      return;
    }

    void api.getLoadAnalysisParameterHealth(
      startIso,
      endIso,
      stationId,
      feederId
    )
      .then((data) => {
        if (!isCurrentResourceGeneration("health", generation, key)) {
          return;
        }

        writeAnalyticsCache(healthCache.current, key, data);
        setHealthResource({
          data,
          loading: false,
          error: null,
          key,
          fetchedAt: Date.now(),
        });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("health", generation, key)) {
          return;
        }

        setHealthResource((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not refresh parameter health.",
          key,
        }));
      });
  }, [beginResourceRequest, isCurrentResourceGeneration, range, resourceRetryVersions.health, selectedFeederId, selectedStationId]);

  /* =======================================================
     PARAMETER HEALTH DETAIL

     Detail rows are intentionally loaded only while the user has opened a
     health modal; the main Parameter Health card remains aggregate-only.
  ======================================================= */

  useEffect(() => {
    if (!selectedHealthMetric) {
      beginResourceRequest("healthDetails", "NONE");
      setHealthDetailResource(
        createAnalyticsResource<LoadAnalysisParameterHealthDetailRow[]>()
      );
      return;
    }

    const { startIso, endIso } = rangeToIso(range);
    const stationId = selectedStationId || null;
    const feederId = selectedFeederId || null;
    const key = getHealthDetailCacheKey(
      selectedHealthMetric,
      stationId,
      feederId,
      startIso,
      endIso
    );
    const cached = readAnalyticsCache(
      healthDetailCache.current,
      key,
      isRangeCurrent(range)
    );
    const generation = beginResourceRequest("healthDetails", key);

    setHealthDetailResource((current) => ({
      data: cached,
      loading: !cached,
      error: null,
      key,
      fetchedAt: cached ? Date.now() : null,
    }));

    if (cached) {
      return;
    }

    void api.getLoadAnalysisParameterHealthDetails(
      startIso,
      endIso,
      selectedHealthMetric,
      stationId,
      feederId,
      50
    )
      .then((data) => {
        if (!isCurrentResourceGeneration("healthDetails", generation, key)) {
          return;
        }

        writeAnalyticsCache(healthDetailCache.current, key, data);
        setHealthDetailResource({
          data,
          loading: false,
          error: null,
          key,
          fetchedAt: Date.now(),
        });
      })
      .catch((requestError: unknown) => {
        if (!isCurrentResourceGeneration("healthDetails", generation, key)) {
          return;
        }

        setHealthDetailResource((current) => ({
          ...current,
          loading: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not load parameter health details.",
          key,
        }));
      });
  }, [
    beginResourceRequest,
    isCurrentResourceGeneration,
    range,
    resourceRetryVersions.healthDetails,
    selectedFeederId,
    selectedHealthMetric,
    selectedStationId,
  ]);

  /* =======================================================
     EXPECTED FEEDERS
  ======================================================= */

  const scopeFeederIds =
    useMemo(
      () =>
        buildExpectedFeederSet(
          feeders,
          selectedStationId
        ),
      [
        feeders,
        selectedStationId,
      ]
    );

  const selectedFeederIds =
    useMemo(
      () =>
        selectedFeederId
          ? new Set([
              selectedFeederId,
            ])
          : scopeFeederIds,
      [
        selectedFeederId,
        scopeFeederIds,
      ]
    );

  const indexedRows =
    useMemo(
      () => deduplicateLatestFeederHours(rows),
      [rows]
    );

  const rowsByFeeder =
    useMemo(() => {
      const next = new Map<string, LoadAnalysisRow[]>();

      for (const row of indexedRows) {
        if (!row.feeder_id) {
          continue;
        }

        const feederRows = next.get(row.feeder_id) ?? [];
        feederRows.push(row);
        next.set(row.feeder_id, feederRows);
      }

      return next;
    }, [indexedRows]);

  /* =======================================================
     CURRENT SCOPE ROWS
  ======================================================= */

  const scopeRows =
    useMemo(
      () => {
        if (
          !selectedFeederId
        ) {
          return indexedRows;
        }

        return rowsByFeeder.get(selectedFeederId) ?? [];
      },
      [
        indexedRows,
        rowsByFeeder,
        selectedFeederId,
      ]
    );

  /* =======================================================
     STATION / FEEDER PERFORMANCE RANKING
  ======================================================= */

  const performanceRanking = useMemo<RankingRow[]>(() => {
    const rows = rankingResource.data ?? [];

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        value:
          rankingMetric === "PEAK_MW"
            ? row.peak_mw
            : rankingMetric === "MIN_PF"
              ? row.minimum_power_factor
              : row.completeness_percent,
        completeness: row.completeness_percent,
      }))
      .sort((left, right) => {
        if (rankingMetric === "MIN_PF") {
          return (left.value ?? Infinity) - (right.value ?? Infinity);
        }

        return (right.value ?? -Infinity) - (left.value ?? -Infinity);
      });
  }, [rankingMetric, rankingResource.data]);

  /* =======================================================
     HEATMAP
  ======================================================= */

  const heatmap =
    useMemo(
      () => {
        // Temporarily disabled for dashboard performance testing.
        // Keep the implementation intact so the heatmap can be restored.
        if (!HEATMAP_ENABLED_FOR_PERFORMANCE_TEST) {
          return [];
        }

        return buildHeatmap(
          scopeRows,
          selectedFeederIds,
          range
        );
      },
      [
        scopeRows,
        selectedFeederIds,
        range,
      ]
    );

  const heatmapDates =
    useMemo(
      () => {
        if (!HEATMAP_ENABLED_FOR_PERFORMANCE_TEST) {
          return [];
        }

        return getDatesInRange(
          range.startDate,
          range.endDate
        ).reverse();
      },
      [
        range,
      ]
    );

  /* =======================================================
     FEEDER DETAIL
  ======================================================= */

  const selectedStation =
    useMemo(
      () =>
        stations.find(
          (station) =>
            station.id ===
            selectedStationId
        ) ?? null,
      [
        stations,
        selectedStationId,
      ]
    );

  const selectedFeeder =
    useMemo(
      () =>
        feeders.find(
          (feeder) =>
            feeder.id ===
            selectedFeederId
        ) ?? null,
      [
        feeders,
        selectedFeederId,
      ]
    );

  const selectedFeederRows =
    useMemo(
      () =>
        selectedFeederId
          ? rowsByFeeder.get(selectedFeederId) ?? []
          : [],
      [
        rowsByFeeder,
        selectedFeederId,
      ]
    );

  const feederDayIndex =
    useMemo(
      () =>
        selectedFeederId
          ? buildFeederDayIndex(
              selectedFeederRows,
              feederProfileDate
            )
          : null,
      [
        feederProfileDate,
        selectedFeederId,
        selectedFeederRows,
      ]
    );

  const feederProfile =
    useMemo(
      () =>
        feederDayIndex?.series[
          feederParameter
        ] ?? [],
      [
        feederDayIndex,
        feederParameter,
      ]
    );

  useEffect(() => {
    if (
      !pendingRangeSourceTime ||
      !feederDayIndex ||
      feederDetailLoading ||
      !selectedFeederId ||
      feederDayResource.key !==
        getFeederDayCacheKey(
          selectedFeederId,
          feederProfileDate
        )
    ) {
      return;
    }

    const row = feederDayIndex.byHour.get(
      getISTHour(pendingRangeSourceTime)
    ) ?? null;

    if (row) {
      setSelectedHourRow(row);
    }

    setPendingRangeSourceTime(null);
  }, [
    feederDayIndex,
    feederDayResource.key,
    feederDetailLoading,
    feederProfileDate,
    pendingRangeSourceTime,
    selectedFeederId,
  ]);

  const feederRangeProfile =
    useMemo<FeederRangeChartRow[]>(
      () => {
        if (!feederProfileIsRange) {
          return [];
        }

        const valuesByDate = new Map(
          (feederRangeResource.data ?? []).map((row) => [
            row.profile_date,
            row,
          ])
        );

        return getDatesInRange(
          feederProfileStartDate,
          feederProfileEndDate
        ).map((date) => {
          const row = valuesByDate.get(date);

          return {
            date,
            label: formatShortDate(date),
            value: row?.value ?? null,
            sourceTime: row?.source_time ?? null,
            hour: -1,
            status: row ? "FULL" : "EMPTY",
            row: null,
          };
        });
      },
      [
        feederProfileEndDate,
        feederProfileIsRange,
        feederProfileStartDate,
        feederRangeResource.data,
      ]
    );

  const feederPeak =
    useMemo(
      () => {
        if (
          !selectedFeederId
        ) {
          return {
            value: null,
            timestamp: null,
          };
        }

        return findPeakDemand(
          buildHourlyMw(
            selectedFeederRows,
            new Set([
              selectedFeederId,
            ])
          )
        );
      },
      [
        selectedFeederRows,
        selectedFeederId,
      ]
    );

  const feederMinVoltage =
    useMemo(
      () =>
        findMinimumMetric(
          selectedFeederRows,
          (row) =>
            row.voltage_kv
        ),
      [
        selectedFeederRows,
      ]
    );

  const feederMaxCurrent =
    useMemo(
      () =>
        findMaximumMetric(
          selectedFeederRows,
          (row) =>
            row.current_a
        ),
      [
        selectedFeederRows,
      ]
    );

  const feederMinPf =
    useMemo(
      () =>
        findMinimumMetric(
          selectedFeederRows,
          (row) =>
            row.power_factor
        ),
      [
        selectedFeederRows,
      ]
    );

  const feederCompleteness =
    useMemo(
      () =>
        selectedFeederId
          ? getScopeCompleteness(
              selectedFeederRows,
              new Set([
                selectedFeederId,
              ]),
              {
                startDate:
                  feederProfileDate,
                endDate:
                  feederProfileDate,
              }
            )
          : null,
      [
        selectedFeederRows,
        selectedFeederId,
        feederProfileDate,
      ]
    );

  /* =======================================================
     CUSTOM PERIOD
  ======================================================= */

  function handlePeriodChange(
    value: Period
  ) {
    if (
      value === "Custom"
    ) {
      setModalStartDate(
        customRange.startDate
      );

      setModalEndDate(
        customRange.endDate
      );

      setModalError("");

      setShowCustomModal(
        true
      );

      return;
    }

    setPeriod(value);
  }

  function reopenCustomModal() {
    setModalStartDate(
      customRange.startDate
    );

    setModalEndDate(
      customRange.endDate
    );

    setModalError("");

    setShowCustomModal(
      true
    );
  }

  function applyCustomRange() {
    if (
      !modalStartDate ||
      !modalEndDate
    ) {
      setModalError(
        "Please select both start and end dates."
      );

      return;
    }

    if (
      modalStartDate >
      modalEndDate
    ) {
      setModalError(
        "Start date cannot be after end date."
      );

      return;
    }

    if (
      modalEndDate >
      getTodayIST()
    ) {
      setModalError(
        "Future dates cannot be selected."
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
        "Custom range cannot exceed one year."
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
      "Custom"
    );

    setShowCustomModal(
      false
    );
  }

  /* =======================================================
     DRILL DOWN
  ======================================================= */

  function drillStation(
    stationId: string
  ) {
    setSelectedStationId(
      stationId
    );

    setSelectedFeederId(
      ""
    );

    window.setTimeout(
      () => {
        document
          .getElementById(
            "performance-section"
          )
          ?.scrollIntoView({
            behavior:
              "smooth",
            block:
              "start",
          });
      },
      50
    );
  }

  function drillFeeder(
    feederId: string
  ) {
    setSelectedFeederId(
      feederId
    );

    window.setTimeout(
      () => {
        document
          .getElementById(
            "feeder-detail"
          )
          ?.scrollIntoView({
            behavior:
              "smooth",
            block:
              "start",
          });
      },
      50
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <div
        className="gv-load-energy-root"
        style={{
          display: "flex",
          flexDirection:
            "column",
          gap: 16,
          paddingBottom: 130,
        }}
      >
        {/* ===============================================
            GLOBAL FILTERS
        ================================================ */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(150px,1fr))",
            gap: 10,
          }}
        >
          <FilterBox>
            <span
              style={
                filterIconStyle
              }
            >
              <Activity
                size={17}
              />
            </span>

            <select
              aria-label="Station"
              value={
                selectedStationId
              }
              onChange={(
                event
              ) => {
                setSelectedStationId(
                  event.target.value
                );

                setSelectedFeederId(
                  ""
                );
              }}
              style={
                filterSelectStyle
              }
              disabled={controlsBusy}
              aria-busy={controlsBusy}
            >
              <option value="">
                All Stations
              </option>

              {stations.map(
                (station) => (
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
            {controlsBusy && <BusyIndicator label="Updating" />}
          </FilterBox>

          <FilterBox>
            <span
              style={
                filterIconStyle
              }
            >
              <Clock3
                size={17}
              />
            </span>

            <select
              aria-label="Period"
              value={period}
              onChange={(
                event
              ) =>
                handlePeriodChange(
                  event.target
                    .value as Period
                )
              }
              style={
                filterSelectStyle
              }
              disabled={controlsBusy}
              aria-busy={controlsBusy}
            >
              {PERIODS.map(
                (item) => (
                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>
                )
              )}
            </select>
            {controlsBusy && <BusyIndicator label="Updating" />}
          </FilterBox>

          <button
            type="button"
            data-pdf-filter-label="Date range"
            data-pdf-filter-value={`${formatShortDate(range.startDate)} - ${formatShortDate(range.endDate)}`}
            onClick={
              period ===
              "Custom"
                ? reopenCustomModal
                : undefined
            }
            style={{
              ...filterBoxStyle,
              cursor:
                period ===
                "Custom"
                  ? "pointer"
                  : "default",
              textAlign: "left",
            }}
          >
            <span
              style={
                filterIconStyle
              }
            >
              <CalendarDays
                size={17}
              />
            </span>

            <span
              style={{
                minWidth: 0,
                fontSize: 12,
                fontWeight: 700,
                color: "#334155",
                whiteSpace:
                  "nowrap",
                overflow:
                  "hidden",
                textOverflow:
                  "ellipsis",
              }}
            >
              {formatShortDate(
                range.startDate
              )}
              {" – "}
              {formatShortDate(
                range.endDate
              )}
            </span>
          </button>
        </div>

        {/* ===============================================
            BREADCRUMB
        ================================================ */}

        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 6,
            flexWrap: "wrap",
            fontSize: 12,
            color: "#64748B",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSelectedStationId(
                ""
              );

              setSelectedFeederId(
                ""
              );
            }}
            style={
              breadcrumbButtonStyle
            }
          >
            All Stations
          </button>

          {selectedStation && (
            <>
              <ChevronRight
                size={14}
              />

              <button
                type="button"
                onClick={() =>
                  setSelectedFeederId(
                    ""
                  )
                }
                style={
                  breadcrumbButtonStyle
                }
              >
                {
                  selectedStation.name
                }
              </button>
            </>
          )}

          {selectedFeeder && (
            <>
              <ChevronRight
                size={14}
              />

              <span
                style={{
                  color:
                    "#0F172A",
                  fontWeight: 700,
                }}
              >
                {
                  selectedFeeder.name
                }
              </span>
            </>
          )}
        </div>

        {lookupError && (
          <MessageBox
            tone="error"
          >
            {lookupError}
          </MessageBox>
        )}

        {/* ===============================================
            EXECUTIVE SUMMARY
        ================================================ */}

        <AnalysisCard>
          <CardUpdatingOverlay active={overviewLoading} hasData={overviewResource.data !== null} />
          <SectionHeader
            title="Executive Summary"
            subtitle={
              selectedFeeder
                ? selectedFeeder.name
                : selectedStation
                  ? selectedStation.name
                  : "All Stations"
            }
          />

          {overviewResource.error && (
            <CardErrorNotice onRetry={() => retryResource("overview")} />
          )}

          {overviewLoading && !overviewResource.data ? (
            <CardSkeleton rows={5} minHeight={158} />
          ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(135px,1fr))",
              gap: 10,
            }}
          >
            <SummaryCard
              icon={
                <TrendingUp
                  size={20}
                />
              }
              label="Peak Demand"
              value={
                overviewResource.data?.peak_mw ==
                null
                  ? "—"
                  : `${formatNumber(
                      overviewResource.data?.peak_mw ?? 0
                    )} MW`
              }
              subtitle={
                formatTimestamp(
                  overviewResource.data?.peak_time ?? null
                )
              }
              tone="blue"
            />

            <SummaryCard
              icon={
                <Zap
                  size={20}
                />
              }
              label="Min Voltage"
              value={
                overviewResource.data?.minimum_voltage_kv ==
                null
                  ? "—"
                  : `${formatNumber(
                      overviewResource.data?.minimum_voltage_kv ?? 0
                    )} kV`
              }
              subtitle={
                formatTimestamp(
                  overviewResource.data?.minimum_voltage_time ?? null
                )
              }
              tone="green"
            />

            <SummaryCard
              icon={
                <Activity
                  size={20}
                />
              }
              label="Max Current"
              value={
                overviewResource.data?.maximum_current_a ==
                null
                  ? "—"
                  : `${formatNumber(
                      overviewResource.data?.maximum_current_a ?? 0
                    )} A`
              }
              subtitle={
                formatTimestamp(
                  overviewResource.data?.maximum_current_time ?? null
                )
              }
              tone="orange"
            />

            <SummaryCard
              icon={
                <Gauge
                  size={20}
                />
              }
              label="Min PF"
              value={
                overviewResource.data?.minimum_power_factor ==
                null
                  ? "—"
                  : (overviewResource.data?.minimum_power_factor ?? 0).toFixed(
                      2
                    )
              }
              subtitle={
                formatTimestamp(
                  overviewResource.data?.minimum_power_factor_time ?? null
                )
              }
              tone="violet"
            />

            <CompletenessCard
              percent={
                overviewResource.data?.completeness_percent ?? 0
              }
              entered={
                overviewResource.data?.entered_feeder_hours ?? 0
              }
              expected={
                overviewResource.data?.expected_feeder_hours ?? 0
              }
            />
          </div>
          )}
        </AnalysisCard>

        {/* ===============================================
            LOAD TREND
        ================================================ */}

        <AnalysisCard>
          <CardUpdatingOverlay active={trendLoading} hasData={serverTrend.length > 0} />
          <SectionHeader
            title={
              selectedFeeder
                ? `${selectedFeeder.name} Load Trend`
                : selectedStation
                  ? `${selectedStation.name} Load Trend`
                  : "Utility Load Trend"
            }
            subtitle="Daily maximum hourly demand (MW)"
            right={
              <button
                type="button"
                onClick={() =>
                  void loadTrend(true)
                }
                style={
                  iconButtonStyle
                }
                aria-label="Refresh"
                aria-busy={trendLoading}
                disabled={trendLoading}
              >
                <RefreshCw
                  size={17}
                  style={trendLoading ? { animation: "load-analysis-spin .8s linear infinite" } : undefined}
                />
              </button>
            }
          />

          <TrendLegend />

          {trendError && (
            <CardErrorNotice onRetry={() => { void loadTrend(true); }} />
          )}

          <div
            style={{
              width: "100%",
              height: 270,
            }}
          >
            {trendLoading && serverTrend.length === 0 ? (
              <CardSkeleton rows={3} minHeight={220} />
            ) : trendError && serverTrend.length === 0 ? (
  <CenteredText>
    {trendError}
  </CenteredText>
) : (
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <AreaChart
                  data={
                    serverTrend
                  }
                  margin={{
                    top: 15,
                    right: 12,
                    bottom: 0,
                    left: -10,
                  }}
                >
                  <defs>
                    <linearGradient
                      id="loadFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={
                          BLUE
                        }
                        stopOpacity={
                          0.28
                        }
                      />

                      <stop
                        offset="95%"
                        stopColor={
                          BLUE
                        }
                        stopOpacity={
                          0.02
                        }
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#E2E8F0"
                  />

                  <XAxis
                    dataKey="label"
                    tick={{
                      fontSize: 10,
                      fill:
                        "#64748B",
                    }}
                    interval="preserveStartEnd"
                  />

                  <YAxis
                    tick={{
                      fontSize: 10,
                      fill:
                        "#64748B",
                    }}
                    width={48}
                  />

                  <Tooltip
                    content={
                      <TrendTooltip />
                    }
                  />

                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={BLUE}
                    strokeWidth={3}
                    fill="url(#loadFill)"
                    connectNulls={
                      false
                    }
                    dot={
                      <TrendDot />
                    }
                    activeDot={{
                      r: 6,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          </AnalysisCard>

        {/* ===============================================
            PERFORMANCE
        ================================================ */}

        <AnalysisCard>
          <CardUpdatingOverlay active={rankingLoading} hasData={performanceRanking.length > 0} />
          <div
            id="performance-section"
          >
            <SectionHeader
              title={
                selectedStationId
                  ? "Feeder Performance"
                  : "Station Performance"
              }
              subtitle={
                selectedStationId
                  ? selectedStation?.name ??
                    ""
                  : "Utility-wide ranking"
              }
              right={
                <select
                  aria-label="Performance metric"
                  value={
                    rankingMetric
                  }
                  onChange={(
                    event
                  ) =>
                    setRankingMetric(
                      event.target
                        .value as RankingMetric
                    )
                  }
                  style={
                    compactSelectStyle
                  }
                >
                  {RANKING_OPTIONS.map(
                    (
                      option
                    ) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    )
                  )}
                </select>
              }
            />

            {rankingResource.error && (
              <CardErrorNotice onRetry={() => retryResource("ranking")} />
            )}

            {rankingResource.error && performanceRanking.length === 0 ? (
              <CenteredText>{rankingResource.error}</CenteredText>
            ) : rankingLoading && performanceRanking.length === 0 ? (
              <CardSkeleton rows={5} minHeight={210} />
            ) : (
              <RankingList
                rows={performanceRanking}
                metric={rankingMetric}
                onSelect={selectedStationId ? drillFeeder : drillStation}
              />
            )}
          </div>
        </AnalysisCard>

        {/* ===============================================
            PARAMETER HEALTH
        ================================================ */}

        <AnalysisCard>
          <CardUpdatingOverlay active={healthLoading} hasData={healthResource.data !== null} />
          <SectionHeader
            title="Parameter Health"
            subtitle="Operational observations from available logbook data"
          />

          {healthResource.error && (
            <CardErrorNotice onRetry={() => retryResource("health")} />
          )}

          {healthLoading && !healthResource.data ? (
            <CardSkeleton rows={5} minHeight={240} />
          ) : (
          <div
            style={{
              display: "grid",
              gap: 9,
            }}
          >
            <HealthRow
              icon={
                <Gauge
                  size={18}
                />
              }
              title="Low Power Factor"
              onClick={() =>
                setSelectedHealthMetric("LOW_PF")
              }
              value={`${healthResource.data?.low_pf_feeder_count ?? 0} feeder${
                healthResource.data?.low_pf_feeder_count ===
                1
                  ? ""
                  : "s"
              }`}
              subtitle={`Observed PF below ${PF_ATTENTION_LEVEL.toFixed(
                2
              )}`}
              tone={
                (healthResource.data?.low_pf_feeder_count ?? 0) > 0
                  ? "warning"
                  : "good"
              }
            />

            <HealthRow
              icon={
                <Database
                  size={18}
                />
              }
              title="Incomplete Logbook"
              onClick={() =>
                setSelectedHealthMetric("INCOMPLETE_LOGBOOK")
              }
              value={`${healthResource.data?.incomplete_feeder_count ?? 0} feeder${
                healthResource.data?.incomplete_feeder_count ===
                1
                  ? ""
                  : "s"
              }`}
              subtitle={`${(healthResource.data?.completeness_percent ?? 0).toFixed(
                1
              )}% overall completeness`}
              tone={
                (healthResource.data?.incomplete_feeder_count ?? 0) >
                0
                  ? "warning"
                  : "good"
              }
            />

            <HealthRow
              icon={
                <Zap
                  size={18}
                />
              }
              title="Minimum Voltage Observed"
              onClick={() =>
                setSelectedHealthMetric("MIN_VOLTAGE")
              }
              value={
                healthResource.data?.minimum_voltage_kv ==
                null
                  ? "No data"
                  : `${formatNumber(
                      healthResource.data.minimum_voltage_kv
                    )} kV`
              }
              subtitle="No alarm threshold applied"
              tone="neutral"
            />

            <HealthRow
              icon={
                <Activity
                  size={18}
                />
              }
              title="Maximum Current Observed"
              onClick={() =>
                setSelectedHealthMetric("MAX_CURRENT")
              }
              value={
                healthResource.data?.maximum_current_a ==
                null
                  ? "No data"
                  : `${formatNumber(
                      healthResource.data.maximum_current_a
                    )} A`
              }
              subtitle="No equipment limit applied"
              tone="neutral"
            />

            <HealthRow
              icon={
                <Thermometer
                  size={18}
                />
              }
              title="Transformer Temperature"
              onClick={() =>
                setSelectedHealthMetric("MAX_TRANSFORMER_TEMP")
              }
              value={
                healthResource.data?.maximum_transformer_temp_c ==
                null
                  ? "No data"
                  : `${formatNumber(
                      healthResource.data.maximum_transformer_temp_c
                    )} °C`
              }
              subtitle="Maximum observed — no alarm threshold applied"
              tone="neutral"
            />
          </div>
          )}
        </AnalysisCard>

        {/* ===============================================
            FEEDER DETAIL
        ================================================ */}

        {selectedFeeder && (
          <AnalysisCard>
            <CardUpdatingOverlay
              active={
                feederProfileIsRange
                  ? feederRangeResource.loading
                  : feederDetailLoading
              }
              hasData={
                feederProfileIsRange
                  ? feederRangeProfile.length > 0
                  : selectedFeederRows.length > 0
              }
            />
            <div
              id="feeder-detail"
            >
              <SectionHeader
                title={
                  selectedFeeder.name
                }
                subtitle={`${selectedStation?.name ?? ""} • Feeder detail`}
              />

              {feederDayResource.error && (
                <CardErrorNotice onRetry={() => retryResource("feederDay")} />
              )}

              {feederRangeResource.error &&
                feederProfileIsRange && (
                  <CardErrorNotice onRetry={() => retryResource("feederRange")} />
                )}

              {feederDetailLoading && !feederDayResource.data ? (
                <CardSkeleton rows={5} minHeight={320} />
              ) : (
                <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(125px,1fr))",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <MiniMetric
                  label="Peak MW"
                  value={
                    feederPeak.value ===
                    null
                      ? "—"
                      : `${formatNumber(
                          feederPeak.value
                        )} MW`
                  }
                />

                <MiniMetric
                  label="Min Voltage"
                  value={
                    feederMinVoltage.value ===
                    null
                      ? "—"
                      : `${formatNumber(
                          feederMinVoltage.value
                        )} kV`
                  }
                />

                <MiniMetric
                  label="Max Current"
                  value={
                    feederMaxCurrent.value ===
                    null
                      ? "—"
                      : `${formatNumber(
                          feederMaxCurrent.value
                        )} A`
                  }
                />

                <MiniMetric
                  label="Min PF"
                  value={
                    feederMinPf.value ===
                    null
                      ? "—"
                      : feederMinPf.value.toFixed(
                          2
                        )
                  }
                />

                <MiniMetric
                  label="Completeness"
                  value={
                    feederCompleteness
                      ? `${feederCompleteness.percent.toFixed(
                          1
                        )}%`
                      : "—"
                  }
                />
              </div>

              {feederProfileRangeError && (
                <p
                  style={{
                    margin: "-4px 0 10px",
                    fontSize: 10,
                    color: "#DC2626",
                    fontWeight: 600,
                  }}
                >
                  {feederProfileRangeError}
                </p>
              )}

              {feederProfileIsRange &&
                !feederRangeResource.loading &&
                feederRangeProfile.length === 0 &&
                !feederRangeResource.error && (
                  <p
                    style={{
                      margin: "-4px 0 10px",
                      fontSize: 10,
                      color: "#64748B",
                    }}
                  >
                    No {FEEDER_PARAMETERS.find(
                      (option) =>
                        option.value === feederParameter
                    )?.label.toLowerCase()} readings are available in this range.
                  </p>
                )}

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10,
                    color: "#64748B",
                    fontWeight: 700,
                  }}
                >
                  From
                  <input
                    aria-label="Feeder profile start date"
                    type="date"
                    value={
                      feederProfileStartDate
                    }
                    min={
                      range.startDate
                    }
                    max={
                      feederProfileEndDate
                    }
                    onChange={(
                      event
                    ) => {
                      const value = event.target.value;
                      setFeederProfileStartDate(value);
                      setFeederProfileRangeError(
                        value > feederProfileEndDate
                          ? "From date cannot be after To date."
                          : null
                      );
                    }}
                    style={
                      compactSelectStyle
                    }
                  />
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10,
                    color: "#64748B",
                    fontWeight: 700,
                  }}
                >
                  To
                  <input
                    aria-label="Feeder profile end date"
                    type="date"
                    value={
                      feederProfileEndDate
                    }
                    min={
                      feederProfileStartDate
                    }
                    max={
                      range.endDate
                    }
                    onChange={(
                      event
                    ) => {
                      const value = event.target.value;
                      setFeederProfileEndDate(value);
                      setFeederProfileDate(value);
                      setFeederProfileRangeError(
                        value < feederProfileStartDate
                          ? "To date cannot be before From date."
                          : null
                      );
                    }}
                    style={
                      compactSelectStyle
                    }
                  />
                </label>

                <select
                  aria-label="Feeder profile parameter"
                  value={
                    feederParameter
                  }
                  onChange={(
                    event
                  ) =>
                    setFeederParameter(
                      event.target
                        .value as FeederParameter
                    )
                  }
                  style={
                    compactSelectStyle
                  }
                >
                  {FEEDER_PARAMETERS.map(
                    (
                      option
                    ) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    )
                  )}
                </select>
              </div>

              <div
                style={{
                  height: 250,
                }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <LineChart
                    data={
                      feederProfileIsRange
                        ? feederRangeProfile
                        : feederProfile
                    }
                    margin={{
                      top: 12,
                      right: 12,
                      left: -12,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={
                        false
                      }
                      stroke="#E2E8F0"
                    />

                    <XAxis
                      dataKey="label"
                      interval={3}
                      tick={{
                        fontSize: 9,
                      }}
                    />

                    <YAxis
                      width={48}
                      tick={{
                        fontSize: 9,
                      }}
                    />

                    <Tooltip
                      content={
                        feederProfileIsRange
                          ? <FeederRangeTooltip
                              parameter={
                                feederParameter
                              }
                            />
                          : <FeederTooltip
                              parameter={
                                feederParameter
                              }
                            />
                      }
                    />

                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={BLUE}
                      strokeWidth={2.5}
                      connectNulls={
                        false
                      }
                      dot={{
                        r: 3,
                      }}
                      activeDot={{
                        r: 6,
                        onClick: (
                          _event:
                            unknown,
                          payload:
                            unknown
                        ) => {
                          if (
                            feederProfileIsRange
                          ) {
                            const rangeCandidate =
                              payload as {
                                payload?:
                                  FeederRangeChartRow;
                              };

                            const sourceTime =
                              rangeCandidate.payload
                                ?.sourceTime;

                            if (
                              sourceTime
                            ) {
                              setPendingRangeSourceTime(
                                sourceTime
                              );
                              setFeederProfileDate(
                                getISTDate(
                                  sourceTime
                                )
                              );
                            }

                            return;
                          }

                          const candidate =
                            payload as {
                              payload?:
                                FeederChartRow;
                            };

                          const hour =
                            candidate.payload?.hour;

                          setSelectedHourRow(
                            hour === undefined
                              ? null
                              : feederDayIndex?.byHour.get(
                                  hour
                                ) ?? null
                          );
                        },
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p
                style={{
                  margin:
                    "4px 0 0",
                  fontSize: 10,
                  color: "#64748B",
                  textAlign:
                    "center",
                }}
              >
                Tap a plotted point
                to view the complete
                hourly logbook
                reading.
              </p>
                </>
              )}
            </div>
          </AnalysisCard>
        )}

        {/* ===============================================
            MISSING HOURLY READINGS
        ================================================ */}

        {HEATMAP_ENABLED_FOR_PERFORMANCE_TEST && (
          <AnalysisCard>
          <SectionHeader
            title="Missing Hourly Readings"
            subtitle={
              selectedFeeder
                ? selectedFeeder.name
                : selectedStation
                  ? selectedStation.name
                  : "All Stations"
            }
          />

          <HeatmapLegend />

          <div
            data-pdf-kind="heatmap"
            data-pdf-heatmap={JSON.stringify(heatmap.map((cell) => ({ date: cell.date, hour: cell.hour, status: cell.status })))}
            style={{
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
            <div
              style={{
                minWidth: 760,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "74px repeat(24,24px)",
                  gap: 3,
                  marginBottom: 4,
                }}
              >
                <div />

                {Array.from(
                  {
                    length: 24,
                  },
                  (
                    _,
                    hour
                  ) => (
                    <div
                      key={hour}
                      style={{
                        fontSize: 8,
                        color:
                          "#64748B",
                        textAlign:
                          "center",
                      }}
                    >
                      {pad2(
                        hour
                      )}
                    </div>
                  )
                )}
              </div>

              {heatmapDates.map(
                (date) => (
                  <div
                    key={date}
                    style={{
                      display:
                        "grid",
                      gridTemplateColumns:
                        "74px repeat(24,24px)",
                      gap: 3,
                      marginBottom: 3,
                      alignItems:
                        "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color:
                          "#475569",
                      }}
                    >
                      {formatShortDate(
                        date
                      )}
                    </div>

                    {Array.from(
                      {
                        length: 24,
                      },
                      (
                        _,
                        hour
                      ) => {
                        const cell =
                          heatmap.find(
                            (
                              item
                            ) =>
                              item.date ===
                                date &&
                              item.hour ===
                                hour
                          );

                        if (!cell) {
                          return (
                            <div
                              key={
                                hour
                              }
                            />
                          );
                        }

                        return (
                          <button
                            key={
                              hour
                            }
                            type="button"
                            title={`${formatDate(
                              date
                            )} ${pad2(
                              hour
                            )}:00 — ${cell.status}`}
                            onClick={() =>
                              setSelectedHeatmapCell(
                                cell
                              )
                            }
                            style={{
                              width: 24,
                              height: 24,
                              padding: 0,
                              border:
                                "1px solid rgba(255,255,255,.8)",
                              borderRadius: 4,
                              background:
                                heatmapColor(
                                  cell.status
                                ),
                              cursor:
                                "pointer",
                            }}
                          />
                        );
                      }
                    )}
                  </div>
                )
              )}
            </div>
          </div>
          </AnalysisCard>
        )}


      </div>

      {selectedHealthMetric && (
        <ParameterHealthDetailsModal
          metric={selectedHealthMetric}
          resource={healthDetailResource}
          onClose={() =>
            setSelectedHealthMetric(null)
          }
          onRetry={() =>
            retryResource("healthDetails")
          }
        />
      )}

      {/* ===============================================
          CUSTOM RANGE MODAL
      ================================================ */}

      {showCustomModal && (
        <ModalOverlay>
          <div
            style={
              modalCardStyle
            }
          >
            <ModalHeader
              title="Custom Date Range"
              onClose={() =>
                setShowCustomModal(
                  false
                )
              }
            />

            <p
              style={
                modalHintStyle
              }
            >
              Select a date range
              of up to one year.
            </p>

            <label
              style={
                fieldLabelStyle
              }
            >
              Start Date
            </label>

            <input
              type="date"
              value={
                modalStartDate
              }
              max={
                getTodayIST()
              }
              onChange={(
                event
              ) =>
                setModalStartDate(
                  event.target.value
                )
              }
              style={
                modalInputStyle
              }
            />

            <label
              style={
                fieldLabelStyle
              }
            >
              End Date
            </label>

            <input
              type="date"
              value={
                modalEndDate
              }
              min={
                modalStartDate
              }
              max={
                modalStartDate
                  ? (
                      addYears(
                        modalStartDate,
                        1
                      ) <
                      getTodayIST()
                        ? addYears(
                            modalStartDate,
                            1
                          )
                        : getTodayIST()
                    )
                  : getTodayIST()
              }
              onChange={(
                event
              ) =>
                setModalEndDate(
                  event.target.value
                )
              }
              style={
                modalInputStyle
              }
            />

            {modalError && (
              <div
                style={
                  modalErrorStyle
                }
              >
                {modalError}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 10,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setShowCustomModal(
                    false
                  )
                }
                style={
                  secondaryButtonStyle
                }
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  applyCustomRange
                }
                disabled={controlsBusy}
                aria-busy={controlsBusy}
                style={
                  primaryButtonStyle
                }
              >
                {controlsBusy ? "Updating…" : "Apply"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ===============================================
          HEATMAP DETAIL MODAL
      ================================================ */}

      {selectedHeatmapCell && (
        <ModalOverlay>
          <div
            style={
              modalCardStyle
            }
          >
            <ModalHeader
              title="Hourly Data Status"
              onClose={() =>
                setSelectedHeatmapCell(
                  null
                )
              }
            />

            <div
              style={{
                padding:
                  "12px 14px",
                borderRadius: 12,
                background:
                  "#F8FAFC",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color:
                    "#0F172A",
                }}
              >
                {formatDate(
                  selectedHeatmapCell.date
                )}
                {" • "}
                {pad2(
                  selectedHeatmapCell.hour
                )}
                :00
              </div>

              <div
                style={{
                  marginTop: 5,
                  fontSize: 12,
                  color:
                    "#64748B",
                }}
              >
                Status:{" "}
                <strong>
                  {statusLabel(
                    selectedHeatmapCell.status
                  )}
                </strong>
              </div>
            </div>

            {selectedHeatmapCell.status !==
              "FUTURE" && (
              <>
                <ModalMetric
                  label="Expected feeders"
                  value={String(
                    selectedHeatmapCell.expected
                  )}
                />

                <ModalMetric
                  label="Entered"
                  value={String(
                    selectedHeatmapCell.entered
                  )}
                />

                <ModalMetric
                  label="Missing"
                  value={String(
                    selectedHeatmapCell
                      .missingFeederIds
                      .length
                  )}
                />

                {selectedHeatmapCell
                  .missingFeederIds
                  .length >
                  0 && (
                  <div
                    style={{
                      marginTop: 14,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color:
                          "#475569",
                        marginBottom: 7,
                      }}
                    >
                      Missing feeders
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap:
                          "wrap",
                        gap: 6,
                      }}
                    >
                      {selectedHeatmapCell
                        .missingFeederIds
                        .map(
                          (
                            feederId
                          ) => {
                            const name =
                              feeders.find(
                                (
                                  feeder
                                ) =>
                                  feeder.id ===
                                  feederId
                              )
                                ?.name ??
                              feederId;

                            return (
                              <span
                                key={
                                  feederId
                                }
                                style={
                                  missingChipStyle
                                }
                              >
                                {
                                  name
                                }
                              </span>
                            );
                          }
                        )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* ===============================================
          HOURLY READING MODAL
      ================================================ */}

      {selectedHourRow && (
        <ModalOverlay>
          <div
            style={
              modalCardStyle
            }
          >
            <ModalHeader
              title="Hourly Logbook Reading"
              onClose={() =>
                setSelectedHourRow(
                  null
                )
              }
            />

            <div
              style={{
                fontSize: 12,
                color: "#64748B",
                marginBottom: 12,
              }}
            >
              {formatTimestamp(
                selectedHourRow.actual_event_time
              )}
            </div>

            <ReadingGrid
              row={
                selectedHourRow
              }
            />
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function AnalysisCard({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <section
      style={{
        position: "relative",
        background:
          "#FFFFFF",
        borderRadius: 18,
        padding: 16,
        boxShadow:
          "0 4px 14px rgba(15,23,42,.07)",
        border:
          "1px solid #E2E8F0",
      }}
    >
      {children}
    </section>
  );
}

function BusyIndicator({ label = "Updating" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#64748B", fontSize: 10, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 12, height: 12, border: "2px solid #BFDBFE", borderTopColor: "#2563EB", borderRadius: "50%", animation: "load-analysis-spin .8s linear infinite" }} />
      {label}
    </span>
  );
}

function CardUpdatingOverlay({ active, hasData }: { active: boolean; hasData: boolean }) {
  if (!active) return null;
  return (
    <>
      <style>{"@keyframes load-analysis-spin { to { transform: rotate(360deg); } }"}</style>
      <div aria-busy="true" style={{ position: "absolute", inset: 0, zIndex: 2, borderRadius: 18, background: hasData ? "rgba(255,255,255,.34)" : "rgba(248,250,252,.82)", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 12, pointerEvents: "none" }}>
        <BusyIndicator label={hasData ? "Updating…" : "Loading…"} />
      </div>
    </>
  );
}

function CardSkeleton({ rows = 3, minHeight = 120 }: { rows?: number; minHeight?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" style={{ minHeight, display: "grid", alignContent: "center", gap: 10 }}>
      <style>{"@keyframes load-analysis-skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }"}</style>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden="true" style={{ display: "block", height: index === 0 ? 18 : 12, width: index === 0 ? "52%" : `${80 - index * 9}%`, borderRadius: 999, background: "linear-gradient(90deg,#E2E8F0 25%,#F1F5F9 50%,#E2E8F0 75%)", backgroundSize: "200% 100%", animation: "load-analysis-skeleton 1.3s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

function CardErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, color: "#B45309", fontSize: 11 }}>
      <span>Could not refresh.</span>
      <button type="button" onClick={onRetry} style={{ border: 0, background: "transparent", color: "#2563EB", fontWeight: 800, padding: 0, cursor: "pointer" }}>
        Retry
      </button>
    </div>
  );
}

function FilterBox({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div
      style={
        filterBoxStyle
      }
    >
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems:
          "flex-start",
        justifyContent:
          "space-between",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 6,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 800,
              color:
                "#0F172A",
            }}
          >
            {title}
          </h3>

          <Info
            size={15}
            color="#94A3B8"
          />
        </div>

        {subtitle && (
          <p
            style={{
              margin:
                "4px 0 0",
              fontSize: 10,
              color:
                "#64748B",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {right}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtitle,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  tone:
    | "blue"
    | "green"
    | "orange"
    | "violet";
}) {
  const toneMap = {
    blue: {
      bg: "#EFF6FF",
      color: "#2563EB",
    },

    green: {
      bg: "#ECFDF5",
      color: "#059669",
    },

    orange: {
      bg: "#FFF7ED",
      color: "#EA580C",
    },

    violet: {
      bg: "#F5F3FF",
      color: "#7C3AED",
    },
  };

  const selected =
    toneMap[tone];

  return (
    <div
      data-pdf-kind="kpi"
      data-pdf-label={label}
      data-pdf-value={value}
      data-pdf-detail={subtitle}
      style={{
        border:
          "1px solid #E2E8F0",
        borderRadius: 14,
        padding: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 999,
          display: "grid",
          placeItems:
            "center",
          background:
            selected.bg,
          color:
            selected.color,
          marginBottom: 8,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: "#0F172A",
          lineHeight: 1.1,
          wordBreak:
            "break-word",
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          fontWeight: 700,
          color: "#334155",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 9,
          color: "#64748B",
          lineHeight: 1.3,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

function CompletenessCard({
  percent,
  entered,
  expected,
}: {
  percent: number;
  entered: number;
  expected: number;
}) {
  const rounded =
    Math.round(percent);

  return (
    <div
      data-pdf-kind="kpi"
      data-pdf-label="Data Completeness"
      data-pdf-value={`${rounded}%`}
      data-pdf-detail={`${entered} / ${expected} feeder-hour slots`}
      style={{
        border:
          "1px solid #E2E8F0",
        borderRadius: 14,
        padding: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          display: "grid",
          placeItems:
            "center",
          marginBottom: 6,
          background:
            `conic-gradient(${BLUE} ${rounded}%, #E2E8F0 ${rounded}% 100%)`,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius:
              999,
            background:
              "#FFFFFF",
            display: "grid",
            placeItems:
              "center",
            fontSize: 14,
            fontWeight: 800,
            color:
              "#0F172A",
          }}
        >
          {rounded}%
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#334155",
        }}
      >
        Data Completeness
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 9,
          color: "#64748B",
        }}
      >
        {entered} /{" "}
        {expected} feeder-hour
        slots
      </div>
    </div>
  );
}

function TrendLegend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 5,
        fontSize: 9,
        color: "#64748B",
      }}
    >
      <LegendDot
        color={BLUE}
        label="Complete"
      />

      <LegendDot
        color={ORANGE}
        label="Partial"
      />

      <LegendDot
        color={GREY}
        label="No data"
      />
    </div>
  );
}

function LegendDot({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems:
          "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background:
            color,
        }}
      />

      {label}
    </span>
  );
}

function TrendDot(
  props: unknown
) {
  const {
    cx,
    cy,
    payload,
  } =
    props as {
      cx?: number;
      cy?: number;
      payload?:
        DailyTrendRow;
    };

  if (
    typeof cx !==
      "number" ||
    typeof cy !==
      "number" ||
    !payload ||
    payload.value ===
      null
  ) {
    return null;
  }

  const color =
    payload.status ===
    "FULL"
      ? BLUE
      : payload.status ===
          "PARTIAL"
        ? ORANGE
        : GREY;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={
        payload.status ===
        "PARTIAL"
          ? 5
          : 3.5
      }
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={1.5}
    />
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload:
      DailyTrendRow;
  }>;
}) {
  if (
    !active ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  const row =
    payload[0].payload;

  return (
    <div
      style={
        tooltipStyle
      }
    >
      <strong>
        {formatDate(
          row.date
        )}
      </strong>

      <div
        style={{
          marginTop: 5,
        }}
      >
        Peak:{" "}
        {row.value ===
        null
          ? "No feeder data"
          : `${formatNumber(
              row.value
            )} MW`}
      </div>

      {row.timestamp && (
        <div>
          {formatTimestamp(
            row.timestamp
          )}
        </div>
      )}

      <div>
        Status:{" "}
        {statusLabel(
          row.status
        )}
      </div>
    </div>
  );
}

function RankingList({
  rows,
  metric,
  onSelect,
}: {
  rows: RankingRow[];
  metric:
    RankingMetric;
  onSelect:
    (id: string) => void;
}) {
  const visible =
    rows.slice(0, 8);

  const values =
    visible
      .map(
        (row) =>
          row.value
      )
      .filter(
        (
          value
        ): value is number =>
          value !== null
      );

  const maximum =
    values.length > 0
      ? Math.max(
          ...values
        )
      : 0;

  return (
    <div
      style={{
        display: "grid",
        gap: 9,
      }}
    >
      {visible.length ===
        0 && (
        <CenteredText>
          No ranking data
          available.
        </CenteredText>
      )}

      {visible.map(
        (
          row,
          index
        ) => {
          let width = 0;

          if (
            row.value !==
              null &&
            maximum > 0
          ) {
            if (
              metric ===
              "MIN_PF"
            ) {
              width =
                Math.max(
                  8,
                  row.value *
                    100
                );
            } else {
              width =
                Math.max(
                  8,
                  (
                    row.value /
                    maximum
                  ) *
                    100
                );
            }
          }

          return (
            <button
              type="button"
              key={row.id}
              data-pdf-kind="row"
              data-pdf-label={`${index + 1}. ${row.name}`}
              data-pdf-value={formatRankingValue(row.value, metric)}
              data-pdf-detail={`Performance ranking by ${RANKING_OPTIONS.find((option) => option.value === metric)?.label ?? metric}`}
              onClick={() =>
                onSelect(
                  row.id
                )
              }
              style={
                rankingButtonStyle
              }
            >
              <span
                style={{
                  width: 18,
                  fontSize: 11,
                  fontWeight: 800,
                  color:
                    "#475569",
                }}
              >
                {index + 1}
              </span>

              <span
                style={{
                  width: 105,
                  minWidth: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color:
                    "#0F172A",
                  overflow:
                    "hidden",
                  textOverflow:
                    "ellipsis",
                  whiteSpace:
                    "nowrap",
                  textAlign:
                    "left",
                }}
              >
                {row.name}
              </span>

              <span
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius:
                    999,
                  background:
                    "#E2E8F0",
                  overflow:
                    "hidden",
                }}
              >
                <span
                  style={{
                    display:
                      "block",
                    width:
                      `${Math.min(
                        100,
                        width
                      )}%`,
                    height:
                      "100%",
                    background:
                      BLUE,
                    borderRadius:
                      999,
                  }}
                />
              </span>

              <span
                style={{
                  width: 76,
                  textAlign:
                    "right",
                  fontSize: 10,
                  fontWeight: 800,
                  color:
                    "#334155",
                }}
              >
                {formatRankingValue(
                  row.value,
                  metric
                )}
              </span>

              <ChevronRight
                size={16}
                color="#64748B"
              />
            </button>
          );
        }
      )}
    </div>
  );
}

function HealthRow({
  icon,
  title,
  value,
  subtitle,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
  tone:
    | "good"
    | "warning"
    | "neutral";
  onClick:
    () => void;
}) {
  const color =
    tone === "good"
      ? GREEN
      : tone ===
          "warning"
        ? ORANGE
        : BLUE;

  return (
    <button
      type="button"
      data-pdf-kind="row"
      data-pdf-label={title}
      data-pdf-value={value}
      data-pdf-detail={subtitle}
      onClick={onClick}
      aria-label={`View ${title} details`}
      style={{
        display: "flex",
        alignItems:
          "center",
        gap: 10,
        border:
          "1px solid #E2E8F0",
        borderRadius: 12,
        padding:
          "10px 12px",
        background:
          "#FFFFFF",
        width: "100%",
        textAlign:
          "left",
        cursor:
          "pointer",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "grid",
          placeItems:
            "center",
          background:
            `${color}12`,
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color:
              "#0F172A",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 9,
            color:
              "#64748B",
            marginTop: 2,
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color,
          textAlign:
            "right",
        }}
      >
        {value}
      </div>
    </button>
  );
}

function getHealthDetailTitle(
  metric: ParameterHealthDetailMetric
): string {
  switch (metric) {
    case "LOW_PF":
      return "Low Power Factor Details";
    case "INCOMPLETE_LOGBOOK":
      return "Incomplete Logbook Details";
    case "MIN_VOLTAGE":
      return "Minimum Voltage Details";
    case "MAX_CURRENT":
      return "Maximum Current Details";
    case "MAX_TRANSFORMER_TEMP":
      return "Transformer Temperature Details";
  }
}

function formatHealthDetailValue(
  metric: ParameterHealthDetailMetric,
  value: number | null
): string {
  if (value === null) {
    return "—";
  }

  if (metric === "LOW_PF") {
    return value.toFixed(2);
  }

  if (metric === "INCOMPLETE_LOGBOOK") {
    return `${value.toFixed(1)}%`;
  }

  if (metric === "MIN_VOLTAGE") {
    return `${formatNumber(value)} kV`;
  }

  if (metric === "MAX_CURRENT") {
    return `${formatNumber(value)} A`;
  }

  return `${formatNumber(value)} °C`;
}

function ParameterHealthDetailsModal({
  metric,
  resource,
  onClose,
  onRetry,
}: {
  metric: ParameterHealthDetailMetric;
  resource: AnalyticsResource<LoadAnalysisParameterHealthDetailRow[]>;
  onClose: () => void;
  onRetry: () => void;
}) {
  const rows = resource.data ?? [];
  const isIncomplete = metric === "INCOMPLETE_LOGBOOK";

  return (
    <ModalOverlay>
      <div
        style={{
          ...modalCardStyle,
          width: "min(100%, 560px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={getHealthDetailTitle(metric)}
      >
        <ModalHeader
          title={getHealthDetailTitle(metric)}
          onClose={onClose}
        />

        <p
          style={{
            ...modalHintStyle,
            marginTop: 0,
          }}
        >
          One representative record per feeder for the selected scope and date range. Showing up to 50 feeders.
        </p>

        {resource.loading && rows.length === 0 ? (
          <CenteredText>
            Loading details…
          </CenteredText>
        ) : resource.error && rows.length === 0 ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              justifyItems: "center",
              padding: "22px 0",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#DC2626",
                textAlign: "center",
              }}
            >
              Could not load health details.
            </div>
            <button
              type="button"
              onClick={onRetry}
              style={primaryButtonStyle}
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <CenteredText>
            No matching feeder observations were found.
          </CenteredText>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 8,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {rows.map((row) => (
              <div
                key={`${metric}-${row.feeder_id}`}
                style={{
                  border: "1px solid #E2E8F0",
                  borderRadius: 12,
                  padding: 11,
                  background: "#F8FAFC",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: "#0F172A",
                      }}
                    >
                      {row.feeder_name}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 10,
                        color: "#64748B",
                      }}
                    >
                      {row.station_name}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: isIncomplete ? ORANGE : BLUE,
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatHealthDetailValue(
                      metric,
                      row.metric_value
                    )}
                  </div>
                </div>

                {isIncomplete ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 10,
                      color: "#64748B",
                    }}
                  >
                    {row.entered_hours ?? 0} / {row.expected_hours ?? 0} feeder-hours entered · {row.missing_hours ?? 0} missing
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 10,
                      color: "#64748B",
                    }}
                  >
                    Occurred: {row.occurred_at ? formatTimestamp(row.occurred_at) : "—"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      data-pdf-kind="kpi"
      data-pdf-label={label}
      data-pdf-value={value}
      style={{
        padding: 10,
        borderRadius: 12,
        background:
          "#F8FAFC",
        border:
          "1px solid #E2E8F0",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color:
            "#64748B",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 14,
          fontWeight: 800,
          color:
            "#0F172A",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FeederTooltip({
  active,
  payload,
  parameter,
}: {
  active?: boolean;
  payload?: Array<{
    payload:
      FeederChartRow;
  }>;
  parameter:
    FeederParameter;
}) {
  if (
    !active ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  const item =
    payload[0].payload;

  const option =
    FEEDER_PARAMETERS.find(
      (entry) =>
        entry.value ===
        parameter
    );

  return (
    <div
      style={
        tooltipStyle
      }
    >
      <strong>
        {item.label}
      </strong>

      <div
        style={{
          marginTop: 5,
        }}
      >
        {option?.label}:{" "}
        {item.value ===
        null
          ? "No data"
          : `${formatNumber(
              item.value
            )}${
              option?.unit
                ? ` ${option.unit}`
                : ""
            }`}
      </div>
    </div>
  );
}

function FeederRangeTooltip({
  active,
  payload,
  parameter,
}: {
  active?: boolean;
  payload?: Array<{
    payload:
      FeederRangeChartRow;
  }>;
  parameter:
    FeederParameter;
}) {
  if (
    !active ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  const item = payload[0].payload;
  const option = FEEDER_PARAMETERS.find(
    (entry) =>
      entry.value === parameter
  );
  const aggregation =
    parameter === "VOLTAGE" ||
    parameter === "PF"
      ? "Daily minimum"
      : "Daily maximum";

  return (
    <div
      style={
        tooltipStyle
      }
    >
      <strong>
        {formatDate(item.date)}
      </strong>

      <div
        style={{
          marginTop: 5,
        }}
      >
        {aggregation} {option?.label}: {" "}
        {item.value === null
          ? "No data"
          : `${formatNumber(item.value)}${
              option?.unit
                ? ` ${option.unit}`
                : ""
            }`}
      </div>

      {item.sourceTime && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            color: "#64748B",
          }}
        >
          Tap to view the source hour: {formatTimestamp(item.sourceTime)}
        </div>
      )}
    </div>
  );
}

function HeatmapLegend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 12,
        fontSize: 9,
        color: "#64748B",
      }}
    >
      <LegendSquare
        color={GREEN}
        label="Complete"
      />

      <LegendSquare
        color="#FACC15"
        label="Partial"
      />

      <LegendSquare
        color={RED}
        label="Missing"
      />

      <LegendSquare
        color="#E5E7EB"
        label="Future"
      />
    </div>
  );
}

function LegendSquare({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems:
          "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: 2,
          background:
            color,
        }}
      />

      {label}
    </span>
  );
}

function ModalOverlay({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background:
          "rgba(15,23,42,.48)",
        display: "flex",
        alignItems:
          "center",
        justifyContent:
          "center",
        padding: 18,
      }}
    >
      {children}
    </div>
  );
}

function ModalHeader({
  title,
  onClose,
}: {
  title: string;
  onClose:
    () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent:
          "space-between",
        alignItems:
          "center",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 800,
          color:
            "#0F172A",
        }}
      >
        {title}
      </h3>

    <button
      type="button"
        onClick={
          onClose
        }
        style={
          iconButtonStyle
        }
      >
        <X
          size={18}
        />
      </button>
    </div>
  );
}

function ModalMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      data-pdf-kind="kpi"
      data-pdf-label={label}
      data-pdf-value={value}
      style={{
        display: "flex",
        justifyContent:
          "space-between",
        gap: 12,
        padding:
          "9px 0",
        borderBottom:
          "1px solid #E2E8F0",
        fontSize: 12,
      }}
    >
      <span
        style={{
          color:
            "#64748B",
        }}
      >
        {label}
      </span>

      <strong
        style={{
          color:
            "#0F172A",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function ReadingGrid({
  row,
}: {
  row:
    LoadAnalysisRow;
}) {
  const values = [
    [
      "MW",
      formatNullable(
        row.mw,
        "MW"
      ),
    ],
    [
      "MVAR",
      formatNullable(
        row.mvar,
        "MVAR"
      ),
    ],
    [
      "Voltage",
      formatNullable(
        row.voltage_kv,
        "kV"
      ),
    ],
    [
      "Current",
      formatNullable(
        row.current_a,
        "A"
      ),
    ],
    [
      "Power Factor",
      formatNullable(
        row.power_factor
      ),
    ],
    [
      "Frequency",
      formatNullable(
        row.frequency_hz,
        "Hz"
      ),
    ],
    [
      "Transformer Temp.",
      formatNullable(
        row.transformer_temp_c,
        "°C"
      ),
    ],
    [
      "Oil Level",
      formatNullable(
        row.oil_level_percent,
        "%"
      ),
    ],
    [
      "Tap Position",
      row.tap_position ===
      null
        ? "—"
        : String(
            row.tap_position
          ),
    ],
    [
      "Weather",
      row.weather ||
        "—",
    ],
  ];

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: 8,
        }}
      >
        {values.map(
          ([
            label,
            value,
          ]) => (
            <MiniMetric
              key={label}
              label={label}
              value={value}
            />
          )
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          background:
            "#F8FAFC",
          border:
            "1px solid #E2E8F0",
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color:
              "#64748B",
            marginBottom: 5,
          }}
        >
          Remarks
        </div>

        <div
          style={{
            fontSize: 12,
            color:
              "#334155",
            lineHeight: 1.5,
          }}
        >
          {row.remarks ||
            "No remarks"}
        </div>
      </div>
    </>
  );
}

function MessageBox({
  children,
  tone = "normal",
}: {
  children:
    ReactNode;
  tone?:
    | "normal"
    | "error";
}) {
  return (
    <div
      style={{
        padding:
          "11px 13px",
        borderRadius: 12,
        fontSize: 11,
        background:
          tone ===
          "error"
            ? "#FEF2F2"
            : "#EFF6FF",
        color:
          tone ===
          "error"
            ? "#B91C1C"
            : "#1D4ED8",
        border:
          tone ===
          "error"
            ? "1px solid #FECACA"
            : "1px solid #BFDBFE",
      }}
    >
      {children}
    </div>
  );
}

function CenteredText({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 80,
        display: "grid",
        placeItems:
          "center",
        color: "#64748B",
        fontSize: 11,
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   FORMAT HELPERS
========================================================= */

function formatNumber(
  value: number
): string {
  return new Intl.NumberFormat(
    "en-IN",
    {
      maximumFractionDigits:
        2,
    }
  ).format(value);
}

function formatNullable(
  value: number | null,
  unit = ""
): string {
  if (
    value === null
  ) {
    return "—";
  }

  return `${formatNumber(
    value
  )}${
    unit
      ? ` ${unit}`
      : ""
  }`;
}

function formatRankingValue(
  value: number | null,
  metric: RankingMetric
): string {
  if (
    value === null
  ) {
    return "—";
  }

  if (
    metric ===
    "PEAK_MW"
  ) {
    return `${formatNumber(
      value
    )} MW`;
  }

  if (
    metric ===
    "MIN_PF"
  ) {
    return value.toFixed(
      2
    );
  }

  return `${value.toFixed(
    1
  )}%`;
}

function statusLabel(
  status: FillStatus
): string {
  switch (status) {
    case "FULL":
      return "Complete";

    case "PARTIAL":
      return "Partial";

    case "EMPTY":
      return "Missing";

    case "FUTURE":
      return "Future";
  }
}

function heatmapColor(
  status: FillStatus
): string {
  switch (status) {
    case "FULL":
      return "#86D993";

    case "PARTIAL":
      return "#FACC15";

    case "EMPTY":
      return "#EF6B6B";

    case "FUTURE":
      return "#E5E7EB";
  }
}

/* =========================================================
   STYLES
========================================================= */

const filterBoxStyle:
  CSSProperties = {
    minHeight: 48,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding:
      "0 12px",
    background: "#FFFFFF",
    border:
      "1px solid #DCE3ED",
    borderRadius: 14,
    boxShadow:
      "0 2px 7px rgba(15,23,42,.04)",
  };

const filterIconStyle:
  CSSProperties = {
    display: "grid",
    placeItems: "center",
    color: BLUE,
    flexShrink: 0,
  };

const filterSelectStyle:
  CSSProperties = {
    width: "100%",
    minWidth: 0,
    border: "none",
    outline: "none",
    background:
      "transparent",
    color: "#0F172A",
    fontSize: 12,
    fontWeight: 700,
  };

const compactSelectStyle:
  CSSProperties = {
    padding:
      "7px 9px",
    borderRadius: 9,
    border:
      "1px solid #D1D5DB",
    background: "#FFFFFF",
    color: "#334155",
    fontSize: 10,
    fontWeight: 600,
    outline: "none",
  };

const breadcrumbButtonStyle:
  CSSProperties = {
    padding: 0,
    border: "none",
    background:
      "transparent",
    color: "#2563EB",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };

const iconButtonStyle:
  CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 10,
    border:
      "1px solid #E2E8F0",
    background: "#FFFFFF",
    color: "#475569",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
  };

const rankingButtonStyle:
  CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding:
      "7px 0",
    border: "none",
    borderBottom:
      "1px solid #F1F5F9",
    background:
      "transparent",
    cursor: "pointer",
  };

const tooltipStyle:
  CSSProperties = {
    padding:
      "9px 11px",
    borderRadius: 10,
    background:
      "rgba(15,23,42,.94)",
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 1.45,
    boxShadow:
      "0 5px 15px rgba(0,0,0,.2)",
  };

const modalCardStyle:
  CSSProperties = {
    width: "100%",
    maxWidth: 430,
    maxHeight:
      "85vh",
    overflowY: "auto",
    background:
      "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    boxShadow:
      "0 18px 50px rgba(15,23,42,.25)",
  };

const modalHintStyle:
  CSSProperties = {
    margin:
      "0 0 14px",
    color: "#64748B",
    fontSize: 11,
    lineHeight: 1.5,
  };

const fieldLabelStyle:
  CSSProperties = {
    display: "block",
    margin:
      "10px 0 5px",
    color: "#475569",
    fontSize: 10,
    fontWeight: 700,
  };

const modalInputStyle:
  CSSProperties = {
    width: "100%",
    boxSizing:
      "border-box",
    padding:
      "10px 11px",
    borderRadius: 10,
    border:
      "1px solid #CBD5E1",
    background:
      "#FFFFFF",
    color: "#0F172A",
    fontSize: 12,
  };

const modalErrorStyle:
  CSSProperties = {
    marginTop: 10,
    padding:
      "9px 10px",
    borderRadius: 9,
    background:
      "#FEF2F2",
    color: "#B91C1C",
    fontSize: 10,
  };

const primaryButtonStyle:
  CSSProperties = {
    padding:
      "9px 16px",
    borderRadius: 10,
    border: "none",
    background: BLUE,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  };

const secondaryButtonStyle:
  CSSProperties = {
    padding:
      "9px 16px",
    borderRadius: 10,
    border:
      "1px solid #CBD5E1",
    background:
      "#FFFFFF",
    color: "#475569",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  };

const missingChipStyle:
  CSSProperties = {
    display:
      "inline-flex",
    padding:
      "5px 8px",
    borderRadius: 999,
    background:
      "#FEF2F2",
    border:
      "1px solid #FECACA",
    color: "#B91C1C",
    fontSize: 9,
    fontWeight: 700,
  };
