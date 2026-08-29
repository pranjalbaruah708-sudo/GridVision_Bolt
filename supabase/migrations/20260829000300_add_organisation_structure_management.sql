-- GridVision Administration Stage 5: organisation units are the established
-- generic office model. Office types remain the existing configured enum-like
-- CHECK values; no competing office-type table is introduced.

ALTER TABLE public.org_units
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE TABLE IF NOT EXISTS public.administration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administration_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Administration can view organisation units" ON public.org_units;
CREATE POLICY "Administration can view organisation units" ON public.org_units FOR SELECT TO authenticated
USING (public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role));
DROP POLICY IF EXISTS "Super admins manage organisation units" ON public.org_units;
CREATE POLICY "Super admins manage organisation units" ON public.org_units FOR ALL TO authenticated
USING (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role)
WITH CHECK (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role);

DROP POLICY IF EXISTS "Administration can view station organisation mappings" ON public.station_org_units;
CREATE POLICY "Administration can view station organisation mappings" ON public.station_org_units FOR SELECT TO authenticated
USING (public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role));
DROP POLICY IF EXISTS "Super admins manage station organisation mappings" ON public.station_org_units;
CREATE POLICY "Super admins manage station organisation mappings" ON public.station_org_units FOR ALL TO authenticated
USING (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role)
WITH CHECK (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role);

DROP POLICY IF EXISTS "Administration can view user organisation mappings" ON public.user_org_units;
CREATE POLICY "Administration can view user organisation mappings" ON public.user_org_units FOR SELECT TO authenticated
USING (public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role));
DROP POLICY IF EXISTS "Super admins manage user organisation mappings" ON public.user_org_units;
CREATE POLICY "Super admins manage user organisation mappings" ON public.user_org_units FOR ALL TO authenticated
USING (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role)
WITH CHECK (public.get_my_role() = 'SUPER_ADMIN'::public.app_user_role);

DROP POLICY IF EXISTS "Administrators can view administration audit" ON public.administration_audit_log;
CREATE POLICY "Administrators can view administration audit" ON public.administration_audit_log FOR SELECT TO authenticated
USING (public.get_my_role() IN ('ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role));

CREATE OR REPLACE FUNCTION public.get_org_unit_types()
RETURNS TABLE(unit_type text, hierarchy_rank integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM (VALUES ('HQ', 1), ('REGION', 2), ('ZONE', 3), ('CIRCLE', 4), ('DIVISION', 5), ('SUB_DIVISION', 6)) AS configured(unit_type, hierarchy_rank)
  WHERE public.get_my_role() IN ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role)
  ORDER BY hierarchy_rank;
$$;

CREATE OR REPLACE FUNCTION public.get_org_units_page(p_search text DEFAULT NULL, p_active boolean DEFAULT NULL, p_page integer DEFAULT 0, p_page_size integer DEFAULT 25)
RETURNS TABLE(id uuid, code text, name text, unit_type text, parent_id uuid, parent_name text, active boolean, archived_at timestamptz, child_count bigint, station_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH rows AS (
    SELECT ou.id, ou.code, ou.name, ou.unit_type, ou.parent_id, parent.name AS parent_name, ou.active, ou.archived_at,
      (SELECT count(*) FROM public.org_units child WHERE child.parent_id = ou.id)::bigint AS child_count,
      (SELECT count(*) FROM public.station_org_units sou WHERE sou.org_unit_id = ou.id AND sou.active)::bigint AS station_count,
      count(*) OVER()::bigint AS total_count
    FROM public.org_units ou
    LEFT JOIN public.org_units parent ON parent.id = ou.parent_id
    WHERE (p_search IS NULL OR p_search = '' OR ou.name ILIKE '%' || p_search || '%' OR ou.code ILIKE '%' || p_search || '%')
      AND (p_active IS NULL OR ou.active = p_active)
  )
  SELECT * FROM rows ORDER BY active DESC, name ASC OFFSET greatest(0, p_page) * greatest(1, least(100, p_page_size)) LIMIT greatest(1, least(100, p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_org_unit_detail(p_id uuid)
RETURNS TABLE(id uuid, code text, name text, unit_type text, parent_id uuid, parent_name text, active boolean, archived_at timestamptz, archive_reason text, child_names text[], station_names text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT ou.id, ou.code, ou.name, ou.unit_type, ou.parent_id, parent.name, ou.active, ou.archived_at, ou.archive_reason,
    ARRAY(SELECT child.name FROM public.org_units child WHERE child.parent_id = ou.id ORDER BY child.name),
    ARRAY(SELECT s.name FROM public.station_org_units sou JOIN public.stations s ON s.id = sou.station_id WHERE sou.org_unit_id = ou.id AND sou.active ORDER BY s.name)
  FROM public.org_units ou LEFT JOIN public.org_units parent ON parent.id = ou.parent_id
  WHERE ou.id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.get_org_unit_parent_options(p_unit_type text, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, unit_type text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH target AS (SELECT hierarchy_rank FROM public.get_org_unit_types() WHERE unit_type = p_unit_type),
  descendants AS (
    WITH RECURSIVE tree AS (
      SELECT id FROM public.org_units WHERE parent_id = p_exclude_id
      UNION ALL SELECT child.id FROM public.org_units child JOIN tree ON child.parent_id = tree.id
    ) SELECT id FROM tree
  )
  SELECT ou.id, ou.name, ou.unit_type FROM public.org_units ou
  JOIN public.get_org_unit_types() type_rank ON type_rank.unit_type = ou.unit_type
  CROSS JOIN target
  WHERE ou.active AND type_rank.hierarchy_rank < target.hierarchy_rank
    AND ou.id IS DISTINCT FROM p_exclude_id AND NOT EXISTS (SELECT 1 FROM descendants WHERE descendants.id = ou.id)
  ORDER BY ou.name;
$$;

CREATE OR REPLACE FUNCTION public.save_org_unit(p_id uuid, p_code text, p_name text, p_unit_type text, p_parent_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_old public.org_units%ROWTYPE; v_parent_type text; v_parent_rank integer; v_type_rank integer;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may manage offices' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Office code and name are required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.org_units WHERE id = p_id FOR UPDATE;
  IF p_id IS NOT NULL AND v_old.id IS NULL THEN RAISE EXCEPTION 'Office not found' USING ERRCODE='P0002'; END IF;
  IF p_id IS NOT NULL AND p_parent_id = p_id THEN RAISE EXCEPTION 'An office cannot parent itself' USING ERRCODE='22023'; END IF;
  IF p_parent_id IS NOT NULL THEN
    SELECT unit_type INTO v_parent_type FROM public.org_units WHERE id = p_parent_id;
    IF v_parent_type IS NULL THEN RAISE EXCEPTION 'Parent office not found' USING ERRCODE='23503'; END IF;
    SELECT hierarchy_rank INTO v_parent_rank FROM public.get_org_unit_types() WHERE unit_type = v_parent_type;
    SELECT hierarchy_rank INTO v_type_rank FROM public.get_org_unit_types() WHERE unit_type = p_unit_type;
    IF v_parent_rank IS NULL OR v_type_rank IS NULL OR v_parent_rank >= v_type_rank THEN RAISE EXCEPTION 'Parent office type must be higher in the configured hierarchy' USING ERRCODE='22023'; END IF;
    IF p_id IS NOT NULL AND EXISTS (WITH RECURSIVE descendants AS (SELECT id FROM public.org_units WHERE parent_id = p_id UNION ALL SELECT child.id FROM public.org_units child JOIN descendants d ON child.parent_id = d.id) SELECT 1 FROM descendants WHERE id = p_parent_id) THEN RAISE EXCEPTION 'This change would create a circular hierarchy' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.org_units(code, name, unit_type, parent_id) VALUES (btrim(p_code), btrim(p_name), p_unit_type, p_parent_id) RETURNING id INTO v_id;
    INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,after_data,reason) SELECT auth.uid(),'CREATE','ORG_UNIT',v_id,to_jsonb(ou),nullif(btrim(coalesce(p_reason,'')), '') FROM public.org_units ou WHERE ou.id=v_id;
  ELSE
    UPDATE public.org_units SET code=btrim(p_code), name=btrim(p_name), unit_type=p_unit_type, parent_id=p_parent_id, updated_at=now() WHERE id=p_id RETURNING id INTO v_id;
    INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),'UPDATE','ORG_UNIT',v_id,to_jsonb(v_old),to_jsonb(ou),nullif(btrim(coalesce(p_reason,'')), '') FROM public.org_units ou WHERE ou.id=v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_org_unit(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old public.org_units%ROWTYPE;
BEGIN
  IF public.get_my_role() <> 'SUPER_ADMIN'::public.app_user_role THEN RAISE EXCEPTION 'Only Super Admin may archive offices' USING ERRCODE='42501'; END IF;
  IF btrim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION 'An archive reason is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_old FROM public.org_units WHERE id=p_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Office not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.org_units SET active=false, archived_at=now(), archived_by=auth.uid(), archive_reason=btrim(p_reason), updated_at=now() WHERE id=p_id;
  INSERT INTO public.administration_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason) SELECT auth.uid(),'ARCHIVE','ORG_UNIT',p_id,to_jsonb(v_old),to_jsonb(ou),btrim(p_reason) FROM public.org_units ou WHERE ou.id=p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_org_unit(uuid,text,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_org_unit(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_unit_types() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_units_page(text,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_unit_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_unit_parent_options(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_org_unit(uuid,text,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_org_unit(uuid,text) TO authenticated;
