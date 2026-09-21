-- Add minimum voltage and its occurrence time to executive summary report
DROP FUNCTION IF EXISTS public.get_executive_summary_report(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.get_executive_summary_report(
  p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL
)
RETURNS TABLE (
  peak_mw numeric,peak_time timestamptz,average_mw numeric,
  minimum_voltage_kv numeric,minimum_voltage_time timestamptz,
  open_interruptions bigint,total_interruptions bigint,total_interruption_duration_minutes numeric,
  active_parameter_exceptions bigint,total_parameter_exceptions bigint,
  entered_feeder_hours bigint,expected_feeder_hours bigint,completeness_percent numeric,
  stations_reporting bigint,total_stations bigint,feeders_reporting bigint,total_feeders bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS \$\$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scope_stations AS (SELECT s.id FROM public.stations s JOIN accessible a ON a.station_id=s.id WHERE coalesce(s.active,true) AND (p_station_id IS NULL OR s.id=p_station_id)),
scope_feeders AS (SELECT f.id AS feeder_id,f.station_id FROM public.feeders f JOIN scope_stations s ON s.id=f.station_id WHERE coalesce(f.active,true)),
expected_hours AS (
  SELECT count(*)::bigint AS count FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no)
  WHERE d.day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)
), base AS (
  SELECT DISTINCT ON (l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'))
    l.feeder_id,l.station_id,l.mw,l.voltage_kv,l.actual_event_time,
    date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata') AS local_hour
  FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id
  WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end
  ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC
), hourly AS (SELECT local_hour,sum(mw) FILTER (WHERE mw IS NOT NULL) AS total_mw FROM base GROUP BY local_hour),
peak AS (SELECT total_mw,local_hour FROM hourly WHERE total_mw IS NOT NULL ORDER BY total_mw DESC,local_hour ASC LIMIT 1),
min_voltage AS (
  SELECT min(voltage_kv) AS min_kv FROM base WHERE voltage_kv IS NOT NULL
),
min_voltage_time AS (
  SELECT max(actual_event_time) AS min_time FROM base WHERE voltage_kv = (SELECT min_kv FROM min_voltage)
),
totals AS (SELECT count(*)::bigint AS entered,count(DISTINCT feeder_id)::bigint AS feeders_reporting,count(DISTINCT station_id)::bigint AS stations_reporting FROM base),
interruptions_period AS (
  SELECT count(*)::bigint AS count,
    coalesce(round(sum(CASE WHEN i.current_status='OPEN' THEN extract(epoch FROM(now()-i.interruption_start))/60
      WHEN i.interruption_end IS NOT NULL THEN extract(epoch FROM(i.interruption_end-i.interruption_start))/60
      ELSE i.duration_minutes END),1),0) AS duration
  FROM public.interruptions i JOIN scope_stations s ON s.id=i.station_id
  WHERE i.interruption_start>=p_start AND i.interruption_start<p_end
), open_interruptions AS (SELECT count(*)::bigint AS count FROM public.interruptions i JOIN scope_stations s ON s.id=i.station_id WHERE i.current_status='OPEN'),
exceptions_period AS (SELECT count(*)::bigint AS count FROM public.parameter_alerts a JOIN scope_stations s ON s.id=a.station_id WHERE a.triggered_at>=p_start AND a.triggered_at<p_end),
active_exceptions AS (SELECT count(*)::bigint AS count FROM public.parameter_alerts a JOIN scope_stations s ON s.id=a.station_id)
SELECT
  peak.total_mw,
  peak.local_hour AT TIME ZONE 'Asia/Kolkata',
  round(avg(hourly.total_mw),3),
  min_voltage.min_kv,
  min_voltage_time.min_time AT TIME ZONE 'Asia/Kolkata',
  open_interruptions.count,
  interruptions_period.count,
  interruptions_period.duration,
  active_exceptions.count,
  exceptions_period.count,
  totals.entered,
  (SELECT count(*)::bigint FROM scope_feeders)*expected_hours.count,
  CASE WHEN (SELECT count(*) FROM scope_feeders)*expected_hours.count>0
    THEN round(least(100,totals.entered::numeric*100/((SELECT count(*) FROM scope_feeders)*expected_hours.count)),1)
    ELSE 0 END,
  totals.stations_reporting,
  (SELECT count(*)::bigint FROM scope_stations),
  totals.feeders_reporting,
  (SELECT count(*)::bigint FROM scope_feeders)
FROM expected_hours
CROSS JOIN totals
CROSS JOIN interruptions_period
CROSS JOIN open_interruptions
CROSS JOIN exceptions_period
CROSS JOIN active_exceptions
CROSS JOIN min_voltage
CROSS JOIN min_voltage_time
LEFT JOIN hourly ON true
LEFT JOIN peak ON true
GROUP BY
  peak.total_mw,peak.local_hour,
  min_voltage.min_kv,min_voltage_time.min_time,
  open_interruptions.count,
  interruptions_period.count,interruptions_period.duration,
  active_exceptions.count,exceptions_period.count,
  totals.entered,totals.stations_reporting,totals.feeders_reporting,expected_hours.count;
\$\$;

GRANT EXECUTE ON FUNCTION public.get_executive_summary_report(timestamptz,timestamptz,uuid) TO authenticated;
