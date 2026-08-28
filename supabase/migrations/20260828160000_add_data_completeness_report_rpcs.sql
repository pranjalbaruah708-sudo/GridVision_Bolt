-- Data Completeness Report. Expected slots use currently active feeders; feeder
-- activation history is not stored. Today's slots end at the current IST hour.
CREATE OR REPLACE FUNCTION public.get_data_completeness_report_summary(
  p_start timestamptz, p_end timestamptz, p_threshold numeric DEFAULT 90,
  p_station_id uuid DEFAULT NULL, p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  expected_feeder_hours bigint, entered_feeder_hours bigint, completeness_percent numeric,
  stations_below_threshold bigint, feeders_below_threshold bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id
  FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), expected_hours AS (
  SELECT d.day::date AS date, h.hour_no
  FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') d(day)
  CROSS JOIN generate_series(0, 23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date
     OR (d.day::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no <= extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id, l.station_id, (l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS date,
    extract(hour FROM l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC, l.id DESC
), feeder_stats AS (
  SELECT f.feeder_id, f.station_id,
    count(eh.hour_no)::bigint AS expected,
    count(b.feeder_id)::bigint AS entered
  FROM scope_feeders f CROSS JOIN expected_hours eh
  LEFT JOIN base b ON b.feeder_id = f.feeder_id AND b.date = eh.date AND b.hour_no = eh.hour_no
  GROUP BY f.feeder_id, f.station_id
), station_stats AS (
  SELECT station_id, sum(expected)::bigint AS expected, sum(entered)::bigint AS entered
  FROM feeder_stats GROUP BY station_id
), totals AS (
  SELECT coalesce(sum(expected), 0)::bigint AS expected, coalesce(sum(entered), 0)::bigint AS entered FROM feeder_stats
)
SELECT totals.expected, totals.entered,
  CASE WHEN totals.expected > 0 THEN round(least(100, totals.entered::numeric * 100 / totals.expected), 1) ELSE 0 END,
  (SELECT count(*) FROM station_stats WHERE expected > 0 AND entered::numeric * 100 / expected < greatest(0, least(100, p_threshold))),
  (SELECT count(*) FROM feeder_stats WHERE expected > 0 AND entered::numeric * 100 / expected < greatest(0, least(100, p_threshold)))
FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.get_data_completeness_station_breakdown(
  p_start timestamptz, p_end timestamptz, p_station_id uuid DEFAULT NULL, p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, name text, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id FROM public.feeders f JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) AND (p_station_id IS NULL OR f.station_id = p_station_id) AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), expected_hours AS (
  SELECT d.day::date AS date, h.hour_no FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date, ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no <= extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id, (l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS date, extract(hour FROM l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id = l.feeder_id WHERE l.actual_event_time >= p_start AND l.actual_event_time < p_end
  ORDER BY l.feeder_id, date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'), l.updated_at DESC, l.id DESC
), stats AS (
  SELECT f.station_id, count(eh.hour_no)::bigint AS expected, count(b.feeder_id)::bigint AS entered
  FROM scope_feeders f CROSS JOIN expected_hours eh LEFT JOIN base b ON b.feeder_id=f.feeder_id AND b.date=eh.date AND b.hour_no=eh.hour_no GROUP BY f.station_id
)
SELECT s.id, s.name, stats.entered, stats.expected,
  CASE WHEN stats.expected > 0 THEN round(least(100, stats.entered::numeric*100/stats.expected),1) ELSE 0 END,
  CASE WHEN stats.entered = 0 THEN 'EMPTY' WHEN stats.entered >= stats.expected THEN 'FULL' ELSE 'PARTIAL' END
FROM stats JOIN public.stations s ON s.id=stats.station_id ORDER BY 5 ASC, s.name ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_data_completeness_feeder_breakdown(
  p_start timestamptz, p_end timestamptz, p_station_id uuid DEFAULT NULL, p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, name text, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_feeders AS (
  SELECT f.id AS feeder_id, f.station_id FROM public.feeders f JOIN accessible a ON a.station_id=f.station_id
  WHERE coalesce(f.active,true) AND (p_station_id IS NULL OR f.station_id=p_station_id) AND (p_feeder_id IS NULL OR f.id=p_feeder_id)
), expected_hours AS (
  SELECT d.day::date AS date,h.hour_no FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id,(l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS date,extract(hour FROM l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end
  ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), stats AS (
  SELECT f.feeder_id,count(eh.hour_no)::bigint AS expected,count(b.feeder_id)::bigint AS entered FROM scope_feeders f CROSS JOIN expected_hours eh LEFT JOIN base b ON b.feeder_id=f.feeder_id AND b.date=eh.date AND b.hour_no=eh.hour_no GROUP BY f.feeder_id
)
SELECT f.id,f.name,stats.entered,stats.expected,CASE WHEN stats.expected>0 THEN round(least(100,stats.entered::numeric*100/stats.expected),1) ELSE 0 END,
  CASE WHEN stats.entered=0 THEN 'EMPTY' WHEN stats.entered>=stats.expected THEN 'FULL' ELSE 'PARTIAL' END
FROM stats JOIN public.feeders f ON f.id=stats.feeder_id ORDER BY 5 ASC,f.name ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_data_completeness_report_trend(
  p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (date date,entered_feeder_hours bigint,expected_feeder_hours bigint,completeness_percent numeric,fill_status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_feeders AS (SELECT f.id AS feeder_id FROM public.feeders f JOIN accessible a ON a.station_id=f.station_id WHERE coalesce(f.active,true) AND (p_station_id IS NULL OR f.station_id=p_station_id) AND (p_feeder_id IS NULL OR f.id=p_feeder_id)),
expected_hours AS (
  SELECT d.day::date AS date,h.hour_no FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id,(l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS date,extract(hour FROM l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), stats AS (
  SELECT eh.date,count(*)::bigint AS expected,count(b.feeder_id)::bigint AS entered FROM expected_hours eh CROSS JOIN scope_feeders f LEFT JOIN base b ON b.feeder_id=f.feeder_id AND b.date=eh.date AND b.hour_no=eh.hour_no GROUP BY eh.date
)
SELECT date,entered,expected,CASE WHEN expected>0 THEN round(least(100,entered::numeric*100/expected),1) ELSE 0 END,CASE WHEN entered=0 THEN 'EMPTY' WHEN entered>=expected THEN 'FULL' ELSE 'PARTIAL' END FROM stats ORDER BY date;
$$;

CREATE OR REPLACE FUNCTION public.get_data_completeness_missing_slots(
  p_start timestamptz,p_end timestamptz,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (date date,hour integer,station_id uuid,station_name text,feeder_id uuid,feeder_name text,status text,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_feeders AS (SELECT f.id AS feeder_id,f.name AS feeder_name,f.station_id,s.name AS station_name FROM public.feeders f JOIN accessible a ON a.station_id=f.station_id JOIN public.stations s ON s.id=f.station_id WHERE coalesce(f.active,true) AND (p_station_id IS NULL OR f.station_id=p_station_id) AND (p_feeder_id IS NULL OR f.id=p_feeder_id)),
expected_hours AS (
  SELECT d.day::date AS date,h.hour_no FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id,(l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS date,extract(hour FROM l.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), missing AS (
  SELECT eh.date,eh.hour_no,sf.station_id,sf.station_name,sf.feeder_id,sf.feeder_name,count(*) OVER()::bigint AS total_count
  FROM expected_hours eh CROSS JOIN scope_feeders sf LEFT JOIN base b ON b.feeder_id=sf.feeder_id AND b.date=eh.date AND b.hour_no=eh.hour_no WHERE b.feeder_id IS NULL
)
SELECT date,hour_no,station_id,station_name,feeder_id,feeder_name,'MISSING'::text,total_count FROM missing ORDER BY date DESC,hour_no DESC,station_name,feeder_name OFFSET greatest(0,p_page)*greatest(1,least(200,p_page_size)) LIMIT greatest(1,least(200,p_page_size));
$$;

GRANT EXECUTE ON FUNCTION public.get_data_completeness_report_summary(timestamptz,timestamptz,numeric,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_data_completeness_station_breakdown(timestamptz,timestamptz,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_data_completeness_feeder_breakdown(timestamptz,timestamptz,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_data_completeness_report_trend(timestamptz,timestamptz,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_data_completeness_missing_slots(timestamptz,timestamptz,integer,integer,uuid,uuid) TO authenticated;
