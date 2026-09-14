begin;

-- Restore the global FIELD_OFFICER rule narrowed by 20260909000200.
-- Dedicated operational scope and all other functions/policies are untouched.
create or replace function public.get_my_accessible_station_ids()
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_role public.app_user_role;
begin
  select au.role into v_role from public.app_users au
  where au.id = auth.uid() and au.active = true;
  if v_role is null then return; end if;

  if v_role in ('FIELD_OFFICER','ADMIN','SUPER_ADMIN') then
    return query select s.id from public.stations s where s.active = true order by s.name;
    return;
  end if;

  if v_role = 'OPERATOR' then
    return query
      select scoped.station_id from (
        select distinct s.id as station_id, s.name as station_name
        from public.user_stations us join public.stations s on s.id = us.station_id
        where us.user_id = auth.uid() and us.active = true and s.active = true
      ) scoped order by scoped.station_name;
  end if;
end;
$$;

commit;
