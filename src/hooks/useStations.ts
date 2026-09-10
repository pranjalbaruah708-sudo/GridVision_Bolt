import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { api } from '@/services/api';
import {
  isOnline,
  clearAuthorizedOperationalScope,
  readAuthorizedOperationalScope,
  writeAuthorizedOperationalScope,
} from '@/services/offline';
import { supabase } from '@/services/supabase';

import type {
  Feeder,
  Station,
} from '@/types';

/* =========================================================
   STATION ACCESS HOOK

   OPERATOR
   → stations assigned through user_stations

   FIELD_OFFICER
   → stations associated with the officer's organizational
     unit or its descendant organizational units

   ADMIN
   → all active stations
========================================================= */

export function useStations() {
  const loadGeneration = useRef(0);
  const authenticatedUserRef = useRef<string | null>(null);
  const [
    stations,
    setStations,
  ] = useState<Station[]>([]);

  const [
    feeders,
    setFeeders,
  ] = useState<Feeder[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    feedersLoading,
    setFeedersLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  const [
    activeStationId,
    setActiveStationId,
  ] = useState<string>('');

  /* =======================================================
     LOAD ACCESSIBLE STATIONS
  ======================================================= */

  const load =
    useCallback(async () => {
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user.id;

        if (!userId) {
          throw new Error('An authenticated session is required to load operational scope.');
        }
        if (generation !== loadGeneration.current) return false;
        authenticatedUserRef.current = userId;
        const isCurrentUserRequest = () => generation === loadGeneration.current && authenticatedUserRef.current === userId;

        if (!isOnline()) {
          const cachedScope = readAuthorizedOperationalScope(userId);
          if (!cachedScope) {
            throw new Error('Offline operational scope is unavailable. Connect once to refresh your authorized stations and feeders.');
          }

          if (!isCurrentUserRequest()) return false;

          setStations(cachedScope.stations);
          setFeeders(cachedScope.feeders);
          setActiveStationId((current) =>
            cachedScope.stations.some((station) => station.id === current)
              ? current
              : cachedScope.stations[0]?.id ?? ''
          );
          return true;
        }

        /*
         * Load station master and user's accessible IDs
         * in parallel.
         */

        const [
          allStations,
          accessibleStationIds,
        ] = await Promise.all([
          api.getStations(),
          api.getMyAccessibleStationIds(),
        ]);
        if (!isCurrentUserRequest()) return false;

        /* -------------------------------------------------
           No accessible stations
        -------------------------------------------------- */

        if (
          accessibleStationIds.length === 0
        ) {
          setStations([]);
          setFeeders([]);
          setActiveStationId('');

          setError(
            'No stations are available for this user.'
          );
          clearAuthorizedOperationalScope(userId);
          return false;
        }

        /* -------------------------------------------------
           Filter master stations by user's access
        -------------------------------------------------- */

        const accessibleIdSet =
          new Set(
            accessibleStationIds
          );

        const accessibleStations =
          allStations.filter(
            (station) =>
              accessibleIdSet.has(
                station.id
              )
          );

        /* -------------------------------------------------
           Sort alphabetically
        -------------------------------------------------- */

        accessibleStations.sort(
          (a, b) =>
            a.name.localeCompare(
              b.name
            )
        );

        if (
          accessibleStations.length === 0
        ) {
          setStations([]);
          setFeeders([]);
          setActiveStationId('');

          setError(
            'Accessible station records could not be found.'
          );
          clearAuthorizedOperationalScope(userId);
          return false;
        }

        setFeedersLoading(true);
        const authorizedStationIds = accessibleStations.map((station) => station.id);
        const accessibleFeeders = await api.getFeedersForStations(authorizedStationIds);
        if (!isCurrentUserRequest()) return false;

        writeAuthorizedOperationalScope({
          userId,
          authorizedStationIds,
          stations: accessibleStations,
          feeders: accessibleFeeders,
        });

        setStations(
          accessibleStations
        );
        setFeeders(accessibleFeeders);

        /* -------------------------------------------------
           Keep currently selected station when still valid.

           Otherwise select first accessible station.
        -------------------------------------------------- */

        setActiveStationId(
          (current) => {
            const currentStillAccessible =
              accessibleStations.some(
                (station) =>
                  station.id === current
              );

            if (
              currentStillAccessible
            ) {
              return current;
            }

            return (
              accessibleStations[0]?.id ??
              ''
            );
          }
        );
        return true;
      } catch (e) {
        if (generation !== loadGeneration.current) return false;
        console.error('Accessible station scope could not be loaded.');

        setStations([]);
        setFeeders([]);
        setActiveStationId('');

        setError(
          e instanceof Error
            ? e.message
            : 'Failed to load stations'
        );
        return false;
      } finally {
        if (generation === loadGeneration.current) {
          setFeedersLoading(false);
          setLoading(false);
        }
      }
    }, []);

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    void load();
  }, [
    load,
  ]);

  /* =======================================================
     AUTH STATE CHANGES
  ======================================================= */

  useEffect(() => {
    const {
      data,
    } =
      supabase.auth.onAuthStateChange(
        (
          event,
          session
        ) => {
          /* -----------------------------------------------
             LOGOUT
          ------------------------------------------------ */

          if (
            event ===
            'SIGNED_OUT'
          ) {
            loadGeneration.current += 1;
            authenticatedUserRef.current = null;
            setStations([]);
            setFeeders([]);
            setActiveStationId('');
            setError(null);

            return;
          }

          /* -----------------------------------------------
             LOGIN
          ------------------------------------------------ */

          if (
            event ===
            'SIGNED_IN'
          ) {
            authenticatedUserRef.current = session?.user.id ?? null;
            /*
             * Run outside the Supabase auth callback.
             */

            window.setTimeout(
              () => {
                void load();
              },
              0
            );
          }
        }
      );

    return () =>
      data.subscription.unsubscribe();
  }, [
    load,
  ]);

  /* =======================================================
     ACTIVE STATION
  ======================================================= */

  const activeStation =
    stations.find(
      (station) =>
        station.id ===
        activeStationId
    ) ??
    null;

  /* =======================================================
     ACTIVE FEEDERS

     Feeders are already loaded only for the active station,
     but retain this filter as an extra safeguard.
  ======================================================= */

  const activeFeeders =
    feeders.filter(
      (feeder) =>
        feeder.station_id ===
        activeStationId
    );

  /* =======================================================
     RETURN
  ======================================================= */

  return {
    stations,
    feeders,

    activeStationId,
    activeStation,
    activeFeeders,

    setActiveStationId,

    loading,
    feedersLoading,
    error,

    reload:
      load,
  };
}
