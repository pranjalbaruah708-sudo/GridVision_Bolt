import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStations } from '@/hooks/useStations';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ShiftStationScopeProvider } from '@/context/ShiftStationScopeContext';

type AppCtx = ReturnType<typeof useStations> &
  ReturnType<typeof useOnlineStatus>;

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const stations = useStations();
  const online = useOnlineStatus();
  return <Ctx.Provider value={{ ...stations, ...online }}><ShiftStationScopeProvider allStations={stations.stations} activeStationId={stations.activeStationId} stationsLoading={stations.loading} online={online.online}>{children}</ShiftStationScopeProvider></Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
