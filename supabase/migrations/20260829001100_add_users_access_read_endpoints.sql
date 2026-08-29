-- Stage 12: scoped, paginated read endpoints for the existing Users & Access backend.

CREATE OR REPLACE FUNCTION public.get_users_access_page(
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_office_id uuid DEFAULT NULL,
  p_station_id uuid DEFAULT NULL,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE(
  id uuid, full_name text, employee_code text, email text, phone text, role text, active boolean,
  office_names text[], station_names text[], device_count bigint, created_at timestamptz, updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  WITH actor AS (SELECT public.get_my_role() AS role), rows AS (
    SELECT au.id, au.full_name, au.employee_code, au.email, au.phone, au.role::text, au.active,
      ARRAY(SELECT ou.name FROM public.user_org_units uou JOIN public.org_units ou ON ou.id=uou.org_unit_id WHERE uou.user_id=au.id AND uou.active ORDER BY ou.name),
      ARRAY(SELECT s.name FROM public.user_stations us JOIN public.stations s ON s.id=us.station_id WHERE us.user_id=au.id AND us.active ORDER BY s.name),
      (SELECT count(*) FROM public.device_tokens dt WHERE dt.user_id=au.id AND dt.is_active)::bigint,
      au.created_at, au.updated_at, count(*) OVER()::bigint
    FROM public.app_users au CROSS JOIN actor
    WHERE actor.role IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
      AND (actor.role <> 'FIELD_OFFICER'::public.app_user_role OR EXISTS (
        SELECT 1 FROM public.user_org_units target JOIN public.user_org_units mine ON mine.org_unit_id=target.org_unit_id
        WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active
      ) OR EXISTS (
        SELECT 1 FROM public.user_stations target JOIN public.user_stations mine ON mine.station_id=target.station_id
        WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active
      ))
      AND (p_search IS NULL OR p_search='' OR au.full_name ILIKE '%'||p_search||'%' OR au.employee_code ILIKE '%'||p_search||'%' OR au.email ILIKE '%'||p_search||'%')
      AND (p_role IS NULL OR p_role='' OR au.role::text=p_role)
      AND (p_active IS NULL OR au.active=p_active)
      AND (p_office_id IS NULL OR EXISTS (SELECT 1 FROM public.user_org_units uou WHERE uou.user_id=au.id AND uou.org_unit_id=p_office_id AND uou.active))
      AND (p_station_id IS NULL OR EXISTS (SELECT 1 FROM public.user_stations us WHERE us.user_id=au.id AND us.station_id=p_station_id AND us.active))
  )
  SELECT * FROM rows ORDER BY active DESC, full_name OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_user_access_detail(p_user_id uuid)
RETURNS TABLE(
  id uuid, full_name text, employee_code text, email text, phone text, role text, active boolean,
  office_ids uuid[], office_names text[], station_ids uuid[], station_names text[], device_count bigint,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  WITH actor AS (SELECT public.get_my_role() AS role)
  SELECT au.id, au.full_name, au.employee_code, au.email, au.phone, au.role::text, au.active,
    ARRAY(SELECT uou.org_unit_id FROM public.user_org_units uou WHERE uou.user_id=au.id AND uou.active ORDER BY uou.org_unit_id),
    ARRAY(SELECT ou.name FROM public.user_org_units uou JOIN public.org_units ou ON ou.id=uou.org_unit_id WHERE uou.user_id=au.id AND uou.active ORDER BY ou.name),
    ARRAY(SELECT us.station_id FROM public.user_stations us WHERE us.user_id=au.id AND us.active ORDER BY us.station_id),
    ARRAY(SELECT s.name FROM public.user_stations us JOIN public.stations s ON s.id=us.station_id WHERE us.user_id=au.id AND us.active ORDER BY s.name),
    (SELECT count(*) FROM public.device_tokens dt WHERE dt.user_id=au.id AND dt.is_active)::bigint, au.created_at, au.updated_at
  FROM public.app_users au CROSS JOIN actor
  WHERE au.id=p_user_id AND actor.role IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
    AND (actor.role <> 'FIELD_OFFICER'::public.app_user_role OR EXISTS (
      SELECT 1 FROM public.user_org_units target JOIN public.user_org_units mine ON mine.org_unit_id=target.org_unit_id
      WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active
    ) OR EXISTS (
      SELECT 1 FROM public.user_stations target JOIN public.user_stations mine ON mine.station_id=target.station_id
      WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active
    ));
$$;

CREATE OR REPLACE FUNCTION public.get_users_access_scope_options()
RETURNS TABLE(kind text, id uuid, name text, code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  WITH actor AS (SELECT public.get_my_role() AS role)
  SELECT 'OFFICE'::text, ou.id, ou.name, ou.code FROM public.org_units ou CROSS JOIN actor
  WHERE ou.active AND actor.role IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
    AND (actor.role <> 'FIELD_OFFICER'::public.app_user_role OR EXISTS (SELECT 1 FROM public.user_org_units mine WHERE mine.user_id=auth.uid() AND mine.org_unit_id=ou.id AND mine.active))
  UNION ALL
  SELECT 'STATION'::text, s.id, s.name, s.code FROM public.stations s CROSS JOIN actor
  WHERE s.active AND actor.role IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
    AND (actor.role <> 'FIELD_OFFICER'::public.app_user_role OR EXISTS (SELECT 1 FROM public.user_stations mine WHERE mine.user_id=auth.uid() AND mine.station_id=s.id AND mine.active));
$$;

GRANT EXECUTE ON FUNCTION public.get_users_access_page(text,text,boolean,uuid,uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_access_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_access_scope_options() TO authenticated;
