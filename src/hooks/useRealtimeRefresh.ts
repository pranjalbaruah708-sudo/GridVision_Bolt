import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { isOnline } from '@/services/offline';
import { APP_RESUMED_EVENT } from '@/services/platform/runtime';

type RealtimeTable = 'interruptions' | 'parameter_alerts' | 'log_book_entries';

type UseRealtimeRefreshOptions = {
  channelName: string;
  tables: readonly RealtimeTable[];
  onRefresh: (changedTables: ReadonlySet<RealtimeTable>) => void;
  debounceMs?: number;
};

export function useRealtimeRefresh({ channelName, tables, onRefresh, debounceMs = 250 }: UseRealtimeRefreshOptions): void {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const changedTables = new Set<RealtimeTable>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(channelName);

    const scheduleRefresh = (table: RealtimeTable) => {
      if (!isOnline()) return;
      changedTables.add(table);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!isOnline()) { changedTables.clear(); return; }
        const batch = new Set(changedTables);
        changedTables.clear();
        refreshRef.current(batch);
      }, debounceMs);
    };

    tables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => scheduleRefresh(table),
      );
    });

    channel.subscribe();
    const onResume = () => {
      if (!isOnline()) return;
      tables.forEach((table) => changedTables.add(table));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!isOnline()) { changedTables.clear(); return; }
        const batch = new Set(changedTables);
        changedTables.clear();
        refreshRef.current(batch);
      }, debounceMs);
    };
    window.addEventListener(APP_RESUMED_EVENT, onResume);

    return () => {
      window.removeEventListener(APP_RESUMED_EVENT, onResume);
      if (timer) clearTimeout(timer);
      changedTables.clear();
      void supabase.removeChannel(channel);
    };
  }, [channelName, debounceMs, tables]);
}
