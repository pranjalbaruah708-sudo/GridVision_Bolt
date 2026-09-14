-- DEV only. Global helper correction is rolled back; restricted dependencies
-- must already be separated by 20260914000250. Shift remains denied.
begin;
create temp table unchanged_functions as select p.oid,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','gridvision_internal') and p.prokind='f' and p.proname<>'get_my_accessible_station_ids';
create temp table unchanged_policies as select oid,polqual::text,polwithcheck::text from pg_policy;
create temp table scope_probe(user_id uuid,station_id uuid,shift_allowed_before boolean);
do $$ declare u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); tag text:='global-probe-'||gen_random_uuid(); allowed boolean:=true; begin
insert into auth.users(id) values(u);
insert into public.app_users(id,full_name,role) values(u,tag,'FIELD_OFFICER');
insert into public.stations(id,code,name) values(s,tag,tag);
perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
set local role authenticated;
begin perform * from public.get_station_shift_history(s); exception when insufficient_privilege then allowed:=false; end;
reset role;
insert into scope_probe values(u,s,allowed);
end $$;-- Restore the global FIELD_OFFICER rule narrowed by 20260909000200.
-- Dedicated operational scope and all other functions/policies are untouched.
create or replace function public.get_my_accessible_station_ids()
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_role public.app_user_role;
begin
  select au.role into v_role from public.app_users au
  where au.id = auth.uid() and au.active = true;
  if v_role is null then return; end if;

  if v_role in ('FIELD_OFFICER','ADMIN','SUPER_ADMIN') then
    return query select s.id from public.stations s where s.active = true order by s.name;
    return;
  end if;

  if v_role = 'OPERATOR' then
    return query
      select scoped.station_id from (
        select distinct s.id as station_id, s.name as station_name
        from public.user_stations us join public.stations s on s.id = us.station_id
        where us.user_id = auth.uid() and us.active = true and s.active = true
      ) scoped order by scoped.station_name;
  end if;
end;
$$;

do $$ declare probe record; begin
if exists(select 1 from unchanged_functions b join pg_proc p on p.oid=b.oid where b.definition<>pg_get_functiondef(p.oid)) or exists(select 1 from unchanged_policies b join pg_policy p on p.oid=b.oid where b.polqual is distinct from p.polqual::text or b.polwithcheck is distinct from p.polwithcheck::text) then raise exception 'Other function/policy changed'; end if;
select * into probe from scope_probe;
if probe.shift_allowed_before then raise exception 'Expected current DEV Shift outside scope denial'; end if;
perform set_config('request.jwt.claims',json_build_object('sub',probe.user_id,'role','authenticated')::text,true);
set local role authenticated;
begin perform * from public.get_station_shift_history(probe.station_id); raise exception 'Shift access broadened'; exception when insufficient_privilege then null; end;
if exists(select 1 from public.get_my_operational_station_ids() where station_id=probe.station_id) then raise exception 'Operational scope leaked'; end if;
reset role;
end $$;-- DEV eetlzxntgvjompmipprb only. Synthetic data and all changes roll back.
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
  if not exists(select 1 from public.get_my_accessible_station_ids() where station_id=d) then raise exception 'Global unrelated station missing'; end if;
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
  if (select array_agg(station_id) from public.get_my_accessible_station_ids()) is distinct from array[a] then raise exception 'Operator global scope changed'; end if;
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
    if exists(select unnest(array[a,b,c,d]) except select station_id from public.get_my_accessible_station_ids()) then raise exception 'Admin global scope lost'; end if;
    if exists(select unnest(array[a,b,c,d]) except select station_id from public.get_my_operational_station_ids()) then raise exception 'Admin broad access changed'; end if;
    if not exists(select 1 from public.get_operational_scope_options() where label='Entire Utility') then raise exception 'Admin global option missing'; end if;
    perform * from public.get_operational_summary('CUSTOM',day,day,d);
    reset role;
  end loop;
  perform set_config('app.allow_privileged_app_user_update','true',true);
  update public.app_users set active=false where id=op;
  perform set_config('request.jwt.claims',json_build_object('sub',op,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_my_accessible_station_ids()) then raise exception 'Inactive global scope leaked'; end if;
  if exists(select 1 from public.get_my_operational_station_ids()) then raise exception 'Inactive scope leaked'; end if;
  begin perform * from public.get_operational_scope_options(); raise exception 'Inactive options accepted'; exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
select 'PASS: both scopes, role restrictions, operational contracts, unchanged function/policy definitions. PASS: unrelated-station Shift history denied before and after. All changes rolled back' as result;
rollback;




