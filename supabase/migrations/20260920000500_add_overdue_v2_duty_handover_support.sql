-- Keep an unended V2 duty actionable after its scheduled end. No duty is
-- auto-ended; the existing combined handover/end command remains authoritative.
begin;

alter table public.shift_handover_audit_events drop constraint if exists shift_handover_audit_events_event_type_check;
alter table public.shift_handover_audit_events add constraint shift_handover_audit_events_event_type_check check (event_type in (
  'DRAFT_CREATED','DRAFT_ENTRY_ADDED','DRAFT_ENTRY_EDITED','DRAFT_ENTRY_REMOVED','HANDOVER_SUBMITTED','OUTGOING_DUTY_ENDED','TEAM_HANDOVER_ACCEPTED','INDIVIDUAL_HANDOVER_ACCEPTED','STARTED_WITHOUT_HANDOVER','LATE_HANDOVER_AVAILABLE','LATE_HANDOVER_ACCEPTED','DUTY_END_BLOCKED_PENDING_HANDOVER','AMENDMENT_ADDED','PROVISIONAL_HANDOVER_RECORDED','FINAL_HANDOVER_RELEASED','UNATTENDED_FINAL_HANDOVER_RELEASED','FIRST_INCOMING_DUTY_STARTED_AFTER_RELEASE','SHIFT_END_PASSED_HANDOVER_PENDING'
));
create unique index if not exists shift_handover_audit_overdue_duty_once_idx on public.shift_handover_audit_events(duty_session_id,event_type) where event_type='SHIFT_END_PASSED_HANDOVER_PENDING';

create or replace function public.get_current_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql security definer set search_path=public as $$
declare v_shift public.station_shifts%rowtype; v_duty public.shift_duty_sessions%rowtype;
begin
  perform public.assert_shift_station_access(p_station_id);
  select s into v_shift from public.shift_duty_sessions d join public.station_shifts s on s.id=d.shift_id
  where d.user_id=auth.uid() and d.station_id=p_station_id and d.status='ON_DUTY' and d.ended_at is null and s.status<>'CANCELLED'
  order by d.started_at desc limit 1;
  if v_shift.id is not null then
    select d into v_duty from public.shift_duty_sessions d where d.shift_id=v_shift.id and d.user_id=auth.uid() and d.status='ON_DUTY' and d.ended_at is null order by d.started_at desc limit 1;
    if now() >= v_shift.scheduled_end then
      insert into public.shift_handover_audit_events(handover_id,station_id,shift_id,duty_session_id,actor_user_id,event_type,details)
      values(null,v_shift.station_id,v_shift.id,v_duty.id,auth.uid(),'SHIFT_END_PASSED_HANDOVER_PENDING',jsonb_build_object('scheduled_end',v_shift.scheduled_end))
      on conflict (duty_session_id,event_type) where event_type='SHIFT_END_PASSED_HANDOVER_PENDING' do nothing;
    end if;
    return next v_shift; return;
  end if;
  return query select s.* from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and now()>=s.scheduled_start and now()<s.scheduled_end order by s.scheduled_start desc limit 1;
  if found then return; end if;
  return query select s.* from public.station_shifts s join public.station_shift_assignments a on a.shift_id=s.id and a.user_id=auth.uid() join public.shift_handovers h on h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null where s.station_id=p_station_id and s.status<>'CANCELLED' and now()<s.scheduled_start order by s.scheduled_start limit 1;
end;
$$;

create or replace function public.get_next_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql stable security definer set search_path=public as $$
declare v_current_end timestamptz;
begin
  perform public.assert_shift_station_access(p_station_id);
  select s.scheduled_end into v_current_end from public.shift_duty_sessions d join public.station_shifts s on s.id=d.shift_id where d.user_id=auth.uid() and d.station_id=p_station_id and d.status='ON_DUTY' and d.ended_at is null order by d.started_at desc limit 1;
  if v_current_end is not null then return query select s.* from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and s.scheduled_start>=v_current_end order by s.scheduled_start limit 1; return; end if;
  return query select s.* from public.station_shifts s where s.station_id=p_station_id and s.status='SCHEDULED' and s.scheduled_start>now() order by s.scheduled_start limit 1;
end;
$$;

create or replace function public.can_operator_make_station_entry(p_station_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and public.get_my_role()='OPERATOR'::public.app_user_role and public.is_assigned_to_station(p_station_id) and (
  exists(select 1 from public.shift_duty_sessions d join public.station_shift_assignments a on a.shift_id=d.shift_id and a.user_id=auth.uid() where d.station_id=p_station_id and d.user_id=auth.uid() and d.status='ON_DUTY' and d.ended_at is null)
  or (not exists(select 1 from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and ((now()>=s.scheduled_start and now()<s.scheduled_end) or exists(select 1 from public.shift_duty_sessions d where d.shift_id=s.id and d.status='ON_DUTY' and d.ended_at is null) or exists(select 1 from public.shift_handovers h where h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null and now()<s.scheduled_start))) )
 );
$$;
commit;
