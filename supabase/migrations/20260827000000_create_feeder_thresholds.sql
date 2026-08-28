CREATE TABLE IF NOT EXISTS public.feeder_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id uuid NOT NULL REFERENCES public.feeders(id) ON DELETE CASCADE,
  parameter_code text NOT NULL,
  min_value numeric NULL,
  max_value numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT feeder_thresholds_parameter_check
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
    ),

  CONSTRAINT feeder_thresholds_has_limit_check
    CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),

  CONSTRAINT feeder_thresholds_min_max_check
    CHECK (
      min_value IS NULL
      OR max_value IS NULL
      OR min_value <= max_value
    ),

  CONSTRAINT feeder_thresholds_unique_parameter
    UNIQUE (feeder_id, parameter_code)
);
