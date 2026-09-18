-- Shift Handover reports are part of the existing broad report experience.
-- Keep operational/timeline authorization narrow; this read uses the global
-- station scope already used by Dashboard/Analytics and report selectors.
create or replace function public.get_station_shift_handover_report(
  p_station_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 500
)
returns table(
  id uuid,
  station_id uuid,
  outgoing_shift_id uuid,
  incoming_shift_id uuid,
  outgoing_shift_date date,
  incoming_shift_date date,
  outgoing_notes text,
  acceptance_comments text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_from is null or p_to is null then
    raise exception 'Report date range is required' using errcode = '22023';
  end if;

  if p_from > p_to then
    raise exception 'Invalid report date range' using errcode = '22023';
  end if;

  if p_station_id is not null and not exists (
    select 1
    from public.get_my_accessible_station_ids() scoped
    where scoped.station_id = p_station_id
  ) then
    raise exception 'Station access is not authorized' using errcode = '42501';
  end if;

  return query
  select
    h.id,
    h.station_id,
    h.outgoing_shift_id,
    h.incoming_shift_id,
    os.shift_date as outgoing_shift_date,
    ins.shift_date as incoming_shift_date,
    h.outgoing_notes,
    h.acceptance_comments,
    h.created_at,
    h.updated_at
  from public.shift_handovers h
  join public.station_shifts os on os.id = h.outgoing_shift_id
  join public.station_shifts ins on ins.id = h.incoming_shift_id
  where (
    (p_station_id is not null and h.station_id = p_station_id)
    or (
      p_station_id is null
      and h.station_id in (
        select scoped.station_id
        from public.get_my_accessible_station_ids() scoped
      )
    )
  )
  and os.shift_date between p_from and p_to
  and h.status in ('SUBMITTED', 'ACCEPTED')
  order by os.shift_date desc, h.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

revoke all on function public.get_station_shift_handover_report(uuid, date, date, integer) from anon;
grant execute on function public.get_station_shift_handover_report(uuid, date, date, integer) to authenticated;
