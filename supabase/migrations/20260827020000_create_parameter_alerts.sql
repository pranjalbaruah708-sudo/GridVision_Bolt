CREATE TABLE IF NOT EXISTS public.parameter_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_book_entry_id uuid NOT NULL
    REFERENCES public.log_book_entries(id)
    ON DELETE CASCADE,
  station_id uuid NOT NULL
    REFERENCES public.stations(id)
    ON DELETE RESTRICT,
  feeder_id uuid NOT NULL
    REFERENCES public.feeders(id)
    ON DELETE RESTRICT,
  threshold_id uuid NOT NULL
    REFERENCES public.feeder_thresholds(id)
    ON DELETE RESTRICT,
  parameter_code text NOT NULL,
  actual_value numeric NOT NULL,
  min_value numeric NULL,
  max_value numeric NULL,
  breach_type text NOT NULL
    CHECK (breach_type IN ('BELOW_MIN', 'ABOVE_MAX')),
  triggered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT parameter_alerts_parameter_check
    CHECK (
      parameter_code IN (
        'MW',
        'MVAR',
        'VOLTAGE_KV',
        'CURRENT_A',
        'POWER_FACTOR',
        'FREQUENCY_HZ',
        'TRANSFORMER_TEMP_C',
        'OIL_LEVEL_PERCENT'
      )
    )
);
