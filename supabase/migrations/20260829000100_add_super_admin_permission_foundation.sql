-- GridVision Administration Stage 1: privileged-role-management foundation.
-- No account is promoted by this migration.

CREATE OR REPLACE FUNCTION public.get_my_accessible_station_ids()
RETURNS TABLE(station_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_user_role;
BEGIN
  SELECT au.role INTO v_role FROM public.app_users au WHERE au.id = auth.uid() AND au.active = true;
  IF v_role IS NULL THEN RETURN; END IF;

  IF v_role IN ('ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role, 'FIELD_OFFICER'::public.app_user_role) THEN
    RETURN QUERY SELECT s.id FROM public.stations s WHERE s.active = true ORDER BY s.name;
    RETURN;
  END IF;

  IF v_role = 'OPERATOR'::public.app_user_role THEN
    RETURN QUERY SELECT DISTINCT us.station_id FROM public.user_stations us JOIN public.stations s ON s.id = us.station_id WHERE us.user_id = auth.uid() AND us.active = true AND s.active = true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_app_user_role(p_user_id uuid, p_role public.app_user_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role public.app_user_role;
  v_target_role public.app_user_role;
BEGIN
  SELECT role INTO v_actor_role FROM public.app_users WHERE id = auth.uid() AND active = true;
  SELECT role INTO v_target_role FROM public.app_users WHERE id = p_user_id FOR UPDATE;

  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target user does not exist' USING ERRCODE = 'P0002'; END IF;

  IF v_actor_role = 'SUPER_ADMIN'::public.app_user_role THEN
    UPDATE public.app_users SET role = p_role, updated_at = now() WHERE id = p_user_id;
    RETURN;
  END IF;

  IF v_actor_role = 'ADMIN'::public.app_user_role AND p_role <> 'SUPER_ADMIN'::public.app_user_role AND v_target_role <> 'SUPER_ADMIN'::public.app_user_role THEN
    UPDATE public.app_users SET role = p_role, updated_at = now() WHERE id = p_user_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Insufficient privilege to change this role' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.set_app_user_role(uuid, public.app_user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_app_user_role(uuid, public.app_user_role) TO authenticated;

-- Existing administrative report RPCs are database-enforced. SUPER_ADMIN inherits
-- the same audit-report access as ADMIN without weakening the underlying checks.
CREATE OR REPLACE FUNCTION public.get_operator_activity_report_summary(p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL)
RETURNS TABLE (entries_created bigint,rows_subsequently_updated bigint,missing_expected_entries bigint,operators_active bigint,stations_active bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH admin AS (SELECT public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed), accessible AS (SELECT a.station_id FROM public.get_my_accessible_station_ids() a CROSS JOIN admin WHERE admin.allowed),
scope_feeders AS (SELECT f.id AS feeder_id,f.station_id FROM public.feeders f JOIN accessible a ON a.station_id=f.station_id WHERE coalesce(f.active,true) AND (p_station_id IS NULL OR f.station_id=p_station_id)),
activity AS (SELECT l.* FROM public.log_book_entries l JOIN accessible a ON a.station_id=l.station_id WHERE ((l.created_at>=p_start AND l.created_at<p_end) OR (l.updated_at>=p_start AND l.updated_at<p_end)) AND (p_station_id IS NULL OR l.station_id=p_station_id)),
expected_hours AS (SELECT count(*)::bigint AS count FROM generate_series((p_start AT TIME ZONE 'Asia/Kolkata')::date,((p_end AT TIME ZONE 'Asia/Kolkata')::date-1),interval '1 day') d(day) CROSS JOIN generate_series(0,23) h(hour_no) WHERE d.day::date<(now() AT TIME ZONE 'Asia/Kolkata')::date OR (d.day::date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND h.hour_no<=extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::integer)),
entered AS (SELECT DISTINCT ON(l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata')) l.feeder_id FROM public.log_book_entries l JOIN scope_feeders f ON f.feeder_id=l.feeder_id WHERE l.actual_event_time>=p_start AND l.actual_event_time<p_end ORDER BY l.feeder_id,date_trunc('hour',l.actual_event_time AT TIME ZONE 'Asia/Kolkata'),l.updated_at DESC,l.id DESC)
SELECT count(*) FILTER(WHERE created_at>=p_start AND created_at<p_end)::bigint,count(*) FILTER(WHERE updated_at>created_at AND updated_at>=p_start AND updated_at<p_end)::bigint,greatest((SELECT count(*) FROM scope_feeders)*(SELECT count FROM expected_hours)-(SELECT count(*) FROM entered),0)::bigint,count(DISTINCT operator_id) FILTER(WHERE operator_id IS NOT NULL)::bigint,count(DISTINCT station_id)::bigint FROM activity;
$$;

CREATE OR REPLACE FUNCTION public.get_operator_activity_report_page(p_start timestamptz,p_end timestamptz,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50,p_station_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid,operator_id uuid,station_name text,feeder_name text,actual_event_time timestamptz,created_at timestamptz,updated_at timestamptz,activity_state text,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH admin AS (SELECT public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed), accessible AS (SELECT a.station_id FROM public.get_my_accessible_station_ids() a CROSS JOIN admin WHERE admin.allowed), rows AS (SELECT l.id,l.operator_id,s.name AS station_name,f.name AS feeder_name,l.actual_event_time,l.created_at,l.updated_at,CASE WHEN l.updated_at>l.created_at THEN 'UPDATED' ELSE 'CREATED' END AS activity_state,count(*) OVER()::bigint AS total_count FROM public.log_book_entries l JOIN accessible a ON a.station_id=l.station_id JOIN public.stations s ON s.id=l.station_id LEFT JOIN public.feeders f ON f.id=l.feeder_id WHERE ((l.created_at>=p_start AND l.created_at<p_end) OR (l.updated_at>=p_start AND l.updated_at<p_end)) AND (p_station_id IS NULL OR l.station_id=p_station_id)) SELECT * FROM rows ORDER BY greatest(created_at,updated_at) DESC OFFSET greatest(0,p_page)*greatest(1,least(200,p_page_size)) LIMIT greatest(1,least(200,p_page_size));
$$;

CREATE OR REPLACE FUNCTION public.get_notification_delivery_report_summary(p_start timestamptz,p_end timestamptz,p_station_id uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS TABLE (events bigint,intended_recipients bigint,sent bigint,failed bigint,pending bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH admin AS (SELECT public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed), accessible AS (SELECT a.station_id FROM public.get_my_accessible_station_ids() a CROSS JOIN admin WHERE admin.allowed), events_scope AS (SELECT e.id FROM public.notification_events e JOIN accessible a ON a.station_id=e.station_id WHERE e.event_time>=p_start AND e.event_time<p_end AND (p_station_id IS NULL OR e.station_id=p_station_id) AND (p_status IS NULL OR EXISTS(SELECT 1 FROM public.notification_recipients r WHERE r.notification_event_id=e.id AND r.status=p_status))), recipients AS (SELECT r.* FROM public.notification_recipients r JOIN events_scope e ON e.id=r.notification_event_id WHERE p_status IS NULL OR r.status=p_status) SELECT (SELECT count(*) FROM events_scope)::bigint,count(*)::bigint,count(*) FILTER(WHERE status='SENT')::bigint,count(*) FILTER(WHERE status='FAILED')::bigint,count(*) FILTER(WHERE status='PENDING')::bigint FROM recipients;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_delivery_report_page(p_start timestamptz,p_end timestamptz,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50,p_station_id uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS TABLE (id uuid,event_time timestamptz,source text,station_name text,intended_recipients bigint,sent bigint,failed bigint,pending bigint,delivery_message text,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH admin AS (SELECT public.get_my_role() IN ('ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role) AS allowed), accessible AS (SELECT a.station_id FROM public.get_my_accessible_station_ids() a CROSS JOIN admin WHERE admin.allowed), events_scope AS (SELECT e.id,e.event_time,e.max_unit_type,s.name AS station_name FROM public.notification_events e JOIN accessible a ON a.station_id=e.station_id JOIN public.stations s ON s.id=e.station_id WHERE e.event_time>=p_start AND e.event_time<p_end AND (p_station_id IS NULL OR e.station_id=p_station_id) AND (p_status IS NULL OR EXISTS(SELECT 1 FROM public.notification_recipients r WHERE r.notification_event_id=e.id AND r.status=p_status))), rows AS (SELECT e.id,e.event_time,e.max_unit_type AS source,e.station_name,count(r.id)::bigint AS intended_recipients,count(r.id) FILTER(WHERE r.status='SENT')::bigint AS sent,count(r.id) FILTER(WHERE r.status='FAILED')::bigint AS failed,count(r.id) FILTER(WHERE r.status='PENDING')::bigint AS pending,left(string_agg(DISTINCT r.delivery_message,' | ') FILTER(WHERE r.delivery_message IS NOT NULL),300) AS delivery_message,count(*) OVER()::bigint AS total_count FROM events_scope e LEFT JOIN public.notification_recipients r ON r.notification_event_id=e.id AND (p_status IS NULL OR r.status=p_status) GROUP BY e.id,e.event_time,e.max_unit_type,e.station_name) SELECT * FROM rows ORDER BY event_time DESC OFFSET greatest(0,p_page)*greatest(1,least(200,p_page_size)) LIMIT greatest(1,least(200,p_page_size));
$$;
