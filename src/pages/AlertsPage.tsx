import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Info,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";

import { api } from "@/services/api";
import { useApp } from "@/context/AppContext";
import type { Interruption, OverloadAlert } from "@/types";

type AlertKind = "critical" | "warning" | "info";

type AlertItem = {
  id: string;
  kind: AlertKind;
  title: string;
  message: string;
  station: string;
  time: string;
};

const FILTERS = ["ALL", "CRITICAL", "WARNING", "INFO"] as const;

type Filter = (typeof FILTERS)[number];

export function AlertsPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const { stations } = useApp();

  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [overloads, ints] = await Promise.all([
        api.getOverloadAlerts(),
        api.getInterruptions(),
      ]);

      const built: AlertItem[] = [
        ...overloads.map((a: OverloadAlert) => ({
          id: `o-${a.id}`,

          kind: (
            a.value > a.limit_value * 1.1
              ? "critical"
              : "warning"
          ) as AlertKind,

          title: `Overload: ${a.asset_id}`,

          message: `${a.parameter} ${a.value} (limit ${a.limit_value})`,

          station:
            stations.find(
              (s) => s.id === a.station_id
            )?.name ?? "—",

          time: a.alert_time,
        })),

        ...ints.map((i: Interruption) => ({
          id: `i-${i.id}`,

          kind: (
            i.current_status === "OPEN"
              ? "critical"
              : "info"
          ) as AlertKind,

         title: i.cause ?? "Interruption",

          message:
            i.current_status === "OPEN"
              ? "Supply interrupted — restoration in progress"
              : `Restored after ${
                 i.duration_minutes !== null
  ? `${Math.round(i.duration_minutes)} min`
  : "—"
                }h`,

          station:
            stations.find(
              (s) => s.id === i.station_id
            )?.name ?? "—",

        time: i.interruption_start,
        })),
      ];

      built.sort(
        (a, b) =>
          +new Date(b.time) -
          +new Date(a.time)
      );

      setItems(built);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to load alerts"
      );
    } finally {
      setLoading(false);
    }
  }, [stations]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered =
    filter === "ALL"
      ? items
      : items.filter(
          (i) =>
            i.kind ===
            filter.toLowerCase()
        );

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
          Same visual style as AnalysisLogbook1.tsx
      ====================================================== */}

      <div
        style={{
          background:
            "linear-gradient(135deg,#0D47A1,#1565C0)",
          color: "white",
          padding: "16px",
          paddingTop: "22px",
          borderBottomLeftRadius: "22px",
          borderBottomRightRadius: "22px",
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
          {/* Back button */}

          <button
            onClick={onBack}
            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
            aria-label="Back to Module Selection"
          >
            <ArrowLeft size={24} />
          </button>

          {/* Title */}

          <h2
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Alerts
          </h2>

          {/* Calendar */}

          <CalendarDays size={24} />
        </div>

        {/* =================================================
            FILTER TABS
        ================================================== */}

        <div
          style={{
            marginTop: 22,
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {FILTERS.map((filterItem) => (
            <button
              key={filterItem}
              onClick={() =>
                setFilter(filterItem)
              }
              style={{
                border: "none",
                outline: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                padding: "10px 18px",
                borderRadius: 25,
                fontWeight: 600,
                fontSize: 14,
                transition: ".25s",

                background:
                  filter === filterItem
                    ? "#ffffff"
                    : "rgba(255,255,255,.20)",

                color:
                  filter === filterItem
                    ? "#1565C0"
                    : "#ffffff",

                boxShadow:
                  filter === filterItem
                    ? "0 3px 8px rgba(0,0,0,.15)"
                    : "none",
              }}
            >
              {filterItem}
            </button>
          ))}
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
            LOADING
        ================================================== */}

        {loading && (
          <div
            style={{
              background: "#ffffff",
              borderRadius: 18,
              padding: 30,
              textAlign: "center",
              color: "#64748B",
              boxShadow:
                "0 4px 12px rgba(0,0,0,.08)",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            Loading alerts…
          </div>
        )}

        {/* =================================================
            ERROR
        ================================================== */}

        {!loading && error && (
          <div
            style={{
              background: "#ffffff",
              borderRadius: 18,
              padding: 24,
              textAlign: "center",
              boxShadow:
                "0 4px 12px rgba(0,0,0,.08)",
            }}
          >
            <div
              style={{
                color: "#DC2626",
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              Failed to load alerts
            </div>

            <p
              style={{
                margin: "0 0 18px",
                color: "#64748B",
                fontSize: 14,
              }}
            >
              {error}
            </p>

            <button
              onClick={() => void load()}
              style={{
                border: "none",
                borderRadius: 10,
                padding: "10px 18px",
                background: "#1565C0",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* =================================================
            EMPTY
        ================================================== */}

        {!loading &&
          !error &&
          filtered.length === 0 && (
            <div
              style={{
                background: "#ffffff",
                borderRadius: 18,
                padding: 35,
                textAlign: "center",
                boxShadow:
                  "0 4px 12px rgba(0,0,0,.08)",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  margin: "0 auto 14px",
                  borderRadius: "50%",
                  background: "#E8F0FE",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Info
                  size={28}
                  color="#1565C0"
                />
              </div>

              <h3
                style={{
                  margin: "0 0 6px",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#1E293B",
                }}
              >
                No Alerts
              </h3>

              <p
                style={{
                  margin: 0,
                  color: "#64748B",
                  fontSize: 13,
                }}
              >
                No alerts in this category.
              </p>
            </div>
          )}

        {/* =================================================
            ALERT CARDS
        ================================================== */}

        {!loading &&
          !error &&
          filtered.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {filtered.map((a) => {
                const config =
                  KIND_CONFIG[a.kind];

                const Icon = config.icon;

                return (
                  <div
                    key={a.id}
                    style={{
                      background: "#ffffff",
                      borderRadius: 18,
                      padding: 16,
                      boxShadow:
                        "0 4px 12px rgba(0,0,0,.08)",
                      border: `1px solid ${config.borderColor}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                      }}
                    >
                      {/* Alert icon */}

                      <div
                        style={{
                          width: 46,
                          height: 46,
                          flexShrink: 0,
                          borderRadius: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background:
                            config.iconBackground,
                        }}
                      >
                        <Icon
                          size={23}
                          color={config.iconColor}
                        />
                      </div>

                      {/* Alert information */}

                      <div
                        style={{
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        {/* Title + badge */}

                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent:
                              "space-between",
                            gap: 10,
                          }}
                        >
                          <h3
                            style={{
                              margin: 0,
                              fontSize: 15,
                              fontWeight: 700,
                              color: "#1E293B",
                              lineHeight: 1.3,
                            }}
                          >
                            {a.title}
                          </h3>

                          <span
                            style={{
                              flexShrink: 0,
                              borderRadius: 20,
                              padding:
                                "4px 9px",
                              fontSize: 9,
                              fontWeight: 800,
                              textTransform:
                                "uppercase",
                              background:
                                config.badgeBackground,
                              color:
                                config.badgeColor,
                            }}
                          >
                            {a.kind}
                          </span>
                        </div>

                        {/* Message */}

                        <p
                          style={{
                            margin:
                              "7px 0 0",
                            fontSize: 13,
                            lineHeight: 1.45,
                            color: "#64748B",
                          }}
                        >
                          {a.message}
                        </p>

                        {/* Station + time */}

                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 10,
                            borderTop:
                              "1px solid #E2E8F0",
                            display: "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "space-between",
                            gap: 10,
                            fontSize: 10,
                            color: "#94A3B8",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 600,
                            }}
                          >
                            {a.station}
                          </span>

                          <span>
                            {new Date(
                              a.time
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

/* =========================================================
   ALERT TYPE CONFIGURATION
========================================================= */

const KIND_CONFIG: Record<
  AlertKind,
  {
    icon: typeof ShieldAlert;
    borderColor: string;
    iconBackground: string;
    iconColor: string;
    badgeBackground: string;
    badgeColor: string;
  }
> = {
  critical: {
    icon: ShieldAlert,
    borderColor: "#FECACA",
    iconBackground: "#FEE2E2",
    iconColor: "#DC2626",
    badgeBackground: "#FEE2E2",
    badgeColor: "#B91C1C",
  },

  warning: {
    icon: AlertCircle,
    borderColor: "#FDE68A",
    iconBackground: "#FEF3C7",
    iconColor: "#D97706",
    badgeBackground: "#FEF3C7",
    badgeColor: "#B45309",
  },

  info: {
    icon: Info,
    borderColor: "#BFDBFE",
    iconBackground: "#DBEAFE",
    iconColor: "#2563EB",
    badgeBackground: "#DBEAFE",
    badgeColor: "#1D4ED8",
  },
};