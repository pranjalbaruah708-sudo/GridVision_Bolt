
/*
# GridVision — Sub-Station Log Book Digitization Schema

## Overview
Single-tenant schema (no auth) for the GridVision utility management application.
All tables use TO anon, authenticated so the anon-key frontend client can read/write.

## Tables

### stations
Sub-stations tracked by the utility. Seeded with sample data.
- id, name, location, created_at

### feeders
Feeders belonging to stations.
- id, station_id (FK → stations), name, capacity_kv, created_at

### peak_load_readings
Hourly MW readings per feeder used for peak load graphs.
- id, feeder_id (FK), station_id (FK), reading_mw, voltage_kv, current_a, recorded_at, created_at

### interruptions
Log of feeder interruption events.
- id, feeder_id (FK), station_id (FK), reason (Equipment Fault | External Fault | Scheduled Work | Overload | Others), started_at, restored_at (nullable), duration_hours (computed), status (open | closed), etr (estimated time of restoration), created_at

### overload_alerts
Threshold-breach alerts for feeders/transformers.
- id, asset_id, asset_type (Feeder | Transformer), station_id (FK), parameter, value, limit_value, alert_time, acknowledged, created_at

### reliability_indices
Monthly CAIDI/CAIFI per station.
- id, station_id (FK), month (date, first day of month), caidi_hours, caifi_nos, created_at

### log_book_entries
Manual log-book style entries (hourly MW, voltage, current, remarks).
- id, station_id (FK), feeder_id (FK nullable), entry_date, entry_time, mw, voltage_kv, current_a, remarks, created_at

### push_tokens
Stores FCM/push registration tokens (placeholder).
- id, token, enabled, created_at
*/

-- Stations
CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_stations" ON stations;
CREATE POLICY "anon_select_stations" ON stations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_stations" ON stations;
CREATE POLICY "anon_insert_stations" ON stations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_stations" ON stations;
CREATE POLICY "anon_update_stations" ON stations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_stations" ON stations;
CREATE POLICY "anon_delete_stations" ON stations FOR DELETE TO anon, authenticated USING (true);

-- Feeders
CREATE TABLE IF NOT EXISTS feeders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity_kv numeric NOT NULL DEFAULT 33,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feeders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_feeders" ON feeders;
CREATE POLICY "anon_select_feeders" ON feeders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_feeders" ON feeders;
CREATE POLICY "anon_insert_feeders" ON feeders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_feeders" ON feeders;
CREATE POLICY "anon_update_feeders" ON feeders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_feeders" ON feeders;
CREATE POLICY "anon_delete_feeders" ON feeders FOR DELETE TO anon, authenticated USING (true);

-- Peak Load Readings
CREATE TABLE IF NOT EXISTS peak_load_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id uuid REFERENCES feeders(id) ON DELETE SET NULL,
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  reading_mw numeric NOT NULL,
  voltage_kv numeric NOT NULL DEFAULT 33,
  current_a numeric NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peak_load_station_time ON peak_load_readings(station_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_peak_load_feeder_time ON peak_load_readings(feeder_id, recorded_at DESC);

ALTER TABLE peak_load_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_peak_load" ON peak_load_readings;
CREATE POLICY "anon_select_peak_load" ON peak_load_readings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_peak_load" ON peak_load_readings;
CREATE POLICY "anon_insert_peak_load" ON peak_load_readings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_peak_load" ON peak_load_readings;
CREATE POLICY "anon_update_peak_load" ON peak_load_readings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_peak_load" ON peak_load_readings;
CREATE POLICY "anon_delete_peak_load" ON peak_load_readings FOR DELETE TO anon, authenticated USING (true);

-- Interruptions
CREATE TABLE IF NOT EXISTS interruptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id uuid REFERENCES feeders(id) ON DELETE SET NULL,
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'Equipment Fault' CHECK (reason IN ('Equipment Fault','External Fault','Scheduled Work','Overload','Others')),
  started_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  duration_hours numeric GENERATED ALWAYS AS (
    CASE WHEN restored_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (restored_at - started_at)) / 3600.0
      ELSE NULL
    END
  ) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  etr timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interruptions_station ON interruptions(station_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interruptions_status ON interruptions(status);

ALTER TABLE interruptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_interruptions" ON interruptions;
CREATE POLICY "anon_select_interruptions" ON interruptions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_interruptions" ON interruptions;
CREATE POLICY "anon_insert_interruptions" ON interruptions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_interruptions" ON interruptions;
CREATE POLICY "anon_update_interruptions" ON interruptions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_interruptions" ON interruptions;
CREATE POLICY "anon_delete_interruptions" ON interruptions FOR DELETE TO anon, authenticated USING (true);

-- Overload Alerts
CREATE TABLE IF NOT EXISTS overload_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id text NOT NULL,
  asset_type text NOT NULL DEFAULT 'Feeder' CHECK (asset_type IN ('Feeder','Transformer')),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  parameter text NOT NULL,
  value numeric NOT NULL,
  limit_value numeric NOT NULL,
  alert_time timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overload_station ON overload_alerts(station_id, alert_time DESC);

ALTER TABLE overload_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_overload" ON overload_alerts;
CREATE POLICY "anon_select_overload" ON overload_alerts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_overload" ON overload_alerts;
CREATE POLICY "anon_insert_overload" ON overload_alerts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_overload" ON overload_alerts;
CREATE POLICY "anon_update_overload" ON overload_alerts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_overload" ON overload_alerts;
CREATE POLICY "anon_delete_overload" ON overload_alerts FOR DELETE TO anon, authenticated USING (true);

-- Reliability Indices
CREATE TABLE IF NOT EXISTS reliability_indices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  month date NOT NULL,
  caidi_hours numeric NOT NULL DEFAULT 0,
  caifi_nos numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(station_id, month)
);

ALTER TABLE reliability_indices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_reliability" ON reliability_indices;
CREATE POLICY "anon_select_reliability" ON reliability_indices FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_reliability" ON reliability_indices;
CREATE POLICY "anon_insert_reliability" ON reliability_indices FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_reliability" ON reliability_indices;
CREATE POLICY "anon_update_reliability" ON reliability_indices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_reliability" ON reliability_indices;
CREATE POLICY "anon_delete_reliability" ON reliability_indices FOR DELETE TO anon, authenticated USING (true);

-- Log Book Entries
CREATE TABLE IF NOT EXISTS log_book_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  feeder_id uuid REFERENCES feeders(id) ON DELETE SET NULL,
  entry_date date NOT NULL,
  entry_time time NOT NULL,
  mw numeric NOT NULL,
  voltage_kv numeric NOT NULL,
  current_a numeric NOT NULL,
  remarks text NOT NULL DEFAULT 'Normal',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logbook_station_date ON log_book_entries(station_id, entry_date DESC);

ALTER TABLE log_book_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_logbook" ON log_book_entries;
CREATE POLICY "anon_select_logbook" ON log_book_entries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_logbook" ON log_book_entries;
CREATE POLICY "anon_insert_logbook" ON log_book_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_logbook" ON log_book_entries;
CREATE POLICY "anon_update_logbook" ON log_book_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_logbook" ON log_book_entries;
CREATE POLICY "anon_delete_logbook" ON log_book_entries FOR DELETE TO anon, authenticated USING (true);

-- Push Tokens
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_push" ON push_tokens;
CREATE POLICY "anon_select_push" ON push_tokens FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_push" ON push_tokens;
CREATE POLICY "anon_insert_push" ON push_tokens FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_push" ON push_tokens;
CREATE POLICY "anon_update_push" ON push_tokens FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_push" ON push_tokens;
CREATE POLICY "anon_delete_push" ON push_tokens FOR DELETE TO anon, authenticated USING (true);

-- Seed stations
INSERT INTO stations (id, name, location) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Station-A', 'North Zone'),
  ('11111111-0000-0000-0000-000000000002', 'Station-B', 'South Zone'),
  ('11111111-0000-0000-0000-000000000003', 'Station-C', 'East Zone'),
  ('11111111-0000-0000-0000-000000000004', 'Station-D', 'West Zone')
ON CONFLICT DO NOTHING;

-- Seed feeders
INSERT INTO feeders (id, station_id, name, capacity_kv) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Feeder-01', 33),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Feeder-02', 33),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'Feeder-03', 33),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'Feeder-04', 33),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000003', 'Feeder-07', 33),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000003', 'Feeder-12', 33),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000004', 'Feeder-15', 33),
  ('22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000004', 'Feeder-09', 33)
ON CONFLICT DO NOTHING;
