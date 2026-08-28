-- Historical completeness uses currently active feeders because feeder activation
-- history is not stored. Access is enforced by the existing station-scope helper.
CREATE OR REPLACE FUNCTION public.get_logbook_report_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  entered_readings bigint,
  expected_readings bigint,
  completeness_percent numeric,
  feeders_reported bigint,
  missing_feeder_hours bigint
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
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), base AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.feeder_id
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start
    AND l.actual_event_time < p_end
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC
), expected AS (
  SELECT
    (SELECT count(*)::bigint FROM scope_feeders) * coalesce((
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
), entered AS (
  SELECT count(*)::bigint AS slots, count(DISTINCT feeder_id)::bigint AS feeders
  FROM base
)
SELECT
  entered.slots,
  expected.slots,
  CASE WHEN expected.slots > 0
    THEN round(least(100, entered.slots::numeric * 100 / expected.slots), 1)
    ELSE 0
  END,
  entered.feeders,
  greatest(expected.slots - entered.slots, 0)
FROM expected
CROSS JOIN entered;
$$;

GRANT EXECUTE ON FUNCTION public.get_logbook_report_summary(timestamptz, timestamptz, uuid, uuid) TO authenticated;
