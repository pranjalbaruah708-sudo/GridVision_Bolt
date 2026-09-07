BEGIN;

DO $stage7$
DECLARE
  v_user_id uuid;
  v_station_id uuid;
  v_feeder_id uuid;
  v_id_first uuid;
  v_id_retry uuid;
  v_add_id text := 'stage7-add-' || gen_random_uuid()::text;
  v_restore_id text := 'stage7-restore-' || gen_random_uuid()::text;
  v_start timestamptz := now() - interval '45 minutes';
  v_end timestamptz := now() - interval '20 minutes';
  v_event_count integer;
BEGIN
  SELECT au.id, usa.station_id, f.id
  INTO v_user_id, v_station_id, v_feeder_id
  FROM public.app_users au
  JOIN public.user_stations usa ON usa.user_id = au.id AND usa.active
  JOIN public.feeders f ON f.station_id = usa.station_id AND coalesce(f.active, true)
  WHERE au.role = 'OPERATOR'::public.app_user_role AND au.active
  ORDER BY au.id, f.id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT au.id INTO v_user_id
    FROM public.app_users au
    WHERE au.role = 'OPERATOR'::public.app_user_role AND au.active
    ORDER BY au.id LIMIT 1;

    SELECT f.station_id, f.id INTO v_station_id, v_feeder_id
    FROM public.feeders f
    WHERE coalesce(f.active, true)
    ORDER BY f.station_id, f.id LIMIT 1;

    IF v_user_id IS NULL OR v_station_id IS NULL THEN
      RAISE EXCEPTION 'No active operator or feeder available for rollback-only validation';
    END IF;

    -- This assignment exists only until the enclosing transaction rolls back.
    INSERT INTO public.user_stations (user_id, station_id, active)
    VALUES (v_user_id, v_station_id, true);
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  v_id_first := public.sync_historical_interruption(
    v_station_id, v_feeder_id, v_start, v_end, 'Stage 7 rollback validation',
    'Rollback-only validation; no production row retained', NULL,
    v_start + interval '2 minutes', v_end + interval '2 minutes', v_add_id, v_restore_id
  );
  v_id_retry := public.sync_historical_interruption(
    v_station_id, v_feeder_id, v_start, v_end, 'Stage 7 rollback validation',
    'Rollback-only validation; no production row retained', NULL,
    v_start + interval '2 minutes', v_end + interval '2 minutes', v_add_id, v_restore_id
  );

  IF v_id_first IS DISTINCT FROM v_id_retry THEN
    RAISE EXCEPTION 'Historical retry returned a different interruption';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.interruptions i
    WHERE i.id = v_id_first
      AND i.current_status = 'RESTORED'
      AND i.client_operation_id = v_add_id
      AND i.restore_client_operation_id = v_restore_id
      AND i.interruption_start = v_start
      AND i.interruption_end = v_end
      AND i.entry_mode = 'OFFLINE'
  ) THEN
    RAISE EXCEPTION 'Historical interruption provenance validation failed';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.notification_events e
  WHERE e.source_operation_id = 'historical-interruption:' || v_restore_id
    AND e.notification_class = 'HISTORICAL_SYNC'
    AND e.source_entry_mode = 'OFFLINE';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one historical notification event, found %', v_event_count;
  END IF;

  RAISE NOTICE 'Stage 7 rollback validation passed: one restored interruption and one idempotent historical event';
END;
$stage7$;

-- A PostgREST RPC call is its own transaction. Reset the transaction-local
-- suppression flag here because this validation intentionally batches several
-- otherwise separate scenarios inside one outer rollback transaction.
SELECT set_config('gridvision.historical_sync', 'off', true);

DO $stage7_triggers$
DECLARE
  v_user_id uuid;
  v_station_id uuid;
  v_feeder_id uuid;
  v_live_id uuid;
  v_delayed_id uuid;
  v_live_operation_id text := 'stage7-live-' || gen_random_uuid()::text;
  v_delayed_operation_id text := 'stage7-delayed-' || gen_random_uuid()::text;
  v_restore_operation_id text := 'stage7-delayed-restore-' || gen_random_uuid()::text;
  v_count integer;
  v_conflict_rejected boolean := false;
BEGIN
  SELECT au.id, usa.station_id, f.id
  INTO v_user_id, v_station_id, v_feeder_id
  FROM public.app_users au
  JOIN public.user_stations usa ON usa.user_id = au.id AND usa.active
  JOIN public.feeders f ON f.station_id = usa.station_id AND coalesce(f.active, true)
  WHERE au.role = 'OPERATOR'::public.app_user_role
    AND au.active
    AND NOT EXISTS (
      SELECT 1 FROM public.interruptions existing
      WHERE existing.feeder_id = f.id AND existing.current_status = 'OPEN'
    )
  ORDER BY au.id, f.id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No interruption-free assigned feeder available for rollback-only trigger validation';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  INSERT INTO public.interruptions (
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '3 hours', 'OPEN',
    'ONLINE', now() - interval '3 hours', v_live_operation_id
  ) RETURNING id INTO v_live_id;

  SELECT count(*) INTO v_count FROM public.notification_events
  WHERE notification_class = 'LIVE' AND source_entry_mode = 'ONLINE'
    AND feeder_id = v_feeder_id AND event_time = now() - interval '3 hours';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected one LIVE trip event, found %', v_count; END IF;

  BEGIN
    INSERT INTO public.interruptions (
      station_id, feeder_id, operator_id, interruption_start, current_status
    ) VALUES (
      v_station_id, v_feeder_id, v_user_id, now() - interval '2 hours 50 minutes', 'OPEN'
    );
  EXCEPTION WHEN unique_violation THEN
    v_conflict_rejected := true;
  END;
  IF NOT v_conflict_rejected THEN RAISE EXCEPTION 'Second OPEN interruption was not rejected'; END IF;

  UPDATE public.interruptions
  SET interruption_end = now() - interval '2 hours 30 minutes',
      duration_minutes = 30,
      current_status = 'RESTORED'
  WHERE id = v_live_id;

  SELECT count(*) INTO v_count FROM public.notification_events
  WHERE notification_class = 'LIVE' AND source_entry_mode = 'ONLINE'
    AND feeder_id = v_feeder_id
    AND event_time IN (now() - interval '3 hours', now() - interval '2 hours 30 minutes');
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected LIVE trip and restoration events, found %', v_count; END IF;

  INSERT INTO public.interruptions (
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, synced_at, client_operation_id
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '2 hours', 'OPEN',
    'OFFLINE', now() - interval '1 hour 58 minutes', now(), v_delayed_operation_id
  ) RETURNING id INTO v_delayed_id;

  UPDATE public.interruptions
  SET interruption_end = now() - interval '90 minutes',
      duration_minutes = 30,
      current_status = 'RESTORED',
      restore_client_operation_id = v_restore_operation_id,
      recorded_at = now() - interval '88 minutes',
      synced_at = now()
  WHERE id = v_delayed_id;

  SELECT count(*) INTO v_count FROM public.notification_events
  WHERE notification_class = 'DELAYED_SYNC' AND source_entry_mode = 'OFFLINE'
    AND feeder_id = v_feeder_id
    AND event_time IN (now() - interval '2 hours', now() - interval '90 minutes');
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected delayed trip and restoration events, found %', v_count; END IF;

  IF (SELECT client_operation_id FROM public.interruptions WHERE id = v_delayed_id) <> v_delayed_operation_id THEN
    RAISE EXCEPTION 'Restore overwrote the ADD client operation identity';
  END IF;

  RAISE NOTICE 'Stage 7 rollback trigger validation passed: LIVE, DELAYED_SYNC, identity preservation, and genuine OPEN conflict';
END;
$stage7_triggers$;

ROLLBACK;
