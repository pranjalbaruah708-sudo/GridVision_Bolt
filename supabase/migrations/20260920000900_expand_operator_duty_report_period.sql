create or replace function public.get_operator_duty_report(
  p_from date, p_to date, p_station_id uuid default null, p_operator_id uuid default null
)
returns table(id uuid, station_id uuid, station_name text, shift_date date, shift_name text,
  scheduled_start timestamptz, scheduled_end timestamptz, status text, user_id uuid,
  operator_name text, duty_role text, duty_state text)
language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Operator duty report must span at most 366 days' using errcode='22023';
  end if;
  return query
  select
    s.id,
    s.station_id,
    st.name,
    s.shift_date,
    s.shift_name,
    s.scheduled_start,
    s.scheduled_end,
    s.status,
    a.user_id,
    u.full_name,
    a.duty_role,
    case
      when s.scheduled_end <= now() then 'OVER'
      when s.scheduled_start <= now() then 'CURRENT'
      else 'UPCOMING'
    end
  from public.station_shifts s
  join public.get_my_accessible_station_ids() access on access.station_id = s.station_id
  join public.stations st on st.id = s.station_id
  join public.station_shift_assignments a on a.shift_id = s.id
  join public.app_users u on u.id = a.user_id
  where s.status <> 'CANCELLED'
    and s.shift_date between p_from and p_to
    and (p_station_id is null or s.station_id = p_station_id)
    and (p_operator_id is null or a.user_id = p_operator_id)
  order by s.scheduled_start desc, u.full_name;
end;
$$;

revoke all on function public.get_operator_duty_report(date,date,uuid,uuid) from public, anon;
grant execute on function public.get_operator_duty_report(date,date,uuid,uuid) to authenticated;
