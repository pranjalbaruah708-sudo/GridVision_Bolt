-- On-demand drill-down rows for Parameter Health. The aggregate health card
-- remains unchanged; this function is called only when its modal is opened.
CREATE OR REPLACE FUNCTION public.get_load_analysis_parameter_health_details(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid DEFAULT NULL,
  p_feeder_id uuid DEFAULT NULL,
  p_metric text DEFAULT 'LOW_PF',
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  station_id uuid,
  station_name text,
  feeder_id uuid,
  feeder_name text,
  metric_value numeric,
  occurred_at timestamptz,
  entered_hours bigint,
  expected_hours bigint,
  missing_hours bigint,
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
  SELECT
    f.id AS feeder_id,
    f.station_id,
    f.name AS feeder_name,
    s.name AS station_name
  FROM public.feeders f
  JOIN public.stations s ON s.id = f.station_id
  JOIN accessible a ON a.station_id = f.station_id
  WHERE coalesce(f.active, true) = true
    AND (p_station_id IS NULL OR f.station_id = p_station_id)
    AND (p_feeder_id IS NULL OR f.id = p_feeder_id)
), base AS (
  SELECT DISTINCT ON (
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata')
  )
    l.feeder_id,
    l.actual_event_time,
    l.power_factor,
    l.voltage_kv,
    l.current_a,
    l.transformer_temp_c
  FROM public.log_book_entries l
  JOIN scope_feeders f ON f.feeder_id = l.feeder_id
  WHERE l.actual_event_time >= p_start
    AND l.actual_event_time < p_end
  ORDER BY
    l.feeder_id,
    date_trunc('hour', l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),
    l.updated_at DESC,
    l.id DESC
), expected AS (
  SELECT coalesce(sum(CASE
    WHEN d.day < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 24
    WHEN d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
      THEN least(24, extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer + 1)
    ELSE 0
  END), 0)::bigint AS hours
  FROM generate_series(
    (p_start AT TIME ZONE 'Asia/Kolkata')::date,
    ((p_end AT TIME ZONE 'Asia/Kolkata')::date - 1),
    interval '1 day'
  ) AS d(day)
), metric_values AS (
  SELECT
    b.feeder_id,
    b.actual_event_time,
    CASE p_metric
      WHEN 'LOW_PF' THEN b.power_factor
      WHEN 'MIN_VOLTAGE' THEN b.voltage_kv
      WHEN 'MAX_CURRENT' THEN b.current_a
      WHEN 'MAX_TRANSFORMER_TEMP' THEN b.transformer_temp_c
      ELSE NULL
    END AS metric_value
  FROM base b
  WHERE p_metric IN ('LOW_PF', 'MIN_VOLTAGE', 'MAX_CURRENT', 'MAX_TRANSFORMER_TEMP')
), ranked_metrics AS (
  SELECT
    m.*,
    row_number() OVER (
      PARTITION BY m.feeder_id
      ORDER BY
        CASE WHEN p_metric IN ('LOW_PF', 'MIN_VOLTAGE')
          THEN m.metric_value END ASC NULLS LAST,
        CASE WHEN p_metric IN ('MAX_CURRENT', 'MAX_TRANSFORMER_TEMP')
          THEN m.metric_value END DESC NULLS LAST,
        m.actual_event_time ASC
    ) AS rank_no
  FROM metric_values m
  WHERE m.metric_value IS NOT NULL
    AND (p_metric <> 'LOW_PF' OR m.metric_value < 0.9)
), entered_by_feeder AS (
  SELECT feeder_id, count(*)::bigint AS entered_hours
  FROM base
  GROUP BY feeder_id
), detail_rows AS (
  SELECT
    f.station_id,
    f.station_name,
    f.feeder_id,
    f.feeder_name,
    r.metric_value,
    r.actual_event_time AS occurred_at,
    NULL::bigint AS entered_hours,
    NULL::bigint AS expected_hours,
    NULL::bigint AS missing_hours,
    NULL::numeric AS completeness_percent
  FROM ranked_metrics r
  JOIN scope_feeders f ON f.feeder_id = r.feeder_id
  WHERE r.rank_no = 1

  UNION ALL

  SELECT
    f.station_id,
    f.station_name,
    f.feeder_id,
    f.feeder_name,
    CASE WHEN e.hours > 0
      THEN round(least(100, coalesce(entered.entered_hours, 0)::numeric * 100 / e.hours), 1)
      ELSE 0
    END AS metric_value,
    NULL::timestamptz AS occurred_at,
    coalesce(entered.entered_hours, 0) AS entered_hours,
    e.hours AS expected_hours,
    greatest(e.hours - coalesce(entered.entered_hours, 0), 0) AS missing_hours,
    CASE WHEN e.hours > 0
      THEN round(least(100, coalesce(entered.entered_hours, 0)::numeric * 100 / e.hours), 1)
      ELSE 0
    END AS completeness_percent
  FROM scope_feeders f
  CROSS JOIN expected e
  LEFT JOIN entered_by_feeder entered ON entered.feeder_id = f.feeder_id
  WHERE p_metric = 'INCOMPLETE_LOGBOOK'
    AND coalesce(entered.entered_hours, 0) < e.hours
)
SELECT
  station_id,
  station_name,
  feeder_id,
  feeder_name,
  metric_value,
  occurred_at,
  entered_hours,
  expected_hours,
  missing_hours,
  completeness_percent
FROM detail_rows
ORDER BY
  CASE WHEN p_metric IN ('LOW_PF', 'MIN_VOLTAGE', 'INCOMPLETE_LOGBOOK')
    THEN metric_value END ASC NULLS LAST,
  CASE WHEN p_metric IN ('MAX_CURRENT', 'MAX_TRANSFORMER_TEMP')
    THEN metric_value END DESC NULLS LAST,
  station_name,
  feeder_name
LIMIT greatest(1, least(coalesce(p_limit, 50), 50));
$$;
