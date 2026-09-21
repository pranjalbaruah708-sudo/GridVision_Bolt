import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { isOnline } from '@/services/offline';
import { APP_RESUMED_EVENT } from '@/services/platform/runtime';

type RealtimeTable =
  | 'interruptions'
  | 'parameter_alerts'
  | 'log_book_entries'
  | 'shift_handovers'
  | 'shift_handover_entries'
  | 'shift_duty_handover_states'
  | 'notification_events'
  | 'notification_recipients'
  | 'station_shifts'
  | 'station_shift_assignments'
  | 'shift_duty_sessions';

type UseRealtimeRefreshOptions<TTable extends RealtimeTable> = {
  channelName: string;
  tables: readonly TTable[];
  onRefresh: (changedTables: ReadonlySet<TTable>) => void;
  debounceMs?: number;
};

type RefreshConsumer = (changedTables: ReadonlySet<RealtimeTable>) => void;

type ManagedChannel = {
  channel: ReturnType<typeof supabase.channel>;
  consumers: Map<number, RefreshConsumer>;
  changedTables: Set<RealtimeTable>;
  tables: readonly RealtimeTable[];
  debounceMs: number;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  disposalTimer: ReturnType<typeof setTimeout> | null;
  onResume: () => void;
};

const managedChannels = new Map<string, ManagedChannel>();
let nextConsumerId = 0;
let nextChannelLifetimeId = 0;
// Supabase reuses an existing channel object for the same topic. This namespace
// prevents an old hot-reload topic from being reused; the registry shares the
// current topic between all mounted consumers.
const channelNamespace = `gridvision-refresh-${Math.random().toString(36).slice(2)}`;

function queueRefresh(managed: ManagedChannel, tables: Iterable<RealtimeTable>) {
  if (!isOnline()) return;
  for (const table of tables) managed.changedTables.add(table);
  if (managed.refreshTimer) window.clearTimeout(managed.refreshTimer);
  managed.refreshTimer = setTimeout(() => {
    managed.refreshTimer = null;
    if (!isOnline()) {
      managed.changedTables.clear();
      return;
    }
    const changed = new Set(managed.changedTables);
    managed.changedTables.clear();
    managed.consumers.forEach((consumer) => consumer(changed));
  }, managed.debounceMs);
}

function createManagedChannel(key: string, channelName: string, tables: readonly RealtimeTable[], debounceMs: number): ManagedChannel {
  const channel = supabase.channel(`${channelNamespace}:${++nextChannelLifetimeId}:${channelName}:${tables.join(',')}`);
  const managed: ManagedChannel = {
    channel,
    consumers: new Map(),
    changedTables: new Set(),
    tables,
    debounceMs,
    refreshTimer: null,
    disposalTimer: null,
    onResume: () => queueRefresh(managed, managed.tables),
  };

  // Every callback is attached before the channel joins Realtime.
  tables.forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      queueRefresh(managed, [table]);
    });
  });
  channel.subscribe();
  window.addEventListener(APP_RESUMED_EVENT, managed.onResume);
  managedChannels.set(key, managed);
  return managed;
}

function acquireManagedChannel(key: string, channelName: string, tables: readonly RealtimeTable[], debounceMs: number, consumer: RefreshConsumer) {
  const managed = managedChannels.get(key) ?? createManagedChannel(key, channelName, tables, debounceMs);
  if (managed.disposalTimer) {
    window.clearTimeout(managed.disposalTimer);
    managed.disposalTimer = null;
  }
  const consumerId = ++nextConsumerId;
  managed.consumers.set(consumerId, consumer);

  return () => {
    managed.consumers.delete(consumerId);
    if (managed.consumers.size || managed.disposalTimer) return;
    // React Strict Mode remounts effects immediately. A one-task grace period
    // reuses the fully configured subscription instead of adding bindings after
    // subscribe has begun.
    managed.disposalTimer = setTimeout(() => {
      managed.disposalTimer = null;
      if (managed.consumers.size) return;
      window.removeEventListener(APP_RESUMED_EVENT, managed.onResume);
      if (managed.refreshTimer) window.clearTimeout(managed.refreshTimer);
      managed.refreshTimer = null;
      managed.changedTables.clear();
      managedChannels.delete(key);
      void supabase.removeChannel(managed.channel);
    }, 0);
  };
}

export function useRealtimeRefresh<TTable extends RealtimeTable>({ channelName, tables, onRefresh, debounceMs = 250 }: UseRealtimeRefreshOptions<TTable>): void {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const tableKey = useMemo(() => [...new Set(tables)].sort().join('|'), [tables]);
  const stableTables = useMemo(() => tableKey ? tableKey.split('|') as RealtimeTable[] : [], [tableKey]);
  const registryKey = `${channelName}|${tableKey}|${debounceMs}`;

  useEffect(() => acquireManagedChannel(
    registryKey,
    channelName,
    stableTables,
    debounceMs,
    (changed) => refreshRef.current(changed as ReadonlySet<TTable>),
  ), [channelName, debounceMs, registryKey, stableTables]);
}
