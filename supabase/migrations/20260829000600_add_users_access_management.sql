-- GridVision Administration Stage 8: secure user directory, assignments, and role safeguards.
CREATE OR REPLACE FUNCTION public.get_users_admin_page(p_search text DEFAULT NULL,p_active boolean DEFAULT NULL,p_page integer DEFAULT 0,p_page_size integer DEFAULT 25)
RETURNS TABLE(id uuid,full_name text,employee_code text,email text,phone text,role text,active boolean,office_names text[],station_names text[],total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH actor AS (SELECT public.get_my_role() AS role), rows AS (
    SELECT au.id,au.full_name,au.employee_code,au.email,au.phone,au.role::text,au.active,
      ARRAY(SELECT ou.name FROM public.user_org_units uou JOIN public.org_units ou ON ou.id=uou.org_unit_id WHERE uou.user_id=au.id AND uou.active ORDER BY ou.name),
      ARRAY(SELECT s.name FROM public.user_stations us JOIN public.stations s ON s.id=us.station_id WHERE us.user_id=au.id AND us.active ORDER BY s.name),count(*) OVER()::bigint
    FROM public.app_users au CROSS JOIN actor WHERE actor.role IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
      AND (actor.role <> 'FIELD_OFFICER'::public.app_user_role OR EXISTS (SELECT 1 FROM public.user_org_units target JOIN public.user_org_units mine ON mine.org_unit_id=target.org_unit_id WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active) OR EXISTS (SELECT 1 FROM public.user_stations target JOIN public.user_stations mine ON mine.station_id=target.station_id WHERE target.user_id=au.id AND mine.user_id=auth.uid() AND target.active AND mine.active))
      AND (p_search IS NULL OR p_search='' OR au.full_name ILIKE '%'||p_search||'%' OR au.employee_code ILIKE '%'||p_search||'%' OR au.email ILIKE '%'||p_search||'%') AND (p_active IS NULL OR au.active=p_active)
  ) SELECT * FROM rows ORDER BY active DESC,full_name OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;
CREATE OR REPLACE FUNCTION public.manage_user_access(p_user_id uuid,p_full_name text,p_employee_code text,p_phone text,p_role public.app_user_role,p_active boolean,p_office_ids uuid[],p_station_ids uuid[],p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_user_role; target public.app_user_role; item uuid;
BEGIN
  SELECT role INTO actor FROM public.app_users WHERE id=auth.uid() AND active; SELECT role INTO target FROM public.app_users WHERE id=p_user_id FOR UPDATE;
  IF actor NOT IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Only administrators may manage users' USING ERRCODE='42501'; END IF;
  IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'You cannot change your own access' USING ERRCODE='42501'; END IF;
  IF actor='ADMIN'::public.app_user_role AND (target='SUPER_ADMIN'::public.app_user_role OR p_role='SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Administrators cannot modify Super Admin access' USING ERRCODE='42501'; END IF;
  IF target='SUPER_ADMIN'::public.app_user_role AND NOT p_active AND (SELECT count(*) FROM public.app_users WHERE role='SUPER_ADMIN' AND active)<=1 THEN RAISE EXCEPTION 'The last active Super Admin cannot be deactivated' USING ERRCODE='22023'; END IF;
  UPDATE public.app_users SET full_name=btrim(p_full_name),employee_code=nullif(btrim(coalesce(p_employee_code,'')),''),phone=nullif(btrim(coalesce(p_phone,'')),''),role=p_role,active=p_active,updated_at=now() WHERE id=p_user_id;
  UPDATE public.user_org_units SET active=false,updated_at=now() WHERE user_id=p_user_id AND org_unit_id <> ALL(coalesce(p_office_ids,'{}'::uuid[])); FOREACH item IN ARRAY coalesce(p_office_ids,'{}'::uuid[]) LOOP INSERT INTO public.user_org_units(user_id,org_unit_id,active) VALUES(p_user_id,item,true) ON CONFLICT(user_id,org_unit_id) DO UPDATE SET active=true,updated_at=now(); END LOOP;
  UPDATE public.user_stations SET active=false,updated_at=now() WHERE user_id=p_user_id AND station_id <> ALL(coalesce(p_station_ids,'{}'::uuid[])); FOREACH item IN ARRAY coalesce(p_station_ids,'{}'::uuid[]) LOOP INSERT INTO public.user_stations(user_id,station_id,active) VALUES(p_user_id,item,true) ON CONFLICT(user_id,station_id) DO UPDATE SET active=true,updated_at=now(); END LOOP;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,after_data,reason) VALUES(auth.uid(),'MANAGE_ACCESS','APP_USER',p_user_id,jsonb_build_object('role',p_role,'active',p_active,'office_ids',p_office_ids,'station_ids',p_station_ids),nullif(btrim(coalesce(p_reason,'')),''));
END; $$;
GRANT EXECUTE ON FUNCTION public.get_users_admin_page(text,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_user_access(uuid,text,text,text,public.app_user_role,boolean,uuid[],uuid[],text) TO authenticated;
