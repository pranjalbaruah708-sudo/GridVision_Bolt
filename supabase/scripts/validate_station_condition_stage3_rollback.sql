-- DEV only: eetlzxntgvjompmipprb. All synthetic fixtures roll back.
begin;
do $$
declare
  u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); outside_s uuid := gen_random_uuid();
  tag text := 'stage3-condition-' || gen_random_uuid()::text;
  category_value text; c public.station_conditions; replay public.station_conditions;
  observed timestamptz := now()-interval '2 hours';
begin
  insert into auth.users(id) values(u);
  insert into public.app_users(id,full_name,role) values(u,tag,'OPERATOR');
  insert into public.stations(id,code,name) values(s,tag,tag),(outside_s,tag||'-outside',tag);
  insert into public.user_stations(user_id,station_id) values(u,s);
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  foreach category_value in array array['EQUIPMENT','STATION_CONDITION','DEFECT'] loop
    c := public.create_station_condition(s,observed,category_value,'ATTENTION',tag,tag||category_value,'Test area','OFFLINE',observed);
    replay := public.create_station_condition(s,observed,category_value,'ATTENTION',tag,tag||category_value,'Test area','OFFLINE',observed);
    if c.id<>replay.id or c.recorded_by<>u or c.observed_at<>observed or c.synced_at is null then raise exception 'Create/replay/provenance failed'; end if;
    if not exists(select 1 from public.station_conditions where id=c.id and status='OPEN') then raise exception 'Recent read missing entry'; end if;
    replay := public.rectify_station_condition(c.id);
    if replay.status<>'RECTIFIED' or replay.rectified_by<>u or replay.rectified_at is null then raise exception 'Rectification failed'; end if;
  end loop;
  if (select count(*) from public.station_conditions where station_id=s)<>3 then raise exception 'Duplicate replay rows'; end if;
  begin
    perform public.create_station_condition(outside_s,observed,'OTHER','NORMAL',tag,tag||'-denied');
    raise exception 'Unauthorized station accepted';
  exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
select 'PASS: EQUIPMENT, STATION_CONDITION, DEFECT create/read/rectify, replay uniqueness/provenance, unauthorized station denied; fixtures rolled back' as result;
rollback;
