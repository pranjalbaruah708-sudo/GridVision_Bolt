-- Stage 11: complete scoped audit coverage without changing administration permissions.
-- Existing threshold and notification-setting writers already emit scoped snapshots and
-- are intentionally left unchanged.

CREATE OR REPLACE FUNCTION public.write_administration_audit(
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_station_id uuid,
  p_org_unit_id uuid,
  p_visibility text,
  p_old_values jsonb,
  p_new_values jsonb,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_visibility NOT IN ('SCOPED', 'ADMIN_GLOBAL', 'SUPER_ADMIN_ONLY') THEN
    RAISE EXCEPTION 'Invalid audit visibility' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.administration_audit_log(
    actor_id, action, entity_type, entity_id, station_id, org_unit_id, visibility,
    before_data, after_data, old_values, new_values, reason
  ) VALUES (
    p_actor_id, p_action, p_entity_type, p_entity_id, p_station_id, p_org_unit_id, p_visibility,
    p_old_values, p_new_values, p_old_values, p_new_values, p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_administration_audit(uuid,text,text,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_administration_audit(uuid,text,text,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM anon;
REVOKE ALL ON FUNCTION public.write_administration_audit(uuid,text,text,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM authenticated;

-- Normal clients can read only through the existing RLS policy and cannot write or alter the ledger.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.administration_audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_org_unit(
  p_id uuid, p_code text, p_name text, p_unit_type text,
  p_parent_id uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_old public.org_units%ROWTYPE;
  v_new public.org_units%ROWTYPE;
  v_parent_type text;
  v_parent_rank integer;
  v_type_rank integer;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN
    RAISE EXCEPTION 'Only Super Admin may manage offices' USING ERRCODE='42501';
  END IF;
  IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Office code and name are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_old FROM public.org_units WHERE id = p_id FOR UPDATE;
  IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Office not found' USING ERRCODE='P0002'; END IF;
  IF p_id IS NOT NULL AND p_parent_id = p_id THEN RAISE EXCEPTION 'An office cannot parent itself' USING ERRCODE='22023'; END IF;
  IF p_parent_id IS NOT NULL THEN
    SELECT unit_type INTO v_parent_type FROM public.org_units WHERE id = p_parent_id;
    IF v_parent_type IS NULL THEN RAISE EXCEPTION 'Parent office not found' USING ERRCODE='23503'; END IF;
    SELECT hierarchy_rank INTO v_parent_rank FROM public.get_org_unit_types() WHERE unit_type = v_parent_type;
    SELECT hierarchy_rank INTO v_type_rank FROM public.get_org_unit_types() WHERE unit_type = p_unit_type;
    IF v_parent_rank IS NULL OR v_type_rank IS NULL OR v_parent_rank >= v_type_rank THEN RAISE EXCEPTION 'Parent office type must be higher in the configured hierarchy' USING ERRCODE='22023'; END IF;
    IF p_id IS NOT NULL AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM public.org_units WHERE parent_id = p_id
        UNION ALL
        SELECT child.id FROM public.org_units child JOIN descendants d ON child.parent_id = d.id
      ) SELECT 1 FROM descendants WHERE id = p_parent_id
    ) THEN RAISE EXCEPTION 'This change would create a circular hierarchy' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.org_units(code, name, unit_type, parent_id)
    VALUES (btrim(p_code), btrim(p_name), p_unit_type, p_parent_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.org_units SET code=btrim(p_code), name=btrim(p_name), unit_type=p_unit_type,
      parent_id=p_parent_id, updated_at=now() WHERE id=p_id RETURNING id INTO v_id;
  END IF;
  SELECT * INTO v_new FROM public.org_units WHERE id=v_id;

  PERFORM public.write_administration_audit(auth.uid(), CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
    'ORG_UNIT', v_id, NULL, v_id, 'SCOPED', CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,
    to_jsonb(v_new), nullif(btrim(coalesce(p_reason,'')),''));
  IF p_id IS NOT NULL AND v_old.parent_id IS DISTINCT FROM v_new.parent_id THEN
    PERFORM public.write_administration_audit(auth.uid(), 'HIERARCHY_CHANGE', 'ORG_UNIT_HIERARCHY', v_id,
      NULL, v_id, 'SCOPED', jsonb_build_object('parent_id', v_old.parent_id),
      jsonb_build_object('parent_id', v_new.parent_id), nullif(btrim(coalesce(p_reason,'')),''));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_org_unit(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.org_units%ROWTYPE; v_new public.org_units%ROWTYPE;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may archive offices' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.org_units WHERE id=p_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Office not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.org_units SET active=false, archived_at=now(), archived_by=auth.uid(), archive_reason=btrim(p_reason), updated_at=now() WHERE id=p_id;
  SELECT * INTO v_new FROM public.org_units WHERE id=p_id;
  PERFORM public.write_administration_audit(auth.uid(),'ARCHIVE','ORG_UNIT',p_id,NULL,p_id,'SCOPED',to_jsonb(v_old),to_jsonb(v_new),btrim(p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.save_station_admin(
  p_id uuid, p_code text, p_name text, p_location text, p_voltage_level_kv numeric,
  p_office_ids uuid[], p_primary_office_id uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid; v_old public.stations%ROWTYPE; v_new public.stations%ROWTYPE; v_office_id uuid;
  v_old_mappings jsonb;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may manage stations' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_code,''))='' OR btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION 'Station code and name are required' USING ERRCODE='22023'; END IF;
  IF coalesce(cardinality(p_office_ids),0)=0 THEN RAISE EXCEPTION 'At least one active office mapping is required' USING ERRCODE='22023'; END IF;
  IF cardinality(p_office_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_office_ids) item) THEN RAISE EXCEPTION 'Duplicate office mappings are not allowed' USING ERRCODE='22023'; END IF;
  IF p_primary_office_id IS NOT NULL AND NOT (p_primary_office_id = ANY(p_office_ids)) THEN RAISE EXCEPTION 'Primary office must be one of the selected offices' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_office_ids) item LEFT JOIN public.org_units ou ON ou.id=item WHERE ou.id IS NULL OR NOT ou.active) THEN RAISE EXCEPTION 'Archived or invalid offices cannot receive new mappings' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.stations WHERE id=p_id FOR UPDATE;
  IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Station not found' USING ERRCODE='P0002'; END IF;
  v_old_mappings := coalesce((SELECT jsonb_agg(to_jsonb(sou)) FROM public.station_org_units sou WHERE sou.station_id=p_id AND sou.active),'[]'::jsonb);
  IF p_id IS NULL THEN
    INSERT INTO public.stations(code,name,location,voltage_level_kv) VALUES (btrim(p_code),btrim(p_name),nullif(btrim(coalesce(p_location,'')),''),p_voltage_level_kv) RETURNING id INTO v_id;
  ELSE
    UPDATE public.stations SET code=btrim(p_code),name=btrim(p_name),location=nullif(btrim(coalesce(p_location,'')),''),voltage_level_kv=p_voltage_level_kv,updated_at=now() WHERE id=p_id RETURNING id INTO v_id;
  END IF;
  UPDATE public.station_org_units SET active=false,updated_at=now() WHERE station_id=v_id AND org_unit_id <> ALL(p_office_ids);
  FOREACH v_office_id IN ARRAY p_office_ids LOOP
    INSERT INTO public.station_org_units(station_id,org_unit_id,is_primary,active) VALUES(v_id,v_office_id,coalesce(p_primary_office_id,v_office_id)=v_office_id,true)
    ON CONFLICT(station_id,org_unit_id) DO UPDATE SET active=true,is_primary=EXCLUDED.is_primary,updated_at=now();
  END LOOP;
  SELECT * INTO v_new FROM public.stations WHERE id=v_id;
  PERFORM public.write_administration_audit(auth.uid(),CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'STATION',v_id,v_id,NULL,'SCOPED',CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(v_new),nullif(btrim(coalesce(p_reason,'')),''));
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,station_id,org_unit_id,visibility,before_data,after_data,old_values,new_values,reason)
  SELECT auth.uid(),'UPDATE_MAPPING','STATION_OFFICE_MAPPING',coalesce(n.id,(o.value->>'id')::uuid),v_id,i.org_unit_id,'SCOPED',o.value,to_jsonb(n),o.value,to_jsonb(n),nullif(btrim(coalesce(p_reason,'')), '')
  FROM (
    SELECT (value->>'org_unit_id')::uuid AS org_unit_id FROM jsonb_array_elements(v_old_mappings)
    UNION SELECT unnest(p_office_ids)
  ) i
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(v_old_mappings) value WHERE (value->>'org_unit_id')::uuid=i.org_unit_id LIMIT 1) o ON true
  LEFT JOIN public.station_org_units n ON n.station_id=v_id AND n.org_unit_id=i.org_unit_id
  WHERE o.value IS DISTINCT FROM to_jsonb(n);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_station_admin(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.stations%ROWTYPE; v_new public.stations%ROWTYPE;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may archive stations' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.stations WHERE id=p_id FOR UPDATE; IF v_old.id IS NULL THEN RAISE EXCEPTION 'Station not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.stations SET active=false,archived_at=now(),archived_by=auth.uid(),archive_reason=btrim(p_reason),updated_at=now() WHERE id=p_id;
  SELECT * INTO v_new FROM public.stations WHERE id=p_id;
  PERFORM public.write_administration_audit(auth.uid(),'ARCHIVE','STATION',p_id,p_id,NULL,'SCOPED',to_jsonb(v_old),to_jsonb(v_new),btrim(p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.save_feeder_admin(
  p_id uuid,p_code text,p_name text,p_station_id uuid,p_voltage_level_kv numeric,p_consumer_count integer,p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_old public.feeders%ROWTYPE; v_new public.feeders%ROWTYPE; v_role public.app_user_role;
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id=auth.uid() AND active;
  IF v_role NOT IN ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Insufficient privilege to manage feeders' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_my_manageable_feeder_station_ids() a WHERE a.station_id=p_station_id) THEN RAISE EXCEPTION 'You cannot manage feeders for this station' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_code,''))='' OR btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION 'Feeder code and name are required' USING ERRCODE='22023'; END IF;
  IF coalesce(p_consumer_count,0)<0 THEN RAISE EXCEPTION 'Consumer count cannot be negative' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.feeders WHERE id=p_id FOR UPDATE; IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Feeder not found' USING ERRCODE='P0002'; END IF;
  IF p_id IS NOT NULL AND v_old.station_id IS DISTINCT FROM p_station_id AND btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'A reason is required when changing a feeder station' USING ERRCODE='22023'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.feeders(code,name,station_id,voltage_level_kv,consumer_count) VALUES(btrim(p_code),btrim(p_name),p_station_id,p_voltage_level_kv,coalesce(p_consumer_count,0)) RETURNING id INTO v_id; ELSE UPDATE public.feeders SET code=btrim(p_code),name=btrim(p_name),station_id=p_station_id,voltage_level_kv=p_voltage_level_kv,consumer_count=coalesce(p_consumer_count,0),updated_at=now() WHERE id=p_id RETURNING id INTO v_id; END IF;
  SELECT * INTO v_new FROM public.feeders WHERE id=v_id;
  PERFORM public.write_administration_audit(auth.uid(),CASE WHEN p_id IS NULL THEN 'CREATE' WHEN v_old.station_id IS DISTINCT FROM p_station_id THEN 'MOVE_STATION' ELSE 'UPDATE' END,'FEEDER',v_id,v_new.station_id,NULL,'SCOPED',CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(v_new),nullif(btrim(coalesce(p_reason,'')),''));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_feeder_admin(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.feeders%ROWTYPE; v_new public.feeders%ROWTYPE;
BEGIN
  IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.feeders WHERE id=p_id FOR UPDATE;
  IF v_old.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.get_my_manageable_feeder_station_ids() a WHERE a.station_id=v_old.station_id) THEN RAISE EXCEPTION 'Feeder not found or outside your scope' USING ERRCODE='42501'; END IF;
  UPDATE public.feeders SET active=false,archived_at=now(),archived_by=auth.uid(),archive_reason=btrim(p_reason),updated_at=now() WHERE id=p_id;
  SELECT * INTO v_new FROM public.feeders WHERE id=p_id;
  PERFORM public.write_administration_audit(auth.uid(),'ARCHIVE','FEEDER',p_id,v_old.station_id,NULL,'SCOPED',to_jsonb(v_old),to_jsonb(v_new),btrim(p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_user_access(
  p_user_id uuid,p_full_name text,p_employee_code text,p_phone text,p_role public.app_user_role,p_active boolean,
  p_office_ids uuid[],p_station_ids uuid[],p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor public.app_user_role; target public.app_user_role; item uuid;
  v_old_user public.app_users%ROWTYPE; v_new_user public.app_users%ROWTYPE;
  v_old_offices jsonb; v_old_stations jsonb; v_visibility text;
BEGIN
  SELECT role INTO actor FROM public.app_users WHERE id=auth.uid() AND active;
  SELECT * INTO v_old_user FROM public.app_users WHERE id=p_user_id FOR UPDATE;
  target := v_old_user.role;
  IF actor NOT IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Only administrators may manage users' USING ERRCODE='42501'; END IF;
  IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'You cannot change your own access' USING ERRCODE='42501'; END IF;
  IF actor='ADMIN'::public.app_user_role AND (target='SUPER_ADMIN'::public.app_user_role OR p_role='SUPER_ADMIN'::public.app_user_role) THEN RAISE EXCEPTION 'Administrators cannot modify Super Admin access' USING ERRCODE='42501'; END IF;
  IF target='SUPER_ADMIN'::public.app_user_role AND NOT p_active AND (SELECT count(*) FROM public.app_users WHERE role='SUPER_ADMIN' AND active)<=1 THEN RAISE EXCEPTION 'The last active Super Admin cannot be deactivated' USING ERRCODE='22023'; END IF;
  v_old_offices := coalesce((SELECT jsonb_agg(to_jsonb(uou)) FROM public.user_org_units uou WHERE uou.user_id=p_user_id AND uou.active),'[]'::jsonb);
  v_old_stations := coalesce((SELECT jsonb_agg(to_jsonb(us)) FROM public.user_stations us WHERE us.user_id=p_user_id AND us.active),'[]'::jsonb);
  UPDATE public.app_users SET full_name=btrim(p_full_name),employee_code=nullif(btrim(coalesce(p_employee_code,'')),''),phone=nullif(btrim(coalesce(p_phone,'')),''),role=p_role,active=p_active,updated_at=now() WHERE id=p_user_id;
  UPDATE public.user_org_units SET active=false,updated_at=now() WHERE user_id=p_user_id AND org_unit_id <> ALL(coalesce(p_office_ids,'{}'::uuid[]));
  FOREACH item IN ARRAY coalesce(p_office_ids,'{}'::uuid[]) LOOP INSERT INTO public.user_org_units(user_id,org_unit_id,active) VALUES(p_user_id,item,true) ON CONFLICT(user_id,org_unit_id) DO UPDATE SET active=true,updated_at=now(); END LOOP;
  UPDATE public.user_stations SET active=false,updated_at=now() WHERE user_id=p_user_id AND station_id <> ALL(coalesce(p_station_ids,'{}'::uuid[]));
  FOREACH item IN ARRAY coalesce(p_station_ids,'{}'::uuid[]) LOOP INSERT INTO public.user_stations(user_id,station_id,active) VALUES(p_user_id,item,true) ON CONFLICT(user_id,station_id) DO UPDATE SET active=true,updated_at=now(); END LOOP;
  SELECT * INTO v_new_user FROM public.app_users WHERE id=p_user_id;
  v_visibility := CASE WHEN target='SUPER_ADMIN'::public.app_user_role OR p_role='SUPER_ADMIN'::public.app_user_role THEN 'SUPER_ADMIN_ONLY' ELSE 'ADMIN_GLOBAL' END;
  PERFORM public.write_administration_audit(auth.uid(),CASE WHEN v_old_user.role IS DISTINCT FROM v_new_user.role THEN 'ROLE_CHANGE' WHEN v_old_user.active IS DISTINCT FROM v_new_user.active THEN 'STATUS_CHANGE' ELSE 'UPDATE_ACCESS' END,'APP_USER',p_user_id,NULL,NULL,v_visibility,to_jsonb(v_old_user),to_jsonb(v_new_user),nullif(btrim(coalesce(p_reason,'')),''));
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,org_unit_id,visibility,before_data,after_data,old_values,new_values,reason)
  SELECT auth.uid(),'UPDATE_ASSIGNMENT','USER_OFFICE_ASSIGNMENT',coalesce(n.id,(o.value->>'id')::uuid),i.org_unit_id,'SCOPED',o.value,to_jsonb(n),o.value,to_jsonb(n),nullif(btrim(coalesce(p_reason,'')), '')
  FROM (SELECT (value->>'org_unit_id')::uuid AS org_unit_id FROM jsonb_array_elements(v_old_offices) UNION SELECT unnest(coalesce(p_office_ids,'{}'::uuid[]))) i
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(v_old_offices) value WHERE (value->>'org_unit_id')::uuid=i.org_unit_id LIMIT 1) o ON true
  LEFT JOIN public.user_org_units n ON n.user_id=p_user_id AND n.org_unit_id=i.org_unit_id
  WHERE o.value IS DISTINCT FROM to_jsonb(n);
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,station_id,visibility,before_data,after_data,old_values,new_values,reason)
  SELECT auth.uid(),'UPDATE_ASSIGNMENT','USER_STATION_ASSIGNMENT',coalesce(n.id,(o.value->>'id')::uuid),i.station_id,'SCOPED',o.value,to_jsonb(n),o.value,to_jsonb(n),nullif(btrim(coalesce(p_reason,'')), '')
  FROM (SELECT (value->>'station_id')::uuid AS station_id FROM jsonb_array_elements(v_old_stations) UNION SELECT unnest(coalesce(p_station_ids,'{}'::uuid[]))) i
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(v_old_stations) value WHERE (value->>'station_id')::uuid=i.station_id LIMIT 1) o ON true
  LEFT JOIN public.user_stations n ON n.user_id=p_user_id AND n.station_id=i.station_id
  WHERE o.value IS DISTINCT FROM to_jsonb(n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_org_unit(uuid,text,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_org_unit(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_station_admin(uuid,text,text,text,numeric,uuid[],uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_station_admin(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_feeder_admin(uuid,text,text,uuid,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_feeder_admin(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_user_access(uuid,text,text,text,public.app_user_role,boolean,uuid[],uuid[],text) TO authenticated;
