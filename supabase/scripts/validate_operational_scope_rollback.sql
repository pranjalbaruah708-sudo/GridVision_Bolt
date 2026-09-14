-- DEV eetlzxntgvjompmipprb only. Synthetic data and all changes roll back.
begin;
do $$
declare
  officer uuid := gen_random_uuid(); op uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); su uuid := gen_random_uuid();
  root uuid := gen_random_uuid(); child uuid := gen_random_uuid(); other uuid := gen_random_uuid(); remote uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  tag text := 'scope35b-' || gen_random_uuid();
  day date := (now() at time zone 'Asia/Kolkata')::date-1;
  at_time timestamptz := now()-interval '1 day';
  cond public.station_conditions; counts record; actor uuid; global_before uuid[]; shift_before uuid[];
begin
  insert into auth.users(id) values(officer),(op),(adm),(su);
  insert into public.app_users(id,full_name,role) values
    (officer,tag,'FIELD_OFFICER'),(op,tag,'OPERATOR'),(adm,tag,'ADMIN'),(su,tag,'SUPER_ADMIN');
  insert into public.org_units(id,code,name,unit_type,parent_id) values
    (root,tag||'root',tag,'CIRCLE',null),(child,tag||'child',tag,'DIVISION',root),
    (other,tag||'other',tag,'DIVISION',null),(remote,tag||'remote',tag,'DIVISION',null);
  insert into public.stations(id,code,name) values(a,tag||'a',tag),(b,tag||'b',tag),(c,tag||'c',tag),(d,tag||'d',tag);
  insert into public.station_org_units(station_id,org_unit_id) values(a,root),(a,child),(b,child),(c,other),(d,remote);
  insert into public.user_org_units(user_id,org_unit_id) values(officer,root),(officer,child),(officer,other);
  insert into public.user_stations(user_id,station_id) values(op,a);
  insert into public.station_conditions(station_id,observed_at,category,condition,observation,recorded_by,client_operation_id)
    select x,at_time,'OTHER','NORMAL',tag,op,tag||x from unnest(array[a,b,c,d]) x;
  insert into public.station_shifts(station_id,shift_date,shift_name,scheduled_start,scheduled_end)
    select x,day,tag,at_time,at_time+interval '8 hours' from unnest(array[a,b,c,d]) x;

  perform set_config('request.jwt.claims',json_build_object('sub',officer,'role','authenticated')::text,true);
  set local role authenticated;
  if (select count(*) from public.get_my_operational_station_ids())<>3 then raise exception 'Officer union/dedup failed'; end if;
  if exists(select unnest(array[a,b,c]) except select station_id from public.get_my_operational_station_ids()) then raise exception 'Assigned/descendant missing'; end if;
  if exists(select 1 from public.get_my_operational_station_ids() where station_id=d) then raise exception 'Unrelated station leaked'; end if;
  select * into counts from public.get_operational_summary('CUSTOM',day,day);
  if counts.station_count<>3 or counts.conditions_observed<>3 then raise exception 'Summary union/dedup failed: %',row_to_json(counts); end if;
  select * into counts from public.get_operational_summary('CUSTOM',day,day,null,root);
  if counts.station_count<>2 or counts.conditions_observed<>2 then raise exception 'Parent dedup failed'; end if;
  if (select count(*) from public.get_operational_timeline('CUSTOM',day,day))<>3 then raise exception 'Timeline scope failed'; end if;
  if (select count(*) from public.station_conditions where observation=tag)<>3 then raise exception 'Condition RLS failed'; end if;
  if exists(select 1 from public.get_operational_scope_options() where scope_id in (d,remote) or label='Entire Utility')
    or (select count(*) from public.get_operational_scope_options() where scope_kind='OFFICE')<>3
    or (select count(*) from public.get_operational_scope_options() where scope_kind='STATION')<>3
    or not exists(select 1 from public.get_operational_scope_options() where label='All authorized stations') then raise exception 'Officer options failed'; end if;
  begin perform public.get_operational_timeline('CUSTOM',day,day,d); raise exception 'Outside timeline accepted'; exception when insufficient_privilege then null; end;
  begin perform public.get_operational_summary('CUSTOM',day,day,null,remote); raise exception 'Outside office accepted'; exception when insufficient_privilege then null; end;
  begin perform public.create_station_condition(a,at_time,'OTHER','NORMAL',tag,tag||'officer'); raise exception 'Officer create accepted'; exception when insufficient_privilege then null; end;
  begin perform public.rectify_station_condition((select id from public.station_conditions where station_id=a and observation=tag)); raise exception 'Officer rectify accepted'; exception when insufficient_privilege then null; end;
  select array_agg(station_id order by station_id) into global_before from public.get_my_accessible_station_ids();
  select array_agg(id order by id) into shift_before from public.station_shifts where shift_name=tag;
  if (select count(*) from public.get_station_shift_history(a))<>1
    or (select count(*) from public.get_station_shift_compliance(a,day,day))<>1 then raise exception 'Shift history/report regression'; end if;
  if exists(select 1 from public.get_my_operational_station_ids() where station_id=d) then
    perform * from public.get_station_shift_compliance(d,day,day);
  else
    begin perform * from public.get_station_shift_compliance(d,day,day); raise exception 'Shift outside scope accepted'; exception when insufficient_privilege then null; end;
  end if;
  -- Calling operational contracts cannot alter established global/Shift access.
  perform * from public.get_operational_summary('TODAY');
  if global_before is distinct from (select array_agg(station_id order by station_id) from public.get_my_accessible_station_ids())
    or shift_before is distinct from (select array_agg(id order by id) from public.station_shifts where shift_name=tag) then raise exception 'Global/Shift access changed'; end if;
  reset role;
  update public.user_org_units set active=false where user_id=officer;
  set local role authenticated;
  if exists(select 1 from public.get_my_operational_station_ids()) then raise exception 'No-assignment fallback leaked'; end if;
  reset role;

  perform set_config('request.jwt.claims',json_build_object('sub',op,'role','authenticated')::text,true);
  set local role authenticated;
  if (select array_agg(station_id) from public.get_my_operational_station_ids()) is distinct from array[a] then raise exception 'Operator scope changed'; end if;
  if exists(select 1 from public.get_operational_scope_options() where scope_kind<>'STATION') then raise exception 'Operator nonstation option'; end if;
  cond := public.create_station_condition(a,at_time,'OTHER','NORMAL',tag,tag||'operator');
  cond := public.rectify_station_condition(cond.id);
  if cond.recorded_by<>op or cond.rectified_by<>op or cond.rectified_at is null or cond.status<>'RECTIFIED' then raise exception 'Condition writes changed'; end if;
  begin perform public.create_station_condition(d,at_time,'OTHER','NORMAL',tag,tag||'denied'); raise exception 'Operator outside create accepted'; exception when insufficient_privilege then null; end;
  begin perform public.get_operational_summary('CUSTOM',day,day,d); raise exception 'Operator outside summary accepted'; exception when insufficient_privilege then null; end;
  reset role;
  foreach actor in array array[adm,su] loop
    perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
    set local role authenticated;
    if exists(select unnest(array[a,b,c,d]) except select station_id from public.get_my_operational_station_ids()) then raise exception 'Admin broad access changed'; end if;
    if not exists(select 1 from public.get_operational_scope_options() where label='Entire Utility') then raise exception 'Admin global option missing'; end if;
    perform * from public.get_operational_summary('CUSTOM',day,day,d);
    reset role;
  end loop;
  perform set_config('app.allow_privileged_app_user_update','true',true);
  update public.app_users set active=false where id=op;
  perform set_config('request.jwt.claims',json_build_object('sub',op,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_my_operational_station_ids()) then raise exception 'Inactive scope leaked'; end if;
  begin perform * from public.get_operational_scope_options(); raise exception 'Inactive options accepted'; exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
select 'PASS: operational role scope, descendants, union/dedup, options, timeline/summary, condition RLS/writes, inactive denial; fixtures rolled back' as result;
rollback;
