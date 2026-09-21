-- Version-2 handovers are released to the incoming shift only after the last
-- active outgoing duty session ends. Legacy workflow_version = 1 is untouched.
begin;

alter table public.shift_handovers
  add column if not exists provisional_at timestamptz,
  add column if not exists provisional_by_user_id uuid references public.app_users(id) on delete restrict,
  add column if not exists provisional_duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  add column if not exists final_released_at timestamptz,
  add column if not exists final_released_by_user_id uuid references public.app_users(id) on delete restrict,
  add column if not exists final_released_duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  add column if not exists first_incoming_duty_started_at timestamptz;

-- Existing V2 final records were already released before this additive model.
-- The pre-V2-release trigger treats every accepted row as wholly immutable.
-- Disable only that trigger while backfilling the additive release projection;
-- the transaction reenables it before any new lifecycle logic is installed.
alter table public.shift_handovers disable trigger enforce_shift_handover_transition_trigger;
update public.shift_handovers
set final_released_at = coalesce(final_released_at, submitted_at),
    final_released_by_user_id = coalesce(final_released_by_user_id, submitted_by_user_id),
    final_released_duty_session_id = coalesce(final_released_duty_session_id, submitted_duty_session_id)
where workflow_version = 2
  and status in ('SUBMITTED', 'ACCEPTED');
alter table public.shift_handovers enable trigger enforce_shift_handover_transition_trigger;

alter table public.shift_handovers
  drop constraint if exists shift_handovers_status_check,
  drop constraint if exists shift_handovers_submitted_fields_check,
  drop constraint if exists shift_handovers_v2_finalization_check,
  drop constraint if exists shift_handovers_v2_team_acceptance_check;

alter table public.shift_handovers
  add constraint shift_handovers_status_check check (status in ('DRAFT','PROVISIONAL','SUBMITTED','ACCEPTED','REJECTED','SUPERSEDED')),
  add constraint shift_handovers_submitted_fields_check check (
    (workflow_version = 1 and (
      (status = 'DRAFT' and submitted_by_user_id is null and submitted_at is null and accepted_by_user_id is null and accepted_at is null)
      or (status in ('SUBMITTED', 'REJECTED', 'SUPERSEDED') and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is null and accepted_at is null)
      or (status = 'ACCEPTED' and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is not null and accepted_at is not null)
    ))
    or (workflow_version = 2 and (
      (status = 'DRAFT' and submitted_by_user_id is null and submitted_at is null and accepted_by_user_id is null and accepted_at is null)
      or (status = 'PROVISIONAL' and submitted_by_user_id is null and submitted_at is null and accepted_by_user_id is null and accepted_at is null)
      or (status = 'SUBMITTED' and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is null and accepted_at is null)
      or (status = 'ACCEPTED' and submitted_by_user_id is not null and submitted_at is not null and accepted_by_user_id is not null and accepted_at is not null)
    ))
  ),
  add constraint shift_handovers_v2_finalization_check check (
    workflow_version <> 2
    or status = 'DRAFT'
    or (snapshot is not null and initial_finalized_at is not null)
  ),
  add constraint shift_handovers_v2_provisional_check check (
    workflow_version <> 2
    or status <> 'PROVISIONAL'
    or (provisional_at is not null and provisional_by_user_id is not null and provisional_duty_session_id is not null
        and final_released_at is null and final_released_by_user_id is null and final_released_duty_session_id is null)
  ),
  add constraint shift_handovers_v2_release_check check (
    workflow_version <> 2
    or status not in ('SUBMITTED', 'ACCEPTED')
    or (final_released_at is not null and final_released_by_user_id is not null and final_released_duty_session_id is not null)
  ),
  add constraint shift_handovers_v2_team_acceptance_check check (
    workflow_version <> 2 or status <> 'ACCEPTED' or team_accepted_duty_session_id is not null
  );

alter table public.shift_duty_handover_states
  drop constraint if exists shift_duty_handover_states_state_check,
  drop constraint if exists shift_duty_handover_states_shape_check;
alter table public.shift_duty_handover_states
  add constraint shift_duty_handover_states_state_check check (state in (
    'SUBMITTED_AND_ENDED', 'ENDED_LINKED_TO_SUBMITTED_HANDOVER',
    'PROVISIONAL_AND_ENDED', 'ENDED_LINKED_TO_PROVISIONAL_HANDOVER',
    'ACCEPTED_AND_STARTED', 'STARTED_WITHOUT_HANDOVER',
    'LATE_HANDOVER_REVIEW_REQUIRED', 'LATE_HANDOVER_ACCEPTED'
  )),
  add constraint shift_duty_handover_states_shape_check check (
    (side = 'OUTGOING' and state in (
      'SUBMITTED_AND_ENDED', 'ENDED_LINKED_TO_SUBMITTED_HANDOVER',
      'PROVISIONAL_AND_ENDED', 'ENDED_LINKED_TO_PROVISIONAL_HANDOVER'
    ) and handover_id is not null and ended_at is not null)
    or (side = 'INCOMING' and (
      (state = 'STARTED_WITHOUT_HANDOVER' and handover_id is null and no_handover_acknowledged_at is not null and accepted_at is null)
      or (state = 'LATE_HANDOVER_REVIEW_REQUIRED' and handover_id is not null and no_handover_acknowledged_at is not null and accepted_at is null)
      or (state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') and handover_id is not null and accepted_at is not null)
    ))
  );

alter table public.shift_handover_audit_events
  drop constraint if exists shift_handover_audit_events_event_type_check;
alter table public.shift_handover_audit_events
  add constraint shift_handover_audit_events_event_type_check check (event_type in (
    'DRAFT_CREATED','DRAFT_ENTRY_ADDED','DRAFT_ENTRY_EDITED','DRAFT_ENTRY_REMOVED',
    'HANDOVER_SUBMITTED','OUTGOING_DUTY_ENDED','TEAM_HANDOVER_ACCEPTED',
    'INDIVIDUAL_HANDOVER_ACCEPTED','STARTED_WITHOUT_HANDOVER','LATE_HANDOVER_AVAILABLE',
    'LATE_HANDOVER_ACCEPTED','DUTY_END_BLOCKED_PENDING_HANDOVER','AMENDMENT_ADDED',
    'PROVISIONAL_HANDOVER_RECORDED','FINAL_HANDOVER_RELEASED',
    'UNATTENDED_FINAL_HANDOVER_RELEASED','FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE'
  ));

-- The foundation trigger protects V1 submitted records. V2 provisional and
-- released content have equivalent immutability, while metadata may advance
-- once from PROVISIONAL to SUBMITTED.
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
    if old.status = 'ACCEPTED' then raise exception 'Accepted handovers are immutable' using errcode = '55000'; end if;
    if old.workflow_version = 2 and old.status = 'PROVISIONAL' and new.status not in ('PROVISIONAL', 'SUBMITTED') then
      raise exception 'A provisional handover may only be released' using errcode = '55000';
    end if;
    if old.status in ('SUBMITTED', 'ACCEPTED') and (
      new.outgoing_shift_id <> old.outgoing_shift_id or new.incoming_shift_id <> old.incoming_shift_id
      or new.station_id <> old.station_id or new.outgoing_notes is distinct from old.outgoing_notes
      or new.snapshot is distinct from old.snapshot or new.submitted_by_user_id is distinct from old.submitted_by_user_id
      or new.submitted_at is distinct from old.submitted_at
    ) then raise exception 'Submitted handover content is immutable' using errcode = '55000'; end if;
    if old.workflow_version = 2 and old.status = 'PROVISIONAL' and (
      new.outgoing_shift_id <> old.outgoing_shift_id or new.incoming_shift_id <> old.incoming_shift_id
      or new.station_id <> old.station_id or new.snapshot is distinct from old.snapshot
      or new.provisional_at is distinct from old.provisional_at
      or new.provisional_by_user_id is distinct from old.provisional_by_user_id
      or new.provisional_duty_session_id is distinct from old.provisional_duty_session_id
    ) then raise exception 'Provisional handover content is immutable' using errcode = '55000'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_equal_operator_handover_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype; v_station_id uuid; v_exists boolean;
begin
  if tg_op = 'DELETE' then
    select * into v_handover from public.shift_handovers where id = old.handover_id;
    if old.phase <> 'DRAFT' or v_handover.status <> 'DRAFT' then raise exception 'Finalized handover entries are immutable' using errcode = '55000'; end if;
    return old;
  end if;
  select * into v_handover from public.shift_handovers where id = new.handover_id;
  if v_handover.id is null then raise exception 'Handover does not exist' using errcode = '23503'; end if;
  v_station_id := v_handover.station_id;
  if tg_op = 'INSERT' then
    if new.phase = 'DRAFT' and v_handover.status <> 'DRAFT' then raise exception 'Draft entries require a draft handover' using errcode = '55000';
    elsif new.phase = 'INITIAL' then raise exception 'Initial entries may only be finalized from an existing draft' using errcode = '55000';
    elsif new.phase = 'AMENDMENT' and v_handover.status not in ('PROVISIONAL','SUBMITTED','ACCEPTED') then raise exception 'Addenda require a provisional or released handover' using errcode = '55000'; end if;
  else
    if old.phase <> 'DRAFT' then raise exception 'Finalized handover entries are immutable' using errcode = '55000'; end if;
    if new.handover_id <> old.handover_id or new.author_user_id <> old.author_user_id or new.client_entry_id is distinct from old.client_entry_id then raise exception 'Entry ownership and identity are immutable' using errcode = '55000'; end if;
    if new.phase = 'INITIAL' then
      if v_handover.status <> 'DRAFT' or new.entry_kind <> old.entry_kind or new.source_type is distinct from old.source_type or new.source_id is distinct from old.source_id or new.body is distinct from old.body or new.priority is distinct from old.priority or new.replaces_entry_id is distinct from old.replaces_entry_id or new.finalized_at is null then raise exception 'Invalid initial-entry finalization' using errcode = '55000'; end if;
    elsif new.phase = 'DRAFT' then
      if v_handover.status <> 'DRAFT' then raise exception 'Only draft handovers can be edited' using errcode = '55000'; end if;
    else raise exception 'Draft entries cannot be converted to addenda' using errcode = '55000'; end if;
  end if;
  if new.entry_kind = 'SOURCE_REFERENCE' then
    if new.source_type = 'INTERRUPTION' then select exists(select 1 from public.interruptions where id = new.source_id and station_id = v_station_id) into v_exists;
    elsif new.source_type = 'PARAMETER_ALERT' then select exists(select 1 from public.parameter_alerts where id = new.source_id and station_id = v_station_id) into v_exists;
    elsif new.source_type = 'LOGBOOK_ENTRY' then select exists(select 1 from public.log_book_entries where id = new.source_id and station_id = v_station_id) into v_exists;
    else v_exists := false; end if;
    if not v_exists then raise exception 'Referenced handover record is not in the handover station' using errcode = '23514'; end if;
  end if;
  if new.replaces_entry_id is not null and not exists (select 1 from public.shift_handover_entries e where e.id = new.replaces_entry_id and e.handover_id = new.handover_id and e.phase in ('INITIAL','AMENDMENT')) then raise exception 'Replacement entry must belong to the same finalized handover' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.enforce_shift_duty_handover_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_session public.shift_duty_sessions%rowtype; v_handover public.shift_handovers%rowtype;
begin
  select * into v_session from public.shift_duty_sessions where id = new.duty_session_id;
  if v_session.id is null or v_session.shift_id <> new.shift_id or v_session.station_id <> new.station_id or v_session.user_id <> new.user_id then raise exception 'Individual handover state must match its duty session' using errcode = '23514'; end if;
  if new.handover_id is not null then
    select * into v_handover from public.shift_handovers where id = new.handover_id;
    if v_handover.id is null or v_handover.station_id <> new.station_id or (new.side='OUTGOING' and v_handover.outgoing_shift_id <> new.shift_id) or (new.side='INCOMING' and v_handover.incoming_shift_id <> new.shift_id) then raise exception 'Individual handover state does not match the handover transition' using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.state = 'STARTED_WITHOUT_HANDOVER' and new.state = 'LATE_HANDOVER_REVIEW_REQUIRED' then null;
    elsif old.state = 'LATE_HANDOVER_REVIEW_REQUIRED' and new.state = 'LATE_HANDOVER_ACCEPTED' then null;
    elsif new.state = old.state and new.handover_id is not distinct from old.handover_id and new.accepted_at is not distinct from old.accepted_at and new.ended_at is not distinct from old.ended_at and new.no_handover_acknowledged_at is not distinct from old.no_handover_acknowledged_at and new.acceptance_comments is not distinct from old.acceptance_comments then null;
    else raise exception 'Invalid individual handover state transition' using errcode = '55000'; end if;
  end if;
  return new;
end;
$$;

-- This is deliberately a projection rather than a new duty workflow: the
-- first duty session created for an already released incoming V2 handover is
-- retained for reporting. Provisional handovers are excluded.
create or replace function public.capture_first_incoming_duty_after_release_v2()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype;
begin
  if new.status <> 'ON_DUTY' then return new; end if;
  select * into v_handover from public.shift_handovers
  where incoming_shift_id = new.shift_id and workflow_version = 2
    and status in ('SUBMITTED','ACCEPTED')
  for update;
  if v_handover.id is not null and v_handover.first_incoming_duty_started_at is null then
    update public.shift_handovers set first_incoming_duty_started_at = new.started_at where id = v_handover.id;
    perform public.write_shift_handover_audit_event(
      v_handover.id, v_handover.station_id, new.shift_id, new.id,
      'FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE', '{}'::jsonb
    );
  end if;
  return new;
end;
$$;
drop trigger if exists capture_first_incoming_duty_after_release_v2_trigger on public.shift_duty_sessions;
create trigger capture_first_incoming_duty_after_release_v2_trigger
after insert on public.shift_duty_sessions
for each row execute function public.capture_first_incoming_duty_after_release_v2();

-- Direct table reads and the SECURITY DEFINER detail RPC apply the same rule:
-- no incoming or scoped supervisor can read a V2 provisional handover.
drop policy if exists shift_handovers_read_authorized on public.shift_handovers;
create policy shift_handovers_read_authorized on public.shift_handovers for select to authenticated using (
  (workflow_version = 2 and status = 'PROVISIONAL' and exists (
    select 1 from public.station_shift_assignments a join public.app_users u on u.id=a.user_id
    where a.shift_id=shift_handovers.outgoing_shift_id and a.user_id=auth.uid() and u.active and u.role='OPERATOR'
  )) or
  (not (workflow_version = 2 and status = 'PROVISIONAL') and exists (
    select 1 from public.get_my_accessible_station_ids() s where s.station_id=shift_handovers.station_id
  ))
);
drop policy if exists shift_handover_entries_read_authorized on public.shift_handover_entries;
create policy shift_handover_entries_read_authorized on public.shift_handover_entries for select to authenticated using (exists (
  select 1 from public.shift_handovers h
  where h.id=shift_handover_entries.handover_id and (
    (h.workflow_version=2 and h.status='PROVISIONAL' and exists (
      select 1 from public.station_shift_assignments a join public.app_users u on u.id=a.user_id
      where a.shift_id=h.outgoing_shift_id and a.user_id=auth.uid() and u.active and u.role='OPERATOR'
    )) or
    (not (h.workflow_version=2 and h.status='PROVISIONAL') and exists (select 1 from public.get_my_operational_station_ids() s where s.station_id=h.station_id))
  )
));
drop policy if exists shift_handover_audit_events_read_authorized on public.shift_handover_audit_events;
create policy shift_handover_audit_events_read_authorized on public.shift_handover_audit_events for select to authenticated using (exists (
  select 1 from public.shift_handovers h where h.id=shift_handover_audit_events.handover_id and (
    (h.workflow_version=2 and h.status='PROVISIONAL' and exists (select 1 from public.station_shift_assignments a join public.app_users u on u.id=a.user_id where a.shift_id=h.outgoing_shift_id and a.user_id=auth.uid() and u.active and u.role='OPERATOR'))
    or (not (h.workflow_version=2 and h.status='PROVISIONAL') and exists (select 1 from public.get_my_operational_station_ids() s where s.station_id=h.station_id))
  )
));

create or replace function public.get_equal_operator_handover_v2(p_handover_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype;
begin
  select * into v_handover from public.shift_handovers where id=p_handover_id;
  if v_handover.id is null then raise exception 'Handover not found' using errcode='P0002'; end if;
  if v_handover.workflow_version=2 and v_handover.status='PROVISIONAL' then
    if not exists (select 1 from public.station_shift_assignments a join public.app_users u on u.id=a.user_id where a.shift_id=v_handover.outgoing_shift_id and a.user_id=auth.uid() and u.active and u.role='OPERATOR') then raise exception 'The provisional handover is not available to this user' using errcode='42501'; end if;
  elsif not exists (select 1 from public.get_my_operational_station_ids() s where s.station_id=v_handover.station_id) then raise exception 'Station access is not authorized' using errcode='42501'; end if;
  return jsonb_build_object('handover',to_jsonb(v_handover),'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.shift_handover_entries e where e.handover_id=p_handover_id),'[]'::jsonb),'individual_states',coalesce((select jsonb_agg(to_jsonb(s) order by s.side,s.created_at,s.id) from public.shift_duty_handover_states s where s.handover_id=p_handover_id),'[]'::jsonb),'audit_events',coalesce((select jsonb_agg(to_jsonb(a) order by a.occurred_at,a.id) from public.shift_handover_audit_events a where a.handover_id=p_handover_id),'[]'::jsonb));
end;
$$;

create or replace function public.add_shift_handover_amendment_v2(p_handover_id uuid,p_body text,p_replaces_entry_id uuid,p_client_entry_id uuid)
returns public.shift_handover_entries language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype; v_access record; v_entry public.shift_handover_entries%rowtype;
begin
  if p_client_entry_id is null then raise exception 'A client entry identifier is required' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null then raise exception 'Amendment text is required' using errcode='22023'; end if;
  select * into v_handover from public.shift_handovers where id=p_handover_id for update;
  if v_handover.id is null then raise exception 'Handover not found' using errcode='P0002'; end if;
  select * into v_access from public.assert_equal_operator_shift_member(v_handover.outgoing_shift_id,false);
  select * into v_entry from public.shift_handover_entries where handover_id=p_handover_id and author_user_id=auth.uid() and client_entry_id=p_client_entry_id;
  if v_entry.id is not null then return v_entry; end if;
  if v_handover.status not in ('PROVISIONAL','SUBMITTED','ACCEPTED') then raise exception 'Addenda require a provisional or released handover' using errcode='55000'; end if;
  insert into public.shift_handover_entries(handover_id,author_user_id,client_entry_id,entry_kind,phase,body,replaces_entry_id,finalized_at)
  values(p_handover_id,auth.uid(),p_client_entry_id,'COMMENT','AMENDMENT',btrim(p_body),p_replaces_entry_id,now()) returning * into v_entry;
  perform public.write_shift_handover_audit_event(p_handover_id,v_handover.station_id,v_handover.outgoing_shift_id,v_access.duty_session_id,'AMENDMENT_ADDED',jsonb_build_object('entry_id',v_entry.id,'provisional',v_handover.status='PROVISIONAL'));
  if v_handover.status in ('SUBMITTED','ACCEPTED') then perform public.enqueue_shift_handover_notification_v2(p_handover_id,'AMENDMENT',v_entry.id); end if;
  return v_entry;
end;
$$;

create or replace function public.end_duty_and_handover_shift_v2(p_duty_session_id uuid,p_incoming_shift_id uuid,p_idempotency_key uuid,p_final_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_session public.shift_duty_sessions%rowtype; v_outgoing public.station_shifts%rowtype; v_incoming public.station_shifts%rowtype; v_handover public.shift_handovers%rowtype; v_state public.shift_duty_handover_states%rowtype; v_result jsonb; v_now timestamptz:=now(); v_release boolean:=false; v_entry_id uuid; v_snapshot jsonb; v_notification_event_id uuid;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':END_AND_HANDOVER:'||p_idempotency_key::text,0));
  select response_payload into v_result from public.shift_handover_command_receipts where user_id=auth.uid() and command_type='END_AND_HANDOVER' and idempotency_key=p_idempotency_key;
  if v_result is not null then return v_result; end if;
  select * into v_session from public.shift_duty_sessions where id=p_duty_session_id for update;
  if v_session.id is null then raise exception 'Duty session not found' using errcode='P0002'; end if;
  if v_session.user_id<>auth.uid() or v_session.status<>'ON_DUTY' then raise exception 'Only the on-duty Operator may complete this duty session' using errcode='42501'; end if;
  perform public.assert_equal_operator_shift_member(v_session.shift_id,true);
  select * into v_outgoing from public.station_shifts where id=v_session.shift_id;
  select * into v_incoming from public.station_shifts where id=p_incoming_shift_id;
  if v_incoming.id is null or v_incoming.station_id<>v_outgoing.station_id or v_incoming.scheduled_start<v_outgoing.scheduled_end then raise exception 'Invalid handover shift transition' using errcode='23514'; end if;
  if exists(select 1 from public.shift_handovers h where h.incoming_shift_id=v_session.shift_id and h.status in ('SUBMITTED','ACCEPTED') and not exists(select 1 from public.shift_duty_handover_states i where i.duty_session_id=v_session.id and i.side='INCOMING' and i.handover_id=h.id and i.state in ('ACCEPTED_AND_STARTED','LATE_HANDOVER_ACCEPTED'))) then
    perform public.write_shift_handover_audit_event(null,v_session.station_id,v_session.shift_id,v_session.id,'DUTY_END_BLOCKED_PENDING_HANDOVER','{}'::jsonb); raise exception 'The available handover must be individually accepted before ending duty' using errcode='55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outgoing.id::text||':'||v_incoming.id::text,0));
  select * into v_handover from public.shift_handovers where outgoing_shift_id=v_outgoing.id and incoming_shift_id=v_incoming.id for update;
  if v_handover.id is null then
    insert into public.shift_handovers(station_id,outgoing_shift_id,incoming_shift_id,prepared_by_user_id,workflow_version) values(v_outgoing.station_id,v_outgoing.id,v_incoming.id,auth.uid(),2) returning * into v_handover;
    perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_outgoing.id,v_session.id,'DRAFT_CREATED',jsonb_build_object('incoming_shift_id',v_incoming.id,'workflow_version',2));
  elsif v_handover.status='DRAFT' and v_handover.workflow_version=1 then update public.shift_handovers set workflow_version=2,row_version=row_version+1 where id=v_handover.id returning * into v_handover; end if;
  if nullif(btrim(coalesce(p_final_comment,'')),'') is not null then
    if v_handover.status='DRAFT' then insert into public.shift_handover_entries(handover_id,author_user_id,client_entry_id,entry_kind,phase,body) values(v_handover.id,auth.uid(),p_idempotency_key,'COMMENT','DRAFT',btrim(p_final_comment)) on conflict (handover_id,author_user_id,client_entry_id) where client_entry_id is not null do nothing returning id into v_entry_id;
    elsif v_handover.status in ('PROVISIONAL','SUBMITTED','ACCEPTED') then insert into public.shift_handover_entries(handover_id,author_user_id,client_entry_id,entry_kind,phase,body,finalized_at) values(v_handover.id,auth.uid(),p_idempotency_key,'COMMENT','AMENDMENT',btrim(p_final_comment),v_now) on conflict (handover_id,author_user_id,client_entry_id) where client_entry_id is not null do nothing returning id into v_entry_id; if v_entry_id is not null then perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_outgoing.id,v_session.id,'AMENDMENT_ADDED',jsonb_build_object('entry_id',v_entry_id,'provisional',v_handover.status='PROVISIONAL')); end if;
    else raise exception 'Handover is not available for completion' using errcode='55000'; end if;
  end if;
  if v_handover.status='DRAFT' then
    update public.shift_handover_entries set phase='INITIAL',finalized_at=v_now where handover_id=v_handover.id and phase='DRAFT';
    select jsonb_build_object('workflow_version',2,'handover_id',v_handover.id,'station_id',v_handover.station_id,'outgoing_shift_id',v_handover.outgoing_shift_id,'incoming_shift_id',v_handover.incoming_shift_id,'provisional_by_user_id',auth.uid(),'provisional_at',v_now,'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'author_user_id',e.author_user_id,'entry_kind',e.entry_kind,'source_type',e.source_type,'source_id',e.source_id,'body',e.body,'priority',e.priority,'created_at',e.created_at,'finalized_at',e.finalized_at) order by e.created_at,e.id) from public.shift_handover_entries e where e.handover_id=v_handover.id and e.phase='INITIAL'),'[]'::jsonb),'legacy_items',coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at,item.id) from public.shift_handover_items item where item.handover_id=v_handover.id),'[]'::jsonb)) into v_snapshot;
    update public.shift_handovers set workflow_version=2,status='PROVISIONAL',provisional_at=v_now,provisional_by_user_id=auth.uid(),provisional_duty_session_id=v_session.id,initial_finalized_at=v_now,snapshot=v_snapshot,outgoing_notes=coalesce(nullif(btrim(coalesce(p_final_comment,'')),''),outgoing_notes),row_version=row_version+1 where id=v_handover.id returning * into v_handover;
    perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_outgoing.id,v_session.id,'PROVISIONAL_HANDOVER_RECORDED',jsonb_build_object('snapshot_entry_count',jsonb_array_length(v_snapshot->'entries')));
  end if;
  update public.shift_duty_sessions set status='ENDED',ended_at=v_now where id=v_session.id returning * into v_session;
  select not exists(select 1 from public.shift_duty_sessions d where d.shift_id=v_outgoing.id and d.status='ON_DUTY') into v_release;
  if v_release and v_handover.status='PROVISIONAL' then
    update public.shift_handovers set status='SUBMITTED',submitted_by_user_id=auth.uid(),submitted_at=v_now,submitted_duty_session_id=v_session.id,final_released_at=v_now,final_released_by_user_id=auth.uid(),final_released_duty_session_id=v_session.id,row_version=row_version+1 where id=v_handover.id returning * into v_handover;
    perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_outgoing.id,v_session.id,'FINAL_HANDOVER_RELEASED',jsonb_build_object('provisional_by_user_id',v_handover.provisional_by_user_id));
    v_notification_event_id:=public.enqueue_shift_handover_notification_v2(v_handover.id,'AVAILABLE',null);
    insert into public.shift_duty_handover_states(duty_session_id,handover_id,shift_id,station_id,user_id,side,state,no_handover_acknowledged_at)
    select d.id,v_handover.id,d.shift_id,d.station_id,d.user_id,'INCOMING','LATE_HANDOVER_REVIEW_REQUIRED',coalesce(existing.no_handover_acknowledged_at,d.started_at) from public.shift_duty_sessions d left join public.shift_duty_handover_states existing on existing.duty_session_id=d.id and existing.side='INCOMING' where d.shift_id=v_handover.incoming_shift_id and d.status='ON_DUTY' on conflict(duty_session_id,side) do update set handover_id=excluded.handover_id,state='LATE_HANDOVER_REVIEW_REQUIRED',no_handover_acknowledged_at=coalesce(public.shift_duty_handover_states.no_handover_acknowledged_at,excluded.no_handover_acknowledged_at) where public.shift_duty_handover_states.state='STARTED_WITHOUT_HANDOVER';
    update public.shift_duty_handover_states set late_notification_event_id=v_notification_event_id where handover_id=v_handover.id and side='INCOMING' and state='LATE_HANDOVER_REVIEW_REQUIRED';
    if exists(select 1 from public.shift_duty_handover_states where handover_id=v_handover.id and side='INCOMING' and state='LATE_HANDOVER_REVIEW_REQUIRED') then perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_handover.incoming_shift_id,null,'LATE_HANDOVER_AVAILABLE',jsonb_build_object('notification_event_id',v_notification_event_id)); else perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_handover.incoming_shift_id,null,'UNATTENDED_FINAL_HANDOVER_RELEASED',jsonb_build_object('notification_event_id',v_notification_event_id)); end if;
  end if;
  insert into public.shift_duty_handover_states(duty_session_id,handover_id,shift_id,station_id,user_id,side,state,ended_at) values(v_session.id,v_handover.id,v_session.shift_id,v_session.station_id,auth.uid(),'OUTGOING',case when v_release then 'SUBMITTED_AND_ENDED' when v_handover.provisional_duty_session_id=v_session.id then 'PROVISIONAL_AND_ENDED' else 'ENDED_LINKED_TO_PROVISIONAL_HANDOVER' end,v_now) returning * into v_state;
  perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,v_outgoing.id,v_session.id,'OUTGOING_DUTY_ENDED',jsonb_build_object('individual_state',v_state.state));
  v_result:=jsonb_build_object('handover',to_jsonb(v_handover),'duty_session',to_jsonb(v_session),'individual_state',to_jsonb(v_state),'official_submission',v_release,'provisional',v_handover.status='PROVISIONAL');
  insert into public.shift_handover_command_receipts(user_id,command_type,idempotency_key,handover_id,response_payload) values(auth.uid(),'END_AND_HANDOVER',p_idempotency_key,v_handover.id,v_result); return v_result;
end;
$$;

commit;
