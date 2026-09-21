-- Permit an active V2 operator to end an individual duty only when the
-- station has no successor shift. This is deliberately not a handover.
begin;

alter table public.shift_handover_audit_events
  drop constraint if exists shift_handover_audit_events_event_type_check;
alter table public.shift_handover_audit_events
  add constraint shift_handover_audit_events_event_type_check check (event_type in (
    'DRAFT_CREATED','DRAFT_ENTRY_ADDED','DRAFT_ENTRY_EDITED','DRAFT_ENTRY_REMOVED',
    'HANDOVER_SUBMITTED','OUTGOING_DUTY_ENDED','TEAM_HANDOVER_ACCEPTED',
    'INDIVIDUAL_HANDOVER_ACCEPTED','STARTED_WITHOUT_HANDOVER',
    'LATE_HANDOVER_AVAILABLE','LATE_HANDOVER_ACCEPTED',
    'DUTY_END_BLOCKED_PENDING_HANDOVER','AMENDMENT_ADDED',
    'PROVISIONAL_HANDOVER_RECORDED','FINAL_HANDOVER_RELEASED',
    'UNATTENDED_FINAL_HANDOVER_RELEASED',
    'FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE',
    'SHIFT_END_PASSED_HANDOVER_PENDING',
    'DUTY_ENDED_NO_NEXT_SHIFT'
  ));

create or replace function public.end_duty_without_next_shift_v2(
  p_duty_session_id uuid,
  p_idempotency_key uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.shift_duty_sessions%rowtype;
  v_shift public.station_shifts%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'The operational note is too long' using errcode = '22001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    auth.uid()::text || ':END_WITHOUT_NEXT_SHIFT:' || p_idempotency_key::text, 0
  ));
  select response_payload into v_result
  from public.shift_handover_command_receipts
  where user_id = auth.uid()
    and command_type = 'END_WITHOUT_NEXT_SHIFT'
    and idempotency_key = p_idempotency_key;
  if v_result is not null then
    return v_result;
  end if;

  select * into v_session
  from public.shift_duty_sessions
  where id = p_duty_session_id
  for update;
  if v_session.id is null then
    raise exception 'Duty session not found' using errcode = 'P0002';
  end if;
  if v_session.user_id <> auth.uid()
    or v_session.status <> 'ON_DUTY'
    or v_session.ended_at is not null then
    raise exception 'Only the on-duty Operator may complete this duty session' using errcode = '42501';
  end if;

  perform public.assert_equal_operator_shift_member(v_session.shift_id, true);
  select * into v_shift from public.station_shifts where id = v_session.shift_id;
  if v_shift.id is null or v_shift.status = 'CANCELLED' then
    raise exception 'The active shift is not available for duty completion' using errcode = 'P0001';
  end if;

  -- This is intentionally the same successor definition used by
  -- get_next_station_shift for an active duty.
  if exists (
    select 1
    from public.station_shifts successor
    where successor.station_id = v_shift.station_id
      and successor.id <> v_shift.id
      and successor.status <> 'CANCELLED'
      and successor.scheduled_start >= v_shift.scheduled_end
  ) then
    raise exception 'A next scheduled shift exists; complete duty through the handover flow' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.shift_handovers h
    where h.incoming_shift_id = v_session.shift_id
      and h.status in ('SUBMITTED', 'ACCEPTED')
      and not exists (
        select 1
        from public.shift_duty_handover_states individual
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

  update public.shift_duty_sessions
  set status = 'ENDED', ended_at = v_now
  where id = v_session.id
  returning * into v_session;

  perform public.write_shift_handover_audit_event(
    null, v_session.station_id, v_session.shift_id, v_session.id,
    'DUTY_ENDED_NO_NEXT_SHIFT',
    jsonb_build_object(
      'reason', 'NO_NEXT_SHIFT_SCHEDULED',
      'note', v_note
    )
  );

  v_result := jsonb_build_object(
    'duty_session', to_jsonb(v_session),
    'reason', 'NO_NEXT_SHIFT_SCHEDULED',
    'note', v_note
  );
  insert into public.shift_handover_command_receipts(
    user_id, command_type, idempotency_key, handover_id, response_payload
  ) values (
    auth.uid(), 'END_WITHOUT_NEXT_SHIFT', p_idempotency_key, null, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.end_duty_without_next_shift_v2(uuid, uuid, text)
  from public, anon;
grant execute on function public.end_duty_without_next_shift_v2(uuid, uuid, text)
  to authenticated;

commit;
