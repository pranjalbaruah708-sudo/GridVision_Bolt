import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  Cloud,
  CloudOff,
  UploadCloud,
  AlertCircle,
} from "lucide-react";

import { api } from "@/services/api";
import { supabase } from "@/services/supabase";
import { useApp } from "@/context/AppContext";
import {
  getQueuedLogBookOp,
  isOnline as hasNetworkConnection,
  OFFLINE_QUEUE_CHANGED_EVENT,
  type QueuedOp,
} from "@/services/offline";
import {
  beginParameterDraftSession,
  deleteParameterEntryDraft,
  readParameterEntryDraft,
  writeParameterEntryDraft,
} from "@/services/operationalDrafts";
import { formatCacheAge, readOperationalSnapshot, writeOperationalSnapshot } from '@/services/operationalReadCache';
import { APP_BACKGROUND_EVENT } from '@/services/platform/runtime';

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

function valuesFromEntry(entry: Record<string, unknown>): Record<string, string> {
  const display = (value: unknown) => value === null || value === undefined ? "" : String(value);
  return {
    mw: display(entry.mw),
    mvar: display(entry.mvar),
    voltage: display(entry.voltage_kv),
    current: display(entry.current_a),
    powerFactor: display(entry.power_factor),
    frequency: display(entry.frequency_hz),
    temperature: display(entry.transformer_temp_c),
    oilLevel: display(entry.oil_level_percent),
    tapPosition: display(entry.tap_position),
    weather: display(entry.weather),
    remarks: display(entry.remarks),
  };
}

/* =========================================================
   PAGE
========================================================= */

export function OperatorEntryPage({
  onBack,
  initialReviewOperation,
  onReviewConsumed,
}: {
  onBack: () => void;
  initialReviewOperation?: import('@/services/offline').QueuedOp | null;
  onReviewConsumed?: () => void;
}) {
  const {
    activeStationId,
    activeStation,
    activeFeeders,
    online,
    pending,
    error: stationScopeError,
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
  const [completionSnapshotCachedAt, setCompletionSnapshotCachedAt] = useState<string | null>(null);
  const [entrySnapshotCachedAt, setEntrySnapshotCachedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!initialReviewOperation) return;
    const body = initialReviewOperation.body && typeof initialReviewOperation.body === 'object' && !Array.isArray(initialReviewOperation.body)
      ? initialReviewOperation.body as Record<string, unknown> : {};
    const reviewedFeederId = typeof body.feeder_id === 'string' ? body.feeder_id : null;
    const reviewedTime = typeof body.actual_event_time === 'string' ? body.actual_event_time : initialReviewOperation.eventTime;
    const parsed = reviewedTime ? new Date(reviewedTime) : null;
    if (reviewedFeederId) setFeederId(reviewedFeederId);
    if (parsed && !Number.isNaN(parsed.getTime())) {
      setSelectedDate(toLocalDateString(parsed));
      setSelectedHour(parsed.getHours());
    }
    onReviewConsumed?.();
  }, [initialReviewOperation, onReviewConsumed]);

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

  const [lastSaveStatus, setLastSaveStatus] = useState<"SYNCED" | "PENDING" | "SAVE_FAILED" | null>(null);
  const [queuedEntry, setQueuedEntry] = useState<QueuedOp | null>(null);
  const [loadedSlotKey, setLoadedSlotKey] = useState<string | null>(null);
  const [queueRevision, setQueueRevision] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"SAVING" | "SAVED" | "RESTORED" | "FAILED" | null>(null);
  const valuesRef = useRef(values);
  const dirtyRef = useRef(false);
  const draftContextRef = useRef<{ userId: string; stationId: string; feederId: string; actualEventTime: string } | null>(null);
  const draftWriteEpochRef = useRef<number | null>(null);
  const requestedSlotRef = useRef<string | null>(null);

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
      const offlineSession = !hasNetworkConnection()
        ? await supabase.auth.getSession()
        : null;
      const onlineUser = offlineSession
        ? null
        : await supabase.auth.getUser();
      const user = offlineSession?.data.session?.user ?? onlineUser?.data.user ?? null;
      const userError = offlineSession?.error ?? onlineUser?.error ?? null;

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

  useEffect(() => {
    const refreshQueuedEntry = () => setQueueRevision((revision) => revision + 1);
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshQueuedEntry);
    return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshQueuedEntry);
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
      (previous) => {
        const next = {
        ...previous,
        [key]:
          value,
        };
        valuesRef.current = next;
        return next;
      }
    );

    dirtyRef.current = true;
    setDraftDirty(true);
    setDraftStatus("SAVING");

    setSaved(
      false
    );
  };

  const draftContext = useMemo(() => operatorId && activeStationId && feederId && selectedDate
    ? { userId: operatorId, stationId: activeStationId, feederId, actualEventTime: createActualEventTime(selectedDate, selectedHour) }
    : null, [operatorId, activeStationId, feederId, selectedDate, selectedHour]);
  const draftSlotKey = draftContext
    ? `${draftContext.userId}:${draftContext.stationId}:${draftContext.feederId}:${draftContext.actualEventTime}`
    : null;

  const applyLoadedValues = useCallback(async (
    context: NonNullable<typeof draftContext>,
    slotKey: string,
    baseValues: Record<string, string>
  ) => {
    const draft = await readParameterEntryDraft(context);
    if (requestedSlotRef.current !== slotKey) return;
    const next = draft?.values ?? baseValues;
    valuesRef.current = next;
    setValues(next);
    dirtyRef.current = Boolean(draft);
    setDraftDirty(Boolean(draft));
    setDraftStatus(draft ? "RESTORED" : null);
  }, []);

  useEffect(() => {
    const previousContext = draftContextRef.current;
    if (previousContext && dirtyRef.current) {
      const snapshot = { ...valuesRef.current };
      void writeParameterEntryDraft({ ...previousContext, values: snapshot }, draftWriteEpochRef.current ?? undefined).catch(() => undefined);
    }
    draftContextRef.current = draftContext;
    draftWriteEpochRef.current = draftContext ? beginParameterDraftSession(draftContext) : null;
    dirtyRef.current = false;
    setDraftDirty(false);
    setDraftStatus(null);
  }, [draftContext, draftSlotKey]);

  useEffect(() => {
    if (!draftDirty || !draftContext || !draftSlotKey || loadedSlotKey !== `${draftContext.stationId}:${draftContext.feederId}:${draftContext.actualEventTime}`) return;
    const snapshot = { ...values };
    setDraftStatus("SAVING");
    const timer = window.setTimeout(() => {
      if (!dirtyRef.current) return;
      const writeEpoch = draftWriteEpochRef.current ?? undefined;
      void writeParameterEntryDraft({ ...draftContext, values: snapshot }, writeEpoch)
        .then(() => {
          if (draftContextRef.current?.actualEventTime === draftContext.actualEventTime
            && draftContextRef.current.feederId === draftContext.feederId
            && dirtyRef.current) setDraftStatus("SAVED");
        })
        .catch(() => {
          if (draftContextRef.current?.actualEventTime === draftContext.actualEventTime
            && draftContextRef.current.feederId === draftContext.feederId) setDraftStatus("FAILED");
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftContext, draftDirty, draftSlotKey, loadedSlotKey, values]);

  useEffect(() => {
    const persistLatest = () => {
      const context = draftContextRef.current;
      if (context && dirtyRef.current) {
        void writeParameterEntryDraft({ ...context, values: { ...valuesRef.current } }, draftWriteEpochRef.current ?? undefined).catch(() => undefined);
      }
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") persistLatest(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", persistLatest);
    window.addEventListener(APP_BACKGROUND_EVENT, persistLatest);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", persistLatest);
      window.removeEventListener(APP_BACKGROUND_EVENT, persistLatest);
      persistLatest();
    };
  }, []);

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
          !selectedDate ||
          !draftContext
        ) {
          requestedSlotRef.current = null;
          setExistingEntryId(
            null
          );

          setValues(
            emptyValues()
          );
          valuesRef.current = emptyValues();
          dirtyRef.current = false;
          setDraftDirty(false);
          setDraftStatus(null);

          setQueuedEntry(null);
          setLoadedSlotKey(null);

          return;
        }

        const actualEventTime = createActualEventTime(selectedDate, selectedHour);
        const slotKey = `${activeStationId}:${feederId}:${actualEventTime}`;
        requestedSlotRef.current = slotKey;
        if (loadedSlotKey === slotKey && dirtyRef.current) return;
        const queued = operatorId
          ? (await getQueuedLogBookOp(activeStationId, feederId, actualEventTime, operatorId)) ?? null
          : null;
        if (requestedSlotRef.current !== slotKey) return;
        setQueuedEntry(queued);

        if (queued?.body && typeof queued.body === "object" && !Array.isArray(queued.body)) {
          setExistingEntryId(queued.method === "PATCH" ? queued.filter?.id ?? null : null);
          await applyLoadedValues(draftContext, slotKey, valuesFromEntry(queued.body as Record<string, unknown>));
          setLoadedSlotKey(slotKey);
          setLoadingEntry(false);
          return;
        }

        if (!hasNetworkConnection()) {
          const snapshot = operatorId ? readOperationalSnapshot<ExistingLogEntry | null>(operatorId, `operator-entry|${slotKey}`) : null;
          const entry = snapshot?.value ?? null;
          setEntrySnapshotCachedAt(snapshot?.cachedAt ?? null);
          setExistingEntryId(entry?.id ?? null);
          await applyLoadedValues(draftContext, slotKey, entry ? valuesFromEntry(entry as unknown as Record<string, unknown>) : emptyValues());
          setLoadedSlotKey(slotKey);
          setLoadingEntry(false);
          return;
        }

        setLoadingEntry(
          true
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
          if (requestedSlotRef.current !== slotKey) return;
          if (operatorId) {
            const snapshot = writeOperationalSnapshot(operatorId, `operator-entry|${slotKey}`, entry);
            setEntrySnapshotCachedAt(snapshot.cachedAt);
          }

          /* -----------------------------------------------
             No existing entry
          ------------------------------------------------ */

          if (!entry) {
            setExistingEntryId(
              null
            );

            await applyLoadedValues(draftContext, slotKey, emptyValues());

            setLoadedSlotKey(slotKey);

            return;
          }

          /* -----------------------------------------------
             Existing entry found
          ------------------------------------------------ */

          setExistingEntryId(
            entry.id
          );
          await applyLoadedValues(draftContext, slotKey, valuesFromEntry(entry as unknown as Record<string, unknown>));
          setLoadedSlotKey(slotKey);
        } catch (e) {
          if (requestedSlotRef.current !== slotKey) return;
          console.error("The selected log-book entry could not be loaded.");

          setExistingEntryId(
            null
          );

          if (!dirtyRef.current) await applyLoadedValues(draftContext, slotKey, emptyValues());

          setError(
            e instanceof Error
              ? e.message
              : "Failed to load existing entry."
          );
        } finally {
          if (requestedSlotRef.current === slotKey) setLoadingEntry(false);
        }
      },
      [
        activeStationId,
        feederId,
        selectedDate,
        selectedHour,
        loadedSlotKey,
        operatorId,
        draftContext,
        applyLoadedValues,
      ]
    );

  useEffect(() => {
    void loadExistingEntry();
  }, [
    loadExistingEntry,
    queueRevision,
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

        if (!hasNetworkConnection()) {
          const snapshot = operatorId ? readOperationalSnapshot<DayStatus[]>(operatorId, `operator-month-status|${activeStationId}|${calendarYear}-${calendarMonth + 1}`) : null;
          if (snapshot) {
            const cachedStatuses: Record<string, DayStatus> = {};
            snapshot.value.forEach((row) => { cachedStatuses[row.date] = row; });
            setMonthStatuses(cachedStatuses);
            setCompletionSnapshotCachedAt(snapshot.cachedAt);
          } else {
            setError('Completion status is not cached for this month. Connect once to load it.');
          }
          setCalendarLoading(false);
          return;
        }

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
          if (operatorId) {
            const snapshot = writeOperationalSnapshot(operatorId, `operator-month-status|${activeStationId}|${calendarYear}-${calendarMonth + 1}`, rows);
            setCompletionSnapshotCachedAt(snapshot.cachedAt);
          }
        } catch (e) {
          console.error("Monthly entry status could not be loaded.");

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
        operatorId,
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
  const [completionSavedOffline, setCompletionSavedOffline] = useState(false);


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

    const completionCacheKey = `operator-day-status|${activeStationId}|${date}`;
    if (!hasNetworkConnection()) {
      const snapshot = operatorId ? readOperationalSnapshot<HourStatus[]>(operatorId, completionCacheKey) : null;
      if (!snapshot) {
        setError('Completion status is not cached for this date. Connect once to load it.');
        setCalendarLoading(false);
        return;
      }
      setHourStatuses(snapshot.value);
      setCompletionSnapshotCachedAt(snapshot.cachedAt);
      setCalendarOpen(false);
      setHourModalOpen(true);
      setCalendarLoading(false);
      return;
    }

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
      if (operatorId) {
        const snapshot = writeOperationalSnapshot(operatorId, completionCacheKey, completed);
        setCompletionSnapshotCachedAt(snapshot.cachedAt);
      }

      setCalendarOpen(
        false
      );

      setHourModalOpen(
        true
      );
    } catch (e) {
      console.error("Hourly entry status could not be loaded.");

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

  useEffect(() => {
    if (!online) return;
    if (calendarOpen) void loadMonthStatus();
    if (hourModalOpen) void openHourStatus(statusDate);
    // Queue events are the refresh signal; these existing queries remain authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pending, queueRevision]);

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
  setLastSaveStatus(null);
  setError(null);

  try {
    const savingOffline = !hasNetworkConnection();
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

    dirtyRef.current = false;
    setDraftDirty(false);
    if (draftContext) {
      try {
        await deleteParameterEntryDraft(draftContext);
        setDraftStatus(null);
      } catch {
        setDraftStatus("FAILED");
      }
      draftWriteEpochRef.current = beginParameterDraftSession(draftContext);
    }

    setSaved(true);
    setLastSaveStatus(savingOffline ? "PENDING" : "SYNCED");

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
      if (savingOffline) {
        setCompletionSavedOffline(true);
        setAllFeedersSavedMessage(true);
      } else {
        setCompletionSavedOffline(false);
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
    }

    window.setTimeout(
      () => {
        setSaved(false);
      },
      2000
    );
  } catch (e) {
    console.error("The operator entry could not be saved.");

    setError(
      e instanceof Error
        ? e.message
        : "Failed to save operator entry."
    );
    setLastSaveStatus("SAVE_FAILED");
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

  const activeEntrySyncStatus = queuedEntry
    ? queuedEntry.syncState === "NEEDS_ATTENTION"
      ? "NEEDS_ATTENTION"
      : "PENDING"
    : existingEntryId
    ? "SYNCED"
    : null;

  return (
    <div
      className="gv-operator-entry-page"
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
        className="gv-operator-entry-header lg:!rounded-none lg:!border-b lg:!border-slate-200 lg:!bg-white lg:!text-slate-900 lg:!shadow-none"
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
          className="gv-entry-heading-row"
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
            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95 lg:hidden"
            aria-label="Back"
          >
            <ArrowLeft
              size={24}
            />
          </button>

          <div className="gv-entry-heading-copy">
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
            <span className="lg:hidden">Operator Entry</span><span className="hidden lg:inline">Parameter Entry</span>
          </h2>

          <p className="hidden lg:block lg:mt-1 lg:text-sm lg:font-medium lg:text-slate-600">Record hourly operational readings</p>
          <p className="hidden lg:block lg:mt-0.5 lg:text-xs lg:font-semibold lg:text-slate-500">{activeStation?.name ?? "Station not assigned"}</p>
          </div>

          <div className="hidden items-center gap-5 text-xs font-bold text-slate-700 lg:flex" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />{online ? 'Online' : 'Offline'}</span>
            <span className="inline-flex items-center gap-2">{pending > 0 ? <UploadCloud className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}{pending > 0 ? `${pending} pending` : 'All changes synced'}</span>
          </div>

          <CalendarDays
            className="lg:hidden"
            size={24}
          />
        </div>

        {/* Station */}

        <div
          className="lg:hidden lg:!border-slate-200 lg:!bg-slate-50"
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
            className="lg:!text-slate-500"
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
        className="lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8"
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
        <div
          role="status"
          aria-live="polite"
          className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold lg:ml-auto lg:max-w-xl ${online && pending === 0 ? 'lg:hidden ' : ''}${
            online
              ? pending > 0
                ? "border-blue-200 bg-blue-50 text-blue-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {online ? (
            pending > 0 ? <UploadCloud className="h-4 w-4 shrink-0" /> : <Cloud className="h-4 w-4 shrink-0" />
          ) : (
            <CloudOff className="h-4 w-4 shrink-0" />
          )}
          <span>
            {online
              ? pending > 0
                ? `Online · ${pending} change${pending === 1 ? "" : "s"} pending sync`
                : "Online · All changes synced"
              : pending > 0
              ? `Offline · ${pending} ${pending === 1 ? "entry" : "entries"} pending sync`
              : "Offline · Entries will be saved on this device and synced automatically when connectivity returns."}
          </span>
        </div>

        {!online && (entrySnapshotCachedAt || completionSnapshotCachedAt) ? <p className="mb-3 text-[11px] font-medium text-slate-500">Server entry/completion context is cached · Updated {formatCacheAge(entrySnapshotCachedAt ?? completionSnapshotCachedAt!)}. Unsaved drafts and local pending entries take precedence.</p> : null}

        {stationScopeError && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
            {stationScopeError}
          </div>
        )}

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
          className="gv-parameter-selector-card"
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
            className="gv-parameter-selector-heading"
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
            className="gv-parameter-feeder-selector"
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
            className="gv-parameter-slot-selector"
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
              <span className="hidden lg:inline">View Completion Status</span>
            </button>
          </div>

          {/* =================================================
              SLOT INFORMATION
          ================================================== */}

          <div
            className="gv-parameter-slot-state"
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

          {activeEntrySyncStatus && (
            <div
              role="status"
              className={`gv-parameter-slot-sync mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                activeEntrySyncStatus === "SYNCED"
                  ? "bg-emerald-50 text-emerald-700"
                  : activeEntrySyncStatus === "PENDING"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700"
              }`}
              title={activeEntrySyncStatus === "NEEDS_ATTENTION" ? queuedEntry?.lastError ?? "This entry needs review." : undefined}
            >
              {activeEntrySyncStatus === "SYNCED" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : activeEntrySyncStatus === "PENDING" ? (
                <UploadCloud className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              {activeEntrySyncStatus === "SYNCED"
                ? "Synced"
                : activeEntrySyncStatus === "PENDING"
                ? "Pending Sync"
                : "Needs Attention"}
            </div>
          )}
        </div>

        {/* =================================================
            PARAMETERS CARD
        ================================================== */}

        <div
          className="gv-parameter-workspace"
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
            className="gv-parameter-workspace-heading"
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

          <h4 className="gv-parameter-group gv-parameter-group-electrical">Electrical Parameters</h4>
          <h4 className="gv-parameter-group gv-parameter-group-transformer">Transformer Parameters</h4>
          <h4 className="gv-parameter-group gv-parameter-group-notes">Operational Notes</h4>

          {PARAMETERS.map(
            (
              parameter,
              index
            ) => (
              <div
                className={`gv-parameter-field gv-parameter-${parameter.key}`}
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

        {draftStatus && (
          <div role="status" className={`gv-operator-draft mt-3 text-center text-[11px] font-semibold ${draftStatus === "FAILED" ? "text-red-700" : "text-slate-500"}`}>
            {draftStatus === "SAVING"
              ? "Saving draft…"
              : draftStatus === "SAVED"
                ? "Draft saved locally"
                : draftStatus === "RESTORED"
                  ? "Unsaved draft restored"
                  : "Draft save failed — device storage may be full; keep this page open and free storage before retrying"}
          </div>
        )}

        <button
          className="gv-operator-save"
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
                ? lastSaveStatus === "PENDING" ? "#D97706" : "#059669"
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
    {lastSaveStatus === "PENDING" ? <UploadCloud size={18} /> : <CheckCircle2 size={18} />}
    {lastSaveStatus === "PENDING" ? "Pending Sync" : "Synced"}
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
                lastSaveStatus === "PENDING" ? "#FFFBEB" : "#ECFDF5",

              border:
                lastSaveStatus === "PENDING" ? "1px solid #FDE68A" : "1px solid #A7F3D0",

              color:
                lastSaveStatus === "PENDING" ? "#92400E" : "#047857",

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
            {lastSaveStatus === "PENDING" ? <UploadCloud size={17} /> : <CheckCircle2 size={17} />}

            {lastSaveStatus === "PENDING"
              ? "Reading saved on this device and pending sync."
              : "Hourly log-book data synced successfully."}
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
        {completionSavedOffline ? "Reading Saved Locally" : "Hourly Entry Complete"}
      </h3>

      <p
        style={{
          margin: "10px 0 0",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#64748B",
        }}
      >
        {completionSavedOffline ? (
          <>Reading saved locally. Final completion status will refresh after sync.</>
        ) : (
          <>Data for all feeders has been entered for <strong>{selectedDate}</strong> at <strong>{hourValue(selectedHour)}</strong>.</>
        )}
      </p>

      <button
        type="button"
        onClick={() => {
          setAllFeedersSavedMessage(false);
          setCompletionSavedOffline(false);
        }}
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
