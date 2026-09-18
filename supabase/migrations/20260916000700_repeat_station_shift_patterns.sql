-- Repeat a bounded range of ordinary station shifts as independent occurrences.
-- No recurring master record is created; authorization and overlap rules remain
-- anchored to the existing shift planner and station-shift records.
create or replace function public.repeat_station_shift_pattern(
  p_station_id uuid,
  p_pattern_from date,
  p_pattern_to date,
  p_duration_value integer,
  p_duration_unit text
)
returns table (
  outcome text,
  seed_shift_id uuid,
  shift_id uuid,
  shift_name text,
  shift_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  skipped_reason text,
  omitted_roster_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_days integer;
  v_duration_unit text := lower(coalesce(nullif(btrim(p_duration_unit), ''), ''));
  v_horizon_end date;
  v_source record;
  v_offset_days integer;
  v_occurrence_date date;
  v_occurrence_start timestamptz;
  v_occurrence_end timestamptz;
  v_new_shift_id uuid;
  v_source_roster_count integer;
  v_copied_roster_count integer;
begin
  if p_station_id is null or p_pattern_from is null or p_pattern_to is null
    or p_pattern_to < p_pattern_from then
    raise exception 'Invalid station or seed pattern dates' using errcode = '22023';
  end if;

  if p_duration_value is null
    or (v_duration_unit = 'days' and (p_duration_value < 1 or p_duration_value > 366))
    or (v_duration_unit = 'months' and (p_duration_value < 1 or p_duration_value > 12))
    or v_duration_unit not in ('days', 'months') then
    raise exception 'Repeat duration must be 1–366 days or 1–12 months' using errcode = '22023';
  end if;

  perform public.assert_shift_planner_access(p_station_id);

  v_cycle_days := p_pattern_to - p_pattern_from + 1;
  if v_duration_unit = 'days' then
    v_horizon_end := p_pattern_from + p_duration_value;
  else
    v_horizon_end := (p_pattern_from + make_interval(months => p_duration_value))::date;
  end if;

  if v_horizon_end <= p_pattern_to + 1 then
    raise exception 'Repeat duration must extend beyond the complete seed pattern' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.station_shifts s
    where s.station_id = p_station_id
      and s.shift_date between p_pattern_from and p_pattern_to
      and s.status <> 'CANCELLED'
  ) then
    raise exception 'No non-cancelled shifts were found in the seed pattern range' using errcode = 'P0002';
  end if;

  -- Serialize this batch with the existing no-overlap trigger's per-station lock.
  perform pg_advisory_xact_lock(hashtextextended(p_station_id::text, 0));

  for v_source in
    select s.id, s.shift_date, s.shift_name, s.scheduled_start, s.scheduled_end
    from public.station_shifts s
    where s.station_id = p_station_id
      and s.shift_date between p_pattern_from and p_pattern_to
      and s.status <> 'CANCELLED'
    order by s.shift_date, s.scheduled_start, s.id
  loop
    v_offset_days := v_cycle_days;
    while v_source.shift_date + v_offset_days < v_horizon_end loop
      v_occurrence_date := v_source.shift_date + v_offset_days;
      v_occurrence_start := ((v_source.scheduled_start at time zone 'Asia/Kolkata') + make_interval(days => v_offset_days)) at time zone 'Asia/Kolkata';
      v_occurrence_end := ((v_source.scheduled_end at time zone 'Asia/Kolkata') + make_interval(days => v_offset_days)) at time zone 'Asia/Kolkata';

      if v_occurrence_start <= now() then
        return query select
          'SKIPPED'::text, v_source.id, null::uuid, v_source.shift_name,
          v_occurrence_date, v_occurrence_start, v_occurrence_end,
          'Occurrence starts in the past'::text, 0;
      elsif exists (
        select 1 from public.station_shifts existing
        where existing.station_id = p_station_id
          and existing.scheduled_start < v_occurrence_end
          and existing.scheduled_end > v_occurrence_start
      ) then
        return query select
          'SKIPPED'::text, v_source.id, null::uuid, v_source.shift_name,
          v_occurrence_date, v_occurrence_start, v_occurrence_end,
          'Overlaps an existing station shift'::text, 0;
      else
        insert into public.station_shifts (
          station_id, shift_date, shift_name, scheduled_start, scheduled_end, status, created_by
        ) values (
          p_station_id, v_occurrence_date, v_source.shift_name,
          v_occurrence_start, v_occurrence_end, 'SCHEDULED', auth.uid()
        ) returning id into v_new_shift_id;

        select count(*)::integer into v_source_roster_count
        from public.station_shift_assignments a
        where a.shift_id = v_source.id;

        insert into public.station_shift_assignments (shift_id, user_id, duty_role, created_by)
        select v_new_shift_id, a.user_id, a.duty_role, auth.uid()
        from public.station_shift_assignments a
        join public.app_users u
          on u.id = a.user_id
         and u.active = true
         and u.role = 'OPERATOR'::public.app_user_role
        join public.user_stations us
          on us.user_id = u.id
         and us.station_id = p_station_id
         and us.active = true
        where a.shift_id = v_source.id;

        get diagnostics v_copied_roster_count = row_count;

        return query select
          'CREATED'::text, v_source.id, v_new_shift_id, v_source.shift_name,
          v_occurrence_date, v_occurrence_start, v_occurrence_end,
          null::text, greatest(v_source_roster_count - v_copied_roster_count, 0);
      end if;

      v_offset_days := v_offset_days + v_cycle_days;
    end loop;
  end loop;
end;
$$;

revoke all on function public.repeat_station_shift_pattern(uuid, date, date, integer, text) from public, anon;
grant execute on function public.repeat_station_shift_pattern(uuid, date, date, integer, text) to authenticated;
