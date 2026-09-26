import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { api, type ShiftDutySession, type ShiftHandover, type ShiftRosterAssignment, type StationShift } from '@/services/api';
import { isOnline } from '@/services/offline';
import { supabase } from '@/services/supabase';
import { APP_RESUMED_EVENT } from '@/services/platform/runtime';
import { notifyShiftDutyStateChanged, SHIFT_DUTY_STATE_CHANGED_EVENT } from '@/services/operatorDutyWarning';

type ShiftDutyState = {
  currentShift: StationShift | null;
  myDutySession: ShiftDutySession | null;
  operatorsOnDuty: ShiftDutySession[];
  plannedRoster: ShiftRosterAssignment[];
  nextShift: StationShift | null;
  pendingIncomingHandover: ShiftHandover | null;
  unattendedHandover: { handover_id: string; incoming_shift_id: string; released_at: string; status: 'OPEN' | 'CLOSED' } | null;
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  mutating: boolean;
};

const emptyState: ShiftDutyState = {
  currentShift: null, myDutySession: null, operatorsOnDuty: [], plannedRoster: [], nextShift: null,
  pendingIncomingHandover: null, unattendedHandover: null, loaded: false, loading: false,
  refreshing: false, error: null, mutating: false,
};

const DUTY_TABLES = [
  'shift_handovers', 'shift_duty_handover_states', 'shift_duty_sessions',
  'station_shifts', 'station_shift_assignments', 'shift_handover_unattended_states',
  'notification_events', 'notification_recipients',
] as const;
const POLL_INTERVAL_MS = 30_000;

type DutyStore = {
  state: ShiftDutyState;
  listeners: Set<(state: ShiftDutyState) => void>;
  subscribers: number;
  inFlight: Promise<void> | null;
  channel: ReturnType<typeof supabase.channel> | null;
  pollTimer: number | null;
  disposeTimer: number | null;
  refreshTimer: number | null;
  generation: number;
  stopListeners: (() => void) | null;
  refresh: () => Promise<void>;
  subscribe: (listener: (state: ShiftDutyState) => void) => () => void;
};

const stores = new Map<string, DutyStore>();

function publish(store: DutyStore, next: ShiftDutyState) {
  store.state = next;
  store.listeners.forEach((listener) => listener(next));
}

function queueRefresh(store: DutyStore) {
  if (store.refreshTimer !== null) window.clearTimeout(store.refreshTimer);
  store.refreshTimer = window.setTimeout(() => {
    store.refreshTimer = null;
    void store.refresh();
  }, 250);
}

function createStore(key: string, stationId: string): DutyStore {
  const store = {} as DutyStore;
  const refresh = async () => {
    if (store.inFlight) return store.inFlight;
    if (!isOnline()) {
      if (!store.state.loaded) publish(store, { ...store.state, loading: false, refreshing: false, error: 'Could not load the current shift. Check your connection and try again.' });
      return;
    }
    const initial = !store.state.loaded;
    const generation = ++store.generation;
    publish(store, { ...store.state, loading: initial, refreshing: !initial, error: initial ? null : store.state.error });
    store.inFlight = (async () => {
      try {
        const [currentShift, nextShift, unattendedHandover] = await Promise.all([
          api.getCurrentStationShift(stationId),
          api.getNextStationShift(stationId),
          api.getMyV2HandoverUnattended(stationId),
        ]);
        if (generation !== store.generation) return;
        if (!currentShift) {
          publish(store, { ...store.state, currentShift: null, myDutySession: null, operatorsOnDuty: [], plannedRoster: [], nextShift, pendingIncomingHandover: null, unattendedHandover, loaded: true, loading: false, refreshing: false, error: null });
          return;
        }
        const [myDutySession, sessions, plannedRoster] = await Promise.all([
          api.getMyShiftDutySession(currentShift.id),
          api.getShiftDutySessions(currentShift.id),
          api.getShiftRoster(currentShift.id),
        ]);
        if (generation !== store.generation) return;
        const pendingIncomingHandover = myDutySession?.status === 'ON_DUTY'
          ? await api.getPendingIncomingShiftHandover(stationId)
          : null;
        if (generation !== store.generation) return;
        publish(store, { ...store.state, currentShift, myDutySession, operatorsOnDuty: sessions, plannedRoster, nextShift, pendingIncomingHandover: pendingIncomingHandover?.incoming_shift_id === currentShift.id ? pendingIncomingHandover : null, unattendedHandover, loaded: true, loading: false, refreshing: false, error: null });
      } catch {
        if (generation !== store.generation) return;
        if (store.state.loaded) publish(store, { ...store.state, loading: false, refreshing: false, error: 'Could not refresh the current shift. Showing the last confirmed status.' });
        else publish(store, { ...store.state, loaded: false, loading: false, refreshing: false, error: 'Could not load the current shift. Check your connection and try again.' });
      } finally {
        store.inFlight = null;
      }
    })();
    return store.inFlight;
  };

  store.state = emptyState;
  store.listeners = new Set();
  store.subscribers = 0;
  store.inFlight = null;
  store.channel = null;
  store.pollTimer = null;
  store.disposeTimer = null;
  store.refreshTimer = null;
  store.generation = 0;
  store.stopListeners = null;
  store.refresh = refresh;
  store.subscribe = (listener) => {
    store.subscribers += 1;
    if (store.disposeTimer !== null) { window.clearTimeout(store.disposeTimer); store.disposeTimer = null; }
    store.listeners.add(listener);
    listener(store.state);
    if (!store.channel) {
      const channel = supabase.channel(`shift-duty-store:${key}`);
      DUTY_TABLES.forEach((table) => channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => queueRefresh(store)));
      channel.subscribe();
      store.channel = channel;
      const refreshNow = () => { void store.refresh(); };
      const refreshIfVisible = () => { if (document.visibilityState === 'visible') refreshNow(); };
      window.addEventListener('focus', refreshNow);
      window.addEventListener('online', refreshNow);
      window.addEventListener(APP_RESUMED_EVENT, refreshNow);
      window.addEventListener(SHIFT_DUTY_STATE_CHANGED_EVENT, refreshNow);
      document.addEventListener('visibilitychange', refreshIfVisible);
      store.pollTimer = window.setInterval(refreshNow, POLL_INTERVAL_MS);
      store.stopListeners = () => {
        window.removeEventListener('focus', refreshNow);
        window.removeEventListener('online', refreshNow);
        window.removeEventListener(APP_RESUMED_EVENT, refreshNow);
        window.removeEventListener(SHIFT_DUTY_STATE_CHANGED_EVENT, refreshNow);
        document.removeEventListener('visibilitychange', refreshIfVisible);
      };
      void store.refresh();
    }
    return () => {
      store.listeners.delete(listener);
      store.subscribers -= 1;
      if (store.subscribers > 0 || store.disposeTimer !== null) return;
      store.disposeTimer = window.setTimeout(() => {
        store.disposeTimer = null;
        if (store.subscribers > 0) return;
        if (store.pollTimer !== null) window.clearInterval(store.pollTimer);
        if (store.refreshTimer !== null) window.clearTimeout(store.refreshTimer);
        store.stopListeners?.();
        if (store.channel) void supabase.removeChannel(store.channel);
        stores.delete(key);
      }, 0);
    };
  };
  return store;
}

function getStore(userId: string, stationId: string) {
  const key = `${userId}:${stationId}`;
  const existing = stores.get(key);
  if (existing) return existing;
  const created = createStore(key, stationId);
  stores.set(key, created);
  return created;
}

export function useShiftDuty(stationIdOverride?: string | null) {
  const auth = useAuth();
  const { activeStation, stations, loading: stationsLoading } = useApp();
  const userId = auth.user?.id ?? null;
  const stationId = stationIdOverride === undefined ? activeStation?.id ?? null : stationIdOverride;
  const station = stations.find((item) => item.id === stationId) ?? null;
  const store = useMemo(() => userId && stationId ? getStore(userId, stationId) : null, [stationId, userId]);
  const [state, setState] = useState<ShiftDutyState>(emptyState);

  useEffect(() => {
    if (!store) {
      setState({ ...emptyState, loaded: !stationsLoading, loading: stationsLoading && Boolean(userId) });
      return;
    }
    return store.subscribe(setState);
  }, [stationsLoading, store, userId]);

  const refresh = useCallback(async () => { if (store) await store.refresh(); }, [store]);
  const startDuty = useCallback(async () => {
    if (!store || !state.currentShift) throw new Error('No current shift is available.');
    if (!isOnline()) throw new Error('Internet connection required to start duty.');
    publish(store, { ...store.state, mutating: true, error: null });
    try {
      await api.startShiftDuty(state.currentShift.id, 'MEMBER');
      notifyShiftDutyStateChanged();
      await store.refresh();
    } catch {
      await store.refresh().catch(() => undefined);
      throw new Error('Start Duty was not confirmed by the server.');
    } finally { publish(store, { ...store.state, mutating: false }); }
  }, [state.currentShift, store]);
  const endDuty = useCallback(async () => {
    if (!store || !state.myDutySession || state.myDutySession.status !== 'ON_DUTY') throw new Error('There is no active duty session to end.');
    if (!isOnline()) throw new Error('Internet connection required to end duty.');
    publish(store, { ...store.state, mutating: true, error: null });
    try {
      await api.endShiftDuty(state.myDutySession.id);
      notifyShiftDutyStateChanged();
      await store.refresh();
    } catch {
      await store.refresh().catch(() => undefined);
      throw new Error('End Duty was not confirmed by the server.');
    } finally { publish(store, { ...store.state, mutating: false }); }
  }, [state.myDutySession, store]);

  return { ...state, station, hasStation: Boolean(stationId), refresh, startDuty, endDuty };
}
