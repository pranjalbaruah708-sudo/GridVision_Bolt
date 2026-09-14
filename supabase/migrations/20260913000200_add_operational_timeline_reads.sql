begin;

-- Scope helpers never accept a caller-supplied user identity.
create function public.resolve_operational_station_scope(p_station_id uuid default null, p_office_id uuid default null)
returns table(station_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_station_id is not null and p_office_id is not null then
    raise exception 'Select either station or office' using errcode = '22023';
  end if;
  if p_station_id is not null then
    if not exists(select 1 from public.get_my_accessible_station_ids() a where a.station_id = p_station_id) then
      raise exception 'Station access is not authorized' using errcode = '42501';
    end if;
    return query select p_station_id;
  elsif p_office_id is not null then
    if not exists(select 1 from public.org_units o where o.id = p_office_id and o.active)
      or not (public.get_my_role() in ('ADMIN','SUPER_ADMIN') or
        (public.get_my_role() = 'FIELD_OFFICER' and exists(select 1 from public.get_my_accessible_org_unit_ids() a where a.org_unit_id = p_office_id))) then
      raise exception 'Office access is not authorized' using errcode = '42501';
    end if;
    return query with recursive offices as (
      select o.id,array[o.id] as path from public.org_units o where o.id = p_office_id and o.active
      union all select o.id,t.path || o.id from public.org_units o join offices t on o.parent_id=t.id
      where o.active and not o.id=any(t.path)
    ) select distinct a.station_id from public.get_my_accessible_station_ids() a
      join public.station_org_units m on m.station_id=a.station_id and m.active
      join offices o on o.id=m.org_unit_id;
  else
    return query select a.station_id from public.get_my_accessible_station_ids() a;
  end if;
end;
$$;

create function public.get_operational_scope_options()
returns table(scope_kind text,scope_id uuid,label text,office_type text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
    select 'ALL'::text,null::uuid,case when public.get_my_role() in ('ADMIN','SUPER_ADMIN') then 'Entire Utility' else 'All authorized stations' end,null::text
    union all select 'STATION',s.id,s.name,null::text from public.stations s
      join public.get_my_accessible_station_ids() a on a.station_id=s.id
    union all select 'OFFICE',o.id,o.name,o.unit_type from public.org_units o where o.active and
      (public.get_my_role() in ('ADMIN','SUPER_ADMIN') or (public.get_my_role()='FIELD_OFFICER' and
        o.id in (select a.org_unit_id from public.get_my_accessible_org_unit_ids() a)))
    order by 1,3,2;
end;
$$;

create function public.get_operational_period_range(p_period text, p_from date default null, p_to date default null)
returns table(start_at timestamptz,end_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if public.get_my_role() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_period in ('TODAY','THIS_MONTH') then
    if p_from is not null or p_to is not null then raise exception 'Preset periods do not accept custom dates' using errcode='22023'; end if;
    return query select (case when p_period='TODAY' then v_today else date_trunc('month',v_today::timestamp)::date end)::timestamp at time zone 'Asia/Kolkata', now();
  elsif p_period='CUSTOM' then
    if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
      or p_to<p_from or p_to>v_today or p_to-p_from>=366 then
      raise exception 'Select a valid non-future range of at most 366 inclusive days' using errcode='22023';
    end if;
    return query select p_from::timestamp at time zone 'Asia/Kolkata',(p_to+1)::timestamp at time zone 'Asia/Kolkata';
  else raise exception 'Invalid period' using errcode='22023';
  end if;
end;
$$;

-- Read projection only: no duplicate event storage. Actor names are intentionally
-- omitted rather than broadening app_users visibility or guessing restoration actors.
create function public.read_operational_events(p_period text,p_from date default null,p_to date default null,p_station_id uuid default null,p_office_id uuid default null)
returns table(event_type text,source_id uuid,event_time timestamptz,station_id uuid,feeder_id uuid,equipment_area text,title text,details text,severity text,status text)
language sql stable security invoker set search_path = public as $$
  with scope as materialized (select * from public.resolve_operational_station_scope(p_station_id,p_office_id)),
  bounds as materialized (select * from public.get_operational_period_range(p_period,p_from,p_to)),
  events as (
    select 'PARAMETER_ENTRY'::text as event_type,l.id as source_id,l.actual_event_time as event_time,l.station_id,l.feeder_id,null::text as equipment_area,
      'Parameter entry'::text as title,left(l.remarks,500) as details,null::text as severity,null::text as status
    from public.log_book_entries l join scope s on s.station_id=l.station_id cross join bounds b
    where l.actual_event_time>=b.start_at and l.actual_event_time<b.end_at
    union all
    select 'INTERRUPTION',i.id,i.interruption_start,i.station_id,i.feeder_id,null,'Interruption',left(concat_ws(' — ',i.cause,i.remarks),500),null,i.current_status
    from public.interruptions i join scope s on s.station_id=i.station_id cross join bounds b
    where i.current_status<>'CANCELLED' and i.interruption_start>=b.start_at and i.interruption_start<b.end_at
    union all
    select 'RESTORATION',i.id,i.interruption_end,i.station_id,i.feeder_id,null,'Restoration',left(i.remarks,500),null,i.current_status
    from public.interruptions i join scope s on s.station_id=i.station_id cross join bounds b
    where i.current_status='RESTORED' and i.interruption_end>=b.start_at and i.interruption_end<b.end_at
    union all
    select 'ALERT',a.id,a.triggered_at,a.station_id,a.feeder_id,null,'Parameter alert',
      left(concat_ws(' · ',a.parameter_code,a.breach_type,a.actual_value::text,a.notification_class,
        case when a.notification_suppressed then 'Notification suppressed' end),500),null,case when a.is_current then 'CURRENT' else 'HISTORICAL' end
    from public.parameter_alerts a join scope s on s.station_id=a.station_id cross join bounds b
    where a.triggered_at>=b.start_at and a.triggered_at<b.end_at
    union all
    select 'STATION_CONDITION',c.id,c.observed_at,c.station_id,null,c.equipment_area,'Station condition',left(c.observation,500),c.condition,c.status
    from public.station_conditions c join scope s on s.station_id=c.station_id cross join bounds b
    where c.observed_at>=b.start_at and c.observed_at<b.end_at
    union all
    select v.kind,d.id,v.at,d.station_id,null,null,v.title,d.shift_role,null,d.status
    from public.shift_duty_sessions d join scope s on s.station_id=d.station_id cross join bounds b
    cross join lateral (values ('DUTY_STARTED',d.started_at,'Duty started'),('DUTY_ENDED',d.ended_at,'Duty ended')) v(kind,at,title)
    where v.at>=b.start_at and v.at<b.end_at
    union all
    select v.kind,h.id,v.at,h.station_id,null,null,v.title,left(v.notes,500),null,h.status
    from public.shift_handovers h join scope s on s.station_id=h.station_id cross join bounds b
    cross join lateral (values ('HANDOVER_SUBMITTED',h.submitted_at,'Handover submitted',h.outgoing_notes),
      ('HANDOVER_ACCEPTED',h.accepted_at,'Handover accepted',h.acceptance_comments)) v(kind,at,title,notes)
    where v.at>=b.start_at and v.at<b.end_at
  ) select * from events;
$$;

create function public.get_operational_timeline(p_period text,p_from date default null,p_to date default null,
  p_station_id uuid default null,p_office_id uuid default null,p_limit integer default 50,p_offset integer default 0)
returns table(event_type text,source_id uuid,event_time timestamptz,station_id uuid,feeder_id uuid,equipment_area text,title text,details text,severity text,status text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_limit is null or p_limit<1 or p_limit>200 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Limit must be 1–200; offset must be 0–100000' using errcode='22023';
  end if;
  -- Eager validation also applies to empty result sets.
  perform * from public.get_operational_period_range(p_period,p_from,p_to);
  perform * from public.resolve_operational_station_scope(p_station_id,p_office_id);
  return query select e.* from gridvision_internal.read_operational_events(p_period,p_from,p_to,p_station_id,p_office_id) e
    order by e.event_time desc,e.event_type,e.source_id limit p_limit offset p_offset;
end;
$$;

create function public.get_operational_summary(p_period text,p_from date default null,p_to date default null,p_station_id uuid default null,p_office_id uuid default null)
returns table(start_at timestamptz,end_at timestamptz,as_of timestamptz,station_count bigint,parameter_entries bigint,
  interruptions_started bigint,restorations bigint,alerts bigint,conditions_observed bigint,current_open_conditions bigint,
  duty_starts bigint,duty_ends bigint,handovers_submitted bigint,handovers_accepted bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform * from public.get_operational_period_range(p_period,p_from,p_to);
  perform * from public.resolve_operational_station_scope(p_station_id,p_office_id);
  return query with scope as materialized (select * from public.resolve_operational_station_scope(p_station_id,p_office_id)),
  counts as (select count(*) filter(where e.event_type='PARAMETER_ENTRY') p,
    count(*) filter(where e.event_type='INTERRUPTION') i,count(*) filter(where e.event_type='RESTORATION') r,
    count(*) filter(where e.event_type='ALERT') a,count(*) filter(where e.event_type='STATION_CONDITION') c,
    count(*) filter(where e.event_type='DUTY_STARTED') ds,count(*) filter(where e.event_type='DUTY_ENDED') de,
    count(*) filter(where e.event_type='HANDOVER_SUBMITTED') hs,count(*) filter(where e.event_type='HANDOVER_ACCEPTED') ha
    from gridvision_internal.read_operational_events(p_period,p_from,p_to,p_station_id,p_office_id) e)
  select b.start_at,b.end_at,now(),(select count(*) from scope),c.p,c.i,c.r,c.a,c.c,
    (select count(*) from public.station_conditions sc join scope s on s.station_id=sc.station_id where sc.status='OPEN'),
    c.ds,c.de,c.hs,c.ha from counts c cross join public.get_operational_period_range(p_period,p_from,p_to) b;
end;
$$;

-- Internal projection is not an unbounded public RPC. Invoker wrappers need
-- permission to execute it, so relocate it to a non-exposed schema.
create schema if not exists gridvision_internal;
revoke all on schema gridvision_internal from public,anon;
grant usage on schema gridvision_internal to authenticated;
alter function public.read_operational_events(text,date,date,uuid,uuid) set schema gridvision_internal;
-- SQL/plpgsql bodies resolve this qualified name at execution time.
alter function public.get_operational_timeline(text,date,date,uuid,uuid,integer,integer) set search_path = public,gridvision_internal;
alter function public.get_operational_summary(text,date,date,uuid,uuid) set search_path = public,gridvision_internal;

revoke all on function gridvision_internal.read_operational_events(text,date,date,uuid,uuid) from public,anon;
grant execute on function gridvision_internal.read_operational_events(text,date,date,uuid,uuid) to authenticated;
revoke all on function public.resolve_operational_station_scope(uuid,uuid),public.get_operational_scope_options(),
  public.get_operational_period_range(text,date,date),public.get_operational_timeline(text,date,date,uuid,uuid,integer,integer),
  public.get_operational_summary(text,date,date,uuid,uuid) from public,anon;
grant execute on function public.resolve_operational_station_scope(uuid,uuid),public.get_operational_scope_options(),
  public.get_operational_period_range(text,date,date),public.get_operational_timeline(text,date,date,uuid,uuid,integer,integer),
  public.get_operational_summary(text,date,date,uuid,uuid) to authenticated;
commit;
