/*
  GridVision schema baseline immediately before 20260820000000.

  Reconstructed from a read-only inventory of the production public schema,
  then rolled back using every checked-in migration from 20260820000000 onward.
  This migration intentionally contains definitions only: no users, master data,
  operational data, device tokens, notification rows, secrets, or scheduled jobs.
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TYPE public.app_user_role AS ENUM (
  'OPERATOR',
  'FIELD_OFFICER',
  'ADMIN'
);

CREATE TABLE public.app_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code text UNIQUE,
  full_name text NOT NULL,
  email text,
  phone text,
  role public.app_user_role NOT NULL DEFAULT 'OPERATOR',
  department text,
  designation text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CONSTRAINT stations_code_unique UNIQUE,
  name text NOT NULL,
  location text,
  voltage_level_kv numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feeders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  code text NOT NULL CONSTRAINT feeders_code_unique UNIQUE,
  name text NOT NULL,
  voltage_level_kv numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumer_count integer NOT NULL DEFAULT 0 CHECK (consumer_count >= 0)
);

CREATE TABLE public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL CONSTRAINT org_units_code_unique UNIQUE,
  unit_type text NOT NULL CHECK (
    unit_type IN ('HQ', 'REGION', 'ZONE', 'CIRCLE', 'DIVISION', 'SUB_DIVISION')
  ),
  parent_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.station_org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT station_org_units_unique UNIQUE (station_id, org_unit_id)
);

CREATE TABLE public.user_org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_org_units_unique UNIQUE (user_id, org_unit_id)
);

CREATE TABLE public.user_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_stations_unique_assignment UNIQUE (user_id, station_id)
);

CREATE TABLE public.log_book_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  feeder_id uuid REFERENCES public.feeders(id) ON DELETE RESTRICT,
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actual_event_time timestamptz NOT NULL,
  mw numeric,
  mvar numeric,
  voltage_kv numeric,
  current_a numeric,
  power_factor numeric CHECK (
    power_factor IS NULL OR (power_factor >= -1 AND power_factor <= 1)
  ),
  frequency_hz numeric CHECK (
    frequency_hz IS NULL OR (frequency_hz >= 0 AND frequency_hz <= 100)
  ),
  transformer_temp_c numeric,
  oil_level_percent numeric CHECK (
    oil_level_percent IS NULL OR (oil_level_percent >= 0 AND oil_level_percent <= 100)
  ),
  tap_position integer,
  weather text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.interruptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  feeder_id uuid REFERENCES public.feeders(id) ON DELETE RESTRICT,
  interruption_start timestamptz NOT NULL,
  interruption_end timestamptz,
  duration_minutes numeric CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  cause text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  current_status text NOT NULL DEFAULT 'OPEN' CHECK (
    current_status IN ('OPEN', 'RESTORED', 'CANCELLED')
  ),
  etr timestamptz,
  CONSTRAINT interruptions_time_check CHECK (
    interruption_end IS NULL OR interruption_end >= interruption_start
  )
);

CREATE TABLE public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fcm_token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'android',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_unit_type text NOT NULL CHECK (
    max_unit_type IN ('SUB_DIVISION', 'DIVISION', 'CIRCLE', 'ZONE', 'REGION', 'HQ')
  ),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id),
  feeder_id uuid REFERENCES public.feeders(id),
  event_time timestamptz NOT NULL DEFAULT now(),
  message text NOT NULL,
  max_unit_type text NOT NULL,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id uuid NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id),
  org_unit_id uuid REFERENCES public.org_units(id),
  device_token_id uuid REFERENCES public.device_tokens(id),
  org_unit_type text,
  org_unit_name text,
  status text NOT NULL DEFAULT 'PENDING',
  delivery_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stations_active ON public.stations (active);
CREATE INDEX idx_stations_name ON public.stations (name);
CREATE INDEX idx_user_stations_user_id ON public.user_stations (user_id);
CREATE INDEX idx_user_stations_station_id ON public.user_stations (station_id);
CREATE INDEX idx_user_stations_active ON public.user_stations (user_id, active);
CREATE INDEX idx_org_units_parent_id ON public.org_units (parent_id);
CREATE INDEX idx_org_units_unit_type ON public.org_units (unit_type);
CREATE INDEX idx_station_org_units_station_id ON public.station_org_units (station_id);
CREATE INDEX idx_station_org_units_org_unit_id ON public.station_org_units (org_unit_id);
CREATE INDEX idx_user_org_units_user_id ON public.user_org_units (user_id);
CREATE INDEX idx_user_org_units_org_unit_id ON public.user_org_units (org_unit_id);
CREATE INDEX idx_log_book_entries_station ON public.log_book_entries (station_id);
CREATE INDEX idx_log_book_entries_feeder ON public.log_book_entries (feeder_id);
CREATE INDEX idx_log_book_entries_operator ON public.log_book_entries (operator_id);
CREATE INDEX idx_log_book_entries_actual_event_time ON public.log_book_entries (actual_event_time DESC);
CREATE INDEX idx_log_book_entries_station_time ON public.log_book_entries (station_id, actual_event_time DESC);
CREATE INDEX idx_log_book_entries_feeder_time ON public.log_book_entries (feeder_id, actual_event_time DESC);
CREATE UNIQUE INDEX log_book_entries_station_feeder_hour_unique
  ON public.log_book_entries (station_id, feeder_id, actual_event_time)
  WHERE feeder_id IS NOT NULL;
CREATE INDEX idx_interruptions_station_start ON public.interruptions (station_id, interruption_start DESC);
CREATE INDEX idx_interruptions_feeder_start ON public.interruptions (feeder_id, interruption_start DESC);
CREATE INDEX idx_interruptions_operator ON public.interruptions (operator_id);
CREATE INDEX idx_interruptions_status ON public.interruptions (current_status);
CREATE INDEX idx_device_tokens_user_id ON public.device_tokens (user_id);
CREATE INDEX idx_device_tokens_active ON public.device_tokens (is_active);
CREATE INDEX idx_notification_events_station ON public.notification_events (station_id);
CREATE INDEX idx_notification_events_feeder ON public.notification_events (feeder_id);
CREATE INDEX idx_notification_events_event_time ON public.notification_events (event_time);
CREATE INDEX idx_notification_events_created_by ON public.notification_events (created_by);
CREATE INDEX idx_notification_recipients_event ON public.notification_recipients (notification_event_id);
CREATE INDEX idx_notification_recipients_user ON public.notification_recipients (user_id);
CREATE INDEX idx_notification_recipients_device ON public.notification_recipients (device_token_id);
CREATE INDEX idx_notification_recipients_status ON public.notification_recipients (status);
CREATE UNIQUE INDEX uq_notification_recipient_device
  ON public.notification_recipients (notification_event_id, device_token_id)
  WHERE device_token_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.app_users
  WHERE id = auth.uid() AND active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_to_station(p_station_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_stations
    WHERE user_id = auth.uid()
      AND station_id = p_station_id
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_accessible_station_ids()
RETURNS TABLE(station_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_user_role;
BEGIN
  SELECT role INTO v_role
  FROM public.app_users
  WHERE id = auth.uid() AND active = true;

  IF v_role IN ('ADMIN'::public.app_user_role, 'FIELD_OFFICER'::public.app_user_role) THEN
    RETURN QUERY SELECT s.id FROM public.stations s WHERE s.active = true;
  ELSIF v_role = 'OPERATOR'::public.app_user_role THEN
    RETURN QUERY
      SELECT DISTINCT us.station_id
      FROM public.user_stations us
      JOIN public.stations s ON s.id = us.station_id
      WHERE us.user_id = auth.uid() AND us.active = true AND s.active = true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_recipients(
  p_station_id uuid,
  p_max_unit_type text
)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  org_unit_id uuid,
  org_unit_name text,
  org_unit_type text,
  device_token_id uuid,
  fcm_token text,
  platform text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE station_units AS (
    SELECT ou.id, ou.name, ou.unit_type, ou.parent_id
    FROM public.station_org_units sou
    JOIN public.org_units ou ON ou.id = sou.org_unit_id
    WHERE sou.station_id = p_station_id AND sou.active = true AND ou.active = true
    UNION
    SELECT parent.id, parent.name, parent.unit_type, parent.parent_id
    FROM station_units su
    JOIN public.org_units parent ON parent.id = su.parent_id
    WHERE parent.active = true
  ),
  allowed_units AS (
    SELECT DISTINCT id, name, unit_type
    FROM station_units
    WHERE CASE upper(p_max_unit_type)
      WHEN 'SUB_DIVISION' THEN unit_type IN ('SUB_DIVISION')
      WHEN 'DIVISION' THEN unit_type IN ('SUB_DIVISION', 'DIVISION')
      WHEN 'CIRCLE' THEN unit_type IN ('SUB_DIVISION', 'DIVISION', 'CIRCLE')
      WHEN 'ZONE' THEN unit_type IN ('SUB_DIVISION', 'DIVISION', 'CIRCLE', 'ZONE')
      WHEN 'REGION' THEN unit_type IN ('SUB_DIVISION', 'DIVISION', 'CIRCLE', 'ZONE', 'REGION')
      WHEN 'HQ' THEN unit_type IN ('SUB_DIVISION', 'DIVISION', 'CIRCLE', 'ZONE', 'REGION', 'HQ')
      ELSE false
    END
  )
  SELECT au.id, au.full_name, au.email, uou.org_unit_id, ou.name, ou.unit_type,
         dt.id, dt.fcm_token, dt.platform
  FROM public.user_org_units uou
  JOIN public.app_users au ON au.id = uou.user_id AND au.active = true
  JOIN allowed_units allowed ON allowed.id = uou.org_unit_id
  JOIN public.org_units ou ON ou.id = uou.org_unit_id
  JOIN public.device_tokens dt ON dt.user_id = au.id AND dt.is_active = true
  WHERE uou.active = true
  ORDER BY au.full_name;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_recipients(p_station_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  role public.app_user_role,
  org_unit_id uuid,
  org_unit_name text,
  org_unit_code text,
  unit_type text,
  hierarchy_level integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE station_org_tree AS (
    SELECT sou.station_id, o.id, o.name, o.code, o.unit_type, o.parent_id, 0 AS hierarchy_level
    FROM public.station_org_units sou
    JOIN public.org_units o ON o.id = sou.org_unit_id
    WHERE sou.station_id = p_station_id AND sou.active = true
    UNION ALL
    SELECT sot.station_id, parent.id, parent.name, parent.code, parent.unit_type,
           parent.parent_id, sot.hierarchy_level + 1
    FROM station_org_tree sot
    JOIN public.org_units parent ON parent.id = sot.parent_id
    WHERE sot.unit_type <> (
      SELECT nc.max_unit_type
      FROM public.notification_config nc
      WHERE nc.active = true
      ORDER BY nc.updated_at DESC
      LIMIT 1
    )
  )
  SELECT DISTINCT u.id, u.full_name, u.email, u.role, sot.id, sot.name, sot.code,
         sot.unit_type, sot.hierarchy_level
  FROM station_org_tree sot
  JOIN public.user_org_units uou ON uou.org_unit_id = sot.id AND uou.active = true
  JOIN public.app_users u ON u.id = uou.user_id AND u.active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_device_tokens(p_station_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  role public.app_user_role,
  org_unit_name text,
  org_unit_code text,
  unit_type text,
  fcm_token text,
  platform text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT r.user_id, r.full_name, r.email, r.role, r.org_unit_name,
         r.org_unit_code, r.unit_type, dt.fcm_token, dt.platform
  FROM public.get_notification_recipients(p_station_id) r
  JOIN public.device_tokens dt ON dt.user_id = r.user_id
  WHERE dt.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.claim_device_token(
  p_fcm_token text,
  p_platform text DEFAULT 'android'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.device_tokens (user_id, fcm_token, platform, is_active, updated_at)
  VALUES (v_user_id, p_fcm_token, p_platform, true, now())
  ON CONFLICT (fcm_token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_token_id;

  RETURN v_token_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_current_device_token(p_fcm_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  UPDATE public.device_tokens
  SET is_active = false, updated_at = now()
  WHERE user_id = auth.uid() AND fcm_token = p_fcm_token;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_notification_event(
  p_station_id uuid,
  p_feeder_id uuid,
  p_event_time timestamptz,
  p_message text,
  p_created_by uuid DEFAULT NULL,
  p_max_unit_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_event_id uuid;
  v_max_unit_type text := p_max_unit_type;
BEGIN
  IF v_max_unit_type IS NULL THEN
    SELECT nc.max_unit_type INTO v_max_unit_type
    FROM public.notification_config nc
    WHERE nc.active = true
    ORDER BY nc.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_max_unit_type IS NULL THEN
    RAISE EXCEPTION 'No active notification configuration found';
  END IF;

  INSERT INTO public.notification_events (
    station_id, feeder_id, event_time, message, max_unit_type, created_by
  ) VALUES (
    p_station_id, p_feeder_id, coalesce(p_event_time, now()), p_message,
    v_max_unit_type, p_created_by
  ) RETURNING id INTO v_notification_event_id;

  INSERT INTO public.notification_recipients (
    notification_event_id, user_id, org_unit_id, org_unit_name,
    org_unit_type, device_token_id, status
  )
  SELECT DISTINCT v_notification_event_id, r.user_id, r.org_unit_id,
         r.org_unit_name, r.org_unit_type, r.device_token_id, 'PENDING'
  FROM public.get_notification_recipients(p_station_id, v_max_unit_type) r;

  RETURN v_notification_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_interruption_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_name text;
  v_feeder_name text;
  v_message text;
  v_event_time timestamptz;
BEGIN
  SELECT name INTO v_station_name FROM public.stations WHERE id = NEW.station_id;
  SELECT name INTO v_feeder_name FROM public.feeders WHERE id = NEW.feeder_id;

  IF TG_OP = 'INSERT' AND NEW.current_status = 'OPEN' THEN
    v_event_time := NEW.interruption_start;
    v_message := coalesce(v_feeder_name, 'Feeder') || ' at '
      || coalesce(v_station_name, 'Unknown Station') || ' tripped at '
      || to_char(NEW.interruption_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM');
    IF NEW.cause IS NOT NULL AND btrim(NEW.cause) <> '' THEN
      v_message := v_message || '. Cause: ' || NEW.cause;
    END IF;
    v_message := v_message || '.';
  ELSIF TG_OP = 'UPDATE'
    AND OLD.current_status IS DISTINCT FROM NEW.current_status
    AND NEW.current_status = 'RESTORED' THEN
    v_event_time := coalesce(NEW.interruption_end, now());
    v_message := coalesce(v_feeder_name, 'Feeder') || ' at '
      || coalesce(v_station_name, 'Unknown Station') || ' restored at '
      || to_char(v_event_time AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification_event(
    NEW.station_id, NEW.feeder_id, v_event_time, v_message, NEW.operator_id, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Interruption notification generation failed.';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_logbook_day_hour_status(
  p_station_id uuid,
  p_date date
)
RETURNS TABLE(hour_no integer, entered_feeders bigint, total_feeders bigint, fill_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH feeder_count AS (
    SELECT count(*)::bigint AS total_feeders
    FROM public.feeders
    WHERE station_id = p_station_id AND active = true
  ), hours AS (
    SELECT generate_series(0, 23)::integer AS hour_no
  ), entries AS (
    SELECT extract(hour FROM actual_event_time AT TIME ZONE 'Asia/Kolkata')::integer AS hour_no,
           count(DISTINCT feeder_id)::bigint AS entered_feeders
    FROM public.log_book_entries
    WHERE station_id = p_station_id
      AND (actual_event_time AT TIME ZONE 'Asia/Kolkata')::date = p_date
    GROUP BY 1
  )
  SELECT h.hour_no, coalesce(e.entered_feeders, 0), fc.total_feeders,
         CASE WHEN coalesce(e.entered_feeders, 0) = 0 THEN 'EMPTY'
              WHEN coalesce(e.entered_feeders, 0) >= fc.total_feeders THEN 'FULL'
              ELSE 'PARTIAL' END
  FROM hours h CROSS JOIN feeder_count fc
  LEFT JOIN entries e ON e.hour_no = h.hour_no
  ORDER BY h.hour_no;
$$;

CREATE OR REPLACE FUNCTION public.get_logbook_month_status(
  p_station_id uuid,
  p_year integer,
  p_month integer
)
RETURNS TABLE(entry_date date, entered_slots bigint, expected_slots bigint, fill_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH feeder_count AS (
    SELECT count(*)::bigint AS total_feeders
    FROM public.feeders
    WHERE station_id = p_station_id AND active = true
  ), days AS (
    SELECT generate_series(
      make_date(p_year, p_month, 1),
      (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date,
      interval '1 day'
    )::date AS entry_date
  ), entries AS (
    SELECT (actual_event_time AT TIME ZONE 'Asia/Kolkata')::date AS entry_date,
           count(DISTINCT (feeder_id, date_trunc('hour', actual_event_time AT TIME ZONE 'Asia/Kolkata')))::bigint AS entered_slots
    FROM public.log_book_entries
    WHERE station_id = p_station_id
      AND (actual_event_time AT TIME ZONE 'Asia/Kolkata')::date >= make_date(p_year, p_month, 1)
      AND (actual_event_time AT TIME ZONE 'Asia/Kolkata')::date
        < (make_date(p_year, p_month, 1) + interval '1 month')::date
    GROUP BY 1
  )
  SELECT d.entry_date, coalesce(e.entered_slots, 0), (fc.total_feeders * 24)::bigint,
         CASE WHEN coalesce(e.entered_slots, 0) = 0 THEN 'EMPTY'
              WHEN coalesce(e.entered_slots, 0) >= fc.total_feeders * 24 THEN 'FULL'
              ELSE 'PARTIAL' END
  FROM days d CROSS JOIN feeder_count fc
  LEFT JOIN entries e ON e.entry_date = d.entry_date
  ORDER BY d.entry_date;
$$;

CREATE TRIGGER stations_updated_at
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_notification_config_updated_at
  BEFORE UPDATE ON public.notification_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER notification_events_updated_at
  BEFORE UPDATE ON public.notification_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER interruption_open_notification
  AFTER INSERT ON public.interruptions
  FOR EACH ROW WHEN (NEW.current_status = 'OPEN')
  EXECUTE FUNCTION public.handle_interruption_notification();
CREATE TRIGGER interruption_restored_notification
  AFTER UPDATE OF current_status ON public.interruptions
  FOR EACH ROW WHEN (
    OLD.current_status IS DISTINCT FROM NEW.current_status
    AND NEW.current_status = 'RESTORED'
  ) EXECUTE FUNCTION public.handle_interruption_notification();

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feeders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interruptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.app_users
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Authenticated users can view stations" ON public.stations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view feeders" ON public.feeders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view own station assignments" ON public.user_stations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can view all log entries" ON public.log_book_entries
  FOR SELECT TO authenticated USING (public.get_my_role() = 'ADMIN');
CREATE POLICY "Field officers can view all log entries" ON public.log_book_entries
  FOR SELECT TO authenticated USING (public.get_my_role() = 'FIELD_OFFICER');
CREATE POLICY "Operators can view own log entries" ON public.log_book_entries
  FOR SELECT TO authenticated USING (
    public.get_my_role() = 'OPERATOR' AND operator_id = auth.uid()
  );
CREATE POLICY "Operators can insert assigned log entries" ON public.log_book_entries
  FOR INSERT TO authenticated WITH CHECK (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  );
CREATE POLICY "Operators can update own assigned log entries" ON public.log_book_entries
  FOR UPDATE TO authenticated USING (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  ) WITH CHECK (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  );
CREATE POLICY "Admins can view all interruptions" ON public.interruptions
  FOR SELECT TO authenticated USING (public.get_my_role() = 'ADMIN');
CREATE POLICY "Field officers can view all interruptions" ON public.interruptions
  FOR SELECT TO authenticated USING (public.get_my_role() = 'FIELD_OFFICER');
CREATE POLICY "Operators can view own interruptions" ON public.interruptions
  FOR SELECT TO authenticated USING (
    public.get_my_role() = 'OPERATOR' AND operator_id = auth.uid()
  );
CREATE POLICY "Operators can insert assigned interruptions" ON public.interruptions
  FOR INSERT TO authenticated WITH CHECK (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  );
CREATE POLICY "Operators can update own assigned interruptions" ON public.interruptions
  FOR UPDATE TO authenticated USING (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  ) WITH CHECK (
    public.get_my_role() = 'OPERATOR'
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  );
CREATE POLICY "Users can view own device tokens" ON public.device_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own device token" ON public.device_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own device token" ON public.device_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own device token" ON public.device_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.app_users, public.stations, public.feeders,
  public.user_stations, public.log_book_entries, public.interruptions,
  public.device_tokens
  TO authenticated;
GRANT INSERT, UPDATE ON public.log_book_entries, public.interruptions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_assigned_to_station(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_accessible_station_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_recipients(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_recipients(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_device_tokens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_device_token(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_current_device_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_notification_event(uuid, uuid, timestamptz, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_interruption_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_logbook_day_hour_status(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_logbook_month_status(uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_accessible_station_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_device_tokens(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_device_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_current_device_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_logbook_day_hour_status(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_logbook_month_status(uuid, integer, integer) TO authenticated;

COMMIT;
