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
): Promise<
  {
    station_id: string;
    feeder_id: string | null;
    actual_event_time: string;
    mw: number | null;
  }[]
> {
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
        startIso
      )
      .lt(
        'actual_event_time',
        endIso
      )
      .order(
        'actual_event_time',
        {
          ascending: true,
        }
      );

  if (stationId) {
    query =
      query.eq(
        'station_id',
        stationId
      );
  }

  if (feederId) {
    query =
      query.eq(
        'feeder_id',
        feederId
      );
  }

  const {
    data,
    error,
  } =
    await query;

  if (error) {
    console.error(
      'Failed to load Load/Energy analysis readings:',
      error
    );

    throw error;
  }

  return (
    data ?? []
  ).map(
    (row) => ({
      station_id:
        row.station_id,

      feeder_id:
        row.feeder_id,

      actual_event_time:
        row.actual_event_time,

      mw:
        row.mw === null
          ? null
          : Number(
              row.mw
            ),
    })
  );
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