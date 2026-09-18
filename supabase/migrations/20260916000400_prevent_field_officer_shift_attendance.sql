-- FIELD_OFFICER accounts may review shift operations but do not create or end
-- attendance sessions. Keep all existing station, timing, and ownership checks.
create or replace function public.start_shift_duty(p_shift_id uuid, p_shift_role text default 'MEMBER')
returns public.shift_duty_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.station_shifts%rowtype;
  v_session public.shift_duty_sessions%rowtype;
  v_app_role public.app_user_role;
  v_role text := upper(coalesce(nullif(btrim(p_shift_role), ''), 'MEMBER'));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select au.role into v_app_role from public.app_users au
  where au.id = auth.uid() and au.active = true;
  if v_app_role is null then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  if v_app_role = 'FIELD_OFFICER' then
    raise exception 'Field Officers cannot start shift duty' using errcode = '42501';
  end if;
  if v_role not in ('MEMBER', 'IN_CHARGE') then
    raise exception 'Invalid shift role' using errcode = '22023';
  end if;
  select * into v_shift from public.station_shifts where id = p_shift_id for update;
  if v_shift.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  perform public.assert_shift_station_access(v_shift.station_id);
  if v_shift.status = 'CANCELLED' or now() < v_shift.scheduled_start or now() >= v_shift.scheduled_end then
    raise exception 'Shift is not available for duty start' using errcode = 'P0001';
  end if;
  select * into v_session from public.shift_duty_sessions
  where shift_id = v_shift.id and user_id = auth.uid() and status = 'ON_DUTY' for update;
  if v_session.id is not null then return v_session; end if;
  insert into public.shift_duty_sessions (shift_id, station_id, user_id, shift_role)
  values (v_shift.id, v_shift.station_id, auth.uid(), v_role) returning * into v_session;
  if v_shift.status = 'SCHEDULED' then
    update public.station_shifts set status = 'ACTIVE' where id = v_shift.id;
  end if;
  return v_session;
end;
$$;

create or replace function public.end_shift_duty(p_duty_session_id uuid)
returns public.shift_duty_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_session public.shift_duty_sessions%rowtype;
  v_app_role public.app_user_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select au.role into v_app_role from public.app_users au
  where au.id = auth.uid() and au.active = true;
  if v_app_role is null then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  if v_app_role = 'FIELD_OFFICER' then
    raise exception 'Field Officers cannot end shift duty' using errcode = '42501';
  end if;
  select * into v_session from public.shift_duty_sessions where id = p_duty_session_id for update;
  if v_session.id is null then
    raise exception 'Duty session not found' using errcode = 'P0002';
  end if;
  perform public.assert_shift_station_access(v_session.station_id);
  if v_session.user_id <> auth.uid() then
    raise exception 'Only the duty participant can end this session' using errcode = '42501';
  end if;
  if v_session.status = 'ON_DUTY' then
    update public.shift_duty_sessions set status = 'ENDED', ended_at = now()
    where id = v_session.id returning * into v_session;
  end if;
  return v_session;
end;
$$;

revoke all on function public.start_shift_duty(uuid, text) from public, anon;
revoke all on function public.end_shift_duty(uuid) from public, anon;
grant execute on function public.start_shift_duty(uuid, text) to authenticated;
grant execute on function public.end_shift_duty(uuid) to authenticated;
