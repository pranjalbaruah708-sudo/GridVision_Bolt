begin;
create temporary table gv_shift_role_actors on commit drop as
  select distinct on (role) id, role
  from public.app_users
  where active and role in ('OPERATOR','FIELD_OFFICER','ADMIN','SUPER_ADMIN')
  order by role, id;
grant select on gv_shift_role_actors to authenticated;
set local role authenticated;
do $$
declare
  actor record;
begin
  for actor in
    select id,role from pg_temp.gv_shift_role_actors order by role
  loop
    perform set_config('request.jwt.claims',json_build_object('sub',actor.id,'role','authenticated')::text,true);
    if actor.role='OPERATOR' then
      begin
        perform public.start_shift_duty(gen_random_uuid(),'MEMBER');
        raise exception 'OPERATOR start unexpectedly succeeded for missing shift';
      exception when no_data_found then null;
      end;
      begin
        perform public.end_shift_duty(gen_random_uuid());
        raise exception 'OPERATOR end unexpectedly succeeded for missing session';
      exception when no_data_found then null;
      end;
    else
      begin
        perform public.start_shift_duty(gen_random_uuid(),'MEMBER');
        raise exception '% unexpectedly started duty',actor.role;
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.end_shift_duty(gen_random_uuid());
        raise exception '% unexpectedly ended duty',actor.role;
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end;
$$;
reset role;
select 'PASS: only OPERATOR reaches the shift/session lookup; all other roles are denied both duty actions' as result;
rollback;
