-- Stage 4 corrective migration: qualify roster-read identifiers that collide
-- with RETURNS TABLE output-column variables. No schema or policy changes.
begin;

create or replace function public.get_shift_roster(p_shift_id uuid)
returns table(
  id uuid,
  shift_id uuid,
  user_id uuid,
  full_name text,
  duty_role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_station uuid;
begin
  select s.station_id
    into v_station
    from public.station_shifts s
   where s.id = p_shift_id;

  if v_station is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;

  perform public.assert_shift_station_access(v_station);

  return query
  select a.id, a.shift_id, a.user_id, u.full_name, a.duty_role, a.created_at
    from public.station_shift_assignments a
    join public.app_users u on u.id = a.user_id
   where a.shift_id = p_shift_id
   order by a.duty_role desc, u.full_name;
end;
$$;

revoke all on function public.get_shift_roster(uuid) from public, anon;
grant execute on function public.get_shift_roster(uuid) to authenticated;

commit;
