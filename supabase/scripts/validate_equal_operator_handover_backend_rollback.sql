-- DEV-safe validation for the equal-operator handover backend.
-- All fixtures and lifecycle mutations are rolled back.

begin;

do $$
declare
  v_out_a uuid := gen_random_uuid();
  v_out_b uuid := gen_random_uuid();
  v_in_a uuid := gen_random_uuid();
  v_in_b uuid := gen_random_uuid();
  v_supervisor uuid := gen_random_uuid();
  v_unrostered uuid := gen_random_uuid();
  v_station uuid := gen_random_uuid();
  v_late_station uuid := gen_random_uuid();
  v_outgoing uuid := gen_random_uuid();
  v_incoming uuid := gen_random_uuid();
  v_next uuid := gen_random_uuid();
  v_late_outgoing uuid := gen_random_uuid();
  v_late_incoming uuid := gen_random_uuid();
  v_late_next uuid := gen_random_uuid();
  v_out_a_session uuid := gen_random_uuid();
  v_out_b_session uuid := gen_random_uuid();
  v_late_out_session uuid := gen_random_uuid();
  v_handover public.shift_handovers%rowtype;
  v_entry public.shift_handover_entries%rowtype;
  v_transition jsonb;
  v_retry jsonb;
  v_late_start jsonb;
  v_late_start_b jsonb;
  v_late_submit jsonb;
  v_late_accept jsonb;
  v_snapshot jsonb;
  v_report jsonb;
  v_count integer;
  v_action uuid;
  v_tag text := 'equal-handover-' || gen_random_uuid();
begin
  insert into auth.users(id) values
    (v_out_a), (v_out_b), (v_in_a), (v_in_b), (v_supervisor), (v_unrostered);
  insert into public.app_users(id, full_name, role, active) values
    (v_out_a, 'Equal Outgoing A', 'OPERATOR', true),
    (v_out_b, 'Equal Outgoing B', 'OPERATOR', true),
    (v_in_a, 'Equal Incoming A', 'OPERATOR', true),
    (v_in_b, 'Equal Incoming B', 'OPERATOR', true),
    (v_supervisor, 'Equal Supervisor', 'ADMIN', true),
    (v_unrostered, 'Equal Unrostered', 'OPERATOR', true);
  insert into public.stations(id, code, name, active) values
    (v_station, left(v_tag, 60), 'Equal handover station', true),
    (v_late_station, left(v_tag || '-late', 60), 'Equal late handover station', true);
  insert into public.user_stations(user_id, station_id, active)
  select user_id, station_id, true
  from (values
    (v_out_a, v_station), (v_out_b, v_station), (v_in_a, v_station), (v_in_b, v_station),
    (v_out_a, v_late_station), (v_in_a, v_late_station), (v_in_b, v_late_station), (v_unrostered, v_late_station)
  ) scoped(user_id, station_id);

  insert into public.station_shifts(id, station_id, shift_date, shift_name, scheduled_start, scheduled_end, status) values
    (v_outgoing, v_station, current_date, 'Equal outgoing', now() - interval '2 hours', now() - interval '1 hour', 'ACTIVE'),
    (v_incoming, v_station, current_date, 'Equal incoming', now() + interval '1 hour', now() + interval '3 hours', 'SCHEDULED'),
    (v_next, v_station, current_date, 'Equal next', now() + interval '4 hours', now() + interval '5 hours', 'SCHEDULED'),
    (v_late_outgoing, v_late_station, current_date, 'Late outgoing', now() - interval '2 hours', now() - interval '1 hour', 'ACTIVE'),
    (v_late_incoming, v_late_station, current_date, 'Late incoming', now() - interval '1 hour', now() + interval '1 hour', 'SCHEDULED'),
    (v_late_next, v_late_station, current_date, 'Late next', now() + interval '1 hour', now() + interval '2 hours', 'SCHEDULED');
  update public.station_shifts set created_by = v_supervisor where id = v_incoming;
  insert into public.station_shift_assignments(shift_id, user_id, duty_role) values
    (v_outgoing, v_out_a, 'MEMBER'), (v_outgoing, v_out_b, 'MEMBER'),
    (v_incoming, v_in_a, 'MEMBER'), (v_incoming, v_in_b, 'MEMBER'),
    (v_next, v_in_a, 'MEMBER'),
    (v_late_outgoing, v_out_a, 'MEMBER'),
    (v_late_incoming, v_in_a, 'MEMBER'), (v_late_incoming, v_in_b, 'MEMBER'),
    (v_late_next, v_in_a, 'MEMBER');
  insert into public.device_tokens(user_id, fcm_token, platform, is_active) values
    (v_in_a, v_tag || '-late-device-a', 'android', true),
    (v_in_b, v_tag || '-late-device-b', 'android', true);
  insert into public.shift_duty_sessions(id, shift_id, station_id, user_id, shift_role, started_at, status) values
    (v_out_a_session, v_outgoing, v_station, v_out_a, 'MEMBER', now() - interval '110 minutes', 'ON_DUTY'),
    (v_out_b_session, v_outgoing, v_station, v_out_b, 'MEMBER', now() - interval '105 minutes', 'ON_DUTY'),
    (v_late_out_session, v_late_outgoing, v_late_station, v_out_a, 'MEMBER', now() - interval '110 minutes', 'ON_DUTY');

  perform set_config('request.jwt.claims', json_build_object('sub', v_out_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into strict v_handover
  from public.get_or_create_equal_operator_handover_v2(v_outgoing, v_incoming);
  if v_handover.workflow_version <> 2 or v_handover.status <> 'DRAFT' then
    raise exception 'Version-2 common draft was not created';
  end if;
  select * into strict v_entry
  from public.save_equal_operator_handover_entry_v2(
    v_handover.id, null, gen_random_uuid(), 'COMMENT', null, null,
    'Outgoing A shared note', null, v_handover.row_version
  );
  v_action := gen_random_uuid();
  v_transition := public.end_duty_and_handover_shift_v2(
    v_out_a_session, v_incoming, v_action, 'Official final note'
  );
  v_retry := public.end_duty_and_handover_shift_v2(
    v_out_a_session, v_incoming, v_action, 'Official final note'
  );
  if coalesce((v_transition->>'official_submission')::boolean, true)
    or not coalesce((v_transition->>'provisional')::boolean, false)
    or v_retry <> v_transition then
    raise exception 'First outgoing end did not create an idempotent provisional handover';
  end if;
  reset role;

  select * into strict v_handover from public.shift_handovers where id = (v_transition->'handover'->>'id')::uuid;
  if v_handover.status <> 'PROVISIONAL' or v_handover.snapshot is null
    or v_handover.provisional_by_user_id <> v_out_a
    or v_handover.provisional_duty_session_id <> v_out_a_session then
    raise exception 'First outgoing end did not freeze the provisional snapshot correctly';
  end if;
  v_snapshot := v_handover.snapshot;
  if exists (select 1 from public.notification_events where source_operation_id='SHIFT_HANDOVER_FINAL_RELEASE:'||v_handover.id::text) then
    raise exception 'Provisional handover created an incoming final-release notification';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_in_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.get_equal_operator_handover_v2(v_handover.id);
    raise exception 'Incoming Operator read provisional handover content';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.shift_handovers where id = v_handover.id;
  if v_count <> 0 then raise exception 'Incoming Operator read provisional handover row directly'; end if;
  select count(*) into v_count from public.shift_handover_entries where handover_id = v_handover.id;
  if v_count <> 0 then raise exception 'Incoming Operator read provisional entries directly'; end if;
  select count(*) into v_count from public.shift_handover_audit_events where handover_id = v_handover.id;
  if v_count <> 0 then raise exception 'Incoming Operator read provisional audit details directly'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_out_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_transition := public.end_duty_and_handover_shift_v2(
    v_out_b_session, v_incoming, gen_random_uuid(), 'Outgoing B correction'
  );
  if not coalesce((v_transition->>'official_submission')::boolean, false)
    or v_transition->'handover'->>'status' <> 'SUBMITTED' then
    raise exception 'Last active outgoing Operator did not release the common handover';
  end if;
  select * into strict v_entry from public.add_shift_handover_amendment_v2(
    v_handover.id, 'Later append-only correction', null, gen_random_uuid()
  );
  reset role;
  if v_entry.phase <> 'AMENDMENT' then raise exception 'Amendment was not append-only'; end if;
  if (select snapshot from public.shift_handovers where id = v_handover.id) <> v_snapshot then
    raise exception 'Submitted snapshot changed after an amendment';
  end if;
  if (select count(*) from public.shift_handovers where outgoing_shift_id = v_outgoing and workflow_version = 2) <> 1 then
    raise exception 'Duplicate team handover was created';
  end if;
  if not exists (select 1 from public.shift_handover_unattended_states where handover_id=v_handover.id and status='OPEN') then
    raise exception 'Final release without an incoming duty did not create unattended state';
  end if;
  if (select count(*) from public.notification_recipients r join public.notification_events e on e.id=r.notification_event_id
      where e.source_operation_id='SHIFT_HANDOVER_FINAL_RELEASE:'||v_handover.id::text and r.user_id=v_supervisor and r.device_token_id is null) <> 1 then
    raise exception 'Shift creator did not receive an in-app final-release recipient';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_in_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.review_handover_and_start_duty_v2(v_next, null, true, null, gen_random_uuid());
    raise exception 'Early Start Duty Without Handover was allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_in_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_transition := public.review_handover_and_start_duty_v2(
    v_incoming, v_handover.id, false, 'Incoming A accepted', gen_random_uuid()
  );
  if not coalesce((v_transition->>'team_first_acceptance')::boolean, false) then
    raise exception 'First incoming acceptance did not accept the team handover';
  end if;
  if not public.can_operator_make_station_entry(v_station) then
    raise exception 'Early accepted incoming Operator was not authorized for operational entry';
  end if;
  if not exists (select 1 from public.shift_handover_unattended_states where handover_id=v_handover.id and status='CLOSED') then
    raise exception 'First incoming acceptance did not close unattended state';
  end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_in_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_transition := public.review_handover_and_start_duty_v2(
    v_incoming, v_handover.id, false, 'Incoming B accepted independently', gen_random_uuid()
  );
  if coalesce((v_transition->>'team_first_acceptance')::boolean, true) then
    raise exception 'Second incoming acceptance replaced team attribution';
  end if;
  reset role;
  if (select count(*) from public.shift_duty_handover_states where handover_id = v_handover.id and side = 'INCOMING' and state = 'ACCEPTED_AND_STARTED') <> 2 then
    raise exception 'Individual incoming acceptances were not retained';
  end if;

  -- No-handover start followed by a late submission.
  perform set_config('request.jwt.claims', json_build_object('sub', v_in_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_late_start := public.review_handover_and_start_duty_v2(
    v_late_incoming, null, true, null, gen_random_uuid()
  );
  reset role;
  if v_late_start->'individual_state'->>'state' <> 'STARTED_WITHOUT_HANDOVER' then
    raise exception 'No-handover acknowledgement was not recorded';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_in_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_late_start_b := public.review_handover_and_start_duty_v2(
    v_late_incoming, null, true, null, gen_random_uuid()
  );
  reset role;
  if v_late_start_b->'individual_state'->>'state' <> 'STARTED_WITHOUT_HANDOVER' then
    raise exception 'Second no-handover acknowledgement was not recorded';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_out_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_late_submit := public.end_duty_and_handover_shift_v2(
    v_late_out_session, v_late_incoming, gen_random_uuid(), 'Late official handover'
  );
  reset role;
  if (select count(*) from public.shift_duty_handover_states s
      where s.duty_session_id in (
        (v_late_start->'duty_session'->>'id')::uuid,
        (v_late_start_b->'duty_session'->>'id')::uuid
      ) and s.side = 'INCOMING' and s.state = 'LATE_HANDOVER_REVIEW_REQUIRED') <> 2
  then raise exception 'Late handover requirements were not created independently'; end if;
  perform public.enqueue_shift_handover_notification_v2(
    (v_late_submit->'handover'->>'id')::uuid, 'AVAILABLE', null
  );
  if (select count(*) from public.notification_events e
      where e.source_operation_id = 'SHIFT_HANDOVER_FINAL_RELEASE:' || (v_late_submit->'handover'->>'id')) <> 1
  then raise exception 'Late handover notification event was duplicated'; end if;
  if (select count(*) from public.notification_recipients r
      join public.notification_events e on e.id = r.notification_event_id
      where e.source_operation_id = 'SHIFT_HANDOVER_FINAL_RELEASE:' || (v_late_submit->'handover'->>'id')
        and r.user_id in (v_in_a, v_in_b) and r.status = 'PENDING' and r.device_token_id is not null) <> 2
  then raise exception 'Late handover PENDING recipients were not created for both on-duty Operators'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_in_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.end_duty_and_handover_shift_v2(
      (v_late_start->'duty_session'->>'id')::uuid, v_late_next, gen_random_uuid(), null
    );
    raise exception 'Duty ended with an unaccepted late handover';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_late_accept := public.accept_late_shift_handover_v2(
    (v_late_start->'duty_session'->>'id')::uuid,
    (v_late_submit->'handover'->>'id')::uuid,
    'Late handover reviewed', gen_random_uuid()
  );
  if v_late_accept->'individual_state'->>'state' <> 'LATE_HANDOVER_ACCEPTED' then
    raise exception 'Late handover was not individually accepted';
  end if;
  reset role;
  if not exists (
    select 1 from public.shift_duty_handover_states s
    where s.duty_session_id = (v_late_start_b->'duty_session'->>'id')::uuid
      and s.state = 'LATE_HANDOVER_REVIEW_REQUIRED'
  ) then raise exception 'One Operator acceptance cleared another Operator obligation'; end if;

  -- Roster and station scope are enforced server-side.
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrostered, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.review_handover_and_start_duty_v2(v_late_incoming, null, true, null, gen_random_uuid());
    raise exception 'Unrostered Operator was allowed to start duty';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_supervisor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count
  from public.get_shift_handover_acceptance_oversight_v2(null, current_date - 1, current_date + 1, 100);
  if v_count < 2 then raise exception 'Supervisor oversight did not expose individual acceptance status'; end if;
  select report.payload into strict v_report
  from public.get_shift_handover_report_v2(v_station, current_date, current_date, 100) report
  where report.payload->>'id' = v_handover.id::text;
  if jsonb_array_length(v_report->'outgoing_operators') <> 2
    or jsonb_array_length(v_report->'incoming_operators') <> 2
    or jsonb_array_length(v_report->'entries') < 2
    or jsonb_array_length(v_report->'audit_events') < 1
  then raise exception 'Version-2 report did not expose the complete team handover'; end if;
  if (select count(*) from public.get_operational_timeline('CUSTOM', current_date, current_date, v_station, null, 200, 0) timeline
      join public.shift_handover_audit_events audit on audit.id = timeline.source_id
      where audit.handover_id = v_handover.id)
     <> (select count(*) from public.shift_handover_audit_events audit where audit.handover_id = v_handover.id)
  then raise exception 'Version-2 audit events were not fully projected into the operational timeline'; end if;
  reset role;

  if not exists (select 1 from public.shift_handover_audit_events where handover_id = v_handover.id and event_type = 'PROVISIONAL_HANDOVER_RECORDED')
    or not exists (select 1 from public.shift_handover_audit_events where handover_id = v_handover.id and event_type = 'FINAL_HANDOVER_RELEASED')
    or not exists (select 1 from public.shift_handover_audit_events where handover_id = v_handover.id and event_type = 'TEAM_HANDOVER_ACCEPTED')
    or not exists (select 1 from public.shift_handover_audit_events where handover_id = v_handover.id and event_type = 'AMENDMENT_ADDED') then
    raise exception 'Required lifecycle audit events are missing';
  end if;
end;
$$;

reset role;
select 'PASS: common submission, concurrency/idempotency contract, immutable snapshot, amendments, individual acceptance, multi-operator late-handover enforcement, notification deduplication, complete report projection, audit timeline, scope and supervisor oversight' as result;
rollback;
