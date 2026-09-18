create table if not exists public.shift_duty_warning_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.station_shifts(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  decision text not null check (decision in ('START_DUTY','CONTINUE_WITHOUT_STARTING')),
  reason_code text,
  reason_text text,
  acknowledged_at timestamptz not null default now(),
  unique (shift_id,user_id)
);
alter table public.shift_duty_warning_acknowledgements enable row level security;
revoke all on table public.shift_duty_warning_acknowledgements from public,anon,authenticated;
create or replace function public.record_shift_duty_warning_acknowledgement(
  p_shift_id uuid, p_decision text, p_reason_code text default null, p_reason_text text default null
) returns public.shift_duty_warning_acknowledgements
language plpgsql security definer set search_path=public as $$
declare v_shift public.station_shifts%rowtype; v_row public.shift_duty_warning_acknowledgements;
begin
  select * into v_shift from public.station_shifts where id=p_shift_id;
  if v_shift.id is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  if public.get_my_role() <> 'OPERATOR' then raise exception 'Only operators may acknowledge duty warnings' using errcode='42501'; end if;
  if not exists (select 1 from public.get_my_accessible_station_ids() a where a.station_id=v_shift.station_id) then raise exception 'Station access is not authorized' using errcode='42501'; end if;
  if p_decision not in ('START_DUTY','CONTINUE_WITHOUT_STARTING') then raise exception 'Invalid acknowledgement decision' using errcode='22023'; end if;
  if p_decision='CONTINUE_WITHOUT_STARTING' and nullif(btrim(coalesce(p_reason_code,'')),'') is null then raise exception 'A reason is required' using errcode='22023'; end if;
  insert into public.shift_duty_warning_acknowledgements(shift_id,station_id,user_id,decision,reason_code,reason_text)
  values(v_shift.id,v_shift.station_id,auth.uid(),p_decision,nullif(btrim(p_reason_code),''),nullif(btrim(p_reason_text),''))
  on conflict (shift_id,user_id) do update set decision=excluded.decision,reason_code=excluded.reason_code,reason_text=excluded.reason_text,acknowledged_at=now()
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.record_shift_duty_warning_acknowledgement(uuid,text,text,text) from public,anon;
grant execute on function public.record_shift_duty_warning_acknowledgement(uuid,text,text,text) to authenticated;
