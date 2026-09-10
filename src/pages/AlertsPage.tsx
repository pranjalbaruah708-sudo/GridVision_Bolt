import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Info,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";

import { api } from "@/services/api";
import { useApp } from "@/context/AppContext";
import type { Interruption, NotificationClass } from "@/types";
import type { ParameterAlert } from "@/services/api";
import { DesktopPageContainer } from "@/components/layout/DesktopPageContainer";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import ScreenExportMenu from "@/components/ScreenExportMenu";
import { supabase } from '@/services/supabase';
import { cachedFreshness, formatCacheAge, readOperationalSnapshot, writeOperationalSnapshot } from '@/services/operationalReadCache';

type AlertKind = "critical" | "warning" | "info";

type AlertItem = {
  id: string;
  kind: AlertKind;
  title: string;
  message: string;
  stationId?: string;
  station: string;
  feeder?: string;
  time: string;
  duration?: string;
  cause?: string;
  source: "Parameter alert" | "Interruption";
  status: "Active" | "Open" | "Restored" | "Historical";
  notificationClass?: NotificationClass;
};

const NOTIFICATION_CLASS_LABELS: Record<NotificationClass, string> = {
  LIVE: 'LIVE',
  DELAYED_SYNC: 'Delayed Sync',
  HISTORICAL_SYNC: 'Historical Sync',
};

const FILTERS = ["ALL", "CRITICAL", "WARNING", "INFO"] as const;
const ALERTS_REALTIME_TABLES = ['parameter_alerts', 'interruptions'] as const;

export type AlertFilter = (typeof FILTERS)[number];
type Filter = AlertFilter;
type AlertDateRange = { startDate: string; endDate: string };

function todayInIst(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function rangeToIso(range: AlertDateRange): { startIso: string; endIso: string } {
  const start = new Date(`${range.startDate}T00:00:00+05:30`);
  const end = new Date(`${range.endDate}T00:00:00+05:30`);
  return { startIso: start.toISOString(), endIso: new Date(end.getTime() + 86400000).toISOString() };
}

function formatRange(range: AlertDateRange): string {
  const format = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00+05:30`));
  return range.startDate === range.endDate ? format(range.startDate) : `${format(range.startDate)} – ${format(range.endDate)}`;
}

const PARAMETER_LABELS: Record<string, string> = {
  MW: 'MW',
  MVAR: 'MVAR',
  VOLTAGE_KV: 'Voltage',
  CURRENT_A: 'Current',
  POWER_FACTOR: 'Power factor',
  FREQUENCY_HZ: 'Frequency',
  TRANSFORMER_TEMP_C: 'Transformer temperature',
  OIL_LEVEL_PERCENT: 'Oil level',
};

function parameterAlertMessage(alert: ParameterAlert) {
  const parameter = PARAMETER_LABELS[alert.parameter_code] ?? alert.parameter_code;
  const limit = alert.breach_type === 'BELOW_MIN' ? alert.min_value : alert.max_value;
  const direction = alert.breach_type === 'BELOW_MIN' ? 'below minimum' : 'above maximum';
  const configuredLimit = limit === null ? 'configured limit' : `${direction} limit ${limit}`;

  return `${parameter}: ${alert.actual_value} (${configuredLimit})`;
}

function openInterruptionEtr(etr: string | null): string {
  if (!etr) return 'ETR: Not set';
  const label = new Date(etr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
  const exceededMinutes = Math.floor((Date.now() - new Date(etr).getTime()) / 60_000);
  if (!Number.isFinite(exceededMinutes) || exceededMinutes < 0) return `ETR: ${label}`;
  return `ETR: ${label} · Exceeded by ${exceededMinutes < 60 ? `${exceededMinutes} min` : `${Math.floor(exceededMinutes / 60)}h${exceededMinutes % 60 ? ` ${exceededMinutes % 60}m` : ''}`}`;
}

function formatInterruptionDuration(interruption: Interruption): string {
  const minutes = interruption.duration_minutes ?? (
    (interruption.current_status === 'OPEN' || interruption.interruption_end)
      ? Math.max(0, Math.floor(((interruption.interruption_end ? new Date(interruption.interruption_end).getTime() : Date.now()) - new Date(interruption.interruption_start).getTime()) / 60_000))
      : null
  );
  if (minutes === null || !Number.isFinite(minutes)) return 'Duration unavailable';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${hours}h${remainder ? ` ${remainder}m` : ''}`;
}

export function AlertsPage({
  onBack,
  initialFilter = "ALL",
  onFilterChange,
}: {
  onBack: () => void;
  initialFilter?: AlertFilter;
  onFilterChange?: (filter: AlertFilter) => void;
}) {
  const { stations, feeders, online, pending } = useApp();

  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const initialDate = useMemo(todayInIst, []);
  const [dateRange, setDateRange] = useState<AlertDateRange>({ startDate: initialDate, endDate: initialDate });
  const [draftRange, setDraftRange] = useState<AlertDateRange>({ startDate: initialDate, endDate: initialDate });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const reportRef = useRef<HTMLDivElement>(null);
  const [cacheUserId, setCacheUserId] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  useEffect(() => { let active = true; void supabase.auth.getSession().then(({ data }) => { if (active) setCacheUserId(data.session?.user.id ?? null); }); return () => { active = false; }; }, []);

  const load = useCallback(async (background = false) => {
    if (!cacheUserId) return;
    const generation = ++loadGeneration.current;
    if (!background) setLoading(true);
    setError(null);

    try {
      const { startIso, endIso } = rangeToIso(dateRange);
      const cacheKey = `alerts|ALL|${dateRange.startDate}|${dateRange.endDate}`;
      if (!online) {
        const snapshot = readOperationalSnapshot<AlertItem[]>(cacheUserId, cacheKey);
        if (generation !== loadGeneration.current) return;
        if (snapshot) { setItems(snapshot.value); setCachedAt(snapshot.cachedAt); setError(null); }
        else { setItems([]); setCachedAt(null); setError('No cached alerts are available for this period. Connect once to load alerts.'); }
        return;
      }
      const [parameterAlerts, rangeInterruptions, openInterruptions] = await Promise.all([
        api.getParameterAlerts(undefined, startIso, endIso),
        api.getInterruptions(undefined, undefined, startIso, endIso),
        api.getInterruptions(undefined, 'OPEN'),
      ]);
      const interruptionMap = new Map(rangeInterruptions.map((item) => [item.id, item]));
      openInterruptions.forEach((item) => interruptionMap.set(item.id, item));
      const ints = Array.from(interruptionMap.values());
      const stationNames = new Map(stations.map((station) => [station.id, station.name]));
      const feederDetails = new Map(feeders.map((feeder) => [feeder.id, feeder]));

      const built: AlertItem[] = [
        ...parameterAlerts.map((a) => ({
          id: `p-${a.id}`,

          // Parameter alerts have no configured severity band. Keep them as
          // warnings rather than inventing a criticality rule in the client.
          kind: "warning" as AlertKind,

          title: `Parameter exception: ${a.feeder_name ?? feederDetails.get(a.feeder_id)?.name ?? 'Feeder'}`,

          message: a.is_current
            ? parameterAlertMessage(a)
            : `${parameterAlertMessage(a)} · Superseded by a later reading; not a current alarm.`,

          stationId: a.station_id,
          station: stationNames.get(a.station_id)
            ?? stationNames.get(feederDetails.get(a.feeder_id)?.station_id ?? '')
            ?? 'Station details unavailable',
          feeder: a.feeder_name ?? feederDetails.get(a.feeder_id)?.name ?? 'Feeder details unavailable',

          time: a.triggered_at,
          source: "Parameter alert" as const,
          status: a.is_current ? "Active" as const : "Historical" as const,
          notificationClass: a.notification_class ?? 'LIVE',
        })),

        ...ints.map((i: Interruption) => {
          const feeder = i.feeder_id
            ? feederDetails.get(i.feeder_id)?.name ?? 'Feeder details unavailable'
            : 'Station-level interruption';
          const station = stationNames.get(i.station_id)
            ?? stationNames.get(i.feeder_id ? feederDetails.get(i.feeder_id)?.station_id ?? '' : '')
            ?? 'Station details unavailable';
          return {
            id: `i-${i.id}`,
            kind: (i.current_status === "OPEN" ? "critical" : "info") as AlertKind,
            title: feeder,
            message: i.current_status === "OPEN"
              ? `Supply interrupted — restoration in progress${new Date(i.interruption_start) < new Date(startIso) ? ' · Open from before selected range' : ''} · ${openInterruptionEtr(i.etr)}`
              : 'Supply restored',
            stationId: i.station_id,
            station,
            feeder,
            time: i.interruption_start,
            duration: formatInterruptionDuration(i),
            cause: i.cause?.trim() || 'Cause not specified',
            source: "Interruption" as const,
            status: i.current_status === "OPEN" ? "Open" as const : "Restored" as const,
            notificationClass: i.entry_mode === 'OFFLINE'
              ? (i.current_status === 'RESTORED' && i.client_operation_id && i.restore_client_operation_id
                  ? 'HISTORICAL_SYNC' as const
                  : 'DELAYED_SYNC' as const)
              : 'LIVE' as const,
          };
        }),
      ];

      built.sort(
        (a, b) =>
          +new Date(b.time) -
          +new Date(a.time)
      );

      if (generation !== loadGeneration.current) return;
      setItems(built);
      const snapshot = writeOperationalSnapshot(cacheUserId, cacheKey, built.slice(0, 500));
      setCachedAt(snapshot.cachedAt);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      if (!background) {
        setError(
          e instanceof Error
            ? e.message
            : "Failed to load alerts"
        );
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [cacheUserId, dateRange, feeders, online, stations]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);
  const refreshFromRealtime = useCallback(() => {
    void load(true);
  }, [load]);
  useRealtimeRefresh({ channelName: 'alerts-operational-refresh', tables: ALERTS_REALTIME_TABLES, onRefresh: refreshFromRealtime });

  const filtered = useMemo(() => filter === "ALL" ? items : items.filter((item) => item.kind === filter.toLowerCase()), [filter, items]);
  const rangeLabel = useMemo(() => formatRange(dateRange), [dateRange]);
  const freshness = online && !loading && !error ? 'LIVE' : cachedFreshness(cachedAt);
  const freshnessLabel = online && !loading && !error ? 'Live data' : cachedAt ? `${online ? '' : 'Offline · '}Cached · Updated ${formatCacheAge(cachedAt)}` : 'Offline · No cached data';
  const applyDateRange = () => {
    setDateError(null);
    if (!draftRange.startDate || !draftRange.endDate || draftRange.startDate > draftRange.endDate) {
      setDateError('Choose a valid start and end date.');
      return;
    }
    const spanDays = (new Date(`${draftRange.endDate}T00:00:00Z`).getTime() - new Date(`${draftRange.startDate}T00:00:00Z`).getTime()) / 86400000;
    if (spanDays > 365) {
      setDateError('The selected range cannot exceed one year.');
      return;
    }
    setDateRange(draftRange);
    setCalendarOpen(false);
  };
  const alertSummary = useMemo(() => {
    const active = filtered.filter((item) => item.status !== "Restored" && item.status !== "Historical");
    return {
      active: active.length,
      critical: active.filter((item) => item.kind === "critical").length,
      warnings: active.filter((item) => item.kind === "warning").length,
      affectedStations: new Set(active.map((item) => item.stationId
        ?? (item.station !== "—" && item.station !== 'Station details unavailable' ? item.station : null))
        .filter((station): station is string => Boolean(station))).size,
      restored: filtered.filter((item) => item.status === "Restored").length,
    };
  }, [filtered]);

  return (
    <div
      ref={reportRef}
      className="gv-alerts-page"
      style={{
        minHeight: "100vh",
        background: "#EEF3F8",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        .gv-alerts-desktop-subtitle,
        .gv-alerts-desktop-detail,
        .gv-alerts-summary {
          display: none;
        }

        .gv-alerts-layout {
          display: contents;
        }

        @media (min-width: 1024px) {
          .gv-alerts-header {
            padding-left: 0 !important;
            padding-right: 0 !important;
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            box-shadow: none !important;
            border-bottom: 1px solid #e2e8f0;
          }

          .gv-alerts-header > div > div:first-of-type > button:first-child { display: none; }
          .gv-alerts-header [data-export-exclude] button { background: #1d4ed8; color: #ffffff; border-color: #1d4ed8; }

          .gv-alerts-desktop-subtitle,
          .gv-alerts-desktop-detail,
          .gv-alerts-summary {
            display: block;
          }

          .gv-alerts-desktop-subtitle { color: #64748b !important; }

          .gv-alerts-filters button { background: #eff6ff !important; color: #1d4ed8 !important; box-shadow: none !important; }
          .gv-alerts-filters button[aria-pressed="true"] { background: #1d4ed8 !important; color: #ffffff !important; }

          .gv-alerts-filters {
            margin-top: 16px !important;
            gap: 8px !important;
            overflow-x: visible !important;
          }

          .gv-alerts-body {
            overflow-y: visible !important;
            padding: 24px 0 40px !important;
          }

          .gv-alerts-layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 280px;
            align-items: start;
            gap: 20px;
          }

          .gv-alert-list {
            gap: 10px !important;
          }

          .gv-alert-card {
            border-radius: 14px !important;
            padding: 14px !important;
            box-shadow: 0 1px 3px rgba(15, 23, 42, .08) !important;
          }

          .gv-alert-meta {
            justify-content: flex-start !important;
            gap: 24px !important;
          }
        }

        @media (min-width: 1024px) and (max-width: 1279px) {
          .gv-alerts-layout {
            display: flex;
            flex-direction: column;
          }

          .gv-alerts-summary {
            width: 100%;
          }

          .gv-alerts-summary > div {
            position: static;
          }
        }
      `}</style>
      {/* =====================================================
          HEADER
          Same visual style as AnalysisLogbook1.tsx
      ====================================================== */}

      <div
        className="gv-alerts-header"
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
        <DesktopPageContainer width="wide">
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
            data-export-exclude
            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
            aria-label="Back to Module Selection"
          >
            <ArrowLeft size={24} />
          </button>

          {/* Title */}

          <div style={{ minWidth: 0, textAlign: "center" }}>
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              Alerts
            </h2>
            <p className="gv-alerts-desktop-subtitle" style={{ margin: "4px 0 0", color: "#DBEAFE", fontSize: 12, fontWeight: 500 }}>
              Active conditions and recent operational events
            </p>
          </div>

          <div className="flex items-center gap-2" data-export-exclude>
            <button type="button" onClick={() => { setDraftRange(dateRange); setDateError(null); setCalendarOpen(true); }} className="grid h-9 w-9 place-items-center rounded-xl border border-white/25 bg-white/10 transition hover:bg-white/20" aria-label="Choose alert date range"><CalendarDays size={20} /></button>
            <ScreenExportMenu contentRef={reportRef} title={`GridVision Alerts Report ${dateRange.startDate} to ${dateRange.endDate}`} />
          </div>
        </div>

        {/* =================================================
            FILTER TABS
        ================================================== */}

        <div
          className="gv-alerts-filters"
          data-export-exclude
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
              aria-pressed={filter === filterItem}
              onClick={() => { setFilter(filterItem); onFilterChange?.(filterItem); }}
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
        </DesktopPageContainer>
      </div>

      {/* =====================================================
          BODY
      ====================================================== */}

      <div
        className="gv-alerts-body"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          paddingBottom: 100,
        }}
      >
        <DesktopPageContainer width="wide">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800" data-pdf-section="filters">
          <span data-pdf-filter-label="Date range" data-pdf-filter-value={rangeLabel}>Period: {rangeLabel}</span>
          <span data-pdf-filter-label="Severity" data-pdf-filter-value={filter}>Severity: {filter === 'ALL' ? 'All alerts' : filter}</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500"><span className={`h-2 w-2 rounded-full ${freshness === 'LIVE' ? 'bg-emerald-500' : freshness === 'RECENT_CACHE' ? 'bg-amber-500' : 'bg-red-500'}`} />{freshnessLabel}</div>
        {!online && pending > 0 ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">Local pending entries have not yet been evaluated by the server and are not included in these alerts.</p> : null}
        <div className="gv-alerts-layout">
        <div>
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

        {!loading && error && items.length === 0 && (
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
          (!error || items.length > 0) &&
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
                No {filter === 'ALL' ? 'alerts' : filter.toLowerCase() + ' alerts'} for {rangeLabel}.
              </p>
            </div>
          )}

        {/* =================================================
            ALERT CARDS
        ================================================== */}

        {!loading &&
          (!error || items.length > 0) &&
          filtered.length > 0 && (
            <div
              className="gv-alert-list"
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
                    className="gv-alert-card"
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

                        {a.source === 'Interruption' && (
                          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
                            <p className="m-0 text-xs font-extrabold text-blue-950">{a.station}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-blue-800">
                              <span>{new Date(a.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                              <span>{a.status === 'Open' ? 'Open for' : 'Duration'}: {a.duration}</span>
                            </div>
                          </div>
                        )}

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

                        {a.source === 'Interruption' && (
                          <p className="mt-1.5 text-xs font-medium text-slate-500">Cause: {a.cause}</p>
                        )}

                        <p className="gv-alerts-desktop-detail" style={{ margin: "7px 0 0", color: "#475569", fontSize: 11, fontWeight: 700 }}>
                          {a.source} · {a.status}
                        </p>

                        {a.notificationClass && (
                          <span
                            className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600"
                            aria-label={`Notification classification: ${NOTIFICATION_CLASS_LABELS[a.notificationClass]}`}
                          >
                            {NOTIFICATION_CLASS_LABELS[a.notificationClass]}
                          </span>
                        )}

                        {/* Station + time */}

                        {a.source === 'Parameter alert' && <div
                          className="gv-alert-meta"
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
                            {a.station}{a.feeder ? ` · ${a.feeder}` : ''}
                          </span>

                          <span>
                            {new Date(
                              a.time
                            ).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                          </span>
                        </div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="gv-alerts-summary" aria-label="Alert summary">
          <div className="sticky top-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900">Current alert status</h3>
            <p className="mt-1 text-xs text-slate-500">Derived from the alerts currently loaded</p>
            {loading ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-xs font-semibold text-slate-500">Loading alert status…</p> : error ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-center text-xs font-semibold text-red-700">Alert status is unavailable.</p> : alertSummary.active === 0 ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-center"><Info className="mx-auto h-6 w-6 text-emerald-600" /><p className="mt-2 text-sm font-bold text-emerald-800">No active alerts</p><p className="mt-1 text-xs text-emerald-700">No interruption or parameter condition requires attention.</p></div> : <div className="mt-4 space-y-2">
              <AlertSummaryMetric label="Active alerts" value={alertSummary.active} tone="red" />
              <AlertSummaryMetric label="Critical / open" value={alertSummary.critical} tone="red" />
              <AlertSummaryMetric label="Warnings" value={alertSummary.warnings} tone="amber" />
              <AlertSummaryMetric label="Affected stations" value={alertSummary.affectedStations} tone="blue" />
            </div>}
            {!loading && !error && alertSummary.restored > 0 && <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">{alertSummary.restored} restored interruption record{alertSummary.restored === 1 ? '' : 's'} in this view</p>}
          </div>
        </aside>
        </div>
        </DesktopPageContainer>
      </div>
      {calendarOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="presentation" data-export-exclude onMouseDown={(event) => { if (event.currentTarget === event.target) setCalendarOpen(false); }}>
        <div className="w-full max-w-md rounded-2xl bg-white p-5 text-slate-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="alert-date-range-title">
          <div className="flex items-start justify-between gap-4"><div><h2 id="alert-date-range-title" className="text-lg font-extrabold">Alert date range</h2><p className="mt-1 text-xs text-slate-500">Choose up to one year. Dates use India Standard Time.</p></div><CalendarDays className="h-5 w-5 text-blue-700" /></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Start date<input type="date" value={draftRange.startDate} max={draftRange.endDate || undefined} onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))} className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label><label className="text-xs font-bold text-slate-600">End date<input type="date" value={draftRange.endDate} min={draftRange.startDate || undefined} onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))} className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label></div>
          {dateError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{dateError}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { const today = todayInIst(); setDraftRange({ startDate: today, endDate: today }); setDateRange({ startDate: today, endDate: today }); setDateError(null); setCalendarOpen(false); }} className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">Today</button><button type="button" onClick={() => { setDraftRange(dateRange); setDateError(null); setCalendarOpen(false); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button><button type="button" onClick={applyDateRange} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">Apply</button></div>
        </div>
      </div>}
    </div>
  );
}

function AlertSummaryMetric({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "blue" }) {
  const toneClass = tone === "red" ? "bg-red-50 text-red-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700";
  return <div className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${toneClass}`}><span className="text-xs font-semibold">{label}</span><span className="text-base font-extrabold">{value}</span></div>;
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
