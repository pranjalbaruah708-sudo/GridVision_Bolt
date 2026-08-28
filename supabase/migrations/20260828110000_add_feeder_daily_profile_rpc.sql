-- Feeder-only daily profile for the Load & System Analysis range chart.
-- The function deliberately returns one aggregate per IST date; raw
-- logbook rows remain limited to the selected feeder/day detail view.

CREATE OR REPLACE FUNCTION public.get_load_analysis_feeder_daily_profile(
  p_feeder_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_parameter_code text
)
RETURNS TABLE (
  profile_date date,
  value numeric,
  source_time timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeder AS (
  SELECT f.id AS feeder_id
  FROM public.feeders f
  JOIN accessible a ON a.station_id = f.station_id
  WHERE f.id = p_feeder_id
    AND coalesce(f.active, true) = true
), deduplicated AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.actual_event_time,
    (l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS local_date,
    CASE p_parameter_code
      WHEN 'MW' THEN l.mw
      WHEN 'MVAR' THEN l.mvar
      WHEN 'VOLTAGE' THEN l.voltage_kv
      WHEN 'CURRENT' THEN l.current_a
      WHEN 'PF' THEN l.power_factor
      ELSE NULL
    END AS parameter_value
  FROM public.log_book_entries l
  JOIN scope_feeder f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start
    AND l.actual_event_time < p_end
    AND p_parameter_code IN ('MW', 'MVAR', 'VOLTAGE', 'CURRENT', 'PF')
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC,
    l.id DESC
), ranked AS (
  SELECT
    local_date,
    parameter_value,
    actual_event_time,
    row_number() OVER (
      PARTITION BY local_date
      ORDER BY
        CASE WHEN p_parameter_code IN ('VOLTAGE', 'PF')
          THEN parameter_value END ASC NULLS LAST,
        CASE WHEN p_parameter_code NOT IN ('VOLTAGE', 'PF')
          THEN parameter_value END DESC NULLS LAST,
        actual_event_time ASC
    ) AS rank_no
  FROM deduplicated
  WHERE parameter_value IS NOT NULL
)
SELECT
  local_date,
  parameter_value,
  actual_event_time
FROM ranked
WHERE rank_no = 1
ORDER BY local_date;
$$;
