-- Shutdown Management database authorization regression test.
-- DEV only: run only after verifying the linked ref is eetlzxntgvjompmipprb.
-- This script is intentionally transactional and always ends with ROLLBACK.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(p_sql text, p_expected_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_expected_message) in lower(sqlerrm)) > 0 then
      return;
    end if;
    raise exception 'ASSERTION FAILED: expected error containing "%", received "%"',
      p_expected_message, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: expected error containing "%", but statement succeeded',
    p_expected_message;
end;
$$;

-- Resolve identities from authoritative DEV application data; UUIDs are not embedded.
do $$
declare
  v_operator_a uuid;
  v_operator_b uuid;
  v_officer_a uuid;
  v_admin uuid;
begin
  select id into strict v_operator_a from public.app_users
    where lower(email) = lower('houstan.op@GridVision.com') and active and role = 'OPERATOR';
  select id into strict v_operator_b from public.app_users
    where lower(email) = lower('pranzalbaruah@rediffmail.com') and active and role = 'OPERATOR';
  select id into strict v_officer_a from public.app_users
    where lower(email) = lower('testofficer@gridvision.com') and active and role = 'FIELD_OFFICER';
  select id into strict v_admin from public.app_users
    where lower(email) = lower('admin@example.com') and active and role = 'ADMIN';

  perform set_config('shutdown_test.operator_a', v_operator_a::text, true);
  perform set_config('shutdown_test.operator_b', v_operator_b::text, true);
  perform set_config('shutdown_test.officer_a', v_officer_a::text, true);
  perform set_config('shutdown_test.admin', v_admin::text, true);
  perform set_config('shutdown_test.run_tag', 'shutdown-security-' || txid_current()::text, true);
exception
  when no_data_found then
    raise exception 'ASSERTION FAILED: a required active DEV identity with its expected role is missing';
  when too_many_rows then
    raise exception 'ASSERTION FAILED: a required DEV identity email is not unique';
end;
$$;

select pg_temp.assert_true(
  exists(select 1 from public.stations where id='f41b520a-3cc7-41d4-82de-3ca74f7f2347' and name='Houston Central Substation' and active),
  'Station A must be the active Houston Central Substation');
select pg_temp.assert_true(
  exists(select 1 from public.stations where id='9af902b7-688d-4b13-90ce-8dc113d63124' and name='Miami South Substation' and active),
  'Station B must be the active Miami South Substation');
select pg_temp.assert_true(
  exists(select 1 from public.feeders where id='c0721279-033d-4096-9226-5e49c0f49517' and station_id='f41b520a-3cc7-41d4-82de-3ca74f7f2347' and name='Downtown Feeder' and active),
  'Feeder A must be active and belong to Station A');
select pg_temp.assert_true(
  exists(select 1 from public.feeders where id='b8aa25ec-dd26-4377-9048-27a05afa2528' and station_id='9af902b7-688d-4b13-90ce-8dc113d63124' and name='Miami South Feeder' and active),
  'Feeder B must be active and belong to Station B');

-- Base rows are inserted as the database owner only to arrange the test. All
-- authorization assertions below execute as authenticated, never service_role.
insert into public.shutdown_requests (
  id, sd_number, station_id, feeder_id, equipment_name, shutdown_type, purpose,
  work_description, planned_start, expected_restoration, status, requested_by, requested_at
)
values
  (gen_random_uuid(), current_setting('shutdown_test.run_tag')||'-A-OWN',
   'f41b520a-3cc7-41d4-82de-3ca74f7f2347','c0721279-033d-4096-9226-5e49c0f49517',
   current_setting('shutdown_test.run_tag')||'-Houston-Own','Planned','Testing','Database authorization test',now()+interval '1 day',now()+interval '1 day 2 hours','PENDING_APPROVAL',current_setting('shutdown_test.operator_a')::uuid,now()),
  (gen_random_uuid(), current_setting('shutdown_test.run_tag')||'-A-OTHER',
   'f41b520a-3cc7-41d4-82de-3ca74f7f2347','c0721279-033d-4096-9226-5e49c0f49517',
   current_setting('shutdown_test.run_tag')||'-Houston-Other','Planned','Testing','Database authorization test',now()+interval '2 days',now()+interval '2 days 2 hours','PENDING_APPROVAL',current_setting('shutdown_test.operator_b')::uuid,now()),
  (gen_random_uuid(), current_setting('shutdown_test.run_tag')||'-B-OTHER',
   '9af902b7-688d-4b13-90ce-8dc113d63124','b8aa25ec-dd26-4377-9048-27a05afa2528',
   current_setting('shutdown_test.run_tag')||'-Miami','Planned','Testing','Database authorization test',now()+interval '3 days',now()+interval '3 days 2 hours','PENDING_APPROVAL',current_setting('shutdown_test.operator_b')::uuid,now());

select set_config('shutdown_test.a_own', id::text, true) from public.shutdown_requests
 where sd_number=current_setting('shutdown_test.run_tag')||'-A-OWN';
select set_config('shutdown_test.a_other', id::text, true) from public.shutdown_requests
 where sd_number=current_setting('shutdown_test.run_tag')||'-A-OTHER';
select set_config('shutdown_test.b_other', id::text, true) from public.shutdown_requests
 where sd_number=current_setting('shutdown_test.run_tag')||'-B-OTHER';

-- Operator A context and direct table RLS/privilege checks.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.operator_a'),'role','authenticated')::text, true);
select pg_temp.assert_true(auth.uid()=current_setting('shutdown_test.operator_a')::uuid,'auth.uid must resolve Operator A');
select pg_temp.assert_true((select count(*)=2 from public.shutdown_requests where sd_number like current_setting('shutdown_test.run_tag')||'%'),'Operator A sees own and permitted Houston rows only');
select pg_temp.assert_true(not exists(select 1 from public.shutdown_requests where id=current_setting('shutdown_test.b_other')::uuid),'Operator A cannot see another user Miami row');
select pg_temp.expect_error(format($sql$insert into public.shutdown_requests(sd_number,station_id,shutdown_type,purpose,work_description,planned_start,expected_restoration,requested_by) values(%L,%L::uuid,'Planned','Testing','Denied',now()+interval '1 day',now()+interval '2 days',%L::uuid)$sql$,current_setting('shutdown_test.run_tag')||'-DIRECT', 'f41b520a-3cc7-41d4-82de-3ca74f7f2347',current_setting('shutdown_test.operator_a')),'permission denied');
select pg_temp.expect_error(format('update public.shutdown_requests set remarks=%L where id=%L::uuid','Denied',current_setting('shutdown_test.a_own')),'permission denied');
select pg_temp.expect_error(format('delete from public.shutdown_requests where id=%L::uuid',current_setting('shutdown_test.a_own')),'permission denied');

-- Operator A mutation RPC coverage.
select set_config('shutdown_test.valid_create', (public.create_shutdown_request(
  'f41b520a-3cc7-41d4-82de-3ca74f7f2347','c0721279-033d-4096-9226-5e49c0f49517','Validation transformer','Planned','Testing','Valid create',now()+interval '4 days',now()+interval '4 days 2 hours','transactional test')).id::text, true);
select pg_temp.assert_true(exists(select 1 from public.shutdown_requests where id=current_setting('shutdown_test.valid_create')::uuid and requested_by=auth.uid() and status='PENDING_APPROVAL' and sd_number ~ '^SD-[0-9]{4}-[0-9]{6}$'),'create RPC controls requester, initial status and SD number');
select pg_temp.expect_error($sql$select public.create_shutdown_request('9af902b7-688d-4b13-90ce-8dc113d63124','b8aa25ec-dd26-4377-9048-27a05afa2528','Out of scope','Planned','Testing','Denied',now()+interval '4 days',now()+interval '4 days 2 hours',null)$sql$,'outside your authorized scope');
select pg_temp.expect_error($sql$select public.create_shutdown_request('f41b520a-3cc7-41d4-82de-3ca74f7f2347','b8aa25ec-dd26-4377-9048-27a05afa2528','Mismatch','Planned','Testing','Denied',now()+interval '4 days',now()+interval '4 days 2 hours',null)$sql$,'does not belong');
select pg_temp.expect_error(format('select public.approve_shutdown_request(%L::uuid,null)',current_setting('shutdown_test.a_other')),'approval permission');

-- Operator A read RPC coverage, isolated by the run tag.
select pg_temp.assert_true((select count(*)=2 from public.list_shutdown_dashboard_requests(p_search=>current_setting('shutdown_test.run_tag'),p_limit=>100)),'Operator A dashboard RPC is station scoped');
select pg_temp.assert_true((select count(*)=1 and min(total_count)=2 from public.list_shutdown_dashboard_requests(p_search=>current_setting('shutdown_test.run_tag'),p_limit=>1,p_offset=>1)),'dashboard pagination and total_count work');
select pg_temp.expect_error($sql$select * from public.list_shutdown_dashboard_requests(p_limit=>0)$sql$,'Invalid pagination');
select pg_temp.assert_true((select count(*)=1 from public.list_my_shutdown_requests(p_search=>current_setting('shutdown_test.run_tag'),p_limit=>100)),'My Requests is owner-only');
select pg_temp.assert_true((select can_decide=false from public.get_shutdown_request(current_setting('shutdown_test.a_own')::uuid)),'owner detail cannot decide');
select pg_temp.expect_error(format('select * from public.get_shutdown_request(%L::uuid)',current_setting('shutdown_test.b_other')),'outside your authorized scope');
select pg_temp.assert_true((select count(*)=1 from public.list_shutdown_report_requests(p_station_id=>'f41b520a-3cc7-41d4-82de-3ca74f7f2347',p_feeder_id=>'c0721279-033d-4096-9226-5e49c0f49517',p_equipment=>current_setting('shutdown_test.run_tag')||'-Houston-Own',p_requester=>current_setting('shutdown_test.operator_a')::uuid,p_limit=>10)),'report filters return the intended in-scope row');
select pg_temp.assert_true((select total=(select count(*) from public.shutdown_requests) from public.get_shutdown_dashboard_kpis()),'Operator A KPI total matches its RLS-visible station scope');

-- Operator B context.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.operator_b'),'role','authenticated')::text, true);
select pg_temp.assert_true(auth.uid()=current_setting('shutdown_test.operator_b')::uuid,'auth.uid must resolve Operator B');
select pg_temp.assert_true(exists(select 1 from public.shutdown_requests where id=current_setting('shutdown_test.b_other')::uuid),'Operator B sees permitted Miami row');
select pg_temp.assert_true(not exists(select 1 from public.shutdown_requests where id=current_setting('shutdown_test.a_own')::uuid),'Operator B cannot see another user Houston row');
select pg_temp.assert_true((select count(*)=1 from public.list_shutdown_dashboard_requests(p_search=>current_setting('shutdown_test.run_tag'),p_limit=>100)),'Operator B dashboard is Miami scoped');

-- Officer A context: organisation-derived Houston scope.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.officer_a'),'role','authenticated')::text, true);
select pg_temp.assert_true(auth.uid()=current_setting('shutdown_test.officer_a')::uuid,'auth.uid must resolve Officer A');
do $$
declare
  v_expected_count constant integer := 2;
  v_actual_count integer;
  v_accessible_station_ids uuid[];
  v_houston_in_scope boolean;
  v_miami_in_scope boolean;
  v_officer_uuid uuid := current_setting('shutdown_test.officer_a')::uuid;
  v_auth_uid uuid := auth.uid();
  v_jwt_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_visible_tagged_rows jsonb;
begin
  select coalesce(array_agg(scope.station_id order by scope.station_id), array[]::uuid[])
    into v_accessible_station_ids
  from public.get_my_operational_station_ids() scope;

  v_houston_in_scope := 'f41b520a-3cc7-41d4-82de-3ca74f7f2347'::uuid = any(v_accessible_station_ids);
  v_miami_in_scope := '9af902b7-688d-4b13-90ce-8dc113d63124'::uuid = any(v_accessible_station_ids);

  select count(*)
    into v_actual_count
  from public.shutdown_requests sr
  where sr.sd_number like current_setting('shutdown_test.run_tag')||'%'
    and sr.station_id = 'f41b520a-3cc7-41d4-82de-3ca74f7f2347';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'station_id', sr.station_id,
        'requested_by', sr.requested_by,
        'status', sr.status
      ) order by sr.sd_number
    ),
    '[]'::jsonb
  )
    into v_visible_tagged_rows
  from public.shutdown_requests sr
  where sr.sd_number like current_setting('shutdown_test.run_tag')||'%';

  if v_actual_count <> v_expected_count then
    raise exception using message = format(
      'ASSERTION FAILED: Officer A Houston visibility expected_count=%s actual_count=%s houston_in_scope=%s miami_in_scope=%s officer_uuid=%s auth_uid=%s jwt_role=%s jwt_sub=%s accessible_station_ids=%s visible_tagged_rows=%s',
      v_expected_count,
      v_actual_count,
      v_houston_in_scope,
      v_miami_in_scope,
      v_officer_uuid,
      v_auth_uid,
      v_jwt_claims->>'role',
      v_jwt_claims->>'sub',
      v_accessible_station_ids,
      v_visible_tagged_rows
    );
  end if;

  raise notice 'Officer A Houston visibility diagnostic: expected_count=% actual_count=% houston_in_scope=% miami_in_scope=% officer_uuid=% auth_uid=% jwt_role=% jwt_sub=% accessible_station_ids=% visible_tagged_rows=%',
    v_expected_count, v_actual_count, v_houston_in_scope, v_miami_in_scope,
    v_officer_uuid, v_auth_uid, v_jwt_claims->>'role', v_jwt_claims->>'sub',
    v_accessible_station_ids, v_visible_tagged_rows;
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.shutdown_requests where id=current_setting('shutdown_test.b_other')::uuid),'Officer A cannot see Miami row');
select pg_temp.assert_true((select can_decide from public.get_shutdown_request(current_setting('shutdown_test.a_own')::uuid)),'Officer A can_decide is true for another user Houston request');
select pg_temp.assert_true((select status='APPROVED' and decision_by=auth.uid() from public.approve_shutdown_request(current_setting('shutdown_test.valid_create')::uuid,'Approved by database test')),'Officer A can approve Houston request');
select pg_temp.expect_error(format('select public.reject_shutdown_request(%L::uuid,%L)',current_setting('shutdown_test.valid_create'),'Late decision'),'already been decided');
select pg_temp.expect_error(format('select public.approve_shutdown_request(%L::uuid,null)',current_setting('shutdown_test.b_other')),'outside your authorized scope');

select set_config('shutdown_test.officer_own', (public.create_shutdown_request(
  'f41b520a-3cc7-41d4-82de-3ca74f7f2347','c0721279-033d-4096-9226-5e49c0f49517','Officer fixture','Planned','Testing','Self approval test',now()+interval '5 days',now()+interval '5 days 2 hours',null)).id::text, true);
select pg_temp.expect_error(format('select public.approve_shutdown_request(%L::uuid,null)',current_setting('shutdown_test.officer_own')),'cannot decide your own');

-- Create a rejection candidate as Operator A, then return to Officer A.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.operator_a'),'role','authenticated')::text, true);
select set_config('shutdown_test.reject_candidate', (public.create_shutdown_request(
  'f41b520a-3cc7-41d4-82de-3ca74f7f2347','c0721279-033d-4096-9226-5e49c0f49517','Reject fixture','Planned','Testing','Reject test',now()+interval '6 days',now()+interval '6 days 2 hours',null)).id::text, true);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.officer_a'),'role','authenticated')::text, true);
select pg_temp.expect_error(format('select public.reject_shutdown_request(%L::uuid,%L)',current_setting('shutdown_test.reject_candidate'),'   '),'remarks are required');
select pg_temp.assert_true((select status='REJECTED' and decision_by=auth.uid() from public.reject_shutdown_request(current_setting('shutdown_test.reject_candidate')::uuid,'Rejected by database test')),'Officer A can reject with nonblank remarks');
select pg_temp.expect_error(format('select public.approve_shutdown_request(%L::uuid,null)',current_setting('shutdown_test.reject_candidate')),'already been decided');

-- Admin receives the established all-active-stations scope.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('shutdown_test.admin'),'role','authenticated')::text, true);
select pg_temp.assert_true(auth.uid()=current_setting('shutdown_test.admin')::uuid,'auth.uid must resolve Admin');
select pg_temp.assert_true((select count(*)=(select count(*) from public.stations where active) from public.get_my_accessible_station_ids()),'Admin receives all active stations');
select pg_temp.assert_true((select count(*)=3 from public.list_shutdown_dashboard_requests(p_search=>current_setting('shutdown_test.run_tag'),p_limit=>100)),'Admin dashboard sees both fixture stations');

reset role;
rollback;
