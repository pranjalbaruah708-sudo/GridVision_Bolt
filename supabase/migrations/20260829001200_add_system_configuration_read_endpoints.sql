-- Stage 13: narrow, server-scoped read endpoints for existing configuration writers.
CREATE OR REPLACE FUNCTION public.get_feeder_thresholds_page(
  p_search text DEFAULT NULL, p_station_id uuid DEFAULT NULL, p_feeder_id uuid DEFAULT NULL,
  p_parameter_code text DEFAULT NULL, p_feeder_active boolean DEFAULT NULL,
  p_page integer DEFAULT 0, p_page_size integer DEFAULT 25
) RETURNS TABLE(id uuid,station_id uuid,station_name text,feeder_id uuid,feeder_name text,parameter_code text,min_value numeric,max_value numeric,feeder_active boolean,updated_at timestamptz,updated_by_name text,total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH allowed AS (SELECT station_id FROM public.get_my_manageable_feeder_station_ids()), rows AS (
    SELECT ft.id,s.id,s.name,f.id,f.name,ft.parameter_code,ft.min_value,ft.max_value,f.active,ft.updated_at,au.full_name,count(*) OVER()::bigint
    FROM public.feeder_thresholds ft JOIN public.feeders f ON f.id=ft.feeder_id JOIN public.stations s ON s.id=f.station_id
    LEFT JOIN public.app_users au ON au.id=(SELECT (al.new_values->>'updated_by')::uuid FROM public.administration_audit_log al WHERE al.entity_type='FEEDER_THRESHOLD' AND al.entity_id=ft.id ORDER BY al.created_at DESC LIMIT 1)
    JOIN allowed a ON a.station_id=s.id
    WHERE (p_search IS NULL OR p_search='' OR f.name ILIKE '%'||p_search||'%' OR s.name ILIKE '%'||p_search||'%' OR ft.parameter_code ILIKE '%'||p_search||'%')
      AND (p_station_id IS NULL OR s.id=p_station_id) AND (p_feeder_id IS NULL OR f.id=p_feeder_id)
      AND (p_parameter_code IS NULL OR p_parameter_code='' OR ft.parameter_code=p_parameter_code)
      AND (p_feeder_active IS NULL OR f.active=p_feeder_active)
  ) SELECT * FROM rows ORDER BY 3,5,6 OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;
CREATE OR REPLACE FUNCTION public.get_threshold_scope_options()
RETURNS TABLE(kind text,id uuid,name text,station_id uuid,station_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH allowed AS (SELECT station_id FROM public.get_my_manageable_feeder_station_ids())
  SELECT 'STATION'::text,s.id,s.name,s.id,s.name FROM public.stations s JOIN allowed a ON a.station_id=s.id WHERE s.active
  UNION ALL
  SELECT 'FEEDER'::text,f.id,f.name,s.id,s.name FROM public.feeders f JOIN public.stations s ON s.id=f.station_id JOIN allowed a ON a.station_id=s.id WHERE f.active
$$;
CREATE OR REPLACE FUNCTION public.get_global_notification_config()
RETURNS TABLE(id uuid,active boolean,max_unit_type text,updated_at timestamptz,updated_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT nc.id,nc.active,nc.max_unit_type,nc.updated_at,au.full_name
  FROM public.notification_config nc LEFT JOIN public.app_users au ON au.id=nc.updated_by
  WHERE public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role)
$$;
GRANT EXECUTE ON FUNCTION public.get_feeder_thresholds_page(text,uuid,uuid,text,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_threshold_scope_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_notification_config() TO authenticated;
