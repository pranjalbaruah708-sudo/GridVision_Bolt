-- GridVision Shift Duty and Handover Stage 2 foundation.
-- New records are station-scoped and do not alter existing operational tables.

begin;

create table public.station_shifts (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete restrict,
  shift_date date not null,
  shift_name text not null check (btrim(shift_name) <> ''),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'ACTIVE', 'CLOSED', 'CANCELLED')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint station_shifts_window_check check (scheduled_end > scheduled_start),
  constraint station_shifts_logical_window_unique unique (station_id, scheduled_start, scheduled_end)
);

create index station_shifts_station_window_idx on public.station_shifts (station_id, scheduled_start desc);
create index station_shifts_station_status_idx on public.station_shifts (station_id, status, scheduled_start desc);
create trigger station_shifts_updated_at before update on public.station_shifts
for each row execute function public.update_updated_at_column();

create or replace function public.enforce_station_shift_no_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.station_id::text, 0));
  if exists (
    select 1 from public.station_shifts s
    where s.station_id = new.station_id and s.id is distinct from new.id
      and s.scheduled_start < new.scheduled_end and s.scheduled_end > new.scheduled_start
  ) then
    raise exception 'Station shifts cannot overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger enforce_station_shift_no_overlap_trigger
before insert or update of station_id, scheduled_start, scheduled_end on public.station_shifts
for each row execute function public.enforce_station_shift_no_overlap();

create table public.shift_duty_sessions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.station_shifts(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  shift_role text not null default 'MEMBER' check (shift_role in ('MEMBER', 'IN_CHARGE')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'ON_DUTY' check (status in ('ON_DUTY', 'ENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_duty_sessions_end_check check (
    (status = 'ON_DUTY' and ended_at is null) or (status = 'ENDED' and ended_at is not null and ended_at >= started_at)
  )
);

create unique index shift_duty_sessions_one_active_user_idx
  on public.shift_duty_sessions (shift_id, user_id) where status = 'ON_DUTY';
create index shift_duty_sessions_shift_status_idx on public.shift_duty_sessions (shift_id, status, started_at);
create index shift_duty_sessions_station_started_idx on public.shift_duty_sessions (station_id, started_at desc);
create trigger shift_duty_sessions_updated_at before update on public.shift_duty_sessions
for each row execute function public.update_updated_at_column();

create table public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete restrict,
  outgoing_shift_id uuid not null references public.station_shifts(id) on delete restrict,
  incoming_shift_id uuid not null references public.station_shifts(id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  prepared_by_user_id uuid references public.app_users(id) on delete set null,
  submitted_by_user_id uuid references public.app_users(id) on delete set null,
  submitted_at timestamptz,
  accepted_by_user_id uuid references public.app_users(id) on delete set null,
  accepted_at timestamptz,
  outgoing_notes text,
  acceptance_comments text,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_handovers_distinct_shifts_check check (outgoing_shift_id <> incoming_shift_id),
  constraint shift_handovers_transition_unique unique (outgoing_shift_id, incoming_shift_id),
  constraint shift_handovers_submitted_fields_check check (
    (status = 'DRAFT' and submitted_by_user_id is null and submitted_at is null and accepted_by_user_id is null and accepted_at is null)
    or (status in ('SUBMITTED', 'REJECTED', 'SUPERSEDED') and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is null and accepted_at is null)
    or (status = 'ACCEPTED' and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is not null and accepted_at is not null)
  )
);

create index shift_handovers_station_status_idx on public.shift_handovers (station_id, status, created_at desc);
create index shift_handovers_incoming_status_idx on public.shift_handovers (incoming_shift_id, status);
create trigger shift_handovers_updated_at before update on public.shift_handovers
for each row execute function public.update_updated_at_column();

create table public.shift_handover_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  source_type text not null check (source_type in ('INTERRUPTION', 'PARAMETER_ALERT', 'LOGBOOK_ENTRY', 'OPERATIONAL_NOTE')),
  source_id uuid,
  description text,
  priority text check (priority is null or priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shift_handover_items_source_check check (
    (source_type = 'OPERATIONAL_NOTE' and source_id is null and btrim(coalesce(description, '')) <> '')
    or (source_type <> 'OPERATIONAL_NOTE' and source_id is not null)
  )
);

create unique index shift_handover_items_source_unique_idx
  on public.shift_handover_items (handover_id, source_type, source_id) where source_id is not null;
create index shift_handover_items_handover_idx on public.shift_handover_items (handover_id, created_at);

create or replace function public.enforce_shift_duty_session_station()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_station_id uuid;
begin
  select station_id into v_station_id from public.station_shifts where id = new.shift_id;
  if v_station_id is null or v_station_id <> new.station_id then
    raise exception 'Duty session station must match its shift station' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_shift_duty_session_station_trigger
before insert or update of shift_id, station_id on public.shift_duty_sessions
for each row execute function public.enforce_shift_duty_session_station();

create or replace function public.enforce_shift_handover_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_outgoing public.station_shifts%rowtype; v_incoming public.station_shifts%rowtype;
begin
  select * into v_outgoing from public.station_shifts where id = new.outgoing_shift_id;
  select * into v_incoming from public.station_shifts where id = new.incoming_shift_id;
  if v_outgoing.id is null or v_incoming.id is null
     or v_outgoing.station_id <> new.station_id or v_incoming.station_id <> new.station_id
     or v_incoming.scheduled_start < v_outgoing.scheduled_end then
    raise exception 'Handover shifts must be sequential shifts for the same station' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'ACCEPTED' then
      raise exception 'Accepted handovers are immutable' using errcode = '55000';
    end if;
    if old.status = 'SUBMITTED' and (new.outgoing_shift_id <> old.outgoing_shift_id or new.incoming_shift_id <> old.incoming_shift_id
      or new.station_id <> old.station_id or new.outgoing_notes is distinct from old.outgoing_notes
      or new.snapshot is distinct from old.snapshot or new.submitted_by_user_id <> old.submitted_by_user_id
      or new.submitted_at <> old.submitted_at) then
      raise exception 'Submitted handover content is immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_shift_handover_transition_trigger
before insert or update on public.shift_handovers
for each row execute function public.enforce_shift_handover_transition();

create or replace function public.enforce_shift_handover_item_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_station_id uuid; v_exists boolean;
begin
  select h.station_id into v_station_id from public.shift_handovers h where h.id = new.handover_id;
  if v_station_id is null then raise exception 'Handover does not exist' using errcode = '23503'; end if;
  if new.source_type = 'INTERRUPTION' then
    select exists(select 1 from public.interruptions where id = new.source_id and station_id = v_station_id) into v_exists;
  elsif new.source_type = 'PARAMETER_ALERT' then
    select exists(select 1 from public.parameter_alerts where id = new.source_id and station_id = v_station_id) into v_exists;
  elsif new.source_type = 'LOGBOOK_ENTRY' then
    select exists(select 1 from public.log_book_entries where id = new.source_id and station_id = v_station_id) into v_exists;
  else
    return new;
  end if;
  if not v_exists then raise exception 'Referenced handover record is not in the handover station' using errcode = '23514'; end if;
  return new;
end;
$$;

create trigger enforce_shift_handover_item_source_trigger
before insert or update of handover_id, source_type, source_id on public.shift_handover_items
for each row execute function public.enforce_shift_handover_item_source();

create or replace function public.assert_shift_station_access(p_station_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.get_my_accessible_station_ids() s where s.station_id = p_station_id
  ) then
    raise exception 'Station access is not authorized' using errcode = '42501';
  end if;
end;
$$;

alter table public.station_shifts enable row level security;
alter table public.shift_duty_sessions enable row level security;
alter table public.shift_handovers enable row level security;
alter table public.shift_handover_items enable row level security;

create policy station_shifts_read_authorized on public.station_shifts for select to authenticated
using (exists (select 1 from public.get_my_accessible_station_ids() s where s.station_id = station_shifts.station_id));
create policy shift_duty_sessions_read_authorized on public.shift_duty_sessions for select to authenticated
using (exists (select 1 from public.get_my_accessible_station_ids() s where s.station_id = shift_duty_sessions.station_id));
create policy shift_handovers_read_authorized on public.shift_handovers for select to authenticated
using (exists (select 1 from public.get_my_accessible_station_ids() s where s.station_id = shift_handovers.station_id));
create policy shift_handover_items_read_authorized on public.shift_handover_items for select to authenticated
using (exists (select 1 from public.shift_handovers h join public.get_my_accessible_station_ids() s on s.station_id = h.station_id where h.id = shift_handover_items.handover_id));

revoke all on table public.station_shifts, public.shift_duty_sessions, public.shift_handovers, public.shift_handover_items from anon;
grant select on table public.station_shifts, public.shift_duty_sessions, public.shift_handovers, public.shift_handover_items to authenticated;

create or replace function public.start_shift_duty(p_shift_id uuid, p_shift_role text default 'MEMBER')
returns public.shift_duty_sessions language plpgsql security definer set search_path = public as $$
declare v_shift public.station_shifts%rowtype; v_session public.shift_duty_sessions%rowtype; v_role text := upper(coalesce(nullif(btrim(p_shift_role), ''), 'MEMBER'));
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if v_role not in ('MEMBER', 'IN_CHARGE') then raise exception 'Invalid shift role' using errcode = '22023'; end if;
  select * into v_shift from public.station_shifts where id = p_shift_id for update;
  if v_shift.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_shift.station_id);
  if v_shift.status = 'CANCELLED' or now() < v_shift.scheduled_start or now() >= v_shift.scheduled_end then
    raise exception 'Shift is not available for duty start' using errcode = 'P0001';
  end if;
  select * into v_session from public.shift_duty_sessions where shift_id = v_shift.id and user_id = auth.uid() and status = 'ON_DUTY' for update;
  if v_session.id is not null then return v_session; end if;
  insert into public.shift_duty_sessions (shift_id, station_id, user_id, shift_role)
  values (v_shift.id, v_shift.station_id, auth.uid(), v_role) returning * into v_session;
  if v_shift.status = 'SCHEDULED' then update public.station_shifts set status = 'ACTIVE' where id = v_shift.id; end if;
  return v_session;
end;
$$;

create or replace function public.end_shift_duty(p_duty_session_id uuid)
returns public.shift_duty_sessions language plpgsql security definer set search_path = public as $$
declare v_session public.shift_duty_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into v_session from public.shift_duty_sessions where id = p_duty_session_id for update;
  if v_session.id is null then raise exception 'Duty session not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_session.station_id);
  if v_session.user_id <> auth.uid() then raise exception 'Only the duty participant can end this session' using errcode = '42501'; end if;
  if v_session.status = 'ON_DUTY' then
    update public.shift_duty_sessions set status = 'ENDED', ended_at = now() where id = v_session.id returning * into v_session;
  end if;
  return v_session;
end;
$$;

create or replace function public.get_or_create_shift_handover(p_outgoing_shift_id uuid, p_incoming_shift_id uuid)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v_outgoing public.station_shifts%rowtype; v_incoming public.station_shifts%rowtype; v_handover public.shift_handovers%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into v_outgoing from public.station_shifts where id = p_outgoing_shift_id;
  select * into v_incoming from public.station_shifts where id = p_incoming_shift_id;
  if v_outgoing.id is null or v_incoming.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_outgoing.station_id);
  if v_outgoing.station_id <> v_incoming.station_id or v_incoming.scheduled_start < v_outgoing.scheduled_end then
    raise exception 'Invalid handover shift transition' using errcode = '23514';
  end if;
  if not exists (select 1 from public.shift_duty_sessions d where d.shift_id = v_outgoing.id and d.user_id = auth.uid()) then
    raise exception 'Outgoing shift duty participation is required' using errcode = '42501';
  end if;
  insert into public.shift_handovers (station_id, outgoing_shift_id, incoming_shift_id, prepared_by_user_id)
  values (v_outgoing.station_id, v_outgoing.id, v_incoming.id, auth.uid())
  on conflict (outgoing_shift_id, incoming_shift_id) do nothing;
  select * into v_handover from public.shift_handovers where outgoing_shift_id = v_outgoing.id and incoming_shift_id = v_incoming.id;
  return v_handover;
end;
$$;

create or replace function public.submit_shift_handover(p_handover_id uuid, p_outgoing_notes text default null)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_handover.station_id);
  if not exists (select 1 from public.shift_duty_sessions d where d.shift_id = v_handover.outgoing_shift_id and d.user_id = auth.uid()) then
    raise exception 'Outgoing shift duty participation is required' using errcode = '42501';
  end if;
  if v_handover.status = 'SUBMITTED' and v_handover.submitted_by_user_id = auth.uid() then return v_handover; end if;
  if v_handover.status <> 'DRAFT' then raise exception 'Handover is not available for submission' using errcode = '55000'; end if;
  update public.shift_handovers set status = 'SUBMITTED', outgoing_notes = nullif(btrim(p_outgoing_notes), ''), submitted_by_user_id = auth.uid(), submitted_at = now()
  where id = v_handover.id returning * into v_handover;
  return v_handover;
end;
$$;

create or replace function public.save_shift_handover_draft(p_handover_id uuid, p_outgoing_notes text default null, p_items jsonb default '[]'::jsonb)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype; v_item jsonb; v_source_type text; v_source_id uuid; v_description text; v_priority text;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Handover items must be an array' using errcode = '22023'; end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_handover.station_id);
  if v_handover.status <> 'DRAFT' then raise exception 'Only draft handovers can be edited' using errcode = '55000'; end if;
  if not exists (select 1 from public.shift_duty_sessions d where d.shift_id = v_handover.outgoing_shift_id and d.user_id = auth.uid()) then
    raise exception 'Outgoing shift duty participation is required' using errcode = '42501';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Each handover item must be an object' using errcode = '22023'; end if;
    v_source_type := upper(coalesce(nullif(btrim(v_item->>'source_type'), ''), ''));
    v_description := nullif(btrim(v_item->>'description'), '');
    v_priority := upper(nullif(btrim(v_item->>'priority'), ''));
    if v_source_type not in ('INTERRUPTION', 'PARAMETER_ALERT', 'LOGBOOK_ENTRY', 'OPERATIONAL_NOTE') then
      raise exception 'Invalid handover item source type' using errcode = '22023';
    end if;
    if v_priority is not null and v_priority not in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') then raise exception 'Invalid handover item priority' using errcode = '22023'; end if;
    if v_source_type = 'OPERATIONAL_NOTE' then
      if v_description is null then raise exception 'Operational note description is required' using errcode = '22023'; end if;
      v_source_id := null;
    else
      if coalesce(v_item->>'source_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Referenced handover item requires a valid source identifier' using errcode = '22023';
      end if;
      v_source_id := (v_item->>'source_id')::uuid;
    end if;
  end loop;
  delete from public.shift_handover_items where handover_id = v_handover.id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_source_type := upper(v_item->>'source_type');
    v_description := nullif(btrim(v_item->>'description'), '');
    v_priority := upper(nullif(btrim(v_item->>'priority'), ''));
    v_source_id := case when v_source_type = 'OPERATIONAL_NOTE' then null else (v_item->>'source_id')::uuid end;
    insert into public.shift_handover_items (handover_id, source_type, source_id, description, priority, created_by)
    values (v_handover.id, v_source_type, v_source_id, v_description, v_priority, auth.uid());
  end loop;
  update public.shift_handovers set outgoing_notes = nullif(btrim(p_outgoing_notes), '') where id = v_handover.id returning * into v_handover;
  return v_handover;
end;
$$;

create or replace function public.accept_shift_handover(p_handover_id uuid, p_acceptance_comments text default null)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_handover.station_id);
  if not exists (select 1 from public.shift_duty_sessions d where d.shift_id = v_handover.incoming_shift_id and d.user_id = auth.uid() and d.status = 'ON_DUTY') then
    raise exception 'Incoming shift active duty participation is required' using errcode = '42501';
  end if;
  if v_handover.status = 'ACCEPTED' and v_handover.accepted_by_user_id = auth.uid() then return v_handover; end if;
  if v_handover.status <> 'SUBMITTED' then raise exception 'Handover is not available for acceptance' using errcode = '55000'; end if;
  update public.shift_handovers set status = 'ACCEPTED', acceptance_comments = nullif(btrim(p_acceptance_comments), ''), accepted_by_user_id = auth.uid(), accepted_at = now()
  where id = v_handover.id returning * into v_handover;
  return v_handover;
end;
$$;

create or replace function public.get_current_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select s.* from public.station_shifts s where s.station_id = p_station_id and s.status <> 'CANCELLED'
    and now() >= s.scheduled_start and now() < s.scheduled_end order by s.scheduled_start desc limit 1;
end;
$$;

create or replace function public.get_my_shift_duty_session(p_shift_id uuid)
returns setof public.shift_duty_sessions language plpgsql stable security definer set search_path = public as $$
declare v_station_id uuid;
begin
  select station_id into v_station_id from public.station_shifts where id = p_shift_id;
  if v_station_id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  perform public.assert_shift_station_access(v_station_id);
  return query select d.* from public.shift_duty_sessions d where d.shift_id = p_shift_id and d.user_id = auth.uid() order by d.started_at desc limit 1;
end;
$$;

create or replace function public.get_pending_incoming_shift_handover(p_station_id uuid)
returns setof public.shift_handovers language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select h.* from public.shift_handovers h join public.station_shifts incoming on incoming.id = h.incoming_shift_id
    where h.station_id = p_station_id and h.status = 'SUBMITTED' and now() >= incoming.scheduled_start and now() <= incoming.scheduled_end
    order by h.submitted_at asc limit 1;
end;
$$;

create or replace function public.get_station_shift_attendance(p_station_id uuid, p_day date)
returns setof public.shift_duty_sessions language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select d.* from public.shift_duty_sessions d join public.station_shifts s on s.id = d.shift_id
    where d.station_id = p_station_id and s.shift_date = p_day order by s.scheduled_start, d.started_at;
end;
$$;

create or replace function public.get_station_shift_history(p_station_id uuid, p_limit integer default 50)
returns setof public.station_shifts language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select s.* from public.station_shifts s where s.station_id = p_station_id
    order by s.scheduled_start desc limit greatest(1, least(200, coalesce(p_limit, 50)));
end;
$$;

revoke all on function public.assert_shift_station_access(uuid) from public, anon, authenticated;
revoke all on function public.enforce_station_shift_no_overlap() from public, anon, authenticated;
revoke all on function public.enforce_shift_duty_session_station() from public, anon, authenticated;
revoke all on function public.enforce_shift_handover_transition() from public, anon, authenticated;
revoke all on function public.enforce_shift_handover_item_source() from public, anon, authenticated;
revoke all on function public.start_shift_duty(uuid, text), public.end_shift_duty(uuid), public.get_or_create_shift_handover(uuid, uuid), public.save_shift_handover_draft(uuid, text, jsonb), public.submit_shift_handover(uuid, text), public.accept_shift_handover(uuid, text), public.get_current_station_shift(uuid), public.get_my_shift_duty_session(uuid), public.get_pending_incoming_shift_handover(uuid), public.get_station_shift_attendance(uuid, date), public.get_station_shift_history(uuid, integer) from public, anon;
grant execute on function public.start_shift_duty(uuid, text), public.end_shift_duty(uuid), public.get_or_create_shift_handover(uuid, uuid), public.save_shift_handover_draft(uuid, text, jsonb), public.submit_shift_handover(uuid, text), public.accept_shift_handover(uuid, text), public.get_current_station_shift(uuid), public.get_my_shift_duty_session(uuid), public.get_pending_incoming_shift_handover(uuid), public.get_station_shift_attendance(uuid, date), public.get_station_shift_history(uuid, integer) to authenticated;

commit;
