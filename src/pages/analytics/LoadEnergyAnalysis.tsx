import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ReactNode,
} from "react";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import {
  CalendarDays,
  X,
  Zap,
} from "lucide-react";

import { api } from "@/services/api";

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

type FillStatus =
  | "EMPTY"
  | "PARTIAL"
  | "FULL";

type CustomRange = {
  startDate: string;
  endDate: string;
};

type LogMwRow = {
  station_id: string;
  feeder_id: string | null;
  actual_event_time: string;
  mw: number | null;
};

type GraphRow = {
  date: string;
  day: string;
  value: number;

  /*
   * Completeness of data
   * for the entire date.
   */
  status: FillStatus;

  enteredSlots: number;
  expectedSlots: number;
};

type PeakSummaryData = {
  value: number;
  date: string;
  status: FillStatus;
} | null;

type CustomCard =
  | "UTILITY"
  | "STATION"
  | "FEEDER"
  | null;

/* =========================================================
   PERIOD OPTIONS
========================================================= */

const periods: Period[] = [
  "Last 7 Days",
  "Last 15 Days",
  "Last 30 Days",
  "Last 3 Months",
  "Custom",
];

/* =========================================================
   COLORS
========================================================= */

/*
 * Same meaning across all three graphs:
 *
 * BLUE   = Complete
 * ORANGE = Partial
 * GREY   = No data
 */

const FULL_COLOR =
  "#2563EB";

const PARTIAL_COLOR =
  "#F59E0B";

const EMPTY_COLOR =
  "#CBD5E1";

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
   TODAY — ASIA/KOLKATA
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
   ADD DAYS
========================================================= */

function addDays(
  dateString: string,
  days: number
): string {
  const [
    year,
    month,
    day,
  ] =
    dateString
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
      date.getUTCMonth() +
        1
    ),
    pad2(
      date.getUTCDate()
    ),
  ].join("-");
}

/* =========================================================
   ADD YEARS

   Used for the maximum 1-year
   custom period restriction.
========================================================= */

function addYears(
  dateString: string,
  years: number
): string {
  const [
    year,
    month,
    day,
  ] =
    dateString
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
      date.getUTCMonth() +
        1
    ),
    pad2(
      date.getUTCDate()
    ),
  ].join("-");
}

/* =========================================================
   MIN DATE STRING
========================================================= */

function minDate(
  first: string,
  second: string
): string {
  return first <
    second
    ? first
    : second;
}

/* =========================================================
   PERIOD → DATE RANGE
========================================================= */

function getPeriodRange(
  period: Period,
  customRange: CustomRange
): CustomRange {
  const today =
    getTodayIST();

  if (
    period ===
    "Custom"
  ) {
    return customRange;
  }

  let days =
    7;

  if (
    period ===
    "Last 15 Days"
  ) {
    days =
      15;
  }

  if (
    period ===
    "Last 30 Days"
  ) {
    days =
      30;
  }

  if (
    period ===
    "Last 3 Months"
  ) {
    days =
      90;
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

/* =========================================================
   FORMAT GRAPH DATE

   Example:
   25 Aug
========================================================= */

function formatGraphDate(
  dateString: string
): string {
  const [
    year,
    month,
    day,
  ] =
    dateString
      .split("-")
      .map(Number);

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day:
        "2-digit",

      month:
        "short",
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

/* =========================================================
   FORMAT FULL DATE

   Example:
   25 Aug 2026
========================================================= */

function formatFullDate(
  dateString: string
): string {
  if (
    !dateString
  ) {
    return "—";
  }

  const [
    year,
    month,
    day,
  ] =
    dateString
      .split("-")
      .map(Number);

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day:
        "2-digit",

      month:
        "short",

      year:
        "numeric",
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

/* =========================================================
   GET DATE IN IST FROM TIMESTAMPTZ
========================================================= */

function getISTDate(
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
   GET HOUR IN IST
========================================================= */

function getISTHour(
  timestamp: string
): number {
  return Number(
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Kolkata",

        hour:
          "2-digit",

        hourCycle:
          "h23",
      }
    ).format(
      new Date(
        timestamp
      )
    )
  );
}

/* =========================================================
   CURRENT IST HOUR
========================================================= */

function getCurrentHourIST():
  number {
  return Number(
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Kolkata",

        hour:
          "2-digit",

        hourCycle:
          "h23",
      }
    ).format(
      new Date()
    )
  );
}

/* =========================================================
   EXPECTED HOURS FOR A DATE

   Past date:
       24 hours

   Today:
       00:00 through current hour

   Future dates are not selectable.
========================================================= */

function expectedHoursForDate(
  date: string
): number {
  const today =
    getTodayIST();

  if (
    date ===
    today
  ) {
    return (
      getCurrentHourIST() +
      1
    );
  }

  return 24;
}

/* =========================================================
   DATES IN RANGE
========================================================= */

function getDatesInRange(
  startDate: string,
  endDate: string
): string[] {
  if (
    !startDate ||
    !endDate
  ) {
    return [];
  }

  const dates:
    string[] = [];

  let current =
    startDate;

  while (
    current <=
    endDate
  ) {
    dates.push(
      current
    );

    current =
      addDays(
        current,
        1
      );
  }

  return dates;
}

/* =========================================================
   DATABASE READ
========================================================= */

async function loadLogBookMw(
  startDate: string,
  endDate: string,
  stationId:
    string | null =
      null,
  feederId:
    string | null =
      null
): Promise<
  LogMwRow[]
> {
  const start =
    new Date(
      `${startDate}T00:00:00+05:30`
    );

  const dayAfterEnd =
    addDays(
      endDate,
      1
    );

  const end =
    new Date(
      `${dayAfterEnd}T00:00:00+05:30`
    );

  return api.getLoadEnergyReadings(
    start.toISOString(),
    end.toISOString(),
    stationId,
    feederId
  );
}

/* =========================================================
   PEAK CALCULATION

   Utility / Station:

   For each date:
       group by hour
       sum feeder MW
       highest hourly total = daily peak
========================================================= */

function calculateDailyPeak(
  rows: LogMwRow[],
  date: string
): number {
  const hourlyTotals =
    new Map<
      number,
      number
    >();

  for (
    const row of
    rows
  ) {
    if (
      row.mw ===
        null ||
      row.mw ===
        undefined
    ) {
      continue;
    }

    if (
      getISTDate(
        row.actual_event_time
      ) !==
      date
    ) {
      continue;
    }

    const hour =
      getISTHour(
        row.actual_event_time
      );

    hourlyTotals.set(
      hour,
      (
        hourlyTotals.get(
          hour
        ) ?? 0
      ) +
        Number(
          row.mw
        )
    );
  }

  if (
    hourlyTotals.size ===
    0
  ) {
    return 0;
  }

  return Math.max(
    ...Array.from(
      hourlyTotals.values()
    )
  );
}

/* =========================================================
   FEEDER DAILY PEAK
========================================================= */

function calculateFeederDailyPeak(
  rows: LogMwRow[],
  date: string
): number {
  const values =
    rows
      .filter(
        (row) =>
          getISTDate(
            row.actual_event_time
          ) ===
            date &&
          row.mw !==
            null
      )
      .map(
        (row) =>
          Number(
            row.mw
          )
      );

  if (
    values.length ===
    0
  ) {
    return 0;
  }

  return Math.max(
    ...values
  );
}

/* =========================================================
   DAILY COMPLETENESS

   This is deliberately a DAILY completeness indicator.

   Utility:
       expected =
       all active feeders × expected hours

   Station:
       expected =
       active feeders of selected station × expected hours

   Feeder:
       expected =
       one feeder × expected hours

   Duplicate rows within the same feeder/hour are counted
   only once.
========================================================= */

function getDailyStatus(
  rows: LogMwRow[],
  date: string,
  expectedFeederIds:
    Set<string>
): {
  status: FillStatus;
  enteredSlots: number;
  expectedSlots: number;
} {
  const expectedHours =
    expectedHoursForDate(
      date
    );

  const expectedSlots =
    expectedFeederIds.size *
    expectedHours;

  const entered =
    new Set<string>();

  for (
    const row of
    rows
  ) {
    if (
      !row.feeder_id
    ) {
      continue;
    }

    if (
      !expectedFeederIds.has(
        row.feeder_id
      )
    ) {
      continue;
    }

    if (
      getISTDate(
        row.actual_event_time
      ) !==
      date
    ) {
      continue;
    }

    const hour =
      getISTHour(
        row.actual_event_time
      );

    /*
     * For today, do not count
     * accidental future-hour entries.
     */

    if (
      hour >=
      expectedHours
    ) {
      continue;
    }

    entered.add(
      `${row.feeder_id}:${hour}`
    );
  }

  const enteredSlots =
    entered.size;

  if (
    enteredSlots ===
    0
  ) {
    return {
      status:
        "EMPTY",

      enteredSlots,

      expectedSlots,
    };
  }

  if (
    expectedSlots >
      0 &&
    enteredSlots >=
      expectedSlots
  ) {
    return {
      status:
        "FULL",

      enteredSlots,

      expectedSlots,
    };
  }

  return {
    status:
      "PARTIAL",

    enteredSlots,

    expectedSlots,
  };
}

/* =========================================================
   UTILITY / STATION GRAPH DATA
========================================================= */

function buildSummedPeakData(
  rows: LogMwRow[],
  startDate: string,
  endDate: string,
  expectedFeederIds:
    Set<string>
): GraphRow[] {
  return getDatesInRange(
    startDate,
    endDate
  ).map(
    (date) => {
      const peak =
        calculateDailyPeak(
          rows,
          date
        );

      const completion =
        getDailyStatus(
          rows,
          date,
          expectedFeederIds
        );

      return {
        date,

        day:
          formatGraphDate(
            date
          ),

        value:
          Number(
            peak.toFixed(
              2
            )
          ),

        status:
          completion.status,

        enteredSlots:
          completion.enteredSlots,

        expectedSlots:
          completion.expectedSlots,
      };
    }
  );
}

/* =========================================================
   FEEDER GRAPH DATA
========================================================= */

function buildFeederPeakData(
  rows: LogMwRow[],
  startDate: string,
  endDate: string,
  feederId: string
): GraphRow[] {
  const expectedFeeders =
    new Set<string>();

  if (
    feederId
  ) {
    expectedFeeders.add(
      feederId
    );
  }

  return getDatesInRange(
    startDate,
    endDate
  ).map(
    (date) => {
      const peak =
        calculateFeederDailyPeak(
          rows,
          date
        );

      const completion =
        getDailyStatus(
          rows,
          date,
          expectedFeeders
        );

      return {
        date,

        day:
          formatGraphDate(
            date
          ),

        value:
          Number(
            peak.toFixed(
              2
            )
          ),

        status:
          completion.status,

        enteredSlots:
          completion.enteredSlots,

        expectedSlots:
          completion.expectedSlots,
      };
    }
  );
}

/* =========================================================
   FIND MAX PEAK
========================================================= */

function findPeakSummary(
  data: GraphRow[]
): PeakSummaryData {
  const rowsWithData =
    data.filter(
      (row) =>
        row.status !==
        "EMPTY"
    );

  if (
    rowsWithData.length ===
    0
  ) {
    return null;
  }

  const peak =
    rowsWithData.reduce(
      (
        highest,
        current
      ) =>
        current.value >
        highest.value
          ? current
          : highest
    );

  return {
    value:
      peak.value,

    date:
      peak.date,

    status:
      peak.status,
  };
}

/* =========================================================
   BAR COLOR
========================================================= */

function getStatusColor(
  status: FillStatus
): string {
  if (
    status ===
    "FULL"
  ) {
    return FULL_COLOR;
  }

  if (
    status ===
    "PARTIAL"
  ) {
    return PARTIAL_COLOR;
  }

  return EMPTY_COLOR;
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function LoadEnergyAnalysis() {
  /* =======================================================
     ACTUAL STATIONS / FEEDERS
  ======================================================= */

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
    lookupLoading,
    setLookupLoading,
  ] = useState(
    true
  );

  const [
    lookupError,
    setLookupError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     CARD 1 — UTILITY
  ======================================================= */

  const [
    utilityPeriod,
    setUtilityPeriod,
  ] =
    useState<Period>(
      "Last 7 Days"
    );

  const [
    utilityCustomRange,
    setUtilityCustomRange,
  ] =
    useState<CustomRange>({
      startDate:
        addDays(
          getTodayIST(),
          -6
        ),

      endDate:
        getTodayIST(),
    });

  const [
    utilityData,
    setUtilityData,
  ] = useState<
    GraphRow[]
  >([]);

  const [
    utilityLoading,
    setUtilityLoading,
  ] = useState(
    false
  );

  const [
    utilityError,
    setUtilityError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     CARD 2 — STATION
  ======================================================= */

  const [
    stationCardStationId,
    setStationCardStationId,
  ] = useState(
    ""
  );

  const [
    stationPeriod,
    setStationPeriod,
  ] =
    useState<Period>(
      "Last 7 Days"
    );

  const [
    stationCustomRange,
    setStationCustomRange,
  ] =
    useState<CustomRange>({
      startDate:
        addDays(
          getTodayIST(),
          -6
        ),

      endDate:
        getTodayIST(),
    });

  const [
    stationData,
    setStationData,
  ] = useState<
    GraphRow[]
  >([]);

  const [
    stationLoading,
    setStationLoading,
  ] = useState(
    false
  );

  const [
    stationError,
    setStationError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     CARD 3 — FEEDER
  ======================================================= */

  const [
    feederCardStationId,
    setFeederCardStationId,
  ] = useState(
    ""
  );

  const [
    feederCardFeederId,
    setFeederCardFeederId,
  ] = useState(
    ""
  );

  const [
    feederPeriod,
    setFeederPeriod,
  ] =
    useState<Period>(
      "Last 7 Days"
    );

  const [
    feederCustomRange,
    setFeederCustomRange,
  ] =
    useState<CustomRange>({
      startDate:
        addDays(
          getTodayIST(),
          -6
        ),

      endDate:
        getTodayIST(),
    });

  const [
    feederData,
    setFeederData,
  ] = useState<
    GraphRow[]
  >([]);

  const [
    feederLoading,
    setFeederLoading,
  ] = useState(
    false
  );

  const [
    feederError,
    setFeederError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     CUSTOM MODAL
  ======================================================= */

  const [
    customCard,
    setCustomCard,
  ] = useState<
    CustomCard
  >(null);

  const [
    modalStartDate,
    setModalStartDate,
  ] = useState(
    ""
  );

  const [
    modalEndDate,
    setModalEndDate,
  ] = useState(
    ""
  );

  const [
    modalError,
    setModalError,
  ] = useState(
    ""
  );

  /* =======================================================
     LOAD STATIONS / FEEDERS
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadLookups() {
      setLookupLoading(
        true
      );

      setLookupError(
        null
      );

      try {
        const [
          stationRows,
          feederRows,
        ] =
          await Promise.all([
            api.getStations(),
            api.getFeeders(),
          ]);

        if (
          cancelled
        ) {
          return;
        }

        setStations(
          stationRows
        );

        /*
         * Only retain feeders which are
         * not explicitly inactive.
         */

        const activeFeeders =
          feederRows.filter(
            (feeder) =>
              feeder.active !==
              false
          );

        setFeeders(
          activeFeeders
        );

        if (
          stationRows.length >
          0
        ) {
          setStationCardStationId(
            (
              current
            ) =>
              current ||
              stationRows[0].id
          );

          setFeederCardStationId(
            (
              current
            ) =>
              current ||
              stationRows[0].id
          );
        }
      } catch (e) {
        console.error(
          "Failed to load stations/feeders:",
          e
        );

        if (
          !cancelled
        ) {
          setLookupError(
            e instanceof Error
              ? e.message
              : "Failed to load stations and feeders."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLookupLoading(
            false
          );
        }
      }
    }

    void loadLookups();

    return () => {
      cancelled =
        true;
    };
  }, []);

  /* =======================================================
     ALL FEEDER IDS
  ======================================================= */

  const allFeederIds =
    useMemo(
      () =>
        new Set(
          feeders.map(
            (feeder) =>
              feeder.id
          )
        ),
      [
        feeders,
      ]
    );

  /* =======================================================
     CARD 2 FEEDER IDS
  ======================================================= */

  const stationCardFeederIds =
    useMemo(
      () =>
        new Set(
          feeders
            .filter(
              (feeder) =>
                feeder.station_id ===
                stationCardStationId
            )
            .map(
              (feeder) =>
                feeder.id
            )
        ),
      [
        feeders,
        stationCardStationId,
      ]
    );

  /* =======================================================
     CARD 3 FEEDERS
  ======================================================= */

  const feederCardFeeders =
    useMemo(
      () =>
        feeders.filter(
          (feeder) =>
            feeder.station_id ===
            feederCardStationId
        ),
      [
        feeders,
        feederCardStationId,
      ]
    );

  /* =======================================================
     RESET FEEDER WHEN CARD 3 STATION CHANGES
  ======================================================= */

  useEffect(() => {
    if (
      !feederCardStationId
    ) {
      setFeederCardFeederId(
        ""
      );

      return;
    }

    const stillExists =
      feederCardFeeders.some(
        (feeder) =>
          feeder.id ===
          feederCardFeederId
      );

    if (
      !stillExists
    ) {
      setFeederCardFeederId(
        feederCardFeeders[0]
          ?.id ??
          ""
      );
    }
  }, [
    feederCardStationId,
    feederCardFeeders,
    feederCardFeederId,
  ]);

  /* =======================================================
     OPEN CUSTOM MODAL

     This can be called repeatedly without limitation.
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
        let range:
          CustomRange;

        if (
          card ===
          "UTILITY"
        ) {
          range =
            utilityCustomRange;
        } else if (
          card ===
          "STATION"
        ) {
          range =
            stationCustomRange;
        } else {
          range =
            feederCustomRange;
        }

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
        utilityCustomRange,
        stationCustomRange,
        feederCustomRange,
      ]
    );

  /* =======================================================
     PERIOD CHANGE
  ======================================================= */

  function handleUtilityPeriod(
    value: Period
  ) {
    if (
      value ===
      "Custom"
    ) {
      openCustomModal(
        "UTILITY"
      );

      return;
    }

    setUtilityPeriod(
      value
    );
  }

  function handleStationPeriod(
    value: Period
  ) {
    if (
      value ===
      "Custom"
    ) {
      openCustomModal(
        "STATION"
      );

      return;
    }

    setStationPeriod(
      value
    );
  }

  function handleFeederPeriod(
    value: Period
  ) {
    if (
      value ===
      "Custom"
    ) {
      openCustomModal(
        "FEEDER"
      );

      return;
    }

    setFeederPeriod(
      value
    );
  }

  /* =======================================================
     APPLY CUSTOM RANGE
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

    const maximumEndDate =
      addYears(
        modalStartDate,
        1
      );

    if (
      modalEndDate >
      maximumEndDate
    ) {
      setModalError(
        "The custom date range cannot exceed one year."
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
      customCard ===
      "UTILITY"
    ) {
      setUtilityCustomRange({
        startDate:
          modalStartDate,

        endDate:
          modalEndDate,
      });

      setUtilityPeriod(
        "Custom"
      );
    }

    if (
      customCard ===
      "STATION"
    ) {
      setStationCustomRange({
        startDate:
          modalStartDate,

        endDate:
          modalEndDate,
      });

      setStationPeriod(
        "Custom"
      );
    }

    if (
      customCard ===
      "FEEDER"
    ) {
      setFeederCustomRange({
        startDate:
          modalStartDate,

        endDate:
          modalEndDate,
      });

      setFeederPeriod(
        "Custom"
      );
    }

    setCustomCard(
      null
    );
  }

  /* =======================================================
     CARD RANGES
  ======================================================= */

  const utilityRange =
    useMemo(
      () =>
        getPeriodRange(
          utilityPeriod,
          utilityCustomRange
        ),
      [
        utilityPeriod,
        utilityCustomRange,
      ]
    );

  const stationRange =
    useMemo(
      () =>
        getPeriodRange(
          stationPeriod,
          stationCustomRange
        ),
      [
        stationPeriod,
        stationCustomRange,
      ]
    );

  const feederRange =
    useMemo(
      () =>
        getPeriodRange(
          feederPeriod,
          feederCustomRange
        ),
      [
        feederPeriod,
        feederCustomRange,
      ]
    );

  /* =======================================================
     LOAD UTILITY CARD
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadUtility() {
      setUtilityLoading(
        true
      );

      setUtilityError(
        null
      );

      try {
        const rows =
          await loadLogBookMw(
            utilityRange.startDate,
            utilityRange.endDate
          );

        if (
          cancelled
        ) {
          return;
        }

        setUtilityData(
          buildSummedPeakData(
            rows,
            utilityRange.startDate,
            utilityRange.endDate,
            allFeederIds
          )
        );
      } catch (e) {
        console.error(
          "Failed to load utility peak demand:",
          e
        );

        if (
          !cancelled
        ) {
          setUtilityData(
            []
          );

          setUtilityError(
            e instanceof Error
              ? e.message
              : "Failed to load utility peak demand."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setUtilityLoading(
            false
          );
        }
      }
    }

    void loadUtility();

    return () => {
      cancelled =
        true;
    };
  }, [
    utilityRange.startDate,
    utilityRange.endDate,
    allFeederIds,
  ]);

  /* =======================================================
     LOAD STATION CARD
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    if (
      !stationCardStationId
    ) {
      setStationData(
        []
      );

      return;
    }

    async function loadStation() {
      setStationLoading(
        true
      );

      setStationError(
        null
      );

      try {
        const rows =
          await loadLogBookMw(
            stationRange.startDate,
            stationRange.endDate,
            stationCardStationId
          );

        if (
          cancelled
        ) {
          return;
        }

        setStationData(
          buildSummedPeakData(
            rows,
            stationRange.startDate,
            stationRange.endDate,
            stationCardFeederIds
          )
        );
      } catch (e) {
        console.error(
          "Failed to load station peak demand:",
          e
        );

        if (
          !cancelled
        ) {
          setStationData(
            []
          );

          setStationError(
            e instanceof Error
              ? e.message
              : "Failed to load station peak demand."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setStationLoading(
            false
          );
        }
      }
    }

    void loadStation();

    return () => {
      cancelled =
        true;
    };
  }, [
    stationCardStationId,
    stationRange.startDate,
    stationRange.endDate,
    stationCardFeederIds,
  ]);

  /* =======================================================
     LOAD FEEDER CARD
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    if (
      !feederCardStationId ||
      !feederCardFeederId
    ) {
      setFeederData(
        []
      );

      return;
    }

    async function loadFeeder() {
      setFeederLoading(
        true
      );

      setFeederError(
        null
      );

      try {
        const rows =
          await loadLogBookMw(
            feederRange.startDate,
            feederRange.endDate,
            feederCardStationId,
            feederCardFeederId
          );

        if (
          cancelled
        ) {
          return;
        }

        setFeederData(
          buildFeederPeakData(
            rows,
            feederRange.startDate,
            feederRange.endDate,
            feederCardFeederId
          )
        );
      } catch (e) {
        console.error(
          "Failed to load feeder peak demand:",
          e
        );

        if (
          !cancelled
        ) {
          setFeederData(
            []
          );

          setFeederError(
            e instanceof Error
              ? e.message
              : "Failed to load feeder peak demand."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setFeederLoading(
            false
          );
        }
      }
    }

    void loadFeeder();

    return () => {
      cancelled =
        true;
    };
  }, [
    feederCardStationId,
    feederCardFeederId,
    feederRange.startDate,
    feederRange.endDate,
  ]);

  /* =======================================================
     PEAK SUMMARIES
  ======================================================= */

  const utilityPeak =
    useMemo(
      () =>
        findPeakSummary(
          utilityData
        ),
      [
        utilityData,
      ]
    );

  const stationPeak =
    useMemo(
      () =>
        findPeakSummary(
          stationData
        ),
      [
        stationData,
      ]
    );

  const feederPeak =
    useMemo(
      () =>
        findPeakSummary(
          feederData
        ),
      [
        feederData,
      ]
    );

  /* =======================================================
     LABELS
  ======================================================= */

  const stationName =
    stations.find(
      (station) =>
        station.id ===
        stationCardStationId
    )?.name ??
    "Station";

  const feederName =
    feeders.find(
      (feeder) =>
        feeder.id ===
        feederCardFeederId
    )?.name ??
    "Feeder";

  /* =======================================================
     RENDER
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
            20,
          paddingBottom: 110,
        }}
      >
        {/* =================================================
            CARD 1 — UTILITY
        ================================================== */}

        <AnalysisCard>
<div
  style={{
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  }}
>
  {/* Card heading */}
  <div
    style={{
      flex: 1,
      minWidth: 0,
    }}
  >
    <h3
      style={{
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        color: "#1E293B",
      }}
    >
      Utility Peak Demand
    </h3>

    <p
      style={{
        margin: "4px 0 0",
        fontSize: 11,
        color: "#64748B",
      }}
    >
      Maximum hourly summed MW across all stations
    </p>
  </div>

  {/* Period dropdown */}
  <div
    style={{
      flexShrink: 0,
    }}
  >
    <PeriodSelect
      value={utilityPeriod}
      onChange={handleUtilityPeriod}
    />
  </div>
</div>

          {utilityPeriod ===
            "Custom" && (
            <CustomRangeLabel
              range={
                utilityCustomRange
              }

              onEdit={() =>
                openCustomModal(
                  "UTILITY"
                )
              }
            />
          )}

          <PeakSummary
            peak={
              utilityPeak
            }
          />

          <GraphLegend />

          <DemandChart
            data={
              utilityData
            }

            loading={
              utilityLoading
            }

            error={
              utilityError
            }

            tooltipLabel="Utility Peak"
          />
        </AnalysisCard>

        {/* =================================================
            CARD 2 — STATION
        ================================================== */}

        <AnalysisCard>
          <CardHeader
            title="Station-wise Peak Demand"
            subtitle={`Maximum hourly summed feeder MW — ${stationName}`}
          />

          <div
            style={{
              display:
                "flex",

              flexWrap:
                "wrap",

              gap:
                10,

              marginBottom:
                14,
            }}
          >
            <select
              value={
                stationCardStationId
              }

              disabled={
                lookupLoading
              }

              onChange={(
                event
              ) =>
                setStationCardStationId(
                  event.target.value
                )
              }

              style={
                largeSelectStyle
              }
            >
              {stations.length ===
                0 && (
                <option value="">
                  {lookupLoading
                    ? "Loading stations..."
                    : "No stations available"}
                </option>
              )}

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
                stationPeriod
              }

              onChange={
                handleStationPeriod
              }
            />
          </div>

          {stationPeriod ===
            "Custom" && (
            <CustomRangeLabel
              range={
                stationCustomRange
              }

              onEdit={() =>
                openCustomModal(
                  "STATION"
                )
              }
            />
          )}

          <PeakSummary
            peak={
              stationPeak
            }
          />

          <GraphLegend />

          <DemandChart
            data={
              stationData
            }

            loading={
              stationLoading
            }

            error={
              stationError
            }

            tooltipLabel="Station Peak"
          />
        </AnalysisCard>

        {/* =================================================
            CARD 3 — FEEDER
        ================================================== */}

        <AnalysisCard>
          <CardHeader
            title="Feeder-wise Peak Demand"
            subtitle={`Maximum hourly MW — ${feederName}`}
          />

          <div
            style={{
              display:
                "flex",

              gap:
                12,

              marginBottom:
                14,

              flexWrap:
                "wrap",
            }}
          >
            {/* STATION */}

            <select
              value={
                feederCardStationId
              }

              disabled={
                lookupLoading
              }

              onChange={(
                event
              ) =>
                setFeederCardStationId(
                  event.target.value
                )
              }

              style={
                mediumSelectStyle
              }
            >
              {stations.length ===
                0 && (
                <option value="">
                  {lookupLoading
                    ? "Loading stations..."
                    : "No stations available"}
                </option>
              )}

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

            {/* FEEDER */}

            <select
              value={
                feederCardFeederId
              }

              disabled={
                !feederCardStationId ||
                feederCardFeeders.length ===
                  0
              }

              onChange={(
                event
              ) =>
                setFeederCardFeederId(
                  event.target.value
                )
              }

              style={
                feederSelectStyle
              }
            >
              {feederCardFeeders.length ===
                0 && (
                <option value="">
                  No feeders available
                </option>
              )}

              {feederCardFeeders.map(
                (
                  feeder
                ) => (
                  <option
                    key={
                      feeder.id
                    }

                    value={
                      feeder.id
                    }
                  >
                    {
                      feeder.name
                    }
                  </option>
                )
              )}
            </select>

            <PeriodSelect
              value={
                feederPeriod
              }

              onChange={
                handleFeederPeriod
              }
            />
          </div>

          {feederPeriod ===
            "Custom" && (
            <CustomRangeLabel
              range={
                feederCustomRange
              }

              onEdit={() =>
                openCustomModal(
                  "FEEDER"
                )
              }
            />
          )}

          <PeakSummary
            peak={
              feederPeak
            }
          />

          <GraphLegend />

          <DemandChart
            data={
              feederData
            }

            loading={
              feederLoading
            }

            error={
              feederError
            }

            tooltipLabel="Feeder Peak"
          />
        </AnalysisCard>

        {/* LOOKUP ERROR */}

        {lookupError && (
          <div
            style={{
              padding:
                12,

              borderRadius:
                10,

              background:
                "#FEF2F2",

              border:
                "1px solid #FECACA",

              color:
                "#B91C1C",

              fontSize:
                12,
            }}
          >
            {lookupError}
          </div>
        )}
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

            /*
             * If the existing end date
             * has now become invalid,
             * move it inside the new range.
             */

            const maxAllowed =
              minDate(
                addYears(
                  value,
                  1
                ),
                getTodayIST()
              );

            if (
              modalEndDate >
              maxAllowed
            ) {
              setModalEndDate(
                maxAllowed
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
          "#ffffff",

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
   CARD HEADER
========================================================= */

function CardHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        marginBottom:
          16,
      }}
    >
      <h3
        style={{
          margin:
            0,

          fontSize:
            18,

          fontWeight:
            700,

          color:
            "#1E293B",
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin:
            "4px 0 0",

          fontSize:
            11,

          color:
            "#64748B",
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

/* =========================================================
   PERIOD SELECT

   IMPORTANT:

   When Custom is the active period, the controlled SELECT
   uses the special "__CUSTOM_ACTIVE__" placeholder.

   Therefore the real "Custom" option always has a DIFFERENT
   value. Selecting it fires onChange every single time.

   This solves the problem where Custom previously worked
   only the first time.
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
  const selectValue =
    value ===
    "Custom"
      ? "__CUSTOM_ACTIVE__"
      : value;

  return (
    <select
      value={
        selectValue
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
          selected as
            Period
        );
      }}

      style={{
        flex:
          "0 1 170px",

        minWidth:
          135,

        padding:
          "9px 12px",

        borderRadius:
          8,

        border:
          "1px solid #D1D5DB",

        background:
          "#fff",

        fontSize:
          14,
      }}
    >
      {/* Shows "Custom" while custom range is active */}

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
   CUSTOM RANGE LABEL
========================================================= */

function CustomRangeLabel({
  range,
  onEdit,
}: {
  range:
    CustomRange;

  onEdit:
    () => void;
}) {
  return (
    <button
      type="button"

      onClick={
        onEdit
      }

      style={{
        display:
          "inline-flex",

        alignItems:
          "center",

        gap:
          7,

        marginBottom:
          14,

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

      {formatFullDate(
        range.startDate
      )}

      {" — "}

      {formatFullDate(
        range.endDate
      )}
    </button>
  );
}

/* =========================================================
   PEAK SUMMARY
========================================================= */

function PeakSummary({
  peak,
}: {
  peak:
    PeakSummaryData;
}) {
  return (
    <div
      style={{
        marginBottom:
          14,

        borderRadius:
          13,

        background:
          "#F8FAFC",

        border:
          "1px solid #E2E8F0",

        padding:
          "11px 13px",

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "space-between",

        gap:
          12,
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
        <div
          style={{
            width:
              36,

            height:
              36,

            borderRadius:
              10,

            display:
              "grid",

            placeItems:
              "center",

            background:
              "#DBEAFE",

            color:
              "#1D4ED8",
          }}
        >
          <Zap
            size={
              19
            }
          />
        </div>

        <div>
          <div
            style={{
              fontSize:
                10,

              fontWeight:
                700,

              textTransform:
                "uppercase",

              letterSpacing:
                ".05em",

              color:
                "#94A3B8",
            }}
          >
            Maximum Peak
          </div>

          <div
            style={{
              marginTop:
                2,

              fontSize:
                18,

              fontWeight:
                800,

              color:
                "#1D4ED8",
            }}
          >
            {peak
              ? `${peak.value.toFixed(
                  2
                )} MW`
              : "—"}
          </div>
        </div>
      </div>

      <div
        style={{
          textAlign:
            "right",
        }}
      >
        <div
          style={{
            fontSize:
              10,

            fontWeight:
              700,

            textTransform:
              "uppercase",

            color:
              "#94A3B8",
          }}
        >
          Recorded On
        </div>

        <div
          style={{
            marginTop:
              3,

            fontSize:
              12,

            fontWeight:
              700,

            color:
              "#334155",
          }}
        >
          {peak
            ? formatFullDate(
                peak.date
              )
            : "—"}
        </div>

        {peak && (
          <div
            style={{
              marginTop:
                3,

              fontSize:
                9,

              fontWeight:
                700,

              color:
                getStatusColor(
                  peak.status
                ),
            }}
          >
            {peak.status ===
            "FULL"
              ? "Complete data"
              : peak.status ===
                "PARTIAL"
              ? "Partial data"
              : "No data"}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   GRAPH LEGEND
========================================================= */

function GraphLegend() {
  return (
    <div
      style={{
        display:
          "flex",

        flexWrap:
          "wrap",

        alignItems:
          "center",

        gap:
          14,

        marginBottom:
          10,

        color:
          "#64748B",

        fontSize:
          10,

        fontWeight:
          700,
      }}
    >
      <LegendItem
        color={
          FULL_COLOR
        }

        label="Complete"
      />

      <LegendItem
        color={
          PARTIAL_COLOR
        }

        label="Partial"
      />

      <LegendItem
        color={
          EMPTY_COLOR
        }

        label="No Data"
      />
    </div>
  );
}

function LegendItem({
  color,
  label,
}: {
  color:
    string;

  label:
    string;
}) {
  return (
    <div
      style={{
        display:
          "flex",

        alignItems:
          "center",

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
            3,

          background:
            color,
        }}
      />

      {label}
    </div>
  );
}

/* =========================================================
   GRAPH TOOLTIP
========================================================= */

function PeakTooltip({
  active,
  payload,
  label,
  tooltipLabel,
}: {
  active?:
    boolean;

  payload?:
    ReadonlyArray<{
      payload:
        GraphRow;
    }>;

  label?:
    string;

  tooltipLabel:
    string;
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
          155,

        background:
          "#FFFFFF",

        border:
          "1px solid #E2E8F0",

        borderRadius:
          11,

        padding:
          "9px 11px",

        boxShadow:
          "0 8px 20px rgba(15,23,42,.13)",
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

      {row.status ===
      "EMPTY" ? (
        <div
          style={{
            marginTop:
              5,

            fontSize:
              11,

            fontWeight:
              700,

            color:
              "#64748B",
          }}
        >
          No data entered
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop:
                5,

              fontSize:
                14,

              fontWeight:
                800,

              color:
                "#1D4ED8",
            }}
          >
            {row.value.toFixed(
              2
            )}{" "}
            MW
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                10,

              fontWeight:
                700,

              color:
                getStatusColor(
                  row.status
                ),
            }}
          >
            {row.status ===
            "FULL"
              ? "Complete data"
              : "Partial data"}
          </div>

          <div
            style={{
              marginTop:
                2,

              fontSize:
                9,

              color:
                "#64748B",
            }}
          >
            {row.enteredSlots} of{" "}
            {row.expectedSlots} hourly feeder slots entered
          </div>

          <div
            style={{
              marginTop:
                2,

              fontSize:
                9,

              color:
                "#94A3B8",
            }}
          >
            {tooltipLabel}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   GRAPH
========================================================= */

function DemandChart({
  data,
  loading,
  error,
  tooltipLabel,
}: {
  data:
    GraphRow[];

  loading:
    boolean;

  error:
    string | null;

  tooltipLabel:
    string;
}) {
  if (
    loading
  ) {
    return (
      <div
        style={{
          height:
            260,

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "center",

          color:
            "#64748B",

          fontSize:
            12,

          fontWeight:
            600,
        }}
      >
        Loading graph data...
      </div>
    );
  }

  if (
    error
  ) {
    return (
      <div
        style={{
          height:
            260,

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "center",

          padding:
            20,

          textAlign:
            "center",

          color:
            "#B91C1C",

          fontSize:
            12,

          fontWeight:
            600,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        height:
          260,

        width:
          "100%",
      }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <BarChart
          data={
            data
          }

          margin={{
            top:
              10,

            right:
              5,

            left:
              -10,

            bottom:
              0,
          }}
        >
          <CartesianGrid
            strokeDasharray="3 3"

            vertical={
              false
            }
          />

          <XAxis
            dataKey="day"

            tick={{
              fontSize:
                10,
            }}

            interval="preserveStartEnd"
          />

          <YAxis
            tick={{
              fontSize:
                10,
            }}

            width={
              48
            }
          />

          <Tooltip
            content={(
              props
            ) => (
              <PeakTooltip
                active={
                  props.active
                }

                payload={
                  props.payload as
                    | ReadonlyArray<{
                        payload:
                          GraphRow;
                      }>
                    | undefined
                }

                label={
                  String(
                    props.label ??
                      ""
                  )
                }

                tooltipLabel={
                  tooltipLabel
                }
              />
            )}
          />

          <Bar
            dataKey="value"

            radius={[
              8,
              8,
              0,
              0,
            ]}
          >
            {data.map(
              (
                row
              ) => (
                <Cell
                  key={
                    row.date
                  }

                  fill={
                    getStatusColor(
                      row.status
                    )
                  }
                />
              )
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
      ? minDate(
          addYears(
            startDate,
            1
          ),
          today
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
          "rgba(15,23,42,.48)",

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

          boxShadow:
            "0 20px 50px rgba(15,23,42,.28)",

          overflow:
            "hidden",
        }}
      >
        {/* HEADER */}

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

        {/* BODY */}

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

              lineHeight:
                1.4,

              color:
                "#64748B",
            }}
          >
            Start and end dates may span a maximum of one year. Future dates cannot be selected.
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
   COMMON STYLES
========================================================= */

const largeSelectStyle:
  React.CSSProperties = {
    flex:
      "1 1 320px",

    minWidth:
      220,

    padding:
      "9px 12px",

    borderRadius:
      8,

    border:
      "1px solid #D1D5DB",

    background:
      "#fff",

    fontSize:
      14,
  };

const mediumSelectStyle:
  React.CSSProperties = {
    flex:
      "1 1 260px",

    minWidth:
      180,

    padding:
      "9px 12px",

    borderRadius:
      8,

    border:
      "1px solid #D1D5DB",

    background:
      "#fff",

    fontSize:
      14,
  };

const feederSelectStyle:
  React.CSSProperties = {
    flex:
      "1 1 220px",

    minWidth:
      170,

    padding:
      "9px 12px",

    borderRadius:
      8,

    border:
      "1px solid #D1D5DB",

    background:
      "#fff",

    fontSize:
      14,
  };

const modalLabelStyle:
  React.CSSProperties = {
    display:
      "block",

    marginBottom:
      6,

    fontSize:
      11,

    fontWeight:
      700,

    color:
      "#475569",
  };

const modalInputStyle:
  React.CSSProperties = {
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
