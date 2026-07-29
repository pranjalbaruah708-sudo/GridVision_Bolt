// Decoupled API service. All database interactions go through this module.
// Uses the native fetch client against the Supabase PostgREST endpoint.
// Read path: localStorage cache first when offline, otherwise network then cache.
// Write path: network when online; offline writes are queued and flushed later.

import { REST_HEADERS, REST_URL } from './supabase';
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
  NewInterruption,
  NewLogBookEntry,
  NewOverloadAlert,
  NewReliabilityIndex,
  OverloadAlert,
  PeakLoadReading,
  PushToken,
  ReliabilityIndex,
  Station,
} from '@/types';

// --- low level helpers ---------------------------------------------------

async function restGet<T>(table: string, query: string, cacheKey: string): Promise<T[]> {
  if (!isOnline()) {
    const cached = readCache<T[]>(cacheKey);
    if (cached) return cached;
  }
  const url = `${REST_URL}/${table}?${query}`;
  const res = await fetch(url, { headers: REST_HEADERS, method: 'GET' });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
  const data = (await res.json()) as T[];
  writeCache(cacheKey, data);
  return data;
}

async function restPost<T>(table: string, body: unknown, cacheKey: string): Promise<T> {
  if (!isOnline()) {
    enqueueOp({ method: 'POST', table, body });
    // return a best-effort optimistic placeholder so UI can render immediately
    return body as T;
  }
  const res = await fetch(`${REST_URL}/${table}`, {
    method: 'POST',
    headers: { ...REST_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${table} failed: ${res.status}`);
  const arr = (await res.json()) as T[];
  const row = Array.isArray(arr) ? arr[0] : (arr as unknown as T);
  clearCache(cacheKey);
  return row;
}

async function restPatch<T>(
  table: string,
  filter: Record<string, string>,
  body: unknown,
  cacheKey: string
): Promise<T> {
  if (!isOnline()) {
    enqueueOp({ method: 'PATCH', table, filter, body });
    return body as T;
  }
  const qs = Object.entries(filter)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`${REST_URL}/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...REST_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table} failed: ${res.status}`);
  const arr = (await res.json()) as T[];
  const row = Array.isArray(arr) ? arr[0] : (arr as unknown as T);
  clearCache(cacheKey);
  return row;
}

// --- public API ----------------------------------------------------------

export const api = {
  // Stations & feeders (read-only-ish reference data)
  async getStations(): Promise<Station[]> {
    return restGet<Station>('stations', 'order=name.asc', 'stations');
  },

  async getFeeders(stationId?: string): Promise<Feeder[]> {
    const q = stationId
      ? `station_id=eq.${stationId}&order=name.asc`
      : 'order=name.asc';
    return restGet<Feeder>('feeders', q, `feeders:${stationId ?? 'all'}`);
  },

  // Peak load
  async getPeakLoad(stationId: string, days = 31): Promise<PeakLoadReading[]> {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const q = `station_id=eq.${stationId}&recorded_at=gte.${since}&order=recorded_at.asc`;
    return restGet<PeakLoadReading>('peak_load_readings', q, `peak:${stationId}:${days}`);
  },

  async addPeakLoad(
    row: Omit<PeakLoadReading, 'id' | 'created_at'>
  ): Promise<PeakLoadReading> {
    return restPost<PeakLoadReading>('peak_load_readings', row, `peak:${row.station_id}`);
  },

  // Interruptions
  async getInterruptions(stationId?: string, status?: 'open' | 'closed'): Promise<Interruption[]> {
    let q = 'order=started_at.desc';
    if (stationId) q = `station_id=eq.${stationId}&` + q;
    if (status) q = `${stationId ? '' : ''}status=eq.${status}&` + q;
    return restGet<Interruption>('interruptions', q, `interruptions:${stationId ?? 'all'}:${status ?? 'all'}`);
  },

  async addInterruption(row: NewInterruption): Promise<Interruption> {
    return restPost<Interruption>('interruptions', row, 'interruptions:all:all');
  },

  async restoreInterruption(id: string, restoredAt: string): Promise<Interruption> {
    return restPatch<Interruption>(
      'interruptions',
      { id },
      { restored_at: restoredAt, status: 'closed' },
      'interruptions:all:all'
    );
  },

  // Overload alerts
  async getOverloadAlerts(stationId?: string): Promise<OverloadAlert[]> {
    const q = stationId
      ? `station_id=eq.${stationId}&order=alert_time.desc`
      : 'order=alert_time.desc';
    return restGet<OverloadAlert>('overload_alerts', q, `overload:${stationId ?? 'all'}`);
  },

  async addOverloadAlert(row: NewOverloadAlert): Promise<OverloadAlert> {
    return restPost<OverloadAlert>('overload_alerts', row, `overload:${row.station_id}`);
  },

  async acknowledgeAlert(id: string): Promise<OverloadAlert> {
    return restPatch<OverloadAlert>(
      'overload_alerts',
      { id },
      { acknowledged: true },
      'overload:all'
    );
  },

  // Reliability indices
  async getReliability(stationId?: string): Promise<ReliabilityIndex[]> {
    const q = stationId
      ? `station_id=eq.${stationId}&order=month.desc`
      : 'order=month.desc';
    return restGet<ReliabilityIndex>('reliability_indices', q, `reliability:${stationId ?? 'all'}`);
  },

  async addReliability(row: NewReliabilityIndex): Promise<ReliabilityIndex> {
    return restPost<ReliabilityIndex>('reliability_indices', row, `reliability:${row.station_id}`);
  },

  // Log book
  async getLogBook(stationId: string, limit = 100): Promise<LogBookEntry[]> {
    const q = `station_id=eq.${stationId}&order=entry_date.desc,entry_time.desc&limit=${limit}`;
    return restGet<LogBookEntry>('log_book_entries', q, `logbook:${stationId}`);
  },

  async addLogEntry(row: NewLogBookEntry): Promise<LogBookEntry> {
    return restPost<LogBookEntry>('log_book_entries', row, `logbook:${row.station_id}`);
  },

  // Push tokens
  async getPushTokens(): Promise<PushToken[]> {
    return restGet<PushToken>('push_tokens', 'order=created_at.desc', 'push_tokens');
  },

  async registerPushToken(token: string): Promise<PushToken> {
    return restPost<PushToken>('push_tokens', { token, enabled: true }, 'push_tokens');
  },

  async setPushEnabled(id: string, enabled: boolean): Promise<PushToken> {
    return restPatch<PushToken>('push_tokens', { id }, { enabled }, 'push_tokens');
  },
};

// --- offline queue flusher -----------------------------------------------

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  const queue = getQueue();
  let ok = 0;
  let failed = 0;
  for (const op of queue) {
    try {
      await runQueued(op);
      dequeueOp(op.id);
      ok += 1;
    } catch {
      failed += 1;
      // leave in queue for next attempt
    }
  }
  return { ok, failed };
}

async function runQueued(op: QueuedOp): Promise<void> {
  const qs = op.filter
    ? Object.entries(op.filter)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const url = op.filter ? `${REST_URL}/${op.table}?${qs}` : `${REST_URL}/${op.table}`;
  const res = await fetch(url, {
    method: op.method,
    headers: { ...REST_HEADERS, Prefer: 'return=representation' },
    body: op.body ? JSON.stringify(op.body) : undefined,
  });
  if (!res.ok) throw new Error(`${op.method} ${op.table} replay failed: ${res.status}`);
}
