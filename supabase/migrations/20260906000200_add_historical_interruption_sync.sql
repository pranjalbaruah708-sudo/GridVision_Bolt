BEGIN;

ALTER TABLE public.interruptions
  ADD COLUMN IF NOT EXISTS restore_client_operation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS interruptions_restore_client_operation_id_unique
  ON public.interruptions (restore_client_operation_id)
  WHERE restore_client_operation_id IS NOT NULL;

COMMENT ON COLUMN public.interruptions.restore_client_operation_id IS
  'Stable client replay identifier for the restore operation; client_operation_id remains the interruption create identity.';

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS source_operation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS notification_events_source_operation_id_unique
  ON public.notification_events (source_operation_id)
  WHERE source_operation_id IS NOT NULL;

COMMENT ON COLUMN public.notification_events.source_operation_id IS
  'Optional stable source-operation key used to prevent duplicate replay-generated notification events.';

-- Idempotent provenance overload. Recipient resolution remains in the existing
-- six-argument create_notification_event function.
CREATE OR REPLACE FUNCTION public.create_notification_event(
  p_station_id uuid,
  p_feeder_id uuid,
  p_event_time timestamptz,
  p_message text,
  p_created_by uuid,
  p_max_unit_type text,
  p_notification_class text,
  p_source_entry_mode text,
  p_source_recorded_at timestamptz,
  p_source_synced_at timestamptz,
  p_source_operation_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_event_id uuid;
BEGIN
  IF p_source_operation_id IS NOT NULL THEN
    SELECT e.id INTO v_notification_event_id
    FROM public.notification_events e
    WHERE e.source_operation_id = p_source_operation_id;

    IF v_notification_event_id IS NOT NULL THEN
      RETURN v_notification_event_id;
    END IF;
  END IF;

  v_notification_event_id := public.create_notification_event(
    p_station_id,
    p_feeder_id,
    p_event_time,
    p_message,
    p_created_by,
    p_max_unit_type,
    p_notification_class,
    p_source_entry_mode,
    p_source_recorded_at,
    p_source_synced_at
  );

  UPDATE public.notification_events
  SET source_operation_id = p_source_operation_id
  WHERE id = v_notification_event_id;

  RETURN v_notification_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification_event(uuid, uuid, timestamptz, text, uuid, text, text, text, timestamptz, timestamptz, text) FROM PUBLIC;

-- The historical RPC may need to restore a matching ADD row left behind by a
-- prior successful server transaction whose client queue write/dequeue failed.
-- Suppress only the ordinary interruption trigger within that RPC transaction.
CREATE OR REPLACE FUNCTION public.handle_interruption_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_name text;
  v_feeder_name text;
  v_message text;
  v_event_time timestamptz;
  v_notification_class text;
BEGIN
  IF current_setting('gridvision.historical_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT s.name INTO v_station_name FROM public.stations s WHERE s.id = NEW.station_id;
  IF NEW.feeder_id IS NOT NULL THEN
    SELECT f.name INTO v_feeder_name FROM public.feeders f WHERE f.id = NEW.feeder_id;
  END IF;
  v_station_name := COALESCE(v_station_name, 'Unknown Station');
  v_feeder_name := COALESCE(v_feeder_name, 'Feeder');

  IF TG_OP = 'INSERT' THEN
    IF NEW.current_status <> 'OPEN' THEN RETURN NEW; END IF;
    v_event_time := NEW.interruption_start;
    v_message := v_feeder_name || ' at ' || v_station_name || ' tripped at '
      || to_char(NEW.interruption_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM');
    IF NEW.cause IS NOT NULL AND btrim(NEW.cause) <> '' THEN
      v_message := v_message || '. Cause: ' || NEW.cause;
    END IF;
    v_message := v_message || '.';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.current_status IS DISTINCT FROM NEW.current_status AND NEW.current_status = 'RESTORED') THEN
      RETURN NEW;
    END IF;
    v_event_time := COALESCE(NEW.interruption_end, now());
    v_message := v_feeder_name || ' at ' || v_station_name || ' restored at '
      || to_char(COALESCE(NEW.interruption_end, now()) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';
    IF NEW.interruption_start IS NOT NULL AND NEW.interruption_end IS NOT NULL THEN
      v_message := v_message || ' Interruption duration: '
        || round(EXTRACT(EPOCH FROM (NEW.interruption_end - NEW.interruption_start)) / 60) || ' minutes.';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Legacy NULL provenance remains LIVE. Age is deliberately not considered.
  v_notification_class := CASE WHEN NEW.entry_mode = 'OFFLINE' THEN 'DELAYED_SYNC' ELSE 'LIVE' END;
  IF v_notification_class = 'DELAYED_SYNC' AND NEW.synced_at IS NOT NULL THEN
    v_message := v_message || ' Recorded offline and synced at '
      || to_char(NEW.synced_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';
  END IF;
  PERFORM public.create_notification_event(
    NEW.station_id, NEW.feeder_id, v_event_time, v_message, NEW.operator_id, NULL,
    v_notification_class, NEW.entry_mode, NEW.recorded_at, NEW.synced_at
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Interruption notification generation failed for interruption %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_historical_interruption(
  p_station_id uuid,
  p_feeder_id uuid,
  p_interruption_start timestamptz,
  p_interruption_end timestamptz,
  p_cause text,
  p_remarks text,
  p_etr timestamptz,
  p_add_recorded_at timestamptz,
  p_restore_recorded_at timestamptz,
  p_add_client_operation_id text,
  p_restore_client_operation_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_interruption public.interruptions%ROWTYPE;
  v_feeder_name text;
  v_station_name text;
  v_synced_at timestamptz := now();
  v_duration numeric;
  v_message text;
  v_source_operation_id text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.get_my_role() IS DISTINCT FROM 'OPERATOR'::public.app_user_role
     OR NOT public.is_assigned_to_station(p_station_id) THEN
    RAISE EXCEPTION 'Not authorised for this station';
  END IF;
  IF p_add_client_operation_id IS NULL OR btrim(p_add_client_operation_id) = ''
     OR p_restore_client_operation_id IS NULL OR btrim(p_restore_client_operation_id) = '' THEN
    RAISE EXCEPTION 'Both client operation identifiers are required';
  END IF;
  IF p_interruption_start IS NULL OR p_interruption_end IS NULL
     OR p_interruption_end < p_interruption_start OR p_interruption_end > v_synced_at THEN
    RAISE EXCEPTION 'Invalid historical interruption timestamps';
  END IF;

  SELECT f.name, s.name INTO v_feeder_name, v_station_name
  FROM public.feeders f JOIN public.stations s ON s.id = f.station_id
  WHERE f.id = p_feeder_id AND f.station_id = p_station_id AND COALESCE(f.active, true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Feeder is not active at the authorised station'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_add_client_operation_id || ':' || p_restore_client_operation_id, 0));

  SELECT i.* INTO v_interruption
  FROM public.interruptions i
  WHERE i.client_operation_id = p_add_client_operation_id
     OR i.restore_client_operation_id = p_restore_client_operation_id
  ORDER BY (i.client_operation_id = p_add_client_operation_id AND i.restore_client_operation_id = p_restore_client_operation_id) DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_interruption.station_id <> p_station_id OR v_interruption.feeder_id IS DISTINCT FROM p_feeder_id
       OR v_interruption.operator_id IS DISTINCT FROM v_user_id
       OR (v_interruption.client_operation_id IS NOT NULL AND v_interruption.client_operation_id <> p_add_client_operation_id)
       OR (v_interruption.restore_client_operation_id IS NOT NULL AND v_interruption.restore_client_operation_id <> p_restore_client_operation_id) THEN
      RAISE EXCEPTION 'Client operation identifier conflicts with another interruption';
    END IF;
    -- Preserve the timestamp of the first successful backend acceptance on retry.
    v_synced_at := COALESCE(v_interruption.synced_at, v_synced_at);
  END IF;

  v_duration := round(EXTRACT(EPOCH FROM (p_interruption_end - p_interruption_start)) / 60);
  PERFORM set_config('gridvision.historical_sync', 'on', true);

  IF v_interruption.id IS NULL THEN
    INSERT INTO public.interruptions (
      station_id, feeder_id, operator_id, interruption_start, interruption_end,
      duration_minutes, cause, remarks, current_status, etr, entry_mode,
      recorded_at, synced_at, client_operation_id, restore_client_operation_id
    ) VALUES (
      p_station_id, p_feeder_id, v_user_id, p_interruption_start, p_interruption_end,
      v_duration, p_cause, p_remarks, 'RESTORED', p_etr, 'OFFLINE',
      p_add_recorded_at, v_synced_at, p_add_client_operation_id, p_restore_client_operation_id
    ) RETURNING * INTO v_interruption;
  ELSE
    UPDATE public.interruptions
    SET interruption_end = p_interruption_end,
        duration_minutes = v_duration,
        current_status = 'RESTORED',
        restore_client_operation_id = p_restore_client_operation_id,
        entry_mode = 'OFFLINE',
        recorded_at = COALESCE(recorded_at, p_add_recorded_at),
        synced_at = v_synced_at
    WHERE id = v_interruption.id
    RETURNING * INTO v_interruption;
  END IF;

  v_source_operation_id := 'historical-interruption:' || p_restore_client_operation_id;
  v_message := v_feeder_name || ' at ' || v_station_name || ' tripped at '
    || to_char(p_interruption_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')
    || ' and was restored at '
    || to_char(p_interruption_end AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')
    || '. Duration ' || v_duration || ' min. Synced at '
    || to_char(v_synced_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';

  PERFORM public.create_notification_event(
    p_station_id, p_feeder_id, p_interruption_end, v_message, v_user_id, NULL,
    'HISTORICAL_SYNC', 'OFFLINE', p_restore_recorded_at, v_synced_at, v_source_operation_id
  );

  RETURN v_interruption.id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_historical_interruption(uuid, uuid, timestamptz, timestamptz, text, text, timestamptz, timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_historical_interruption(uuid, uuid, timestamptz, timestamptz, text, text, timestamptz, timestamptz, timestamptz, text, text) TO authenticated;

COMMIT;
