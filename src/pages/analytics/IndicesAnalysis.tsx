import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  CSSProperties,
  ReactNode,
} from "react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import {
  CalendarDays,
  X,
} from "lucide-react";

import { api } from "@/services/api";
import { useApp } from "@/context/AppContext";

import type {
  Feeder,
  Interruption,
} from "@/types";

/* =========================================================
   PERIODS
========================================================= */

const periods = [
  "7 Days",
  "15 Days",
  "30 Days",
  "3 Months",
  "Custom",
] as const;

type Period =
  (typeof periods)[number];

/* =========================================================
   TYPES
========================================================= */

type DateRange = {
  startDate: string;
  endDate: string;
};

type BucketMode =
  | "DAY"
  | "MONTH";

type CustomCard =
  | "SAIDI"
  | "SAIFI"
  | null;

type GraphPoint = {
  key: string;
  day: string;
  value: number;

  /*
   * Useful in tooltip.
   */
  interruptions: number;
  affectedConsumers: number;
};

type FeederWithConsumers =
  Feeder & {
    consumer_count?:
      number | null;

    active?:
      boolean;
  };

type DbInterruption =
  Interruption & {
    station_id:
      string;

    feeder_id:
      string | null;

    interruption_start:
      string;

    interruption_end:
      string | null;

    duration_minutes:
      number | null;

    current_status:
      "OPEN" |
      "RESTORED" |
      "CANCELLED";
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
    "0"
  );
}

/* =========================================================
   TODAY IN IST
========================================================= */

function getTodayIST():
  string {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Kolkata",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
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
        "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        "day"
    )?.value;

  return `${year}-${month}-${day}`;
}

/* =========================================================
   PARSE YYYY-MM-DD
========================================================= */

function parseDateOnly(
  value: string
): Date {
  const [
    year,
    month,
    day,
  ] =
    value
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day
    )
  );
}

/* =========================================================
   DATE → YYYY-MM-DD
========================================================= */

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
  ].join("-");
}

/* =========================================================
   ADD DAYS
========================================================= */

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

/* =========================================================
   ADD YEARS
========================================================= */

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

/* =========================================================
   DAYS BETWEEN
========================================================= */

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

/* =========================================================
   FORMAT DATE
========================================================= */

function formatDate(
  value: string
): string {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      day:
        "2-digit",

      month:
        "short",

      year:
        "numeric",

      timeZone:
        "UTC",
    }
  ).format(
    parseDateOnly(
      value
    )
  );
}

/* =========================================================
   PERIOD RANGE
========================================================= */

function getPeriodRange(
  period: Period,
  customRange: DateRange
): DateRange {
  const today =
    getTodayIST();

  if (
    period ===
    "Custom"
  ) {
    return customRange;
  }

  if (
    period ===
    "7 Days"
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
    "15 Days"
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
    "30 Days"
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

  /*
   * 3 Months:
   * first day of month,
   * two months before current month.
   */

  const now =
    parseDateOnly(
      today
    );

  const start =
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() -
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

/* =========================================================
   BUCKET MODE

   >31-day custom ranges are grouped monthly.
========================================================= */

function getBucketMode(
  period: Period,
  range: DateRange
): BucketMode {
  if (
    period ===
    "3 Months"
  ) {
    return "MONTH";
  }

  if (
    period ===
      "Custom" &&
    daysBetween(
      range.startDate,
      range.endDate
    ) >
      31
  ) {
    return "MONTH";
  }

  return "DAY";
}

/* =========================================================
   TIMESTAMP → IST DATE
========================================================= */

function timestampToISTDate(
  timestamp: string
): string {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Kolkata",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
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
        "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        "day"
    )?.value;

  return `${year}-${month}-${day}`;
}

/* =========================================================
   IST DATE MIDNIGHT → INSTANT
========================================================= */

function istDateStart(
  dateString: string
): Date {
  return new Date(
    `${dateString}T00:00:00+05:30`
  );
}

/* =========================================================
   BUCKET KEY
========================================================= */

function getBucketKey(
  dateString: string,
  mode: BucketMode
): string {
  if (
    mode ===
    "MONTH"
  ) {
    return dateString.slice(
      0,
      7
    );
  }

  return dateString;
}

/* =========================================================
   BUCKET LABEL
========================================================= */

function getBucketLabel(
  dateString: string,
  mode: BucketMode
): string {
  const date =
    parseDateOnly(
      dateString
    );

  if (
    mode ===
    "MONTH"
  ) {
    return new Intl.DateTimeFormat(
      "en-IN",
      {
        month:
          "short",

        year:
          "2-digit",

        timeZone:
          "UTC",
      }
    ).format(
      date
    );
  }

  return new Intl.DateTimeFormat(
    "en-IN",
    {
      day:
        "2-digit",

      month:
        "short",

      timeZone:
        "UTC",
    }
  ).format(
    date
  );
}

/* =========================================================
   CREATE BUCKETS
========================================================= */

function createBuckets(
  range: DateRange,
  mode: BucketMode
): Array<{
  key: string;
  label: string;

  /*
   * Exact start/end required for
   * duration overlap calculation.
   */
  start: Date;
  end: Date;
}> {
  const result:
    Array<{
      key: string;
      label: string;
      start: Date;
      end: Date;
    }> = [];

  /* -------------------------------------------------------
     DAILY
  ------------------------------------------------------- */

  if (
    mode ===
    "DAY"
  ) {
    let cursor =
      range.startDate;

    while (
      cursor <=
      range.endDate
    ) {
      const nextDate =
        addDays(
          cursor,
          1
        );

      result.push({
        key:
          cursor,

        label:
          getBucketLabel(
            cursor,
            mode
          ),

        start:
          istDateStart(
            cursor
          ),

        end:
          istDateStart(
            nextDate
          ),
      });

      cursor =
        nextDate;
    }

    return result;
  }

  /* -------------------------------------------------------
     MONTHLY
  ------------------------------------------------------- */

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

  const endMonth =
    new Date(
      Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        1
      )
    );

  while (
    cursor <=
    endMonth
  ) {
    const monthStartString =
      dateToString(
        cursor
      );

    const nextMonth =
      new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() +
            1,
          1
        )
      );

    /*
     * Clip first/last monthly buckets
     * to the exact selected range.
     */

    const actualStartString =
      monthStartString <
      range.startDate
        ? range.startDate
        : monthStartString;

    const nextMonthString =
      dateToString(
        nextMonth
      );

    const dayAfterRangeEnd =
      addDays(
        range.endDate,
        1
      );

    const actualEndString =
      nextMonthString >
      dayAfterRangeEnd
        ? dayAfterRangeEnd
        : nextMonthString;

    result.push({
      key:
        monthStartString.slice(
          0,
          7
        ),

      label:
        getBucketLabel(
          monthStartString,
          "MONTH"
        ),

      start:
        istDateStart(
          actualStartString
        ),

      end:
        istDateStart(
          actualEndString
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
   INTERRUPTION END TIME

   RESTORED:
     interruption_end

   OPEN:
     current time

   CANCELLED:
     ignored elsewhere
========================================================= */

function interruptionEnd(
  row: DbInterruption
): Date {
  if (
    row.interruption_end
  ) {
    return new Date(
      row.interruption_end
    );
  }

  return new Date();
}

/* =========================================================
   INTERRUPTION DURATION OVERLAP WITH A BUCKET

   Important for proper SAIDI when an interruption
   crosses midnight/month boundaries.
========================================================= */

function getOverlapHours(
  row: DbInterruption,
  bucketStart: Date,
  bucketEnd: Date
): number {
  const interruptionStart =
    new Date(
      row.interruption_start
    );

  const interruptionFinish =
    interruptionEnd(
      row
    );

  const startMs =
    Math.max(
      interruptionStart.getTime(),
      bucketStart.getTime()
    );

  const endMs =
    Math.min(
      interruptionFinish.getTime(),
      bucketEnd.getTime()
    );

  if (
    endMs <=
    startMs
  ) {
    return 0;
  }

  return (
    endMs -
    startMs
  ) /
    3_600_000;
}

/* =========================================================
   FILTER FEEDERS FOR SELECTED SCOPE
========================================================= */

function getScopeFeeders(
  feeders: FeederWithConsumers[],
  stationId: string
): FeederWithConsumers[] {
  return feeders.filter(
    (feeder) => {
      if (
        feeder.active ===
        false
      ) {
        return false;
      }

      if (
        stationId ===
        "ALL"
      ) {
        return true;
      }

      return (
        feeder.station_id ===
        stationId
      );
    }
  );
}

/* =========================================================
   TOTAL CONSUMERS SERVED
========================================================= */

function getTotalConsumers(
  feeders: FeederWithConsumers[]
): number {
  return feeders.reduce(
    (
      total,
      feeder
    ) =>
      total +
      Math.max(
        0,
        Number(
          feeder.consumer_count ??
            0
        )
      ),

    0
  );
}

/* =========================================================
   CREATE CONSUMER LOOKUP
========================================================= */

function getConsumerMap(
  feeders: FeederWithConsumers[]
): Map<string, number> {
  const map =
    new Map<
      string,
      number
    >();

  for (
    const feeder of
    feeders
  ) {
    map.set(
      feeder.id,
      Math.max(
        0,
        Number(
          feeder.consumer_count ??
            0
        )
      )
    );
  }

  return map;
}

/* =========================================================
   FILTER VALID INTERRUPTIONS

   CANCELLED interruptions are not counted.

   feeder_id = null is excluded because no affected
   consumer count can be determined.
========================================================= */

function validInterruptions(
  interruptions: Interruption[],
  stationId: string
): DbInterruption[] {
  return interruptions
    .map(
      (row) =>
        row as DbInterruption
    )
    .filter(
      (row) => {
        if (
          row.current_status ===
          "CANCELLED"
        ) {
          return false;
        }

        if (
          !row.feeder_id
        ) {
          return false;
        }

        if (
          stationId !==
            "ALL" &&
          row.station_id !==
            stationId
        ) {
          return false;
        }

        return Boolean(
          row.interruption_start
        );
      }
    );
}

/* =========================================================
   BUILD SAIDI DATA

   SAIDI =
   Σ (interruption duration hours × consumers affected)
   -------------------------------------------------------
                  total consumers served
========================================================= */

function buildSaidiData(
  interruptions: DbInterruption[],
  scopeFeeders: FeederWithConsumers[],
  buckets: ReturnType<typeof createBuckets>
): GraphPoint[] {
  const consumerMap =
    getConsumerMap(
      scopeFeeders
    );

  const totalConsumers =
    getTotalConsumers(
      scopeFeeders
    );

  return buckets.map(
    (bucket) => {
      let customerHours =
        0;

      let interruptionCount =
        0;

      let affectedConsumers =
        0;

      for (
        const interruption of
        interruptions
      ) {
        if (
          !interruption.feeder_id
        ) {
          continue;
        }

        const consumers =
          consumerMap.get(
            interruption.feeder_id
          ) ??
          0;

        if (
          consumers <=
          0
        ) {
          continue;
        }

        const durationHours =
          getOverlapHours(
            interruption,
            bucket.start,
            bucket.end
          );

        if (
          durationHours <=
          0
        ) {
          continue;
        }

        customerHours +=
          durationHours *
          consumers;

        interruptionCount +=
          1;

        affectedConsumers +=
          consumers;
      }

      const saidi =
        totalConsumers >
        0
          ? customerHours /
            totalConsumers
          : 0;

      return {
        key:
          bucket.key,

        day:
          bucket.label,

        value:
          Number(
            saidi.toFixed(
              4
            )
          ),

        interruptions:
          interruptionCount,

        affectedConsumers,
      };
    }
  );
}

/* =========================================================
   BUILD SAIFI DATA

   SAIFI =
   Σ consumers interrupted
   -----------------------
     total consumers served

   An interruption event belongs to the bucket in which
   that interruption STARTED.
========================================================= */

function buildSaifiData(
  interruptions: DbInterruption[],
  scopeFeeders: FeederWithConsumers[],
  buckets: ReturnType<typeof createBuckets>
): GraphPoint[] {
  const consumerMap =
    getConsumerMap(
      scopeFeeders
    );

  const totalConsumers =
    getTotalConsumers(
      scopeFeeders
    );

  return buckets.map(
    (bucket) => {
      let customerInterruptions =
        0;

      let interruptionCount =
        0;

      for (
        const interruption of
        interruptions
      ) {
        if (
          !interruption.feeder_id
        ) {
          continue;
        }

        const start =
          new Date(
            interruption.interruption_start
          );

        if (
          start <
            bucket.start ||
          start >=
            bucket.end
        ) {
          continue;
        }

        const consumers =
          consumerMap.get(
            interruption.feeder_id
          ) ??
          0;

        if (
          consumers <=
          0
        ) {
          continue;
        }

        customerInterruptions +=
          consumers;

        interruptionCount +=
          1;
      }

      const saifi =
        totalConsumers >
        0
          ? customerInterruptions /
            totalConsumers
          : 0;

      return {
        key:
          bucket.key,

        day:
          bucket.label,

        value:
          Number(
            saifi.toFixed(
              4
            )
          ),

        interruptions:
          interruptionCount,

        affectedConsumers:
          customerInterruptions,
      };
    }
  );
}

/* =========================================================
   TOOLTIP
========================================================= */

function IndexTooltip({
  active,
  payload,
  label,
  type,
}: {
  active?:
    boolean;

  payload?:
    ReadonlyArray<{
      payload:
        GraphPoint;
    }>;

  label?:
    string;

  type:
    "SAIDI" |
    "SAIFI";
}) {
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
      .payload;

  return (
    <div
      style={{
        minWidth:
          165,

        background:
          "#FFFFFF",

        border:
          "1px solid #E2E8F0",

        borderRadius:
          11,

        padding:
          "10px 12px",

        boxShadow:
          "0 8px 22px rgba(15,23,42,.14)",
      }}
    >
      <div
        style={{
          fontSize:
            11,

          fontWeight:
            700,

          color:
            "#475569",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            5,

          fontSize:
            15,

          fontWeight:
            800,

          color:
            type ===
            "SAIDI"
              ? "#1976D2"
              : "#2E7D32",
        }}
      >
        {row.value.toFixed(
          4
        )}

        {type ===
        "SAIDI"
          ? " hrs/customer"
          : " interruptions/customer"}
      </div>

      <div
        style={{
          marginTop:
            5,

          fontSize:
            10,

          color:
            "#64748B",
        }}
      >
        Interruption events:{" "}
        <strong>
          {
            row.interruptions
          }
        </strong>
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            10,

          color:
            "#64748B",
        }}
      >
        Customer interruptions:{" "}
        <strong>
          {
            row.affectedConsumers
          }
        </strong>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function IndicesAnalysis() {
  const {
    stations,
  } =
    useApp();

  /* =======================================================
     DB DATA
  ======================================================= */

  const [
    feeders,
    setFeeders,
  ] =
    useState<
      FeederWithConsumers[]
    >([]);

  const [
    interruptions,
    setInterruptions,
  ] =
    useState<
      Interruption[]
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
     SAIDI FILTERS
  ======================================================= */

  const [
    saidiStationId,
    setSaidiStationId,
  ] =
    useState(
      "ALL"
    );

  const [
    saidiPeriod,
    setSaidiPeriod,
  ] =
    useState<Period>(
      "7 Days"
    );

  const [
    saidiCustomRange,
    setSaidiCustomRange,
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

  /* =======================================================
     SAIFI FILTERS

     Completely independent from SAIDI.
  ======================================================= */

  const [
    saifiStationId,
    setSaifiStationId,
  ] =
    useState(
      "ALL"
    );

  const [
    saifiPeriod,
    setSaifiPeriod,
  ] =
    useState<Period>(
      "7 Days"
    );

  const [
    saifiCustomRange,
    setSaifiCustomRange,
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

  /* =======================================================
     CUSTOM MODAL
  ======================================================= */

  const [
    customCard,
    setCustomCard,
  ] =
    useState<CustomCard>(
      null
    );

  const [
    modalStartDate,
    setModalStartDate,
  ] =
    useState(
      ""
    );

  const [
    modalEndDate,
    setModalEndDate,
  ] =
    useState(
      ""
    );

  const [
    modalError,
    setModalError,
  ] =
    useState(
      ""
    );

  /* =======================================================
     LOAD DATABASE DATA
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
            feederRows,
            interruptionRows,
          ] =
            await Promise.all([
              api.getFeeders(),
              api.getInterruptions(),
            ]);

          setFeeders(
            feederRows as
              FeederWithConsumers[]
          );

          setInterruptions(
            interruptionRows
          );
        } catch (e) {
          console.error(
            "Failed to load reliability indices:",
            e
          );

          setError(
            e instanceof Error
              ? e.message
              : "Failed to load SAIDI/SAIFI data."
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
     RANGES
  ======================================================= */

  const saidiRange =
    useMemo(
      () =>
        getPeriodRange(
          saidiPeriod,
          saidiCustomRange
        ),
      [
        saidiPeriod,
        saidiCustomRange,
      ]
    );

  const saifiRange =
    useMemo(
      () =>
        getPeriodRange(
          saifiPeriod,
          saifiCustomRange
        ),
      [
        saifiPeriod,
        saifiCustomRange,
      ]
    );

  /* =======================================================
     MODES
  ======================================================= */

  const saidiBucketMode =
    useMemo(
      () =>
        getBucketMode(
          saidiPeriod,
          saidiRange
        ),
      [
        saidiPeriod,
        saidiRange,
      ]
    );

  const saifiBucketMode =
    useMemo(
      () =>
        getBucketMode(
          saifiPeriod,
          saifiRange
        ),
      [
        saifiPeriod,
        saifiRange,
      ]
    );

  /* =======================================================
     SCOPE FEEDERS
  ======================================================= */

  const saidiFeeders =
    useMemo(
      () =>
        getScopeFeeders(
          feeders,
          saidiStationId
        ),
      [
        feeders,
        saidiStationId,
      ]
    );

  const saifiFeeders =
    useMemo(
      () =>
        getScopeFeeders(
          feeders,
          saifiStationId
        ),
      [
        feeders,
        saifiStationId,
      ]
    );

  /* =======================================================
     VALID INTERRUPTIONS
  ======================================================= */

  const saidiInterruptions =
    useMemo(
      () =>
        validInterruptions(
          interruptions,
          saidiStationId
        ),
      [
        interruptions,
        saidiStationId,
      ]
    );

  const saifiInterruptions =
    useMemo(
      () =>
        validInterruptions(
          interruptions,
          saifiStationId
        ),
      [
        interruptions,
        saifiStationId,
      ]
    );

  /* =======================================================
     GRAPH BUCKETS
  ======================================================= */

  const saidiBuckets =
    useMemo(
      () =>
        createBuckets(
          saidiRange,
          saidiBucketMode
        ),
      [
        saidiRange,
        saidiBucketMode,
      ]
    );

  const saifiBuckets =
    useMemo(
      () =>
        createBuckets(
          saifiRange,
          saifiBucketMode
        ),
      [
        saifiRange,
        saifiBucketMode,
      ]
    );

  /* =======================================================
     SAIDI DATA
  ======================================================= */

  const saidiData =
    useMemo(
      () =>
        buildSaidiData(
          saidiInterruptions,
          saidiFeeders,
          saidiBuckets
        ),
      [
        saidiInterruptions,
        saidiFeeders,
        saidiBuckets,
      ]
    );

  /* =======================================================
     SAIFI DATA
  ======================================================= */

  const saifiData =
    useMemo(
      () =>
        buildSaifiData(
          saifiInterruptions,
          saifiFeeders,
          saifiBuckets
        ),
      [
        saifiInterruptions,
        saifiFeeders,
        saifiBuckets,
      ]
    );

  /* =======================================================
     TOTAL CONSUMERS DISPLAY
  ======================================================= */

  const saidiTotalConsumers =
    useMemo(
      () =>
        getTotalConsumers(
          saidiFeeders
        ),
      [
        saidiFeeders,
      ]
    );

  const saifiTotalConsumers =
    useMemo(
      () =>
        getTotalConsumers(
          saifiFeeders
        ),
      [
        saifiFeeders,
      ]
    );

  /* =======================================================
     OPEN CUSTOM MODAL
  ======================================================= */

  const openCustomModal =
    useCallback(
      (
        card:
          Exclude<
            CustomCard,
            null
          >
      ) => {
        const range =
          card ===
          "SAIDI"
            ? saidiCustomRange
            : saifiCustomRange;

        setModalStartDate(
          range.startDate
        );

        setModalEndDate(
          range.endDate
        );

        setModalError(
          ""
        );

        setCustomCard(
          card
        );
      },
      [
        saidiCustomRange,
        saifiCustomRange,
      ]
    );

  /* =======================================================
     PERIOD HANDLERS
  ======================================================= */

  function handleSaidiPeriod(
    value: Period
  ) {
    if (
      value ===
      "Custom"
    ) {
      openCustomModal(
        "SAIDI"
      );

      return;
    }

    setSaidiPeriod(
      value
    );
  }

  function handleSaifiPeriod(
    value: Period
  ) {
    if (
      value ===
      "Custom"
    ) {
      openCustomModal(
        "SAIFI"
      );

      return;
    }

    setSaifiPeriod(
      value
    );
  }

  /* =======================================================
     APPLY CUSTOM
  ======================================================= */

  function applyCustomRange() {
    if (
      !customCard
    ) {
      return;
    }

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
        "The selected period cannot exceed one year."
      );

      return;
    }

    const range:
      DateRange = {
        startDate:
          modalStartDate,

        endDate:
          modalEndDate,
      };

    if (
      customCard ===
      "SAIDI"
    ) {
      setSaidiCustomRange(
        range
      );

      setSaidiPeriod(
        "Custom"
      );
    } else {
      setSaifiCustomRange(
        range
      );

      setSaifiPeriod(
        "Custom"
      );
    }

    setCustomCard(
      null
    );
  }

  /* =======================================================
     STATION OPTIONS
  ======================================================= */

  const stationOptions = (
    <>
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
    </>
  );

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading
  ) {
    return (
      <MessageCard>
        Loading SAIDI / SAIFI analytics…
      </MessageCard>
    );
  }

  /* =======================================================
     ERROR
  ======================================================= */

  if (
    error
  ) {
    return (
      <MessageCard>
        <div
          style={{
            color:
              "#DC2626",

            fontWeight:
              700,

            marginBottom:
              10,
          }}
        >
          Failed to load reliability indices
        </div>

        <div
          style={{
            color:
              "#64748B",

            marginBottom:
              15,
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
            retryButtonStyle
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
      <div
        style={{
          display:
            "flex",

          flexDirection:
            "column",

          gap:
            18,

          paddingBottom:
            120,
        }}
      >
        {/* =================================================
            SAIDI
        ================================================== */}

        <AnalysisCard>
          <h3
            style={
              headingStyle
            }
          >
            SAIDI
          </h3>

          <p
            style={
              subtitleStyle
            }
          >
            System Average Interruption Duration Index
          </p>

          <div
            style={
              filterRowStyle
            }
          >
            <select
              value={
                saidiStationId
              }

              onChange={(
                event
              ) =>
                setSaidiStationId(
                  event.target.value
                )
              }

              style={
                stationSelectStyle
              }
            >
              {
                stationOptions
              }
            </select>

            <PeriodSelect
              value={
                saidiPeriod
              }

              onChange={
                handleSaidiPeriod
              }
            />
          </div>

          {saidiPeriod ===
            "Custom" && (
            <CustomRangeButton
              range={
                saidiCustomRange
              }

              onClick={() =>
                openCustomModal(
                  "SAIDI"
                )
              }
            />
          )}

          <FormulaInfo
            formula="Σ (Interruption Duration × Consumers Affected) ÷ Total Consumers Served"

            consumers={
              saidiTotalConsumers
            }

            unit="Hours / Customer"
          />

          {saidiTotalConsumers ===
          0 ? (
            <NoConsumerData />
          ) : (
            <div
              style={{
                height:
                  270,
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <AreaChart
                  data={
                    saidiData
                  }
                >
                  <defs>
                    <linearGradient
                      id="saidiFillReal"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#1976D2"
                        stopOpacity={
                          0.8
                        }
                      />

                      <stop
                        offset="95%"
                        stopColor="#1976D2"
                        stopOpacity={
                          0.05
                        }
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                  />

                  <XAxis
                    dataKey="day"

                    fontSize={
                      10
                    }

                    interval="preserveStartEnd"
                  />

                  <YAxis
                    fontSize={
                      10
                    }

                    tickFormatter={(
                      value
                    ) =>
                      Number(
                        value
                      ).toFixed(
                        2
                      )
                    }
                  />

                  <Tooltip
                    content={(
                      props
                    ) => (
                      <IndexTooltip
                        active={
                          props.active
                        }

                        payload={
                          props.payload as
                            | ReadonlyArray<{
                                payload:
                                  GraphPoint;
                              }>
                            | undefined
                        }

                        label={
                          String(
                            props.label ??
                              ""
                          )
                        }

                        type="SAIDI"
                      />
                    )}
                  />

                  <Area
                    type="monotone"

                    dataKey="value"

                    stroke="#1976D2"

                    fill="url(#saidiFillReal)"

                    strokeWidth={
                      3
                    }

                    dot={{
                      r:
                        3,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </AnalysisCard>

        {/* =================================================
            SAIFI
        ================================================== */}

        <AnalysisCard>
          <h3
            style={
              headingStyle
            }
          >
            SAIFI
          </h3>

          <p
            style={
              subtitleStyle
            }
          >
            System Average Interruption Frequency Index
          </p>

          <div
            style={
              filterRowStyle
            }
          >
            <select
              value={
                saifiStationId
              }

              onChange={(
                event
              ) =>
                setSaifiStationId(
                  event.target.value
                )
              }

              style={
                stationSelectStyle
              }
            >
              {
                stationOptions
              }
            </select>

            <PeriodSelect
              value={
                saifiPeriod
              }

              onChange={
                handleSaifiPeriod
              }
            />
          </div>

          {saifiPeriod ===
            "Custom" && (
            <CustomRangeButton
              range={
                saifiCustomRange
              }

              onClick={() =>
                openCustomModal(
                  "SAIFI"
                )
              }
            />
          )}

          <FormulaInfo
            formula="Σ Consumers Affected by Each Interruption ÷ Total Consumers Served"

            consumers={
              saifiTotalConsumers
            }

            unit="Interruptions / Customer"
          />

          {saifiTotalConsumers ===
          0 ? (
            <NoConsumerData />
          ) : (
            <div
              style={{
                height:
                  270,
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <AreaChart
                  data={
                    saifiData
                  }
                >
                  <defs>
                    <linearGradient
                      id="saifiFillReal"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#43A047"
                        stopOpacity={
                          0.8
                        }
                      />

                      <stop
                        offset="95%"
                        stopColor="#43A047"
                        stopOpacity={
                          0.05
                        }
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                  />

                  <XAxis
                    dataKey="day"

                    fontSize={
                      10
                    }

                    interval="preserveStartEnd"
                  />

                  <YAxis
                    fontSize={
                      10
                    }

                    tickFormatter={(
                      value
                    ) =>
                      Number(
                        value
                      ).toFixed(
                        2
                      )
                    }
                  />

                  <Tooltip
                    content={(
                      props
                    ) => (
                      <IndexTooltip
                        active={
                          props.active
                        }

                        payload={
                          props.payload as
                            | ReadonlyArray<{
                                payload:
                                  GraphPoint;
                              }>
                            | undefined
                        }

                        label={
                          String(
                            props.label ??
                              ""
                          )
                        }

                        type="SAIFI"
                      />
                    )}
                  />

                  <Area
                    type="monotone"

                    dataKey="value"

                    stroke="#43A047"

                    fill="url(#saifiFillReal)"

                    strokeWidth={
                      3
                    }

                    dot={{
                      r:
                        3,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </AnalysisCard>
      </div>

      {/* ===================================================
          CUSTOM DATE MODAL
      ==================================================== */}

      {customCard && (
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
              ""
            );

            if (
              value &&
              modalEndDate >
                addYears(
                  value,
                  1
                )
            ) {
              const maximum =
                addYears(
                  value,
                  1
                );

              setModalEndDate(
                maximum >
                getTodayIST()
                  ? getTodayIST()
                  : maximum
              );
            }
          }}

          onEndDateChange={(
            value
          ) => {
            setModalEndDate(
              value
            );

            setModalError(
              ""
            );
          }}

          onCancel={() =>
            setCustomCard(
              null
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
   ANALYSIS CARD
========================================================= */

function AnalysisCard({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <div
      style={{
        background:
          "#fff",

        borderRadius:
          18,

        padding:
          18,

        boxShadow:
          "0 4px 12px rgba(0,0,0,.08)",
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   PERIOD SELECT

   Same repeated-Custom mechanism used in the
   other analytics pages.
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
    "Custom"
      ? "__CUSTOM_ACTIVE__"
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
          "__CUSTOM_ACTIVE__"
        ) {
          return;
        }

        onChange(
          selected as Period
        );
      }}

      style={
        periodSelectStyle
      }
    >
      {value ===
        "Custom" && (
        <option
          value="__CUSTOM_ACTIVE__"
          disabled
        >
          Custom
        </option>
      )}

      {periods.map(
        (
          period
        ) => (
          <option
            key={
              period
            }

            value={
              period
            }
          >
            {period}
          </option>
        )
      )}
    </select>
  );
}

/* =========================================================
   CUSTOM RANGE BUTTON
========================================================= */

function CustomRangeButton({
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
        display:
          "inline-flex",

        alignItems:
          "center",

        gap:
          7,

        marginBottom:
          12,

        padding:
          "7px 10px",

        border:
          "1px solid #BFDBFE",

        borderRadius:
          9,

        background:
          "#EFF6FF",

        color:
          "#1D4ED8",

        fontSize:
          11,

        fontWeight:
          700,

        cursor:
          "pointer",
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

      {" — "}

      {formatDate(
        range.endDate
      )}
    </button>
  );
}

/* =========================================================
   FORMULA INFORMATION
========================================================= */

function FormulaInfo({
  formula,
  consumers,
  unit,
}: {
  formula:
    string;

  consumers:
    number;

  unit:
    string;
}) {
  return (
    <div
      style={{
        marginBottom:
          14,

        padding:
          "10px 12px",

        borderRadius:
          11,

        background:
          "#F8FAFC",

        border:
          "1px solid #E2E8F0",
      }}
    >
      <div
        style={{
          fontSize:
            10,

          color:
            "#64748B",

          lineHeight:
            1.45,
        }}
      >
        {formula}
      </div>

      <div
        style={{
          marginTop:
            5,

          display:
            "flex",

          justifyContent:
            "space-between",

          gap:
            10,

          fontSize:
            10,

          fontWeight:
            700,

          color:
            "#334155",
        }}
      >
        <span>
          Consumers served:{" "}
          {consumers.toLocaleString(
            "en-IN"
          )}
        </span>

        <span>
          {unit}
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   NO CONSUMER DATA
========================================================= */

function NoConsumerData() {
  return (
    <div
      style={{
        minHeight:
          220,

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "center",

        textAlign:
          "center",

        color:
          "#94A3B8",

        fontSize:
          12,

        lineHeight:
          1.5,

        padding:
          20,
      }}
    >
      Consumer count is zero for the selected station scope. SAIDI / SAIFI cannot be calculated.
    </div>
  );
}

/* =========================================================
   CUSTOM MODAL
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

  const minStartDate =
    endDate
      ? addYears(
          endDate,
          -1
        )
      : undefined;

  return (
    <div
      style={{
        position:
          "fixed",

        inset:
          0,

        zIndex:
          1000,

        background:
          "rgba(15,23,42,.50)",

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "center",

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
            "100%",

          maxWidth:
            390,

          background:
            "#FFFFFF",

          borderRadius:
            20,

          overflow:
            "hidden",

          boxShadow:
            "0 20px 50px rgba(15,23,42,.28)",
        }}
      >
        <div
          style={{
            background:
              "linear-gradient(135deg,#0D47A1,#1565C0)",

            color:
              "#FFFFFF",

            padding:
              "16px 18px",

            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "space-between",
          }}
        >
          <div
            style={{
              display:
                "flex",

              alignItems:
                "center",

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
                  fontSize:
                    16,

                  fontWeight:
                    700,
                }}
              >
                Custom Date Range
              </div>

              <div
                style={{
                  marginTop:
                    2,

                  fontSize:
                    10,

                  opacity:
                    0.85,
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
                "none",

              background:
                "rgba(255,255,255,.14)",

              color:
                "#FFFFFF",

              width:
                32,

              height:
                32,

              borderRadius:
                "50%",

              display:
                "grid",

              placeItems:
                "center",

              cursor:
                "pointer",
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

            min={
              minStartDate
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

              fontSize:
                10,

              color:
                "#64748B",

              lineHeight:
                1.4,
            }}
          >
            The selected period can span a maximum of one year. Future dates cannot be selected.
          </div>

          {error && (
            <div
              style={{
                marginTop:
                  10,

                padding:
                  "8px 10px",

                borderRadius:
                  8,

                background:
                  "#FEF2F2",

                color:
                  "#B91C1C",

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
                "flex",

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
                flex:
                  1,

                border:
                  "1px solid #CBD5E1",

                background:
                  "#FFFFFF",

                color:
                  "#475569",

                padding:
                  "10px",

                borderRadius:
                  10,

                fontWeight:
                  700,

                cursor:
                  "pointer",
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
                flex:
                  1,

                border:
                  "none",

                background:
                  "#1565C0",

                color:
                  "#FFFFFF",

                padding:
                  "10px",

                borderRadius:
                  10,

                fontWeight:
                  700,

                cursor:
                  "pointer",
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
          "#FFFFFF",

        borderRadius:
          18,

        padding:
          30,

        boxShadow:
          "0 4px 12px rgba(0,0,0,.08)",

        textAlign:
          "center",

        color:
          "#64748B",

        fontSize:
          13,
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   COMMON STYLES
========================================================= */

const headingStyle:
  CSSProperties = {
    margin:
      0,

    fontSize:
      18,

    fontWeight:
      700,

    color:
      "#1E293B",
  };

const subtitleStyle:
  CSSProperties = {
    margin:
      "4px 0 16px",

    fontSize:
      11,

    color:
      "#64748B",
  };

const filterRowStyle:
  CSSProperties = {
    display:
      "flex",

    gap:
      12,

    marginBottom:
      12,

    flexWrap:
      "wrap",
  };

const stationSelectStyle:
  CSSProperties = {
    flex:
      1,

    minWidth:
      150,

    padding:
      "8px 12px",

    borderRadius:
      8,

    border:
      "1px solid #CBD5E1",

    background:
      "#FFFFFF",

    color:
      "#334155",

    fontSize:
      13,

    outline:
      "none",
  };

const periodSelectStyle:
  CSSProperties = {
    width:
      135,

    padding:
      "8px 10px",

    borderRadius:
      8,

    border:
      "1px solid #CBD5E1",

    background:
      "#FFFFFF",

    color:
      "#334155",

    fontSize:
      13,

    outline:
      "none",
  };

const modalLabelStyle:
  CSSProperties = {
    display:
      "block",

    marginBottom:
      6,

    color:
      "#475569",

    fontSize:
      11,

    fontWeight:
      700,
  };

const modalInputStyle:
  CSSProperties = {
    width:
      "100%",

    boxSizing:
      "border-box",

    padding:
      "10px 12px",

    border:
      "1px solid #CBD5E1",

    borderRadius:
      10,

    fontSize:
      14,

    outline:
      "none",
  };

const retryButtonStyle:
  CSSProperties = {
    border:
      "none",

    borderRadius:
      10,

    padding:
      "10px 18px",

    background:
      "#1565C0",

    color:
      "#FFFFFF",

    fontWeight:
      600,

    cursor:
      "pointer",
  };
