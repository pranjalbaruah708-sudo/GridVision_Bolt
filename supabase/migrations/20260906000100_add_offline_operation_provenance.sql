BEGIN;

ALTER TABLE public.log_book_entries
  ADD COLUMN IF NOT EXISTS entry_mode text,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_operation_id text;

ALTER TABLE public.interruptions
  ADD COLUMN IF NOT EXISTS entry_mode text,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_operation_id text;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS notification_class text,
  ADD COLUMN IF NOT EXISTS source_entry_mode text,
  ADD COLUMN IF NOT EXISTS source_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.log_book_entries'::regclass AND conname = 'log_book_entries_entry_mode_check') THEN
    ALTER TABLE public.log_book_entries ADD CONSTRAINT log_book_entries_entry_mode_check CHECK (entry_mode IS NULL OR entry_mode IN ('ONLINE', 'OFFLINE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.interruptions'::regclass AND conname = 'interruptions_entry_mode_check') THEN
    ALTER TABLE public.interruptions ADD CONSTRAINT interruptions_entry_mode_check CHECK (entry_mode IS NULL OR entry_mode IN ('ONLINE', 'OFFLINE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_events'::regclass AND conname = 'notification_events_class_check') THEN
    ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_class_check CHECK (notification_class IS NULL OR notification_class IN ('LIVE', 'DELAYED_SYNC', 'HISTORICAL_SYNC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_events'::regclass AND conname = 'notification_events_source_entry_mode_check') THEN
    ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_source_entry_mode_check CHECK (source_entry_mode IS NULL OR source_entry_mode IN ('ONLINE', 'OFFLINE'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS log_book_entries_client_operation_id_unique
  ON public.log_book_entries (client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS interruptions_client_operation_id_unique
  ON public.interruptions (client_operation_id)
  WHERE client_operation_id IS NOT NULL;

COMMENT ON COLUMN public.log_book_entries.entry_mode IS 'Whether the operation originated online or from the offline queue.';
COMMENT ON COLUMN public.log_book_entries.recorded_at IS 'Time the operator or device recorded the operation.';
COMMENT ON COLUMN public.log_book_entries.synced_at IS 'Time an offline-origin operation reached the backend.';
COMMENT ON COLUMN public.log_book_entries.client_operation_id IS 'Stable client replay identifier; not business identity.';
COMMENT ON COLUMN public.interruptions.entry_mode IS 'Whether the operation originated online or from the offline queue.';
COMMENT ON COLUMN public.interruptions.recorded_at IS 'Time the operator or device recorded the operation.';
COMMENT ON COLUMN public.interruptions.synced_at IS 'Time an offline-origin operation reached the backend.';
COMMENT ON COLUMN public.interruptions.client_operation_id IS 'Stable client replay identifier; not business identity.';
COMMENT ON COLUMN public.notification_events.notification_class IS 'Delivery classification: live, delayed offline sync, or historical sync.';
COMMENT ON COLUMN public.notification_events.source_entry_mode IS 'Entry mode of the operational row that generated this notification.';
COMMENT ON COLUMN public.notification_events.source_recorded_at IS 'Device/operator recording time copied from the source operation.';
COMMENT ON COLUMN public.notification_events.source_synced_at IS 'Backend synchronization time copied from the source operation.';

-- Preserve the existing six-argument function unchanged. This overload has no
-- defaults, so existing positional/named calls remain unambiguous.
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
  p_source_synced_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_event_id uuid;
BEGIN
  v_notification_event_id := public.create_notification_event(
    p_station_id,
    p_feeder_id,
    p_event_time,
    p_message,
    p_created_by,
    p_max_unit_type
  );

  UPDATE public.notification_events
  SET notification_class = p_notification_class,
      source_entry_mode = p_source_entry_mode,
      source_recorded_at = p_source_recorded_at,
      source_synced_at = p_source_synced_at
  WHERE id = v_notification_event_id;

  RETURN v_notification_event_id;
END;
$$;

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
  SELECT s.name INTO v_station_name
  FROM public.stations s
  WHERE s.id = NEW.station_id;

  IF NEW.feeder_id IS NOT NULL THEN
    SELECT f.name INTO v_feeder_name
    FROM public.feeders f
    WHERE f.id = NEW.feeder_id;
  END IF;

  v_station_name := COALESCE(v_station_name, 'Unknown Station');
  v_feeder_name := COALESCE(v_feeder_name, 'Feeder');

  IF TG_OP = 'INSERT' THEN
    IF NEW.current_status <> 'OPEN' THEN
      RETURN NEW;
    END IF;

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
        || round(EXTRACT(EPOCH FROM (NEW.interruption_end - NEW.interruption_start)) / 60)
        || ' minutes.';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  v_notification_class := CASE WHEN NEW.entry_mode = 'OFFLINE' THEN 'DELAYED_SYNC' ELSE 'LIVE' END;

  PERFORM public.create_notification_event(
    p_station_id => NEW.station_id,
    p_feeder_id => NEW.feeder_id,
    p_event_time => v_event_time,
    p_message => v_message,
    p_created_by => NEW.operator_id,
    p_max_unit_type => NULL,
    p_notification_class => v_notification_class,
    p_source_entry_mode => NEW.entry_mode,
    p_source_recorded_at => NEW.recorded_at,
    p_source_synced_at => NEW.synced_at
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Interruption notification generation failed for interruption %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

COMMIT;
