-- Interruption report aggregates. Each function applies the current caller's
-- accessible-station scope before reading interruption records.
CREATE OR REPLACE FUNCTION public.get_interruption_report_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cause text DEFAULT NULL
)
RETURNS TABLE (
  total_interruptions bigint,
  open_interruptions bigint,
  total_duration_minutes numeric,
  average_restoration_minutes numeric,
  longest_interruption_minutes numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
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
$$;

CREATE OR REPLACE FUNCTION public.get_interruption_report_trend(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cause text DEFAULT NULL
)
RETURNS TABLE (
  date date,
  interruption_count bigint,
  duration_minutes numeric,
  open_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
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
$$;

CREATE OR REPLACE FUNCTION public.get_interruption_report_breakdown(
  p_start timestamptz,
  p_end timestamptz,
  p_group text,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cause text DEFAULT NULL,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  label text,
  interruption_count bigint,
  duration_minutes numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH accessible AS (
  SELECT station_id FROM public.get_my_accessible_station_ids()
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
$$;

CREATE OR REPLACE FUNCTION public.get_interruption_report_causes()
RETURNS TABLE (cause text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT i.cause
  FROM public.interruptions i
  JOIN public.get_my_accessible_station_ids() a ON a.station_id = i.station_id
  WHERE i.cause IS NOT NULL AND btrim(i.cause) <> ''
  ORDER BY i.cause;
$$;

GRANT EXECUTE ON FUNCTION public.get_interruption_report_summary(timestamptz, timestamptz, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_interruption_report_trend(timestamptz, timestamptz, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_interruption_report_breakdown(timestamptz, timestamptz, text, uuid, uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_interruption_report_causes() TO authenticated;
