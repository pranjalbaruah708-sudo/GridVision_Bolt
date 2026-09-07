-- Read-only identity details for the authenticated desktop application shell.
CREATE OR REPLACE FUNCTION public.get_my_desktop_identity()
RETURNS TABLE (
  full_name text,
  employee_code text,
  designation text,
  account_role text,
  assigned_offices text[],
  accessible_station_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    au.full_name,
    au.employee_code,
    au.designation,
    au.role::text,
    ARRAY(
      SELECT ou.name
      FROM public.user_org_units uou
      JOIN public.org_units ou ON ou.id = uou.org_unit_id
      WHERE uou.user_id = auth.uid() AND uou.active AND ou.active
      ORDER BY uou.is_primary DESC, ou.name
    ),
    (SELECT count(*) FROM public.get_my_accessible_station_ids())
  FROM public.app_users au
  WHERE au.id = auth.uid() AND au.active;
$$;

REVOKE ALL ON FUNCTION public.get_my_desktop_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_desktop_identity() TO authenticated;
