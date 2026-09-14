begin;
-- Separate current restricted scope before global FIELD_OFFICER restoration.
-- Definitions are taken from DEV; only the station helper dependency changes.

CREATE OR REPLACE FUNCTION public.get_interruption_report_breakdown(p_start timestamp with time zone, p_end timestamp with time zone, p_group text, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_cause text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS TABLE(label text, interruption_count bigint, duration_minutes numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
), scoped AS (
  SELECT i.*, s.name AS station_name, f.name AS feeder_name,
    CASE
      WHEN i.current_status = 'OPEN' THEN extract(epoch FROM (now() - i.interruption_start)) / 60
      WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM (i.interruption_end - i.interruption_start)) / 60
      ELSE i.duration_minutes
    END AS effective_duration_minutes
  FROM public.interruptions i
  JOIN accessible a ON a.station_id = i.station_id
  JOIN public.stations s ON s.id = i.station_id
  LEFT JOIN public.feeders f ON f.id = i.feeder_id
  WHERE i.interruption_start >= p_start AND i.interruption_start < p_end
    AND (p_station_id IS NULL OR i.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR i.feeder_id = p_feeder_id)
    AND (p_status IS NULL OR i.current_status = p_status)
    AND (p_cause IS NULL OR i.cause = p_cause)
), grouped AS (
  SELECT CASE p_group
      WHEN 'STATION' THEN station_name
      WHEN 'FEEDER' THEN coalesce(feeder_name, 'Not recorded')
      WHEN 'CAUSE' THEN coalesce(cause, 'Not recorded')
      ELSE 'Not recorded'
    END AS label,
    count(*)::bigint AS interruption_count,
    coalesce(round(sum(effective_duration_minutes), 1), 0) AS duration_minutes
  FROM scoped
  GROUP BY 1
)
SELECT label, interruption_count, duration_minutes
FROM grouped
ORDER BY duration_minutes DESC, interruption_count DESC, label ASC
LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
$function$
;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_report_breakdown(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_parameter_code text DEFAULT NULL::text)
 RETURNS TABLE(parameter_code text, exception_count bigint, affected_feeders bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scoped AS (
  SELECT a.* FROM public.parameter_alerts a JOIN accessible s ON s.station_id=a.station_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end
    AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
    AND (p_parameter_code IS NULL OR a.parameter_code=p_parameter_code)
)
SELECT parameter_code,count(*)::bigint,count(DISTINCT feeder_id)::bigint FROM scoped GROUP BY parameter_code ORDER BY count(*) DESC,parameter_code ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_performance_report_metrics(p_start timestamp with time zone, p_end timestamp with time zone, p_entity text, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entity_id uuid, entity_name text, peak_mw numeric, average_mw numeric, minimum_power_factor numeric, interruption_count bigint, interruption_duration_minutes numeric, exception_count bigint, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, feeders_reporting bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scope_feeders AS (
  SELECT f.id AS feeder_id,f.station_id,f.name AS feeder_name,s.name AS station_name
  FROM public.feeders f JOIN accessible a ON a.station_id=f.station_id JOIN public.stations s ON s.id=f.station_id
  WHERE coalesce(f.active,true) AND (p_station_id IS NULL OR f.station_id=p_station_id)
    AND (p_entity='STATION' OR p_feeder_id IS NULL OR f.id=p_feeder_id)
), entity_feeders AS (
  SELECT CASE WHEN p_entity='STATION' THEN station_id ELSE feeder_id END AS entity_id,
    CASE WHEN p_entity='STATION' THEN station_name ELSE feeder_name END AS entity_name,feeder_id,station_id
  FROM scope_feeders WHERE p_entity IN ('STATION','FEEDER')
), expected_hours AS (
  SELECT count(*)::bigint AS count FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    ef.entity_id,ef.feeder_id,l.mw,l.power_factor,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN entity_feeders ef ON ef.feeder_id=l.feeder_id
  WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end
  ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), hourly AS (
  SELECT entity_id,local_hour,sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw FROM base GROUP BY entity_id,local_hour
), feeder_counts AS (SELECT entity_id,entity_name,count(*)::bigint AS feeders FROM entity_feeders GROUP BY entity_id,entity_name),
reading_stats AS (
  SELECT entity_id,count(*)::bigint AS entered,count(DISTINCT feeder_id)::bigint AS reporting,min(power_factor) AS minimum_pf FROM base GROUP BY entity_id
), load_stats AS (SELECT entity_id,max(total_mw) FILTER (WHERE total_mw IS NOT NULL) AS peak,avg(total_mw) FILTER (WHERE total_mw IS NOT NULL) AS average FROM hourly GROUP BY entity_id),
interruptions AS (
  SELECT CASE WHEN p_entity='STATION' THEN i.station_id ELSE i.feeder_id END AS entity_id,count(*)::bigint AS count,
    coalesce(round(sum(CASE WHEN i.current_status='OPEN' THEN extract(epoch FROM (now()-i.interruption_start))/60 WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM (i.interruption_end-i.interruption_start))/60 ELSE i.duration_minutes END),1),0) AS duration
  FROM public.interruptions i JOIN accessible a ON a.station_id=i.station_id
  WHERE i.interruption_start>=p_start AND i.interruption_start<p_end AND (p_station_id IS NULL OR i.station_id=p_station_id)
    AND (p_entity='STATION' OR p_feeder_id IS NULL OR i.feeder_id=p_feeder_id)
  GROUP BY 1
), exceptions AS (
  SELECT CASE WHEN p_entity='STATION' THEN a.station_id ELSE a.feeder_id END AS entity_id,count(*)::bigint AS count
  FROM public.parameter_alerts a JOIN accessible ac ON ac.station_id=a.station_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_entity='STATION' OR p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
  GROUP BY 1
)
SELECT fc.entity_id,fc.entity_name,ls.peak,ls.average,rs.minimum_pf,coalesce(i.count,0),coalesce(i.duration,0),coalesce(x.count,0),coalesce(rs.entered,0),fc.feeders*eh.count,
  CASE WHEN fc.feeders*eh.count>0 THEN round(least(100,coalesce(rs.entered,0)::numeric*100/(fc.feeders*eh.count)),1) ELSE 0 END,coalesce(rs.reporting,0)
FROM feeder_counts fc CROSS JOIN expected_hours eh LEFT JOIN reading_stats rs ON rs.entity_id=fc.entity_id LEFT JOIN load_stats ls ON ls.entity_id=fc.entity_id LEFT JOIN interruptions i ON i.entity_id=fc.entity_id LEFT JOIN exceptions x ON x.entity_id=fc.entity_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_interruption_report_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_cause text DEFAULT NULL::text)
 RETURNS TABLE(total_interruptions bigint, open_interruptions bigint, total_duration_minutes numeric, average_restoration_minutes numeric, longest_interruption_minutes numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
), scoped AS (
  SELECT i.*,
    CASE
      WHEN i.current_status = 'OPEN' THEN extract(epoch FROM (now() - i.interruption_start)) / 60
      WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM (i.interruption_end - i.interruption_start)) / 60
      ELSE i.duration_minutes
    END AS effective_duration_minutes
  FROM public.interruptions i
  JOIN accessible a ON a.station_id = i.station_id
  WHERE i.interruption_start >= p_start AND i.interruption_start < p_end
    AND (p_station_id IS NULL OR i.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR i.feeder_id = p_feeder_id)
    AND (p_status IS NULL OR i.current_status = p_status)
    AND (p_cause IS NULL OR i.cause = p_cause)
)
SELECT count(*)::bigint,
  count(*) FILTER (WHERE current_status = 'OPEN')::bigint,
  coalesce(round(sum(effective_duration_minutes), 1), 0),
  round(avg(effective_duration_minutes) FILTER (WHERE current_status = 'RESTORED' AND interruption_end IS NOT NULL), 1),
  round(max(effective_duration_minutes), 1)
FROM scoped;
$function$
;

CREATE OR REPLACE FUNCTION public.get_interruption_report_trend(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_cause text DEFAULT NULL::text)
 RETURNS TABLE(date date, interruption_count bigint, duration_minutes numeric, open_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
), scoped AS (
  SELECT i.*,
    CASE
      WHEN i.current_status = 'OPEN' THEN extract(epoch FROM (now() - i.interruption_start)) / 60
      WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM (i.interruption_end - i.interruption_start)) / 60
      ELSE i.duration_minutes
    END AS effective_duration_minutes
  FROM public.interruptions i JOIN accessible a ON a.station_id = i.station_id
  WHERE i.interruption_start >= p_start AND i.interruption_start < p_end
    AND (p_station_id IS NULL OR i.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR i.feeder_id = p_feeder_id)
    AND (p_status IS NULL OR i.current_status = p_status)
    AND (p_cause IS NULL OR i.cause = p_cause)
)
SELECT (interruption_start AT TIME ZONE 'Asia/Kolkata')::date,
  count(*)::bigint,
  coalesce(round(sum(effective_duration_minutes), 1), 0),
  count(*) FILTER (WHERE current_status = 'OPEN')::bigint
FROM scoped
GROUP BY 1
ORDER BY 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_interruption_report_causes()
 RETURNS TABLE(cause text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT i.cause
  FROM public.interruptions i
  JOIN public.get_my_operational_station_ids() a ON a.station_id = i.station_id
  WHERE i.cause IS NOT NULL AND btrim(i.cause) <> ''
  ORDER BY i.cause;
$function$
;

CREATE OR REPLACE FUNCTION public.get_load_energy_report_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(peak_mw numeric, peak_time timestamp with time zone, minimum_mw numeric, minimum_time timestamp with time zone, average_mw numeric, estimated_energy_mwh numeric, energy_eligible boolean, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_load_energy_report_series(p_start timestamp with time zone, p_end timestamp with time zone, p_interval text, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket_start timestamp with time zone, peak_mw numeric, minimum_mw numeric, average_mw numeric, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_report_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_parameter_code text DEFAULT NULL::text)
 RETURNS TABLE(total_exceptions bigint, active_exceptions bigint, affected_stations bigint, affected_feeders bigint, most_frequent_parameter text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scoped AS (
  SELECT a.* FROM public.parameter_alerts a JOIN accessible s ON s.station_id=a.station_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end
    AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
    AND (p_parameter_code IS NULL OR a.parameter_code=p_parameter_code)
), frequent AS (SELECT parameter_code FROM scoped GROUP BY parameter_code ORDER BY count(*) DESC,parameter_code ASC LIMIT 1)
SELECT count(*)::bigint,count(*)::bigint,count(DISTINCT station_id)::bigint,count(DISTINCT feeder_id)::bigint,(SELECT parameter_code FROM frequent) FROM scoped;
$function$
;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_detail_page(p_start timestamp with time zone, p_end timestamp with time zone, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_parameter_code text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, triggered_at timestamp with time zone, station_id uuid, station_name text, feeder_id uuid, feeder_name text, parameter_code text, actual_value numeric, min_value numeric, max_value numeric, breach_type text, deviation numeric, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scoped AS (
  SELECT a.*,s.name AS station_name,f.name AS feeder_name,
    CASE WHEN a.breach_type='BELOW_MIN' THEN a.min_value-a.actual_value ELSE a.actual_value-a.max_value END AS deviation,
    count(*) OVER()::bigint AS total_count
  FROM public.parameter_alerts a
  JOIN accessible access_scope ON access_scope.station_id=a.station_id
  JOIN public.stations s ON s.id=a.station_id
  JOIN public.feeders f ON f.id=a.feeder_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end
    AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
    AND (p_parameter_code IS NULL OR a.parameter_code=p_parameter_code)
)
SELECT id,triggered_at,station_id,station_name,feeder_id,feeder_name,parameter_code,actual_value,min_value,max_value,breach_type,deviation,total_count
FROM scoped ORDER BY triggered_at DESC,created_at DESC OFFSET greatest(0,p_page)*greatest(1,least(200,p_page_size)) LIMIT greatest(1,least(200,p_page_size));
$function$
;

CREATE OR REPLACE FUNCTION public.get_logbook_report_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entered_readings bigint, expected_readings bigint, completeness_percent numeric, feeders_reported bigint, missing_feeder_hours bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (
  SELECT station_id FROM public.get_my_operational_station_ids()
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_executive_summary_report(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(peak_mw numeric, peak_time timestamp with time zone, average_mw numeric, open_interruptions bigint, total_interruptions bigint, total_interruption_duration_minutes numeric, active_parameter_exceptions bigint, total_parameter_exceptions bigint, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, stations_reporting bigint, total_stations bigint, feeders_reporting bigint, total_feeders bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scope_stations AS (SELECT s.id FROM public.stations s JOIN accessible a ON a.station_id=s.id WHERE coalesce(s.active,true) AND (p_station_id IS NULL OR s.id=p_station_id)),
scope_feeders AS (SELECT f.id AS feeder_id,f.station_id FROM public.feeders f JOIN scope_stations s ON s.id=f.station_id WHERE coalesce(f.active,true)),
expected_hours AS (
  SELECT count(*)::bigint AS count FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id,l.station_id,l.mw,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end
  ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), hourly AS (SELECT local_hour,sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw FROM base GROUP BY local_hour),
peak AS (SELECT total_mw,local_hour FROM hourly WHERE total_mw IS NOT NULL ORDER BY total_mw DESC,local_hour ASC LIMIT 1),
totals AS (SELECT count(*)::bigint AS entered,count(DISTINCT feeder_id)::bigint AS feeders_reporting,count(DISTINCT station_id)::bigint AS stations_reporting FROM base),
interruptions_period AS (
  SELECT count(*)::bigint AS count,coalesce(round(sum(CASE WHEN i.current_status='OPEN' THEN extract(epoch FROM(now()-i.interruption_start))/60 WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM(i.interruption_end-i.interruption_start))/60 ELSE i.duration_minutes END),1),0) AS duration
  FROM public.interruptions i JOIN scope_stations s ON s.id=i.station_id WHERE i.interruption_start>=p_start AND i.interruption_start<p_end
), open_interruptions AS (SELECT count(*)::bigint AS count FROM public.interruptions i JOIN scope_stations s ON s.id=i.station_id WHERE i.current_status='OPEN'),
exceptions_period AS (SELECT count(*)::bigint AS count FROM public.parameter_alerts a JOIN scope_stations s ON s.id=a.station_id WHERE a.triggered_at>=p_start AND a.triggered_at<p_end),
active_exceptions AS (SELECT count(*)::bigint AS count FROM public.parameter_alerts a JOIN scope_stations s ON s.id=a.station_id)
SELECT peak.total_mw,peak.local_hour AT TIME ZONE 'Asia/Kolkata',round(avg(hourly.total_mw),3),open_interruptions.count,interruptions_period.count,interruptions_period.duration,
  active_exceptions.count,exceptions_period.count,totals.entered,(SELECT count(*)::bigint FROM scope_feeders)*expected_hours.count,
  CASE WHEN (SELECT count(*) FROM scope_feeders)*expected_hours.count>0 THEN round(least(100,totals.entered::numeric*100/((SELECT count(*) FROM scope_feeders)*expected_hours.count)),1) ELSE 0 END,
  totals.stations_reporting,(SELECT count(*)::bigint FROM scope_stations),totals.feeders_reporting,(SELECT count(*)::bigint FROM scope_feeders)
FROM expected_hours CROSS JOIN totals CROSS JOIN interruptions_period CROSS JOIN open_interruptions CROSS JOIN exceptions_period CROSS JOIN active_exceptions LEFT JOIN hourly ON true LEFT JOIN peak ON true
GROUP BY peak.total_mw,peak.local_hour,open_interruptions.count,interruptions_period.count,interruptions_period.duration,active_exceptions.count,exceptions_period.count,totals.entered,totals.stations_reporting,totals.feeders_reporting,expected_hours.count;
$function$
;

CREATE OR REPLACE FUNCTION public.get_data_completeness_report_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_threshold numeric DEFAULT 90, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(expected_feeder_hours bigint, entered_feeder_hours bigint, completeness_percent numeric, stations_below_threshold bigint, feeders_below_threshold bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_data_completeness_station_breakdown(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_data_completeness_feeder_breakdown(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_data_completeness_report_trend(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(date date, entered_feeder_hours bigint, expected_feeder_hours bigint, completeness_percent numeric, fill_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_data_completeness_missing_slots(p_start timestamp with time zone, p_end timestamp with time zone, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50, p_station_id uuid DEFAULT NULL::uuid, p_feeder_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(date date, hour integer, station_id uuid, station_name text, feeder_id uuid, feeder_name text, status text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_parameters()
 RETURNS TABLE(parameter_code text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT a.parameter_code FROM public.parameter_alerts a
  JOIN public.get_my_operational_station_ids() s ON s.station_id=a.station_id
  ORDER BY a.parameter_code;
$function$
;

CREATE OR REPLACE FUNCTION public.get_executive_summary_attention(p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5)
 RETURNS TABLE(id text, entity_type text, entity_name text, issue_type text, issue_count bigint, completeness_percent numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH accessible AS (SELECT station_id FROM public.get_my_operational_station_ids()),
scope_stations AS (SELECT s.id,s.name FROM public.stations s JOIN accessible a ON a.station_id=s.id WHERE coalesce(s.active,true) AND (p_station_id IS NULL OR s.id=p_station_id)),
scope_feeders AS (SELECT f.id AS feeder_id,f.station_id,f.name AS feeder_name FROM public.feeders f JOIN scope_stations s ON s.id=f.station_id WHERE coalesce(f.active,true)),
expected_hours AS (
  SELECT count(*)::bigint AS count FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON(l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id,l.station_id FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), station_feeders AS (SELECT station_id,count(*)::bigint AS feeders FROM scope_feeders GROUP BY station_id), station_entries AS (SELECT station_id,count(*)::bigint AS entered FROM base GROUP BY station_id),
open_items AS (SELECT 'open:'||s.id::text AS id,'STATION'::text AS entity_type,s.name AS entity_name,'OPEN_INTERRUPTION'::text AS issue_type,count(*)::bigint AS issue_count,NULL::numeric AS completeness_percent,1 AS priority FROM public.interruptions i JOIN scope_stations s ON s.id=i.station_id WHERE i.current_status='OPEN' GROUP BY s.id,s.name),
exception_items AS (SELECT 'alert:'||f.feeder_id::text,'FEEDER'::text,f.feeder_name,'PARAMETER_EXCEPTION'::text,count(*)::bigint,NULL::numeric,2 AS priority FROM public.parameter_alerts a JOIN scope_feeders f ON f.feeder_id=a.feeder_id GROUP BY f.feeder_id,f.feeder_name),
completeness_items AS (SELECT 'complete:'||s.id::text,'STATION'::text,s.name,'LOW_COMPLETENESS'::text,((sf.feeders*eh.count)-coalesce(se.entered,0))::bigint,round(coalesce(se.entered,0)::numeric*100/(sf.feeders*eh.count),1),3 AS priority FROM scope_stations s JOIN station_feeders sf ON sf.station_id=s.id CROSS JOIN expected_hours eh LEFT JOIN station_entries se ON se.station_id=s.id WHERE sf.feeders*eh.count>0 AND coalesce(se.entered,0)::numeric*100/(sf.feeders*eh.count)<90),
all_items AS (SELECT * FROM open_items UNION ALL SELECT * FROM exception_items UNION ALL SELECT * FROM completeness_items)
SELECT id,entity_type,entity_name,issue_type,issue_count,completeness_percent FROM all_items ORDER BY priority,issue_count DESC,entity_name ASC LIMIT greatest(1,least(5,coalesce(p_limit,5)));
$function$
;

CREATE OR REPLACE FUNCTION public.assert_shift_station_access(p_station_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.get_my_operational_station_ids() s where s.station_id = p_station_id
  ) then
    raise exception 'Station access is not authorized' using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_shutdown_request(p_shutdown_id uuid, p_target_status text, p_decision_remarks text DEFAULT NULL::text)
 RETURNS shutdown_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_user_role;
  v_request public.shutdown_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  select au.role into v_role from public.app_users au
  where au.id = v_user_id and au.active;
  if v_role is null then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  -- Temporary rule until configurable Shutdown approval administration exists.
  if v_role not in ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role) then
    raise exception 'Shutdown approval permission is required' using errcode = '42501';
  end if;
  if p_target_status not in ('APPROVED', 'REJECTED') then
    raise exception 'Unsupported shutdown decision' using errcode = '22023';
  end if;
  if p_target_status = 'REJECTED' and btrim(coalesce(p_decision_remarks, '')) = '' then
    raise exception 'Rejection remarks are required' using errcode = '22023';
  end if;

  select * into v_request
  from public.shutdown_requests sr
  where sr.id = p_shutdown_id
  for update;
  if not found then
    raise exception 'Shutdown request was not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'PENDING_APPROVAL' then
    raise exception 'Shutdown request has already been decided' using errcode = '55000';
  end if;
  if v_request.requested_by = v_user_id then
    raise exception 'You cannot decide your own shutdown request' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.get_my_operational_station_ids() s
    where s.station_id = v_request.station_id
  ) then
    raise exception 'Shutdown request is outside your authorized scope' using errcode = '42501';
  end if;

  update public.shutdown_requests
  set status = p_target_status,
      decision_by = v_user_id,
      decision_at = now(),
      decision_remarks = nullif(btrim(coalesce(p_decision_remarks, '')), '')
  where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_shutdown_request(p_station_id uuid, p_feeder_id uuid DEFAULT NULL::uuid, p_equipment_name text DEFAULT NULL::text, p_shutdown_type text DEFAULT NULL::text, p_purpose text DEFAULT NULL::text, p_work_description text DEFAULT NULL::text, p_planned_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expected_restoration timestamp with time zone DEFAULT NULL::timestamp with time zone, p_remarks text DEFAULT NULL::text)
 RETURNS shutdown_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_result public.shutdown_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.app_users au where au.id = v_user_id and au.active) then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  if p_station_id is null or not exists (
    select 1 from public.get_my_operational_station_ids() s where s.station_id = p_station_id
  ) then
    raise exception 'Station is outside your authorized scope' using errcode = '42501';
  end if;
  if p_feeder_id is not null and not exists (
    select 1 from public.feeders f
    where f.id = p_feeder_id and f.station_id = p_station_id and f.active
  ) then
    raise exception 'Feeder does not belong to the selected station' using errcode = '22023';
  end if;
  if btrim(coalesce(p_shutdown_type, '')) = ''
     or btrim(coalesce(p_purpose, '')) = ''
     or btrim(coalesce(p_work_description, '')) = '' then
    raise exception 'Shutdown type, purpose and work description are required' using errcode = '22023';
  end if;
  if p_planned_start is null or p_expected_restoration is null
     or p_expected_restoration <= p_planned_start then
    raise exception 'Expected restoration must be later than planned start' using errcode = '22023';
  end if;

  insert into public.shutdown_requests (
    sd_number, station_id, feeder_id, equipment_name, shutdown_type, purpose,
    work_description, planned_start, expected_restoration, remarks,
    status, requested_by, requested_at
  ) values (
    public.generate_shutdown_sd_number(), p_station_id, p_feeder_id,
    nullif(btrim(coalesce(p_equipment_name, '')), ''), btrim(p_shutdown_type),
    btrim(p_purpose), btrim(p_work_description), p_planned_start,
    p_expected_restoration, nullif(btrim(coalesce(p_remarks, '')), ''),
    'PENDING_APPROVAL', v_user_id, now()
  ) returning * into v_result;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_shutdown_dashboard_requests(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_station_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid, feeder_name text, equipment_name text, shutdown_type text, purpose text, planned_start timestamp with time zone, expected_restoration timestamp with time zone, requested_by uuid, requested_by_name text, requested_at timestamp with time zone, status text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then raise exception 'Unsupported shutdown status' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination parameters' using errcode='22023'; end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then raise exception 'From date cannot be later than to date' using errcode='22023'; end if;
  return query
  with accessible as materialized (select a.station_id from public.get_my_operational_station_ids() a),
  filtered as (
    select sr.id,sr.sd_number,sr.station_id,s.name station_name,sr.feeder_id,f.name feeder_name,
      sr.equipment_name,sr.shutdown_type,sr.purpose,sr.planned_start,sr.expected_restoration,
      sr.requested_by,au.full_name requested_by_name,sr.requested_at,sr.status
    from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id
    join public.stations s on s.id=sr.station_id left join public.feeders f on f.id=sr.feeder_id
    join public.app_users au on au.id=sr.requested_by
    where (p_status is null or sr.status=p_status) and (p_station_id is null or sr.station_id=p_station_id)
      and (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date >= p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date <= p_to_date)
      and (nullif(btrim(coalesce(p_search,'')),'') is null or sr.sd_number ilike '%'||btrim(p_search)||'%'
        or s.name ilike '%'||btrim(p_search)||'%' or f.name ilike '%'||btrim(p_search)||'%'
        or sr.equipment_name ilike '%'||btrim(p_search)||'%')
  )
  select x.*,count(*) over() from filtered x order by x.requested_at desc,x.id offset p_offset limit p_limit;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_shutdown_dashboard_kpis()
 RETURNS TABLE(total bigint, pending_approval bigint, approved bigint, rejected bigint, cancelled bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  return query with accessible as materialized (select a.station_id from public.get_my_operational_station_ids() a)
  select count(*)::bigint,count(*) filter(where sr.status='PENDING_APPROVAL')::bigint,
    count(*) filter(where sr.status='APPROVED')::bigint,count(*) filter(where sr.status='REJECTED')::bigint,
    count(*) filter(where sr.status='CANCELLED')::bigint
  from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_shutdown_request(p_shutdown_id uuid)
 RETURNS TABLE(id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid, feeder_name text, equipment_name text, shutdown_type text, purpose text, work_description text, planned_start timestamp with time zone, expected_restoration timestamp with time zone, remarks text, requested_by uuid, requested_by_name text, requested_at timestamp with time zone, status text, decision_by uuid, decision_by_name text, decision_at timestamp with time zone, decision_remarks text, created_at timestamp with time zone, updated_at timestamp with time zone, can_decide boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role public.app_user_role;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='28000'; end if;
  select au.role into v_role from public.app_users au where au.id=auth.uid() and au.active;
  if v_role is null then raise exception 'An active GridVision user is required' using errcode='42501'; end if;
  return query
  with accessible as materialized (select a.station_id from public.get_my_operational_station_ids() a),
  found as (
    select sr.*,s.name station_name,f.name feeder_name,requester.full_name requested_by_name,
      decider.full_name decision_by_name,(a.station_id is not null) in_scope
    from public.shutdown_requests sr join public.stations s on s.id=sr.station_id
    left join public.feeders f on f.id=sr.feeder_id join public.app_users requester on requester.id=sr.requested_by
    left join public.app_users decider on decider.id=sr.decision_by left join accessible a on a.station_id=sr.station_id
    where sr.id=p_shutdown_id and (sr.requested_by=auth.uid() or a.station_id is not null)
  )
  select x.id,x.sd_number,x.station_id,x.station_name,x.feeder_id,x.feeder_name,x.equipment_name,
    x.shutdown_type,x.purpose,x.work_description,x.planned_start,x.expected_restoration,x.remarks,
    x.requested_by,x.requested_by_name,x.requested_at,x.status,x.decision_by,x.decision_by_name,
    x.decision_at,x.decision_remarks,x.created_at,x.updated_at,
    (x.status='PENDING_APPROVAL' and x.requested_by<>auth.uid() and x.in_scope and
      v_role in ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role))
  from found x;
  if not found then raise exception 'Shutdown request was not found or is outside your authorized scope' using errcode='P0002'; end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.list_shutdown_report_requests(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_station_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_feeder_id uuid DEFAULT NULL::uuid, p_equipment text DEFAULT NULL::text, p_requester uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid, feeder_name text, equipment_name text, shutdown_type text, purpose text, work_description text, planned_start timestamp with time zone, expected_restoration timestamp with time zone, remarks text, requested_by uuid, requested_by_name text, requested_at timestamp with time zone, status text, decision_by uuid, decision_by_name text, decision_at timestamp with time zone, decision_remarks text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then raise exception 'Unsupported shutdown status' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination parameters' using errcode='22023'; end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then raise exception 'From date cannot be later than to date' using errcode='22023'; end if;
  return query with accessible as materialized (select a.station_id from public.get_my_operational_station_ids() a), filtered as (
    select sr.id,sr.sd_number,sr.station_id,s.name station_name,sr.feeder_id,f.name feeder_name,
      sr.equipment_name,sr.shutdown_type,sr.purpose,sr.work_description,sr.planned_start,
      sr.expected_restoration,sr.remarks,sr.requested_by,requester.full_name requested_by_name,
      sr.requested_at,sr.status,sr.decision_by,decider.full_name decision_by_name,sr.decision_at,sr.decision_remarks
    from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id
    join public.stations s on s.id=sr.station_id left join public.feeders f on f.id=sr.feeder_id
    join public.app_users requester on requester.id=sr.requested_by left join public.app_users decider on decider.id=sr.decision_by
    where (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date>=p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date<=p_to_date)
      and (p_station_id is null or sr.station_id=p_station_id) and (p_status is null or sr.status=p_status)
      and (p_feeder_id is null or sr.feeder_id=p_feeder_id)
      and (nullif(btrim(coalesce(p_equipment,'')),'') is null or sr.equipment_name ilike '%'||btrim(p_equipment)||'%' or f.name ilike '%'||btrim(p_equipment)||'%')
      and (p_requester is null or sr.requested_by=p_requester)
  ) select x.*,count(*) over() from filtered x order by x.requested_at desc,x.id offset p_offset limit p_limit;
end; $function$
;

alter policy "station_shifts_read_authorized" on public.station_shifts using ((EXISTS ( SELECT 1
   FROM get_my_operational_station_ids() s(station_id)
  WHERE (s.station_id = station_shifts.station_id))));

alter policy "shift_duty_sessions_read_authorized" on public.shift_duty_sessions using ((EXISTS ( SELECT 1
   FROM get_my_operational_station_ids() s(station_id)
  WHERE (s.station_id = shift_duty_sessions.station_id))));

alter policy "shift_handovers_read_authorized" on public.shift_handovers using ((EXISTS ( SELECT 1
   FROM get_my_operational_station_ids() s(station_id)
  WHERE (s.station_id = shift_handovers.station_id))));

alter policy "shift_handover_items_read_authorized" on public.shift_handover_items using ((EXISTS ( SELECT 1
   FROM (shift_handovers h
     JOIN get_my_operational_station_ids() s(station_id) ON ((s.station_id = h.station_id)))
  WHERE (h.id = shift_handover_items.handover_id))));

alter policy "station_shift_assignments_read_authorized" on public.station_shift_assignments using ((EXISTS ( SELECT 1
   FROM (station_shifts s
     JOIN get_my_operational_station_ids() a(station_id) ON ((a.station_id = s.station_id)))
  WHERE (s.id = station_shift_assignments.shift_id))));

alter policy "Users read owned or scoped shutdown requests" on public.shutdown_requests using (((requested_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM get_my_operational_station_ids() accessible(station_id)
  WHERE (accessible.station_id = shutdown_requests.station_id)))));
-- Report-only read contracts. Base-table Dashboard/Analytics semantics stay intact.
create view public.scoped_logbook_report_entries with (security_invoker=true,security_barrier=true) as
select l.* from public.log_book_entries l
where l.station_id in (select station_id from public.get_my_operational_station_ids());
create view public.scoped_interruption_report_entries with (security_invoker=true,security_barrier=true) as
select i.* from public.interruptions i
where i.station_id in (select station_id from public.get_my_operational_station_ids());
revoke all on public.scoped_logbook_report_entries,public.scoped_interruption_report_entries from public,anon,authenticated;
grant select on public.scoped_logbook_report_entries,public.scoped_interruption_report_entries to authenticated;
commit;
