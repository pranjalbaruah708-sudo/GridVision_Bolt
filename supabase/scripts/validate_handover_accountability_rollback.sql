begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
  s uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); h uuid:=gen_random_uuid();
  tag text:='accountability-'||gen_random_uuid(); r record;
begin
  insert into auth.users(id) values(a),(b),(c),(d);
  insert into public.app_users(id,full_name,role) values(a,'Roster A','OPERATOR'),(b,'Roster B','OPERATOR'),(c,'Submit C','OPERATOR'),(d,'Accept D','OPERATOR');
  insert into public.stations(id,code,name) values(s,tag,tag),(x,tag||'x',tag);
  insert into public.user_stations(user_id,station_id) values(c,s),(d,x);
  insert into public.station_shifts(id,station_id,shift_date,shift_name,scheduled_start,scheduled_end)
    values(o,s,current_date,'Outgoing',now()-interval '2 hours',now()-interval '1 hour'),(i,s,current_date,'Incoming',now()-interval '1 hour',now()+interval '1 hour');
  insert into public.station_shift_assignments(shift_id,user_id,duty_role) values(o,a,'IN_CHARGE'),(i,b,'IN_CHARGE');
  insert into public.shift_handovers(id,station_id,outgoing_shift_id,incoming_shift_id,status,submitted_by_user_id,submitted_at)
    values(h,s,o,i,'SUBMITTED',c,now()-interval '10 minutes');
  perform set_config('request.jwt.claims',json_build_object('sub',c,'role','authenticated')::text,true);
  set local role authenticated;
  select * into strict r from public.get_shift_handover_accountability(array[h]);
  if r.status<>'SUBMITTED' or r.outgoing_in_charge_name<>'Roster A' or r.incoming_in_charge_name<>'Roster B' or r.submitted_by_name<>'Submit C' or r.accepted_by_name is not null then raise exception 'Submitted accountability mismatch'; end if;
  reset role;
  -- Fixture lifecycle only; no lifecycle RPC is modified by this read-contract test.
  update public.shift_handovers set status='ACCEPTED',accepted_by_user_id=d,accepted_at=now() where id=h;
  set local role authenticated;
  select * into strict r from public.get_shift_handover_accountability(array[h,h]);
  if r.status<>'ACCEPTED' or r.accepted_by_name<>'Accept D' or r.submitted_by_name<>'Submit C' or r.incoming_in_charge_name<>'Roster B' then raise exception 'Accepted accountability mismatch'; end if;
  begin perform * from public.get_shift_handover_accountability(array_fill(h,array[201])); raise exception 'Unbounded read allowed'; exception when invalid_parameter_value then null; end;
  reset role;
  delete from public.station_shift_assignments where shift_id=i;
  set local role authenticated;
  select * into strict r from public.get_shift_handover_accountability(array[h]);
  if r.incoming_in_charge_name is not null then raise exception 'Missing roster role inferred from acceptor'; end if;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',d,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.get_shift_handover_accountability(array[h])) then raise exception 'Unrelated scope leaked'; end if;
  reset role;
end $$;
select 'PASS: distinct roster/action identities, latest lifecycle, missing in-charge, duplicate IDs, bound and unrelated station denial' as result;
rollback;
