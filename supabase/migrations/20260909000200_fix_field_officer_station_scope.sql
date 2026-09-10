-- Correct FIELD_OFFICER station scope without changing any other role.
-- get_my_accessible_org_unit_ids() already expands active assigned units to
-- their active descendants, so station resolution must not repeat traversal.

CREATE OR REPLACE FUNCTION public.get_my_accessible_station_ids()
RETURNS TABLE(station_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_user_role;
BEGIN
  SELECT au.role
  INTO v_role
  FROM public.app_users au
  WHERE au.id = auth.uid()
    AND au.active = true;

  IF v_role IS NULL THEN
    RETURN;
  END IF;

  IF v_role IN (
    'ADMIN'::public.app_user_role,
    'SUPER_ADMIN'::public.app_user_role
  ) THEN
    RETURN QUERY
      SELECT s.id
      FROM public.stations s
      WHERE s.active = true
      ORDER BY s.name;
    RETURN;
  END IF;

  IF v_role = 'FIELD_OFFICER'::public.app_user_role THEN
    RETURN QUERY
      SELECT scoped.station_id
      FROM (
        SELECT DISTINCT s.id AS station_id, s.name AS station_name
        FROM public.get_my_accessible_org_unit_ids() accessible
        JOIN public.station_org_units sou
          ON sou.org_unit_id = accessible.org_unit_id
         AND sou.active = true
        JOIN public.stations s
          ON s.id = sou.station_id
         AND s.active = true
      ) scoped
      ORDER BY scoped.station_name;
    RETURN;
  END IF;

  IF v_role = 'OPERATOR'::public.app_user_role THEN
    RETURN QUERY
      SELECT scoped.station_id
      FROM (
        SELECT DISTINCT s.id AS station_id, s.name AS station_name
        FROM public.user_stations us
        JOIN public.stations s
          ON s.id = us.station_id
         AND s.active = true
        WHERE us.user_id = auth.uid()
          AND us.active = true
      ) scoped
      ORDER BY scoped.station_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_accessible_station_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_accessible_station_ids()
  TO authenticated;
