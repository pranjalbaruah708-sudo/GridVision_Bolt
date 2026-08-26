import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import { api } from '@/services/api';
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
      setLoading(true);
      setError(null);

      try {
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

          return;
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

          return;
        }

        setStations(
          accessibleStations
        );

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
      } catch (e) {
        console.error(
          'Failed to load accessible stations:',
          e
        );

        setStations([]);
        setFeeders([]);
        setActiveStationId('');

        setError(
          e instanceof Error
            ? e.message
            : 'Failed to load stations'
        );
      } finally {
        setLoading(false);
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
     LOAD FEEDERS WHEN ACTIVE STATION CHANGES

     This is important for officers because they may switch
     between several stations.
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadFeeders() {
      if (
        !activeStationId
      ) {
        setFeeders([]);
        return;
      }

      setFeedersLoading(
        true
      );

      try {
        const rows =
          await api.getFeeders(
            activeStationId
          );

        if (
          cancelled
        ) {
          return;
        }

        setFeeders(
          rows
        );
      } catch (e) {
        console.error(
          'Failed to load feeders:',
          e
        );

        if (
          !cancelled
        ) {
          setFeeders([]);

          setError(
            e instanceof Error
              ? e.message
              : 'Failed to load feeders'
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setFeedersLoading(
            false
          );
        }
      }
    }

    void loadFeeders();

    return () => {
      cancelled =
        true;
    };
  }, [
    activeStationId,
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
          event
        ) => {
          /* -----------------------------------------------
             LOGOUT
          ------------------------------------------------ */

          if (
            event ===
            'SIGNED_OUT'
          ) {
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