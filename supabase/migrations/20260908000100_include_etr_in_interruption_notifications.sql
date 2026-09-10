-- Include an initial ETR in interruption notification text when it is known.
-- ETR-only updates continue to return before creating a notification event.
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
    IF NEW.etr IS NOT NULL THEN
      v_message := v_message || '. ETR: '
        || to_char(NEW.etr AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM');
    ELSE
      v_message := v_message || '. ETR: Awaiting assessment';
    END IF;
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
  RAISE WARNING 'Interruption notification generation failed.';
  RETURN NEW;
END;
$$;
