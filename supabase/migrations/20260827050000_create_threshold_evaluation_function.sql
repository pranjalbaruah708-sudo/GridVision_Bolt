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

    IF v_threshold.min_value IS NOT NULL
       AND v_actual_value < v_threshold.min_value THEN
      v_breach_type := 'BELOW_MIN';
    ELSIF v_threshold.max_value IS NOT NULL
       AND v_actual_value > v_threshold.max_value THEN
      v_breach_type := 'ABOVE_MAX';
    END IF;

    IF v_breach_type IS NULL THEN
      DELETE FROM public.parameter_alerts
      WHERE log_book_entry_id = NEW.id
        AND parameter_code = v_threshold.parameter_code;
      CONTINUE;
    END IF;

    INSERT INTO public.parameter_alerts (
      log_book_entry_id,
      station_id,
      feeder_id,
      threshold_id,
      parameter_code,
      actual_value,
      min_value,
      max_value,
      breach_type,
      triggered_at
    ) VALUES (
      NEW.id,
      NEW.station_id,
      NEW.feeder_id,
      v_threshold.id,
      v_threshold.parameter_code,
      v_actual_value,
      v_threshold.min_value,
      v_threshold.max_value,
      v_breach_type,
      NEW.actual_event_time
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
      triggered_at = EXCLUDED.triggered_at;
  END LOOP;

  RETURN NEW;
END;
$$;
