-- Shutdown Management backend Stage 4: server-authorised read/query RPCs.

begin;

create or replace function public.list_shutdown_dashboard_requests(
  p_status text default null, p_search text default null, p_station_id uuid default null,
  p_from_date date default null, p_to_date date default null,
  p_limit integer default 25, p_offset integer default 0
)
returns table (
  id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid,
  feeder_name text, equipment_name text, shutdown_type text, purpose text,
  planned_start timestamptz, expected_restoration timestamptz,
  requested_by uuid, requested_by_name text, requested_at timestamptz,
  status text, total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then raise exception 'Unsupported shutdown status' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination parameters' using errcode='22023'; end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then raise exception 'From date cannot be later than to date' using errcode='22023'; end if;
  return query
  with accessible as materialized (select a.station_id from public.get_my_accessible_station_ids() a),
  filtered as (
    select sr.id,sr.sd_number,sr.station_id,s.name station_name,sr.feeder_id,f.name feeder_name,
      sr.equipment_name,sr.shutdown_type,sr.purpose,sr.planned_start,sr.expected_restoration,
      sr.requested_by,au.full_name requested_by_name,sr.requested_at,sr.status
    from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id
    join public.stations s on s.id=sr.station_id left join public.feeders f on f.id=sr.feeder_id
    join public.app_users au on au.id=sr.requested_by
    where (p_status is null or sr.status=p_status) and (p_station_id is null or sr.station_id=p_station_id)
      and (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date >= p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date <= p_to_date)
      and (nullif(btrim(coalesce(p_search,'')),'') is null or sr.sd_number ilike '%'||btrim(p_search)||'%'
        or s.name ilike '%'||btrim(p_search)||'%' or f.name ilike '%'||btrim(p_search)||'%'
        or sr.equipment_name ilike '%'||btrim(p_search)||'%')
  )
  select x.*,count(*) over() from filtered x order by x.requested_at desc,x.id offset p_offset limit p_limit;
end; $$;

create or replace function public.get_shutdown_dashboard_kpis()
returns table (total bigint, pending_approval bigint, approved bigint, rejected bigint, cancelled bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  return query with accessible as materialized (select a.station_id from public.get_my_accessible_station_ids() a)
  select count(*)::bigint,count(*) filter(where sr.status='PENDING_APPROVAL')::bigint,
    count(*) filter(where sr.status='APPROVED')::bigint,count(*) filter(where sr.status='REJECTED')::bigint,
    count(*) filter(where sr.status='CANCELLED')::bigint
  from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id;
end; $$;

create or replace function public.list_my_shutdown_requests(
  p_status text default null, p_search text default null, p_from_date date default null,
  p_to_date date default null, p_limit integer default 25, p_offset integer default 0
)
returns table (
  id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid,
  feeder_name text, equipment_name text, shutdown_type text, purpose text,
  planned_start timestamptz, expected_restoration timestamptz,
  requested_by uuid, requested_by_name text, requested_at timestamptz,
  status text, total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then raise exception 'Unsupported shutdown status' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination parameters' using errcode='22023'; end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then raise exception 'From date cannot be later than to date' using errcode='22023'; end if;
  return query
  with filtered as (
    select sr.id,sr.sd_number,sr.station_id,s.name station_name,sr.feeder_id,f.name feeder_name,
      sr.equipment_name,sr.shutdown_type,sr.purpose,sr.planned_start,sr.expected_restoration,
      sr.requested_by,au.full_name requested_by_name,sr.requested_at,sr.status
    from public.shutdown_requests sr join public.stations s on s.id=sr.station_id
    left join public.feeders f on f.id=sr.feeder_id join public.app_users au on au.id=sr.requested_by
    where sr.requested_by=auth.uid() and (p_status is null or sr.status=p_status)
      and (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date >= p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date <= p_to_date)
      and (nullif(btrim(coalesce(p_search,'')),'') is null or sr.sd_number ilike '%'||btrim(p_search)||'%'
        or s.name ilike '%'||btrim(p_search)||'%' or f.name ilike '%'||btrim(p_search)||'%'
        or sr.equipment_name ilike '%'||btrim(p_search)||'%')
  )
  select x.*,count(*) over() from filtered x order by x.requested_at desc,x.id offset p_offset limit p_limit;
end; $$;

create or replace function public.get_shutdown_request(p_shutdown_id uuid)
returns table (
  id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid, feeder_name text,
  equipment_name text, shutdown_type text, purpose text, work_description text,
  planned_start timestamptz, expected_restoration timestamptz, remarks text,
  requested_by uuid, requested_by_name text, requested_at timestamptz, status text,
  decision_by uuid, decision_by_name text, decision_at timestamptz, decision_remarks text,
  created_at timestamptz, updated_at timestamptz, can_decide boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role public.app_user_role;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='28000'; end if;
  select au.role into v_role from public.app_users au where au.id=auth.uid() and au.active;
  if v_role is null then raise exception 'An active GridVision user is required' using errcode='42501'; end if;
  return query
  with accessible as materialized (select a.station_id from public.get_my_accessible_station_ids() a),
  found as (
    select sr.*,s.name station_name,f.name feeder_name,requester.full_name requested_by_name,
      decider.full_name decision_by_name,(a.station_id is not null) in_scope
    from public.shutdown_requests sr join public.stations s on s.id=sr.station_id
    left join public.feeders f on f.id=sr.feeder_id join public.app_users requester on requester.id=sr.requested_by
    left join public.app_users decider on decider.id=sr.decision_by left join accessible a on a.station_id=sr.station_id
    where sr.id=p_shutdown_id and (sr.requested_by=auth.uid() or a.station_id is not null)
  )
  select x.id,x.sd_number,x.station_id,x.station_name,x.feeder_id,x.feeder_name,x.equipment_name,
    x.shutdown_type,x.purpose,x.work_description,x.planned_start,x.expected_restoration,x.remarks,
    x.requested_by,x.requested_by_name,x.requested_at,x.status,x.decision_by,x.decision_by_name,
    x.decision_at,x.decision_remarks,x.created_at,x.updated_at,
    (x.status='PENDING_APPROVAL' and x.requested_by<>auth.uid() and x.in_scope and
      v_role in ('FIELD_OFFICER'::public.app_user_role,'ADMIN'::public.app_user_role,'SUPER_ADMIN'::public.app_user_role))
  from found x;
  if not found then raise exception 'Shutdown request was not found or is outside your authorized scope' using errcode='P0002'; end if;
end; $$;

create or replace function public.list_shutdown_report_requests(
  p_from_date date default null, p_to_date date default null, p_station_id uuid default null,
  p_status text default null, p_feeder_id uuid default null, p_equipment text default null,
  p_requester uuid default null, p_limit integer default 100, p_offset integer default 0
)
returns table (
  id uuid, sd_number text, station_id uuid, station_name text, feeder_id uuid, feeder_name text,
  equipment_name text, shutdown_type text, purpose text, work_description text,
  planned_start timestamptz, expected_restoration timestamptz, remarks text,
  requested_by uuid, requested_by_name text, requested_at timestamptz, status text,
  decision_by uuid, decision_by_name text, decision_at timestamptz, decision_remarks text,
  total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_users au where au.id=auth.uid() and au.active) then raise exception 'An authenticated active GridVision user is required' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') then raise exception 'Unsupported shutdown status' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination parameters' using errcode='22023'; end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then raise exception 'From date cannot be later than to date' using errcode='22023'; end if;
  return query with accessible as materialized (select a.station_id from public.get_my_accessible_station_ids() a), filtered as (
    select sr.id,sr.sd_number,sr.station_id,s.name station_name,sr.feeder_id,f.name feeder_name,
      sr.equipment_name,sr.shutdown_type,sr.purpose,sr.work_description,sr.planned_start,
      sr.expected_restoration,sr.remarks,sr.requested_by,requester.full_name requested_by_name,
      sr.requested_at,sr.status,sr.decision_by,decider.full_name decision_by_name,sr.decision_at,sr.decision_remarks
    from public.shutdown_requests sr join accessible a on a.station_id=sr.station_id
    join public.stations s on s.id=sr.station_id left join public.feeders f on f.id=sr.feeder_id
    join public.app_users requester on requester.id=sr.requested_by left join public.app_users decider on decider.id=sr.decision_by
    where (p_from_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date>=p_from_date)
      and (p_to_date is null or (sr.requested_at at time zone 'Asia/Kolkata')::date<=p_to_date)
      and (p_station_id is null or sr.station_id=p_station_id) and (p_status is null or sr.status=p_status)
      and (p_feeder_id is null or sr.feeder_id=p_feeder_id)
      and (nullif(btrim(coalesce(p_equipment,'')),'') is null or sr.equipment_name ilike '%'||btrim(p_equipment)||'%' or f.name ilike '%'||btrim(p_equipment)||'%')
      and (p_requester is null or sr.requested_by=p_requester)
  ) select x.*,count(*) over() from filtered x order by x.requested_at desc,x.id offset p_offset limit p_limit;
end; $$;

revoke all on function public.list_shutdown_dashboard_requests(text,text,uuid,date,date,integer,integer) from public,anon,authenticated;
revoke all on function public.get_shutdown_dashboard_kpis() from public,anon,authenticated;
revoke all on function public.list_my_shutdown_requests(text,text,date,date,integer,integer) from public,anon,authenticated;
revoke all on function public.get_shutdown_request(uuid) from public,anon,authenticated;
revoke all on function public.list_shutdown_report_requests(date,date,uuid,text,uuid,text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.list_shutdown_dashboard_requests(text,text,uuid,date,date,integer,integer) to authenticated;
grant execute on function public.get_shutdown_dashboard_kpis() to authenticated;
grant execute on function public.list_my_shutdown_requests(text,text,date,date,integer,integer) to authenticated;
grant execute on function public.get_shutdown_request(uuid) to authenticated;
grant execute on function public.list_shutdown_report_requests(date,date,uuid,text,uuid,text,uuid,integer,integer) to authenticated;

commit;
