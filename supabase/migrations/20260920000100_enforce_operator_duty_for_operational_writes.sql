-- Enforce the server-confirmed duty session for operational writes.
-- Supervisory reads and service-role processing retain their existing access.
begin;

create or replace function public.can_operator_make_station_entry(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.get_my_role() = 'OPERATOR'::public.app_user_role
    and public.is_assigned_to_station(p_station_id)
    and (
      not exists (
        select 1
        from public.station_shifts s
        where s.station_id = p_station_id
          and s.status <> 'CANCELLED'
          and now() >= s.scheduled_start
          and now() < s.scheduled_end
      )
      or exists (
        select 1
        from public.station_shifts s
        join public.station_shift_assignments assignment
          on assignment.shift_id = s.id
         and assignment.user_id = auth.uid()
        join public.shift_duty_sessions duty
          on duty.shift_id = s.id
         and duty.station_id = s.station_id
         and duty.user_id = auth.uid()
         and duty.status = 'ON_DUTY'
         and duty.ended_at is null
        where s.station_id = p_station_id
          and s.status <> 'CANCELLED'
          and now() >= s.scheduled_start
          and now() < s.scheduled_end
      )
    );
$$;

revoke all on function public.can_operator_make_station_entry(uuid) from public, anon;
grant execute on function public.can_operator_make_station_entry(uuid) to authenticated;

comment on function public.can_operator_make_station_entry(uuid) is
  'True only for an active assigned Operator who may write at the station now. During an applicable shift the Operator must be rostered and have an unended ON_DUTY session; without an applicable shift the existing assigned-Operator rule is preserved.';

-- Backstop every table mutation, including writes performed inside a
-- SECURITY DEFINER RPC. Service-role/system writes have no application user
-- identity and retain PostgreSQL BYPASSRLS behavior.
create or replace function public.enforce_operator_station_entry_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_user_role;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.get_my_role();
  if v_role is null then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  if v_role = 'OPERATOR'::public.app_user_role
     and not public.can_operator_make_station_entry(new.station_id) then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_operator_station_entry_write() from public, anon, authenticated;

drop trigger if exists enforce_interruption_operator_duty on public.interruptions;
create trigger enforce_interruption_operator_duty
before insert or update on public.interruptions
for each row execute function public.enforce_operator_station_entry_write();

drop trigger if exists enforce_station_condition_operator_duty on public.station_conditions;
create trigger enforce_station_condition_operator_duty
before insert or update on public.station_conditions
for each row execute function public.enforce_operator_station_entry_write();

-- Direct interruption writes remain Operator-only and keep the existing
-- ownership and feeder/station integrity checks. The duty helper is applied to
-- both the existing row (USING) and the proposed row (WITH CHECK).
drop policy if exists "Operators can insert assigned interruptions" on public.interruptions;
create policy "Operators can insert assigned interruptions"
  on public.interruptions
  for insert
  to authenticated
  with check (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and operator_id = auth.uid()
    and public.can_operator_make_station_entry(station_id)
    and (
      feeder_id is null
      or exists (
        select 1
        from public.feeders feeder
        where feeder.id = interruptions.feeder_id
          and feeder.station_id = interruptions.station_id
          and feeder.active = true
      )
    )
  );

drop policy if exists "Operators can update own assigned interruptions" on public.interruptions;
create policy "Operators can update own assigned interruptions"
  on public.interruptions
  for update
  to authenticated
  using (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and operator_id = auth.uid()
    and public.can_operator_make_station_entry(station_id)
  )
  with check (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and operator_id = auth.uid()
    and public.can_operator_make_station_entry(station_id)
    and (
      feeder_id is null
      or exists (
        select 1
        from public.feeders feeder
        where feeder.id = interruptions.feeder_id
          and feeder.station_id = interruptions.station_id
          and feeder.active = true
      )
    )
  );

-- Station Condition writes remain RPC-only. Both online creation and queued
-- replay reach this function, so authorization is evaluated at server time.
create or replace function public.create_station_condition(
  p_station_id uuid, p_observed_at timestamptz, p_category text, p_condition text,
  p_observation text, p_client_operation_id text, p_equipment_area text default null,
  p_entry_mode text default 'ONLINE', p_recorded_at timestamptz default null
) returns public.station_conditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.station_conditions;
  v_recorded_at timestamptz;
begin
  if auth.uid() is null
    or public.get_my_role() is distinct from 'OPERATOR'::public.app_user_role
    or not exists (select 1 from public.get_my_accessible_station_ids() a where a.station_id = p_station_id)
    or not public.can_operator_make_station_entry(p_station_id) then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at > now()
    or p_entry_mode is null or p_entry_mode not in ('ONLINE','OFFLINE')
    or (p_recorded_at is not null and (not isfinite(p_recorded_at) or p_recorded_at > now() + interval '5 seconds')) then
    raise exception 'Invalid observation or recording time/mode' using errcode = '22023';
  end if;

  v_recorded_at := case when p_entry_mode = 'ONLINE' then now() else coalesce(p_recorded_at, now()) end;
  insert into public.station_conditions(
    station_id, observed_at, category, condition, observation,
    client_operation_id, equipment_area, recorded_by, entry_mode, recorded_at, synced_at
  ) values (
    p_station_id, p_observed_at, p_category, p_condition, btrim(p_observation),
    p_client_operation_id, nullif(btrim(p_equipment_area),''), auth.uid(), p_entry_mode,
    v_recorded_at, case when p_entry_mode = 'OFFLINE' then now() end
  )
  on conflict (client_operation_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.station_conditions
    where client_operation_id = p_client_operation_id;
    if v_row.recorded_by is distinct from auth.uid()
      or v_row.station_id is distinct from p_station_id
      or v_row.observed_at is distinct from p_observed_at
      or v_row.category is distinct from p_category
      or v_row.condition is distinct from p_condition
      or v_row.observation is distinct from btrim(p_observation)
      or v_row.equipment_area is distinct from nullif(btrim(p_equipment_area),'')
      or v_row.entry_mode is distinct from p_entry_mode
      or (p_entry_mode = 'OFFLINE' and p_recorded_at is not null and v_row.recorded_at is distinct from p_recorded_at) then
      raise exception 'Operation identifier already used for a different record' using errcode = '23505';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.rectify_station_condition(p_id uuid)
returns public.station_conditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.station_conditions;
begin
  if auth.uid() is null
     or public.get_my_role() is distinct from 'OPERATOR'::public.app_user_role then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  select c.* into v_row
  from public.station_conditions c
  where c.id = p_id
    and c.station_id in (select a.station_id from public.get_my_accessible_station_ids() a)
  for update;

  if v_row.id is null
     or not public.can_operator_make_station_entry(v_row.station_id) then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  if v_row.status = 'OPEN' then
    update public.station_conditions
    set status = 'RECTIFIED', rectified_at = now(), rectified_by = auth.uid()
    where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.create_station_condition(uuid,timestamptz,text,text,text,text,text,text,timestamptz) from public, anon;
revoke all on function public.rectify_station_condition(uuid) from public, anon;
grant execute on function public.create_station_condition(uuid,timestamptz,text,text,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.rectify_station_condition(uuid) to authenticated;

-- Historical interruption replay is SECURITY DEFINER and therefore performs
-- the same server-time duty check explicitly before it touches the table.
create or replace function public.sync_historical_interruption(
  p_station_id uuid,
  p_feeder_id uuid,
  p_interruption_start timestamptz,
  p_interruption_end timestamptz,
  p_cause text,
  p_remarks text,
  p_etr timestamptz,
  p_add_recorded_at timestamptz,
  p_restore_recorded_at timestamptz,
  p_add_client_operation_id text,
  p_restore_client_operation_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_interruption public.interruptions%rowtype;
  v_feeder_name text;
  v_station_name text;
  v_synced_at timestamptz := now();
  v_duration numeric;
  v_message text;
  v_source_operation_id text;
begin
  if v_user_id is null
     or public.get_my_role() is distinct from 'OPERATOR'::public.app_user_role
     or not exists (select 1 from public.get_my_accessible_station_ids() a where a.station_id = p_station_id)
     or not public.can_operator_make_station_entry(p_station_id) then
    raise exception 'Station write access is not authorized' using errcode = '42501';
  end if;

  if p_add_client_operation_id is null or btrim(p_add_client_operation_id) = ''
     or p_restore_client_operation_id is null or btrim(p_restore_client_operation_id) = '' then
    raise exception 'Both client operation identifiers are required' using errcode = '22023';
  end if;
  if p_interruption_start is null or p_interruption_end is null
     or p_interruption_end < p_interruption_start or p_interruption_end > v_synced_at then
    raise exception 'Invalid historical interruption timestamps' using errcode = '22023';
  end if;

  select f.name, s.name into v_feeder_name, v_station_name
  from public.feeders f
  join public.stations s on s.id = f.station_id
  where f.id = p_feeder_id
    and f.station_id = p_station_id
    and coalesce(f.active, true);
  if not found then
    raise exception 'Feeder is not active at the authorised station' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_add_client_operation_id || ':' || p_restore_client_operation_id, 0));

  select i.* into v_interruption
  from public.interruptions i
  where i.client_operation_id = p_add_client_operation_id
     or i.restore_client_operation_id = p_restore_client_operation_id
  order by (i.client_operation_id = p_add_client_operation_id and i.restore_client_operation_id = p_restore_client_operation_id) desc
  limit 1;

  if found then
    if v_interruption.station_id <> p_station_id
       or v_interruption.feeder_id is distinct from p_feeder_id
       or v_interruption.operator_id is distinct from v_user_id
       or (v_interruption.client_operation_id is not null and v_interruption.client_operation_id <> p_add_client_operation_id)
       or (v_interruption.restore_client_operation_id is not null and v_interruption.restore_client_operation_id <> p_restore_client_operation_id) then
      raise exception 'Client operation identifier conflicts with another interruption' using errcode = '23505';
    end if;
    v_synced_at := coalesce(v_interruption.synced_at, v_synced_at);
  end if;

  v_duration := round(extract(epoch from (p_interruption_end - p_interruption_start)) / 60);
  perform set_config('gridvision.historical_sync', 'on', true);

  if v_interruption.id is null then
    insert into public.interruptions(
      station_id, feeder_id, operator_id, interruption_start, interruption_end,
      duration_minutes, cause, remarks, current_status, etr, entry_mode,
      recorded_at, synced_at, client_operation_id, restore_client_operation_id
    ) values (
      p_station_id, p_feeder_id, v_user_id, p_interruption_start, p_interruption_end,
      v_duration, p_cause, p_remarks, 'RESTORED', p_etr, 'OFFLINE',
      p_add_recorded_at, v_synced_at, p_add_client_operation_id, p_restore_client_operation_id
    ) returning * into v_interruption;
  else
    update public.interruptions
    set interruption_end = p_interruption_end,
        duration_minutes = v_duration,
        current_status = 'RESTORED',
        restore_client_operation_id = p_restore_client_operation_id,
        entry_mode = 'OFFLINE',
        recorded_at = coalesce(recorded_at, p_add_recorded_at),
        synced_at = v_synced_at
    where id = v_interruption.id
    returning * into v_interruption;
  end if;

  v_source_operation_id := 'historical-interruption:' || p_restore_client_operation_id;
  v_message := v_feeder_name || ' at ' || v_station_name || ' tripped at '
    || to_char(p_interruption_start at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')
    || ' and was restored at '
    || to_char(p_interruption_end at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')
    || '. Duration ' || v_duration || ' min. Synced at '
    || to_char(v_synced_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || '.';

  perform public.create_notification_event(
    p_station_id, p_feeder_id, p_interruption_end, v_message, v_user_id, null,
    'HISTORICAL_SYNC', 'OFFLINE', p_restore_recorded_at, v_synced_at, v_source_operation_id
  );

  return v_interruption.id;
end;
$$;

revoke all on function public.sync_historical_interruption(uuid,uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,timestamptz,text,text) from public, anon;
grant execute on function public.sync_historical_interruption(uuid,uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,timestamptz,text,text) to authenticated;

commit;
