-- DEV only. now() is transaction-stable, so offsets do not depend on network timing.
begin;
do $$
declare
  u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); outside_s uuid := gen_random_uuid();
  tag text := 'stage6-skew-' || gen_random_uuid();
  delta interval; supplied timestamptz; c public.station_conditions; replay public.station_conditions;
  observed timestamptz := now() - interval '2 hours';
  n integer := 0; mode text;
begin
  insert into auth.users(id) values (u);
  insert into public.app_users(id,full_name,role) values(u,tag,'OPERATOR');
  insert into public.stations(id,code,name) values(s,tag,tag),(outside_s,tag||'-x',tag);
  insert into public.user_stations(user_id,station_id) values(u,s);
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  foreach delta in array array[interval '-1 second',interval '0 seconds',interval '100 milliseconds',interval '1 second',interval '4.9 seconds'] loop
    n := n+1;
    supplied := now()+delta;
    c := public.create_station_condition(s,observed,'OTHER','NORMAL',tag,tag||n,null,'ONLINE',supplied);
    replay := public.create_station_condition(s,observed,'OTHER','NORMAL',tag,tag||n,null,'ONLINE',supplied);
    if c.recorded_at <> now() or c.recorded_by <> u or c.observed_at <> observed
      or c.synced_at is not null or c.entry_mode <> 'ONLINE' or replay.id <> c.id then
      raise exception 'ONLINE boundary/provenance/idempotency failed: %',delta;
    end if;
  end loop;
  foreach mode in array array['ONLINE','OFFLINE'] loop
    begin
      perform public.create_station_condition(s,observed,'OTHER','NORMAL',tag,tag||mode,null,mode,now()+interval '6 seconds');
      raise exception 'Beyond-tolerance recording accepted';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.create_station_condition(s,observed,'OTHER','NORMAL',tag,tag||mode,null,mode,'infinity');
      raise exception 'Infinite recording accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.create_station_condition(s,observed,'OTHER','NORMAL',tag,tag||'mode',null,'INVALID',now());
    raise exception 'Invalid mode accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_station_condition(s,now()+interval '100 milliseconds','OTHER','NORMAL',tag,tag||'observed',null,'ONLINE',now());
    raise exception 'Future observation accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_station_condition(s,null,'OTHER','NORMAL',tag,tag||'null');
    raise exception 'Null observation accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_station_condition(outside_s,observed,'OTHER','NORMAL',tag,tag||'denied',null,'ONLINE',now()+interval '100 milliseconds');
    raise exception 'Unauthorized station accepted';
  exception when insufficient_privilege then null; end;
  supplied := now()-interval '1 hour';
  c := public.create_station_condition(s,observed,'DEFECT','ATTENTION',tag,tag||'offline',null,'OFFLINE',supplied);
  replay := public.create_station_condition(s,observed,'DEFECT','ATTENTION',tag,tag||'offline',null,'OFFLINE',supplied);
  if c.id <> replay.id or c.recorded_at <> supplied or c.observed_at <> observed
    or c.synced_at <> now() or c.recorded_by <> u or c.entry_mode <> 'OFFLINE' then
    raise exception 'Offline provenance/idempotency changed';
  end if;
  begin
    perform public.create_station_condition(s,observed,'DEFECT','ATTENTION',tag,tag||'offline',null,'OFFLINE',supplied-interval '1 second');
    raise exception 'Conflicting offline provenance accepted';
  exception when unique_violation then null; end;
  if (select count(*) from public.station_conditions where station_id=s) <> 6 then raise exception 'Unexpected duplicate rows'; end if;
  reset role;
end $$;
select 'PASS: five ONLINE clock boundaries; >5s/mode/timestamp rejection; authorization; ONLINE server time; OFFLINE provenance and replay uniqueness' as result;
rollback;
