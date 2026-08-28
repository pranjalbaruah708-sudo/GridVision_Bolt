-- Compact Load & Energy report aggregates. MW is never coalesced to zero:
-- an interval without a recorded MW value stays NULL in the returned series.
CREATE OR REPLACE FUNCTION public.get_load_energy_report_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  peak_mw numeric,
  peak_time timestamptz,
  minimum_mw numeric,
  minimum_time timestamptz,
  average_mw numeric,
  estimated_energy_mwh numeric,
  energy_eligible boolean,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeders AS (
  SELECT f.id AS feeder_id
  FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true)
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id, l.mw, l.actual_event_time,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC, l.id DESC
), hourly AS (
  SELECT local_hour, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base GROUP BY local_hour
), expected AS (
  SELECT (SELECT count(*)::bigint FROM scope_feeders) * coalesce((
    SELECT sum(CASE
      WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
      WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
      ELSE 0
    END)::bigint
    FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') AS d(day)
  ), 0) AS slots
), counts AS (
  SELECT count(*)::bigint AS entered, count(*) FILTER (WHERE mw IS NOT NULL)::bigint AS mw_entered
  FROM base
), peak AS (
  SELECT total_mw, local_hour FROM hourly WHERE total_mw IS NOT NULL ORDER BY total_mw DESC, local_hour ASC LIMIT 1
), minimum AS (
  SELECT total_mw, local_hour FROM hourly WHERE total_mw IS NOT NULL ORDER BY total_mw ASC, local_hour ASC LIMIT 1
)
SELECT peak.total_mw, peak.local_hour AT TIME ZONE 'Asia/Kolkata',
  minimum.total_mw, minimum.local_hour AT TIME ZONE 'Asia/Kolkata',
  round(avg(hourly.total_mw), 3),
  CASE WHEN expected.slots > 0 AND counts.entered = expected.slots AND counts.mw_entered = expected.slots
    THEN round(sum(hourly.total_mw), 3) ELSE NULL END,
  expected.slots > 0 AND counts.entered = expected.slots AND counts.mw_entered = expected.slots,
  counts.entered, expected.slots,
  CASE WHEN expected.slots > 0 THEN round(least(100, counts.entered::numeric * 100 / expected.slots), 1) ELSE 0 END
FROM expected CROSS JOIN counts
LEFT JOIN hourly ON true
LEFT JOIN peak ON true
LEFT JOIN minimum ON true
GROUP BY peak.total_mw, peak.local_hour, minimum.total_mw, minimum.local_hour, expected.slots, counts.entered, counts.mw_entered;
$$;

CREATE OR REPLACE FUNCTION public.get_load_energy_report_series(
  p_start timestamptz,
  p_end timestamptz,
  p_interval text,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  bucket_start timestamptz,
  peak_mw numeric,
  minimum_mw numeric,
  average_mw numeric,
  entered_feeder_hours bigint,
  expected_feeder_hours bigint,
  completeness_percent numeric,
  fill_status text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
), scope_feeders AS (
  SELECT f.id AS feeder_id
  FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true)
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), feeder_count AS (
  SELECT count(*)::bigint AS value FROM scope_feeders
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id, l.mw,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC, l.id DESC
), hourly AS (
  SELECT local_hour, count(*)::bigint AS entered, sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw
  FROM base GROUP BY local_hour
), calendar_hours AS (
  SELECT hour_start, CASE
    WHEN hour_start::date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN true
    WHEN hour_start::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      THEN extract(hour FROM hour_start)::integer <= extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer
    ELSE false END AS expected
  FROM generate_series(
    date_trunc('hour', p_start AT TIME ZONE 'Asia/Kolkata'),
    date_trunc('hour', (p_end - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata'),
    interval '1 hour'
  ) AS h(hour_start)
), hourly_buckets AS (
  SELECT h.hour_start AS bucket, h.expected,
    coalesce(x.entered, 0)::bigint AS entered, x.total_mw
  FROM calendar_hours h LEFT JOIN hourly x ON x.local_hour = h.hour_start
), daily_buckets AS (
  SELECT date_trunc('day', bucket) AS bucket,
    bool_or(expected) AS expected,
    sum(entered)::bigint AS entered,
    max(total_mw) FILTER (WHERE total_mw IS NOT NULL) AS peak_mw,
    min(total_mw) FILTER (WHERE total_mw IS NOT NULL) AS minimum_mw,
    avg(total_mw) FILTER (WHERE total_mw IS NOT NULL) AS average_mw,
    count(*) FILTER (WHERE expected)::bigint AS expected_hours
  FROM hourly_buckets GROUP BY 1
), result AS (
  SELECT b.bucket, b.total_mw AS peak_mw, b.total_mw AS minimum_mw, b.total_mw AS average_mw,
    b.entered, CASE WHEN b.expected THEN 1::bigint ELSE 0::bigint END AS expected_hours
  FROM hourly_buckets b WHERE p_interval = 'HOURLY' AND b.expected
  UNION ALL
  SELECT d.bucket, d.peak_mw, d.minimum_mw, d.average_mw, d.entered, d.expected_hours
  FROM daily_buckets d WHERE p_interval = 'DAILY'
)
SELECT r.bucket AT TIME ZONE 'Asia/Kolkata', r.peak_mw, r.minimum_mw, r.average_mw,
  r.entered,
  r.expected_hours * f.value,
  CASE WHEN r.expected_hours * f.value > 0 THEN round(least(100, r.entered::numeric * 100 / (r.expected_hours * f.value)), 1) ELSE 0 END,
  CASE WHEN r.expected_hours = 0 THEN 'EMPTY'
    WHEN r.entered = 0 THEN 'EMPTY'
    WHEN r.entered >= r.expected_hours * f.value THEN 'FULL'
    ELSE 'PARTIAL' END
FROM result r CROSS JOIN feeder_count f
ORDER BY r.bucket;
$$;

GRANT EXECUTE ON FUNCTION public.get_load_energy_report_summary(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_load_energy_report_series(timestamptz, timestamptz, text, uuid, uuid) TO authenticated;
