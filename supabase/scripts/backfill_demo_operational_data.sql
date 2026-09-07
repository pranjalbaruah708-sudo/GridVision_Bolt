-- GridVision operational demo-data backfill
--
-- This is an explicit, opt-in script. It is intentionally outside migrations
-- and must never be run automatically during deployment.
--
-- Recommended execution (against a reviewed non-production project first):
--   npx supabase@latest db query --linked --file supabase/scripts/backfill_demo_operational_data.sql
--
-- The script is repeat-safe: existing operational rows are preserved, default
-- thresholds never overwrite configured limits, and seeded interruptions carry
-- a stable marker used for deduplication.

BEGIN;

SET LOCAL TIME ZONE 'Asia/Kolkata';

-- Prevent two operators from running the backfill concurrently.
SELECT pg_advisory_xact_lock(hashtext('gridvision_demo_operational_backfill'));

-- ---------------------------------------------------------------------------
-- Pre-backfill diagnostics
-- ---------------------------------------------------------------------------

SELECT
  'before' AS phase,
  (SELECT count(*) FROM public.stations WHERE active) AS active_stations,
  (SELECT count(*) FROM public.feeders WHERE active) AS active_feeders,
  (SELECT count(*) FROM public.log_book_entries) AS logbook_rows,
  (SELECT max(actual_event_time) FROM public.log_book_entries) AS latest_logbook_time,
  (SELECT count(*) FROM public.feeder_thresholds) AS threshold_rows,
  (SELECT count(*) FROM public.parameter_alerts) AS parameter_alert_rows,
  (SELECT count(*) FROM public.interruptions) AS interruption_rows,
  (SELECT count(*) FROM public.interruptions WHERE current_status = 'OPEN') AS open_interruptions;

-- ---------------------------------------------------------------------------
-- Safe default thresholds
-- Existing feeder/parameter limits remain authoritative.
-- ---------------------------------------------------------------------------

WITH active_feeders AS (
  SELECT
    f.id AS feeder_id,
    coalesce(f.voltage_level_kv, s.voltage_level_kv, 33)::numeric AS nominal_kv
  FROM public.feeders f
  JOIN public.stations s ON s.id = f.station_id
  WHERE f.active
    AND s.active
), defaults AS (
  SELECT feeder_id, 'VOLTAGE_KV'::text AS parameter_code,
         round(nominal_kv * 0.94, 3) AS min_value,
         round(nominal_kv * 1.06, 3) AS max_value
  FROM active_feeders
  UNION ALL SELECT feeder_id, 'FREQUENCY_HZ', 49.70, 50.30 FROM active_feeders
  UNION ALL SELECT feeder_id, 'POWER_FACTOR', 0.85, NULL::numeric FROM active_feeders
  UNION ALL SELECT feeder_id, 'TRANSFORMER_TEMP_C', NULL::numeric, 85 FROM active_feeders
  UNION ALL SELECT feeder_id, 'OIL_LEVEL_PERCENT', 75, NULL::numeric FROM active_feeders
)
INSERT INTO public.feeder_thresholds (
  feeder_id,
  parameter_code,
  min_value,
  max_value
)
SELECT feeder_id, parameter_code, min_value, max_value
FROM defaults
ON CONFLICT (feeder_id, parameter_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Missing hourly operational readings
--
-- The target is the beginning of the most recently completed IST hour. Values
-- are deterministic, so separate databases receive comparable demo profiles.
-- Three feeders receive one frequency anomaly at the final generated hour;
-- the existing threshold trigger creates the corresponding parameter alerts.
-- ---------------------------------------------------------------------------

WITH target AS (
  SELECT (
    date_trunc('hour', current_timestamp AT TIME ZONE 'Asia/Kolkata')
    - interval '1 hour'
  ) AT TIME ZONE 'Asia/Kolkata' AS last_completed_hour
), feeder_scope AS (
  SELECT
    f.id AS feeder_id,
    f.station_id,
    f.code AS feeder_code,
    greatest(coalesce(f.consumer_count, 0), 250)::numeric AS consumer_count,
    coalesce(f.voltage_level_kv, s.voltage_level_kv, 33)::numeric AS nominal_kv,
    row_number() OVER (ORDER BY f.code, f.id) AS feeder_number,
    (
      SELECT au.id
      FROM public.user_stations us
      JOIN public.app_users au ON au.id = us.user_id
      WHERE us.station_id = f.station_id
        AND us.active
        AND au.active
        AND au.role = 'OPERATOR'::public.app_user_role
      ORDER BY au.id
      LIMIT 1
    ) AS operator_id,
    max(l.actual_event_time) AS latest_entry
  FROM public.feeders f
  JOIN public.stations s ON s.id = f.station_id
  LEFT JOIN public.log_book_entries l
    ON l.station_id = f.station_id
   AND l.feeder_id = f.id
  WHERE f.active
    AND s.active
  GROUP BY
    f.id, f.station_id, f.code, f.consumer_count,
    f.voltage_level_kv, s.voltage_level_kv
), missing_hours AS (
  SELECT
    fs.*,
    generated.hour_at AS actual_event_time,
    extract(hour FROM generated.hour_at AT TIME ZONE 'Asia/Kolkata')::integer AS local_hour,
    extract(dow FROM generated.hour_at AT TIME ZONE 'Asia/Kolkata')::integer AS local_dow,
    (((hashtextextended(fs.feeder_id::text || generated.hour_at::text, 11) % 1000) + 1000) % 1000)::numeric / 1000 AS noise_a,
    (((hashtextextended(fs.feeder_id::text || generated.hour_at::text, 29) % 1000) + 1000) % 1000)::numeric / 1000 AS noise_b
  FROM feeder_scope fs
  CROSS JOIN target t
  CROSS JOIN LATERAL generate_series(
    date_trunc('hour', fs.latest_entry) + interval '1 hour',
    t.last_completed_hour,
    interval '1 hour'
  ) AS generated(hour_at)
  WHERE fs.latest_entry IS NOT NULL
    AND fs.latest_entry < t.last_completed_hour
    AND NOT EXISTS (
      SELECT 1
      FROM public.log_book_entries existing
      WHERE existing.station_id = fs.station_id
        AND existing.feeder_id = fs.feeder_id
        AND existing.actual_event_time = generated.hour_at
    )
), profiled AS (
  SELECT
    mh.*,
    CASE
      WHEN local_hour BETWEEN 0 AND 5 THEN 0.55
      WHEN local_hour BETWEEN 6 AND 8 THEN 0.76
      WHEN local_hour BETWEEN 9 AND 16 THEN 0.88
      WHEN local_hour BETWEEN 17 AND 21 THEN 1.00
      ELSE 0.72
    END::numeric
    * CASE WHEN local_dow IN (0, 6) THEN 0.92 ELSE 1.00 END::numeric AS demand_factor
  FROM missing_hours mh
), calculated AS (
  SELECT
    p.*,
    round((2.25 + consumer_count / 260) * demand_factor * (0.96 + noise_a * 0.08), 3) AS reading_mw,
    round(nominal_kv * (0.982 + noise_b * 0.036), 3) AS reading_voltage,
    round(0.91 + noise_a * 0.075, 3) AS reading_pf
  FROM profiled p
)
INSERT INTO public.log_book_entries (
  station_id,
  feeder_id,
  operator_id,
  actual_event_time,
  mw,
  mvar,
  voltage_kv,
  current_a,
  power_factor,
  frequency_hz,
  transformer_temp_c,
  oil_level_percent,
  tap_position,
  weather,
  remarks,
  created_at,
  updated_at
)
SELECT
  station_id,
  feeder_id,
  operator_id,
  actual_event_time,
  reading_mw,
  round(reading_mw * (0.22 + noise_b * 0.12), 3),
  reading_voltage,
  round(reading_mw * 1000 / nullif(1.7320508 * reading_voltage * reading_pf, 0), 2),
  reading_pf,
  CASE
    WHEN feeder_number <= 3
     AND actual_event_time = (SELECT last_completed_hour FROM target)
      THEN 49.55
    ELSE round(49.94 + noise_b * 0.12, 2)
  END,
  round(47 + demand_factor * 17 + noise_a * 5, 1),
  round(88 + noise_b * 10, 1),
  floor(noise_a * 9)::integer - 4,
  CASE
    WHEN noise_b < 0.18 THEN 'Rainy'
    WHEN noise_b < 0.42 THEN 'Cloudy'
    ELSE 'Clear'
  END,
  'DEMO BACKFILL: hourly operational reading',
  least(current_timestamp, actual_event_time + interval '45 minutes'),
  least(current_timestamp, actual_event_time + interval '45 minutes')
FROM calculated;

-- ---------------------------------------------------------------------------
-- Recent restored interruptions
--
-- Open feeders are excluded. At most one restored event is created per missing
-- local date, and today's event is inserted only after its restoration time.
-- ---------------------------------------------------------------------------

WITH bounds AS (
  SELECT
    coalesce(
      max((interruption_start AT TIME ZONE 'Asia/Kolkata')::date) + 1,
      (current_timestamp AT TIME ZONE 'Asia/Kolkata')::date
    ) AS first_missing_date,
    (current_timestamp AT TIME ZONE 'Asia/Kolkata')::date AS today
  FROM public.interruptions
), missing_dates AS (
  SELECT generated.day::date AS local_date
  FROM bounds b
  CROSS JOIN LATERAL generate_series(b.first_missing_date, b.today, interval '1 day') generated(day)
), eligible_feeders AS (
  SELECT
    f.id AS feeder_id,
    f.station_id,
    f.code AS feeder_code,
    row_number() OVER (ORDER BY f.code, f.id) AS feeder_number,
    count(*) OVER () AS feeder_count,
    (
      SELECT au.id
      FROM public.user_stations us
      JOIN public.app_users au ON au.id = us.user_id
      WHERE us.station_id = f.station_id
        AND us.active
        AND au.active
        AND au.role = 'OPERATOR'::public.app_user_role
      ORDER BY au.id
      LIMIT 1
    ) AS operator_id
  FROM public.feeders f
  JOIN public.stations s ON s.id = f.station_id
  WHERE f.active
    AND s.active
    AND NOT EXISTS (
      SELECT 1
      FROM public.interruptions open_event
      WHERE open_event.feeder_id = f.id
        AND open_event.current_status = 'OPEN'
    )
), planned AS (
  SELECT
    d.local_date,
    ef.*,
    (d.local_date::timestamp + time '11:15') AT TIME ZONE 'Asia/Kolkata' AS interruption_start,
    35 + (extract(day FROM d.local_date)::integer % 4) * 10 AS duration_minutes,
    'DEMO-SEED:' || d.local_date::text || ':' || ef.feeder_code AS seed_marker
  FROM missing_dates d
  JOIN eligible_feeders ef
    ON ef.feeder_number = 1 + (
      (
        (hashtextextended(d.local_date::text, 73) % ef.feeder_count)
        + ef.feeder_count
      ) % ef.feeder_count
    )::integer
)
INSERT INTO public.interruptions (
  station_id,
  feeder_id,
  interruption_start,
  interruption_end,
  duration_minutes,
  cause,
  remarks,
  operator_id,
  current_status,
  etr,
  created_at,
  updated_at
)
SELECT
  station_id,
  feeder_id,
  interruption_start,
  interruption_start + duration_minutes * interval '1 minute',
  duration_minutes,
  CASE extract(day FROM local_date)::integer % 4
    WHEN 0 THEN 'Planned maintenance'
    WHEN 1 THEN 'Vegetation contact'
    WHEN 2 THEN 'Equipment fault'
    ELSE 'Weather-related fault'
  END,
  seed_marker || ' | Synthetic restored interruption for demo reporting',
  operator_id,
  'RESTORED',
  interruption_start + 90 * interval '1 minute',
  interruption_start + duration_minutes * interval '1 minute',
  interruption_start + duration_minutes * interval '1 minute'
FROM planned p
WHERE interruption_start + duration_minutes * interval '1 minute' <= current_timestamp
  AND NOT EXISTS (
    SELECT 1
    FROM public.interruptions existing
    WHERE existing.remarks LIKE p.seed_marker || '%'
  );

-- ---------------------------------------------------------------------------
-- Post-backfill diagnostics
-- ---------------------------------------------------------------------------

SELECT
  'after' AS phase,
  count(*) AS logbook_rows,
  min(actual_event_time) AS earliest_logbook_time,
  max(actual_event_time) AS latest_logbook_time,
  count(*) FILTER (WHERE remarks = 'DEMO BACKFILL: hourly operational reading') AS demo_logbook_rows,
  count(*) FILTER (WHERE actual_event_time > current_timestamp) AS future_logbook_rows
FROM public.log_book_entries;

SELECT
  f.code AS feeder_code,
  max(l.actual_event_time) AS latest_reading,
  count(*) FILTER (
    WHERE l.remarks = 'DEMO BACKFILL: hourly operational reading'
  ) AS generated_rows
FROM public.feeders f
LEFT JOIN public.log_book_entries l ON l.feeder_id = f.id
WHERE f.active
GROUP BY f.id, f.code
ORDER BY f.code;

SELECT
  count(*) AS duplicate_feeder_hours
FROM (
  SELECT feeder_id, actual_event_time
  FROM public.log_book_entries
  WHERE remarks = 'DEMO BACKFILL: hourly operational reading'
  GROUP BY feeder_id, actual_event_time
  HAVING count(*) > 1
) duplicates;

SELECT
  (SELECT count(*) FROM public.feeder_thresholds) AS threshold_rows,
  (SELECT count(*) FROM public.parameter_alerts) AS parameter_alert_rows,
  (SELECT count(*) FROM public.parameter_alerts pa
    JOIN public.log_book_entries l ON l.id = pa.log_book_entry_id
    WHERE l.remarks = 'DEMO BACKFILL: hourly operational reading') AS demo_parameter_alert_rows,
  (SELECT count(*) FROM public.interruptions WHERE remarks LIKE 'DEMO-SEED:%') AS demo_interruption_rows,
  (SELECT count(*) FROM public.interruptions WHERE current_status = 'OPEN') AS open_interruptions,
  (SELECT count(*) FROM public.interruptions WHERE current_status = 'RESTORED') AS restored_interruptions;

COMMIT;
