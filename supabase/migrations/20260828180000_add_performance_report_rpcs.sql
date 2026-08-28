-- Station/Feeder Performance Report: all measures are returned separately;
-- no composite performance score is calculated.
CREATE OR REPLACE FUNCTION public.get_performance_report_metrics(
  p_start timestamptz,p_end timestamptz,p_entity text,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (
  entity_id uuid,entity_name text,peak_mw numeric,average_mw numeric,minimum_power_factor numeric,
  interruption_count bigint,interruption_duration_minutes numeric,exception_count bigint,
  entered_feeder_hours bigint,expected_feeder_hours bigint,completeness_percent numeric,feeders_reporting bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
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
$$;

CREATE OR REPLACE FUNCTION public.get_performance_report_summary(
  p_start timestamptz,p_end timestamptz,p_entity text,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (entity_count bigint,peak_mw numeric,average_mw numeric,minimum_power_factor numeric,interruption_count bigint,interruption_duration_minutes numeric,exception_count bigint,entered_feeder_hours bigint,expected_feeder_hours bigint,completeness_percent numeric,feeders_reporting bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH metrics AS (SELECT * FROM public.get_performance_report_metrics(p_start,p_end,p_entity,p_station_id,p_feeder_id))
SELECT count(*)::bigint,max(peak_mw),avg(average_mw),min(minimum_power_factor),coalesce(sum(interruption_count),0)::bigint,coalesce(round(sum(interruption_duration_minutes),1),0),coalesce(sum(exception_count),0)::bigint,coalesce(sum(entered_feeder_hours),0)::bigint,coalesce(sum(expected_feeder_hours),0)::bigint,
  CASE WHEN coalesce(sum(expected_feeder_hours),0)>0 THEN round(least(100,sum(entered_feeder_hours)::numeric*100/sum(expected_feeder_hours)),1) ELSE 0 END,coalesce(sum(feeders_reporting),0)::bigint FROM metrics;
$$;

CREATE OR REPLACE FUNCTION public.get_performance_report_page(
  p_start timestamptz,p_end timestamptz,p_entity text,p_metric text,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (entity_id uuid,entity_name text,peak_mw numeric,average_mw numeric,minimum_power_factor numeric,interruption_count bigint,interruption_duration_minutes numeric,exception_count bigint,entered_feeder_hours bigint,expected_feeder_hours bigint,completeness_percent numeric,feeders_reporting bigint,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH metrics AS (SELECT *,count(*) OVER()::bigint AS total_count FROM public.get_performance_report_metrics(p_start,p_end,p_entity,p_station_id,p_feeder_id))
SELECT * FROM metrics ORDER BY
  CASE WHEN p_metric='PEAK_MW' THEN peak_mw END DESC NULLS LAST,
  CASE WHEN p_metric='AVERAGE_MW' THEN average_mw END DESC NULLS LAST,
  CASE WHEN p_metric='MIN_PF' THEN minimum_power_factor END ASC NULLS LAST,
  CASE WHEN p_metric='INTERRUPTIONS' THEN interruption_count END DESC,
  CASE WHEN p_metric='EXCEPTIONS' THEN exception_count END DESC,
  CASE WHEN p_metric='COMPLETENESS' THEN completeness_percent END ASC,
  entity_name ASC
OFFSET greatest(0,p_page)*greatest(1,least(200,p_page_size)) LIMIT greatest(1,least(200,p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_performance_report_ranking(
  p_start timestamptz,p_end timestamptz,p_entity text,p_metric text,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL
)
RETURNS TABLE (entity_id uuid,entity_name text,metric_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH metrics AS (SELECT * FROM public.get_performance_report_metrics(p_start,p_end,p_entity,p_station_id,p_feeder_id)), ranked AS (
  SELECT entity_id,entity_name,CASE p_metric WHEN 'PEAK_MW' THEN peak_mw WHEN 'AVERAGE_MW' THEN average_mw WHEN 'MIN_PF' THEN minimum_power_factor WHEN 'INTERRUPTIONS' THEN interruption_count::numeric WHEN 'EXCEPTIONS' THEN exception_count::numeric WHEN 'COMPLETENESS' THEN completeness_percent END AS metric_value FROM metrics
)
SELECT * FROM ranked ORDER BY
  CASE WHEN p_metric IN ('MIN_PF','COMPLETENESS') THEN metric_value END ASC NULLS LAST,
  CASE WHEN p_metric NOT IN ('MIN_PF','COMPLETENESS') THEN metric_value END DESC NULLS LAST,
  entity_name ASC LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_performance_report_summary(timestamptz,timestamptz,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_performance_report_page(timestamptz,timestamptz,text,text,integer,integer,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_performance_report_ranking(timestamptz,timestamptz,text,text,uuid,uuid) TO authenticated;
