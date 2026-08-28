-- Historical completeness uses currently active feeders because feeder activation
-- history is not stored. All functions explicitly enforce accessible station scope.

CREATE OR REPLACE FUNCTION public.get_load_analysis_overview(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  peak_mw numeric,
  peak_time timestamptz,
  minimum_voltage_kv numeric,
  minimum_voltage_time timestamptz,
  maximum_current_a numeric,
  maximum_current_time timestamptz,
  minimum_power_factor numeric,
  minimum_power_factor_time timestamptz,
  maximum_transformer_temp_c numeric,
  maximum_transformer_temp_time timestamptz,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id
  FROM public.feeders f
  JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.*, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC
), expected AS (
  SELECT
    (SELECT count(*)::bigint FROM scope_feeders) *
    coalesce((
      SELECT sum(CASE
        WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
        WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
          THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
        ELSE 0
      END)::bigint
      FROM generate_series(
        (p_start AT TIME ZONE 'Asia/Kolkata')::date,
        ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1),
        interval '1 day'
      ) AS d(day)
    ), 0) AS slots
), hourly AS (
  SELECT local_hour, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base GROUP BY local_hour
), entered AS (
  SELECT count(*)::bigint AS slots FROM base
), peak AS (
  SELECT total_mw, local_hour FROM hourly WHERE total_mw IS NOT NULL
  ORDER BY total_mw DESC, local_hour ASC LIMIT 1
), min_voltage AS (
  SELECT voltage_kv, actual_event_time FROM base WHERE voltage_kv IS NOT NULL
  ORDER BY voltage_kv ASC, actual_event_time ASC LIMIT 1
), max_current AS (
  SELECT current_a, actual_event_time FROM base WHERE current_a IS NOT NULL
  ORDER BY current_a DESC, actual_event_time ASC LIMIT 1
), min_pf AS (
  SELECT power_factor, actual_event_time FROM base WHERE power_factor IS NOT NULL
  ORDER BY power_factor ASC, actual_event_time ASC LIMIT 1
), max_temp AS (
  SELECT transformer_temp_c, actual_event_time FROM base WHERE transformer_temp_c IS NOT NULL
  ORDER BY transformer_temp_c DESC, actual_event_time ASC LIMIT 1
)
SELECT
  peak.total_mw,
  peak.local_hour AT TIME ZONE 'Asia/Kolkata',
  min_voltage.voltage_kv,
  min_voltage.actual_event_time,
  max_current.current_a,
  max_current.actual_event_time,
  min_pf.power_factor,
  min_pf.actual_event_time,
  max_temp.transformer_temp_c,
  max_temp.actual_event_time,
  entered.slots,
  expected.slots,
  CASE WHEN expected.slots > 0
    THEN round(least(100, entered.slots::numeric * 100 / expected.slots), 1)
    ELSE 0 END
FROM expected
CROSS JOIN entered
LEFT JOIN peak ON true
LEFT JOIN min_voltage ON true
LEFT JOIN max_current ON true
LEFT JOIN min_pf ON true
LEFT JOIN max_temp ON true;
$$;

CREATE OR REPLACE FUNCTION public.get_load_analysis_station_ranking(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  station_id uuid,
  station_name text,
  peak_mw numeric,
  minimum_power_factor numeric,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_stations AS (
  SELECT s.id AS station_id, s.name AS station_name
  FROM public.stations s JOIN accessible a ON a.station_id = s.id
  WHERE coalesce(s.active, true) = true
), scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id
  FROM public.feeders f JOIN scope_stations s ON s.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.station_id, l.feeder_id, l.mw, l.power_factor,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC
), hours AS (
  SELECT coalesce(sum(CASE
    WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
    WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
    ELSE 0 END), 0)::bigint AS count
  FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') AS d(day)
), hourly AS (
  SELECT station_id, local_hour, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base GROUP BY station_id, local_hour
), feeder_counts AS (
  SELECT station_id, count(*)::bigint AS feeder_count FROM scope_feeders GROUP BY station_id
), entered AS (
  SELECT station_id, count(*)::bigint AS entered_feeder_hours, min(power_factor) AS minimum_power_factor
  FROM base GROUP BY station_id
), peaks AS (
  SELECT station_id, max(total_mw) AS peak_mw FROM hourly GROUP BY station_id
)
SELECT s.station_id, s.station_name, p.peak_mw, e.minimum_power_factor,
  coalesce(e.entered_feeder_hours, 0), coalesce(f.feeder_count, 0) * hours.count,
  CASE WHEN coalesce(f.feeder_count, 0) * hours.count > 0
    THEN round(least(100, coalesce(e.entered_feeder_hours, 0)::numeric * 100 / (f.feeder_count * hours.count)), 1)
    ELSE 0 END
FROM scope_stations s
LEFT JOIN feeder_counts f ON f.station_id = s.station_id
LEFT JOIN entered e ON e.station_id = s.station_id
LEFT JOIN peaks p ON p.station_id = s.station_id
CROSS JOIN hours;
$$;

CREATE OR REPLACE FUNCTION public.get_load_analysis_feeder_ranking(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid
)
RETURNS TABLE (
  feeder_id uuid,
  feeder_name text,
  peak_mw numeric,
  minimum_power_factor numeric,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeders AS (
  SELECT f.id AS feeder_id, f.name AS feeder_name
  FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE f.station_id = p_station_id AND coalesce(f.active, true) = true
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id, l.mw, l.power_factor,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC
), hours AS (
  SELECT coalesce(sum(CASE
    WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
    WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
    ELSE 0 END), 0)::bigint AS count
  FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') AS d(day)
), hourly AS (
  SELECT feeder_id, local_hour, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base GROUP BY feeder_id, local_hour
), entered AS (
  SELECT feeder_id, count(*)::bigint AS entered_feeder_hours, min(power_factor) AS minimum_power_factor
  FROM base GROUP BY feeder_id
), peaks AS (
  SELECT feeder_id, max(total_mw) AS peak_mw FROM hourly GROUP BY feeder_id
)
SELECT f.feeder_id, f.feeder_name, p.peak_mw, e.minimum_power_factor,
  coalesce(e.entered_feeder_hours, 0), hours.count,
  CASE WHEN hours.count > 0 THEN round(least(100, coalesce(e.entered_feeder_hours, 0)::numeric * 100 / hours.count), 1) ELSE 0 END
FROM scope_feeders f
LEFT JOIN entered e ON e.feeder_id = f.feeder_id
LEFT JOIN peaks p ON p.feeder_id = f.feeder_id
CROSS JOIN hours;
$$;

CREATE OR REPLACE FUNCTION public.get_load_analysis_parameter_health(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  low_pf_feeder_count bigint,
  incomplete_feeder_count bigint,
  minimum_voltage_kv numeric,
  maximum_current_a numeric,
  maximum_transformer_temp_c numeric,
  completeness_percent numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeders AS (
  SELECT f.id AS feeder_id
  FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id, l.power_factor
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC
), hours AS (
  SELECT coalesce(sum(CASE
    WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
    WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
    ELSE 0 END), 0)::bigint AS count
  FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') AS d(day)
), entered_by_feeder AS (
  SELECT feeder_id, count(*)::bigint AS entered_hours FROM base GROUP BY feeder_id
), low_pf AS (
  -- Temporary analytics compatibility rule; this is not feeder_thresholds alert logic.
  SELECT count(DISTINCT feeder_id)::bigint AS count FROM base WHERE power_factor < 0.9
), incomplete AS (
  SELECT count(*)::bigint AS count
  FROM scope_feeders f
  LEFT JOIN entered_by_feeder e ON e.feeder_id = f.feeder_id
  CROSS JOIN hours
  WHERE coalesce(e.entered_hours, 0) < hours.count
), summary AS (
  SELECT * FROM public.get_load_analysis_overview(p_start, p_end, p_station_id, p_feeder_id)
)
SELECT
  low_pf.count,
  incomplete.count,
  s.minimum_voltage_kv,
  s.maximum_current_a,
  s.maximum_transformer_temp_c,
  s.completeness_percent
FROM summary s
CROSS JOIN low_pf
CROSS JOIN incomplete;
$$;
