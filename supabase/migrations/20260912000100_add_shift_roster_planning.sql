-- Shift Duty Stage 4: planned roster administration. Does not grant station access.
begin;

create table public.station_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.station_shifts(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete restrict,
  duty_role text not null default 'MEMBER' check (duty_role in ('MEMBER', 'IN_CHARGE')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint station_shift_assignments_unique unique (shift_id, user_id)
);
create unique index station_shift_assignments_one_in_charge_idx on public.station_shift_assignments (shift_id) where duty_role = 'IN_CHARGE';
create index station_shift_assignments_user_idx on public.station_shift_assignments (user_id, shift_id);
create trigger station_shift_assignments_updated_at before update on public.station_shift_assignments for each row execute function public.update_updated_at_column();

create or replace function public.assert_shift_planner_access(p_station_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.app_user_role;
begin
  select role into v_role from public.app_users where id = auth.uid() and active = true;
  if v_role not in ('FIELD_OFFICER'::public.app_user_role, 'ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role) then
    raise exception 'Shift planning is not authorized' using errcode = '42501';
  end if;
  perform public.assert_shift_station_access(p_station_id);
end;
$$;

alter table public.station_shift_assignments enable row level security;
create policy station_shift_assignments_read_authorized on public.station_shift_assignments for select to authenticated using (
  exists (select 1 from public.station_shifts s join public.get_my_accessible_station_ids() a on a.station_id=s.station_id where s.id=station_shift_assignments.shift_id)
);
revoke all on table public.station_shift_assignments from anon;
grant select on table public.station_shift_assignments to authenticated;

create or replace function public.save_station_shift(p_id uuid default null, p_station_id uuid default null, p_shift_date date default null, p_shift_name text default null, p_scheduled_start timestamptz default null, p_scheduled_end timestamptz default null)
returns public.station_shifts language plpgsql security definer set search_path = public as $$
declare v_shift public.station_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if p_scheduled_start is null or p_scheduled_end is null or p_scheduled_end <= p_scheduled_start or p_shift_date is null or nullif(btrim(p_shift_name),'') is null then raise exception 'Invalid shift schedule' using errcode='22023'; end if;
  if p_scheduled_start <= now() then raise exception 'New and edited scheduled shifts must start in the future' using errcode='22023'; end if;
  if p_id is null then
    perform public.assert_shift_planner_access(p_station_id);
    insert into public.station_shifts (station_id,shift_date,shift_name,scheduled_start,scheduled_end,status,created_by)
    values (p_station_id,p_shift_date,btrim(p_shift_name),p_scheduled_start,p_scheduled_end,'SCHEDULED',auth.uid()) returning * into v_shift;
  else
    select * into v_shift from public.station_shifts where id=p_id for update;
    if v_shift.id is null then raise exception 'Shift not found' using errcode='P0002'; end if;
    perform public.assert_shift_planner_access(v_shift.station_id);
    if v_shift.status <> 'SCHEDULED' or v_shift.scheduled_start <= now() then raise exception 'Only future scheduled shifts can be edited' using errcode='55000'; end if;
    if p_station_id <> v_shift.station_id then raise exception 'Shift station cannot be changed' using errcode='22023'; end if;
    update public.station_shifts set shift_date=p_shift_date,shift_name=btrim(p_shift_name),scheduled_start=p_scheduled_start,scheduled_end=p_scheduled_end where id=p_id returning * into v_shift;
  end if;
  return v_shift;
end;
$$;

create or replace function public.cancel_station_shift(p_shift_id uuid)
returns public.station_shifts language plpgsql security definer set search_path = public as $$
declare v_shift public.station_shifts%rowtype;
begin
  select * into v_shift from public.station_shifts where id=p_shift_id for update;
  if v_shift.id is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  perform public.assert_shift_planner_access(v_shift.station_id);
  if v_shift.status <> 'SCHEDULED' or v_shift.scheduled_start <= now() then raise exception 'Only future scheduled shifts can be cancelled' using errcode='55000'; end if;
  update public.station_shifts set status='CANCELLED' where id=v_shift.id returning * into v_shift;
  return v_shift;
end;
$$;

create or replace function public.save_station_shift_roster(p_shift_id uuid, p_assignments jsonb)
returns setof public.station_shift_assignments language plpgsql security definer set search_path = public as $$
declare v_shift public.station_shifts%rowtype; v_item jsonb; v_user_id uuid; v_role text; v_in_charge integer := 0;
begin
  if jsonb_typeof(coalesce(p_assignments,'[]'::jsonb)) <> 'array' then raise exception 'Roster must be an array' using errcode='22023'; end if;
  select * into v_shift from public.station_shifts where id=p_shift_id for update;
  if v_shift.id is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  perform public.assert_shift_planner_access(v_shift.station_id);
  if v_shift.status <> 'SCHEDULED' or v_shift.scheduled_start <= now() then raise exception 'Only future scheduled shift rosters can be edited' using errcode='55000'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid roster user' using errcode='22023'; end if;
    v_user_id := (v_item->>'user_id')::uuid; v_role := upper(coalesce(nullif(btrim(v_item->>'duty_role'),''),'MEMBER'));
    if v_role not in ('MEMBER','IN_CHARGE') then raise exception 'Invalid roster duty role' using errcode='22023'; end if;
    v_in_charge := v_in_charge + case when v_role='IN_CHARGE' then 1 else 0 end;
    if not exists (select 1 from public.app_users u join public.user_stations us on us.user_id=u.id and us.station_id=v_shift.station_id and us.active=true where u.id=v_user_id and u.active=true) then raise exception 'Roster user is not authorized for this station' using errcode='42501'; end if;
  end loop;
  if v_in_charge > 1 then raise exception 'Only one Shift In-Charge is allowed' using errcode='23505'; end if;
  if (select count(*) from (select value->>'user_id' as id from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb))) x) <> (select count(distinct value->>'user_id') from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb))) then raise exception 'Duplicate roster user' using errcode='23505'; end if;
  delete from public.station_shift_assignments where shift_id=v_shift.id;
  insert into public.station_shift_assignments (shift_id,user_id,duty_role,created_by)
  select v_shift.id,(value->>'user_id')::uuid,upper(coalesce(nullif(btrim(value->>'duty_role'),''),'MEMBER')),auth.uid() from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb));
  return query select * from public.station_shift_assignments where shift_id=v_shift.id order by duty_role desc, created_at;
end;
$$;

create or replace function public.get_station_shift_schedule(p_station_id uuid,p_from timestamptz default now(),p_to timestamptz default now()+interval '30 days')
returns setof public.station_shifts language plpgsql stable security definer set search_path=public as $$ begin perform public.assert_shift_station_access(p_station_id); return query select * from public.station_shifts where station_id=p_station_id and scheduled_start>=p_from and scheduled_start<p_to order by scheduled_start; end; $$;
create or replace function public.get_next_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql stable security definer set search_path=public as $$ begin perform public.assert_shift_station_access(p_station_id); return query select * from public.station_shifts where station_id=p_station_id and status='SCHEDULED' and scheduled_start>now() order by scheduled_start limit 1; end; $$;
create or replace function public.get_shift_roster(p_shift_id uuid)
returns table(id uuid,shift_id uuid,user_id uuid,full_name text,duty_role text,created_at timestamptz) language plpgsql stable security definer set search_path=public as $$ declare v_station uuid; begin select station_id into v_station from public.station_shifts where id=p_shift_id; if v_station is null then raise exception 'Shift not found' using errcode='P0002'; end if; perform public.assert_shift_station_access(v_station); return query select a.id,a.shift_id,a.user_id,u.full_name,a.duty_role,a.created_at from public.station_shift_assignments a join public.app_users u on u.id=a.user_id where a.shift_id=p_shift_id order by a.duty_role desc,u.full_name; end; $$;

revoke all on function public.assert_shift_planner_access(uuid) from public,anon,authenticated;
revoke all on function public.save_station_shift(uuid,uuid,date,text,timestamptz,timestamptz),public.cancel_station_shift(uuid),public.save_station_shift_roster(uuid,jsonb),public.get_station_shift_schedule(uuid,timestamptz,timestamptz),public.get_next_station_shift(uuid),public.get_shift_roster(uuid) from public,anon;
grant execute on function public.save_station_shift(uuid,uuid,date,text,timestamptz,timestamptz),public.cancel_station_shift(uuid),public.save_station_shift_roster(uuid,jsonb),public.get_station_shift_schedule(uuid,timestamptz,timestamptz),public.get_next_station_shift(uuid),public.get_shift_roster(uuid) to authenticated;
commit;
