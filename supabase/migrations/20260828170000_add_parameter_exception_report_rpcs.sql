-- Parameter Exception Report uses parameter_alerts, which are generated only
-- from feeder_thresholds by evaluate_logbook_parameter_thresholds(). There is
-- no severity column/configuration, so no severity band is derived here.
CREATE OR REPLACE FUNCTION public.get_parameter_exception_report_summary(
  p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL,p_parameter_code text DEFAULT NULL
)
RETURNS TABLE (total_exceptions bigint,active_exceptions bigint,affected_stations bigint,affected_feeders bigint,most_frequent_parameter text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scoped AS (
  SELECT a.* FROM public.parameter_alerts a JOIN accessible s ON s.station_id=a.station_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end
    AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
    AND (p_parameter_code IS NULL OR a.parameter_code=p_parameter_code)
), frequent AS (SELECT parameter_code FROM scoped GROUP BY parameter_code ORDER BY count(*) DESC,parameter_code ASC LIMIT 1)
SELECT count(*)::bigint,count(*)::bigint,count(DISTINCT station_id)::bigint,count(DISTINCT feeder_id)::bigint,(SELECT parameter_code FROM frequent) FROM scoped;
$$;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_report_breakdown(
  p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL,p_parameter_code text DEFAULT NULL
)
RETURNS TABLE (parameter_code text,exception_count bigint,affected_feeders bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
scoped AS (
  SELECT a.* FROM public.parameter_alerts a JOIN accessible s ON s.station_id=a.station_id
  WHERE a.triggered_at>=p_start AND a.triggered_at<p_end
    AND (p_station_id IS NULL OR a.station_id=p_station_id)
    AND (p_feeder_id IS NULL OR a.feeder_id=p_feeder_id)
    AND (p_parameter_code IS NULL OR a.parameter_code=p_parameter_code)
)
SELECT parameter_code,count(*)::bigint,count(DISTINCT feeder_id)::bigint FROM scoped GROUP BY parameter_code ORDER BY count(*) DESC,parameter_code ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_parameters()
RETURNS TABLE (parameter_code text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT a.parameter_code FROM public.parameter_alerts a
  JOIN public.get_my_accessible_station_ids() s ON s.station_id=a.station_id
  ORDER BY a.parameter_code;
$$;

CREATE OR REPLACE FUNCTION public.get_parameter_exception_detail_page(
  p_start timestamptz,p_end timestamptz,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50,
  p_station_id uuid DEFAULT NULL,p_feeder_id uuid DEFAULT NULL,p_parameter_code text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,triggered_at timestamptz,station_id uuid,station_name text,feeder_id uuid,feeder_name text,
  parameter_code text,actual_value numeric,min_value numeric,max_value numeric,breach_type text,deviation numeric,total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (SELECT station_id FROM public.get_my_accessible_station_ids()),
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
$$;

GRANT EXECUTE ON FUNCTION public.get_parameter_exception_report_summary(timestamptz,timestamptz,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parameter_exception_report_breakdown(timestamptz,timestamptz,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parameter_exception_parameters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parameter_exception_detail_page(timestamptz,timestamptz,integer,integer,uuid,uuid,text) TO authenticated;
