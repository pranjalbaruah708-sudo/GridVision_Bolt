import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Save,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Info,
} from "lucide-react";

import { api } from "@/services/api";
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
    key: "mvAr",
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
    key: "pf",
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
    key: "temp",
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
    key: "tapPos",
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

  const [feederId, setFeederId] = useState(
    activeFeeders[0]?.id ?? ""
  );

  const [values, setValues] = useState<
    Record<string, string>
  >({
    weather: "Clear",
    remarks: "Normal",
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(
    null
  );

  const set = (key: string, value: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  /* =========================================================
     SAVE ENTRY
  ========================================================= */

  const save = async () => {
    if (!activeStationId || !feederId) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const now = new Date();

      await api.addLogEntry({
        station_id: activeStationId,
        feeder_id: feederId,
        entry_date: now
          .toISOString()
          .slice(0, 10),
        entry_time: now
          .toTimeString()
          .slice(0, 5),
        mw: Number(values.mw) || 0,
        voltage_kv:
          Number(values.voltage) || 0,
        current_a:
          Number(values.current) || 0,
        remarks:
          values.remarks ||
          values.weather ||
          "Operator entry",
      });

      setSaved(true);

      setTimeout(() => {
        setSaved(false);
      }, 2500);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to save operator entry."
      );
    } finally {
      setSaving(false);
    }
  };

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
          Same style as AlertsPage
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
        {/* Header title row */}

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
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Operator Entry
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
              marginBottom: 14,
              borderRadius: 14,
              padding: 14,
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#B91C1C",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <Info
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
            ENTRY DETAILS CARD
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
                background: "#DBEAFE",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Gauge
                size={23}
                color="#1565C0"
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
                Substation Parameters
              </h3>

              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 11,
                  color: "#64748B",
                }}
              >
                Enter current operating values
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
              Feeder
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
                style={{
                  width: "100%",
                  appearance: "none",
                  border: "1px solid #CBD5E1",
                  borderRadius: 12,
                  padding:
                    "12px 42px 12px 13px",
                  background: "#F8FAFC",
                  color: "#1E293B",
                  fontSize: 14,
                  fontWeight: 600,
                  outline: "none",
                }}
              >
                {activeFeeders.length === 0 && (
                  <option value="">
                    No feeder available
                  </option>
                )}

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

          {/* Date / Time */}

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
              Date / Time
            </span>

            <input
              type="text"
              readOnly
              value={new Date().toLocaleString()}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid #CBD5E1",
                borderRadius: 12,
                padding: "12px 13px",
                background: "#F8FAFC",
                color: "#64748B",
                fontSize: 14,
                fontWeight: 600,
                outline: "none",
              }}
            />
          </label>
        </div>

        {/* =================================================
            PARAMETERS CARD
        ================================================== */}

        <div
          style={{
            marginTop: 16,
            background: "#ffffff",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow:
              "0 4px 12px rgba(0,0,0,.08)",
            border: "1px solid #E2E8F0",
          }}
        >
          {/* Card heading */}

          <div
            style={{
              padding: "14px 16px",
              borderBottom:
                "1px solid #E2E8F0",
              background: "#F8FAFC",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: "#1E293B",
              }}
            >
              Parameters
            </h3>

            <p
              style={{
                margin: "3px 0 0",
                fontSize: 11,
                color: "#64748B",
              }}
            >
              Record operational readings
            </p>
          </div>

          {/* Parameter rows */}

          <div>
            {PARAMETERS.map(
              (parameter, index) => (
                <div
                  key={parameter.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom:
                      index ===
                      PARAMETERS.length - 1
                        ? "none"
                        : "1px solid #F1F5F9",
                  }}
                >
                  <label
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: "#475569",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {parameter.label}
                  </label>

                  <div
                    style={{
                      width: 150,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <input
                      type={parameter.type}
                      inputMode={
                        parameter.type ===
                        "number"
                          ? "decimal"
                          : "text"
                      }
                      value={
                        values[
                          parameter.key
                        ] ?? ""
                      }
                      onChange={(e) =>
                        set(
                          parameter.key,
                          e.target.value
                        )
                      }
                      placeholder="—"
                      style={{
                        width: "100%",
                        minWidth: 0,
                        boxSizing:
                          "border-box",
                        border:
                          "1px solid #CBD5E1",
                        borderRadius: 10,
                        padding: "8px 10px",
                        textAlign:
                          parameter.type ===
                          "number"
                            ? "right"
                            : "left",
                        background:
                          "#F8FAFC",
                        color: "#1E293B",
                        fontSize: 13,
                        fontWeight: 600,
                        outline: "none",
                      }}
                    />

                    {parameter.unit && (
                      <span
                        style={{
                          width: 42,
                          flexShrink: 0,
                          color: "#94A3B8",
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {parameter.unit}
                      </span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* =================================================
            SAVE BUTTON
        ================================================== */}

        <button
          onClick={() => void save()}
          disabled={
            saving || !feederId
          }
          style={{
            width: "100%",
            marginTop: 18,
            border: "none",
            borderRadius: 13,
            padding: "14px 16px",
            background: saved
              ? "#059669"
              : saving || !feederId
              ? "#94A3B8"
              : "linear-gradient(135deg,#0D47A1,#1565C0)",
            color: "#ffffff",
            fontSize: 14,
            fontWeight: 700,
            boxShadow:
              saving || !feederId
                ? "none"
                : "0 4px 12px rgba(21,101,192,.25)",
            cursor:
              saving || !feederId
                ? "default"
                : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {saving ? (
            <>
              <Save size={18} />
              Saving…
            </>
          ) : saved ? (
            <>
              <CheckCircle2
                size={18}
              />
              Entry Saved
            </>
          ) : (
            <>
              <Save size={18} />
              Save Entry
            </>
          )}
        </button>

        {/* Success message */}

        {saved && (
          <div
            style={{
              marginTop: 12,
              borderRadius: 14,
              padding: 13,
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              color: "#047857",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <CheckCircle2
              size={17}
            />

            Entry recorded to log book
            and synced.
          </div>
        )}
      </div>
    </div>
  );
}