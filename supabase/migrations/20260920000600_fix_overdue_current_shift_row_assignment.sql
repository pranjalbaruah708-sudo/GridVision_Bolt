-- Correct composite row assignment in the overdue Current Shift read RPC.
begin;
create or replace function public.get_current_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql security definer set search_path=public as $$
declare v_shift public.station_shifts%rowtype; v_duty public.shift_duty_sessions%rowtype;
begin
  perform public.assert_shift_station_access(p_station_id);
  select s.* into v_shift from public.shift_duty_sessions d join public.station_shifts s on s.id=d.shift_id where d.user_id=auth.uid() and d.station_id=p_station_id and d.status='ON_DUTY' and d.ended_at is null and s.status<>'CANCELLED' order by d.started_at desc limit 1;
  if v_shift.id is not null then
    select d.* into v_duty from public.shift_duty_sessions d where d.shift_id=v_shift.id and d.user_id=auth.uid() and d.status='ON_DUTY' and d.ended_at is null order by d.started_at desc limit 1;
    if now()>=v_shift.scheduled_end then insert into public.shift_handover_audit_events(handover_id,station_id,shift_id,duty_session_id,actor_user_id,event_type,details) values(null,v_shift.station_id,v_shift.id,v_duty.id,auth.uid(),'SHIFT_END_PASSED_HANDOVER_PENDING',jsonb_build_object('scheduled_end',v_shift.scheduled_end)) on conflict(duty_session_id,event_type) where event_type='SHIFT_END_PASSED_HANDOVER_PENDING' do nothing; end if;
    return next v_shift; return;
  end if;
  return query select s.* from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and now()>=s.scheduled_start and now()<s.scheduled_end order by s.scheduled_start desc limit 1;
  if found then return; end if;
  return query select s.* from public.station_shifts s join public.station_shift_assignments a on a.shift_id=s.id and a.user_id=auth.uid() join public.shift_handovers h on h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null where s.station_id=p_station_id and s.status<>'CANCELLED' and now()<s.scheduled_start order by s.scheduled_start limit 1;
end;
$$;
commit;
