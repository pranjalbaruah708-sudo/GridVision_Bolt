-- Bound recording-clock skew only; observation time and provenance remain unchanged.
begin;
create or replace function public.create_station_condition(
  p_station_id uuid, p_observed_at timestamptz, p_category text, p_condition text,
  p_observation text, p_client_operation_id text, p_equipment_area text default null,
  p_entry_mode text default 'ONLINE', p_recorded_at timestamptz default null
) returns public.station_conditions
language plpgsql security definer set search_path = public as $$
declare v_row public.station_conditions; v_recorded_at timestamptz;
begin
  if public.get_my_role() is distinct from 'OPERATOR'::public.app_user_role
    or not exists (select 1 from public.get_my_accessible_station_ids() a where a.station_id = p_station_id)
    or not public.is_assigned_to_station(p_station_id) then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;
  if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at > now()
    or p_entry_mode is null or p_entry_mode not in ('ONLINE','OFFLINE')
    or (p_recorded_at is not null and (not isfinite(p_recorded_at) or p_recorded_at > now() + interval '5 seconds')) then
    raise exception 'Invalid observation or recording time/mode' using errcode = '22023';
  end if;
  v_recorded_at := case when p_entry_mode = 'ONLINE' then now() else coalesce(p_recorded_at, now()) end;
  insert into public.station_conditions(station_id,observed_at,category,condition,observation,
    client_operation_id,equipment_area,recorded_by,entry_mode,recorded_at,synced_at)
  values(p_station_id,p_observed_at,p_category,p_condition,btrim(p_observation),p_client_operation_id,
    nullif(btrim(p_equipment_area),''),auth.uid(),p_entry_mode,v_recorded_at,
    case when p_entry_mode = 'OFFLINE' then now() end)
  on conflict (client_operation_id) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.station_conditions where client_operation_id = p_client_operation_id;
    if v_row.recorded_by is distinct from auth.uid() or v_row.station_id is distinct from p_station_id
      or v_row.observed_at is distinct from p_observed_at or v_row.category is distinct from p_category
      or v_row.condition is distinct from p_condition or v_row.observation is distinct from btrim(p_observation)
      or v_row.equipment_area is distinct from nullif(btrim(p_equipment_area),'')
      or v_row.entry_mode is distinct from p_entry_mode
      or (p_entry_mode = 'OFFLINE' and p_recorded_at is not null and v_row.recorded_at is distinct from p_recorded_at) then
      raise exception 'Operation identifier already used for a different record' using errcode = '23505';
    end if;
  end if;
  return v_row;
end;
$$;
commit;
