-- Restore decision-maker fields on the Shutdown Dashboard read contract.
-- A later scope migration replaced the dashboard function with an older
-- return shape, leaving the UI's Decision By column empty.

begin;

drop function if exists public.list_shutdown_dashboard_requests(text,text,uuid,date,date,integer,integer);

create function public.list_shutdown_dashboard_requests(
  p_status text default null,
  p_search text default null,
  p_station_id uuid default null,
  p_from_date date default null,
  p_to_date date default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  sd_number text,
  station_id uuid,
  station_name text,
  feeder_id uuid,
  feeder_name text,
  equipment_name text,
  shutdown_type text,
  purpose text,
  planned_start timestamptz,
  expected_restoration timestamptz,
  requested_by uuid,
  requested_by_name text,
  requested_at timestamptz,
  status text,
  decision_by uuid,
  decision_by_name text,
  decision_at timestamptz,
  decision_remarks text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.app_users au
       where au.id = auth.uid() and au.active
     ) then
    raise exception 'An authenticated active GridVision user is required'
      using errcode = '42501';
  end if;

  if p_status is not null
     and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then
    raise exception 'Unsupported shutdown status' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;

  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'From date cannot be later than to date' using errcode = '22023';
  end if;

  return query
  with accessible as materialized (
    select a.station_id
    from public.get_my_operational_station_ids() a
  ),
  filtered as (
    select
      sr.id,
      sr.sd_number,
      sr.station_id,
      s.name as station_name,
      sr.feeder_id,
      f.name as feeder_name,
      sr.equipment_name,
      sr.shutdown_type,
      sr.purpose,
      sr.planned_start,
      sr.expected_restoration,
      sr.requested_by,
      requester.full_name as requested_by_name,
      sr.requested_at,
      sr.status,
      sr.decision_by,
      decider.full_name as decision_by_name,
      sr.decision_at,
      sr.decision_remarks
    from public.shutdown_requests sr
    join accessible a on a.station_id = sr.station_id
    join public.stations s on s.id = sr.station_id
    left join public.feeders f on f.id = sr.feeder_id
    join public.app_users requester on requester.id = sr.requested_by
    left join public.app_users decider on decider.id = sr.decision_by
    where (p_status is null or sr.status = p_status)
      and (p_station_id is null or sr.station_id = p_station_id)
      and (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date >= p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date <= p_to_date)
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or sr.sd_number ilike '%' || btrim(p_search) || '%'
        or s.name ilike '%' || btrim(p_search) || '%'
        or f.name ilike '%' || btrim(p_search) || '%'
        or sr.equipment_name ilike '%' || btrim(p_search) || '%'
      )
  )
  select x.*, count(*) over ()
  from filtered x
  order by x.requested_at desc, x.id
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function public.list_shutdown_dashboard_requests(text,text,uuid,date,date,integer,integer)
  from public, anon, authenticated;
grant execute on function public.list_shutdown_dashboard_requests(text,text,uuid,date,date,integer,integer)
  to authenticated;

commit;
