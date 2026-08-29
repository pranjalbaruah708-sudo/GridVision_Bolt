-- GridVision Administration Stage 3: safe self-service profile fields.
-- Auth email/password remain managed exclusively by Supabase Auth.

CREATE POLICY "Users can update approved self profile fields"
ON public.app_users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_app_user_self_service_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Privileged maintenance functions must explicitly opt in before changing
  -- protected access-management columns.
  IF current_setting('app.allow_privileged_app_user_update', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.employee_code IS DISTINCT FROM OLD.employee_code
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.department IS DISTINCT FROM OLD.department
    OR NEW.designation IS DISTINCT FROM OLD.designation
    OR NEW.active IS DISTINCT FROM OLD.active
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only full name and phone can be changed from My Profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_app_user_self_service_update ON public.app_users;
CREATE TRIGGER trg_guard_app_user_self_service_update
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.guard_app_user_self_service_update();

-- Stage 1 role administration remains privileged after the field guard above.
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

  IF v_actor_role = 'SUPER_ADMIN'::public.app_user_role
    OR (v_actor_role = 'ADMIN'::public.app_user_role AND p_role <> 'SUPER_ADMIN'::public.app_user_role AND v_target_role <> 'SUPER_ADMIN'::public.app_user_role) THEN
    PERFORM set_config('app.allow_privileged_app_user_update', 'true', true);
    UPDATE public.app_users SET role = p_role, updated_at = now() WHERE id = p_user_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Insufficient privilege to change this role' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  full_name text,
  employee_code text,
  phone text,
  account_role text,
  account_active boolean,
  assigned_offices text[],
  accessible_stations text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    au.full_name,
    au.employee_code,
    au.phone,
    au.role::text,
    au.active,
    ARRAY(
      SELECT ou.name
      FROM public.user_org_units uou
      JOIN public.org_units ou ON ou.id = uou.org_unit_id
      WHERE uou.user_id = auth.uid() AND uou.active = true AND ou.active = true
      ORDER BY uou.is_primary DESC, ou.name
    ),
    ARRAY(
      SELECT s.name
      FROM public.get_my_accessible_station_ids() accessible
      JOIN public.stations s ON s.id = accessible.station_id
      ORDER BY s.name
    )
  FROM public.app_users au
  WHERE au.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
