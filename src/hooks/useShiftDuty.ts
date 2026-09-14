import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApp } from '@/context/AppContext';
import { api, type ShiftDutySession, type ShiftHandover, type ShiftRosterAssignment, type StationShift } from '@/services/api';
import { isOnline } from '@/services/offline';

type ShiftDutyState = {
  currentShift: StationShift | null;
  myDutySession: ShiftDutySession | null;
  operatorsOnDuty: ShiftDutySession[];
  plannedRoster: ShiftRosterAssignment[];
  nextShift: StationShift | null;
  pendingIncomingHandover: ShiftHandover | null;
  loading: boolean;
  error: string | null;
  mutating: boolean;
};

const emptyState: ShiftDutyState = {
  currentShift: null, myDutySession: null, operatorsOnDuty: [], plannedRoster: [], nextShift: null, pendingIncomingHandover: null, loading: false, error: null, mutating: false,
};

export function useShiftDuty() {
  const auth = useAuth();
  const { activeStation, loading: stationsLoading } = useApp();
  const generation = useRef(0);
  const mutationGeneration = useRef(0);
  const [state, setState] = useState<ShiftDutyState>(emptyState);
  const userId = auth.user?.id ?? null;
  const stationId = activeStation?.id ?? null;

  const clear = useCallback(() => {
    generation.current += 1;
    mutationGeneration.current += 1;
    setState(emptyState);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!userId || !stationId) {
      setState((current) => ({ ...emptyState, loading: stationsLoading && Boolean(userId) }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [currentShift, nextShift] = await Promise.all([
        api.getCurrentStationShift(stationId),
        api.getNextStationShift(stationId),
      ]);
      if (request !== generation.current) return;
      if (!currentShift) {
        setState((current) => ({ ...current, currentShift: null, myDutySession: null, operatorsOnDuty: [], plannedRoster: [], nextShift, pendingIncomingHandover: null, loading: false }));
        return;
      }
      const [myDutySession, sessions, plannedRoster] = await Promise.all([
        api.getMyShiftDutySession(currentShift.id),
        api.getShiftDutySessions(currentShift.id),
        api.getShiftRoster(currentShift.id),
      ]);
      if (request !== generation.current) return;
      const pendingIncomingHandover = myDutySession?.status === 'ON_DUTY'
        ? await api.getPendingIncomingShiftHandover(stationId)
        : null;
      if (request !== generation.current) return;
      setState((current) => ({
        ...current,
        currentShift,
        myDutySession,
        operatorsOnDuty: sessions,
        plannedRoster,
        nextShift,
        pendingIncomingHandover: pendingIncomingHandover?.incoming_shift_id === currentShift.id ? pendingIncomingHandover : null,
        loading: false,
        error: null,
      }));
    } catch {
      if (request !== generation.current) return;
      setState((current) => ({ ...current, loading: false, error: 'Could not load the current shift. Check your connection and try again.' }));
    }
  }, [stationId, stationsLoading, userId]);

  useEffect(() => {
    clear();
    if (userId && stationId) void refresh();
  }, [clear, refresh, stationId, userId]);

  const startDuty = useCallback(async () => {
    if (!state.currentShift) throw new Error('No current shift is available.');
    if (!isOnline()) {
      setState((current) => ({ ...current, error: 'Internet connection required to start duty. No duty session was created.' }));
      throw new Error('Internet connection required to start duty.');
    }
    const request = ++mutationGeneration.current;
    setState((current) => ({ ...current, mutating: true, error: null }));
    try {
      await api.startShiftDuty(state.currentShift.id, 'MEMBER');
      if (request !== mutationGeneration.current) return;
      await refresh();
    } catch {
      await refresh().catch(() => undefined);
      if (request === mutationGeneration.current) setState((current) => ({ ...current, error: 'Unable to confirm whether duty started. The current shift status has been refreshed.' }));
      throw new Error('Start Duty was not confirmed by the server.');
    } finally {
      if (request === mutationGeneration.current) setState((current) => ({ ...current, mutating: false }));
    }
  }, [refresh, state.currentShift]);

  const endDuty = useCallback(async () => {
    if (!state.myDutySession || state.myDutySession.status !== 'ON_DUTY') throw new Error('There is no active duty session to end.');
    if (!isOnline()) {
      setState((current) => ({ ...current, error: 'Internet connection required to end duty. Your duty session remains unchanged.' }));
      throw new Error('Internet connection required to end duty.');
    }
    const request = ++mutationGeneration.current;
    setState((current) => ({ ...current, mutating: true, error: null }));
    try {
      await api.endShiftDuty(state.myDutySession.id);
      if (request !== mutationGeneration.current) return;
      await refresh();
    } catch {
      await refresh().catch(() => undefined);
      if (request === mutationGeneration.current) setState((current) => ({ ...current, error: 'Unable to confirm whether duty ended. The current shift status has been refreshed.' }));
      throw new Error('End Duty was not confirmed by the server.');
    } finally {
      if (request === mutationGeneration.current) setState((current) => ({ ...current, mutating: false }));
    }
  }, [refresh, state.myDutySession]);

  return { ...state, station: activeStation, hasStation: Boolean(stationId), refresh, startDuty, endDuty };
}
