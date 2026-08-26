import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  CalendarDays,
  Save,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Info,
  X,
  Clock3,
} from "lucide-react";

import { api } from "@/services/api";
import { supabase } from "@/services/supabase";
import { useApp } from "@/context/AppContext";

/* =========================================================
   PARAMETERS
========================================================= */

const PARAMETERS: {
  key: string;
  label: string;
  unit: string;
  type: "number" | "text";
}[] = [
  {
    key: "mw",
    label: "MW (Load)",
    unit: "MW",
    type: "number",
  },
  {
    key: "mvar",
    label: "MVAr (Reactive)",
    unit: "MVAr",
    type: "number",
  },
  {
    key: "voltage",
    label: "Voltage",
    unit: "kV",
    type: "number",
  },
  {
    key: "current",
    label: "Current",
    unit: "A",
    type: "number",
  },
  {
    key: "powerFactor",
    label: "Power Factor",
    unit: "",
    type: "number",
  },
  {
    key: "frequency",
    label: "Frequency",
    unit: "Hz",
    type: "number",
  },
  {
    key: "temperature",
    label: "Transformer Temp",
    unit: "°C",
    type: "number",
  },
  {
    key: "oilLevel",
    label: "Oil Level",
    unit: "%",
    type: "number",
  },
  {
    key: "tapPosition",
    label: "Tap Position",
    unit: "",
    type: "number",
  },
  {
    key: "weather",
    label: "Weather",
    unit: "",
    type: "text",
  },
  {
    key: "remarks",
    label: "Remarks",
    unit: "",
    type: "text",
  },
];

/* =========================================================
   TYPES
========================================================= */

type FillStatus =
  | "EMPTY"
  | "PARTIAL"
  | "FULL";

type HourStatus = {
  hour: number;
  entered: number;
  total: number;
  status: FillStatus;
};

type DayStatus = {
  date: string;
  enteredSlots: number;
  expectedSlots: number;
  status: FillStatus;
};

type ExistingLogEntry = {
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

  created_at?: string;
  updated_at?: string;
};

/* =========================================================
   HOURS
========================================================= */

const HOURS = Array.from(
  { length: 24 },
  (_, index) => index
);

/* =========================================================
   HELPERS
========================================================= */

function pad2(
  value: number
): string {
  return String(value).padStart(
    2,
    "0"
  );
}

function hourValue(
  hour: number
): string {
  return `${pad2(hour)}:00`;
}

function toLocalDateString(
  date: Date
): string {
  return [
    date.getFullYear(),
    pad2(
      date.getMonth() + 1
    ),
    pad2(
      date.getDate()
    ),
  ].join("-");
}

function createActualEventTime(
  date: string,
  hour: number
): string {
  /*
   * Example:
   *
   * selected:
   * 2026-08-22
   * 08:00
   *
   * Device interprets as local time
   * and converts it to UTC ISO for
   * timestamptz storage.
   */

  return new Date(
    `${date}T${pad2(
      hour
    )}:00:00`
  ).toISOString();
}

function monthTitle(
  year: number,
  month: number
): string {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      month: "long",
      year: "numeric",
    }
  ).format(
    new Date(
      year,
      month,
      1
    )
  );
}

function getDaysInMonth(
  year: number,
  month: number
): number {
  return new Date(
    year,
    month + 1,
    0
  ).getDate();
}

/*
 * JavaScript:
 *
 * Sunday = 0
 * Monday = 1
 *
 * Calendar used here:
 *
 * Monday = 0
 * ...
 * Sunday = 6
 */

function getMondayFirstIndex(
  year: number,
  month: number
): number {
  const jsDay =
    new Date(
      year,
      month,
      1
    ).getDay();

  return (
    jsDay + 6
  ) % 7;
}

function nullableNumber(
  value:
    | string
    | undefined
): number | null {
  if (
    value === undefined ||
    value.trim() === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function emptyValues():
  Record<
    string,
    string
  > {
  return {
    mw: "",
    mvar: "",
    voltage: "",
    current: "",
    powerFactor: "",
    frequency: "",
    temperature: "",
    oilLevel: "",
    tapPosition: "",
    weather: "",
    remarks: "",
  };
}

/* =========================================================
   PAGE
========================================================= */

export function OperatorEntryPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const {
    activeStationId,
    activeStation,
    activeFeeders,
  } = useApp();

  /* =======================================================
     AUTHENTICATED OPERATOR
  ======================================================= */

  const [
    operatorId,
    setOperatorId,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     DATE / HOUR
  ======================================================= */

  const today =
    toLocalDateString(
      new Date()
    );

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(
    today
  );

  const [
    selectedHour,
    setSelectedHour,
  ] = useState(
    new Date().getHours()
  );

  /* =======================================================
     FEEDER
  ======================================================= */

  const [
    feederId,
    setFeederId,
  ] = useState("");

  /* =======================================================
     PARAMETER VALUES
  ======================================================= */

  const [
    values,
    setValues,
  ] = useState<
    Record<
      string,
      string
    >
  >(
    emptyValues()
  );

  /* =======================================================
     EXISTING ENTRY
  ======================================================= */

  const [
    existingEntryId,
    setExistingEntryId,
  ] = useState<
    string | null
  >(null);

  const [
    loadingEntry,
    setLoadingEntry,
  ] = useState(
    false
  );

  /* =======================================================
     SAVE STATE
  ======================================================= */

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    saved,
    setSaved,
  ] = useState(
    false
  );

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     MONTH CALENDAR
  ======================================================= */

  const [
    calendarOpen,
    setCalendarOpen,
  ] = useState(
    false
  );

  const [
    calendarLoading,
    setCalendarLoading,
  ] = useState(
    false
  );

  const [
    calendarYear,
    setCalendarYear,
  ] = useState(
    new Date().getFullYear()
  );

  const [
    calendarMonth,
    setCalendarMonth,
  ] = useState(
    new Date().getMonth()
  );

  const [
    monthStatuses,
    setMonthStatuses,
  ] = useState<
    Record<
      string,
      DayStatus
    >
  >({});

  /* =======================================================
     24-HOUR MODAL
  ======================================================= */

  const [
    hourModalOpen,
    setHourModalOpen,
  ] = useState(
    false
  );

  const [
    hourStatuses,
    setHourStatuses,
  ] = useState<
    HourStatus[]
  >([]);

  const [
    statusDate,
    setStatusDate,
  ] = useState(
    selectedDate
  );

  /* =======================================================
     GET AUTHENTICATED USER
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadUser() {
      const {
        data: {
          user,
        },
        error:
          userError,
      } =
        await supabase.auth.getUser();

      if (
        cancelled
      ) {
        return;
      }

      if (
        userError
      ) {
        setError(
          userError.message
        );

        return;
      }

      setOperatorId(
        user?.id ??
        null
      );
    }

    void loadUser();

    return () => {
      cancelled =
        true;
    };
  }, []);

  /* =======================================================
     KEEP FEEDER SELECTION VALID
  ======================================================= */

  useEffect(() => {
    if (
      activeFeeders.length ===
      0
    ) {
      setFeederId(
        ""
      );

      return;
    }

    const feederStillExists =
      activeFeeders.some(
        (feeder) =>
          feeder.id ===
          feederId
      );

    if (
      !feederStillExists
    ) {
      setFeederId(
        activeFeeders[0].id
      );
    }
  }, [
    activeFeeders,
    feederId,
  ]);

  /* =======================================================
     PARAMETER VALUE SETTER
  ======================================================= */

  const set = (
    key: string,
    value: string
  ) => {
    setValues(
      (previous) => ({
        ...previous,
        [key]:
          value,
      })
    );

    setSaved(
      false
    );
  };

  /* =======================================================
     LOAD EXISTING FEEDER ENTRY

     One feeder + station + date/hour
  ======================================================= */

  const loadExistingEntry =
    useCallback(
      async () => {
        if (
          !activeStationId ||
          !feederId ||
          !selectedDate
        ) {
          setExistingEntryId(
            null
          );

          setValues(
            emptyValues()
          );

          return;
        }

        setLoadingEntry(
          true
        );

        setSaved(
          false
        );

        setError(
          null
        );

        try {
          const entry =
            (await api.getOperatorLogEntry(
              activeStationId,
              feederId,
              selectedDate,
              hourValue(
                selectedHour
              )
            )) as
              ExistingLogEntry
              | null;

          /* -----------------------------------------------
             No existing entry
          ------------------------------------------------ */

          if (!entry) {
            setExistingEntryId(
              null
            );

            setValues(
              emptyValues()
            );

            return;
          }

          /* -----------------------------------------------
             Existing entry found
          ------------------------------------------------ */

          setExistingEntryId(
            entry.id
          );

          setValues({
            mw:
              entry.mw !==
                null
                ? String(
                    entry.mw
                  )
                : "",

            mvar:
              entry.mvar !==
                null
                ? String(
                    entry.mvar
                  )
                : "",

            voltage:
              entry.voltage_kv !==
                null
                ? String(
                    entry.voltage_kv
                  )
                : "",

            current:
              entry.current_a !==
                null
                ? String(
                    entry.current_a
                  )
                : "",

            powerFactor:
              entry.power_factor !==
                null
                ? String(
                    entry.power_factor
                  )
                : "",

            frequency:
              entry.frequency_hz !==
                null
                ? String(
                    entry.frequency_hz
                  )
                : "",

            temperature:
              entry.transformer_temp_c !==
                null
                ? String(
                    entry.transformer_temp_c
                  )
                : "",

            oilLevel:
              entry.oil_level_percent !==
                null
                ? String(
                    entry.oil_level_percent
                  )
                : "",

            tapPosition:
              entry.tap_position !==
                null
                ? String(
                    entry.tap_position
                  )
                : "",

            weather:
              entry.weather ??
              "",

            remarks:
              entry.remarks ??
              "",
          });
        } catch (e) {
          console.error(
            "Failed to load existing log-book entry:",
            e
          );

          setExistingEntryId(
            null
          );

          setValues(
            emptyValues()
          );

          setError(
            e instanceof Error
              ? e.message
              : "Failed to load existing entry."
          );
        } finally {
          setLoadingEntry(
            false
          );
        }
      },
      [
        activeStationId,
        feederId,
        selectedDate,
        selectedHour,
      ]
    );

  useEffect(() => {
    void loadExistingEntry();
  }, [
    loadExistingEntry,
  ]);

  /* =======================================================
     LOAD MONTH STATUS
  ======================================================= */

  const loadMonthStatus =
    useCallback(
      async () => {
        if (
          !activeStationId
        ) {
          setMonthStatuses(
            {}
          );

          return;
        }

        setCalendarLoading(
          true
        );

        setError(
          null
        );

        try {
          const rows =
            (await api.getOperatorMonthEntryStatus(
              activeStationId,
              calendarYear,
              calendarMonth +
                1
            )) as DayStatus[];

          const statusMap:
            Record<
              string,
              DayStatus
            > = {};

          for (
            const row of
            rows
          ) {
            statusMap[
              row.date
            ] = row;
          }

          setMonthStatuses(
            statusMap
          );
        } catch (e) {
          console.error(
            "Failed to load monthly status:",
            e
          );

          setError(
            e instanceof Error
              ? e.message
              : "Failed to load monthly entry status."
          );
        } finally {
          setCalendarLoading(
            false
          );
        }
      },
      [
        activeStationId,
        calendarYear,
        calendarMonth,
      ]
    );

  useEffect(() => {
    if (
      calendarOpen
    ) {
      void loadMonthStatus();
    }
  }, [
    calendarOpen,
    loadMonthStatus,
  ]);

    /* =======================================================

  ======================================================= */

  const [
  allFeedersSavedMessage,
  setAllFeedersSavedMessage,
] = useState(false);


  /* =======================================================
     OPEN CALENDAR
  ======================================================= */

  function openCalendar() {
    const [
      year,
      month,
    ] =
      selectedDate
        .split("-")
        .map(Number);

    setCalendarYear(
      year
    );

    setCalendarMonth(
      month - 1
    );

    setCalendarOpen(
      true
    );
  }

  /* =======================================================
     LOAD HOURS FOR SELECTED DATE
  ======================================================= */

  async function openHourStatus(
    date: string
  ) {
    if (
      !activeStationId
    ) {
      return;
    }

    setCalendarLoading(
      true
    );

    setStatusDate(
      date
    );

    setError(
      null
    );

    try {
      const rows =
        (await api.getOperatorDayHourStatus(
          activeStationId,
          date
        )) as HourStatus[];

      const statusMap =
        new Map<
          number,
          HourStatus
        >();

      for (
        const row of rows
      ) {
        statusMap.set(
          row.hour,
          row
        );
      }

      /*
       * Always create all
       * 24 hours.
       */

const completed: HourStatus[] =
  HOURS.map(
    (hour) =>
      statusMap.get(hour) ?? {
        hour,
        entered: 0,
        total: activeFeeders.length,
        status: "EMPTY" as FillStatus,
      }
  );

      setHourStatuses(
        completed
      );

      setCalendarOpen(
        false
      );

      setHourModalOpen(
        true
      );
    } catch (e) {
      console.error(
        "Failed to load hourly status:",
        e
      );

      setError(
        e instanceof Error
          ? e.message
          : "Failed to load hourly entry status."
      );
    } finally {
      setCalendarLoading(
        false
      );
    }
  }

  /* =======================================================
     CHOOSE HOUR FROM STATUS MODAL
  ======================================================= */

  function chooseHour(
    hour: number
  ) {
    setSelectedDate(
      statusDate
    );

    setSelectedHour(
      hour
    );

    setHourModalOpen(
      false
    );

    setSaved(
      false
    );

    /*
     * loadExistingEntry()
     * runs automatically.
     */
  }

  /* =======================================================
     SAVE / UPDATE ENTRY
  ======================================================= */

async function save() {
  if (
    !activeStationId ||
    !feederId ||
    !operatorId
  ) {
    setError(
      "Station, feeder and authenticated operator are required."
    );

    return;
  }

  setSaving(true);
  setSaved(false);
  setError(null);

  try {
    const actualEventTime =
      createActualEventTime(
        selectedDate,
        selectedHour
      );

    const payload = {
      station_id:
        activeStationId,

      feeder_id:
        feederId,

      operator_id:
        operatorId,

      actual_event_time:
        actualEventTime,

      mw:
        nullableNumber(
          values.mw
        ),

      mvar:
        nullableNumber(
          values.mvar
        ),

      voltage_kv:
        nullableNumber(
          values.voltage
        ),

      current_a:
        nullableNumber(
          values.current
        ),

      power_factor:
        nullableNumber(
          values.powerFactor
        ),

      frequency_hz:
        nullableNumber(
          values.frequency
        ),

      transformer_temp_c:
        nullableNumber(
          values.temperature
        ),

      oil_level_percent:
        nullableNumber(
          values.oilLevel
        ),

      tap_position:
        nullableNumber(
          values.tapPosition
        ),

      weather:
        values.weather?.trim() ||
        null,

      remarks:
        values.remarks?.trim() ||
        null,
    };

    /* -----------------------------------------------
       UPDATE EXISTING ENTRY
    ------------------------------------------------ */

    if (existingEntryId) {
      await api.updateLogEntry(
        existingEntryId,
        payload
      );
    }

    /* -----------------------------------------------
       INSERT NEW ENTRY
    ------------------------------------------------ */

    else {
      const created =
        await api.addLogEntry(
          payload
        );

      if (
        created &&
        typeof created ===
          "object" &&
        "id" in created
      ) {
        setExistingEntryId(
          String(
            created.id
          )
        );
      }
    }

    setSaved(true);

    /* -----------------------------------------------
       FIND CURRENT FEEDER INDEX
    ------------------------------------------------ */

    const currentFeederIndex =
      activeFeeders.findIndex(
        (feeder) =>
          feeder.id ===
          feederId
      );

    const isLastFeeder =
      currentFeederIndex ===
      activeFeeders.length - 1;

    /* -----------------------------------------------
       IF NOT LAST FEEDER:
       MOVE TO NEXT FEEDER
    ------------------------------------------------ */

    if (
      currentFeederIndex >= 0 &&
      !isLastFeeder
    ) {
      const nextFeeder =
        activeFeeders[
          currentFeederIndex + 1
        ];

      setFeederId(
        nextFeeder.id
      );

      /*
       * Existing data for next feeder
       * will be loaded automatically by
       * loadExistingEntry().
       */
    }

    /* -----------------------------------------------
       LAST FEEDER:
       VERIFY WHETHER THE WHOLE SLOT IS FULL
    ------------------------------------------------ */

    else if (
      isLastFeeder
    ) {
      const hourRows =
        await api.getOperatorDayHourStatus(
          activeStationId,
          selectedDate
        );

const selectedHourStatus =
  hourRows.find(
    (row: {
      hour: number;
      entered: number;
      total: number;
      status: string;
    }) =>
      Number(row.hour) ===
      selectedHour
  );

      if (
        selectedHourStatus?.status ===
        "FULL"
      ) {
        setAllFeedersSavedMessage(
          true
        );
      }
    }

    window.setTimeout(
      () => {
        setSaved(false);
      },
      2000
    );
  } catch (e) {
    console.error(
      "Failed to save operator entry:",
      e
    );

    setError(
      e instanceof Error
        ? e.message
        : "Failed to save operator entry."
    );
  } finally {
    setSaving(false);
  }
}

  /* =======================================================
     MONTH CALENDAR CELLS
  ======================================================= */

  const calendarCells =
    useMemo(
      () => {
        const numberOfDays =
          getDaysInMonth(
            calendarYear,
            calendarMonth
          );

        const firstDayOffset =
          getMondayFirstIndex(
            calendarYear,
            calendarMonth
          );

        const result:
          Array<
            | {
                day: number;
                date: string;
              }
            | null
          > = [];

        for (
          let index = 0;
          index <
          firstDayOffset;
          index++
        ) {
          result.push(
            null
          );
        }

        for (
          let day = 1;
          day <=
          numberOfDays;
          day++
        ) {
          result.push({
            day,

            date:
              `${calendarYear}-` +
              `${pad2(
                calendarMonth +
                  1
              )}-` +
              `${pad2(
                day
              )}`,
          });
        }

        return result;
      },
      [
        calendarYear,
        calendarMonth,
      ]
    );

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div
      style={{
        minHeight:
          "100vh",

        background:
          "#EEF3F8",

        display:
          "flex",

        flexDirection:
          "column",
      }}
    >
      {/* =================================================
          HEADER
      ================================================== */}

      <div
        style={{
          background:
            "linear-gradient(135deg,#0D47A1,#1565C0)",

          color:
            "white",

          padding:
            16,

          paddingTop:
            22,

          paddingBottom:
            22,

          borderBottomLeftRadius:
            22,

          borderBottomRightRadius:
            22,

          boxShadow:
            "0 4px 12px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "space-between",
          }}
        >
          <button
            type="button"
            onClick={
              onBack
            }
            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft
              size={24}
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
            Operator Entry
          </h2>

          <CalendarDays
            size={24}
          />
        </div>

        {/* Station */}

        <div
          style={{
            marginTop:
              18,

            background:
              "rgba(255,255,255,.16)",

            border:
              "1px solid rgba(255,255,255,.20)",

            borderRadius:
              14,

            padding:
              "11px 14px",
          }}
        >
          <div
            style={{
              fontSize:
                10,

              textTransform:
                "uppercase",

              letterSpacing:
                ".08em",

              color:
                "#BFDBFE",

              fontWeight:
                700,
            }}
          >
            Operator Station
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                15,

              fontWeight:
                700,
            }}
          >
            {activeStation?.name ??
              "Station not assigned"}
          </div>
        </div>
      </div>

      {/* =================================================
          BODY
      ================================================== */}

      <div
        style={{
          flex:
            1,

          overflowY:
            "auto",

          padding:
            16,

          paddingBottom:
            100,
        }}
      >
        {/* ERROR */}

        {error && (
          <div
            style={{
              marginBottom:
                14,

              borderRadius:
                14,

              padding:
                14,

              background:
                "#FEF2F2",

              border:
                "1px solid #FECACA",

              color:
                "#B91C1C",

              display:
                "flex",

              alignItems:
                "flex-start",

              gap:
                10,
            }}
          >
            <Info
              size={
                20
              }

              style={{
                flexShrink:
                  0,

                marginTop:
                  1,
              }}
            />

            <div
              style={{
                flex:
                  1,

                fontSize:
                  13,

                lineHeight:
                  1.45,
              }}
            >
              {error}
            </div>

            <button
              type="button"
              onClick={() =>
                setError(
                  null
                )
              }
              style={{
                border:
                  "none",

                background:
                  "transparent",

                padding:
                  0,

                color:
                  "#B91C1C",

                cursor:
                  "pointer",
              }}
            >
              <X
                size={
                  17
                }
              />
            </button>
          </div>
        )}

        {/* =================================================
            ENTRY DETAILS CARD
        ================================================== */}

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

            border:
              "1px solid #E2E8F0",
          }}
        >
          <div
            style={{
              display:
                "flex",

              alignItems:
                "center",

              gap:
                12,

              marginBottom:
                18,
            }}
          >
            <div
              style={{
                width:
                  44,

                height:
                  44,

                borderRadius:
                  13,

                background:
                  "#DBEAFE",

                display:
                  "flex",

                alignItems:
                  "center",

                justifyContent:
                  "center",
              }}
            >
              <Gauge
                size={
                  23
                }
                color="#1565C0"
              />
            </div>

            <div>
              <h3
                style={{
                  margin:
                    0,

                  fontSize:
                    16,

                  fontWeight:
                    700,

                  color:
                    "#1E293B",
                }}
              >
                Substation Parameters
              </h3>

              <p
                style={{
                  margin:
                    "3px 0 0",

                  fontSize:
                    11,

                  color:
                    "#64748B",
                }}
              >
                Enter hourly operating values
              </p>
            </div>
          </div>

          {/* =================================================
              FEEDER
          ================================================== */}

          <label
            style={{
              display:
                "block",

              marginBottom:
                15,
            }}
          >
            <FieldLabel>
              Feeder
            </FieldLabel>

            <div
              style={{
                position:
                  "relative",
              }}
            >
              <select
                value={
                  feederId
                }

                onChange={(
                  event
                ) =>
                  setFeederId(
                    event
                      .target
                      .value
                  )
                }

                style={{
                  width:
                    "100%",

                  appearance:
                    "none",

                  border:
                    "1px solid #CBD5E1",

                  borderRadius:
                    12,

                  padding:
                    "12px 42px 12px 13px",

                  background:
                    "#F8FAFC",

                  color:
                    "#1E293B",

                  fontSize:
                    14,

                  fontWeight:
                    600,

                  outline:
                    "none",
                }}
              >
                {activeFeeders.length ===
                  0 && (
                  <option value="">
                    No feeder available
                  </option>
                )}

                {activeFeeders.map(
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

              <ChevronDown
                size={
                  18
                }

                color="#64748B"

                style={{
                  pointerEvents:
                    "none",

                  position:
                    "absolute",

                  right:
                    13,

                  top:
                    "50%",

                  transform:
                    "translateY(-50%)",
                }}
              />
            </div>
          </label>

          {/* =================================================
              DATE + HOUR + CALENDAR BUTTON
          ================================================== */}

          <FieldLabel>
            Reading Date / Hour
          </FieldLabel>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "minmax(0,1.25fr) minmax(0,.8fr) 46px",

              gap:
                8,

              alignItems:
                "center",
            }}
          >
            {/* DATE */}

            <input
              type="date"

              value={
                selectedDate
              }

              onChange={(
                event
              ) => {
                setSelectedDate(
                  event
                    .target
                    .value
                );

                setSaved(
                  false
                );
              }}

              style={{
                width:
                  "100%",

                minWidth:
                  0,

                boxSizing:
                  "border-box",

                border:
                  "1px solid #CBD5E1",

                borderRadius:
                  12,

                padding:
                  "11px 8px",

                background:
                  "#F8FAFC",

                color:
                  "#1E293B",

                fontSize:
                  12,

                fontWeight:
                  600,

                outline:
                  "none",
              }}
            />

            {/* HOUR */}

            <div
              style={{
                position:
                  "relative",
              }}
            >
              <select
                value={
                  selectedHour
                }

                onChange={(
                  event
                ) => {
                  setSelectedHour(
                    Number(
                      event
                        .target
                        .value
                    )
                  );

                  setSaved(
                    false
                  );
                }}

                style={{
                  width:
                    "100%",

                  appearance:
                    "none",

                  boxSizing:
                    "border-box",

                  border:
                    "1px solid #CBD5E1",

                  borderRadius:
                    12,

                  padding:
                    "11px 30px 11px 9px",

                  background:
                    "#F8FAFC",

                  color:
                    "#1E293B",

                  fontSize:
                    12,

                  fontWeight:
                    700,

                  outline:
                    "none",
                }}
              >
                {HOURS.map(
                  (
                    hour
                  ) => (
                    <option
                      key={
                        hour
                      }

                      value={
                        hour
                      }
                    >
                      {hourValue(
                        hour
                      )}
                    </option>
                  )
                )}
              </select>

              <ChevronDown
                size={
                  16
                }

                style={{
                  pointerEvents:
                    "none",

                  position:
                    "absolute",

                  right:
                    8,

                  top:
                    "50%",

                  transform:
                    "translateY(-50%)",

                  color:
                    "#64748B",
                }}
              />
            </div>

            {/* CALENDAR STATUS */}

            <button
              type="button"

              onClick={
                openCalendar
              }

              title="View entry completion calendar"

              aria-label="View entry completion calendar"

              style={{
                width:
                  46,

                height:
                  44,

                border:
                  "none",

                borderRadius:
                  12,

                background:
                  "linear-gradient(135deg,#0D47A1,#1565C0)",

                color:
                  "#ffffff",

                display:
                  "grid",

                placeItems:
                  "center",

                cursor:
                  "pointer",

                boxShadow:
                  "0 3px 8px rgba(21,101,192,.25)",
              }}
            >
              <CalendarDays
                size={
                  21
                }
              />
            </button>
          </div>

          {/* =================================================
              SLOT INFORMATION
          ================================================== */}

          <div
            style={{
              marginTop:
                10,

              borderRadius:
                10,

              padding:
                "8px 10px",

              background:
                existingEntryId
                  ? "#EFF6FF"
                  : "#F8FAFC",

              color:
                existingEntryId
                  ? "#1D4ED8"
                  : "#64748B",

              fontSize:
                11,

              fontWeight:
                600,

              display:
                "flex",

              alignItems:
                "center",

              gap:
                7,
            }}
          >
            <Clock3
              size={
                15
              }
            />

            {loadingEntry
              ? "Checking previously entered data..."
              : existingEntryId
              ? `Existing feeder data loaded for ${selectedDate} at ${hourValue(
                  selectedHour
                )}. You can edit and save it.`
              : `No previous entry for this feeder at ${selectedDate} ${hourValue(
                  selectedHour
                )}.`}
          </div>
        </div>

        {/* =================================================
            PARAMETERS CARD
        ================================================== */}

        <div
          style={{
            marginTop:
              16,

            background:
              "#ffffff",

            borderRadius:
              18,

            overflow:
              "hidden",

            boxShadow:
              "0 4px 12px rgba(0,0,0,.08)",

            border:
              "1px solid #E2E8F0",
          }}
        >
          <div
            style={{
              padding:
                "14px 16px",

              borderBottom:
                "1px solid #E2E8F0",

              background:
                "#F8FAFC",
            }}
          >
            <h3
              style={{
                margin:
                  0,

                fontSize:
                  15,

                fontWeight:
                  700,

                color:
                  "#1E293B",
              }}
            >
              Parameters
            </h3>

            <p
              style={{
                margin:
                  "3px 0 0",

                fontSize:
                  11,

                color:
                  "#64748B",
              }}
            >
              {loadingEntry
                ? "Loading readings..."
                : existingEntryId
                ? "Existing readings loaded — edit or complete missing values"
                : "Record operational readings"}
            </p>
          </div>

          {PARAMETERS.map(
            (
              parameter,
              index
            ) => (
              <div
                key={
                  parameter.key
                }

                style={{
                  display:
                    "flex",

                  alignItems:
                    "center",

                  gap:
                    12,

                  padding:
                    "12px 16px",

                  borderBottom:
                    index ===
                    PARAMETERS.length -
                      1
                      ? "none"
                      : "1px solid #F1F5F9",
                }}
              >
                <label
                  style={{
                    flex:
                      1,

                    minWidth:
                      0,

                    color:
                      "#475569",

                    fontSize:
                      13,

                    fontWeight:
                      600,
                  }}
                >
                  {
                    parameter.label
                  }
                </label>

                <div
                  style={{
                    width:
                      150,

                    display:
                      "flex",

                    alignItems:
                      "center",

                    gap:
                      8,
                  }}
                >
                  <input
                    type={
                      parameter.type
                    }

                    inputMode={
                      parameter.type ===
                      "number"
                        ? "decimal"
                        : "text"
                    }

                    disabled={
                      loadingEntry
                    }

                    value={
                      values[
                        parameter.key
                      ] ??
                      ""
                    }

                    onChange={(
                      event
                    ) =>
                      set(
                        parameter.key,
                        event
                          .target
                          .value
                      )
                    }

                    placeholder="—"

                    style={{
                      width:
                        "100%",

                      minWidth:
                        0,

                      boxSizing:
                        "border-box",

                      border:
                        "1px solid #CBD5E1",

                      borderRadius:
                        10,

                      padding:
                        "8px 10px",

                      textAlign:
                        parameter.type ===
                        "number"
                          ? "right"
                          : "left",

                      background:
                        loadingEntry
                          ? "#F1F5F9"
                          : "#F8FAFC",

                      color:
                        "#1E293B",

                      fontSize:
                        13,

                      fontWeight:
                        600,

                      outline:
                        "none",
                    }}
                  />

                  {parameter.unit && (
                    <span
                      style={{
                        width:
                          42,

                        flexShrink:
                          0,

                        color:
                          "#94A3B8",

                        fontSize:
                          10,

                        fontWeight:
                          600,
                      }}
                    >
                      {
                        parameter.unit
                      }
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* =================================================
            SAVE BUTTON
        ================================================== */}

        <button
          type="button"

          onClick={() =>
            void save()
          }

          disabled={
            saving ||
            loadingEntry ||
            !feederId ||
            !operatorId
          }

          style={{
            width:
              "100%",

            marginTop:
              18,

            border:
              "none",

            borderRadius:
              13,

            padding:
              "14px 16px",

            background:
              saved
                ? "#059669"
                : saving ||
                  loadingEntry ||
                  !feederId ||
                  !operatorId
                ? "#94A3B8"
                : "linear-gradient(135deg,#0D47A1,#1565C0)",

            color:
              "#ffffff",

            fontSize:
              14,

            fontWeight:
              700,

            boxShadow:
              saving ||
              loadingEntry ||
              !feederId
                ? "none"
                : "0 4px 12px rgba(21,101,192,.25)",

            cursor:
              saving ||
              loadingEntry ||
              !feederId
                ? "default"
                : "pointer",

            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "center",

            gap:
              8,
          }}
        >
{saving ? (
  <>
    <Save size={18} />
    Saving…
  </>
) : saved ? (
  <>
    <CheckCircle2 size={18} />
    Saved
  </>
) : (
  <>
    <Save size={18} />
    Save and Next &gt;&gt;
  </>
)}
        </button>

        {saved && (
          <div
            style={{
              marginTop:
                12,

              borderRadius:
                14,

              padding:
                13,

              background:
                "#ECFDF5",

              border:
                "1px solid #A7F3D0",

              color:
                "#047857",

              display:
                "flex",

              alignItems:
                "center",

              justifyContent:
                "center",

              gap:
                8,

              fontSize:
                12,

              fontWeight:
                600,
            }}
          >
            <CheckCircle2
              size={
                17
              }
            />

            Hourly log-book data saved successfully.
          </div>
        )}
      </div>

      {/* =================================================
          FINAL POPUP MESSAGE
      ================================================== */}

      {allFeedersSavedMessage && (
  <ModalOverlay>
    <div
      style={{
        width: "min(90vw,360px)",
        borderRadius: 20,
        background: "#ffffff",
        padding: 24,
        boxShadow:
          "0 20px 60px rgba(15,23,42,.30)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          margin: "0 auto 14px",
          borderRadius: "50%",
          background: "#D1FAE5",
          display: "grid",
          placeItems: "center",
        }}
      >
        <CheckCircle2
          size={30}
          color="#059669"
        />
      </div>

      <h3
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 800,
          color: "#1E293B",
        }}
      >
        Hourly Entry Complete
      </h3>

      <p
        style={{
          margin: "10px 0 0",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#64748B",
        }}
      >
        Data for all feeders has been entered for
        {" "}
        <strong>
          {selectedDate}
        </strong>
        {" at "}
        <strong>
          {hourValue(
            selectedHour
          )}
        </strong>
        .
      </p>

      <button
        type="button"
        onClick={() =>
          setAllFeedersSavedMessage(
            false
          )
        }
        style={{
          marginTop: 20,
          width: "100%",
          border: "none",
          borderRadius: 12,
          padding: "12px 16px",
          background:
            "linear-gradient(135deg,#0D47A1,#1565C0)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        OK
      </button>
    </div>
  </ModalOverlay>
)}



      {/* =================================================
          MONTH CALENDAR MODAL
      ================================================== */}




      {calendarOpen && (
        <ModalOverlay>
          <div
            style={{
              width:
                "min(94vw,440px)",

              maxHeight:
                "90vh",

              overflowY:
                "auto",

              borderRadius:
                22,

              background:
                "#ffffff",

              boxShadow:
                "0 20px 60px rgba(15,23,42,.28)",
            }}
          >
            {/* Header */}

            <div
              style={{
                background:
                  "linear-gradient(135deg,#0D47A1,#1565C0)",

                color:
                  "#ffffff",

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
              <div>
                <div
                  style={{
                    fontSize:
                      17,

                    fontWeight:
                      800,
                  }}
                >
                  Entry Calendar
                </div>

                <div
                  style={{
                    marginTop:
                      2,

                    fontSize:
                      11,

                    opacity:
                      0.8,
                  }}
                >
                  Select a date to view hourly completion
                </div>
              </div>

              <button
                type="button"

                onClick={() =>
                  setCalendarOpen(
                    false
                  )
                }

                style={
                  modalIconButton
                }
              >
                <X
                  size={
                    21
                  }
                />
              </button>
            </div>

            {/* Month Navigation */}

            <div
              style={{
                margin:
                  "14px 14px 0",

                padding:
                  "10px 12px",

                borderRadius:
                  14,

                background:
                  "#14B8A6",

                color:
                  "#ffffff",

                display:
                  "flex",

                alignItems:
                  "center",

                justifyContent:
                  "space-between",
              }}
            >
              <button
                type="button"

                onClick={() => {
                  if (
                    calendarMonth ===
                    0
                  ) {
                    setCalendarMonth(
                      11
                    );

                    setCalendarYear(
                      (
                        year
                      ) =>
                        year -
                        1
                    );
                  } else {
                    setCalendarMonth(
                      (
                        month
                      ) =>
                        month -
                        1
                    );
                  }
                }}

                style={
                  monthButton
                }
              >
                <ChevronLeft
                  size={
                    21
                  }
                />
              </button>

              <strong
                style={{
                  fontSize:
                    17,
                }}
              >
                {monthTitle(
                  calendarYear,
                  calendarMonth
                )}
              </strong>

              <button
                type="button"

                onClick={() => {
                  if (
                    calendarMonth ===
                    11
                  ) {
                    setCalendarMonth(
                      0
                    );

                    setCalendarYear(
                      (
                        year
                      ) =>
                        year +
                        1
                    );
                  } else {
                    setCalendarMonth(
                      (
                        month
                      ) =>
                        month +
                        1
                    );
                  }
                }}

                style={
                  monthButton
                }
              >
                <ChevronRight
                  size={
                    21
                  }
                />
              </button>
            </div>

            {/* Calendar */}

            <div
              style={{
                padding:
                  14,
              }}
            >
              <div
                style={{
                  border:
                    "1px solid #E2E8F0",

                  borderRadius:
                    18,

                  padding:
                    12,

                  background:
                    "#F8FAFC",
                }}
              >
                {/* Weekdays */}

                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      "repeat(7,1fr)",

                    gap:
                      5,

                    marginBottom:
                      8,
                  }}
                >
                  {[
                    "M",
                    "T",
                    "W",
                    "T",
                    "F",
                    "S",
                    "S",
                  ].map(
                    (
                      label,
                      index
                    ) => (
                      <div
                        key={`${label}-${index}`}

                        style={{
                          textAlign:
                            "center",

                          fontSize:
                            12,

                          fontWeight:
                            800,

                          color:
                            "#334155",
                        }}
                      >
                        {
                          label
                        }
                      </div>
                    )
                  )}
                </div>

                {/* Dates */}

                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      "repeat(7,1fr)",

                    gap:
                      5,
                  }}
                >
                  {calendarCells.map(
                    (
                      cell,
                      index
                    ) => {
                      if (
                        !cell
                      ) {
                        return (
                          <div
                            key={`blank-${index}`}

                            style={{
                              aspectRatio:
                                "1 / 1",
                            }}
                          />
                        );
                      }

                      const status =
                        monthStatuses[
                          cell
                            .date
                        ]
                          ?.status ??
                        "EMPTY";

                      const isToday =
                        cell.date ===
                        today;

                      return (
                        <button
                          key={
                            cell.date
                          }

                          type="button"

                          disabled={
                            calendarLoading
                          }

                          onClick={() =>
                            void openHourStatus(
                              cell.date
                            )
                          }

                          style={{
                            aspectRatio:
                              "1 / 1",

                            minWidth:
                              0,

                            cursor:
                              "pointer",

                            borderRadius:
                              "50%",

                            border:
                              isToday
                                ? "3px solid #94A3B8"
                                : "2px solid transparent",

                            background:
                              status ===
                              "FULL"
                                ? "#22C55E"
                                : status ===
                                  "PARTIAL"
                                ? "#FACC15"
                                : "#ffffff",

                            color:
                              "#0F172A",

                            fontWeight:
                              isToday
                                ? 800
                                : 700,

                            fontSize:
                              13,

                            boxShadow:
                              status ===
                              "EMPTY"
                                ? "none"
                                : "0 2px 5px rgba(0,0,0,.10)",
                          }}
                        >
                          {
                            cell.day
                          }
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {calendarLoading && (
                <div
                  style={{
                    padding:
                      12,

                    textAlign:
                      "center",

                    fontSize:
                      12,

                    color:
                      "#64748B",
                  }}
                >
                  Loading entry status…
                </div>
              )}

              {/* Legend */}

              <div
                style={{
                  marginTop:
                    14,

                  display:
                    "flex",

                  flexWrap:
                    "wrap",

                  gap:
                    12,

                  justifyContent:
                    "center",
                }}
              >
                <Legend
                  color="#FACC15"
                  label="Partially Filled"
                />

                <Legend
                  color="#22C55E"
                  label="All Filled"
                />

                <Legend
                  color="#94A3B8"
                  label="Today"
                  outline
                />
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* =================================================
          24-HOUR STATUS MODAL
      ================================================== */}

      {hourModalOpen && (
        <ModalOverlay>
          <div
            style={{
              width:
                "min(94vw,440px)",

              maxHeight:
                "90vh",

              overflowY:
                "auto",

              borderRadius:
                22,

              background:
                "#ffffff",

              boxShadow:
                "0 20px 60px rgba(15,23,42,.28)",
            }}
          >
            {/* Header */}

            <div
              style={{
                background:
                  "#14B8A6",

                color:
                  "#ffffff",

                padding:
                  "16px 18px",
              }}
            >
              <div
                style={{
                  display:
                    "flex",

                  alignItems:
                    "center",

                  justifyContent:
                    "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize:
                        18,

                      fontWeight:
                        800,
                    }}
                  >
                    Please select time
                  </div>

                  <div
                    style={{
                      marginTop:
                        3,

                      fontSize:
                        11,

                      opacity:
                        0.9,
                    }}
                  >
                    {
                      statusDate
                    }
                  </div>
                </div>

                <button
                  type="button"

                  onClick={() =>
                    setHourModalOpen(
                      false
                    )
                  }

                  style={
                    modalIconButton
                  }
                >
                  <X
                    size={
                      21
                    }
                  />
                </button>
              </div>

              {/* Hour Legend */}

              <div
                style={{
                  marginTop:
                    13,

                  display:
                    "flex",

                  flexWrap:
                    "wrap",

                  gap:
                    12,
                }}
              >
                <Legend
                  color="#22C55E"
                  label="Fully filled"
                  light
                />

                <Legend
                  color="#1D4ED8"
                  label="Partially filled"
                  light
                />

                <Legend
                  color="#111827"
                  label="Empty"
                  light
                />
              </div>
            </div>

            {/* HOURS */}

            <div
              style={{
                padding:
                  "20px 14px 24px",

                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(3,minmax(0,1fr))",

                gap:
                  "12px 8px",
              }}
            >
              {HOURS.map(
                (
                  hour
                ) => {
                  const slot =
                    hourStatuses.find(
                      (
                        item
                      ) =>
                        item.hour ===
                        hour
                    );

                  const status =
                    slot?.status ??
                    "EMPTY";

                  const color =
                    status ===
                    "FULL"
                      ? "#22C55E"
                      : status ===
                        "PARTIAL"
                      ? "#1D4ED8"
                      : "#111827";

                  return (
                    <button
                      key={
                        hour
                      }

                      type="button"

                      onClick={() =>
                        chooseHour(
                          hour
                        )
                      }

                      style={{
                        border:
                          "1px solid #E2E8F0",

                        borderRadius:
                          12,

                        padding:
                          "12px 4px",

                        background:
                          "#ffffff",

                        color,

                        cursor:
                          "pointer",

                        fontSize:
                          13,

                        fontWeight:
                          800,

                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      {hourValue(
                        hour
                      )}{" "}
                      HRS
                    </button>
                  );
                }
              )}
            </div>

            <div
              style={{
                padding:
                  "0 16px 18px",

                textAlign:
                  "center",

                color:
                  "#64748B",

                fontSize:
                  11,
              }}
            >
              Tap an hour to select that date/hour and load existing feeder readings.
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/* =========================================================
   FIELD LABEL
========================================================= */

function FieldLabel({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <span
      style={{
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

        textTransform:
          "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/* =========================================================
   MODAL OVERLAY
========================================================= */

function ModalOverlay({
  children,
}: {
  children:
    React.ReactNode;
}) {
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
          "rgba(15,23,42,.55)",

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "center",

        padding:
          14,

        backdropFilter:
          "blur(2px)",
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   LEGEND
========================================================= */

function Legend({
  color,
  label,
  outline = false,
  light = false,
}: {
  color:
    string;

  label:
    string;

  outline?:
    boolean;

  light?:
    boolean;
}) {
  return (
    <div
      style={{
        display:
          "flex",

        alignItems:
          "center",

        gap:
          6,

        color:
          light
            ? "#ffffff"
            : "#334155",

        fontSize:
          11,

        fontWeight:
          700,
      }}
    >
      <span
        style={{
          width:
            13,

          height:
            13,

          borderRadius:
            4,

          background:
            outline
              ? "#ffffff"
              : color,

          border:
            outline
              ? `3px solid ${color}`
              : "none",

          boxSizing:
            "border-box",
        }}
      />

      {label}
    </div>
  );
}

/* =========================================================
   COMMON MODAL BUTTON STYLES
========================================================= */

const modalIconButton:
  React.CSSProperties = {
    width:
      36,

    height:
      36,

    border:
      "none",

    borderRadius:
      "50%",

    background:
      "rgba(255,255,255,.16)",

    color:
      "#ffffff",

    display:
      "grid",

    placeItems:
      "center",

    cursor:
      "pointer",
  };

const monthButton:
  React.CSSProperties = {
    width:
      34,

    height:
      34,

    border:
      "none",

    borderRadius:
      "50%",

    background:
      "rgba(255,255,255,.16)",

    color:
      "#ffffff",

    display:
      "grid",

    placeItems:
      "center",

    cursor:
      "pointer",
  };
