-- Shift rosters represent planned operator duty. Keep officers and other
-- staff roles out of rosters even if they have access to the station.
create or replace function public.save_station_shift_roster(p_shift_id uuid, p_assignments jsonb)
returns setof public.station_shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.station_shifts%rowtype;
  v_item jsonb;
  v_user_id uuid;
  v_role text;
  v_in_charge integer := 0;
begin
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Roster must be an array' using errcode = '22023';
  end if;

  select * into v_shift
  from public.station_shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;

  perform public.assert_shift_planner_access(v_shift.station_id);

  if v_shift.status <> 'SCHEDULED' or v_shift.scheduled_start <= now() then
    raise exception 'Only future scheduled shift rosters can be edited' using errcode = '55000';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid roster user' using errcode = '22023';
    end if;

    v_user_id := (v_item->>'user_id')::uuid;
    v_role := upper(coalesce(nullif(btrim(v_item->>'duty_role'), ''), 'MEMBER'));

    if v_role not in ('MEMBER', 'IN_CHARGE') then
      raise exception 'Invalid roster duty role' using errcode = '22023';
    end if;

    v_in_charge := v_in_charge + case when v_role = 'IN_CHARGE' then 1 else 0 end;

    if not exists (
      select 1
      from public.app_users u
      join public.user_stations us
        on us.user_id = u.id
       and us.station_id = v_shift.station_id
       and us.active = true
      where u.id = v_user_id
        and u.active = true
        and u.role = 'OPERATOR'::public.app_user_role
    ) then
      raise exception 'Roster user must be an active Operator assigned to this station' using errcode = '42501';
    end if;
  end loop;

  if v_in_charge > 1 then
    raise exception 'Only one Shift In-Charge is allowed' using errcode = '23505';
  end if;

  if (
    select count(*)
    from (select value->>'user_id' as id from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))) x
  ) <> (
    select count(distinct value->>'user_id')
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  ) then
    raise exception 'Duplicate roster user' using errcode = '23505';
  end if;

  delete from public.station_shift_assignments where shift_id = v_shift.id;

  insert into public.station_shift_assignments (shift_id, user_id, duty_role, created_by)
  select v_shift.id,
         (value->>'user_id')::uuid,
         upper(coalesce(nullif(btrim(value->>'duty_role'), ''), 'MEMBER')),
         auth.uid()
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb));

  return query
  select *
  from public.station_shift_assignments
  where shift_id = v_shift.id
  order by duty_role desc, created_at;
end;
$$;

revoke all on function public.save_station_shift_roster(uuid, jsonb) from public, anon;
grant execute on function public.save_station_shift_roster(uuid, jsonb) to authenticated;
