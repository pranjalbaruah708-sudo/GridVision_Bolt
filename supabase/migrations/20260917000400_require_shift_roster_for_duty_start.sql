-- A duty session may only be started by an active Operator explicitly rostered
-- on the shift. This keeps station-level access separate from shift assignment.
create or replace function public.start_shift_duty(p_shift_id uuid, p_shift_role text default 'MEMBER')
returns public.shift_duty_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.station_shifts%rowtype;
  v_session public.shift_duty_sessions%rowtype;
  v_app_role public.app_user_role;
  v_role text := upper(coalesce(nullif(btrim(p_shift_role), ''), 'MEMBER'));
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select au.role into v_app_role from public.app_users au where au.id = auth.uid() and au.active = true;
  if v_app_role is null then raise exception 'An active GridVision user is required' using errcode = '42501'; end if;
  if v_app_role <> 'OPERATOR' then raise exception 'Only Operators can start shift duty' using errcode = '42501'; end if;
  if v_role not in ('MEMBER', 'IN_CHARGE') then raise exception 'Invalid shift role' using errcode = '22023'; end if;
  select * into v_shift from public.station_shifts where id = p_shift_id for update;
  if v_shift.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_shift.station_id);
  if not exists (select 1 from public.station_shift_assignments a join public.app_users u on u.id = a.user_id where a.shift_id = v_shift.id and a.user_id = auth.uid() and u.active = true and u.role = 'OPERATOR') then
    raise exception 'Operator is not rostered for this shift' using errcode = '42501';
  end if;
  if v_shift.status = 'CANCELLED' or now() < v_shift.scheduled_start or now() >= v_shift.scheduled_end then raise exception 'Shift is not available for duty start' using errcode = 'P0001'; end if;
  select * into v_session from public.shift_duty_sessions where shift_id = v_shift.id and user_id = auth.uid() and status = 'ON_DUTY' for update;
  if v_session.id is not null then return v_session; end if;
  insert into public.shift_duty_sessions(shift_id, station_id, user_id, shift_role) values(v_shift.id, v_shift.station_id, auth.uid(), v_role) returning * into v_session;
  if v_shift.status = 'SCHEDULED' then update public.station_shifts set status = 'ACTIVE' where id = v_shift.id; end if;
  return v_session;
end;
$$;
revoke all on function public.start_shift_duty(uuid, text) from public, anon;
grant execute on function public.start_shift_duty(uuid, text) to authenticated;
