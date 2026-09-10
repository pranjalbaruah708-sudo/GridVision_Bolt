-- Keep feeder-management authorization on the same authoritative station
-- scope as direct reads and remove the ambiguous FIELD_OFFICER query exposed
-- by the station-scoped feeder policy.

CREATE OR REPLACE FUNCTION public.get_my_manageable_feeder_station_ids()
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
      SELECT accessible.station_id
      FROM public.get_my_accessible_station_ids() AS accessible;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_manageable_feeder_station_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_manageable_feeder_station_ids()
  TO authenticated;
