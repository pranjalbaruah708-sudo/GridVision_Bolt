-- DEV-safe validation. All temporary users, shifts, sessions, receipts and
-- audit rows are rolled back after the assertions complete.
begin;

do $$
declare
  v_operator uuid := gen_random_uuid();
  v_station uuid := gen_random_uuid();
  v_blocked_station uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_blocked_shift uuid := gen_random_uuid();
  v_successor uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_blocked_session uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_retry jsonb;
  v_tag text := 'no-next-' || gen_random_uuid();
begin
  insert into auth.users(id) values (v_operator);
  insert into public.app_users(id, full_name, role, active)
  values (v_operator, 'No next shift Operator', 'OPERATOR', true);
  insert into public.stations(id, code, name, active) values
    (v_station, left(v_tag, 60), 'No next shift station', true),
    (v_blocked_station, left(v_tag || '-blocked', 60), 'Successor test station', true);
  insert into public.user_stations(user_id, station_id, active) values
    (v_operator, v_station, true), (v_operator, v_blocked_station, true);

  insert into public.station_shifts(id, station_id, shift_date, shift_name, scheduled_start, scheduled_end, status) values
    (v_shift, v_station, current_date, 'No successor', now() - interval '2 hours', now() - interval '1 hour', 'ACTIVE'),
    (v_blocked_shift, v_blocked_station, current_date, 'Has successor', now() - interval '2 hours', now() - interval '1 hour', 'ACTIVE'),
    (v_successor, v_blocked_station, current_date, 'Successor', now() + interval '1 hour', now() + interval '2 hours', 'SCHEDULED');
  insert into public.station_shift_assignments(shift_id, user_id, duty_role) values
    (v_shift, v_operator, 'MEMBER'),
    (v_blocked_shift, v_operator, 'MEMBER');
  insert into public.shift_duty_sessions(id, shift_id, station_id, user_id, shift_role, started_at, status) values
    (v_session, v_shift, v_station, v_operator, 'MEMBER', now() - interval '110 minutes', 'ON_DUTY'),
    (v_blocked_session, v_blocked_shift, v_blocked_station, v_operator, 'MEMBER', now() - interval '110 minutes', 'ON_DUTY');

  perform set_config('request.jwt.claims', json_build_object('sub', v_operator, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.end_duty_without_next_shift_v2(v_blocked_session, gen_random_uuid(), null);
    raise exception 'The no-next-shift command accepted a shift with a successor';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select status from public.shift_duty_sessions where id = v_blocked_session) <> 'ON_DUTY' then
    raise exception 'A rejected no-next-shift command ended duty';
  end if;

  v_result := public.end_duty_without_next_shift_v2(v_session, v_key, 'Validation note');
  v_retry := public.end_duty_without_next_shift_v2(v_session, v_key, 'Changed retry note');
  if v_result <> v_retry then
    raise exception 'The no-next-shift command was not idempotent';
  end if;
  if v_result->>'reason' <> 'NO_NEXT_SHIFT_SCHEDULED'
    or v_result->'duty_session'->>'status' <> 'ENDED' then
    raise exception 'The no-next-shift command returned an invalid result';
  end if;
  reset role;

  if (select status from public.shift_duty_sessions where id = v_session) <> 'ENDED' then
    raise exception 'The authorized no-next-shift command did not end duty';
  end if;
  if (select status from public.station_shifts where id = v_shift) <> 'CLOSED' then
    raise exception 'The final ended duty did not close its shift';
  end if;
  if (select count(*) from public.shift_handover_audit_events
      where duty_session_id = v_session and event_type = 'DUTY_ENDED_NO_NEXT_SHIFT') <> 1 then
    raise exception 'Expected exactly one no-next-shift audit event';
  end if;
  if (select count(*) from public.shift_handovers where outgoing_shift_id = v_shift) <> 0 then
    raise exception 'The no-next-shift command created a handover';
  end if;
end;
$$;

rollback;
