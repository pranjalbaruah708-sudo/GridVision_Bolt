import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Station } from '@/types';
import { api } from '@/services/api';
import { supabase } from '@/services/supabase';

type ScopeState = {
  stations: Station[];
  selectedStationId: string;
  setSelectedStationId: (stationId: string) => void;
  loading: boolean;
  error: string | null;
};

const ShiftStationScopeContext = createContext<ScopeState | null>(null);

export function ShiftStationScopeProvider({
  children,
  allStations,
  activeStationId,
  stationsLoading,
  online,
}: {
  children: ReactNode;
  allStations: Station[];
  activeStationId: string;
  stationsLoading: boolean;
  online: boolean;
}) {
  const generation = useRef(0);
  const [authorizedIds, setAuthorizedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState('');

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (stationsLoading) return;
    if (!online) {
      setAuthorizedIds([]);
      setSelectedStationId('');
      setLoading(false);
      setError('Reconnect to confirm authorized stations for shift operations.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = await api.getMyOperationalStationIds();
      if (request !== generation.current) return;
      setAuthorizedIds([...new Set(ids)]);
    } catch {
      if (request !== generation.current) return;
      setAuthorizedIds([]);
      setSelectedStationId('');
      setError('Could not confirm your authorized shift stations.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [online, stationsLoading]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        void load();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const stations = useMemo(() => {
    if (loading || !online) return [];
    const allowed = new Set(authorizedIds);
    return allStations.filter((station) => allowed.has(station.id));
  }, [allStations, authorizedIds, loading, online]);

  useEffect(() => {
    if (loading) return;
    if (stations.some((station) => station.id === selectedStationId)) return;
    const preferred = stations.find((station) => station.id === activeStationId);
    setSelectedStationId(preferred?.id ?? stations[0]?.id ?? '');
  }, [activeStationId, loading, selectedStationId, stations]);

  const selectStation = useCallback((stationId: string) => {
    if (stations.some((station) => station.id === stationId)) setSelectedStationId(stationId);
  }, [stations]);

  const value = useMemo<ScopeState>(() => ({
    stations,
    selectedStationId,
    setSelectedStationId: selectStation,
    loading: loading || stationsLoading,
    error,
  }), [error, loading, selectStation, selectedStationId, stations, stationsLoading]);

  return <ShiftStationScopeContext.Provider value={value}>{children}</ShiftStationScopeContext.Provider>;
}

export function useShiftStationScope() {
  const context = useContext(ShiftStationScopeContext);
  if (!context) throw new Error('useShiftStationScope must be used inside AppProvider');
  return context;
}
