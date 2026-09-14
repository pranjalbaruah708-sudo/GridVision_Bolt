-- Run only with --project-ref eetlzxntgvjompmipprb. All fixtures roll back,
-- including notification side effects from the existing source triggers.
begin;
do $$
declare
  u uuid := gen_random_uuid(); other_u uuid := gen_random_uuid(); officer uuid := gen_random_uuid(); admin_u uuid := gen_random_uuid();
  station_a uuid := gen_random_uuid(); station_b uuid := gen_random_uuid(); feeder uuid := gen_random_uuid();
  office_a uuid := gen_random_uuid(); office_child uuid := gen_random_uuid(); office_b uuid := gen_random_uuid();
  shift_a uuid := gen_random_uuid(); shift_b uuid := gen_random_uuid(); log_id uuid := gen_random_uuid();
  tag text := 'operational-test-' || gen_random_uuid()::text;
  event_at timestamptz := ((now() at time zone 'Asia/Kolkata')::date-1)::timestamp at time zone 'Asia/Kolkata';
  day date := (now() at time zone 'Asia/Kolkata')::date-1;
  c public.station_conditions; replay public.station_conditions; summary record; n integer; page1 uuid; page2 uuid;
begin
  insert into auth.users(id) values(u),(other_u),(officer),(admin_u);
  insert into public.app_users(id,full_name,role) values(u,tag,'OPERATOR'),(other_u,tag,'OPERATOR'),(officer,tag,'FIELD_OFFICER'),(admin_u,tag,'ADMIN')
    on conflict(id) do update set role=excluded.role,active=true;
  insert into public.stations(id,code,name) values(station_a,tag||'-a',tag),(station_b,tag||'-b',tag);
  insert into public.feeders(id,station_id,code,name) values(feeder,station_a,tag,tag);
  insert into public.org_units(id,code,name,unit_type,parent_id) values
    (office_a,tag||'-office',tag,'DIVISION',null),(office_child,tag||'-child',tag,'SUB_DIVISION',office_a),(office_b,tag||'-remote',tag,'DIVISION',null);
  insert into public.station_org_units(station_id,org_unit_id) values(station_a,office_a),(station_a,office_child),(station_b,office_b);
  insert into public.user_stations(user_id,station_id) values(u,station_a),(other_u,station_b);
  insert into public.user_org_units(user_id,org_unit_id) values(officer,office_a);
  -- Source fixtures exercise independent start/end boundaries and all event types.
  insert into public.log_book_entries(id,station_id,feeder_id,operator_id,actual_event_time,remarks)
    values(log_id,station_a,feeder,u,event_at,tag);
  insert into public.feeder_thresholds(feeder_id,parameter_code,min_value,max_value) values(feeder,'MW',null,10);
  insert into public.parameter_alerts(log_book_entry_id,station_id,feeder_id,threshold_id,parameter_code,actual_value,min_value,max_value,breach_type,triggered_at)
    select log_id,station_a,feeder,id,'MW',11,null,10,'ABOVE_MAX',event_at from public.feeder_thresholds where feeder_id=feeder;
  insert into public.interruptions(station_id,feeder_id,operator_id,interruption_start,interruption_end,current_status,entry_mode)
    values(station_a,feeder,u,event_at-interval '1 hour',event_at+interval '1 hour','RESTORED','OFFLINE');
  insert into public.station_shifts(id,station_id,shift_date,shift_name,scheduled_start,scheduled_end) values
    (shift_a,station_a,day,tag,event_at,event_at+interval '8 hours'),
    (shift_b,station_a,day,tag,event_at+interval '8 hours',event_at+interval '16 hours');
  insert into public.shift_duty_sessions(shift_id,station_id,user_id,started_at,ended_at,status)
    values(shift_a,station_a,u,event_at,event_at+interval '8 hours','ENDED');
  insert into public.shift_handovers(station_id,outgoing_shift_id,incoming_shift_id,status,submitted_by_user_id,submitted_at,accepted_by_user_id,accepted_at)
    values(station_a,shift_a,shift_b,'ACCEPTED',u,event_at+interval '7 hours',u,event_at+interval '8 hours');

  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  c := public.create_station_condition(station_a,event_at,'DEFECT','ATTENTION',tag,tag,null,'OFFLINE',event_at);
  if c.recorded_by<>u or c.synced_at is null or c.recorded_at<>event_at then raise exception 'Recorder/provenance failed'; end if;
  replay := public.create_station_condition(station_a,event_at,'DEFECT','ATTENTION',tag,tag,null,'OFFLINE',event_at);
  if replay.id<>c.id then raise exception 'Idempotency failed'; end if;
  begin
    perform public.create_station_condition(station_a,event_at,'DEFECT','ABNORMAL',tag,tag);
    raise exception 'Conflicting replay accepted';
  exception when unique_violation then null; end;
  begin
    perform public.create_station_condition(station_b,event_at,'OTHER','NORMAL',tag,tag||'-outside');
    raise exception 'Out-of-scope write accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.station_conditions set recorded_by=other_u where id=c.id;
    raise exception 'Direct recorder reassignment accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.station_conditions(station_id,observed_at,category,condition,observation,recorded_by,client_operation_id)
      values(station_a,event_at,'OTHER','NORMAL',tag,other_u,tag||'-spoof');
    raise exception 'Direct impersonation accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_station_condition(station_a,event_at,'INVALID','NORMAL',tag,tag||'-invalid');
    raise exception 'Invalid category accepted';
  exception when check_violation then null; end;

  select * into summary from public.get_operational_summary('CUSTOM',day,day,station_a);
  if summary.parameter_entries<>1 or summary.interruptions_started<>0 or summary.restorations<>1 or summary.alerts<>1
    or summary.conditions_observed<>1 or summary.current_open_conditions<>1 or summary.duty_starts<>1 or summary.duty_ends<>1
    or summary.handovers_submitted<>1 or summary.handovers_accepted<>1 or summary.station_count<>1 then
    raise exception 'Source counts/boundaries failed: %',row_to_json(summary);
  end if;
  select count(*) into n from public.get_operational_timeline('CUSTOM',day,day,station_a);
  if n<>8 then raise exception 'Timeline source count failed: %',n; end if;
  select source_id into page1 from public.get_operational_timeline('CUSTOM',day,day,station_a,null,1,0);
  select source_id into page2 from public.get_operational_timeline('CUSTOM',day,day,station_a,null,1,1);
  if page1 is null or page2 is null or page1=page2 then raise exception 'Pagination failed'; end if;
  -- Same timestamp/source sorting is deterministic under unchanged sources.
  if page1 is distinct from (select source_id from public.get_operational_timeline('CUSTOM',day,day,station_a,null,1,0)) then raise exception 'Unstable ordering'; end if;
  select * into summary from public.get_operational_summary('CUSTOM',day-1,day-1,station_a);
  if summary.conditions_observed<>0 or summary.current_open_conditions<>1 or summary.interruptions_started<>1 or summary.restorations<>0 then raise exception 'Current/open or cross-day semantics failed'; end if;
  replay := public.rectify_station_condition(c.id);
  if replay.rectified_by<>u or replay.rectified_at is null or replay.status<>'RECTIFIED' then raise exception 'Rectification failed'; end if;
  if (public.rectify_station_condition(c.id)).rectified_at<>replay.rectified_at then raise exception 'Rectification replay changed timestamp'; end if;
  begin
    perform public.get_operational_timeline('CUSTOM',day,day,station_a,null,201);
    raise exception 'Unbounded limit accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_operational_timeline('CUSTOM',day,day,station_a,null,10,-1);
    raise exception 'Negative offset accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_operational_summary('CUSTOM',day-366,day,station_a);
    raise exception 'Oversized period accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_operational_summary('CUSTOM',day,day,station_b);
    raise exception 'Out-of-scope read accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_operational_summary('CUSTOM',day,day,null,office_a);
    raise exception 'Operator office scope accepted';
  exception when insufficient_privilege then null; end;
  select * into summary from public.get_operational_summary('TODAY',null,null,station_a);
  if summary.start_at<>((day+1)::timestamp at time zone 'Asia/Kolkata') then raise exception 'Today IST boundary failed'; end if;
  select * into summary from public.get_operational_summary('THIS_MONTH',null,null,station_a);
  if summary.start_at<>(date_trunc('month',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') then raise exception 'Month IST boundary failed'; end if;

  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',officer,'role','authenticated')::text,true);
  set local role authenticated;
  select * into summary from public.get_operational_summary('CUSTOM',day,day,null,office_a);
  if summary.station_count<>1 or summary.conditions_observed<>1 then raise exception 'Office mapping deduplication failed'; end if;
  if exists(select 1 from public.get_operational_scope_options() where scope_id=office_b) then raise exception 'Office options leak'; end if;
  -- New operational choices use their dedicated authority, independently of
  -- the global helper used by established features.
  if exists(select scope_id from public.get_operational_scope_options() where scope_kind='STATION'
    except select station_id from public.get_my_operational_station_ids())
    or exists(select station_id from public.get_my_operational_station_ids()
    except select scope_id from public.get_operational_scope_options() where scope_kind='STATION') then
    raise exception 'Station options differ from authoritative helper';
  end if;
  begin
    perform public.get_operational_summary('TODAY',null,null,null,office_b);
    raise exception 'Out-of-scope office accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.rectify_station_condition(c.id);
    raise exception 'Officer write accepted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',other_u,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.station_conditions where id=c.id) then raise exception 'Direct RLS leak'; end if;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',admin_u,'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_operational_scope_options() where label='Entire Utility') then raise exception 'Admin label failed'; end if;
  select * into summary from public.get_operational_summary('CUSTOM',day,day,station_a);
  if summary.conditions_observed<>1 then raise exception 'Admin read failed'; end if;
  begin
    perform public.create_station_condition(station_a,event_at,'OTHER','NORMAL',tag,tag||'-admin');
    raise exception 'Admin write accepted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('app.allow_privileged_app_user_update','true',true);
  update public.app_users set active=false where id=u;
  perform set_config('app.allow_privileged_app_user_update','false',true);
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.get_operational_summary('TODAY');
    raise exception 'Inactive user read accepted';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin
    perform public.get_operational_timeline('TODAY');
    raise exception 'Anonymous read accepted';
  exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
select 'PASS: condition lifecycle/replay, RLS, role/office scope, all source counts, IST bounds and pagination; fixtures rolled back' as result;
rollback;
