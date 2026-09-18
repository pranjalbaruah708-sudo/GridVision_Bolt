begin;
create temporary table _test_shift(id uuid) on commit drop;
do $$ declare v_id uuid; begin
  insert into public.station_shifts(station_id,shift_date,shift_name,scheduled_start,scheduled_end,status,created_by)
  values ('8205ec8f-1d1b-40d2-a710-60c535e34550',(now() at time zone 'Asia/Kolkata')::date,'NOTIFICATION DELIVERY TEST',now()+interval '15 minutes',now()+interval '75 minutes','SCHEDULED',null)
  returning id into v_id;
  insert into _test_shift values(v_id);
end $$;
insert into public.station_shift_assignments(shift_id,user_id,duty_role,created_by)
select t.id,u.id,'MEMBER',null from _test_shift t join public.app_users u on lower(u.email)='houstan.op@gridvision.com';
select id from _test_shift;
commit;
