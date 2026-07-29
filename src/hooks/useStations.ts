import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { Feeder, Station } from '@/types';

// Loads stations + feeders once and shares them. Any page can read or
// force-refresh them. Keeps a station selector value in sync.
export function useStations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStationId, setActiveStationId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getStations();
      setStations(s);
      const f = await api.getFeeders();
      setFeeders(f);
      if (s.length && !activeStationId) setActiveStationId(s[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stations');
    } finally {
      setLoading(false);
    }
  }, [activeStationId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeStation = stations.find((s) => s.id === activeStationId) ?? null;
  const activeFeeders = feeders.filter((f) => f.station_id === activeStationId);

  return {
    stations,
    feeders,
    activeStationId,
    activeStation,
    activeFeeders,
    setActiveStationId,
    loading,
    error,
    reload: load,
  };
}
