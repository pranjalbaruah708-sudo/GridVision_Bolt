-- Compact, utility-wide dashboard resources. Scope is always the current
-- user's accessible stations; no client-supplied station scope is accepted.
-- Completeness uses currently active feeders because activation history is
-- not recorded.

CREATE OR REPLACE FUNCTION public.get_dashboard_operational_summary(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  peak_mw numeric,
  peak_time timestamptz,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric,
  stations_reporting bigint,
  total_stations bigint,
  feeders_reporting bigint,
  total_feeders bigint,
  open_interruptions bigint,
  interruption_stations bigint,
  active_parameter_alerts bigint,
  alert_feeders bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_stations AS (
  SELECT s.id AS station_id
  FROM public.stations s
  JOIN accessible a ON a.station_id = s.id
  WHERE coalesce(s.active, true) = true
), scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id
  FROM public.feeders f
  JOIN scope_stations s ON s.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
), expected_hours AS (
  SELECT count(*)::bigint AS hour_count
  FROM generate_series(
    date_trunc('hour', p_start AT TIME ZONE 'Asia/Kolkata'),
    date_trunc('hour', p_end AT TIME ZONE 'Asia/Kolkata') - interval '1 hour',
    interval '1 hour'
  ) AS h(local_hour)
  WHERE h.local_hour <= date_trunc('hour', now() AT TIME ZONE 'Asia/Kolkata')
), base AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.station_id,
    l.feeder_id,
    l.mw,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start
    AND l.actual_event_time < p_end
    AND date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
      <= date_trunc('hour', now() AT TIME ZONE 'Asia/Kolkata')
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC,
    l.id DESC
), hourly AS (
  SELECT local_hour, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base
  GROUP BY local_hour
), peak AS (
  SELECT total_mw, local_hour
  FROM hourly
  WHERE total_mw IS NOT NULL
  ORDER BY total_mw DESC, local_hour ASC
  LIMIT 1
), interruption_counts AS (
  SELECT
    count(*)::bigint AS total,
    count(DISTINCT i.station_id)::bigint AS stations
  FROM public.interruptions i
  JOIN accessible a ON a.station_id = i.station_id
  WHERE i.current_status = 'OPEN'
), alert_counts AS (
  SELECT
    count(*)::bigint AS total,
    count(DISTINCT a.feeder_id)::bigint AS feeders
  FROM public.parameter_alerts a
  JOIN accessible scope ON scope.station_id = a.station_id
)
SELECT
  peak.total_mw,
  peak.local_hour AT TIME ZONE 'Asia/Kolkata',
  (SELECT count(*)::bigint FROM base),
  (SELECT count(*)::bigint FROM scope_feeders) * (SELECT hour_count FROM expected_hours),
  CASE
    WHEN (SELECT count(*) FROM scope_feeders) * (SELECT hour_count FROM expected_hours) > 0
      THEN round(least(100, (SELECT count(*)::numeric FROM base) * 100 /
        ((SELECT count(*) FROM scope_feeders) * (SELECT hour_count FROM expected_hours))), 1)
    ELSE 0
  END,
  (SELECT count(DISTINCT station_id)::bigint FROM base),
  (SELECT count(*)::bigint FROM scope_stations),
  (SELECT count(DISTINCT feeder_id)::bigint FROM base),
  (SELECT count(*)::bigint FROM scope_feeders),
  interruption_counts.total,
  interruption_counts.stations,
  alert_counts.total,
  alert_counts.feeders
FROM peak
RIGHT JOIN interruption_counts ON true
RIGHT JOIN alert_counts ON true;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_today_load_trend(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  hour_no integer,
  hour_time timestamptz,
  total_mw numeric,
  entered_feeders bigint,
  expected_feeders bigint,
  fill_status text
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
  FROM public.feeders f
  JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
), base AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.feeder_id,
    l.mw,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC,
    l.id DESC
), hours AS (
  SELECT
    extract(hour FROM h.local_hour)::integer AS hour_no,
    h.local_hour,
    h.local_hour AT TIME ZONE 'Asia/Kolkata' AS hour_time
  FROM generate_series(
    date_trunc('hour', p_start AT TIME ZONE 'Asia/Kolkata'),
    date_trunc('hour', p_end AT TIME ZONE 'Asia/Kolkata') - interval '1 hour',
    interval '1 hour'
  ) AS h(local_hour)
), per_hour AS (
  SELECT
    local_hour,
    count(*)::bigint AS entered_feeders,
    sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base
  GROUP BY local_hour
)
SELECT
  h.hour_no,
  h.hour_time,
  p.total_mw,
  coalesce(p.entered_feeders, 0),
  (SELECT count(*)::bigint FROM scope_feeders),
  CASE
    WHEN h.local_hour > date_trunc('hour', now() AT TIME ZONE 'Asia/Kolkata') THEN 'FUTURE'
    WHEN coalesce(p.entered_feeders, 0) = 0 THEN 'EMPTY'
    WHEN coalesce(p.entered_feeders, 0) >= (SELECT count(*) FROM scope_feeders) THEN 'FULL'
    ELSE 'PARTIAL'
  END
FROM hours h
LEFT JOIN per_hour p ON p.local_hour = h.local_hour
ORDER BY h.hour_no;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_attention_items(
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  issue_type text,
  station_id uuid,
  station_name text,
  issue_count bigint,
  completeness_percent numeric,
  severity text
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
  FROM public.stations s
  JOIN accessible a ON a.station_id = s.id
  WHERE coalesce(s.active, true) = true
), scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id
  FROM public.feeders f
  JOIN scope_stations s ON s.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
), expected_hours AS (
  SELECT count(*)::bigint AS hour_count
  FROM generate_series(
    date_trunc('hour', p_start AT TIME ZONE 'Asia/Kolkata'),
    date_trunc('hour', p_end AT TIME ZONE 'Asia/Kolkata') - interval '1 hour',
    interval '1 hour'
  ) AS h(local_hour)
  WHERE h.local_hour <= date_trunc('hour', now() AT TIME ZONE 'Asia/Kolkata')
), base AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.station_id,
    l.feeder_id
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start
    AND l.actual_event_time < p_end
    AND date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
      <= date_trunc('hour', now() AT TIME ZONE 'Asia/Kolkata')
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC,
    l.id DESC
), station_completeness AS (
  SELECT
    s.station_id,
    s.station_name,
    count(DISTINCT f.feeder_id)::bigint AS feeder_count,
    count(b.feeder_id)::bigint AS entered_count
  FROM scope_stations s
  LEFT JOIN scope_feeders f ON f.station_id = s.station_id
  LEFT JOIN base b ON b.feeder_id = f.feeder_id
  GROUP BY s.station_id, s.station_name
), issues AS (
  SELECT
    'INTERRUPTION'::text AS issue_type,
    s.station_id,
    s.station_name,
    count(i.id)::bigint AS issue_count,
    NULL::numeric AS completeness_percent,
    'HIGH'::text AS severity,
    1 AS priority
  FROM scope_stations s
  JOIN public.interruptions i ON i.station_id = s.station_id
  WHERE i.current_status = 'OPEN'
  GROUP BY s.station_id, s.station_name

  UNION ALL

  SELECT
    'PARAMETER_ALERT', s.station_id, s.station_name,
    count(a.id)::bigint, NULL::numeric, 'MEDIUM'::text, 2
  FROM scope_stations s
  JOIN public.parameter_alerts a ON a.station_id = s.station_id
  GROUP BY s.station_id, s.station_name

  UNION ALL

  SELECT
    'COMPLETENESS',
    c.station_id,
    c.station_name,
    0::bigint,
    CASE WHEN c.feeder_count * (SELECT hour_count FROM expected_hours) > 0
      THEN round(least(100, c.entered_count::numeric * 100 /
        (c.feeder_count * (SELECT hour_count FROM expected_hours))), 1)
      ELSE 0 END,
    'LOW'::text,
    3
  FROM station_completeness c
  WHERE CASE WHEN c.feeder_count * (SELECT hour_count FROM expected_hours) > 0
    THEN c.entered_count::numeric * 100 /
      (c.feeder_count * (SELECT hour_count FROM expected_hours))
    ELSE 0 END < 90
)
SELECT issue_type, station_id, station_name, issue_count, completeness_percent, severity
FROM issues
ORDER BY priority, CASE WHEN priority = 3 THEN completeness_percent END ASC NULLS LAST, issue_count DESC, station_name
LIMIT greatest(1, least(coalesce(p_limit, 5), 5));
$$;
