begin;
-- Dedicated scope for NEW operational features only. Global access stays unchanged.
-- get_my_accessible_org_unit_ids() already expands active assigned units to
-- their active descendants, so station resolution must not repeat traversal.

CREATE OR REPLACE FUNCTION public.get_my_operational_station_ids()
RETURNS TABLE(station_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_user_role;
BEGIN
  SELECT au.role
  INTO v_role
  FROM public.app_users au
  WHERE au.id = auth.uid()
    AND au.active = true;

  IF v_role IS NULL THEN
    RETURN;
  END IF;

  IF v_role IN (
    'ADMIN'::public.app_user_role,
    'SUPER_ADMIN'::public.app_user_role
  ) THEN
    RETURN QUERY
      SELECT s.id
      FROM public.stations s
      WHERE s.active = true
      ORDER BY s.name;
    RETURN;
  END IF;

  IF v_role = 'FIELD_OFFICER'::public.app_user_role THEN
    RETURN QUERY
      SELECT scoped.station_id
      FROM (
        SELECT DISTINCT s.id AS station_id, s.name AS station_name
        FROM public.get_my_accessible_org_unit_ids() accessible
        JOIN public.station_org_units sou
          ON sou.org_unit_id = accessible.org_unit_id
         AND sou.active = true
        JOIN public.stations s
          ON s.id = sou.station_id
         AND s.active = true
      ) scoped
      ORDER BY scoped.station_name;
    RETURN;
  END IF;

  IF v_role = 'OPERATOR'::public.app_user_role THEN
    RETURN QUERY
      SELECT scoped.station_id
      FROM (
        SELECT DISTINCT s.id AS station_id, s.name AS station_name
        FROM public.user_stations us
        JOIN public.stations s
          ON s.id = us.station_id
         AND s.active = true
        WHERE us.user_id = auth.uid()
          AND us.active = true
      ) scoped
      ORDER BY scoped.station_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_operational_station_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_operational_station_ids()
  TO authenticated;

create or replace function public.resolve_operational_station_scope(p_station_id uuid default null, p_office_id uuid default null)
returns table(station_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_station_id is not null and p_office_id is not null then
    raise exception 'Select either station or office' using errcode = '22023';
  end if;
  if p_station_id is not null then
    if not exists(select 1 from public.get_my_operational_station_ids() a where a.station_id = p_station_id) then
      raise exception 'Station access is not authorized' using errcode = '42501';
    end if;
    return query select p_station_id;
  elsif p_office_id is not null then
    if not exists(select 1 from public.org_units o where o.id = p_office_id and o.active)
      or not (public.get_my_role() in ('ADMIN','SUPER_ADMIN') or
        (public.get_my_role() = 'FIELD_OFFICER' and exists(select 1 from public.get_my_accessible_org_unit_ids() a where a.org_unit_id = p_office_id))) then
      raise exception 'Office access is not authorized' using errcode = '42501';
    end if;
    return query with recursive offices as (
      select o.id,array[o.id] as path from public.org_units o where o.id = p_office_id and o.active
      union all select o.id,t.path || o.id from public.org_units o join offices t on o.parent_id=t.id
      where o.active and not o.id=any(t.path)
    ) select distinct a.station_id from public.get_my_operational_station_ids() a
      join public.station_org_units m on m.station_id=a.station_id and m.active
      join offices o on o.id=m.org_unit_id;
  else
    return query select a.station_id from public.get_my_operational_station_ids() a;
  end if;
end;
$$;

create or replace function public.get_operational_scope_options()
returns table(scope_kind text,scope_id uuid,label text,office_type text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
    select 'ALL'::text,null::uuid,case when public.get_my_role() in ('ADMIN','SUPER_ADMIN') then 'Entire Utility' else 'All authorized stations' end,null::text
      where public.get_my_role() in ('FIELD_OFFICER','ADMIN','SUPER_ADMIN')
    union all select 'STATION',s.id,s.name,null::text from public.stations s
      join public.get_my_operational_station_ids() a on a.station_id=s.id
    union all select 'OFFICE',o.id,o.name,o.unit_type from public.org_units o where o.active and
      (public.get_my_role() in ('ADMIN','SUPER_ADMIN') or (public.get_my_role()='FIELD_OFFICER' and
        o.id in (select a.org_unit_id from public.get_my_accessible_org_unit_ids() a)))
    order by 1,3,2;
end;
$$;


-- Timeline and summary already resolve every station through this resolver,
-- including the internal event projection and current-open-condition count.
-- Keep the invoker wrappers and their existing source-table RLS unchanged.
alter policy station_conditions_read on public.station_conditions
using (station_id in (select a.station_id from public.get_my_operational_station_ids() a));
commit;
