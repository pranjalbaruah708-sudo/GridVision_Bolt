-- Stage 14: read-only, role-scoped audit viewer. Visibility is evaluated by the
-- same audit_scope_allowed() helper used by the ledger RLS policy.
CREATE INDEX IF NOT EXISTS idx_administration_audit_log_created_id ON public.administration_audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_administration_audit_log_station_created ON public.administration_audit_log (station_id, created_at DESC) WHERE station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_administration_audit_log_org_unit_created ON public.administration_audit_log (org_unit_id, created_at DESC) WHERE org_unit_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_administration_audit_page(
  p_from timestamptz, p_to timestamptz, p_action text DEFAULT NULL, p_entity_type text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL, p_station_id uuid DEFAULT NULL, p_org_unit_id uuid DEFAULT NULL,
  p_visibility text DEFAULT NULL, p_search text DEFAULT NULL, p_page integer DEFAULT 0, p_page_size integer DEFAULT 25
) RETURNS TABLE(
  id uuid, created_at timestamptz, action text, entity_type text, entity_id uuid, record_label text,
  actor_id uuid, actor_name text, actor_employee_code text, station_id uuid, station_name text,
  org_unit_id uuid, org_unit_name text, visibility text, reason text, old_values jsonb, new_values jsonb, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH rows AS (
    SELECT al.id,al.created_at,al.action,al.entity_type,al.entity_id,
      coalesce(al.new_values->>'name',al.new_values->>'full_name',al.old_values->>'name',al.old_values->>'full_name',f.name,s.name,ou.name,replace(lower(al.entity_type),'_',' ')) AS record_label,
      al.actor_id,au.full_name,au.employee_code,al.station_id,s.name,al.org_unit_id,ou.name,al.visibility,al.reason,al.old_values,al.new_values,
      count(*) OVER()::bigint
    FROM public.administration_audit_log al
    LEFT JOIN public.app_users au ON au.id=al.actor_id
    LEFT JOIN public.stations s ON s.id=al.station_id
    LEFT JOIN public.org_units ou ON ou.id=al.org_unit_id
    LEFT JOIN public.feeders f ON f.id=al.entity_id AND al.entity_type='FEEDER'
    WHERE public.audit_scope_allowed(al.station_id,al.org_unit_id,al.visibility)
      AND al.created_at >= p_from AND al.created_at < p_to
      AND (p_action IS NULL OR p_action='' OR al.action=p_action)
      AND (p_entity_type IS NULL OR p_entity_type='' OR al.entity_type=p_entity_type)
      AND (p_actor_id IS NULL OR al.actor_id=p_actor_id)
      AND (p_station_id IS NULL OR al.station_id=p_station_id)
      AND (p_org_unit_id IS NULL OR al.org_unit_id=p_org_unit_id)
      AND (p_visibility IS NULL OR p_visibility='' OR al.visibility=p_visibility)
      AND (p_search IS NULL OR p_search='' OR al.action ILIKE '%'||p_search||'%' OR al.entity_type ILIKE '%'||p_search||'%' OR coalesce(al.reason,'') ILIKE '%'||p_search||'%')
  ) SELECT * FROM rows ORDER BY created_at DESC,id DESC OFFSET greatest(0,p_page)*greatest(1,least(100,p_page_size)) LIMIT greatest(1,least(100,p_page_size));
$$;
CREATE OR REPLACE FUNCTION public.get_administration_audit_filter_options()
RETURNS TABLE(kind text,id uuid,label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH allowed AS (SELECT * FROM public.administration_audit_log al WHERE public.audit_scope_allowed(al.station_id,al.org_unit_id,al.visibility))
  SELECT 'ACTOR'::text,al.actor_id,coalesce(au.full_name,'Unknown actor') FROM allowed al LEFT JOIN public.app_users au ON au.id=al.actor_id WHERE al.actor_id IS NOT NULL GROUP BY al.actor_id,au.full_name
  UNION ALL SELECT 'STATION',al.station_id,coalesce(s.name,'Archived station') FROM allowed al LEFT JOIN public.stations s ON s.id=al.station_id WHERE al.station_id IS NOT NULL GROUP BY al.station_id,s.name
  UNION ALL SELECT 'OFFICE',al.org_unit_id,coalesce(ou.name,'Archived office') FROM allowed al LEFT JOIN public.org_units ou ON ou.id=al.org_unit_id WHERE al.org_unit_id IS NOT NULL GROUP BY al.org_unit_id,ou.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_administration_audit_page(timestamptz,timestamptz,text,text,uuid,uuid,uuid,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_administration_audit_filter_options() TO authenticated;
