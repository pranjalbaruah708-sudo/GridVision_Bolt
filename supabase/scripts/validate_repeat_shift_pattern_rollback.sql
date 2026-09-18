-- DEV rollback smoke test: creates one repeated occurrence inside a transaction,
-- verifies an immediate retry is skipped as a conflict, then rolls back all rows.
begin;

do $$
declare
  v_actor uuid;
  v_operator uuid;
  v_station uuid;
  v_seed_shift public.station_shifts%rowtype;
  v_new_shift_id uuid;
  v_first_outcome text;
  v_retry_outcome text;
  v_actual_start timestamptz;
  v_actual_end timestamptz;
begin
  select id into v_actor
  from public.app_users
  where active and role = 'SUPER_ADMIN'::public.app_user_role
  order by created_at
  limit 1;

  select id into v_operator
  from public.app_users
  where active and role = 'OPERATOR'::public.app_user_role
  order by created_at
  limit 1;

  select id into v_station from public.stations
  where name = 'Atlanta East Substation' and active;

  if v_actor is null or v_operator is null or v_station is null then
    raise exception 'DEV rollback fixture is missing an active Super Admin, Operator, or Atlanta East Substation';
  end if;

  select * into v_seed_shift
  from public.station_shifts
  where station_id = v_station
    and shift_date = date '2026-11-20'
    and shift_name = 'Stage4 runtime 20260911 2200'
    and status <> 'CANCELLED'
  limit 1;

  if v_seed_shift.id is null then
    raise exception 'DEV rollback fixture seed shift was not found';
  end if;

  if exists (
    select 1 from public.station_shifts existing
    where existing.station_id = v_station
      and existing.scheduled_start < v_seed_shift.scheduled_end + interval '1 day'
      and existing.scheduled_end > v_seed_shift.scheduled_start + interval '1 day'
  ) then
    raise exception 'DEV rollback fixture next-day window is no longer available';
  end if;

  insert into public.user_stations (user_id, station_id, active)
  values (v_operator, v_station, true)
  on conflict (user_id, station_id) do update set active = true;

  insert into public.station_shift_assignments (shift_id, user_id, duty_role, created_by)
  values (v_seed_shift.id, v_operator, 'MEMBER', v_actor);

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  select r.outcome, r.shift_id into v_first_outcome, v_new_shift_id
  from public.repeat_station_shift_pattern(v_station, date '2026-11-20', date '2026-11-20', 2, 'days') r;

  if v_first_outcome <> 'CREATED' or v_new_shift_id is null then
    raise exception 'Expected the first repeat request to create one shift; got %', v_first_outcome;
  end if;

  select scheduled_start, scheduled_end into v_actual_start, v_actual_end
  from public.station_shifts where id = v_new_shift_id;

  if v_actual_start <> v_seed_shift.scheduled_start + interval '1 day'
    or v_actual_end <> v_seed_shift.scheduled_end + interval '1 day' then
    raise exception 'Repeated shift timestamps did not preserve the seed offset';
  end if;

  if not exists (
    select 1 from public.station_shift_assignments a
    where a.shift_id = v_new_shift_id and a.user_id = v_operator and a.duty_role = 'MEMBER'
  ) then
    raise exception 'Repeated shift did not copy its active assigned Operator roster';
  end if;

  select r.outcome into v_retry_outcome
  from public.repeat_station_shift_pattern(v_station, date '2026-11-20', date '2026-11-20', 2, 'days') r;

  if v_retry_outcome <> 'SKIPPED' then
    raise exception 'Expected an immediate retry to be skipped as a conflict; got %', v_retry_outcome;
  end if;
end;
$$;

reset role;
select 'PASS: repeat creation, timestamp offset, idempotent conflict skip; all test rows rolled back' as result;
rollback;
