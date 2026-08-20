import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Clock3,
  ZapOff,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  X,
  Info,
} from "lucide-react";

import { api } from "@/services/api";
import { useApp } from "@/context/AppContext";
import type { Interruption } from "@/types";

/* =========================================================
   INTERRUPTION REASONS

   These values intentionally match the reason categories
   already used by the Analytics module.
========================================================= */

const INTERRUPTION_REASONS = [
  "Equipment Fault",
  "External Fault",
  "Scheduled Work",
  "Overload",
  "Others",
] as const;

/* =========================================================
   HELPERS
========================================================= */

function currentLocalDateTime(): string {
  const now = new Date();

  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);

  return local.toISOString().slice(0, 16);
}

function localInputToISO(value: string): string {
  return new Date(value).toISOString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =========================================================
   PAGE
========================================================= */

export function InterruptionEntryPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const {
    activeStationId,
    activeStation,
    activeFeeders,
  } = useApp();

  /* ---------------------------------------------------------
     New interruption form
  --------------------------------------------------------- */

  const [feederId, setFeederId] = useState("");
  const [reason, setReason] = useState("");
  const [tripTime, setTripTime] = useState(
    currentLocalDateTime()
  );

  /* ---------------------------------------------------------
     Open interruptions
  --------------------------------------------------------- */

  const [openInterruptions, setOpenInterruptions] =
    useState<Interruption[]>([]);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [error, setError] = useState<string | null>(
    null
  );

  /* ---------------------------------------------------------
     Confirmation modal
  --------------------------------------------------------- */

  const [
    showTripConfirmation,
    setShowTripConfirmation,
  ] = useState(false);

  /*
   * Prevent the confirmation window from immediately
   * reopening when the operator presses Cancel without
   * changing any values.
   */
  const [lastPromptKey, setLastPromptKey] =
    useState("");

  /* ---------------------------------------------------------
     Restore modal
  --------------------------------------------------------- */

  const [
    selectedInterruption,
    setSelectedInterruption,
  ] = useState<Interruption | null>(null);

  const [restoreTime, setRestoreTime] = useState(
    currentLocalDateTime()
  );

  /* =========================================================
     FEEDER LOOKUP
  ========================================================= */

  const feederMap = useMemo(() => {
    return new Map(
      activeFeeders.map((f) => [f.id, f.name])
    );
  }, [activeFeeders]);

  const selectedFeeder = useMemo(
    () =>
      activeFeeders.find(
        (f) => f.id === feederId
      ) ?? null,
    [activeFeeders, feederId]
  );

  function interruptionFeederId(
    interruption: Interruption
  ): string | null {
    return (
      (
        interruption as Interruption & {
          feeder_id?: string | null;
        }
      ).feeder_id ?? null
    );
  }

  function feederNameFor(
    interruption: Interruption
  ): string {
    const id =
      interruptionFeederId(interruption);

    if (!id) return "Unknown Feeder";

    return feederMap.get(id) ?? "Unknown Feeder";
  }

  /* =========================================================
     LOAD CURRENT OPEN INTERRUPTIONS
  ========================================================= */

  const loadOpenInterruptions =
    useCallback(async () => {
      if (!activeStationId) {
        setOpenInterruptions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const rows = await api.getInterruptions(
          activeStationId,
          "open"
        );

        rows.sort(
          (a, b) =>
            +new Date(b.started_at) -
            +new Date(a.started_at)
        );

        setOpenInterruptions(rows);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Failed to load interruptions."
        );
      } finally {
        setLoading(false);
      }
    }, [activeStationId]);

  useEffect(() => {
    void loadOpenInterruptions();
  }, [loadOpenInterruptions]);

  /* =========================================================
     AUTOMATIC CONFIRMATION POPUP

     When feeder + reason are selected, trip time already
     contains the current time, so the confirmation window
     appears automatically.
  ========================================================= */

  useEffect(() => {
    if (!feederId || !reason || !tripTime) return;

    const promptKey = `${feederId}|${reason}|${tripTime}`;

    if (promptKey === lastPromptKey) return;

    setLastPromptKey(promptKey);
    setShowTripConfirmation(true);
  }, [
    feederId,
    reason,
    tripTime,
    lastPromptKey,
  ]);

  /* =========================================================
     CREATE INTERRUPTION
  ========================================================= */

  async function confirmTrip() {
    if (
      !activeStationId ||
      !feederId ||
      !reason ||
      !tripTime
    ) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      /*
       * Cast against the argument type of the existing
       * api.addInterruption method so this page remains
       * compatible with the project's existing API service.
       */
      const row = {
        station_id: activeStationId,
        feeder_id: feederId,
        started_at: localInputToISO(tripTime),
        restored_at: null,
        reason,
        status: "open",
      } as Parameters<
        typeof api.addInterruption
      >[0];

      const created =
        await api.addInterruption(row);

      setOpenInterruptions((current) => [
        created,
        ...current,
      ]);

      setShowTripConfirmation(false);

      /*
       * Reset the entry form for the next interruption.
       */
      setFeederId("");
      setReason("");

      const nextTime = currentLocalDateTime();
      setTripTime(nextTime);
      setLastPromptKey("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to create interruption."
      );
    } finally {
      setCreating(false);
    }
  }

  /* =========================================================
     OPEN RESTORE WINDOW
  ========================================================= */

  function openRestoreModal(
    interruption: Interruption
  ) {
    setSelectedInterruption(interruption);

    /*
     * Restore time defaults to current date/time,
     * but the operator may change it.
     */
    setRestoreTime(currentLocalDateTime());
  }

  /* =========================================================
     RESTORE FEEDER
  ========================================================= */

  async function restoreFeeder() {
    if (
      !selectedInterruption ||
      !restoreTime
    ) {
      return;
    }

    setRestoring(true);
    setError(null);

    try {
      await api.restoreInterruption(
        selectedInterruption.id,
        localInputToISO(restoreTime)
      );

      /*
       * Remove restored feeder immediately from the
       * Current Open Feeders list.
       */
      setOpenInterruptions((current) =>
        current.filter(
          (item) =>
            item.id !== selectedInterruption.id
        )
      );

      setSelectedInterruption(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to restore feeder."
      );
    } finally {
      setRestoring(false);
    }
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#EEF3F8",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* =====================================================
          HEADER
      ====================================================== */}

      <div
        style={{
          background:
            "linear-gradient(135deg,#0D47A1,#1565C0)",
          color: "white",
          padding: 16,
          paddingTop: 22,
          paddingBottom: 22,
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
          boxShadow:
            "0 4px 12px rgba(0,0,0,.18)",
        }}
      >
        {/* Top row */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={onBack}
            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>

          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            Interruption Entry
          </h2>

          <CalendarDays size={24} />
        </div>

        {/* Station */}

        <div
          style={{
            marginTop: 18,
            background:
              "rgba(255,255,255,.16)",
            border:
              "1px solid rgba(255,255,255,.20)",
            borderRadius: 14,
            padding: "11px 14px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "#BFDBFE",
              fontWeight: 700,
            }}
          >
            Operator Station
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            {activeStation?.name ??
              "Station not assigned"}
          </div>
        </div>
      </div>

      {/* =====================================================
          BODY
      ====================================================== */}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          paddingBottom: 100,
        }}
      >
        {/* =================================================
            ERROR
        ================================================== */}

        {error && (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              marginBottom: 14,
              borderRadius: 14,
              padding: 14,
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#B91C1C",
            }}
          >
            <AlertTriangle
              size={20}
              style={{
                flexShrink: 0,
                marginTop: 1,
              }}
            />

            <div
              style={{
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          </div>
        )}

        {/* =================================================
            NEW INTERRUPTION CARD
        ================================================== */}

        <div
          style={{
            background: "#ffffff",
            borderRadius: 18,
            padding: 18,
            boxShadow:
              "0 4px 12px rgba(0,0,0,.08)",
            border: "1px solid #E2E8F0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 13,
                background: "#FEE2E2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ZapOff
                size={22}
                color="#DC2626"
              />
            </div>

            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#1E293B",
                }}
              >
                Record Interruption
              </h3>

              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 11,
                  color: "#64748B",
                }}
              >
                Enter feeder trip details
              </p>
            </div>
          </div>

          {/* Feeder */}

          <label
            style={{
              display: "block",
              marginBottom: 15,
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "#475569",
                textTransform: "uppercase",
              }}
            >
              Feeder / Equipment
            </span>

            <div
              style={{
                position: "relative",
              }}
            >
              <select
                value={feederId}
                onChange={(e) =>
                  setFeederId(e.target.value)
                }
                disabled={!activeStationId}
                style={{
                  width: "100%",
                  appearance: "none",
                  border: "1px solid #CBD5E1",
                  borderRadius: 12,
                  padding: "12px 42px 12px 13px",
                  background: "#F8FAFC",
                  color: "#1E293B",
                  fontSize: 14,
                  fontWeight: 600,
                  outline: "none",
                }}
              >
                <option value="">
                  Select feeder
                </option>

                {activeFeeders.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                  >
                    {f.name}
                  </option>
                ))}
              </select>

              <ChevronDown
                size={18}
                color="#64748B"
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  right: 13,
                  top: "50%",
                  transform:
                    "translateY(-50%)",
                }}
              />
            </div>
          </label>

          {/* Trip Time */}

          <label
            style={{
              display: "block",
              marginBottom: 15,
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "#475569",
                textTransform: "uppercase",
              }}
            >
              Trip Date & Time
            </span>

            <div
              style={{
                position: "relative",
              }}
            >
              <Clock3
                size={18}
                color="#64748B"
                style={{
                  position: "absolute",
                  left: 13,
                  top: "50%",
                  transform:
                    "translateY(-50%)",
                  pointerEvents: "none",
                }}
              />

              <input
                type="datetime-local"
                value={tripTime}
                onChange={(e) =>
                  setTripTime(e.target.value)
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #CBD5E1",
                  borderRadius: 12,
                  padding:
                    "12px 12px 12px 42px",
                  background: "#F8FAFC",
                  color: "#1E293B",
                  fontSize: 14,
                  fontWeight: 600,
                  outline: "none",
                }}
              />
            </div>
          </label>

          {/* Reason */}

          <label
            style={{
              display: "block",
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "#475569",
                textTransform: "uppercase",
              }}
            >
              Reason of Interruption
            </span>

            <div
              style={{
                position: "relative",
              }}
            >
              <select
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value)
                }
                style={{
                  width: "100%",
                  appearance: "none",
                  border: "1px solid #CBD5E1",
                  borderRadius: 12,
                  padding: "12px 42px 12px 13px",
                  background: "#F8FAFC",
                  color: reason
                    ? "#1E293B"
                    : "#64748B",
                  fontSize: 14,
                  fontWeight: 600,
                  outline: "none",
                }}
              >
                <option value="">
                  Select reason
                </option>

                {INTERRUPTION_REASONS.map(
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

              <ChevronDown
                size={18}
                color="#64748B"
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  right: 13,
                  top: "50%",
                  transform:
                    "translateY(-50%)",
                }}
              />
            </div>
          </label>
        </div>

        {/* =================================================
            CURRENT OPEN FEEDERS
        ================================================== */}

        <div
          style={{
            marginTop: 18,
          }}
        >
          <div
            style={{
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#1E293B",
                }}
              >
                Currently Open Feeders
              </h3>

              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 11,
                  color: "#64748B",
                }}
              >
                Tap a feeder to restore supply
              </p>
            </div>

            <div
              style={{
                minWidth: 30,
                height: 30,
                padding: "0 9px",
                borderRadius: 15,
                background: "#FEE2E2",
                color: "#B91C1C",
                fontSize: 12,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {openInterruptions.length}
            </div>
          </div>

          {/* Loading */}

          {loading && (
            <div
              style={{
                background: "#ffffff",
                borderRadius: 18,
                padding: 28,
                textAlign: "center",
                color: "#64748B",
                boxShadow:
                  "0 4px 12px rgba(0,0,0,.08)",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Loading open feeders…
            </div>
          )}

          {/* Empty */}

          {!loading &&
            openInterruptions.length === 0 && (
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 18,
                  padding: 28,
                  textAlign: "center",
                  boxShadow:
                    "0 4px 12px rgba(0,0,0,.08)",
                  border: "1px solid #D1FAE5",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    margin: "0 auto 12px",
                    borderRadius: "50%",
                    background: "#D1FAE5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CheckCircle2
                    size={27}
                    color="#059669"
                  />
                </div>

                <h4
                  style={{
                    margin: 0,
                    color: "#1E293B",
                    fontSize: 15,
                  }}
                >
                  All Feeders Normal
                </h4>

                <p
                  style={{
                    margin: "5px 0 0",
                    color: "#64748B",
                    fontSize: 12,
                  }}
                >
                  There are no open interruptions
                  at this station.
                </p>
              </div>
            )}

          {/* Open feeder cards */}

          {!loading &&
            openInterruptions.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {openInterruptions.map(
                  (interruption) => (
                    <button
                      key={interruption.id}
                      onClick={() =>
                        openRestoreModal(
                          interruption
                        )
                      }
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border:
                          "1px solid #FECACA",
                        borderRadius: 18,
                        padding: 15,
                        background: "#ffffff",
                        boxShadow:
                          "0 4px 12px rgba(0,0,0,.08)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems:
                            "flex-start",
                          gap: 13,
                        }}
                      >
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            flexShrink: 0,
                            borderRadius: 13,
                            background:
                              "#FEE2E2",
                            display: "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                          }}
                        >
                          <ZapOff
                            size={22}
                            color="#DC2626"
                          />
                        </div>

                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent:
                                "space-between",
                              gap: 10,
                            }}
                          >
                            <h4
                              style={{
                                margin: 0,
                                color:
                                  "#1E293B",
                                fontSize: 15,
                                fontWeight: 700,
                              }}
                            >
                              {feederNameFor(
                                interruption
                              )}
                            </h4>

                            <span
                              style={{
                                flexShrink: 0,
                                borderRadius:
                                  20,
                                padding:
                                  "4px 9px",
                                background:
                                  "#FEE2E2",
                                color:
                                  "#B91C1C",
                                fontSize: 9,
                                fontWeight: 800,
                              }}
                            >
                              OPEN
                            </span>
                          </div>

                          <p
                            style={{
                              margin:
                                "6px 0 0",
                              fontSize: 12,
                              color:
                                "#64748B",
                            }}
                          >
                            {interruption.reason}
                          </p>

                          <div
                            style={{
                              marginTop: 10,
                              paddingTop: 9,
                              borderTop:
                                "1px solid #E2E8F0",
                              fontSize: 10,
                              color:
                                "#94A3B8",
                              display: "flex",
                              justifyContent:
                                "space-between",
                              gap: 10,
                            }}
                          >
                            <span>
                              Trip Time
                            </span>

                            <span
                              style={{
                                fontWeight:
                                  600,
                                color:
                                  "#64748B",
                              }}
                            >
                              {formatDateTime(
                                interruption.started_at
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                )}
              </div>
            )}
        </div>
      </div>

      {/* =====================================================
          TRIP CONFIRMATION MODAL
      ====================================================== */}

      {showTripConfirmation &&
        selectedFeeder && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background:
                "rgba(15,23,42,.55)",
              backdropFilter: "blur(3px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                background: "#ffffff",
                borderRadius: 22,
                overflow: "hidden",
                boxShadow:
                  "0 24px 60px rgba(0,0,0,.25)",
              }}
            >
              <div
                style={{
                  padding: 18,
                  background:
                    "linear-gradient(135deg,#B91C1C,#DC2626)",
                  color: "white",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <AlertTriangle size={22} />

                    <h3
                      style={{
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      Confirm Interruption
                    </h3>
                  </div>

                  <button
                    onClick={() =>
                      setShowTripConfirmation(
                        false
                      )
                    }
                    style={{
                      border: "none",
                      background:
                        "transparent",
                      color: "white",
                      cursor: "pointer",
                    }}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  padding: 20,
                }}
              >
                <p
                  style={{
                    margin: "0 0 17px",
                    fontSize: 13,
                    color: "#64748B",
                  }}
                >
                  Please confirm the following
                  feeder interruption.
                </p>

                <ModalRow
                  label="Feeder"
                  value={selectedFeeder.name}
                />

                <ModalRow
                  label="Trip Time"
                  value={formatDateTime(
                    localInputToISO(tripTime)
                  )}
                />

                <ModalRow
                  label="Reason"
                  value={reason}
                />

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 20,
                  }}
                >
                  <button
                    disabled={creating}
                    onClick={() =>
                      setShowTripConfirmation(
                        false
                      )
                    }
                    style={{
                      flex: 1,
                      border:
                        "1px solid #CBD5E1",
                      borderRadius: 11,
                      padding: "12px 10px",
                      background: "#ffffff",
                      color: "#475569",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    disabled={creating}
                    onClick={() =>
                      void confirmTrip()
                    }
                    style={{
                      flex: 1.5,
                      border: "none",
                      borderRadius: 11,
                      padding: "12px 10px",
                      background: creating
                        ? "#94A3B8"
                        : "#DC2626",
                      color: "#ffffff",
                      fontWeight: 700,
                      cursor: creating
                        ? "default"
                        : "pointer",
                    }}
                  >
                    {creating
                      ? "Saving..."
                      : "Confirm Trip"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* =====================================================
          RESTORE MODAL
      ====================================================== */}

      {selectedInterruption && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15,23,42,.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#ffffff",
              borderRadius: 22,
              overflow: "hidden",
              boxShadow:
                "0 24px 60px rgba(0,0,0,.25)",
            }}
          >
            {/* Modal header */}

            <div
              style={{
                padding: 18,
                background:
                  "linear-gradient(135deg,#047857,#059669)",
                color: "#ffffff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <RotateCcw size={22} />

                  <h3
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 700,
                    }}
                  >
                    Restore Feeder
                  </h3>
                </div>

                <button
                  onClick={() =>
                    setSelectedInterruption(
                      null
                    )
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <X size={22} />
                </button>
              </div>
            </div>

            <div
              style={{
                padding: 20,
              }}
            >
              <ModalRow
                label="Feeder"
                value={feederNameFor(
                  selectedInterruption
                )}
              />

              <ModalRow
                label="Interruption Start"
                value={formatDateTime(
                  selectedInterruption.started_at
                )}
              />

              <ModalRow
                label="Reason"
                value={
                  selectedInterruption.reason
                }
              />

              {/* Restore Time */}

              <div
                style={{
                  marginTop: 18,
                }}
              >
                <label
                  style={{
                    display: "block",
                    marginBottom: 7,
                    color: "#475569",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  Restore Date & Time
                </label>

                <input
                  type="datetime-local"
                  value={restoreTime}
                  onChange={(e) =>
                    setRestoreTime(
                      e.target.value
                    )
                  }
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border:
                      "1px solid #CBD5E1",
                    borderRadius: 11,
                    padding: 12,
                    background: "#F8FAFC",
                    color: "#1E293B",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: 20,
                  display: "flex",
                  gap: 10,
                }}
              >
                <button
                  disabled={restoring}
                  onClick={() =>
                    setSelectedInterruption(
                      null
                    )
                  }
                  style={{
                    flex: 1,
                    border:
                      "1px solid #CBD5E1",
                    borderRadius: 11,
                    padding: 12,
                    background: "#ffffff",
                    color: "#475569",
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>

                <button
                  disabled={restoring}
                  onClick={() =>
                    void restoreFeeder()
                  }
                  style={{
                    flex: 1.5,
                    border: "none",
                    borderRadius: 11,
                    padding: 12,
                    background: restoring
                      ? "#94A3B8"
                      : "#059669",
                    color: "#ffffff",
                    fontWeight: 700,
                  }}
                >
                  {restoring
                    ? "Restoring..."
                    : "Restore"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   MODAL DETAIL ROW
========================================================= */

function ModalRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding: "11px 0",
        borderBottom: "1px solid #E2E8F0",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 15,
      }}
    >
      <span
        style={{
          color: "#64748B",
          fontSize: 12,
        }}
      >
        {label}
      </span>

      <span
        style={{
          color: "#1E293B",
          fontSize: 13,
          fontWeight: 700,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}