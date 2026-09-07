BEGIN;

DO $stage8$
DECLARE
  v_user_id uuid;
  v_station_id uuid;
  v_feeder_id uuid;
  v_live_entry uuid;
  v_stale_entry uuid;
  v_sequence_entry uuid;
  v_delayed_entry uuid;
  v_no_power_entry uuid;
  v_live_op text := 'stage8-live-' || gen_random_uuid()::text;
  v_stale_op text := 'stage8-stale-' || gen_random_uuid()::text;
  v_sequence_op text := 'stage8-sequence-' || gen_random_uuid()::text;
  v_delayed_op text := 'stage8-delayed-' || gen_random_uuid()::text;
  v_count integer;
BEGIN
  SELECT au.id INTO v_user_id
  FROM public.app_users au
  WHERE au.role = 'OPERATOR'::public.app_user_role AND au.active
  ORDER BY au.id LIMIT 1;

  SELECT f.station_id, f.id INTO v_station_id, v_feeder_id
  FROM public.feeders f
  JOIN public.feeder_thresholds ft ON ft.feeder_id = f.id
  WHERE f.active AND ft.parameter_code = 'TRANSFORMER_TEMP_C' AND ft.max_value IS NOT NULL
  ORDER BY f.station_id, f.id LIMIT 1;

  IF v_user_id IS NULL OR v_feeder_id IS NULL THEN
    RAISE EXCEPTION 'An active operator and transformer-temperature threshold are required';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  -- A. Online breach remains LIVE.
  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at, client_operation_id
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '40 seconds', 1, 33,
    1, 0.95, 50, 86, 90, 'ONLINE', now() - interval '40 seconds', v_live_op
  ) RETURNING id INTO v_live_entry;

  IF NOT EXISTS (
    SELECT 1 FROM public.parameter_alerts
    WHERE log_book_entry_id = v_live_entry AND parameter_code = 'TRANSFORMER_TEMP_C'
      AND notification_class = 'LIVE' AND is_current AND NOT notification_suppressed
  ) THEN RAISE EXCEPTION 'LIVE parameter alert classification failed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_events
    WHERE source_operation_id = 'parameter-alert:' || v_live_op || ':TRANSFORMER_TEMP_C'
      AND notification_class = 'LIVE'
  ) THEN RAISE EXCEPTION 'LIVE parameter notification event was not created'; END IF;

  -- C. A later authoritative normal reading is inserted first. Replaying the
  -- older breach afterwards must retain it as historical without a push event.
  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '20 seconds', 1, 33,
    1, 0.95, 50, 25, 90, 'ONLINE', now() - interval '20 seconds'
  );

  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at, synced_at, client_operation_id, offline_sequence_final
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '30 seconds', 1, 33,
    1, 0.95, 50, 86, 90, 'OFFLINE', now() - interval '29 seconds', now(), v_stale_op, true
  ) RETURNING id INTO v_stale_entry;

  IF NOT EXISTS (
    SELECT 1 FROM public.parameter_alerts
    WHERE log_book_entry_id = v_stale_entry AND notification_class = 'HISTORICAL_SYNC'
      AND NOT is_current AND notification_suppressed
  ) THEN RAISE EXCEPTION 'Superseded server reading was not classified historical'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_events
    WHERE source_operation_id = 'parameter-alert:' || v_stale_op || ':TRANSFORMER_TEMP_C'
  ) THEN RAISE EXCEPTION 'Superseded server reading created a notification event'; END IF;

  -- D. A client-known later queued reading suppresses the intermediate breach
  -- before that later reading has reached the server.
  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at, synced_at, client_operation_id, offline_sequence_final
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '15 seconds', 1, 33,
    1, 0.95, 50, 86, 90, 'OFFLINE', now() - interval '14 seconds', now(), v_sequence_op, false
  ) RETURNING id INTO v_sequence_entry;

  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at, synced_at, offline_sequence_final
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '14 seconds', 1, 33,
    1, 0.95, 50, 25, 90, 'OFFLINE', now() - interval '13 seconds', now(), true
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.parameter_alerts
    WHERE log_book_entry_id = v_sequence_entry AND notification_class = 'HISTORICAL_SYNC'
      AND NOT is_current AND notification_suppressed
  ) THEN RAISE EXCEPTION 'Queued-sequence breach was not classified historical'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_events
    WHERE source_operation_id = 'parameter-alert:' || v_sequence_op || ':TRANSFORMER_TEMP_C'
  ) THEN RAISE EXCEPTION 'Queued-sequence breach created a notification event'; END IF;

  -- B/F/G. Latest offline breach is delayed, and re-evaluation remains
  -- idempotent for both the alert row and notification event.
  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, power_factor, frequency_hz, transformer_temp_c, oil_level_percent,
    entry_mode, recorded_at, synced_at, client_operation_id, offline_sequence_final
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '1 second', 1, 33,
    1, 0.95, 50, 86, 90, 'OFFLINE', now() - interval '500 milliseconds', now(), v_delayed_op, true
  ) RETURNING id INTO v_delayed_entry;

  UPDATE public.log_book_entries SET transformer_temp_c = 86 WHERE id = v_delayed_entry;

  SELECT count(*) INTO v_count FROM public.parameter_alerts
  WHERE log_book_entry_id = v_delayed_entry AND parameter_code = 'TRANSFORMER_TEMP_C'
    AND notification_class = 'DELAYED_SYNC' AND is_current AND NOT notification_suppressed;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected one delayed parameter alert, found %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.notification_events
  WHERE source_operation_id = 'parameter-alert:' || v_delayed_op || ':TRANSFORMER_TEMP_C'
    AND notification_class = 'DELAYED_SYNC';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected one delayed notification event after retry, found %', v_count; END IF;

  -- H. Existing no-power semantics still remove alerts for the entry.
  INSERT INTO public.log_book_entries (
    station_id, feeder_id, operator_id, actual_event_time, mw, voltage_kv,
    current_a, transformer_temp_c, entry_mode, recorded_at
  ) VALUES (
    v_station_id, v_feeder_id, v_user_id, now() - interval '5 seconds', 0, 0,
    0, 86, 'ONLINE', now() - interval '5 seconds'
  ) RETURNING id INTO v_no_power_entry;

  IF EXISTS (SELECT 1 FROM public.parameter_alerts WHERE log_book_entry_id = v_no_power_entry) THEN
    RAISE EXCEPTION 'No-power entry retained parameter alerts';
  END IF;

  RAISE NOTICE 'Stage 8 rollback validation passed';
END;
$stage8$;

ROLLBACK;
