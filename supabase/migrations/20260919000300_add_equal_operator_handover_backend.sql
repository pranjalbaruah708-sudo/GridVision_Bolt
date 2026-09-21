-- Equal-operator shift handover backend.
-- Additive and versioned: legacy handovers remain workflow_version = 1 and
-- continue to use the existing RPCs until the UI is migrated.

begin;

alter table public.shift_handovers
  add column if not exists workflow_version smallint not null default 1,
  add column if not exists row_version integer not null default 1,
  add column if not exists submitted_duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  add column if not exists team_accepted_duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  add column if not exists initial_finalized_at timestamptz;

alter table public.shift_handovers
  add constraint shift_handovers_workflow_version_check check (workflow_version in (1, 2)),
  add constraint shift_handovers_row_version_check check (row_version > 0),
  add constraint shift_handovers_v2_finalization_check check (
    workflow_version <> 2
    or status = 'DRAFT'
    or (
      snapshot is not null
      and initial_finalized_at is not null
      and submitted_duty_session_id is not null
    )
  ),
  add constraint shift_handovers_v2_team_acceptance_check check (
    workflow_version <> 2
    or status <> 'ACCEPTED'
    or team_accepted_duty_session_id is not null
  );

-- A version-2 shift can have only one outgoing and one incoming team handover.
-- Version-1 rows are intentionally excluded for backward compatibility.
create unique index shift_handovers_v2_outgoing_unique_idx
  on public.shift_handovers (outgoing_shift_id)
  where workflow_version = 2 and status not in ('REJECTED', 'SUPERSEDED');
create unique index shift_handovers_v2_incoming_unique_idx
  on public.shift_handovers (incoming_shift_id)
  where workflow_version = 2 and status not in ('REJECTED', 'SUPERSEDED');

create table public.shift_handover_entries (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  author_user_id uuid not null references public.app_users(id) on delete restrict,
  client_entry_id uuid,
  entry_kind text not null check (entry_kind in ('COMMENT', 'SOURCE_REFERENCE')),
  phase text not null default 'DRAFT' check (phase in ('DRAFT', 'INITIAL', 'AMENDMENT')),
  source_type text check (source_type is null or source_type in ('INTERRUPTION', 'PARAMETER_ALERT', 'LOGBOOK_ENTRY', 'OPERATIONAL_NOTE')),
  source_id uuid,
  body text,
  priority text check (priority is null or priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  replaces_entry_id uuid references public.shift_handover_entries(id) on delete restrict,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_handover_entries_content_check check (
    (entry_kind = 'COMMENT' and source_type is null and source_id is null and btrim(coalesce(body, '')) <> '')
    or
    (entry_kind = 'SOURCE_REFERENCE' and source_type in ('INTERRUPTION', 'PARAMETER_ALERT', 'LOGBOOK_ENTRY') and source_id is not null)
  ),
  constraint shift_handover_entries_finalized_check check (
    (phase = 'DRAFT' and finalized_at is null)
    or (phase in ('INITIAL', 'AMENDMENT') and finalized_at is not null)
  ),
  constraint shift_handover_entries_not_self_replacing check (replaces_entry_id is null or replaces_entry_id <> id)
);

create unique index shift_handover_entries_client_unique_idx
  on public.shift_handover_entries (handover_id, author_user_id, client_entry_id)
  where client_entry_id is not null;
create unique index shift_handover_entries_initial_source_unique_idx
  on public.shift_handover_entries (handover_id, source_type, source_id)
  where source_id is not null and phase in ('DRAFT', 'INITIAL');
create index shift_handover_entries_handover_phase_idx
  on public.shift_handover_entries (handover_id, phase, created_at, id);
create trigger shift_handover_entries_updated_at
before update on public.shift_handover_entries
for each row execute function public.update_updated_at_column();

create table public.shift_duty_handover_states (
  id uuid primary key default gen_random_uuid(),
  duty_session_id uuid not null references public.shift_duty_sessions(id) on delete restrict,
  handover_id uuid references public.shift_handovers(id) on delete restrict,
  shift_id uuid not null references public.station_shifts(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  side text not null check (side in ('OUTGOING', 'INCOMING')),
  state text not null check (state in (
    'SUBMITTED_AND_ENDED',
    'ENDED_LINKED_TO_SUBMITTED_HANDOVER',
    'ACCEPTED_AND_STARTED',
    'STARTED_WITHOUT_HANDOVER',
    'LATE_HANDOVER_REVIEW_REQUIRED',
    'LATE_HANDOVER_ACCEPTED'
  )),
  no_handover_acknowledged_at timestamptz,
  accepted_at timestamptz,
  ended_at timestamptz,
  acceptance_comments text,
  late_notification_event_id uuid references public.notification_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_duty_handover_states_session_side_unique unique (duty_session_id, side),
  constraint shift_duty_handover_states_shape_check check (
    (side = 'OUTGOING'
      and state in ('SUBMITTED_AND_ENDED', 'ENDED_LINKED_TO_SUBMITTED_HANDOVER')
      and handover_id is not null and ended_at is not null)
    or
    (side = 'INCOMING' and (
      (state = 'STARTED_WITHOUT_HANDOVER' and handover_id is null and no_handover_acknowledged_at is not null and accepted_at is null)
      or
      (state = 'LATE_HANDOVER_REVIEW_REQUIRED' and handover_id is not null and no_handover_acknowledged_at is not null and accepted_at is null)
      or
      (state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') and handover_id is not null and accepted_at is not null)
    ))
  )
);

create index shift_duty_handover_states_handover_idx
  on public.shift_duty_handover_states (handover_id, side, state);
create index shift_duty_handover_states_shift_user_idx
  on public.shift_duty_handover_states (shift_id, user_id, side);
create trigger shift_duty_handover_states_updated_at
before update on public.shift_duty_handover_states
for each row execute function public.update_updated_at_column();

create table public.shift_handover_audit_events (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid references public.shift_handovers(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  shift_id uuid references public.station_shifts(id) on delete restrict,
  duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  actor_user_id uuid references public.app_users(id) on delete set null,
  event_type text not null check (event_type in (
    'DRAFT_CREATED',
    'DRAFT_ENTRY_ADDED',
    'DRAFT_ENTRY_EDITED',
    'DRAFT_ENTRY_REMOVED',
    'HANDOVER_SUBMITTED',
    'OUTGOING_DUTY_ENDED',
    'TEAM_HANDOVER_ACCEPTED',
    'INDIVIDUAL_HANDOVER_ACCEPTED',
    'STARTED_WITHOUT_HANDOVER',
    'LATE_HANDOVER_AVAILABLE',
    'LATE_HANDOVER_ACCEPTED',
    'DUTY_END_BLOCKED_PENDING_HANDOVER',
    'AMENDMENT_ADDED'
  )),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index shift_handover_audit_events_handover_idx
  on public.shift_handover_audit_events (handover_id, occurred_at, id);
create index shift_handover_audit_events_station_idx
  on public.shift_handover_audit_events (station_id, occurred_at desc);

create table public.shift_handover_command_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete restrict,
  command_type text not null,
  idempotency_key uuid not null,
  handover_id uuid references public.shift_handovers(id) on delete restrict,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint shift_handover_command_receipts_unique unique (user_id, command_type, idempotency_key)
);
create index shift_handover_command_receipts_created_idx
  on public.shift_handover_command_receipts (created_at);

alter table public.shift_handover_entries enable row level security;
alter table public.shift_duty_handover_states enable row level security;
alter table public.shift_handover_audit_events enable row level security;
alter table public.shift_handover_command_receipts enable row level security;

create policy shift_handover_entries_read_authorized
on public.shift_handover_entries for select to authenticated
using (exists (
  select 1 from public.shift_handovers h
  join public.get_my_operational_station_ids() s on s.station_id = h.station_id
  where h.id = shift_handover_entries.handover_id
));

create policy shift_duty_handover_states_read_authorized
on public.shift_duty_handover_states for select to authenticated
using (exists (
  select 1 from public.get_my_operational_station_ids() s
  where s.station_id = shift_duty_handover_states.station_id
));

create policy shift_handover_audit_events_read_authorized
on public.shift_handover_audit_events for select to authenticated
using (exists (
  select 1 from public.get_my_operational_station_ids() s
  where s.station_id = shift_handover_audit_events.station_id
));

revoke all on table public.shift_handover_entries,
  public.shift_duty_handover_states,
  public.shift_handover_audit_events,
  public.shift_handover_command_receipts from public, anon, authenticated;
grant select on table public.shift_handover_entries,
  public.shift_duty_handover_states,
  public.shift_handover_audit_events to authenticated;

create or replace function public.enforce_equal_operator_handover_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
  v_station_id uuid;
  v_exists boolean;
begin
  if tg_op = 'DELETE' then
    select * into v_handover from public.shift_handovers where id = old.handover_id;
    if old.phase <> 'DRAFT' or v_handover.status <> 'DRAFT' then
      raise exception 'Finalized handover entries are immutable' using errcode = '55000';
    end if;
    return old;
  end if;

  select * into v_handover from public.shift_handovers where id = new.handover_id;
  if v_handover.id is null then
    raise exception 'Handover does not exist' using errcode = '23503';
  end if;
  v_station_id := v_handover.station_id;

  if tg_op = 'INSERT' then
    if new.phase = 'DRAFT' and v_handover.status <> 'DRAFT' then
      raise exception 'Draft entries require a draft handover' using errcode = '55000';
    elsif new.phase = 'INITIAL' then
      raise exception 'Initial entries may only be finalized from an existing draft' using errcode = '55000';
    elsif new.phase = 'AMENDMENT' and v_handover.status not in ('SUBMITTED', 'ACCEPTED') then
      raise exception 'Amendments require a submitted handover' using errcode = '55000';
    end if;
  else
    if old.phase <> 'DRAFT' then
      raise exception 'Finalized handover entries are immutable' using errcode = '55000';
    end if;
    if new.handover_id <> old.handover_id or new.author_user_id <> old.author_user_id
      or new.client_entry_id is distinct from old.client_entry_id then
      raise exception 'Entry ownership and identity are immutable' using errcode = '55000';
    end if;
    if new.phase = 'INITIAL' then
      if v_handover.status <> 'DRAFT'
        or new.entry_kind <> old.entry_kind
        or new.source_type is distinct from old.source_type
        or new.source_id is distinct from old.source_id
        or new.body is distinct from old.body
        or new.priority is distinct from old.priority
        or new.replaces_entry_id is distinct from old.replaces_entry_id
        or new.finalized_at is null then
        raise exception 'Invalid initial-entry finalization' using errcode = '55000';
      end if;
    elsif new.phase = 'DRAFT' then
      if v_handover.status <> 'DRAFT' then
        raise exception 'Only draft handovers can be edited' using errcode = '55000';
      end if;
    else
      raise exception 'Draft entries cannot be converted to amendments' using errcode = '55000';
    end if;
  end if;

  if new.entry_kind = 'SOURCE_REFERENCE' then
    if new.source_type = 'INTERRUPTION' then
      select exists(select 1 from public.interruptions where id = new.source_id and station_id = v_station_id) into v_exists;
    elsif new.source_type = 'PARAMETER_ALERT' then
      select exists(select 1 from public.parameter_alerts where id = new.source_id and station_id = v_station_id) into v_exists;
    elsif new.source_type = 'LOGBOOK_ENTRY' then
      select exists(select 1 from public.log_book_entries where id = new.source_id and station_id = v_station_id) into v_exists;
    else
      v_exists := false;
    end if;
    if not v_exists then
      raise exception 'Referenced handover record is not in the handover station' using errcode = '23514';
    end if;
  end if;

  if new.replaces_entry_id is not null and not exists (
    select 1 from public.shift_handover_entries e
    where e.id = new.replaces_entry_id and e.handover_id = new.handover_id and e.phase in ('INITIAL', 'AMENDMENT')
  ) then
    raise exception 'Replacement entry must belong to the same finalized handover' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_equal_operator_handover_entry_trigger
before insert or update or delete on public.shift_handover_entries
for each row execute function public.enforce_equal_operator_handover_entry();

create or replace function public.enforce_shift_duty_handover_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.shift_duty_sessions%rowtype;
  v_handover public.shift_handovers%rowtype;
begin
  select * into v_session from public.shift_duty_sessions where id = new.duty_session_id;
  if v_session.id is null
    or v_session.shift_id <> new.shift_id
    or v_session.station_id <> new.station_id
    or v_session.user_id <> new.user_id then
    raise exception 'Individual handover state must match its duty session' using errcode = '23514';
  end if;
  if new.handover_id is not null then
    select * into v_handover from public.shift_handovers where id = new.handover_id;
    if v_handover.id is null or v_handover.station_id <> new.station_id
      or (new.side = 'OUTGOING' and v_handover.outgoing_shift_id <> new.shift_id)
      or (new.side = 'INCOMING' and v_handover.incoming_shift_id <> new.shift_id) then
      raise exception 'Individual handover state does not match the handover transition' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.state = 'STARTED_WITHOUT_HANDOVER' and new.state = 'LATE_HANDOVER_REVIEW_REQUIRED' then
      null;
    elsif old.state = 'LATE_HANDOVER_REVIEW_REQUIRED' and new.state = 'LATE_HANDOVER_ACCEPTED' then
      null;
    elsif new.state = old.state
      and new.handover_id is not distinct from old.handover_id
      and new.accepted_at is not distinct from old.accepted_at
      and new.ended_at is not distinct from old.ended_at
      and new.no_handover_acknowledged_at is not distinct from old.no_handover_acknowledged_at
      and new.acceptance_comments is not distinct from old.acceptance_comments then
      null;
    else
      raise exception 'Invalid individual handover state transition' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_shift_duty_handover_state_trigger
before insert or update on public.shift_duty_handover_states
for each row execute function public.enforce_shift_duty_handover_state();

create or replace function public.prevent_shift_handover_audit_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Shift handover audit events are immutable' using errcode = '55000';
end;
$$;
create trigger prevent_shift_handover_audit_change_trigger
before update or delete on public.shift_handover_audit_events
for each row execute function public.prevent_shift_handover_audit_change();

create or replace function public.assert_equal_operator_shift_member(
  p_shift_id uuid,
  p_require_on_duty boolean default false
)
returns table(
  station_id uuid,
  duty_session_id uuid,
  duty_role text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  shift_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_user_role;
begin
  select u.role into v_role
  from public.app_users u
  where u.id = auth.uid() and u.active = true;
  if v_role is distinct from 'OPERATOR'::public.app_user_role then
    raise exception 'Only active Operators may perform shift handover actions' using errcode = '42501';
  end if;
  return query
  select s.station_id, d.id, a.duty_role, s.scheduled_start, s.scheduled_end, s.status
  from public.station_shifts s
  join public.station_shift_assignments a on a.shift_id = s.id and a.user_id = auth.uid()
  join public.get_my_operational_station_ids() scope on scope.station_id = s.station_id
  left join public.shift_duty_sessions d
    on d.shift_id = s.id and d.user_id = auth.uid() and d.status = 'ON_DUTY'
  where s.id = p_shift_id
  limit 1;
  if not found then
    raise exception 'The Operator is not rostered or authorized for this shift' using errcode = '42501';
  end if;
  if p_require_on_duty and not exists (
    select 1 from public.shift_duty_sessions d
    where d.shift_id = p_shift_id and d.user_id = auth.uid() and d.status = 'ON_DUTY'
  ) then
    raise exception 'An active duty session is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.write_shift_handover_audit_event(
  p_handover_id uuid,
  p_station_id uuid,
  p_shift_id uuid,
  p_duty_session_id uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.shift_handover_audit_events(
    handover_id, station_id, shift_id, duty_session_id, actor_user_id, event_type, details
  ) values (
    p_handover_id, p_station_id, p_shift_id, p_duty_session_id, auth.uid(), p_event_type, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.enqueue_shift_handover_notification_v2(
  p_handover_id uuid,
  p_kind text,
  p_reference_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
  v_event_id uuid;
  v_station_name text;
  v_source_operation_id text;
  v_message text;
begin
  select * into v_handover
  from public.shift_handovers h
  where h.id = p_handover_id;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  select s.name into v_station_name from public.stations s where s.id = v_handover.station_id;
  if p_kind = 'AVAILABLE' then
    v_source_operation_id := 'SHIFT_HANDOVER_AVAILABLE:' || v_handover.id::text;
    v_message := format('Shift handover is available for review at %s.', v_station_name);
  elsif p_kind = 'AMENDMENT' and p_reference_id is not null then
    v_source_operation_id := 'SHIFT_HANDOVER_AMENDMENT:' || p_reference_id::text;
    v_message := format('A shift handover amendment is available at %s.', v_station_name);
  else
    raise exception 'Unsupported handover notification kind' using errcode = '22023';
  end if;

  select e.id into v_event_id
  from public.notification_events e
  where e.source_operation_id = v_source_operation_id
  limit 1;
  if v_event_id is null then
    insert into public.notification_events(
      station_id, event_time, message, max_unit_type, created_by, source_operation_id, notification_class
    ) values (
      v_handover.station_id, now(), v_message,
      coalesce((select max_unit_type from public.notification_config where active order by updated_at desc limit 1), 'HQ'),
      auth.uid(), v_source_operation_id, 'LIVE'
    ) returning id into v_event_id;
  end if;

  insert into public.notification_recipients(notification_event_id, user_id, device_token_id, status)
  select distinct v_event_id, target.user_id, dt.id, 'PENDING'
  from (
    select a.user_id
    from public.station_shift_assignments a
    join public.app_users u on u.id = a.user_id and u.active = true and u.role = 'OPERATOR'::public.app_user_role
    where a.shift_id = v_handover.incoming_shift_id and p_kind = 'AVAILABLE'
    union
    select d.user_id
    from public.shift_duty_sessions d
    where d.shift_id = v_handover.incoming_shift_id and d.status = 'ON_DUTY'
  ) target
  join public.device_tokens dt on dt.user_id = target.user_id and dt.is_active = true
  on conflict do nothing;
  return v_event_id;
end;
$$;

create or replace function public.get_or_create_equal_operator_handover_v2(
  p_outgoing_shift_id uuid,
  p_incoming_shift_id uuid
)
returns public.shift_handovers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_incoming public.station_shifts%rowtype;
  v_handover public.shift_handovers%rowtype;
  v_created boolean := false;
begin
  select * into v_access from public.assert_equal_operator_shift_member(p_outgoing_shift_id, true);
  select * into v_incoming from public.station_shifts where id = p_incoming_shift_id;
  if v_incoming.id is null then raise exception 'Incoming shift not found' using errcode = 'P0002'; end if;
  if v_incoming.station_id <> v_access.station_id or v_incoming.scheduled_start < v_access.scheduled_end then
    raise exception 'Invalid handover shift transition' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_outgoing_shift_id::text || ':' || p_incoming_shift_id::text, 0));
  select * into v_handover
  from public.shift_handovers
  where outgoing_shift_id = p_outgoing_shift_id and incoming_shift_id = p_incoming_shift_id
  for update;
  if v_handover.id is null then
    insert into public.shift_handovers(
      station_id, outgoing_shift_id, incoming_shift_id, prepared_by_user_id, workflow_version
    ) values (
      v_access.station_id, p_outgoing_shift_id, p_incoming_shift_id, auth.uid(), 2
    ) returning * into v_handover;
    v_created := true;
  elsif v_handover.status = 'DRAFT' and v_handover.workflow_version = 1 then
    update public.shift_handovers
    set workflow_version = 2, row_version = row_version + 1
    where id = v_handover.id
    returning * into v_handover;
  end if;
  if v_created then
    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, p_outgoing_shift_id,
      v_access.duty_session_id, 'DRAFT_CREATED',
      jsonb_build_object('incoming_shift_id', p_incoming_shift_id, 'workflow_version', 2)
    );
  end if;
  return v_handover;
end;
$$;

create or replace function public.save_equal_operator_handover_entry_v2(
  p_handover_id uuid,
  p_entry_id uuid,
  p_client_entry_id uuid,
  p_entry_kind text,
  p_source_type text default null,
  p_source_id uuid default null,
  p_body text default null,
  p_priority text default null,
  p_expected_handover_version integer default null
)
returns public.shift_handover_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
  v_access record;
  v_entry public.shift_handover_entries%rowtype;
  v_event text;
begin
  if p_client_entry_id is null then raise exception 'A client entry identifier is required' using errcode = '22023'; end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  select * into v_access from public.assert_equal_operator_shift_member(v_handover.outgoing_shift_id, true);

  select * into v_entry from public.shift_handover_entries
  where handover_id = p_handover_id and author_user_id = auth.uid() and client_entry_id = p_client_entry_id;
  if v_entry.id is not null and (p_entry_id is null or p_entry_id = v_entry.id) then return v_entry; end if;
  if v_handover.status <> 'DRAFT' then raise exception 'Only draft handovers can be edited' using errcode = '55000'; end if;
  if p_expected_handover_version is not null and p_expected_handover_version <> v_handover.row_version then
    raise exception 'The common handover draft has changed; reload it before saving' using errcode = '40001';
  end if;

  if p_entry_id is null then
    insert into public.shift_handover_entries(
      handover_id, author_user_id, client_entry_id, entry_kind, phase,
      source_type, source_id, body, priority
    ) values (
      p_handover_id, auth.uid(), p_client_entry_id, upper(p_entry_kind), 'DRAFT',
      nullif(upper(coalesce(p_source_type, '')), ''), p_source_id,
      nullif(btrim(coalesce(p_body, '')), ''), nullif(upper(coalesce(p_priority, '')), '')
    ) returning * into v_entry;
    v_event := 'DRAFT_ENTRY_ADDED';
  else
    select * into v_entry from public.shift_handover_entries where id = p_entry_id for update;
    if v_entry.id is null then raise exception 'Draft entry not found' using errcode = 'P0002'; end if;
    if v_entry.handover_id <> p_handover_id or v_entry.author_user_id <> auth.uid() or v_entry.phase <> 'DRAFT' then
      raise exception 'Only the author may edit their draft entry' using errcode = '42501';
    end if;
    update public.shift_handover_entries
    set entry_kind = upper(p_entry_kind),
        source_type = nullif(upper(coalesce(p_source_type, '')), ''),
        source_id = p_source_id,
        body = nullif(btrim(coalesce(p_body, '')), ''),
        priority = nullif(upper(coalesce(p_priority, '')), '')
    where id = v_entry.id returning * into v_entry;
    v_event := 'DRAFT_ENTRY_EDITED';
  end if;
  update public.shift_handovers set row_version = row_version + 1 where id = p_handover_id;
  perform public.write_shift_handover_audit_event(
    p_handover_id, v_handover.station_id, v_handover.outgoing_shift_id,
    v_access.duty_session_id, v_event,
    jsonb_build_object('entry_id', v_entry.id, 'entry_kind', v_entry.entry_kind)
  );
  return v_entry;
end;
$$;

create or replace function public.delete_equal_operator_handover_entry_v2(
  p_handover_id uuid,
  p_entry_id uuid,
  p_idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
  v_access record;
  v_entry public.shift_handover_entries%rowtype;
  v_result jsonb;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':DELETE_DRAFT_ENTRY:' || p_idempotency_key::text, 0));
  select response_payload into v_result from public.shift_handover_command_receipts
  where user_id = auth.uid() and command_type = 'DELETE_DRAFT_ENTRY' and idempotency_key = p_idempotency_key;
  if v_result is not null then return coalesce((v_result->>'deleted')::boolean, true); end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  select * into v_access from public.assert_equal_operator_shift_member(v_handover.outgoing_shift_id, true);
  select * into v_entry from public.shift_handover_entries where id = p_entry_id for update;
  if v_entry.id is null or v_entry.handover_id <> p_handover_id then raise exception 'Draft entry not found' using errcode = 'P0002'; end if;
  if v_entry.author_user_id <> auth.uid() or v_entry.phase <> 'DRAFT' then
    raise exception 'Only the author may remove their draft entry' using errcode = '42501';
  end if;
  delete from public.shift_handover_entries where id = v_entry.id;
  update public.shift_handovers set row_version = row_version + 1 where id = p_handover_id;
  perform public.write_shift_handover_audit_event(
    p_handover_id, v_handover.station_id, v_handover.outgoing_shift_id,
    v_access.duty_session_id, 'DRAFT_ENTRY_REMOVED', jsonb_build_object('entry_id', p_entry_id)
  );
  v_result := jsonb_build_object('deleted', true);
  insert into public.shift_handover_command_receipts(user_id, command_type, idempotency_key, handover_id, response_payload)
  values(auth.uid(), 'DELETE_DRAFT_ENTRY', p_idempotency_key, p_handover_id, v_result);
  return true;
end;
$$;

create or replace function public.end_duty_and_handover_shift_v2(
  p_duty_session_id uuid,
  p_incoming_shift_id uuid,
  p_idempotency_key uuid,
  p_final_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.shift_duty_sessions%rowtype;
  v_outgoing public.station_shifts%rowtype;
  v_incoming public.station_shifts%rowtype;
  v_handover public.shift_handovers%rowtype;
  v_state public.shift_duty_handover_states%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_first_submission boolean := false;
  v_entry_id uuid;
  v_notification_event_id uuid;
  v_snapshot jsonb;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':END_AND_HANDOVER:' || p_idempotency_key::text, 0));
  select response_payload into v_result from public.shift_handover_command_receipts
  where user_id = auth.uid() and command_type = 'END_AND_HANDOVER' and idempotency_key = p_idempotency_key;
  if v_result is not null then return v_result; end if;

  select * into v_session from public.shift_duty_sessions where id = p_duty_session_id for update;
  if v_session.id is null then raise exception 'Duty session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> auth.uid() or v_session.status <> 'ON_DUTY' then
    raise exception 'Only the on-duty Operator may complete this duty session' using errcode = '42501';
  end if;
  perform public.assert_equal_operator_shift_member(v_session.shift_id, true);
  select * into v_outgoing from public.station_shifts where id = v_session.shift_id;
  select * into v_incoming from public.station_shifts where id = p_incoming_shift_id;
  if v_incoming.id is null then raise exception 'Incoming shift not found' using errcode = 'P0002'; end if;
  if v_incoming.station_id <> v_outgoing.station_id or v_incoming.scheduled_start < v_outgoing.scheduled_end then
    raise exception 'Invalid handover shift transition' using errcode = '23514';
  end if;

  -- A duty session that received a handover cannot finish until this Operator
  -- has individually accepted it, even when the team status is ACCEPTED.
  if exists (
    select 1
    from public.shift_handovers h
    where h.incoming_shift_id = v_session.shift_id
      and h.status in ('SUBMITTED', 'ACCEPTED')
      and not exists (
        select 1 from public.shift_duty_handover_states individual
        where individual.duty_session_id = v_session.id
          and individual.side = 'INCOMING'
          and individual.handover_id = h.id
          and individual.state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED')
      )
  ) then
    perform public.write_shift_handover_audit_event(
      null, v_session.station_id, v_session.shift_id, v_session.id,
      'DUTY_END_BLOCKED_PENDING_HANDOVER', '{}'::jsonb
    );
    raise exception 'The available handover must be individually accepted before ending duty' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_outgoing.id::text || ':' || v_incoming.id::text, 0));
  select * into v_handover
  from public.shift_handovers
  where outgoing_shift_id = v_outgoing.id and incoming_shift_id = v_incoming.id
  for update;
  if v_handover.id is null then
    insert into public.shift_handovers(
      station_id, outgoing_shift_id, incoming_shift_id, prepared_by_user_id, workflow_version
    ) values (
      v_outgoing.station_id, v_outgoing.id, v_incoming.id, auth.uid(), 2
    ) returning * into v_handover;
    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, v_outgoing.id, v_session.id,
      'DRAFT_CREATED', jsonb_build_object('incoming_shift_id', v_incoming.id, 'workflow_version', 2)
    );
  elsif v_handover.status = 'DRAFT' and v_handover.workflow_version = 1 then
    update public.shift_handovers
    set workflow_version = 2, row_version = row_version + 1
    where id = v_handover.id returning * into v_handover;
  end if;

  if nullif(btrim(coalesce(p_final_comment, '')), '') is not null then
    if v_handover.status = 'DRAFT' then
      insert into public.shift_handover_entries(
        handover_id, author_user_id, client_entry_id, entry_kind, phase, body
      ) values (
        v_handover.id, auth.uid(), p_idempotency_key, 'COMMENT', 'DRAFT', btrim(p_final_comment)
      ) on conflict (handover_id, author_user_id, client_entry_id) where client_entry_id is not null do nothing
      returning id into v_entry_id;
    elsif v_handover.status in ('SUBMITTED', 'ACCEPTED') then
      insert into public.shift_handover_entries(
        handover_id, author_user_id, client_entry_id, entry_kind, phase, body, finalized_at
      ) values (
        v_handover.id, auth.uid(), p_idempotency_key, 'COMMENT', 'AMENDMENT', btrim(p_final_comment), v_now
      ) on conflict (handover_id, author_user_id, client_entry_id) where client_entry_id is not null do nothing
      returning id into v_entry_id;
      if v_entry_id is not null then
        perform public.write_shift_handover_audit_event(
          v_handover.id, v_handover.station_id, v_outgoing.id, v_session.id,
          'AMENDMENT_ADDED', jsonb_build_object('entry_id', v_entry_id)
        );
        perform public.enqueue_shift_handover_notification_v2(v_handover.id, 'AMENDMENT', v_entry_id);
      end if;
    else
      raise exception 'Handover is not available for completion' using errcode = '55000';
    end if;
  end if;

  if v_handover.status = 'DRAFT' then
    update public.shift_handover_entries
    set phase = 'INITIAL', finalized_at = v_now
    where handover_id = v_handover.id and phase = 'DRAFT';

    select jsonb_build_object(
      'workflow_version', 2,
      'handover_id', v_handover.id,
      'station_id', v_handover.station_id,
      'outgoing_shift_id', v_handover.outgoing_shift_id,
      'incoming_shift_id', v_handover.incoming_shift_id,
      'submitted_by_user_id', auth.uid(),
      'submitted_at', v_now,
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'author_user_id', e.author_user_id, 'entry_kind', e.entry_kind,
          'source_type', e.source_type, 'source_id', e.source_id, 'body', e.body,
          'priority', e.priority, 'created_at', e.created_at, 'finalized_at', e.finalized_at
        ) order by e.created_at, e.id)
        from public.shift_handover_entries e
        where e.handover_id = v_handover.id and e.phase = 'INITIAL'
      ), '[]'::jsonb),
      'legacy_items', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.created_at, item.id)
        from public.shift_handover_items item where item.handover_id = v_handover.id
      ), '[]'::jsonb)
    ) into v_snapshot;

    update public.shift_handovers
    set workflow_version = 2,
        status = 'SUBMITTED',
        submitted_by_user_id = auth.uid(),
        submitted_at = v_now,
        submitted_duty_session_id = v_session.id,
        initial_finalized_at = v_now,
        snapshot = v_snapshot,
        outgoing_notes = coalesce(nullif(btrim(coalesce(p_final_comment, '')), ''), outgoing_notes),
        row_version = row_version + 1
    where id = v_handover.id
    returning * into v_handover;
    v_first_submission := true;

    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, v_outgoing.id, v_session.id,
      'HANDOVER_SUBMITTED', jsonb_build_object('snapshot_entry_count', jsonb_array_length(v_snapshot->'entries'))
    );

    insert into public.shift_duty_handover_states(
      duty_session_id, handover_id, shift_id, station_id, user_id, side, state,
      no_handover_acknowledged_at
    )
    select d.id, v_handover.id, d.shift_id, d.station_id, d.user_id, 'INCOMING',
      'LATE_HANDOVER_REVIEW_REQUIRED', coalesce(existing.no_handover_acknowledged_at, d.started_at)
    from public.shift_duty_sessions d
    left join public.shift_duty_handover_states existing
      on existing.duty_session_id = d.id and existing.side = 'INCOMING'
    where d.shift_id = v_handover.incoming_shift_id and d.status = 'ON_DUTY'
    on conflict (duty_session_id, side) do update
    set handover_id = excluded.handover_id,
        state = 'LATE_HANDOVER_REVIEW_REQUIRED',
        no_handover_acknowledged_at = coalesce(
          public.shift_duty_handover_states.no_handover_acknowledged_at,
          excluded.no_handover_acknowledged_at
        )
    where public.shift_duty_handover_states.state = 'STARTED_WITHOUT_HANDOVER';

    v_notification_event_id := public.enqueue_shift_handover_notification_v2(v_handover.id, 'AVAILABLE', null);
    update public.shift_duty_handover_states
    set late_notification_event_id = v_notification_event_id
    where handover_id = v_handover.id and side = 'INCOMING' and state = 'LATE_HANDOVER_REVIEW_REQUIRED';
    if exists (
      select 1 from public.shift_duty_handover_states
      where handover_id = v_handover.id and side = 'INCOMING' and state = 'LATE_HANDOVER_REVIEW_REQUIRED'
    ) then
      perform public.write_shift_handover_audit_event(
        v_handover.id, v_handover.station_id, v_handover.incoming_shift_id, null,
        'LATE_HANDOVER_AVAILABLE', jsonb_build_object('notification_event_id', v_notification_event_id)
      );
    end if;
  elsif v_handover.status not in ('SUBMITTED', 'ACCEPTED') then
    raise exception 'Handover is not available for duty completion' using errcode = '55000';
  end if;

  update public.shift_duty_sessions
  set status = 'ENDED', ended_at = v_now
  where id = v_session.id returning * into v_session;
  insert into public.shift_duty_handover_states(
    duty_session_id, handover_id, shift_id, station_id, user_id, side, state, ended_at
  ) values (
    v_session.id, v_handover.id, v_session.shift_id, v_session.station_id, auth.uid(), 'OUTGOING',
    case when v_first_submission then 'SUBMITTED_AND_ENDED' else 'ENDED_LINKED_TO_SUBMITTED_HANDOVER' end,
    v_now
  ) returning * into v_state;
  perform public.write_shift_handover_audit_event(
    v_handover.id, v_handover.station_id, v_outgoing.id, v_session.id,
    'OUTGOING_DUTY_ENDED', jsonb_build_object('individual_state', v_state.state)
  );

  v_result := jsonb_build_object(
    'handover', to_jsonb(v_handover),
    'duty_session', to_jsonb(v_session),
    'individual_state', to_jsonb(v_state),
    'official_submission', v_first_submission
  );
  insert into public.shift_handover_command_receipts(user_id, command_type, idempotency_key, handover_id, response_payload)
  values(auth.uid(), 'END_AND_HANDOVER', p_idempotency_key, v_handover.id, v_result);
  return v_result;
end;
$$;

create or replace function public.review_handover_and_start_duty_v2(
  p_shift_id uuid,
  p_handover_id uuid,
  p_acknowledge_no_handover boolean,
  p_acceptance_comments text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_shift public.station_shifts%rowtype;
  v_handover public.shift_handovers%rowtype;
  v_session public.shift_duty_sessions%rowtype;
  v_existing_state public.shift_duty_handover_states%rowtype;
  v_state public.shift_duty_handover_states%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_team_first boolean := false;
  v_was_existing_session boolean := false;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':REVIEW_AND_START:' || p_idempotency_key::text, 0));
  select response_payload into v_result from public.shift_handover_command_receipts
  where user_id = auth.uid() and command_type = 'REVIEW_AND_START' and idempotency_key = p_idempotency_key;
  if v_result is not null then return v_result; end if;

  select * into v_access from public.assert_equal_operator_shift_member(p_shift_id, false);
  select * into v_shift from public.station_shifts where id = p_shift_id for update;
  if v_shift.status = 'CANCELLED' or now() < v_shift.scheduled_start or now() >= v_shift.scheduled_end then
    raise exception 'Shift is not available for duty start' using errcode = 'P0001';
  end if;

  if p_handover_id is not null then
    select * into v_handover from public.shift_handovers
    where id = p_handover_id and incoming_shift_id = p_shift_id for update;
  else
    select * into v_handover from public.shift_handovers
    where incoming_shift_id = p_shift_id and status in ('SUBMITTED', 'ACCEPTED')
    order by workflow_version desc, submitted_at desc nulls last limit 1 for update;
  end if;
  if p_handover_id is not null and v_handover.id is null then
    raise exception 'The selected handover is not available for this incoming shift' using errcode = 'P0002';
  end if;
  if v_handover.id is not null and v_handover.status not in ('SUBMITTED', 'ACCEPTED') then
    raise exception 'The handover is not available for acceptance' using errcode = '55000';
  end if;

  select * into v_session from public.shift_duty_sessions
  where shift_id = p_shift_id and user_id = auth.uid() and status = 'ON_DUTY' for update;
  v_was_existing_session := v_session.id is not null;
  if v_session.id is null then
    insert into public.shift_duty_sessions(shift_id, station_id, user_id, shift_role)
    values(p_shift_id, v_shift.station_id, auth.uid(), v_access.duty_role)
    returning * into v_session;
    if v_shift.status = 'SCHEDULED' then update public.station_shifts set status = 'ACTIVE' where id = p_shift_id; end if;
  end if;

  select * into v_existing_state from public.shift_duty_handover_states
  where duty_session_id = v_session.id and side = 'INCOMING' for update;

  if v_handover.id is null then
    if not coalesce(p_acknowledge_no_handover, false) then
      raise exception 'No handover is available; explicit acknowledgement is required' using errcode = '22023';
    end if;
    if v_existing_state.id is null then
      insert into public.shift_duty_handover_states(
        duty_session_id, handover_id, shift_id, station_id, user_id, side, state,
        no_handover_acknowledged_at
      ) values (
        v_session.id, null, p_shift_id, v_shift.station_id, auth.uid(), 'INCOMING',
        'STARTED_WITHOUT_HANDOVER', v_now
      ) returning * into v_state;
      perform public.write_shift_handover_audit_event(
        null, v_shift.station_id, p_shift_id, v_session.id,
        'STARTED_WITHOUT_HANDOVER', jsonb_build_object('acknowledgement', 'No handover received')
      );
    elsif v_existing_state.state = 'STARTED_WITHOUT_HANDOVER' then
      v_state := v_existing_state;
    else
      raise exception 'The duty session already has a handover state' using errcode = '55000';
    end if;
  else
    if v_existing_state.id is null then
      insert into public.shift_duty_handover_states(
        duty_session_id, handover_id, shift_id, station_id, user_id, side, state,
        accepted_at, acceptance_comments
      ) values (
        v_session.id, v_handover.id, p_shift_id, v_shift.station_id, auth.uid(), 'INCOMING',
        'ACCEPTED_AND_STARTED', v_now, nullif(btrim(coalesce(p_acceptance_comments, '')), '')
      ) returning * into v_state;
    elsif v_existing_state.state = 'LATE_HANDOVER_REVIEW_REQUIRED' and v_existing_state.handover_id = v_handover.id then
      update public.shift_duty_handover_states
      set state = 'LATE_HANDOVER_ACCEPTED', accepted_at = v_now,
          acceptance_comments = nullif(btrim(coalesce(p_acceptance_comments, '')), '')
      where id = v_existing_state.id returning * into v_state;
    elsif v_existing_state.state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED')
      and v_existing_state.handover_id = v_handover.id then
      v_state := v_existing_state;
    else
      raise exception 'The duty session has an incompatible handover state' using errcode = '55000';
    end if;

    if v_handover.status = 'SUBMITTED' then
      update public.shift_handovers
      set status = 'ACCEPTED', accepted_by_user_id = auth.uid(), accepted_at = v_now,
          acceptance_comments = nullif(btrim(coalesce(p_acceptance_comments, '')), ''),
          team_accepted_duty_session_id = v_session.id
      where id = v_handover.id returning * into v_handover;
      v_team_first := true;
      perform public.write_shift_handover_audit_event(
        v_handover.id, v_handover.station_id, p_shift_id, v_session.id,
        'TEAM_HANDOVER_ACCEPTED', '{}'::jsonb
      );
    end if;
    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, p_shift_id, v_session.id,
      case when v_state.state = 'LATE_HANDOVER_ACCEPTED' then 'LATE_HANDOVER_ACCEPTED' else 'INDIVIDUAL_HANDOVER_ACCEPTED' end,
      jsonb_build_object('individual_state', v_state.state, 'team_first_acceptance', v_team_first)
    );
  end if;

  v_result := jsonb_build_object(
    'handover', case when v_handover.id is null then null else to_jsonb(v_handover) end,
    'duty_session', to_jsonb(v_session),
    'individual_state', to_jsonb(v_state),
    'team_first_acceptance', v_team_first,
    'existing_duty_session', v_was_existing_session
  );
  insert into public.shift_handover_command_receipts(user_id, command_type, idempotency_key, handover_id, response_payload)
  values(auth.uid(), 'REVIEW_AND_START', p_idempotency_key, v_handover.id, v_result);
  return v_result;
end;
$$;

create or replace function public.accept_late_shift_handover_v2(
  p_duty_session_id uuid,
  p_handover_id uuid,
  p_acceptance_comments text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.shift_duty_sessions%rowtype;
  v_handover public.shift_handovers%rowtype;
  v_state public.shift_duty_handover_states%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_team_first boolean := false;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':ACCEPT_LATE_HANDOVER:' || p_idempotency_key::text, 0));
  select response_payload into v_result from public.shift_handover_command_receipts
  where user_id = auth.uid() and command_type = 'ACCEPT_LATE_HANDOVER' and idempotency_key = p_idempotency_key;
  if v_result is not null then return v_result; end if;
  select * into v_session from public.shift_duty_sessions where id = p_duty_session_id for update;
  if v_session.id is null or v_session.user_id <> auth.uid() or v_session.status <> 'ON_DUTY' then
    raise exception 'An active personal duty session is required' using errcode = '42501';
  end if;
  perform public.assert_equal_operator_shift_member(v_session.shift_id, true);
  select * into v_handover from public.shift_handovers
  where id = p_handover_id and incoming_shift_id = v_session.shift_id for update;
  if v_handover.id is null or v_handover.status not in ('SUBMITTED', 'ACCEPTED') then
    raise exception 'Late handover is not available' using errcode = '55000';
  end if;
  select * into v_state from public.shift_duty_handover_states
  where duty_session_id = v_session.id and side = 'INCOMING' for update;
  if v_state.id is null or v_state.handover_id <> v_handover.id
    or v_state.state <> 'LATE_HANDOVER_REVIEW_REQUIRED' then
    raise exception 'No late handover acceptance is pending for this Operator' using errcode = '55000';
  end if;
  update public.shift_duty_handover_states
  set state = 'LATE_HANDOVER_ACCEPTED', accepted_at = v_now,
      acceptance_comments = nullif(btrim(coalesce(p_acceptance_comments, '')), '')
  where id = v_state.id returning * into v_state;
  if v_handover.status = 'SUBMITTED' then
    update public.shift_handovers
    set status = 'ACCEPTED', accepted_by_user_id = auth.uid(), accepted_at = v_now,
        acceptance_comments = nullif(btrim(coalesce(p_acceptance_comments, '')), ''),
        team_accepted_duty_session_id = v_session.id
    where id = v_handover.id returning * into v_handover;
    v_team_first := true;
    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, v_session.shift_id, v_session.id,
      'TEAM_HANDOVER_ACCEPTED', jsonb_build_object('late_handover', true)
    );
  end if;
  perform public.write_shift_handover_audit_event(
    v_handover.id, v_handover.station_id, v_session.shift_id, v_session.id,
    'LATE_HANDOVER_ACCEPTED', jsonb_build_object('team_first_acceptance', v_team_first)
  );
  v_result := jsonb_build_object(
    'handover', to_jsonb(v_handover), 'duty_session', to_jsonb(v_session),
    'individual_state', to_jsonb(v_state), 'team_first_acceptance', v_team_first
  );
  insert into public.shift_handover_command_receipts(user_id, command_type, idempotency_key, handover_id, response_payload)
  values(auth.uid(), 'ACCEPT_LATE_HANDOVER', p_idempotency_key, v_handover.id, v_result);
  return v_result;
end;
$$;

create or replace function public.add_shift_handover_amendment_v2(
  p_handover_id uuid,
  p_body text,
  p_replaces_entry_id uuid,
  p_client_entry_id uuid
)
returns public.shift_handover_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
  v_access record;
  v_entry public.shift_handover_entries%rowtype;
begin
  if p_client_entry_id is null then raise exception 'A client entry identifier is required' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Amendment text is required' using errcode = '22023'; end if;
  select * into v_handover from public.shift_handovers where id = p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  select * into v_access from public.assert_equal_operator_shift_member(v_handover.outgoing_shift_id, false);
  select * into v_entry from public.shift_handover_entries
  where handover_id = p_handover_id and author_user_id = auth.uid() and client_entry_id = p_client_entry_id;
  if v_entry.id is not null then return v_entry; end if;
  if v_handover.status not in ('SUBMITTED', 'ACCEPTED') then
    raise exception 'Amendments require a submitted handover' using errcode = '55000';
  end if;
  insert into public.shift_handover_entries(
    handover_id, author_user_id, client_entry_id, entry_kind, phase, body, replaces_entry_id, finalized_at
  ) values (
    p_handover_id, auth.uid(), p_client_entry_id, 'COMMENT', 'AMENDMENT', btrim(p_body), p_replaces_entry_id, now()
  ) returning * into v_entry;
  perform public.write_shift_handover_audit_event(
    p_handover_id, v_handover.station_id, v_handover.outgoing_shift_id,
    v_access.duty_session_id, 'AMENDMENT_ADDED',
    jsonb_build_object('entry_id', v_entry.id, 'replaces_entry_id', p_replaces_entry_id)
  );
  perform public.enqueue_shift_handover_notification_v2(p_handover_id, 'AMENDMENT', v_entry.id);
  return v_entry;
end;
$$;

create or replace function public.get_equal_operator_handover_v2(p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_handover public.shift_handovers%rowtype;
begin
  select * into v_handover from public.shift_handovers where id = p_handover_id;
  if v_handover.id is null then raise exception 'Handover not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.get_my_operational_station_ids() s where s.station_id = v_handover.station_id
  ) then raise exception 'Station access is not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'handover', to_jsonb(v_handover),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at, e.id)
      from public.shift_handover_entries e where e.handover_id = p_handover_id
    ), '[]'::jsonb),
    'individual_states', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.side, s.created_at, s.id)
      from public.shift_duty_handover_states s where s.handover_id = p_handover_id
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.occurred_at, a.id)
      from public.shift_handover_audit_events a where a.handover_id = p_handover_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_shift_handover_acceptance_oversight_v2(
  p_station_id uuid default null,
  p_from date default current_date - 7,
  p_to date default current_date + 7,
  p_limit integer default 500
)
returns table(
  handover_id uuid,
  station_id uuid,
  station_name text,
  outgoing_shift_id uuid,
  outgoing_shift_name text,
  incoming_shift_id uuid,
  incoming_shift_name text,
  team_status text,
  operator_id uuid,
  operator_name text,
  duty_session_id uuid,
  duty_started_at timestamptz,
  duty_ended_at timestamptz,
  individual_state text,
  individually_accepted_at timestamptz,
  acceptance_comments text,
  attention_state text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role public.app_user_role;
begin
  select u.role into v_role from public.app_users u where u.id = auth.uid() and u.active = true;
  if v_role not in ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role) then
    raise exception 'Shift handover oversight is restricted to supervisors' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Invalid oversight date range' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Invalid oversight result limit' using errcode = '22023';
  end if;
  if p_station_id is not null and not exists (
    select 1 from public.get_my_operational_station_ids() scoped where scoped.station_id = p_station_id
  ) then raise exception 'Station access is not authorized' using errcode = '42501'; end if;

  return query
  select h.id, h.station_id, station.name,
    outgoing.id, outgoing.shift_name, incoming.id, incoming.shift_name, h.status,
    roster.user_id, operator.full_name, duty.id, duty.started_at, duty.ended_at,
    state.state, state.accepted_at, state.acceptance_comments,
    case
      when state.state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') then 'ACCEPTED'
      when state.state = 'LATE_HANDOVER_REVIEW_REQUIRED' then 'LATE_PENDING'
      when duty.status = 'ENDED' and coalesce(state.state, '') not in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') then 'MISSED'
      when duty.status = 'ON_DUTY' and state.id is null then 'PENDING'
      when state.state = 'STARTED_WITHOUT_HANDOVER' then 'STARTED_WITHOUT_HANDOVER'
      else 'NOT_STARTED'
    end
  from public.shift_handovers h
  join public.station_shifts outgoing on outgoing.id = h.outgoing_shift_id
  join public.station_shifts incoming on incoming.id = h.incoming_shift_id
  join public.stations station on station.id = h.station_id
  join public.get_my_operational_station_ids() scoped on scoped.station_id = h.station_id
  join public.station_shift_assignments roster on roster.shift_id = incoming.id
  join public.app_users operator on operator.id = roster.user_id and operator.active = true and operator.role = 'OPERATOR'::public.app_user_role
  left join lateral (
    select d.* from public.shift_duty_sessions d
    where d.shift_id = incoming.id and d.user_id = roster.user_id
    order by d.started_at desc, d.id desc limit 1
  ) duty on true
  left join public.shift_duty_handover_states state
    on state.duty_session_id = duty.id and state.side = 'INCOMING' and state.handover_id = h.id
  where h.workflow_version = 2
    and h.status in ('SUBMITTED', 'ACCEPTED')
    and incoming.shift_date between p_from and p_to
    and (p_station_id is null or h.station_id = p_station_id)
  order by incoming.scheduled_start desc, station.name, operator.full_name
  limit p_limit;
end;
$$;

revoke all on function public.enforce_equal_operator_handover_entry() from public, anon, authenticated;
revoke all on function public.enforce_shift_duty_handover_state() from public, anon, authenticated;
revoke all on function public.prevent_shift_handover_audit_change() from public, anon, authenticated;
revoke all on function public.assert_equal_operator_shift_member(uuid, boolean) from public, anon, authenticated;
revoke all on function public.write_shift_handover_audit_event(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_shift_handover_notification_v2(uuid, text, uuid) from public, anon, authenticated;

revoke all on function public.get_or_create_equal_operator_handover_v2(uuid, uuid) from public, anon;
revoke all on function public.save_equal_operator_handover_entry_v2(uuid, uuid, uuid, text, text, uuid, text, text, integer) from public, anon;
revoke all on function public.delete_equal_operator_handover_entry_v2(uuid, uuid, uuid) from public, anon;
revoke all on function public.end_duty_and_handover_shift_v2(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.review_handover_and_start_duty_v2(uuid, uuid, boolean, text, uuid) from public, anon;
revoke all on function public.accept_late_shift_handover_v2(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.add_shift_handover_amendment_v2(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.get_equal_operator_handover_v2(uuid) from public, anon;
revoke all on function public.get_shift_handover_acceptance_oversight_v2(uuid, date, date, integer) from public, anon;

grant execute on function public.get_or_create_equal_operator_handover_v2(uuid, uuid) to authenticated;
grant execute on function public.save_equal_operator_handover_entry_v2(uuid, uuid, uuid, text, text, uuid, text, text, integer) to authenticated;
grant execute on function public.delete_equal_operator_handover_entry_v2(uuid, uuid, uuid) to authenticated;
grant execute on function public.end_duty_and_handover_shift_v2(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.review_handover_and_start_duty_v2(uuid, uuid, boolean, text, uuid) to authenticated;
grant execute on function public.accept_late_shift_handover_v2(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.add_shift_handover_amendment_v2(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.get_equal_operator_handover_v2(uuid) to authenticated;
grant execute on function public.get_shift_handover_acceptance_oversight_v2(uuid, date, date, integer) to authenticated;

commit;
