-- Shutdown initiation is limited to operational users. Approval remains
-- available to FIELD_OFFICER, ADMIN and SUPER_ADMIN through the existing
-- decision RPC. This corrective migration leaves existing requests intact.
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
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_user_role;
  v_result public.shutdown_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  select au.role into v_role
  from public.app_users au
  where au.id = v_user_id and au.active;

  if v_role is null then
    raise exception 'An active GridVision user is required' using errcode = '42501';
  end if;
  if v_role not in ('OPERATOR'::public.app_user_role, 'FIELD_OFFICER'::public.app_user_role) then
    raise exception 'Shutdown initiation is not permitted for this role' using errcode = '42501';
  end if;
  if p_station_id is null or not exists (
    select 1 from public.get_my_operational_station_ids() s where s.station_id = p_station_id
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
$function$;

revoke all on function public.create_shutdown_request(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.create_shutdown_request(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) to authenticated;
