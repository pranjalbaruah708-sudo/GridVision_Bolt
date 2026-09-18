create table if not exists public.shift_duty_exception_audits (
  id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.station_shifts(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade, user_id uuid not null references public.app_users(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 1000), created_at timestamptz not null default now()
);
alter table public.shift_duty_exception_audits enable row level security;
create or replace function public.record_shift_duty_exception(p_shift_id uuid, p_reason text)
returns public.shift_duty_exception_audits language plpgsql security definer set search_path = public
as $$ declare v_row public.shift_duty_exception_audits; v_user public.app_users; v_shift public.station_shifts; begin
  select * into v_user from public.app_users where id = auth.uid() and is_active and role = 'OPERATOR';
  if v_user.id is null then raise exception 'Only active operators may record an exception'; end if;
  select * into v_shift from public.station_shifts where id = p_shift_id;
  if v_shift.id is null or not (v_shift.station_id = any(public.get_my_accessible_station_ids())) then raise exception 'Shift access is not authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required'; end if;
  insert into public.shift_duty_exception_audits(shift_id, station_id, user_id, reason) values (v_shift.id, v_shift.station_id, auth.uid(), trim(p_reason)) returning * into v_row; return v_row;
end $$;
revoke all on function public.record_shift_duty_exception(uuid,text) from public;
grant execute on function public.record_shift_duty_exception(uuid,text) to authenticated;
