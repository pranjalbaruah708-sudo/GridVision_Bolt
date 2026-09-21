-- DEV-safe validation for interruption and Station Condition duty enforcement.
-- All fixtures and writes are rolled back.
begin;

do $$
declare
  v_on_duty uuid := gen_random_uuid();
  v_pre_duty uuid := gen_random_uuid();
  v_unrostered uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();
  v_no_handover uuid := gen_random_uuid();
  v_late_pending uuid := gen_random_uuid();
  v_wrong_station uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_no_shift uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_station uuid := gen_random_uuid();
  v_other_station uuid := gen_random_uuid();
  v_no_shift_station uuid := gen_random_uuid();
  v_feeder uuid := gen_random_uuid();
  v_other_feeder uuid := gen_random_uuid();
  v_no_shift_feeder uuid := gen_random_uuid();
  v_outgoing uuid := gen_random_uuid();
  v_current uuid := gen_random_uuid();
  v_next uuid := gen_random_uuid();
  v_other_shift uuid := gen_random_uuid();
  v_outgoing_session uuid := gen_random_uuid();
  v_on_session uuid := gen_random_uuid();
  v_ended_session uuid := gen_random_uuid();
  v_no_handover_session uuid := gen_random_uuid();
  v_late_session uuid := gen_random_uuid();
  v_wrong_session uuid := gen_random_uuid();
  v_legacy_session uuid := gen_random_uuid();
  v_handover uuid := gen_random_uuid();
  v_condition public.station_conditions%rowtype;
  v_interruption uuid;
  v_tag text := 'duty-write-' || gen_random_uuid()::text;
  v_count integer;
begin
  insert into auth.users(id) values
    (v_on_duty), (v_pre_duty), (v_unrostered), (v_ended),
    (v_no_handover), (v_late_pending), (v_wrong_station),
    (v_legacy), (v_no_shift), (v_admin);

  insert into public.app_users(id, full_name, role, active) values
    (v_on_duty, 'Duty Write On Duty', 'OPERATOR', true),
    (v_pre_duty, 'Duty Write Pre Duty', 'OPERATOR', true),
    (v_unrostered, 'Duty Write Unrostered', 'OPERATOR', true),
    (v_ended, 'Duty Write Ended', 'OPERATOR', true),
    (v_no_handover, 'Duty Write No Handover', 'OPERATOR', true),
    (v_late_pending, 'Duty Write Late Pending', 'OPERATOR', true),
    (v_wrong_station, 'Duty Write Wrong Station', 'OPERATOR', true),
    (v_legacy, 'Duty Write Legacy', 'OPERATOR', true),
    (v_no_shift, 'Duty Write No Shift', 'OPERATOR', true),
    (v_admin, 'Duty Write Admin', 'ADMIN', true);

  insert into public.stations(id, code, name, active) values
    (v_station, left(v_tag || '-main', 60), 'Duty write main station', true),
    (v_other_station, left(v_tag || '-other', 60), 'Duty write other station', true),
    (v_no_shift_station, left(v_tag || '-none', 60), 'Duty write no-shift station', true);
  insert into public.feeders(id, station_id, code, name, active) values
    (v_feeder, v_station, left(v_tag || '-f1', 60), 'Duty write feeder', true),
    (v_other_feeder, v_other_station, left(v_tag || '-f2', 60), 'Duty write other feeder', true),
    (v_no_shift_feeder, v_no_shift_station, left(v_tag || '-f3', 60), 'Duty write no-shift feeder', true);

  insert into public.user_stations(user_id, station_id, active) values
    (v_on_duty, v_station, true),
    (v_pre_duty, v_station, true),
    (v_unrostered, v_station, true),
    (v_ended, v_station, true),
    (v_no_handover, v_station, true),
    (v_late_pending, v_station, true),
    (v_legacy, v_station, true),
    (v_wrong_station, v_other_station, true),
    (v_no_shift, v_no_shift_station, true);

  insert into public.station_shifts(id, station_id, shift_date, shift_name, scheduled_start, scheduled_end, status) values
    (v_outgoing, v_station, current_date, 'Duty write outgoing', now() - interval '2 hours', now() - interval '1 hour', 'ACTIVE'),
    (v_current, v_station, current_date, 'Duty write current', now() - interval '1 hour', now() + interval '1 hour', 'ACTIVE'),
    (v_next, v_station, current_date, 'Duty write next', now() + interval '1 hour', now() + interval '2 hours', 'SCHEDULED'),
    (v_other_shift, v_other_station, current_date, 'Duty write other', now() - interval '1 hour', now() + interval '1 hour', 'ACTIVE');

  insert into public.station_shift_assignments(shift_id, user_id, duty_role) values
    (v_outgoing, v_on_duty, 'MEMBER'),
    (v_current, v_on_duty, 'MEMBER'),
    (v_current, v_pre_duty, 'MEMBER'),
    (v_current, v_ended, 'MEMBER'),
    (v_current, v_no_handover, 'MEMBER'),
    (v_current, v_late_pending, 'MEMBER'),
    (v_current, v_legacy, 'MEMBER'),
    (v_next, v_on_duty, 'MEMBER'),
    (v_other_shift, v_wrong_station, 'MEMBER');

  insert into public.shift_duty_sessions(
    id, shift_id, station_id, user_id, shift_role, started_at, ended_at, status
  ) values
    (v_outgoing_session, v_outgoing, v_station, v_on_duty, 'MEMBER', now() - interval '110 minutes', now() - interval '65 minutes', 'ENDED'),
    (v_on_session, v_current, v_station, v_on_duty, 'MEMBER', now() - interval '55 minutes', null, 'ON_DUTY'),
    (v_ended_session, v_current, v_station, v_ended, 'MEMBER', now() - interval '50 minutes', now() - interval '10 minutes', 'ENDED'),
    (v_no_handover_session, v_current, v_station, v_no_handover, 'MEMBER', now() - interval '45 minutes', null, 'ON_DUTY'),
    (v_late_session, v_current, v_station, v_late_pending, 'MEMBER', now() - interval '40 minutes', null, 'ON_DUTY'),
    (v_wrong_session, v_other_shift, v_other_station, v_wrong_station, 'MEMBER', now() - interval '35 minutes', null, 'ON_DUTY'),
    (v_legacy_session, v_current, v_station, v_legacy, 'MEMBER', now() - interval '30 minutes', null, 'ON_DUTY');

  insert into public.shift_handovers(
    id, station_id, outgoing_shift_id, incoming_shift_id, status,
    prepared_by_user_id, submitted_by_user_id, submitted_at, snapshot,
    workflow_version, submitted_duty_session_id, initial_finalized_at
  ) values (
    v_handover, v_station, v_outgoing, v_current, 'SUBMITTED',
    v_on_duty, v_on_duty, now() - interval '50 minutes', '{}'::jsonb,
    2, v_outgoing_session, now() - interval '50 minutes'
  );

  insert into public.shift_duty_handover_states(
    duty_session_id, handover_id, shift_id, station_id, user_id, side, state,
    no_handover_acknowledged_at
  ) values
    (v_no_handover_session, null, v_current, v_station, v_no_handover, 'INCOMING', 'STARTED_WITHOUT_HANDOVER', now() - interval '45 minutes'),
    (v_late_session, v_handover, v_current, v_station, v_late_pending, 'INCOMING', 'LATE_HANDOVER_REVIEW_REQUIRED', now() - interval '40 minutes');

  -- A rostered, on-duty Operator can use direct interruption writes and the
  -- Station Condition RPC, including condition rectification.
  perform set_config('request.jwt.claims', json_build_object('sub', v_on_duty, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_station, v_feeder, v_on_duty, now() - interval '5 minutes', 'OPEN',
    'ONLINE', now(), v_tag || '-on-duty-int'
  ) returning id into v_interruption;
  update public.interruptions set etr = now() + interval '20 minutes' where id = v_interruption;
  update public.interruptions
  set interruption_end = now(), current_status = 'RESTORED', restore_client_operation_id = v_tag || '-restore'
  where id = v_interruption;
  select * into strict v_condition from public.create_station_condition(
    v_station, now() - interval '1 minute', 'STATION_CONDITION', 'ATTENTION',
    'Duty enforcement on-duty condition', v_tag || '-on-duty-condition', null, 'ONLINE', null
  );
  select * into strict v_condition from public.rectify_station_condition(v_condition.id);
  if v_condition.status <> 'RECTIFIED' then raise exception 'On-duty condition rectification failed'; end if;
  perform public.sync_historical_interruption(
    v_station, v_feeder, now() - interval '30 minutes', now() - interval '25 minutes',
    'Validation', 'On-duty offline replay', null,
    now() - interval '30 minutes', now() - interval '25 minutes',
    v_tag || '-on-duty-offline-add', v_tag || '-on-duty-offline-restore'
  );
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_station, v_feeder, v_on_duty, now() - interval '2 minutes', 'OPEN',
    'ONLINE', now(), v_tag || '-cancel-int'
  ) returning id into v_interruption;
  update public.interruptions
  set current_status = 'CANCELLED', remarks = 'Validation cancellation'
  where id = v_interruption;
  reset role;

  -- Rostered but not started is denied through both direct RLS and RPC paths.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pre_duty, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.interruptions(station_id, feeder_id, operator_id, interruption_start, current_status)
    values(v_station, v_feeder, v_pre_duty, now(), 'OPEN');
    raise exception 'Pre-duty Operator inserted an interruption';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_station_condition(
      v_station, now(), 'OTHER', 'ATTENTION', 'Must be denied', v_tag || '-pre-condition', null, 'ONLINE', null
    );
    raise exception 'Pre-duty Operator created a Station Condition';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sync_historical_interruption(
      v_station, v_feeder, now() - interval '10 minutes', now() - interval '5 minutes',
      null, null, null, now() - interval '10 minutes', now() - interval '5 minutes',
      v_tag || '-pre-offline-add', v_tag || '-pre-offline-restore'
    );
    raise exception 'Pre-duty offline replay bypassed server authorization';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Assigned but unrostered, ended-duty, and wrong-station Operators are denied.
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrostered, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.interruptions(station_id, feeder_id, operator_id, interruption_start, current_status)
    values(v_station, v_feeder, v_unrostered, now(), 'OPEN');
    raise exception 'Unrostered Operator inserted an interruption';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ended, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_station_condition(
      v_station, now(), 'OTHER', 'ATTENTION', 'Ended duty must be denied', v_tag || '-ended-condition', null, 'OFFLINE', now() - interval '1 minute'
    );
    raise exception 'Ended-duty Operator replayed a Station Condition';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_wrong_station, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.interruptions(station_id, feeder_id, operator_id, interruption_start, current_status)
    values(v_station, v_feeder, v_wrong_station, now(), 'OPEN');
    raise exception 'Wrong-station Operator inserted an interruption';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- An active session created without a handover and a late-handover-pending
  -- session remain authorized for operational entry.
  perform set_config('request.jwt.claims', json_build_object('sub', v_no_handover, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_station, v_feeder, v_no_handover, now() - interval '4 minutes', 'OPEN',
    'OFFLINE', now() - interval '4 minutes', v_tag || '-no-handover-int'
  ) returning id into v_interruption;
  update public.interruptions
  set interruption_end = now(), current_status = 'RESTORED',
      restore_client_operation_id = v_tag || '-no-handover-restore'
  where id = v_interruption;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_late_pending, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_station_condition(
    v_station, now(), 'OTHER', 'ATTENTION', 'Late pending remains operationally authorized',
    v_tag || '-late-condition', null, 'ONLINE', null
  );
  begin
    perform public.end_duty_and_handover_shift_v2(v_late_session, v_next, gen_random_uuid(), null);
    raise exception 'Late-pending Operator ended duty';
  exception when object_not_in_prerequisite_state then null;
  end;
  reset role;

  -- A legacy-started ON_DUTY session remains compatible.
  perform set_config('request.jwt.claims', json_build_object('sub', v_legacy, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_station, v_feeder, v_legacy, now() - interval '3 minutes', 'OPEN',
    'ONLINE', now(), v_tag || '-legacy-int'
  );
  reset role;

  -- A different rostered, on-duty Operator can restore a station interruption
  -- without changing the original operator attribution.
  perform set_config('request.jwt.claims', json_build_object('sub', v_late_pending, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.interruptions
  set etr = now() + interval '15 minutes', interruption_end = now(), current_status = 'RESTORED',
      restore_client_operation_id = v_tag || '-cross-operator-restore'
  where client_operation_id = v_tag || '-legacy-int';
  if not found then raise exception 'On-duty station Operator could not restore another Operator''s interruption'; end if;
  begin
    update public.interruptions
    set operator_id = v_late_pending
    where client_operation_id = v_tag || '-legacy-int';
    raise exception 'Operator attribution was changed by a client update';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Existing assigned-Operator behavior remains when no shift is applicable.
  perform set_config('request.jwt.claims', json_build_object('sub', v_no_shift, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_no_shift_station, v_no_shift_feeder, v_no_shift, now() - interval '2 minutes', 'OPEN',
    'ONLINE', now(), v_tag || '-no-shift-int'
  );
  reset role;

  -- Direct Station Condition table writes remain unavailable to authenticated
  -- clients even when the Operator is on duty.
  perform set_config('request.jwt.claims', json_build_object('sub', v_on_duty, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.station_conditions(
      station_id, observed_at, category, condition, observation,
      recorded_by, client_operation_id, entry_mode, recorded_at
    ) values (
      v_station, now(), 'OTHER', 'ATTENTION', 'Direct bypass',
      v_on_duty, v_tag || '-direct-condition', 'ONLINE', now()
    );
    raise exception 'Authenticated client directly inserted Station Condition';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Supervisory read behavior is unchanged.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.interruptions where station_id = v_station;
  if v_count < 3 then raise exception 'Admin interruption visibility changed unexpectedly'; end if;
  reset role;

  -- System/service-role table processing bypasses RLS and is not treated as an
  -- application Operator write by the trigger.
  perform set_config('request.jwt.claims', '{}'::text, true);
  set local role service_role;
  insert into public.interruptions(
    station_id, feeder_id, operator_id, interruption_start, current_status,
    entry_mode, recorded_at, client_operation_id
  ) values (
    v_other_station, v_other_feeder, null, now(), 'CANCELLED',
    'ONLINE', now(), v_tag || '-service-int'
  );
  reset role;
end;
$$;

reset role;
select 'PASS: on-duty interruption/condition writes, pre-duty/unrostered/ended/wrong-station denial, V2 no-handover and late-pending entry, late duty-end block, legacy compatibility, offline replay revalidation, direct-table denial, supervisory read and service-role preservation' as result;
rollback;
