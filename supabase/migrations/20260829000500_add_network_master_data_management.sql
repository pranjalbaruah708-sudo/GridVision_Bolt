-- GridVision Administration Stage 7: feeder master data. Interruption causes
-- remain read-only distinct values because the deployed schema has no cause table.
ALTER TABLE public.feeders ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE OR REPLACE FUNCTION public.get_my_manageable_feeder_station_ids()
RETURNS TABLE(station_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role public.app_user_role;
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id=auth.uid() AND active;
  IF v_role IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) THEN RETURN QUERY SELECT id FROM public.stations WHERE active; RETURN; END IF;
  IF v_role='FIELD_OFFICER'::public.app_user_role THEN RETURN QUERY SELECT DISTINCT us.station_id FROM public.user_stations us JOIN public.stations s ON s.id=us.station_id WHERE us.user_id=auth.uid() AND us.active AND s.active; END IF;
END; $$;

DROP POLICY IF EXISTS "Network managers manage scoped feeders" ON public.feeders;
CREATE POLICY "Network managers manage scoped feeders" ON public.feeders FOR ALL TO authenticated
USING (public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) OR (public.get_my_role()='FIELD_OFFICER'::public.app_user_role AND EXISTS (SELECT 1 FROM public.get_my_manageable_feeder_station_ids() m WHERE m.station_id=feeders.station_id)))
WITH CHECK (public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) OR (public.get_my_role()='FIELD_OFFICER'::public.app_user_role AND EXISTS (SELECT 1 FROM public.get_my_manageable_feeder_station_ids() m WHERE m.station_id=feeders.station_id)));

CREATE OR REPLACE FUNCTION public.get_feeders_admin_page(p_search text DEFAULT NULL,p_active boolean DEFAULT NULL,p_station_id uuid DEFAULT NULL,p_page integer DEFAULT 0,p_page_size integer DEFAULT 25)
RETURNS TABLE(id uuid,code text,name text,station_id uuid,station_name text,voltage_level_kv numeric,consumer_count integer,active boolean,total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH allowed AS (SELECT station_id FROM public.get_my_manageable_feeder_station_ids()), rows AS (
    SELECT f.id,f.code,f.name,f.station_id,s.name AS station_name,f.voltage_level_kv,f.consumer_count,f.active,count(*) OVER()::bigint FROM public.feeders f JOIN public.stations s ON s.id=f.station_id JOIN allowed a ON a.station_id=f.station_id
    WHERE (p_search IS NULL OR p_search='' OR f.name ILIKE '%'||p_search||'%' OR f.code ILIKE '%'||p_search||'%') AND (p_active IS NULL OR f.active=p_active) AND (p_station_id IS NULL OR f.station_id=p_station_id)
  ) SELECT * FROM rows ORDER BY active DESC,station_name,name OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_feeder_admin_detail(p_id uuid)
RETURNS TABLE(id uuid,code text,name text,station_id uuid,station_name text,voltage_level_kv numeric,consumer_count integer,active boolean,archive_reason text,logbook_count bigint,interruption_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH allowed AS (SELECT station_id FROM public.get_my_manageable_feeder_station_ids())
  SELECT f.id,f.code,f.name,f.station_id,s.name,f.voltage_level_kv,f.consumer_count,f.active,f.archive_reason,(SELECT count(*) FROM public.log_book_entries l WHERE l.feeder_id=f.id)::bigint,(SELECT count(*) FROM public.interruptions i WHERE i.feeder_id=f.id)::bigint FROM public.feeders f JOIN public.stations s ON s.id=f.station_id JOIN allowed a ON a.station_id=f.station_id WHERE f.id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.get_manageable_station_options()
RETURNS TABLE(id uuid,name text,code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT s.id,s.name,s.code FROM public.stations s JOIN public.get_my_manageable_feeder_station_ids() a ON a.station_id=s.id ORDER BY s.name; $$;
CREATE OR REPLACE FUNCTION public.get_interruption_causes_reference()
RETURNS TABLE(cause text, usage_count bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$ SELECT cause,count(*)::bigint FROM public.interruptions WHERE cause IS NOT NULL AND btrim(cause)<>'' GROUP BY cause ORDER BY count(*) DESC,cause; $$;

CREATE OR REPLACE FUNCTION public.save_feeder_admin(p_id uuid,p_code text,p_name text,p_station_id uuid,p_voltage_level_kv numeric,p_consumer_count integer,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_old public.feeders%ROWTYPE; v_role public.app_user_role;
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id=auth.uid() AND active;
  IF v_role NOT IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Insufficient privilege to manage feeders' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_my_manageable_feeder_station_ids() a WHERE a.station_id=p_station_id) THEN RAISE EXCEPTION 'You cannot manage feeders for this station' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_code,''))='' OR btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION 'Feeder code and name are required' USING ERRCODE='22023'; END IF;
  IF coalesce(p_consumer_count,0)<0 THEN RAISE EXCEPTION 'Consumer count cannot be negative' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.feeders WHERE id=p_id FOR UPDATE; IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Feeder not found' USING ERRCODE='P0002'; END IF;
  IF p_id IS NOT NULL AND v_old.station_id IS DISTINCT FROM p_station_id AND btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'A reason is required when changing a feeder station' USING ERRCODE='22023'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.feeders(code,name,station_id,voltage_level_kv,consumer_count) VALUES(btrim(p_code),btrim(p_name),p_station_id,p_voltage_level_kv,coalesce(p_consumer_count,0)) RETURNING id INTO v_id; ELSE UPDATE public.feeders SET code=btrim(p_code),name=btrim(p_name),station_id=p_station_id,voltage_level_kv=p_voltage_level_kv,consumer_count=coalesce(p_consumer_count,0),updated_at=now() WHERE id=p_id RETURNING id INTO v_id; END IF;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),CASE WHEN p_id IS NULL THEN 'CREATE' WHEN v_old.station_id IS DISTINCT FROM p_station_id THEN 'MOVE_STATION' ELSE 'UPDATE' END,'FEEDER',v_id,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(f),nullif(btrim(coalesce(p_reason,'')),'') FROM public.feeders f WHERE f.id=v_id;
  RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION public.archive_feeder_admin(p_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_old public.feeders%ROWTYPE; BEGIN IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF; SELECT * INTO v_old FROM public.feeders WHERE id=p_id FOR UPDATE; IF v_old.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.get_my_manageable_feeder_station_ids() a WHERE a.station_id=v_old.station_id) THEN RAISE EXCEPTION 'Feeder not found or outside your scope' USING ERRCODE='42501'; END IF; UPDATE public.feeders SET active=false,archived_at=now(),archived_by=auth.uid(),archive_reason=btrim(p_reason),updated_at=now() WHERE id=p_id; INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),'ARCHIVE','FEEDER',p_id,to_jsonb(v_old),to_jsonb(f),btrim(p_reason) FROM public.feeders f WHERE f.id=p_id; END; $$;
GRANT EXECUTE ON FUNCTION public.get_my_manageable_feeder_station_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_feeders_admin_page(text,boolean,uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_feeder_admin_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manageable_station_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_interruption_causes_reference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_feeder_admin(uuid,text,text,uuid,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_feeder_admin(uuid,text) TO authenticated;
