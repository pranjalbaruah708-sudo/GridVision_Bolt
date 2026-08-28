// Decoupled API service.
//
// All database interactions go through this module.
//
// Read path:
// localStorage cache first when offline,
// otherwise network then cache.
//
// Write path:
// network when online;
// offline writes are queued and flushed later.

import {
  REST_HEADERS,
  REST_URL,
  supabase,
} from './supabase';

import {
  clearCache,
  dequeueOp,
  enqueueOp,
  getQueue,
  isOnline,
  readCache,
  writeCache,
  type QueuedOp,
} from './offline';

import type {
  Feeder,
  Interruption,
  LogBookEntry,
  NewLogBookEntry,
  NewOverloadAlert,
  NewReliabilityIndex,
  OverloadAlert,
  PeakLoadReading,
  PushToken,
  ReliabilityIndex,
  Station,
} from '@/types';

/* =========================================================
   APPLICATION ROLE
========================================================= */

export type AppRole =
  | 'OPERATOR'
  | 'FIELD_OFFICER'
  | 'ADMIN';

type LoadEnergyAnalysisReading = {
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

export type LogBookReportSummary = {
  entered_readings: number;
  expected_readings: number;
  completeness_percent: number;
  feeders_reported: number;
  missing_feeder_hours: number;
};

export type LogBookReportPage = {
  rows: LogBookEntry[];
  total: number;
};

export type InterruptionReportSummary = {
  total_interruptions: number;
  open_interruptions: number;
  total_duration_minutes: number;
  average_restoration_minutes: number | null;
  longest_interruption_minutes: number | null;
};

export type InterruptionReportTrendRow = {
  date: string;
  interruption_count: number;
  duration_minutes: number;
  open_count: number;
};

export type InterruptionReportBreakdownRow = {
  label: string;
  interruption_count: number;
  duration_minutes: number;
};

export type InterruptionReportPage = {
  rows: Interruption[];
  total: number;
};

export type LoadEnergyReportSummary = {
  peak_mw: number | null;
  peak_time: string | null;
  minimum_mw: number | null;
  minimum_time: string | null;
  average_mw: number | null;
  estimated_energy_mwh: number | null;
  energy_eligible: boolean;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadEnergyReportSeriesRow = {
  bucket_start: string;
  peak_mw: number | null;
  minimum_mw: number | null;
  average_mw: number | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessReportSummary = {
  expected_feeder_hours: number;
  entered_feeder_hours: number;
  completeness_percent: number;
  stations_below_threshold: number;
  feeders_below_threshold: number;
};

export type DataCompletenessReportBreakdownRow = {
  id: string;
  name: string;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessReportTrendRow = {
  date: string;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessMissingRow = {
  date: string;
  hour: number;
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  status: 'MISSING';
};

export type DataCompletenessMissingPage = {
  rows: DataCompletenessMissingRow[];
  total: number;
};

export type ParameterExceptionReportSummary = {
  total_exceptions: number;
  active_exceptions: number;
  affected_stations: number;
  affected_feeders: number;
  most_frequent_parameter: string | null;
};

export type ParameterExceptionBreakdownRow = {
  parameter_code: string;
  exception_count: number;
  affected_feeders: number;
};

export type ParameterExceptionDetailRow = {
  id: string;
  triggered_at: string;
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  parameter_code: string;
  actual_value: number;
  min_value: number | null;
  max_value: number | null;
  breach_type: 'BELOW_MIN' | 'ABOVE_MAX';
  deviation: number;
  status: 'ACTIVE';
};

export type ParameterExceptionDetailPage = {
  rows: ParameterExceptionDetailRow[];
  total: number;
};

export type PerformanceReportMetric = 'PEAK_MW' | 'AVERAGE_MW' | 'MIN_PF' | 'INTERRUPTIONS' | 'EXCEPTIONS' | 'COMPLETENESS';
export type PerformanceReportEntity = 'STATION' | 'FEEDER';
export type PerformanceReportSummary = {
  entity_count: number; peak_mw: number | null; average_mw: number | null; minimum_power_factor: number | null;
  interruption_count: number; interruption_duration_minutes: number; exception_count: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number; feeders_reporting: number;
};
export type PerformanceReportRow = {
  entity_id: string; entity_name: string; peak_mw: number | null; average_mw: number | null; minimum_power_factor: number | null;
  interruption_count: number; interruption_duration_minutes: number; exception_count: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number; feeders_reporting: number;
};
export type PerformanceReportPage = { rows: PerformanceReportRow[]; total: number };
export type PerformanceReportRankingRow = { entity_id: string; entity_name: string; metric_value: number | null };

export type ExecutiveSummaryReport = {
  peak_mw: number | null; peak_time: string | null; average_mw: number | null;
  open_interruptions: number; total_interruptions: number; total_interruption_duration_minutes: number;
  active_parameter_exceptions: number; total_parameter_exceptions: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number;
  stations_reporting: number; total_stations: number; feeders_reporting: number; total_feeders: number;
};
export type ExecutiveSummaryAttentionRow = {
  id: string; entity_type: 'STATION' | 'FEEDER'; entity_name: string; issue_type: 'OPEN_INTERRUPTION' | 'PARAMETER_EXCEPTION' | 'LOW_COMPLETENESS';
  issue_count: number; completeness_percent: number | null;
};

export type OperatorActivityReportSummary = { entries_created: number; rows_subsequently_updated: number; missing_expected_entries: number; operators_active: number; stations_active: number };
export type OperatorActivityReportRow = { id: string; operator_id: string | null; station_name: string; feeder_name: string | null; actual_event_time: string; created_at: string; updated_at: string; activity_state: 'CREATED' | 'UPDATED' };
export type OperatorActivityReportPage = { rows: OperatorActivityReportRow[]; total: number };
export type NotificationDeliveryReportSummary = { events: number; intended_recipients: number; sent: number; failed: number; pending: number };
export type NotificationDeliveryReportRow = { id: string; event_time: string; source: string; station_name: string; intended_recipients: number; sent: number; failed: number; pending: number; delivery_message: string | null };
export type NotificationDeliveryReportPage = { rows: NotificationDeliveryReportRow[]; total: number };

function mapCompletenessStatus(value: unknown): 'FULL' | 'PARTIAL' | 'EMPTY' {
  return value === 'FULL' || value === 'PARTIAL' ? value : 'EMPTY';
}

function mapDataCompletenessBreakdown(rows: Record<string, unknown>[]): DataCompletenessReportBreakdownRow[] {
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name ?? 'Not recorded'),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0), fill_status: mapCompletenessStatus(row.fill_status),
  }));
}

function mapPerformanceReportRow(row: Record<string, unknown>): PerformanceReportRow {
  return {
    entity_id: String(row.entity_id), entity_name: String(row.entity_name),
    peak_mw: row.peak_mw === null || row.peak_mw === undefined ? null : Number(row.peak_mw),
    average_mw: row.average_mw === null || row.average_mw === undefined ? null : Number(row.average_mw),
    minimum_power_factor: row.minimum_power_factor === null || row.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor),
    interruption_count: Number(row.interruption_count ?? 0), interruption_duration_minutes: Number(row.interruption_duration_minutes ?? 0),
    exception_count: Number(row.exception_count ?? 0), entered_feeder_hours: Number(row.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row.expected_feeder_hours ?? 0), completeness_percent: Number(row.completeness_percent ?? 0), feeders_reporting: Number(row.feeders_reporting ?? 0),
  };
}

/* =========================================================
   INTERRUPTION TYPES
========================================================= */

export type InterruptionStatus =
  | 'OPEN'
  | 'RESTORED'
  | 'CANCELLED';

export type NewInterruptionPayload = {
  station_id: string;
  feeder_id: string;
  operator_id: string | null;

  interruption_start: string;
  interruption_end?: string | null;

  cause?: string | null;
  remarks?: string | null;

  current_status?:
    | 'OPEN'
    | 'RESTORED'
    | 'CANCELLED';

  duration_minutes?: number | null;
  etr?: string | null;
};

/* =========================================================
   RPC RESULT TYPES
========================================================= */

type MonthStatusRpcRow = {
  entry_date: string;

  entered_slots:
    number | string;

  expected_slots:
    number | string;

  fill_status:
    string;
};

type HourStatusRpcRow = {
  hour_no:
    number | string;

  entered_feeders:
    number | string;

  total_feeders:
    number | string;

  fill_status:
    string;
};

/* =========================================================
   LOAD TREND TYPE
========================================================= */

export type StationLoadTrendRow = {
  station_id: string;

  feeder_id:
    string | null;

  actual_event_time:
    string;

  mw:
    number | null;
};

export type LoadAnalysisDailyTrendRow = {
  trend_date: string;

  peak_time:
    string | null;

  peak_mw:
    number | null;

  entered_feeders:
    number;

  expected_feeders:
    number;

  fill_status:
    "FULL" |
    "PARTIAL" |
    "EMPTY";
};

export type LoadAnalysisOverviewRow = {
  peak_mw: number | null;
  peak_time: string | null;
  minimum_voltage_kv: number | null;
  minimum_voltage_time: string | null;
  maximum_current_a: number | null;
  maximum_current_time: string | null;
  minimum_power_factor: number | null;
  minimum_power_factor_time: string | null;
  maximum_transformer_temp_c: number | null;
  maximum_transformer_temp_time: string | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadAnalysisRankingRow = {
  id: string;
  name: string;
  peak_mw: number | null;
  minimum_power_factor: number | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadAnalysisParameterHealthRow = {
  low_pf_feeder_count: number;
  incomplete_feeder_count: number;
  minimum_voltage_kv: number | null;
  maximum_current_a: number | null;
  maximum_transformer_temp_c: number | null;
  completeness_percent: number;
};

export type LoadAnalysisFeederDailyProfileRow = {
  profile_date: string;
  value: number;
  source_time: string;
};

export type ParameterHealthDetailMetric =
  | 'LOW_PF'
  | 'INCOMPLETE_LOGBOOK'
  | 'MIN_VOLTAGE'
  | 'MAX_CURRENT'
  | 'MAX_TRANSFORMER_TEMP';

export type LoadAnalysisParameterHealthDetailRow = {
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  metric_value: number | null;
  occurred_at: string | null;
  entered_hours: number | null;
  expected_hours: number | null;
  missing_hours: number | null;
  completeness_percent: number | null;
};

export type DashboardOperationalSummary = {
  peak_mw: number | null;
  peak_time: string | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  stations_reporting: number;
  total_stations: number;
  feeders_reporting: number;
  total_feeders: number;
  open_interruptions: number;
  interruption_stations: number;
  active_parameter_alerts: number;
  alert_feeders: number;
};

export type DashboardTodayLoadTrendRow = {
  hour_no: number;
  hour_time: string;
  total_mw: number | null;
  entered_feeders: number;
  expected_feeders: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY' | 'FUTURE';
};

export type DashboardAttentionItem = {
  issue_type: 'INTERRUPTION' | 'PARAMETER_ALERT' | 'COMPLETENESS';
  station_id: string;
  station_name: string;
  issue_count: number;
  completeness_percent: number | null;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
};

/* =========================================================
   LOW LEVEL HELPERS
========================================================= */

async function getAuthHeaders() {
  const {
    data: {
      session,
    },
  } =
    await supabase.auth.getSession();

  return {
    ...REST_HEADERS,

    ...(session?.access_token
      ? {
          Authorization:
            `Bearer ${session.access_token}`,
        }
      : {}),
  };
}

/* =========================================================
   REST GET
========================================================= */

async function restGet<T>(
  table: string,
  query: string,
  cacheKey: string
): Promise<T[]> {
  if (
    !isOnline()
  ) {
    const cached =
      readCache<T[]>(
        cacheKey
      );

    if (
      cached
    ) {
      return cached;
    }
  }

  const url =
    `${REST_URL}/${table}?${query}`;

  const headers =
    await getAuthHeaders();

  const res =
    await fetch(
      url,
      {
        headers,
        method:
          'GET',
      }
    );

  if (
    !res.ok
  ) {
    const errorText =
      await res.text();

    throw new Error(
      `GET ${table} failed: ${res.status} ${errorText}`
    );
  }

  const data =
    (await res.json()) as T[];

  writeCache(
    cacheKey,
    data
  );

  return data;
}

/* =========================================================
   REST PATCH
========================================================= */

async function restPatch<T>(
  table: string,
  filter:
    Record<
      string,
      string
    >,
  body: unknown,
  cacheKey: string
): Promise<T> {
  if (
    !isOnline()
  ) {
    enqueueOp({
      method:
        'PATCH',

      table,

      filter,

      body,
    });

    return body as T;
  }

  const qs =
    Object.entries(
      filter
    )
      .map(
        ([
          key,
          value,
        ]) =>
          `${key}=eq.${encodeURIComponent(
            value
          )}`
      )
      .join(
        '&'
      );

  const headers =
    await getAuthHeaders();

  const url =
    `${REST_URL}/${table}?${qs}`;

  const res =
    await fetch(
      url,
      {
        method:
          'PATCH',

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (
    !res.ok
  ) {
    const errorText =
      await res.text();

    throw new Error(
      `PATCH ${table} failed: ${res.status} ${errorText}`
    );
  }

  const rows =
    (await res.json()) as T[];

  /*
   * Supabase may return HTTP 200 with []
   * when RLS prevents the row from being updated.
   */

  if (
    !Array.isArray(
      rows
    ) ||
    rows.length ===
      0
  ) {
    throw new Error(
      `PATCH ${table} succeeded but no row was updated. ` +
      `Check the UPDATE RLS policy and record ID.`
    );
  }

  clearCache(
    cacheKey
  );

  return rows[0];
}

/* =========================================================
   REST POST
========================================================= */

async function restPost<T>(
  table: string,
  body: unknown,
  cacheKey: string
): Promise<T> {
  if (
    !isOnline()
  ) {
    enqueueOp({
      method:
        'POST',

      table,

      body,
    });

    return body as T;
  }

  const headers =
    await getAuthHeaders();

  const res =
    await fetch(
      `${REST_URL}/${table}`,
      {
        method:
          'POST',

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (
    !res.ok
  ) {
    const errorText =
      await res.text();

    throw new Error(
      `POST ${table} failed: ${res.status} ${errorText}`
    );
  }

  const arr =
    (await res.json()) as T[];

  if (
    !Array.isArray(
      arr
    ) ||
    arr.length ===
      0
  ) {
    throw new Error(
      `POST ${table} succeeded but no row was returned.`
    );
  }

  clearCache(
    cacheKey
  );

  return arr[0];
}

/* =========================================================
   PUBLIC API
========================================================= */

export const api = {


  /* =======================================================
     CURRENT USER ROLE
  ======================================================= */

  async getMyRole():
    Promise<
      AppRole | null
    > {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_my_role'
      );

    if (
      error
    ) {
      console.error(
        'Failed to get current user role:',
        error
      );

      throw error;
    }

    if (
      data ===
        'OPERATOR' ||
      data ===
        'FIELD_OFFICER' ||
      data ===
        'ADMIN'
    ) {
      return data;
    }

    return null;
  },


async getLoadEnergyReadings(
  startIso: string,
  endIso: string,
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyAnalysisReading[]> {
  const pageSize = 1000;
  const rows: LoadEnergyAnalysisReading[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("log_book_entries")
      .select(`
        id,
        station_id,
        feeder_id,
        operator_id,
        actual_event_time,
        mw,
        mvar,
        voltage_kv,
        current_a,
        power_factor,
        frequency_hz,
        transformer_temp_c,
        oil_level_percent,
        tap_position,
        weather,
        remarks,
        updated_at
      `)
      .not("feeder_id", "is", null)
      .gte("actual_event_time", startIso)
      .lt("actual_event_time", endIso)
      .order("actual_event_time", { ascending: true })
      .order("updated_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (stationId) {
      query = query.eq("station_id", stationId);
    }

    if (feederId) {
      query = query.eq("feeder_id", feederId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        "Failed to load Load/Energy analysis readings:",
        error
      );
      throw error;
    }

    const page =
      (data ?? []) as LoadEnergyAnalysisReading[];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows.map(
    (row) => ({
      id:
        row.id,

      station_id:
        row.station_id,

      feeder_id:
        row.feeder_id,

      operator_id:
        row.operator_id,

      actual_event_time:
        row.actual_event_time,

      mw:
        row.mw === null
          ? null
          : Number(row.mw),

      mvar:
        row.mvar === null
          ? null
          : Number(row.mvar),

      voltage_kv:
        row.voltage_kv === null
          ? null
          : Number(row.voltage_kv),

      current_a:
        row.current_a === null
          ? null
          : Number(row.current_a),

      power_factor:
        row.power_factor === null
          ? null
          : Number(row.power_factor),

      frequency_hz:
        row.frequency_hz === null
          ? null
          : Number(row.frequency_hz),

      transformer_temp_c:
        row.transformer_temp_c === null
          ? null
          : Number(row.transformer_temp_c),

      oil_level_percent:
        row.oil_level_percent === null
          ? null
          : Number(row.oil_level_percent),

      tap_position:
        row.tap_position === null
          ? null
          : Number(row.tap_position),

      weather:
        row.weather,

      remarks:
        row.remarks,

      updated_at:
        row.updated_at,
    })
  );
},

async getLoadAnalysisFeederDayReadings(
  feederId: string,
  startIso: string,
  endIso: string
): Promise<LoadEnergyAnalysisReading[]> {
  return this.getLoadEnergyReadings(
    startIso,
    endIso,
    null,
    feederId
  );
},

async getLoadAnalysisFeederDailyProfile(
  feederId: string,
  startIso: string,
  endIso: string,
  parameterCode: 'MW' | 'MVAR' | 'VOLTAGE' | 'CURRENT' | 'PF'
): Promise<LoadAnalysisFeederDailyProfileRow[]> {
  const { data, error } = await supabase.rpc(
    'get_load_analysis_feeder_daily_profile',
    {
      p_feeder_id: feederId,
      p_start: startIso,
      p_end: endIso,
      p_parameter_code: parameterCode,
    }
  );

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    profile_date: String(row.profile_date),
    value: Number(row.value),
    source_time: String(row.source_time),
  }));
},

  /* =======================================================
     OPERATIONAL DASHBOARD

     These RPCs intentionally return compact, server-aggregated data for the
     utility-wide Today dashboard. The database function enforces accessible
     station scope; callers do not pass a station identifier.
  ======================================================= */

  async getDashboardOperationalSummary(
    startIso: string,
    endIso: string
  ): Promise<DashboardOperationalSummary> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_operational_summary',
      { p_start: startIso, p_end: endIso }
    );

    if (error) throw error;

    const row = data?.[0];
    return {
      peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
      peak_time: row?.peak_time ?? null,
      entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
      expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
      completeness_percent: Number(row?.completeness_percent ?? 0),
      stations_reporting: Number(row?.stations_reporting ?? 0),
      total_stations: Number(row?.total_stations ?? 0),
      feeders_reporting: Number(row?.feeders_reporting ?? 0),
      total_feeders: Number(row?.total_feeders ?? 0),
      open_interruptions: Number(row?.open_interruptions ?? 0),
      interruption_stations: Number(row?.interruption_stations ?? 0),
      active_parameter_alerts: Number(row?.active_parameter_alerts ?? 0),
      alert_feeders: Number(row?.alert_feeders ?? 0),
    };
  },

  async getDashboardTodayLoadTrend(
    startIso: string,
    endIso: string
  ): Promise<DashboardTodayLoadTrendRow[]> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_today_load_trend',
      { p_start: startIso, p_end: endIso }
    );

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
      hour_no: Number(row.hour_no ?? 0),
      hour_time: String(row.hour_time ?? ''),
      total_mw: row.total_mw === null || row.total_mw === undefined ? null : Number(row.total_mw),
      entered_feeders: Number(row.entered_feeders ?? 0),
      expected_feeders: Number(row.expected_feeders ?? 0),
      fill_status: row.fill_status === 'FULL' || row.fill_status === 'PARTIAL' || row.fill_status === 'EMPTY' || row.fill_status === 'FUTURE'
        ? row.fill_status
        : 'EMPTY',
    }));
  },

  async getDashboardAttentionItems(
    startIso: string,
    endIso: string,
    limit = 5
  ): Promise<DashboardAttentionItem[]> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_attention_items',
      { p_start: startIso, p_end: endIso, p_limit: limit }
    );

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
      issue_type: row.issue_type === 'INTERRUPTION' || row.issue_type === 'PARAMETER_ALERT' || row.issue_type === 'COMPLETENESS'
        ? row.issue_type
        : 'COMPLETENESS',
      station_id: String(row.station_id),
      station_name: String(row.station_name ?? 'Station'),
      issue_count: Number(row.issue_count ?? 0),
      completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined
        ? null
        : Number(row.completeness_percent),
      severity: row.severity === 'HIGH' || row.severity === 'MEDIUM' || row.severity === 'LOW'
        ? row.severity
        : 'LOW',
    }));
  },

/* =======================================================
   LOAD ANALYSIS DAILY TREND

   Aggregation is performed in PostgreSQL instead of
   downloading every feeder/hour record into the browser.

   stationId:
     null → all stations

   feederId:
     null → all relevant feeders
======================================================= */

async getLoadAnalysisOverview(startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null): Promise<LoadAnalysisOverviewRow> {
  const { data, error } = await supabase.rpc('get_load_analysis_overview', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw), peak_time: row?.peak_time ?? null,
    minimum_voltage_kv: row?.minimum_voltage_kv === null || row?.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv), minimum_voltage_time: row?.minimum_voltage_time ?? null,
    maximum_current_a: row?.maximum_current_a === null || row?.maximum_current_a === undefined ? null : Number(row.maximum_current_a), maximum_current_time: row?.maximum_current_time ?? null,
    minimum_power_factor: row?.minimum_power_factor === null || row?.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor), minimum_power_factor_time: row?.minimum_power_factor_time ?? null,
    maximum_transformer_temp_c: row?.maximum_transformer_temp_c === null || row?.maximum_transformer_temp_c === undefined ? null : Number(row.maximum_transformer_temp_c), maximum_transformer_temp_time: row?.maximum_transformer_temp_time ?? null,
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), completeness_percent: Number(row?.completeness_percent ?? 0),
  };
},

async getLoadAnalysisRanking(startIso: string, endIso: string, stationId: string | null = null): Promise<LoadAnalysisRankingRow[]> {
  const { data, error } = stationId
    ? await supabase.rpc('get_load_analysis_feeder_ranking', { p_start: startIso, p_end: endIso, p_station_id: stationId })
    : await supabase.rpc('get_load_analysis_station_ranking', { p_start: startIso, p_end: endIso });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.feeder_id ?? row.station_id), name: String(row.feeder_name ?? row.station_name),
    peak_mw: row.peak_mw === null ? null : Number(row.peak_mw), minimum_power_factor: row.minimum_power_factor === null ? null : Number(row.minimum_power_factor),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0), completeness_percent: Number(row.completeness_percent ?? 0),
  }));
},

async getLoadAnalysisParameterHealth(startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null): Promise<LoadAnalysisParameterHealthRow> {
  const { data, error } = await supabase.rpc('get_load_analysis_parameter_health', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId });
  if (error) throw error;
  const row = data?.[0];
  return { low_pf_feeder_count: Number(row?.low_pf_feeder_count ?? 0), incomplete_feeder_count: Number(row?.incomplete_feeder_count ?? 0), minimum_voltage_kv: row?.minimum_voltage_kv === null || row?.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv), maximum_current_a: row?.maximum_current_a === null || row?.maximum_current_a === undefined ? null : Number(row.maximum_current_a), maximum_transformer_temp_c: row?.maximum_transformer_temp_c === null || row?.maximum_transformer_temp_c === undefined ? null : Number(row.maximum_transformer_temp_c), completeness_percent: Number(row?.completeness_percent ?? 0) };
},

async getLoadAnalysisParameterHealthDetails(
  startIso: string,
  endIso: string,
  metric: ParameterHealthDetailMetric,
  stationId: string | null = null,
  feederId: string | null = null,
  limit = 50
): Promise<LoadAnalysisParameterHealthDetailRow[]> {
  const { data, error } = await supabase.rpc(
    'get_load_analysis_parameter_health_details',
    {
      p_start: startIso,
      p_end: endIso,
      p_station_id: stationId,
      p_feeder_id: feederId,
      p_metric: metric,
      p_limit: limit,
    }
  );
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    station_id: String(row.station_id),
    station_name: String(row.station_name ?? 'Station'),
    feeder_id: String(row.feeder_id),
    feeder_name: String(row.feeder_name ?? 'Feeder'),
    metric_value: row.metric_value === null || row.metric_value === undefined ? null : Number(row.metric_value),
    occurred_at: row.occurred_at === null || row.occurred_at === undefined ? null : String(row.occurred_at),
    entered_hours: row.entered_hours === null || row.entered_hours === undefined ? null : Number(row.entered_hours),
    expected_hours: row.expected_hours === null || row.expected_hours === undefined ? null : Number(row.expected_hours),
    missing_hours: row.missing_hours === null || row.missing_hours === undefined ? null : Number(row.missing_hours),
    completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined ? null : Number(row.completeness_percent),
  }));
},

async getLoadAnalysisDailyTrend(
  startIso: string,
  endIso: string,
  stationId:
    string | null = null,
  feederId:
    string | null = null
): Promise<
  LoadAnalysisDailyTrendRow[]
> {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "get_load_analysis_daily_trend",
      {
        p_start:
          startIso,

        p_end:
          endIso,

        p_station_id:
          stationId,

        p_feeder_id:
          feederId,
      }
    );

  if (error) {
    console.error(
      "Failed to load daily load-analysis trend:",
      error
    );

    throw error;
  }

  return (
    data ?? []
  ).map(
    (
      row: {
        trend_date:
          string;

        peak_time:
          string | null;

        peak_mw:
          number | string | null;

        entered_feeders:
          number | string;

        expected_feeders:
          number | string;

        fill_status:
          string;
      }
    ) => ({
      trend_date:
        row.trend_date,

      peak_time:
        row.peak_time,

      peak_mw:
        row.peak_mw ===
        null
          ? null
          : Number(
              row.peak_mw
            ),

      entered_feeders:
        Number(
          row.entered_feeders
        ),

      expected_feeders:
        Number(
          row.expected_feeders
        ),

      fill_status:
        row.fill_status ===
        "FULL"
          ? "FULL"
          : row.fill_status ===
              "EMPTY"
            ? "EMPTY"
            : "PARTIAL",
    })
  );
},

async getLoadEnergyReportSummary(
  startIso: string,
  endIso: string,
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyReportSummary> {
  const { data, error } = await supabase.rpc('get_load_energy_report_summary', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
    peak_time: row?.peak_time ?? null,
    minimum_mw: row?.minimum_mw === null || row?.minimum_mw === undefined ? null : Number(row.minimum_mw),
    minimum_time: row?.minimum_time ?? null,
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    estimated_energy_mwh: row?.estimated_energy_mwh === null || row?.estimated_energy_mwh === undefined ? null : Number(row.estimated_energy_mwh),
    energy_eligible: Boolean(row?.energy_eligible),
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0),
  };
},

async getLoadEnergyReportSeries(
  startIso: string,
  endIso: string,
  interval: 'HOURLY' | 'DAILY',
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyReportSeriesRow[]> {
  const { data, error } = await supabase.rpc('get_load_energy_report_series', {
    p_start: startIso, p_end: endIso, p_interval: interval, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    bucket_start: String(row.bucket_start),
    peak_mw: row.peak_mw === null || row.peak_mw === undefined ? null : Number(row.peak_mw),
    minimum_mw: row.minimum_mw === null || row.minimum_mw === undefined ? null : Number(row.minimum_mw),
    average_mw: row.average_mw === null || row.average_mw === undefined ? null : Number(row.average_mw),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0),
    fill_status: row.fill_status === 'FULL' || row.fill_status === 'PARTIAL' ? row.fill_status : 'EMPTY',
  }));
},

async getDataCompletenessReportSummary(
  startIso: string, endIso: string, threshold: number,
  stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportSummary> {
  const { data, error } = await supabase.rpc('get_data_completeness_report_summary', {
    p_start: startIso, p_end: endIso, p_threshold: threshold, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0), stations_below_threshold: Number(row?.stations_below_threshold ?? 0),
    feeders_below_threshold: Number(row?.feeders_below_threshold ?? 0),
  };
},

async getDataCompletenessStationBreakdown(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_station_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return mapDataCompletenessBreakdown(data ?? []);
},

async getDataCompletenessFeederBreakdown(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_feeder_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return mapDataCompletenessBreakdown(data ?? []);
},

async getDataCompletenessReportTrend(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportTrendRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_report_trend', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    date: String(row.date), entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0), fill_status: mapCompletenessStatus(row.fill_status),
  }));
},

async getDataCompletenessMissingPage(
  startIso: string, endIso: string, page: number, pageSize: number,
  stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessMissingPage> {
  const { data, error } = await supabase.rpc('get_data_completeness_missing_slots', {
    p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    date: String(row.date), hour: Number(row.hour), station_id: String(row.station_id), station_name: String(row.station_name),
    feeder_id: String(row.feeder_id), feeder_name: String(row.feeder_name), status: 'MISSING' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getParameterExceptionReportSummary(
  startIso: string, endIso: string, stationId: string | null = null,
  feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionReportSummary> {
  const { data, error } = await supabase.rpc('get_parameter_exception_report_summary', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    total_exceptions: Number(row?.total_exceptions ?? 0), active_exceptions: Number(row?.active_exceptions ?? 0),
    affected_stations: Number(row?.affected_stations ?? 0), affected_feeders: Number(row?.affected_feeders ?? 0),
    most_frequent_parameter: row?.most_frequent_parameter ?? null,
  };
},

async getParameterExceptionBreakdown(
  startIso: string, endIso: string, stationId: string | null = null,
  feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_parameter_exception_report_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    parameter_code: String(row.parameter_code), exception_count: Number(row.exception_count ?? 0), affected_feeders: Number(row.affected_feeders ?? 0),
  }));
},

async getParameterExceptionParameters(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_parameter_exception_parameters');
  if (error) throw error;
  return (data ?? []).map((row: { parameter_code: string | null }) => row.parameter_code).filter((value: string | null): value is string => Boolean(value));
},

async getParameterExceptionDetailPage(
  startIso: string, endIso: string, page: number, pageSize: number,
  stationId: string | null = null, feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionDetailPage> {
  const { data, error } = await supabase.rpc('get_parameter_exception_detail_page', {
    p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize,
    p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), triggered_at: String(row.triggered_at), station_id: String(row.station_id), station_name: String(row.station_name),
    feeder_id: String(row.feeder_id), feeder_name: String(row.feeder_name), parameter_code: String(row.parameter_code), actual_value: Number(row.actual_value),
    min_value: row.min_value === null || row.min_value === undefined ? null : Number(row.min_value),
    max_value: row.max_value === null || row.max_value === undefined ? null : Number(row.max_value),
    breach_type: row.breach_type === 'BELOW_MIN' ? 'BELOW_MIN' as const : 'ABOVE_MAX' as const,
    deviation: Number(row.deviation ?? 0), status: 'ACTIVE' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getPerformanceReportSummary(
  startIso: string, endIso: string, entity: PerformanceReportEntity,
  stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportSummary> {
  const { data, error } = await supabase.rpc('get_performance_report_summary', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    entity_count: Number(row?.entity_count ?? 0), peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    minimum_power_factor: row?.minimum_power_factor === null || row?.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor),
    interruption_count: Number(row?.interruption_count ?? 0), interruption_duration_minutes: Number(row?.interruption_duration_minutes ?? 0),
    exception_count: Number(row?.exception_count ?? 0), entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0), feeders_reporting: Number(row?.feeders_reporting ?? 0),
  };
},

async getPerformanceReportPage(
  startIso: string, endIso: string, entity: PerformanceReportEntity, metric: PerformanceReportMetric,
  page: number, pageSize: number, stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportPage> {
  const { data, error } = await supabase.rpc('get_performance_report_page', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_metric: metric, p_page: page, p_page_size: pageSize,
    p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => mapPerformanceReportRow(row));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getPerformanceReportRanking(
  startIso: string, endIso: string, entity: PerformanceReportEntity, metric: PerformanceReportMetric,
  stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportRankingRow[]> {
  const { data, error } = await supabase.rpc('get_performance_report_ranking', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_metric: metric, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    entity_id: String(row.entity_id), entity_name: String(row.entity_name), metric_value: row.metric_value === null || row.metric_value === undefined ? null : Number(row.metric_value),
  }));
},

async getExecutiveSummaryReport(
  startIso: string, endIso: string, stationId: string | null = null
): Promise<ExecutiveSummaryReport> {
  const { data, error } = await supabase.rpc('get_executive_summary_report', {
    p_start: startIso, p_end: endIso, p_station_id: stationId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw), peak_time: row?.peak_time ?? null,
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    open_interruptions: Number(row?.open_interruptions ?? 0), total_interruptions: Number(row?.total_interruptions ?? 0), total_interruption_duration_minutes: Number(row?.total_interruption_duration_minutes ?? 0),
    active_parameter_exceptions: Number(row?.active_parameter_exceptions ?? 0), total_parameter_exceptions: Number(row?.total_parameter_exceptions ?? 0),
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), completeness_percent: Number(row?.completeness_percent ?? 0),
    stations_reporting: Number(row?.stations_reporting ?? 0), total_stations: Number(row?.total_stations ?? 0), feeders_reporting: Number(row?.feeders_reporting ?? 0), total_feeders: Number(row?.total_feeders ?? 0),
  };
},

async getExecutiveSummaryAttention(
  startIso: string, endIso: string, stationId: string | null = null
): Promise<ExecutiveSummaryAttentionRow[]> {
  const { data, error } = await supabase.rpc('get_executive_summary_attention', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_limit: 5,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), entity_type: row.entity_type === 'FEEDER' ? 'FEEDER' : 'STATION', entity_name: String(row.entity_name),
    issue_type: row.issue_type === 'PARAMETER_EXCEPTION' || row.issue_type === 'LOW_COMPLETENESS' ? row.issue_type : 'OPEN_INTERRUPTION',
    issue_count: Number(row.issue_count ?? 0), completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined ? null : Number(row.completeness_percent),
  }));
},

async getOperatorActivityReportSummary(startIso: string, endIso: string, stationId: string | null = null): Promise<OperatorActivityReportSummary> {
  const { data, error } = await supabase.rpc('get_operator_activity_report_summary', { p_start: startIso, p_end: endIso, p_station_id: stationId });
  if (error) throw error;
  const row = data?.[0];
  return { entries_created: Number(row?.entries_created ?? 0), rows_subsequently_updated: Number(row?.rows_subsequently_updated ?? 0), missing_expected_entries: Number(row?.missing_expected_entries ?? 0), operators_active: Number(row?.operators_active ?? 0), stations_active: Number(row?.stations_active ?? 0) };
},

async getOperatorActivityReportPage(startIso: string, endIso: string, page: number, pageSize: number, stationId: string | null = null): Promise<OperatorActivityReportPage> {
  const { data, error } = await supabase.rpc('get_operator_activity_report_page', { p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), operator_id: row.operator_id === null || row.operator_id === undefined ? null : String(row.operator_id), station_name: String(row.station_name), feeder_name: row.feeder_name === null || row.feeder_name === undefined ? null : String(row.feeder_name),
    actual_event_time: String(row.actual_event_time), created_at: String(row.created_at), updated_at: String(row.updated_at), activity_state: row.activity_state === 'UPDATED' ? 'UPDATED' as const : 'CREATED' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getNotificationDeliveryReportSummary(startIso: string, endIso: string, stationId: string | null = null, status: string | null = null): Promise<NotificationDeliveryReportSummary> {
  const { data, error } = await supabase.rpc('get_notification_delivery_report_summary', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_status: status });
  if (error) throw error;
  const row = data?.[0];
  return { events: Number(row?.events ?? 0), intended_recipients: Number(row?.intended_recipients ?? 0), sent: Number(row?.sent ?? 0), failed: Number(row?.failed ?? 0), pending: Number(row?.pending ?? 0) };
},

async getNotificationDeliveryReportPage(startIso: string, endIso: string, page: number, pageSize: number, stationId: string | null = null, status: string | null = null): Promise<NotificationDeliveryReportPage> {
  const { data, error } = await supabase.rpc('get_notification_delivery_report_page', { p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId, p_status: status });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), event_time: String(row.event_time), source: String(row.source), station_name: String(row.station_name), intended_recipients: Number(row.intended_recipients ?? 0), sent: Number(row.sent ?? 0), failed: Number(row.failed ?? 0), pending: Number(row.pending ?? 0), delivery_message: row.delivery_message === null || row.delivery_message === undefined ? null : String(row.delivery_message),
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

/* =======================================================
     STATION LOAD TREND

     stationId:
       UUID → one station

       null → ALL STATIONS

     The DB/RLS remains responsible for deciding
     which records the authenticated user may read.
  ======================================================= */

  async getStationLoadTrend(
    stationId:
      string | null,

    date:
      string
  ): Promise<
    StationLoadTrendRow[]
  > {
    /*
     * date format:
     *
     * YYYY-MM-DD
     *
     * Operational timezone:
     * Asia/Kolkata
     */

    const start =
      new Date(
        `${date}T00:00:00+05:30`
      );

    const end =
      new Date(
        `${date}T00:00:00+05:30`
      );

    /*
     * Add one calendar day in UTC.
     *
     * Since the start already represents
     * midnight IST as a specific instant,
     * +24 hours gives next midnight IST.
     */

    end.setTime(
      end.getTime() +
        24 *
          60 *
          60 *
          1000
    );

    let query =
      supabase
        .from(
          'log_book_entries'
        )
        .select(
  'station_id,feeder_id,actual_event_time,mw'
  )
        .gte(
          'actual_event_time',
          start.toISOString()
        )
        .lt(
          'actual_event_time',
          end.toISOString()
        )
        .order(
          'actual_event_time',
          {
            ascending:
              true,
          }
        );

    /*
     * null means ALL STATIONS.
     */

    if (
      stationId
    ) {
      query =
        query.eq(
          'station_id',
          stationId
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (
      error
    ) {
      console.error(
        'Failed to load station load trend:',
        error
      );

      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row
      ) => ({
        station_id:
          row.station_id,

        feeder_id:
          row.feeder_id,

        actual_event_time:
          row.actual_event_time,

        mw:
          row.mw ===
          null
            ? null
            : Number(
                row.mw
              ),
      })
    );
  },

  /* =======================================================
     PRIMARY OPERATOR STATION
  ======================================================= */

  async getMyPrimaryStationId():
    Promise<
      string | null
    > {
    const {
      data: {
        user,
      },

      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError
    ) {
      throw userError;
    }

    if (
      !user
    ) {
      return null;
    }

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'user_stations'
        )
        .select(
          'station_id'
        )
        .eq(
          'user_id',
          user.id
        )
        .limit(
          1
        )
        .maybeSingle();

    if (
      error
    ) {
      throw error;
    }

    return (
      data?.station_id ??
      null
    );
  },

  /* =======================================================
     ACCESSIBLE STATIONS

     Current DB function logic:

     OPERATOR
     → assigned station(s)

     FIELD_OFFICER
     → all active stations

     ADMIN
     → all active stations
  ======================================================= */

  async getMyAccessibleStationIds():
    Promise<
      string[]
    > {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_my_accessible_station_ids'
      );

    if (
      error
    ) {
      console.error(
        'Failed to load accessible stations:',
        error
      );

      throw error;
    }

    return (
      data ??
      []
    )
      .map(
        (
          row: {
            station_id:
              string;
          }
        ) =>
          row.station_id
      )
      .filter(
        Boolean
      );
  },

  /* =======================================================
     GET ONE OPERATOR LOG ENTRY
  ======================================================= */

  async getOperatorLogEntry(
    stationId:
      string,

    feederId:
      string,

    date:
      string,

    hour:
      string
  ) {
    /*
     * Explicit +05:30 avoids depending on
     * device/browser timezone.
     *
     * hour example:
     * 08:00
     */

    const start =
      new Date(
        `${date}T${hour}:00+05:30`
      );

    const end =
      new Date(
        start.getTime() +
          60 *
            60 *
            1000
      );

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'log_book_entries'
        )
        .select(
          '*'
        )
        .eq(
          'station_id',
          stationId
        )
        .eq(
          'feeder_id',
          feederId
        )
        .gte(
          'actual_event_time',
          start.toISOString()
        )
        .lt(
          'actual_event_time',
          end.toISOString()
        )
        .maybeSingle();

    if (
      error
    ) {
      throw error;
    }

    return data;
  },

  /* =======================================================
     UPDATE LOG ENTRY
  ======================================================= */

  async updateLogEntry(
    id:
      string,

    row:
      Record<
        string,
        unknown
      >
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'log_book_entries'
        )
        .update(
          row
        )
        .eq(
          'id',
          id
        )
        .select()
        .single();

    if (
      error
    ) {
      throw error;
    }

    return data;
  },

  /* =======================================================
     MONTHLY OPERATOR ENTRY STATUS
  ======================================================= */

  async getOperatorMonthEntryStatus(
    stationId:
      string,

    year:
      number,

    month:
      number
  ) {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_logbook_month_status',
        {
          p_station_id:
            stationId,

          p_year:
            year,

          p_month:
            month,
        }
      );

    if (
      error
    ) {
      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row:
          MonthStatusRpcRow
      ) => ({
        date:
          row.entry_date,

        enteredSlots:
          Number(
            row.entered_slots
          ),

        expectedSlots:
          Number(
            row.expected_slots
          ),

        status:
          row.fill_status,
      })
    );
  },

  /* =======================================================
     SINGLE STATION DAY/HOUR STATUS
  ======================================================= */

  async getOperatorDayHourStatus(
    stationId:
      string,

    date:
      string
  ) {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_logbook_day_hour_status',
        {
          p_station_id:
            stationId,

          p_date:
            date,
        }
      );

    if (
      error
    ) {
      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row:
          HourStatusRpcRow
      ) => ({
        hour:
          Number(
            row.hour_no
          ),

        entered:
          Number(
            row.entered_feeders
          ),

        total:
          Number(
            row.total_feeders
          ),

        status:
          row.fill_status,
      })
    );
  },

  /* =======================================================
     STATIONS
  ======================================================= */

  async getStations():
    Promise<
      Station[]
    > {
    return restGet<
      Station
    >(
      'stations',

      'order=name.asc',

      'stations'
    );
  },

  /* =======================================================
     FEEDERS
  ======================================================= */

  async getFeeders(
    stationId?:
      string
  ): Promise<
    Feeder[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=name.asc`
        : 'order=name.asc';

    return restGet<
      Feeder
    >(
      'feeders',

      query,

      `feeders:${
        stationId ??
        'all'
      }`
    );
  },

  /* =======================================================
     PEAK LOAD
  ======================================================= */

  async getPeakLoad(
    stationId:
      string,

    days =
      31
  ): Promise<
    PeakLoadReading[]
  > {
    const since =
      new Date(
        Date.now() -
          days *
            86400_000
      ).toISOString();

    const query =
      `station_id=eq.${encodeURIComponent(
        stationId
      )}` +
      `&recorded_at=gte.${encodeURIComponent(
        since
      )}` +
      `&order=recorded_at.asc`;

    return restGet<
      PeakLoadReading
    >(
      'peak_load_readings',

      query,

      `peak:${stationId}:${days}`
    );
  },

  async addPeakLoad(
    row:
      Omit<
        PeakLoadReading,
        'id' |
          'created_at'
      >
  ): Promise<
    PeakLoadReading
  > {
    return restPost<
      PeakLoadReading
    >(
      'peak_load_readings',

      row,

      `peak:${row.station_id}`
    );
  },

  /* =======================================================
     INTERRUPTIONS
  ======================================================= */

  async getInterruptions(
    stationId?:
      string,

    status?:
      InterruptionStatus
  ): Promise<
    Interruption[]
  > {
    const filters:
      string[] = [];

    if (
      stationId
    ) {
      filters.push(
        `station_id=eq.${encodeURIComponent(
          stationId
        )}`
      );
    }

    if (
      status
    ) {
      filters.push(
        `current_status=eq.${encodeURIComponent(
          status
        )}`
      );
    }

    filters.push(
      'order=interruption_start.desc'
    );

    const query =
      filters.join(
        '&'
      );

    return restGet<
      Interruption
    >(
      'interruptions',

      query,

      `interruptions:${
        stationId ??
        'all'
      }:${
        status ??
        'all'
      }`
    );
  },

  /* =======================================================
     CREATE INTERRUPTION
  ======================================================= */

  async addInterruption(
    row:
      NewInterruptionPayload
  ): Promise<
    Interruption
  > {
    const body = {
      ...row,

      current_status:
        row.current_status ??
        'OPEN',

      interruption_end:
        row.interruption_end ??
        null,
    };

    return restPost<
      Interruption
    >(
      'interruptions',

      body,

      'interruptions:all:all'
    );
  },

  /* =======================================================
     RESTORE INTERRUPTION
  ======================================================= */

  async restoreInterruption(
    id:
      string,

    restoreTime:
      string
  ): Promise<
    Interruption
  > {
    return restPatch<
      Interruption
    >(
      'interruptions',

      {
        id,
      },

      {
        interruption_end:
          restoreTime,

        current_status:
          'RESTORED',
      },

      'interruptions:all:all'
    );
  },

  /* =======================================================
     CANCEL INTERRUPTION
  ======================================================= */

  async cancelInterruption(
    id:
      string
  ): Promise<
    Interruption
  > {
    return restPatch<
      Interruption
    >(
      'interruptions',

      {
        id,
      },

      {
        current_status:
          'CANCELLED',
      },

      'interruptions:all:all'
    );
  },

  /* =======================================================
     OVERLOAD ALERTS
  ======================================================= */

  async getOverloadAlerts(
    stationId?:
      string
  ): Promise<
    OverloadAlert[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=alert_time.desc`
        : 'order=alert_time.desc';

    return restGet<
      OverloadAlert
    >(
      'overload_alerts',

      query,

      `overload:${
        stationId ??
        'all'
      }`
    );
  },

  async addOverloadAlert(
    row:
      NewOverloadAlert
  ): Promise<
    OverloadAlert
  > {
    return restPost<
      OverloadAlert
    >(
      'overload_alerts',

      row,

      `overload:${row.station_id}`
    );
  },

  async acknowledgeAlert(
    id:
      string
  ): Promise<
    OverloadAlert
  > {
    return restPatch<
      OverloadAlert
    >(
      'overload_alerts',

      {
        id,
      },

      {
        acknowledged:
          true,
      },

      'overload:all'
    );
  },

  /* =======================================================
     RELIABILITY
  ======================================================= */

  async getReliability(
    stationId?:
      string
  ): Promise<
    ReliabilityIndex[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=month.desc`
        : 'order=month.desc';

    return restGet<
      ReliabilityIndex
    >(
      'reliability_indices',

      query,

      `reliability:${
        stationId ??
        'all'
      }`
    );
  },

  async addReliability(
    row:
      NewReliabilityIndex
  ): Promise<
    ReliabilityIndex
  > {
    return restPost<
      ReliabilityIndex
    >(
      'reliability_indices',

      row,

      `reliability:${row.station_id}`
    );
  },

  /* =======================================================
     LOG BOOK
  ======================================================= */

  async getLogBook(
    stationId:
      string,

    limit =
      100
  ): Promise<
    LogBookEntry[]
  > {
    /*
     * Correct current schema:
     *
     * actual_event_time
     *
     * The old entry_date / entry_time columns
     * no longer exist.
     */

    const query =
      `station_id=eq.${encodeURIComponent(
        stationId
      )}` +
      `&order=actual_event_time.desc` +
      `&limit=${limit}`;

    return restGet<
      LogBookEntry
    >(
      'log_book_entries',

      query,

      `logbook:${stationId}`
    );
  },

  async getInterruptionReportSummary(
    startIso: string,
    endIso: string,
    stationId: string | null = null,
    feederId: string | null = null,
    status: InterruptionStatus | null = null,
    cause: string | null = null
  ): Promise<InterruptionReportSummary> {
    const { data, error } = await supabase.rpc('get_interruption_report_summary', {
      p_start: startIso, p_end: endIso, p_station_id: stationId,
      p_feeder_id: feederId, p_status: status, p_cause: cause,
    });
    if (error) throw error;
    const row = data?.[0];
    return {
      total_interruptions: Number(row?.total_interruptions ?? 0),
      open_interruptions: Number(row?.open_interruptions ?? 0),
      total_duration_minutes: Number(row?.total_duration_minutes ?? 0),
      average_restoration_minutes: row?.average_restoration_minutes === null || row?.average_restoration_minutes === undefined ? null : Number(row.average_restoration_minutes),
      longest_interruption_minutes: row?.longest_interruption_minutes === null || row?.longest_interruption_minutes === undefined ? null : Number(row.longest_interruption_minutes),
    };
  },

  async getInterruptionReportTrend(
    startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null,
    status: InterruptionStatus | null = null, cause: string | null = null
  ): Promise<InterruptionReportTrendRow[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_trend', {
      p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_status: status, p_cause: cause,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      date: String(row.date), interruption_count: Number(row.interruption_count ?? 0),
      duration_minutes: Number(row.duration_minutes ?? 0), open_count: Number(row.open_count ?? 0),
    }));
  },

  async getInterruptionReportBreakdown(
    startIso: string, endIso: string, group: 'STATION' | 'FEEDER' | 'CAUSE', stationId: string | null = null,
    feederId: string | null = null, status: InterruptionStatus | null = null, cause: string | null = null, limit = 5
  ): Promise<InterruptionReportBreakdownRow[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_breakdown', {
      p_start: startIso, p_end: endIso, p_group: group, p_station_id: stationId,
      p_feeder_id: feederId, p_status: status, p_cause: cause, p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      label: String(row.label ?? 'Not recorded'), interruption_count: Number(row.interruption_count ?? 0),
      duration_minutes: Number(row.duration_minutes ?? 0),
    }));
  },

  async getInterruptionReportCauses(): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_causes');
    if (error) throw error;
    return (data ?? []).map((row: { cause: string | null }) => row.cause).filter((cause: string | null): cause is string => Boolean(cause));
  },

  async getInterruptionReportPage(
    startIso: string, endIso: string, accessibleStationIds: string[], page: number, pageSize: number,
    stationId: string | null = null, feederId: string | null = null,
    status: InterruptionStatus | null = null, cause: string | null = null
  ): Promise<InterruptionReportPage> {
    if (accessibleStationIds.length === 0) return { rows: [], total: 0 };
    let query = supabase
      .from('interruptions')
      .select('id,station_id,feeder_id,operator_id,interruption_start,interruption_end,duration_minutes,cause,remarks,current_status,etr,created_at,updated_at', { count: 'exact' })
      .in('station_id', accessibleStationIds)
      .gte('interruption_start', startIso)
      .lt('interruption_start', endIso)
      .order('interruption_start', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (stationId) query = query.eq('station_id', stationId);
    if (feederId) query = query.eq('feeder_id', feederId);
    if (status) query = query.eq('current_status', status);
    if (cause) query = query.eq('cause', cause);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: (data ?? []) as Interruption[], total: count ?? 0 };
  },

  async getFeedersForStations(
    stationIds: string[]
  ): Promise<Feeder[]> {
    if (stationIds.length === 0) return [];
    const { data, error } = await supabase
      .from('feeders')
      .select('id,station_id,code,name,voltage_level_kv,active,created_at,updated_at')
      .in('station_id', stationIds)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Feeder[];
  },

  async getLogBookReportSummary(
    startIso: string,
    endIso: string,
    stationId: string | null = null,
    feederId: string | null = null
  ): Promise<LogBookReportSummary> {
    const { data, error } = await supabase.rpc(
      'get_logbook_report_summary',
      {
        p_start: startIso,
        p_end: endIso,
        p_station_id: stationId,
        p_feeder_id: feederId,
      }
    );

    if (error) throw error;
    const row = data?.[0];
    return {
      entered_readings: Number(row?.entered_readings ?? 0),
      expected_readings: Number(row?.expected_readings ?? 0),
      completeness_percent: Number(row?.completeness_percent ?? 0),
      feeders_reported: Number(row?.feeders_reported ?? 0),
      missing_feeder_hours: Number(row?.missing_feeder_hours ?? 0),
    };
  },

  async getLogBookReportPage(
    startIso: string,
    endIso: string,
    accessibleStationIds: string[],
    page: number,
    pageSize: number,
    stationId: string | null = null,
    feederId: string | null = null
  ): Promise<LogBookReportPage> {
    if (accessibleStationIds.length === 0) return { rows: [], total: 0 };

    let query = supabase
      .from('log_book_entries')
      .select(
        'id,station_id,feeder_id,operator_id,actual_event_time,mw,mvar,voltage_kv,current_a,power_factor,frequency_hz,transformer_temp_c,oil_level_percent,tap_position,weather,remarks,created_at,updated_at',
        { count: 'exact' }
      )
      .in('station_id', accessibleStationIds)
      .gte('actual_event_time', startIso)
      .lt('actual_event_time', endIso)
      .order('actual_event_time', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (stationId) query = query.eq('station_id', stationId);
    if (feederId) query = query.eq('feeder_id', feederId);

    const { data, error, count } = await query;
    if (error) throw error;
    return {
      rows: (data ?? []) as LogBookEntry[],
      total: count ?? 0,
    };
  },

  async addLogEntry(
    row:
      NewLogBookEntry
  ): Promise<
    LogBookEntry
  > {
    return restPost<
      LogBookEntry
    >(
      'log_book_entries',

      row,

      `logbook:${row.station_id}`
    );
  },

  /* =======================================================
     PUSH TOKENS
  ======================================================= */

  async getPushTokens():
    Promise<
      PushToken[]
    > {
    return restGet<
      PushToken
    >(
      'push_tokens',

      'order=created_at.desc',

      'push_tokens'
    );
  },

  async registerPushToken(
    token:
      string
  ): Promise<
    PushToken
  > {
    return restPost<
      PushToken
    >(
      'push_tokens',

      {
        token,

        enabled:
          true,
      },

      'push_tokens'
    );
  },

  async setPushEnabled(
    id:
      string,

    enabled:
      boolean
  ): Promise<
    PushToken
  > {
    return restPatch<
      PushToken
    >(
      'push_tokens',

      {
        id,
      },

      {
        enabled,
      },

      'push_tokens'
    );
  },
};

/* =========================================================
   OFFLINE QUEUE FLUSHER
========================================================= */

export async function flushQueue():
  Promise<{
    ok: number;
    failed: number;
  }> {
  const queue =
    getQueue();

  let ok =
    0;

  let failed =
    0;

  for (
    const op of
    queue
  ) {
    try {
      await runQueued(
        op
      );

      dequeueOp(
        op.id
      );

      ok +=
        1;
    } catch {
      failed +=
        1;

      /*
       * Leave operation in queue
       * for the next replay attempt.
       */
    }
  }

  return {
    ok,
    failed,
  };
}

/* =========================================================
   RUN QUEUED OPERATION
========================================================= */

async function runQueued(
  op:
    QueuedOp
): Promise<void> {
  const qs =
    op.filter
      ? Object.entries(
          op.filter
        )
          .map(
            ([
              key,
              value,
            ]) =>
              `${key}=eq.${encodeURIComponent(
                value
              )}`
          )
          .join(
            '&'
          )
      : '';

  const url =
    op.filter
      ? `${REST_URL}/${op.table}?${qs}`
      : `${REST_URL}/${op.table}`;

  const headers =
    await getAuthHeaders();

  const res =
    await fetch(
      url,
      {
        method:
          op.method,

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          op.body
            ? JSON.stringify(
                op.body
              )
            : undefined,
      }
    );

  if (
    !res.ok
  ) {
    const errorText =
      await res.text();

    throw new Error(
      `${op.method} ${op.table} replay failed: ${res.status} ${errorText}`
    );
  }
}
