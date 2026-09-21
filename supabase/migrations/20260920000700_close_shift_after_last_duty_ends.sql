-- A shift becomes CLOSED only after its final actual duty session ends.
-- This is a status projection; it neither ends duty nor changes handover state.
begin;

create or replace function public.close_station_shift_after_last_duty_ends()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='ENDED' and old.status is distinct from 'ENDED' and not exists (
    select 1 from public.shift_duty_sessions d where d.shift_id=new.shift_id and d.status='ON_DUTY' and d.ended_at is null
  ) then
    update public.station_shifts set status='CLOSED' where id=new.shift_id and status<>'CANCELLED';
  end if;
  return new;
end;
$$;
drop trigger if exists close_station_shift_after_last_duty_ends_trigger on public.shift_duty_sessions;
create trigger close_station_shift_after_last_duty_ends_trigger
after update of status, ended_at on public.shift_duty_sessions
for each row execute function public.close_station_shift_after_last_duty_ends();

-- Correct already-completed DEV shifts created before this projection.
update public.station_shifts s
set status='CLOSED'
where s.status='ACTIVE'
  and exists (select 1 from public.shift_duty_sessions d where d.shift_id=s.id and d.status='ENDED')
  and not exists (select 1 from public.shift_duty_sessions d where d.shift_id=s.id and d.status='ON_DUTY' and d.ended_at is null);

commit;
