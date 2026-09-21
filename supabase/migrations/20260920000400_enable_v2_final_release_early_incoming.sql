-- Final-release discovery, early incoming acceptance, durable unattended state
-- and recipient-complete notifications for V2 handovers.
begin;

create table if not exists public.shift_handover_unattended_states (
  handover_id uuid primary key references public.shift_handovers(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  incoming_shift_id uuid not null references public.station_shifts(id) on delete restrict,
  status text not null check (status in ('OPEN','CLOSED')) default 'OPEN',
  released_at timestamptz not null,
  closed_at timestamptz,
  first_incoming_duty_session_id uuid references public.shift_duty_sessions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_handover_unattended_closed_check check ((status='OPEN' and closed_at is null) or (status='CLOSED' and closed_at is not null))
);
create trigger shift_handover_unattended_states_updated_at before update on public.shift_handover_unattended_states for each row execute function public.update_updated_at_column();
alter table public.shift_handover_unattended_states enable row level security;
create policy shift_handover_unattended_states_read_authorized on public.shift_handover_unattended_states for select to authenticated using (
  exists (
    select 1 from public.shift_handovers h join public.station_shifts incoming on incoming.id=h.incoming_shift_id
    where h.id=shift_handover_unattended_states.handover_id
      and (exists(select 1 from public.station_shift_assignments a where a.shift_id=incoming.id and a.user_id=auth.uid()) or incoming.created_by=auth.uid())
  )
);
revoke all on public.shift_handover_unattended_states from public, anon, authenticated;
grant select on public.shift_handover_unattended_states to authenticated;

create or replace function public.enqueue_shift_handover_notification_v2(p_handover_id uuid,p_kind text,p_reference_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_handover public.shift_handovers%rowtype; v_event_id uuid; v_source text; v_message text; v_station_name text;
begin
  select * into v_handover from public.shift_handovers where id=p_handover_id;
  if v_handover.id is null then raise exception 'Handover not found' using errcode='P0002'; end if;
  select name into v_station_name from public.stations where id=v_handover.station_id;
  if p_kind='AVAILABLE' then
    if v_handover.workflow_version<>2 or v_handover.status not in ('SUBMITTED','ACCEPTED') or v_handover.final_released_at is null then raise exception 'A final released V2 handover is required for notification' using errcode='55000'; end if;
    v_source:='SHIFT_HANDOVER_FINAL_RELEASE:'||v_handover.id::text;
    v_message:='The previous shift has completed duty. Final handover is available for review and acceptance.';
  elsif p_kind='AMENDMENT' and p_reference_id is not null then
    v_source:='SHIFT_HANDOVER_AMENDMENT:'||p_reference_id::text;
    v_message:=format('A shift handover amendment is available at %s.',v_station_name);
  else raise exception 'Unsupported handover notification kind' using errcode='22023'; end if;
  select id into v_event_id from public.notification_events where source_operation_id=v_source limit 1;
  if v_event_id is null then insert into public.notification_events(station_id,event_time,message,max_unit_type,created_by,source_operation_id,notification_class)
    values(v_handover.station_id,now(),v_message,coalesce((select max_unit_type from public.notification_config where active order by updated_at desc limit 1),'HQ'),auth.uid(),v_source,'LIVE') returning id into v_event_id; end if;
  if p_kind='AVAILABLE' then
    -- A null-token recipient is the durable in-app notification. Token rows
    -- are separate delivery attempts and therefore cannot suppress it.
    insert into public.notification_recipients(notification_event_id,user_id,device_token_id,status)
    select v_event_id,target.user_id,null,'PENDING'
    from (
      select a.user_id from public.station_shift_assignments a join public.app_users u on u.id=a.user_id and u.active and u.role='OPERATOR'::public.app_user_role where a.shift_id=v_handover.incoming_shift_id
      union
      select incoming.created_by from public.station_shifts incoming join public.app_users u on u.id=incoming.created_by and u.active where incoming.id=v_handover.incoming_shift_id and incoming.created_by is not null
    ) target where not exists(select 1 from public.notification_recipients r where r.notification_event_id=v_event_id and r.user_id=target.user_id and r.device_token_id is null);
    insert into public.notification_recipients(notification_event_id,user_id,device_token_id,status)
    select v_event_id,r.user_id,dt.id,'PENDING' from public.notification_recipients r join public.device_tokens dt on dt.user_id=r.user_id and dt.is_active
    where r.notification_event_id=v_event_id and r.device_token_id is null
    on conflict do nothing;
  else
    insert into public.notification_recipients(notification_event_id,user_id,device_token_id,status)
    select distinct v_event_id,dt.user_id,dt.id,'PENDING' from public.device_tokens dt where dt.is_active and exists(select 1 from public.station_shift_assignments a where a.shift_id=v_handover.incoming_shift_id and a.user_id=dt.user_id) on conflict do nothing;
  end if;
  return v_event_id;
end;
$$;

-- The existing Current Shift read RPC returns the active shift first. Before
-- its scheduled start it additionally returns only a rostered user's released
-- V2 incoming shift; provisional records never qualify.
create or replace function public.get_current_station_shift(p_station_id uuid)
returns setof public.station_shifts language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select s.* from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and now()>=s.scheduled_start and now()<s.scheduled_end order by s.scheduled_start desc limit 1;
  if found then return; end if;
  return query select s.* from public.station_shifts s join public.station_shift_assignments a on a.shift_id=s.id and a.user_id=auth.uid() join public.shift_handovers h on h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null
    where s.station_id=p_station_id and s.status<>'CANCELLED' and now()<s.scheduled_start order by s.scheduled_start limit 1;
end;
$$;

create or replace function public.get_my_v2_handover_unattended(p_station_id uuid)
returns table(handover_id uuid,incoming_shift_id uuid,released_at timestamptz,status text)
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query select u.handover_id,u.incoming_shift_id,u.released_at,u.status from public.shift_handover_unattended_states u join public.station_shifts incoming on incoming.id=u.incoming_shift_id
  where u.station_id=p_station_id and u.status='OPEN' and (exists(select 1 from public.station_shift_assignments a where a.shift_id=incoming.id and a.user_id=auth.uid()) or incoming.created_by=auth.uid()) order by u.released_at desc limit 1;
end;
$$;

create or replace function public.can_operator_make_station_entry(p_station_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.get_my_role()='OPERATOR'::public.app_user_role and public.is_assigned_to_station(p_station_id) and (
    not exists(select 1 from public.station_shifts s where s.station_id=p_station_id and s.status<>'CANCELLED' and (
      (now()>=s.scheduled_start and now()<s.scheduled_end) or
      exists(select 1 from public.shift_handovers h where h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null and now()<s.scheduled_start)
    )) or exists(select 1 from public.station_shifts s join public.station_shift_assignments a on a.shift_id=s.id and a.user_id=auth.uid() join public.shift_duty_sessions d on d.shift_id=s.id and d.station_id=s.station_id and d.user_id=auth.uid() and d.status='ON_DUTY' and d.ended_at is null where s.station_id=p_station_id and s.status<>'CANCELLED' and ((now()>=s.scheduled_start and now()<s.scheduled_end) or exists(select 1 from public.shift_handovers h where h.incoming_shift_id=s.id and h.workflow_version=2 and h.status in ('SUBMITTED','ACCEPTED') and h.final_released_at is not null and now()<s.scheduled_start)))
  );
$$;

create or replace function public.review_handover_and_start_duty_v2(p_shift_id uuid,p_handover_id uuid,p_acknowledge_no_handover boolean,p_acceptance_comments text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_access record; v_shift public.station_shifts%rowtype; v_handover public.shift_handovers%rowtype; v_session public.shift_duty_sessions%rowtype; v_existing_state public.shift_duty_handover_states%rowtype; v_state public.shift_duty_handover_states%rowtype; v_result jsonb; v_now timestamptz:=now(); v_team_first boolean:=false; v_existing boolean:=false;
begin
 if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':REVIEW_AND_START:'||p_idempotency_key::text,0)); select response_payload into v_result from public.shift_handover_command_receipts where user_id=auth.uid() and command_type='REVIEW_AND_START' and idempotency_key=p_idempotency_key; if v_result is not null then return v_result; end if;
 select * into v_access from public.assert_equal_operator_shift_member(p_shift_id,false); select * into v_shift from public.station_shifts where id=p_shift_id for update;
 if v_shift.status='CANCELLED' or now()>=v_shift.scheduled_end then raise exception 'Shift is not available for duty start' using errcode='P0001'; end if;
 if p_handover_id is not null then select * into v_handover from public.shift_handovers where id=p_handover_id and incoming_shift_id=p_shift_id for update; else select * into v_handover from public.shift_handovers where incoming_shift_id=p_shift_id and status in ('SUBMITTED','ACCEPTED') order by workflow_version desc,submitted_at desc nulls last limit 1 for update; end if;
 if p_handover_id is not null and v_handover.id is null then raise exception 'The selected handover is not available for this incoming shift' using errcode='P0002'; end if;
 if now()<v_shift.scheduled_start and (v_handover.id is null or v_handover.workflow_version<>2 or v_handover.status not in ('SUBMITTED','ACCEPTED') or v_handover.final_released_at is null) then raise exception 'Early duty start requires a final released handover' using errcode='42501'; end if;
 if v_handover.id is not null and (v_handover.status not in ('SUBMITTED','ACCEPTED') or (v_handover.workflow_version=2 and v_handover.final_released_at is null)) then raise exception 'The handover is not available for acceptance' using errcode='55000'; end if;
 select * into v_session from public.shift_duty_sessions where shift_id=p_shift_id and user_id=auth.uid() and status='ON_DUTY' for update; v_existing:=v_session.id is not null;
 if v_session.id is null then insert into public.shift_duty_sessions(shift_id,station_id,user_id,shift_role) values(p_shift_id,v_shift.station_id,auth.uid(),v_access.duty_role) returning * into v_session; if v_shift.status='SCHEDULED' then update public.station_shifts set status='ACTIVE' where id=p_shift_id; end if; end if;
 select * into v_existing_state from public.shift_duty_handover_states where duty_session_id=v_session.id and side='INCOMING' for update;
 if v_handover.id is null then
   if now()<v_shift.scheduled_start then raise exception 'Start Duty Without Handover is unavailable before scheduled duty start' using errcode='42501'; end if;
   if not coalesce(p_acknowledge_no_handover,false) then raise exception 'No handover is available; explicit acknowledgement is required' using errcode='22023'; end if;
   if v_existing_state.id is null then insert into public.shift_duty_handover_states(duty_session_id,handover_id,shift_id,station_id,user_id,side,state,no_handover_acknowledged_at) values(v_session.id,null,p_shift_id,v_shift.station_id,auth.uid(),'INCOMING','STARTED_WITHOUT_HANDOVER',v_now) returning * into v_state; perform public.write_shift_handover_audit_event(null,v_shift.station_id,p_shift_id,v_session.id,'STARTED_WITHOUT_HANDOVER',jsonb_build_object('acknowledgement','No handover received')); else v_state:=v_existing_state; end if;
 else
   if v_existing_state.id is null then insert into public.shift_duty_handover_states(duty_session_id,handover_id,shift_id,station_id,user_id,side,state,accepted_at,acceptance_comments) values(v_session.id,v_handover.id,p_shift_id,v_shift.station_id,auth.uid(),'INCOMING','ACCEPTED_AND_STARTED',v_now,nullif(btrim(coalesce(p_acceptance_comments,'')),'')) returning * into v_state; elsif v_existing_state.state in ('ACCEPTED_AND_STARTED','LATE_HANDOVER_ACCEPTED') and v_existing_state.handover_id=v_handover.id then v_state:=v_existing_state; else raise exception 'The duty session has an incompatible handover state' using errcode='55000'; end if;
   if v_handover.status='SUBMITTED' then update public.shift_handovers set status='ACCEPTED',accepted_by_user_id=auth.uid(),accepted_at=v_now,acceptance_comments=nullif(btrim(coalesce(p_acceptance_comments,'')),''),team_accepted_duty_session_id=v_session.id where id=v_handover.id returning * into v_handover; v_team_first:=true; perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,p_shift_id,v_session.id,'TEAM_HANDOVER_ACCEPTED','{}'::jsonb); end if;
   update public.shift_handover_unattended_states set status='CLOSED',closed_at=v_now,first_incoming_duty_session_id=v_session.id where handover_id=v_handover.id and status='OPEN';
   perform public.write_shift_handover_audit_event(v_handover.id,v_handover.station_id,p_shift_id,v_session.id,'INDIVIDUAL_HANDOVER_ACCEPTED',jsonb_build_object('individual_state',v_state.state,'team_first_acceptance',v_team_first));
 end if;
 v_result:=jsonb_build_object('handover',case when v_handover.id is null then null else to_jsonb(v_handover) end,'duty_session',to_jsonb(v_session),'individual_state',to_jsonb(v_state),'team_first_acceptance',v_team_first,'existing_duty_session',v_existing); insert into public.shift_handover_command_receipts(user_id,command_type,idempotency_key,handover_id,response_payload) values(auth.uid(),'REVIEW_AND_START',p_idempotency_key,v_handover.id,v_result); return v_result;
end;
$$;

-- Final release creates an unattended state only when no incoming duty exists.
create or replace function public.capture_v2_final_release_unattended()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.workflow_version=2 and new.status='SUBMITTED' and new.final_released_at is not null and (old.status is distinct from 'SUBMITTED') and not exists(select 1 from public.shift_duty_sessions d where d.shift_id=new.incoming_shift_id and d.status='ON_DUTY') then
   insert into public.shift_handover_unattended_states(handover_id,station_id,incoming_shift_id,released_at) values(new.id,new.station_id,new.incoming_shift_id,new.final_released_at) on conflict(handover_id) do nothing;
 end if;
 return new;
end;
$$;
drop trigger if exists capture_v2_final_release_unattended_trigger on public.shift_handovers;
create trigger capture_v2_final_release_unattended_trigger after update on public.shift_handovers for each row execute function public.capture_v2_final_release_unattended();

revoke all on function public.get_my_v2_handover_unattended(uuid) from public,anon;
grant execute on function public.get_my_v2_handover_unattended(uuid) to authenticated;
commit;
