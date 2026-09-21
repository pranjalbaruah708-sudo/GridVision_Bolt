-- Final equal-operator handover integration.
-- Adds a bounded report projection, includes v2 audit events in the existing
-- operational timeline projection, and enables RLS-filtered Realtime delivery.

begin;

create or replace function public.get_shift_handover_report_v2(
  p_station_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 500
)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Invalid report date range' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Invalid report result limit' using errcode = '22023';
  end if;
  if p_station_id is not null and not exists (
    select 1 from public.get_my_accessible_station_ids() scoped where scoped.station_id = p_station_id
  ) then
    raise exception 'Station access is not authorized' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', h.id,
    'workflow_version', h.workflow_version,
    'station_id', h.station_id,
    'station_name', station.name,
    'outgoing_shift_id', outgoing.id,
    'outgoing_shift_name', outgoing.shift_name,
    'outgoing_shift_date', outgoing.shift_date,
    'incoming_shift_id', incoming.id,
    'incoming_shift_name', incoming.shift_name,
    'incoming_shift_date', incoming.shift_date,
    'status', h.status,
    'outgoing_notes', h.outgoing_notes,
    'acceptance_comments', h.acceptance_comments,
    'submitted_by_name', submitter.full_name,
    'submitted_at', h.submitted_at,
    'accepted_by_name', accepter.full_name,
    'accepted_at', h.accepted_at,
    'late_handover_submission_time', case when exists (
      select 1 from public.shift_handover_audit_events late
      where late.handover_id = h.id and late.event_type = 'LATE_HANDOVER_AVAILABLE'
    ) then h.submitted_at end,
    'created_at', h.created_at,
    'updated_at', h.updated_at,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id, 'phase', entry.phase, 'entry_kind', entry.entry_kind,
        'source_type', entry.source_type, 'source_id', entry.source_id,
        'body', entry.body, 'priority', entry.priority,
        'author_user_id', entry.author_user_id, 'author_name', author.full_name,
        'replaces_entry_id', entry.replaces_entry_id,
        'created_at', entry.created_at, 'updated_at', entry.updated_at,
        'finalized_at', entry.finalized_at
      ) order by entry.created_at, entry.id)
      from public.shift_handover_entries entry
      join public.app_users author on author.id = entry.author_user_id
      where entry.handover_id = h.id
    ), '[]'::jsonb),
    'outgoing_operators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', person.user_id, 'operator_name', operator.full_name,
        'rostered', person.rostered, 'duty_session_id', duty.id,
        'duty_started_at', duty.started_at, 'duty_ended_at', duty.ended_at,
        'still_on_duty', duty.status = 'ON_DUTY',
        'individual_state', state.state, 'individual_ended_at', state.ended_at,
        'attention_state', case
          when state.state = 'SUBMITTED_AND_ENDED' then 'SUBMITTED_AND_ENDED'
          when state.state = 'ENDED_LINKED_TO_SUBMITTED_HANDOVER' then 'LINKED_AND_ENDED'
          when duty.status = 'ON_DUTY' then 'STILL_ON_DUTY'
          when duty.id is null then 'NOT_STARTED'
          else 'ENDED_WITHOUT_LINK'
        end
      ) order by operator.full_name, person.user_id)
      from (
        select a.user_id, true as rostered from public.station_shift_assignments a where a.shift_id = outgoing.id
        union
        select d.user_id, exists(select 1 from public.station_shift_assignments a where a.shift_id = outgoing.id and a.user_id = d.user_id)
        from public.shift_duty_sessions d where d.shift_id = outgoing.id
      ) person
      join public.app_users operator on operator.id = person.user_id
      left join lateral (
        select d.* from public.shift_duty_sessions d
        where d.shift_id = outgoing.id and d.user_id = person.user_id
        order by d.started_at desc, d.id desc limit 1
      ) duty on true
      left join public.shift_duty_handover_states state
        on state.duty_session_id = duty.id and state.handover_id = h.id and state.side = 'OUTGOING'
    ), '[]'::jsonb),
    'incoming_operators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', person.user_id, 'operator_name', operator.full_name,
        'rostered', person.rostered, 'duty_session_id', duty.id,
        'duty_started_at', duty.started_at, 'duty_ended_at', duty.ended_at,
        'still_on_duty', duty.status = 'ON_DUTY',
        'individual_state', state.state, 'accepted_at', state.accepted_at,
        'no_handover_acknowledged_at', state.no_handover_acknowledged_at,
        'acceptance_comments', state.acceptance_comments,
        'duty_end_blocked', exists (
          select 1 from public.shift_handover_audit_events blocked
          where blocked.handover_id = h.id and blocked.duty_session_id = duty.id
            and blocked.event_type = 'DUTY_END_BLOCKED_PENDING_HANDOVER'
        ),
        'attention_state', case
          when state.state in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') then 'ACCEPTED'
          when state.state = 'LATE_HANDOVER_REVIEW_REQUIRED' then 'LATE_PENDING'
          when duty.status = 'ENDED' and coalesce(state.state, '') not in ('ACCEPTED_AND_STARTED', 'LATE_HANDOVER_ACCEPTED') then 'MISSED'
          when state.state = 'STARTED_WITHOUT_HANDOVER' then 'STARTED_WITHOUT_HANDOVER'
          when duty.status = 'ON_DUTY' and state.id is null then 'PENDING'
          when duty.id is null then 'NOT_STARTED'
          else 'PENDING'
        end
      ) order by operator.full_name, person.user_id)
      from (
        select a.user_id, true as rostered from public.station_shift_assignments a where a.shift_id = incoming.id
        union
        select d.user_id, exists(select 1 from public.station_shift_assignments a where a.shift_id = incoming.id and a.user_id = d.user_id)
        from public.shift_duty_sessions d where d.shift_id = incoming.id
      ) person
      join public.app_users operator on operator.id = person.user_id
      left join lateral (
        select d.* from public.shift_duty_sessions d
        where d.shift_id = incoming.id and d.user_id = person.user_id
        order by d.started_at desc, d.id desc limit 1
      ) duty on true
      left join public.shift_duty_handover_states state
        on state.duty_session_id = duty.id and state.handover_id = h.id and state.side = 'INCOMING'
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id, 'event_type', audit.event_type,
        'actor_user_id', audit.actor_user_id, 'actor_name', actor.full_name,
        'duty_session_id', audit.duty_session_id,
        'occurred_at', audit.occurred_at, 'details', audit.details
      ) order by audit.occurred_at, audit.id)
      from public.shift_handover_audit_events audit
      left join public.app_users actor on actor.id = audit.actor_user_id
      where audit.handover_id = h.id
    ), '[]'::jsonb)
  )
  from public.shift_handovers h
  join public.station_shifts outgoing on outgoing.id = h.outgoing_shift_id
  join public.station_shifts incoming on incoming.id = h.incoming_shift_id
  join public.stations station on station.id = h.station_id
  left join public.app_users submitter on submitter.id = h.submitted_by_user_id
  left join public.app_users accepter on accepter.id = h.accepted_by_user_id
  where outgoing.shift_date between p_from and p_to
    and h.status in ('SUBMITTED', 'ACCEPTED')
    and h.station_id in (select scoped.station_id from public.get_my_accessible_station_ids() scoped)
    and (p_station_id is null or h.station_id = p_station_id)
  order by outgoing.shift_date desc, h.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.get_shift_handover_report_v2(uuid,date,date,integer) from public,anon;
grant execute on function public.get_shift_handover_report_v2(uuid,date,date,integer) to authenticated;

create or replace function gridvision_internal.read_operational_events(
  p_period text,p_from date default null,p_to date default null,p_station_id uuid default null,p_office_id uuid default null
)
returns table(event_type text,source_id uuid,event_time timestamptz,station_id uuid,feeder_id uuid,equipment_area text,title text,details text,severity text,status text)
language sql stable security invoker set search_path = public,gridvision_internal as $$
  with scope as materialized (select * from public.resolve_operational_station_scope(p_station_id,p_office_id)),
  bounds as materialized (select * from public.get_operational_period_range(p_period,p_from,p_to)),
  events as (
    select 'PARAMETER_ENTRY'::text,l.id,l.actual_event_time,l.station_id,l.feeder_id,null::text,'Parameter entry'::text,left(l.remarks,500),null::text,null::text
    from public.log_book_entries l join scope s on s.station_id=l.station_id cross join bounds b where l.actual_event_time>=b.start_at and l.actual_event_time<b.end_at
    union all select 'INTERRUPTION',i.id,i.interruption_start,i.station_id,i.feeder_id,null,'Interruption',left(concat_ws(' — ',i.cause,i.remarks),500),null,i.current_status
    from public.interruptions i join scope s on s.station_id=i.station_id cross join bounds b where i.current_status<>'CANCELLED' and i.interruption_start>=b.start_at and i.interruption_start<b.end_at
    union all select 'RESTORATION',i.id,i.interruption_end,i.station_id,i.feeder_id,null,'Restoration',left(i.remarks,500),null,i.current_status
    from public.interruptions i join scope s on s.station_id=i.station_id cross join bounds b where i.current_status='RESTORED' and i.interruption_end>=b.start_at and i.interruption_end<b.end_at
    union all select 'ALERT',a.id,a.triggered_at,a.station_id,a.feeder_id,null,'Parameter alert',left(concat_ws(' · ',a.parameter_code,a.breach_type,a.actual_value::text,a.notification_class,case when a.notification_suppressed then 'Notification suppressed' end),500),null,case when a.is_current then 'CURRENT' else 'HISTORICAL' end
    from public.parameter_alerts a join scope s on s.station_id=a.station_id cross join bounds b where a.triggered_at>=b.start_at and a.triggered_at<b.end_at
    union all select 'STATION_CONDITION',c.id,c.observed_at,c.station_id,null,c.equipment_area,'Station condition',left(c.observation,500),c.condition,c.status
    from public.station_conditions c join scope s on s.station_id=c.station_id cross join bounds b where c.observed_at>=b.start_at and c.observed_at<b.end_at
    union all select v.kind,d.id,v.at,d.station_id,null,null,v.title,d.shift_role,null,d.status
    from public.shift_duty_sessions d join scope s on s.station_id=d.station_id cross join bounds b
    cross join lateral (values ('DUTY_STARTED',d.started_at,'Duty started'),('DUTY_ENDED',d.ended_at,'Duty ended')) v(kind,at,title)
    where v.at>=b.start_at and v.at<b.end_at
    union all select v.kind,h.id,v.at,h.station_id,null,null,v.title,left(v.notes,500),null,h.status
    from public.shift_handovers h join scope s on s.station_id=h.station_id cross join bounds b
    cross join lateral (values ('HANDOVER_SUBMITTED',h.submitted_at,'Handover submitted',h.outgoing_notes),('HANDOVER_ACCEPTED',h.accepted_at,'Handover accepted',h.acceptance_comments)) v(kind,at,title,notes)
    where h.workflow_version=1 and v.at>=b.start_at and v.at<b.end_at
    union all select audit.event_type,audit.id,audit.occurred_at,audit.station_id,null,null,
      initcap(replace(audit.event_type,'_',' ')),
      left(case when audit.event_type='DUTY_END_BLOCKED_PENDING_HANDOVER' then 'Duty ending was blocked until individual late-handover acceptance.' when audit.event_type='LATE_HANDOVER_AVAILABLE' then 'Late handover became available for individual review.' else null end,500),
      case when audit.event_type in ('DUTY_END_BLOCKED_PENDING_HANDOVER','LATE_HANDOVER_AVAILABLE') then 'ATTENTION' end,
      audit.event_type
    from public.shift_handover_audit_events audit
    join public.shift_handovers h on h.id=audit.handover_id and h.workflow_version=2
    join scope s on s.station_id=audit.station_id cross join bounds b
    where audit.occurred_at>=b.start_at and audit.occurred_at<b.end_at
  ) select * from events;
$$;

-- The existing summary retains its definitions while recognizing the exact v2
-- audit names used by the timeline projection.
create or replace function public.get_operational_summary(p_period text,p_from date default null,p_to date default null,p_station_id uuid default null,p_office_id uuid default null)
returns table(start_at timestamptz,end_at timestamptz,as_of timestamptz,station_count bigint,parameter_entries bigint,interruptions_started bigint,restorations bigint,alerts bigint,conditions_observed bigint,current_open_conditions bigint,duty_starts bigint,duty_ends bigint,handovers_submitted bigint,handovers_accepted bigint)
language plpgsql stable security invoker set search_path = public,gridvision_internal as $$
begin
  perform * from public.get_operational_period_range(p_period,p_from,p_to);
  perform * from public.resolve_operational_station_scope(p_station_id,p_office_id);
  return query with scope as materialized (select * from public.resolve_operational_station_scope(p_station_id,p_office_id)),
  counts as (select count(*) filter(where e.event_type='PARAMETER_ENTRY') p,count(*) filter(where e.event_type='INTERRUPTION') i,count(*) filter(where e.event_type='RESTORATION') r,count(*) filter(where e.event_type='ALERT') a,count(*) filter(where e.event_type='STATION_CONDITION') c,count(*) filter(where e.event_type='DUTY_STARTED') ds,count(*) filter(where e.event_type='DUTY_ENDED') de,count(*) filter(where e.event_type='HANDOVER_SUBMITTED') hs,count(*) filter(where e.event_type in ('HANDOVER_ACCEPTED','TEAM_HANDOVER_ACCEPTED')) ha from gridvision_internal.read_operational_events(p_period,p_from,p_to,p_station_id,p_office_id) e)
  select b.start_at,b.end_at,now(),(select count(*) from scope),c.p,c.i,c.r,c.a,c.c,(select count(*) from public.station_conditions sc join scope s on s.station_id=sc.station_id where sc.status='OPEN'),c.ds,c.de,c.hs,c.ha from counts c cross join public.get_operational_period_range(p_period,p_from,p_to) b;
end;
$$;

-- Realtime reads remain RLS-filtered. Notification rows are visible only to
-- their recipient, and an event is visible only when it has such a recipient.
drop policy if exists notification_recipients_read_own on public.notification_recipients;
create policy notification_recipients_read_own on public.notification_recipients for select to authenticated using (user_id = auth.uid());
drop policy if exists notification_events_read_recipient on public.notification_events;
create policy notification_events_read_recipient on public.notification_events for select to authenticated using (exists (
  select 1 from public.notification_recipients recipient where recipient.notification_event_id = notification_events.id and recipient.user_id = auth.uid()
));
grant select on public.notification_events, public.notification_recipients to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['shift_handovers','shift_handover_entries','shift_duty_handover_states','notification_events','notification_recipients'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
      execute format('alter publication supabase_realtime add table public.%I',v_table);
    end if;
  end loop;
end;
$$;

commit;
