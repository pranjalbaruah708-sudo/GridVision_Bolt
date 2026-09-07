BEGIN;

ALTER TABLE public.log_book_entries
  ADD COLUMN IF NOT EXISTS offline_sequence_final boolean;

COMMENT ON COLUMN public.log_book_entries.offline_sequence_final IS
  'For offline replay, whether this is the latest queued reading for its feeder. NULL for online/legacy entries.';

ALTER TABLE public.parameter_alerts
  ADD COLUMN IF NOT EXISTS notification_class text,
  ADD COLUMN IF NOT EXISTS source_entry_mode text,
  ADD COLUMN IF NOT EXISTS source_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_suppressed boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.parameter_alerts'::regclass
      AND conname = 'parameter_alerts_notification_class_check'
  ) THEN
    ALTER TABLE public.parameter_alerts
      ADD CONSTRAINT parameter_alerts_notification_class_check
      CHECK (notification_class IS NULL OR notification_class IN ('LIVE', 'DELAYED_SYNC', 'HISTORICAL_SYNC'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.parameter_alerts'::regclass
      AND conname = 'parameter_alerts_source_entry_mode_check'
  ) THEN
    ALTER TABLE public.parameter_alerts
      ADD CONSTRAINT parameter_alerts_source_entry_mode_check
      CHECK (source_entry_mode IS NULL OR source_entry_mode IN ('ONLINE', 'OFFLINE'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.parameter_alerts.notification_class IS 'LIVE, DELAYED_SYNC, or HISTORICAL_SYNC classification inherited from the source reading.';
COMMENT ON COLUMN public.parameter_alerts.is_current IS 'False when a later effective reading or queued-sequence hint proves this breach was superseded before synchronization.';
COMMENT ON COLUMN public.parameter_alerts.notification_suppressed IS 'True when a stale historical breach is retained for audit but intentionally produces no push notification.';

CREATE OR REPLACE FUNCTION public.evaluate_logbook_parameter_thresholds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold record;
  v_actual_value numeric;
  v_breach_type text;
  v_no_power boolean;
  v_has_later_reading boolean;
  v_notification_class text;
  v_is_current boolean;
  v_notification_suppressed boolean;
  v_source_operation_id text;
  v_feeder_name text;
  v_station_name text;
  v_limit_text text;
  v_message text;
BEGIN
  IF NEW.feeder_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_no_power :=
    NEW.mw IS NOT NULL
    AND NEW.voltage_kv IS NOT NULL
    AND NEW.current_a IS NOT NULL
    AND NEW.mw = 0
    AND NEW.voltage_kv = 0
    AND NEW.current_a = 0;

  IF v_no_power THEN
    DELETE FROM public.parameter_alerts
    WHERE log_book_entry_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Indexed by feeder_id + actual_event_time. The client hint prevents an
  -- obsolete notification while a later reading in the same offline queue has
  -- not reached the server yet; the database check covers other devices/users.
  SELECT EXISTS (
    SELECT 1
    FROM public.log_book_entries later
    WHERE later.station_id = NEW.station_id
      AND later.feeder_id = NEW.feeder_id
      AND later.actual_event_time > NEW.actual_event_time
  ) INTO v_has_later_reading;

  IF NEW.entry_mode = 'OFFLINE' THEN
    v_is_current := COALESCE(NEW.offline_sequence_final, true) AND NOT v_has_later_reading;
    v_notification_class := CASE WHEN v_is_current THEN 'DELAYED_SYNC' ELSE 'HISTORICAL_SYNC' END;
    -- There is no severity field in the current schema, so all stale historical
    -- parameter pushes are conservatively suppressed.
    v_notification_suppressed := NOT v_is_current;
  ELSE
    -- Legacy NULL provenance and online entry preserve live behaviour. Event
    -- age alone never changes the classification.
    v_is_current := true;
    v_notification_class := 'LIVE';
    v_notification_suppressed := false;
  END IF;

  SELECT f.name, s.name INTO v_feeder_name, v_station_name
  FROM public.feeders f
  JOIN public.stations s ON s.id = f.station_id
  WHERE f.id = NEW.feeder_id AND s.id = NEW.station_id;

  FOR v_threshold IN
    SELECT ft.id, ft.parameter_code, ft.min_value, ft.max_value
    FROM public.feeder_thresholds ft
    WHERE ft.feeder_id = NEW.feeder_id
  LOOP
    v_actual_value := NULL;
    v_breach_type := NULL;

    CASE v_threshold.parameter_code
      WHEN 'MW' THEN v_actual_value := NEW.mw;
      WHEN 'MVAR' THEN v_actual_value := NEW.mvar;
      WHEN 'VOLTAGE_KV' THEN v_actual_value := NEW.voltage_kv;
      WHEN 'CURRENT_A' THEN v_actual_value := NEW.current_a;
      WHEN 'POWER_FACTOR' THEN v_actual_value := NEW.power_factor;
      WHEN 'FREQUENCY_HZ' THEN v_actual_value := NEW.frequency_hz;
      WHEN 'TRANSFORMER_TEMP_C' THEN v_actual_value := NEW.transformer_temp_c;
      WHEN 'OIL_LEVEL_PERCENT' THEN v_actual_value := NEW.oil_level_percent;
      ELSE v_actual_value := NULL;
    END CASE;

    IF v_actual_value IS NULL THEN
      DELETE FROM public.parameter_alerts
      WHERE log_book_entry_id = NEW.id
        AND parameter_code = v_threshold.parameter_code;
      CONTINUE;
    END IF;

    IF v_threshold.min_value IS NOT NULL AND v_actual_value < v_threshold.min_value THEN
      v_breach_type := 'BELOW_MIN';
    ELSIF v_threshold.max_value IS NOT NULL AND v_actual_value > v_threshold.max_value THEN
      v_breach_type := 'ABOVE_MAX';
    END IF;

    IF v_breach_type IS NULL THEN
      DELETE FROM public.parameter_alerts
      WHERE log_book_entry_id = NEW.id
        AND parameter_code = v_threshold.parameter_code;
      CONTINUE;
    END IF;

    INSERT INTO public.parameter_alerts (
      log_book_entry_id, station_id, feeder_id, threshold_id, parameter_code,
      actual_value, min_value, max_value, breach_type, triggered_at,
      notification_class, source_entry_mode, source_recorded_at,
      source_synced_at, is_current, notification_suppressed
    ) VALUES (
      NEW.id, NEW.station_id, NEW.feeder_id, v_threshold.id, v_threshold.parameter_code,
      v_actual_value, v_threshold.min_value, v_threshold.max_value, v_breach_type,
      NEW.actual_event_time, v_notification_class, NEW.entry_mode, NEW.recorded_at,
      NEW.synced_at, v_is_current, v_notification_suppressed
    )
    ON CONFLICT (log_book_entry_id, parameter_code)
    DO UPDATE SET
      station_id = EXCLUDED.station_id,
      feeder_id = EXCLUDED.feeder_id,
      threshold_id = EXCLUDED.threshold_id,
      actual_value = EXCLUDED.actual_value,
      min_value = EXCLUDED.min_value,
      max_value = EXCLUDED.max_value,
      breach_type = EXCLUDED.breach_type,
      triggered_at = EXCLUDED.triggered_at,
      notification_class = EXCLUDED.notification_class,
      source_entry_mode = EXCLUDED.source_entry_mode,
      source_recorded_at = EXCLUDED.source_recorded_at,
      source_synced_at = EXCLUDED.source_synced_at,
      is_current = EXCLUDED.is_current,
      notification_suppressed = EXCLUDED.notification_suppressed;

    IF NOT v_notification_suppressed THEN
      v_limit_text := CASE
        WHEN v_breach_type = 'BELOW_MIN' THEN 'minimum ' || v_threshold.min_value
        ELSE 'maximum ' || v_threshold.max_value
      END;
      v_message := COALESCE(v_feeder_name, 'Feeder') || ' at '
        || COALESCE(v_station_name, 'Unknown Station') || ': '
        || v_threshold.parameter_code || ' measured ' || v_actual_value
        || ', outside configured ' || v_limit_text || ' at '
        || to_char(NEW.actual_event_time AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';
      IF v_notification_class = 'DELAYED_SYNC' AND NEW.synced_at IS NOT NULL THEN
        v_message := v_message || ' Recorded offline and synced at '
          || to_char(NEW.synced_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';
      END IF;

      v_source_operation_id := 'parameter-alert:'
        || COALESCE(NULLIF(NEW.client_operation_id, ''), NEW.id::text)
        || ':' || v_threshold.parameter_code;

      BEGIN
        PERFORM public.create_notification_event(
          NEW.station_id, NEW.feeder_id, NEW.actual_event_time, v_message,
          NEW.operator_id, NULL, v_notification_class, NEW.entry_mode,
          NEW.recorded_at, NEW.synced_at, v_source_operation_id
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Parameter alert notification generation failed for log entry %, parameter %: %',
          NEW.id, v_threshold.parameter_code, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_logbook_parameter_thresholds() FROM PUBLIC, anon, authenticated;

COMMIT;
