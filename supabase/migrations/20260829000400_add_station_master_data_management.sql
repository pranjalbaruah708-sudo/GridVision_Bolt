-- GridVision Administration Stage 6: station master data and many-to-many office mappings.
ALTER TABLE public.stations ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS archive_reason text;

DROP POLICY IF EXISTS "Super admins manage stations" ON public.stations;
CREATE POLICY "Super admins manage stations" ON public.stations FOR ALL TO authenticated
USING (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role)
WITH CHECK (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role);

CREATE OR REPLACE FUNCTION public.get_stations_admin_page(p_search text DEFAULT NULL,p_active boolean DEFAULT NULL,p_page integer DEFAULT 0,p_page_size integer DEFAULT 25)
RETURNS TABLE(id uuid,code text,name text,location text,voltage_level_kv numeric,active boolean,office_count bigint,feeder_count bigint,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH permitted AS (SELECT public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed), rows AS (
    SELECT s.id,s.code,s.name,s.location,s.voltage_level_kv,s.active,(SELECT count(*) FROM public.station_org_units sou WHERE sou.station_id=s.id AND sou.active)::bigint,(SELECT count(*) FROM public.feeders f WHERE f.station_id=s.id)::bigint,count(*) OVER()::bigint
    FROM public.stations s CROSS JOIN permitted WHERE permitted.allowed AND (p_search IS NULL OR p_search='' OR s.name ILIKE '%'||p_search||'%' OR s.code ILIKE '%'||p_search||'%') AND (p_active IS NULL OR s.active=p_active)
  ) SELECT * FROM rows ORDER BY active DESC,name ASC OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_station_admin_detail(p_id uuid)
RETURNS TABLE(id uuid,code text,name text,location text,voltage_level_kv numeric,active boolean,archive_reason text,office_ids uuid[],office_names text[],primary_office_id uuid,feeder_count bigint,authorised_users text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH permitted AS (SELECT public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed)
  SELECT s.id,s.code,s.name,s.location,s.voltage_level_kv,s.active,s.archive_reason,
    ARRAY(SELECT sou.org_unit_id FROM public.station_org_units sou WHERE sou.station_id=s.id AND sou.active ORDER BY sou.is_primary DESC),
    ARRAY(SELECT ou.name FROM public.station_org_units sou JOIN public.org_units ou ON ou.id=sou.org_unit_id WHERE sou.station_id=s.id AND sou.active ORDER BY sou.is_primary DESC,ou.name),
    (SELECT sou.org_unit_id FROM public.station_org_units sou WHERE sou.station_id=s.id AND sou.active AND sou.is_primary LIMIT 1),
    (SELECT count(*) FROM public.feeders f WHERE f.station_id=s.id)::bigint,
    ARRAY(SELECT au.full_name FROM public.user_stations us JOIN public.app_users au ON au.id=us.user_id WHERE us.station_id=s.id AND us.active ORDER BY au.full_name)
  FROM public.stations s CROSS JOIN permitted WHERE s.id=p_id AND permitted.allowed;
$$;

CREATE OR REPLACE FUNCTION public.get_active_office_options()
RETURNS TABLE(id uuid,name text,unit_type text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT ou.id,ou.name,ou.unit_type FROM public.org_units ou WHERE ou.active AND public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) ORDER BY ou.name;
$$;

CREATE OR REPLACE FUNCTION public.save_station_admin(p_id uuid,p_code text,p_name text,p_location text,p_voltage_level_kv numeric,p_office_ids uuid[],p_primary_office_id uuid DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_old public.stations%ROWTYPE; v_office_id uuid;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may manage stations' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_code,''))='' OR btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION 'Station code and name are required' USING ERRCODE='22023'; END IF;
  IF coalesce(cardinality(p_office_ids),0)=0 THEN RAISE EXCEPTION 'At least one active office mapping is required' USING ERRCODE='22023'; END IF;
  IF cardinality(p_office_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_office_ids) item) THEN RAISE EXCEPTION 'Duplicate office mappings are not allowed' USING ERRCODE='22023'; END IF;
  IF p_primary_office_id IS NOT NULL AND NOT (p_primary_office_id = ANY(p_office_ids)) THEN RAISE EXCEPTION 'Primary office must be one of the selected offices' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_office_ids) item LEFT JOIN public.org_units ou ON ou.id=item WHERE ou.id IS NULL OR NOT ou.active) THEN RAISE EXCEPTION 'Archived or invalid offices cannot receive new mappings' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.stations WHERE id=p_id FOR UPDATE;
  IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Station not found' USING ERRCODE='P0002'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.stations(code,name,location,voltage_level_kv) VALUES (btrim(p_code),btrim(p_name),nullif(btrim(coalesce(p_location,'')),''),p_voltage_level_kv) RETURNING id INTO v_id; ELSE UPDATE public.stations SET code=btrim(p_code),name=btrim(p_name),location=nullif(btrim(coalesce(p_location,'')),''),voltage_level_kv=p_voltage_level_kv,updated_at=now() WHERE id=p_id RETURNING id INTO v_id; END IF;
  UPDATE public.station_org_units SET active=false,updated_at=now() WHERE station_id=v_id AND org_unit_id <> ALL(p_office_ids);
  FOREACH v_office_id IN ARRAY p_office_ids LOOP
    INSERT INTO public.station_org_units(station_id,org_unit_id,is_primary,active) VALUES(v_id,v_office_id,coalesce(p_primary_office_id,v_office_id)=v_office_id,true) ON CONFLICT(station_id,org_unit_id) DO UPDATE SET active=true,is_primary=EXCLUDED.is_primary,updated_at=now();
  END LOOP;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'STATION',v_id,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(s),nullif(btrim(coalesce(p_reason,'')),'') FROM public.stations s WHERE s.id=v_id;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,after_data,reason) VALUES(auth.uid(),'UPDATE_MAPPINGS','STATION_OFFICE_MAPPING',v_id,jsonb_build_object('office_ids',p_office_ids,'primary_office_id',p_primary_office_id),nullif(btrim(coalesce(p_reason,'')),''));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_station_admin(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.stations%ROWTYPE;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may archive stations' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.stations WHERE id=p_id FOR UPDATE; IF v_old.id IS NULL THEN RAISE EXCEPTION 'Station not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.stations SET active=false,archived_at=now(),archived_by=auth.uid(),archive_reason=btrim(p_reason),updated_at=now() WHERE id=p_id;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),'ARCHIVE','STATION',p_id,to_jsonb(v_old),to_jsonb(s),btrim(p_reason) FROM public.stations s WHERE s.id=p_id;
END; $$;

REVOKE ALL ON FUNCTION public.save_station_admin(uuid,text,text,text,numeric,uuid[],uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_station_admin(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stations_admin_page(text,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_station_admin_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_office_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_station_admin(uuid,text,text,text,numeric,uuid[],uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_station_admin(uuid,text) TO authenticated;
