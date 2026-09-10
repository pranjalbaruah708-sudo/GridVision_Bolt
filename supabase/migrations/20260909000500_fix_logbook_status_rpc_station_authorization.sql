-- Enforce station authorization inside SECURITY DEFINER logbook-status RPCs.
-- Unauthorized and non-existent station UUIDs intentionally produce the same
-- response to avoid exposing station existence or aggregate information.

CREATE OR REPLACE FUNCTION public.get_logbook_day_hour_status(
  p_station_id uuid,
  p_date date
)
RETURNS TABLE(
  hour_no integer,
  entered_feeders bigint,
  total_feeders bigint,
  fill_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.get_my_accessible_station_ids() AS accessible
    WHERE accessible.station_id = p_station_id
  ) THEN
    RAISE EXCEPTION 'Station is outside your permitted scope'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH feeder_count AS (
      SELECT count(*)::bigint AS total_feeders
      FROM public.feeders feeder
      WHERE feeder.station_id = p_station_id
        AND feeder.active = true
    ), hours AS (
      SELECT generate_series(0, 23)::integer AS hour_no
    ), entries AS (
      SELECT
        extract(hour FROM entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no,
        count(DISTINCT entry.feeder_id)::bigint AS entered_feeders
      FROM public.log_book_entries entry
      WHERE entry.station_id = p_station_id
        AND (entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date = p_date
      GROUP BY 1
    )
    SELECT
      hours.hour_no,
      coalesce(entries.entered_feeders, 0),
      feeder_count.total_feeders,
      CASE
        WHEN coalesce(entries.entered_feeders, 0) = 0 THEN 'EMPTY'
        WHEN coalesce(entries.entered_feeders, 0) >= feeder_count.total_feeders THEN 'FULL'
        ELSE 'PARTIAL'
      END
    FROM hours
    CROSS JOIN feeder_count
    LEFT JOIN entries ON entries.hour_no = hours.hour_no
    ORDER BY hours.hour_no;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_logbook_month_status(
  p_station_id uuid,
  p_year integer,
  p_month integer
)
RETURNS TABLE(
  entry_date date,
  entered_slots bigint,
  expected_slots bigint,
  fill_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.get_my_accessible_station_ids() AS accessible
    WHERE accessible.station_id = p_station_id
  ) THEN
    RAISE EXCEPTION 'Station is outside your permitted scope'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH feeder_count AS (
      SELECT count(*)::bigint AS total_feeders
      FROM public.feeders feeder
      WHERE feeder.station_id = p_station_id
        AND feeder.active = true
    ), days AS (
      SELECT generate_series(
        make_date(p_year, p_month, 1),
        (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date,
        interval '1 day'
      )::date AS entry_date
    ), entries AS (
      SELECT
        (entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS entry_date,
        count(DISTINCT (
          entry.feeder_id,
          date_trunc('hour', entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')
        ))::bigint AS entered_slots
      FROM public.log_book_entries entry
      WHERE entry.station_id = p_station_id
        AND (entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date
          >= make_date(p_year, p_month, 1)
        AND (entry.actual_event_time AT TIME ZONE 'Asia/Kolkata')::date
          < (make_date(p_year, p_month, 1) + interval '1 month')::date
      GROUP BY 1
    )
    SELECT
      days.entry_date,
      coalesce(entries.entered_slots, 0),
      (feeder_count.total_feeders * 24)::bigint,
      CASE
        WHEN coalesce(entries.entered_slots, 0) = 0 THEN 'EMPTY'
        WHEN coalesce(entries.entered_slots, 0) >= feeder_count.total_feeders * 24 THEN 'FULL'
        ELSE 'PARTIAL'
      END
    FROM days
    CROSS JOIN feeder_count
    LEFT JOIN entries ON entries.entry_date = days.entry_date
    ORDER BY days.entry_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_logbook_day_hour_status(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_logbook_day_hour_status(uuid, date)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_logbook_month_status(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_logbook_month_status(uuid, integer, integer)
  TO authenticated;
