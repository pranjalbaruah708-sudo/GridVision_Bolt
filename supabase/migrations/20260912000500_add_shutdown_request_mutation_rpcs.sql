-- Shutdown Management backend Stage 3: authoritative mutation RPCs.

begin;

create table public.shutdown_sd_number_counters (
  year integer primary key check (year between 2000 and 9999),
  last_number bigint not null check (last_number > 0),
  updated_at timestamptz not null default now()
);

alter table public.shutdown_sd_number_counters enable row level security;
revoke all on table public.shutdown_sd_number_counters from public, anon, authenticated;

create or replace function public.generate_shutdown_sd_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from timezone('Asia/Kolkata', now()))::integer;
  v_number bigint;
begin
  insert into public.shutdown_sd_number_counters as counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = counters.last_number + 1,
        updated_at = now()
  returning last_number into v_number;

  if v_number > 999999 then
    raise exception 'Shutdown number capacity has been exhausted for %', v_year
      using errcode = '22003';
  end if;

  return format('SD-%s-%s', v_year, lpad(v_number::text, 6, '0'));
end;
$$;

create or replace function public.create_shutdown_request(
  p_station_id uuid,
  p_feeder_id uuid default null,
  p_equipment_name text default null,
  p_shutdown_type text default null,
  p_purpose text default null,
  p_work_description text default null,
  p_planned_start timestamptz default null,
  p_expected_restoration timestamptz default null,
  p_remarks text default null
)
returns public.shutdown_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.shutdown_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.app_users au where au.id = v_user_id and au.active) then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  if p_station_id is null or not exists (
    select 1 from public.get_my_accessible_station_ids() s where s.station_id = p_station_id
  ) then
    raise exception 'Station is outside your authorized scope' using errcode = '42501';
  end if;
  if p_feeder_id is not null and not exists (
    select 1 from public.feeders f
    where f.id = p_feeder_id and f.station_id = p_station_id and f.active
  ) then
    raise exception 'Feeder does not belong to the selected station' using errcode = '22023';
  end if;
  if btrim(coalesce(p_shutdown_type, '')) = ''
     or btrim(coalesce(p_purpose, '')) = ''
     or btrim(coalesce(p_work_description, '')) = '' then
    raise exception 'Shutdown type, purpose and work description are required' using errcode = '22023';
  end if;
  if p_planned_start is null or p_expected_restoration is null
     or p_expected_restoration <= p_planned_start then
    raise exception 'Expected restoration must be later than planned start' using errcode = '22023';
  end if;

  insert into public.shutdown_requests (
    sd_number, station_id, feeder_id, equipment_name, shutdown_type, purpose,
    work_description, planned_start, expected_restoration, remarks,
    status, requested_by, requested_at
  ) values (
    public.generate_shutdown_sd_number(), p_station_id, p_feeder_id,
    nullif(btrim(coalesce(p_equipment_name, '')), ''), btrim(p_shutdown_type),
    btrim(p_purpose), btrim(p_work_description), p_planned_start,
    p_expected_restoration, nullif(btrim(coalesce(p_remarks, '')), ''),
    'PENDING_APPROVAL', v_user_id, now()
  ) returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.decide_shutdown_request(
  p_shutdown_id uuid,
  p_target_status text,
  p_decision_remarks text default null
)
returns public.shutdown_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_user_role;
  v_request public.shutdown_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  select au.role into v_role from public.app_users au
  where au.id = v_user_id and au.active;
  if v_role is null then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  -- Temporary rule until configurable Shutdown approval administration exists.
  if v_role not in ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role) then
    raise exception 'Shutdown approval permission is required' using errcode = '42501';
  end if;
  if p_target_status not in ('APPROVED', 'REJECTED') then
    raise exception 'Unsupported shutdown decision' using errcode = '22023';
  end if;
  if p_target_status = 'REJECTED' and btrim(coalesce(p_decision_remarks, '')) = '' then
    raise exception 'Rejection remarks are required' using errcode = '22023';
  end if;

  select * into v_request
  from public.shutdown_requests sr
  where sr.id = p_shutdown_id
  for update;
  if not found then
    raise exception 'Shutdown request was not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'PENDING_APPROVAL' then
    raise exception 'Shutdown request has already been decided' using errcode = '55000';
  end if;
  if v_request.requested_by = v_user_id then
    raise exception 'You cannot decide your own shutdown request' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.get_my_accessible_station_ids() s
    where s.station_id = v_request.station_id
  ) then
    raise exception 'Shutdown request is outside your authorized scope' using errcode = '42501';
  end if;

  update public.shutdown_requests
  set status = p_target_status,
      decision_by = v_user_id,
      decision_at = now(),
      decision_remarks = nullif(btrim(coalesce(p_decision_remarks, '')), '')
  where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$$;

create or replace function public.approve_shutdown_request(
  p_shutdown_id uuid,
  p_decision_remarks text default null
)
returns public.shutdown_requests
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.decide_shutdown_request(p_shutdown_id, 'APPROVED', p_decision_remarks);
$$;

create or replace function public.reject_shutdown_request(
  p_shutdown_id uuid,
  p_decision_remarks text
)
returns public.shutdown_requests
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.decide_shutdown_request(p_shutdown_id, 'REJECTED', p_decision_remarks);
$$;

revoke all on function public.generate_shutdown_sd_number() from public, anon, authenticated;
revoke all on function public.decide_shutdown_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_shutdown_request(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.approve_shutdown_request(uuid, text) from public, anon, authenticated;
revoke all on function public.reject_shutdown_request(uuid, text) from public, anon, authenticated;
grant execute on function public.create_shutdown_request(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.approve_shutdown_request(uuid, text) to authenticated;
grant execute on function public.reject_shutdown_request(uuid, text) to authenticated;

-- Direct table mutation remains unavailable.
revoke insert, update, delete on table public.shutdown_requests from authenticated;

commit;
