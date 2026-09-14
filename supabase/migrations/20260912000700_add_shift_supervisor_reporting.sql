-- Stage 8: bounded, read-only supervisor history data. This avoids client-side
-- per-shift roster/attendance/handover requests while preserving station scope.
begin;

create or replace function public.get_station_shift_compliance(
  p_station_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 100
)
returns table(
  id uuid,
  station_id uuid,
  shift_date date,
  shift_name text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  status text,
  roster jsonb,
  duty_sessions jsonb,
  handover jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_shift_station_access(p_station_id);

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'A valid report date range is required' using errcode = '22023';
  end if;
  if p_to - p_from > 93 then
    raise exception 'Shift reports are limited to 93 days' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Shift report limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  select
    s.id,
    s.station_id,
    s.shift_date,
    s.shift_name,
    s.scheduled_start,
    s.scheduled_end,
    s.status,
    coalesce(r.roster, '[]'::jsonb),
    coalesce(d.duty_sessions, '[]'::jsonb),
    h.handover
  from public.station_shifts s
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'user_id', a.user_id,
        'full_name', u.full_name,
        'duty_role', a.duty_role,
        'created_at', a.created_at
      ) order by a.duty_role desc, u.full_name
    ) as roster
    from public.station_shift_assignments a
    join public.app_users u on u.id = a.user_id
    where a.shift_id = s.id
  ) r on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', ds.id,
        'user_id', ds.user_id,
        'full_name', u.full_name,
        'shift_role', ds.shift_role,
        'started_at', ds.started_at,
        'ended_at', ds.ended_at,
        'status', ds.status
      ) order by ds.started_at
    ) as duty_sessions
    from public.shift_duty_sessions ds
    join public.app_users u on u.id = ds.user_id
    where ds.shift_id = s.id
  ) d on true
  left join lateral (
    select jsonb_build_object(
      'id', sh.id,
      'status', sh.status,
      'incoming_shift_id', sh.incoming_shift_id,
      'submitted_by_user_id', sh.submitted_by_user_id,
      'submitted_by_name', submitted.full_name,
      'submitted_at', sh.submitted_at,
      'accepted_by_user_id', sh.accepted_by_user_id,
      'accepted_by_name', accepted.full_name,
      'accepted_at', sh.accepted_at,
      'outgoing_notes', sh.outgoing_notes
    ) as handover
    from public.shift_handovers sh
    left join public.app_users submitted on submitted.id = sh.submitted_by_user_id
    left join public.app_users accepted on accepted.id = sh.accepted_by_user_id
    where sh.outgoing_shift_id = s.id
    order by sh.created_at desc
    limit 1
  ) h on true
  where s.station_id = p_station_id
    and s.shift_date >= p_from
    and s.shift_date <= p_to
  order by s.scheduled_start desc
  limit p_limit;
end;
$$;

revoke all on function public.get_station_shift_compliance(uuid, date, date, integer) from public, anon;
grant execute on function public.get_station_shift_compliance(uuid, date, date, integer) to authenticated;

commit;
