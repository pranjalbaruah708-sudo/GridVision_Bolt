-- DEV only; validates the FINAL broad/narrow split. All fixtures roll back.
begin;
do $$
declare
  officer uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outside_s uuid:=gen_random_uuid();
  office uuid:=gen_random_uuid(); child uuid:=gen_random_uuid();
  fa uuid:=gen_random_uuid(); fb uuid:=gen_random_uuid(); fx uuid:=gen_random_uuid();
  request_a uuid:=gen_random_uuid(); request_x uuid:=gen_random_uuid();
  live_shift uuid:=gen_random_uuid(); duty public.shift_duty_sessions;
  tag text:='scope35d-'||gen_random_uuid(); t timestamptz:=now()-interval '1 day';
  day date:=(now() at time zone 'Asia/Kolkata')::date-1;
  n bigint; result record;
begin
  insert into auth.users(id) values(officer),(op);
  insert into public.app_users(id,full_name,role) values(officer,tag,'FIELD_OFFICER'),(op,tag,'OPERATOR');
  insert into public.org_units(id,code,name,unit_type,parent_id) values
    (office,tag||'root',tag,'DIVISION',null),(child,tag||'child',tag,'SUB_DIVISION',office);
  insert into public.stations(id,code,name) values(a,tag||'a',tag),(b,tag||'b',tag),(outside_s,tag||'x',tag);
  insert into public.station_org_units(station_id,org_unit_id) values(a,office),(b,child);
  insert into public.user_org_units(user_id,org_unit_id) values(officer,office);
  insert into public.user_stations(user_id,station_id) values(op,a);
  insert into public.feeders(id,station_id,code,name) values(fa,a,tag||'a',tag),(fb,b,tag||'b',tag),(fx,outside_s,tag||'x',tag);
  insert into public.log_book_entries(station_id,feeder_id,operator_id,actual_event_time,mw,remarks)
    values(a,fa,op,t,1,tag),(b,fb,op,t,1,tag),(outside_s,fx,op,t,1,tag);
  insert into public.interruptions(station_id,feeder_id,operator_id,interruption_start,interruption_end,current_status,entry_mode,remarks)
    values(a,fa,op,t,t+interval '1 hour','RESTORED','OFFLINE',tag),(outside_s,fx,op,t,t+interval '1 hour','RESTORED','OFFLINE',tag);
  insert into public.station_shifts(station_id,shift_date,shift_name,scheduled_start,scheduled_end)
    values(a,day,tag,t,t+interval '8 hours'),(b,day,tag,t,t+interval '8 hours'),(outside_s,day,tag,t,t+interval '8 hours');
  insert into public.station_shifts(id,station_id,shift_date,shift_name,scheduled_start,scheduled_end)
    values(live_shift,a,day+1,tag||'live',now()-interval '1 hour',now()+interval '1 hour');
  insert into public.shutdown_requests(id,sd_number,station_id,shutdown_type,purpose,work_description,planned_start,expected_restoration,requested_by)
    values(request_a,tag||'a',a,'Planned','Testing',tag,now()+interval '1 day',now()+interval '2 days',op),
      (request_x,tag||'x',outside_s,'Planned','Testing',tag,now()+interval '1 day',now()+interval '2 days',op);
  perform set_config('request.jwt.claims',json_build_object('sub',officer,'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_my_accessible_station_ids() where station_id=outside_s) then raise exception 'Global must allow unrelated active station'; end if;
  if exists(select 1 from public.get_my_operational_station_ids() where station_id=outside_s)
    or (select count(*) from public.get_my_operational_station_ids())<>2 then raise exception 'Operational scope wrong'; end if;
  select count(*) into n from public.stations where active;
  select * into result from public.get_dashboard_operational_summary(t-interval '1 hour',t+interval '2 hours');
  if result.total_stations<>n then raise exception 'Dashboard not broad'; end if;
  if not exists(select 1 from public.get_load_analysis_station_ranking(t-interval '1 hour',t+interval '2 hours') where station_id=outside_s) then raise exception 'Analytics not broad'; end if;
  begin perform * from public.get_operational_timeline('CUSTOM',day,day,outside_s); raise exception 'Timeline leaked'; exception when insufficient_privilege then null; end;
  begin perform * from public.get_operational_summary('CUSTOM',day,day,outside_s); raise exception 'Summary leaked'; exception when insufficient_privilege then null; end;
  begin perform * from public.get_station_shift_history(outside_s); raise exception 'Shift history leaked'; exception when insufficient_privilege then null; end;
  begin perform * from public.get_station_shift_compliance(outside_s,day,day); raise exception 'Shift report leaked'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.get_station_shift_history(b))<>1 then raise exception 'Descendant Shift missing'; end if;
  if (select count(*) from public.station_shifts where shift_name=tag)<>2 then raise exception 'Shift RLS leak'; end if;
  if (select count(*) from public.scoped_logbook_report_entries where remarks=tag)<>2 then raise exception 'Logbook detail scope wrong'; end if;
  if exists(select 1 from public.scoped_interruption_report_entries where station_id=outside_s) then raise exception 'Interruption detail leaked'; end if;
  select * into result from public.get_logbook_report_summary(t-interval '1 hour',t+interval '2 hours',outside_s);
  if result.entered_readings<>0 then raise exception 'Logbook report leaked'; end if;
  select * into result from public.get_logbook_report_summary(t-interval '1 hour',t+interval '2 hours',b);
  if result.entered_readings<>1 then raise exception 'Descendant report missing'; end if;
  select * into result from public.get_interruption_report_summary(t-interval '1 hour',t+interval '2 hours',outside_s);
  if result.total_interruptions<>0 then raise exception 'Interruption report leaked'; end if;
  if exists(select 1 from public.shutdown_requests where id=request_x) then raise exception 'Shutdown RLS leaked'; end if;
  if exists(select 1 from public.list_shutdown_dashboard_requests(p_station_id=>outside_s)) then raise exception 'Shutdown dashboard leaked'; end if;
  if exists(select 1 from public.list_shutdown_report_requests(p_station_id=>outside_s)) then raise exception 'Shutdown report leaked'; end if;
  begin perform * from public.get_shutdown_request(request_x); raise exception 'Shutdown detail leaked'; exception when insufficient_privilege or no_data_found then null; end;
  begin perform public.approve_shutdown_request(request_x); raise exception 'Shutdown approval leaked'; exception when insufficient_privilege then null; end;
  if (public.approve_shutdown_request(request_a)).status<>'APPROVED' then raise exception 'In-scope approval broken'; end if;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',op,'role','authenticated')::text,true);
  set local role authenticated;
  duty:=public.start_shift_duty(live_shift);
  if duty.status<>'ON_DUTY' or duty.user_id<>op then raise exception 'Duty start changed'; end if;
  if (public.start_shift_duty(live_shift)).id<>duty.id then raise exception 'Duty idempotency changed'; end if;
  duty:=public.end_shift_duty(duty.id);
  if duty.status<>'ENDED' or duty.ended_at is null then raise exception 'Duty end changed'; end if;
  reset role;
end $$;
select 'PASS: broad Dashboard/Analytics and narrow Operational/Shift/Reports/Shutdown coexist; all fixtures rolled back' as result;
rollback;
