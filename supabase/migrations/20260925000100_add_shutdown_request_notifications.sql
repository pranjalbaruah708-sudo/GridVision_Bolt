-- Notify office-scoped field officers when an operator initiates a shutdown,
-- and notify that operator when the request is approved or rejected.
-- Events are idempotent and create an in-app recipient even without a device token.

create or replace function public.enqueue_shutdown_request_notification(
  p_shutdown_id uuid,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_request public.shutdown_requests%rowtype;
  v_requester_role public.app_user_role;
  v_requester_name text;
  v_station_name text;
  v_event_id uuid;
  v_source_operation_id text;
  v_message text;
begin
  select sr.*
    into v_request
  from public.shutdown_requests sr
  where sr.id = p_shutdown_id;

  if v_request.id is null then
    raise exception 'Shutdown request not found' using errcode = 'P0002';
  end if;

  select requester.role, requester.full_name, station.name
    into v_requester_role, v_requester_name, v_station_name
  from public.app_users requester
  join public.stations station on station.id = v_request.station_id
  where requester.id = v_request.requested_by;

  if p_kind = 'INITIATED' then
    if v_requester_role <> 'OPERATOR'::public.app_user_role then
      return null;
    end if;
    v_source_operation_id := 'SHUTDOWN_REQUEST_INITIATED:' || v_request.id::text;
    v_message := format(
      'Shutdown request %s has been initiated for %s by %s.',
      v_request.sd_number,
      v_station_name,
      coalesce(nullif(v_requester_name, ''), 'an operator')
    );
  elsif p_kind = 'DECIDED' then
    if v_requester_role <> 'OPERATOR'::public.app_user_role
       or v_request.status not in ('APPROVED', 'REJECTED') then
      return null;
    end if;
    v_source_operation_id := 'SHUTDOWN_REQUEST_DECISION:' || v_request.id::text || ':' || v_request.status;
    v_message := format(
      'Your shutdown request %s for %s has been %s.',
      v_request.sd_number,
      v_station_name,
      lower(replace(v_request.status, '_', ' '))
    );
  else
    raise exception 'Unsupported shutdown notification kind' using errcode = '22023';
  end if;

  insert into public.notification_events (
    station_id,
    feeder_id,
    event_time,
    message,
    max_unit_type,
    created_by,
    source_operation_id,
    notification_class
  ) values (
    v_request.station_id,
    v_request.feeder_id,
    now(),
    v_message,
    coalesce((select max_unit_type from public.notification_config where active order by updated_at desc limit 1), 'HQ'),
    v_request.requested_by,
    v_source_operation_id,
    'LIVE'
  ) on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id
    from public.notification_events
    where source_operation_id = v_source_operation_id;
  end if;

  if p_kind = 'INITIATED' then
    -- A field officer's assigned office includes every active descendant office.
    -- The station is eligible when it is mapped to any of those descendant offices.
    insert into public.notification_recipients (
      notification_event_id,
      user_id,
      device_token_id,
      status
    )
    with recursive officer_scope as (
      select uou.user_id, uou.org_unit_id, array[uou.org_unit_id] as path
      from public.user_org_units uou
      join public.app_users officer
        on officer.id = uou.user_id
       and officer.active
       and officer.role = 'FIELD_OFFICER'::public.app_user_role
      join public.org_units root
        on root.id = uou.org_unit_id
       and root.active
      where uou.active

      union all

      select officer_scope.user_id, child.id, officer_scope.path || child.id
      from officer_scope
      join public.org_units child
        on child.parent_id = officer_scope.org_unit_id
       and child.active
      where not child.id = any(officer_scope.path)
    ), targets as (
      select distinct officer_scope.user_id
      from officer_scope
      join public.station_org_units sou
        on sou.org_unit_id = officer_scope.org_unit_id
       and sou.station_id = v_request.station_id
       and sou.active
    )
    select v_event_id, targets.user_id, null, 'PENDING'
    from targets
    where not exists (
      select 1
      from public.notification_recipients existing
      where existing.notification_event_id = v_event_id
        and existing.user_id = targets.user_id
        and existing.device_token_id is null
    );
  else
    insert into public.notification_recipients (
      notification_event_id,
      user_id,
      device_token_id,
      status
    )
    select v_event_id, v_request.requested_by, null, 'PENDING'
    where not exists (
      select 1
      from public.notification_recipients existing
      where existing.notification_event_id = v_event_id
        and existing.user_id = v_request.requested_by
        and existing.device_token_id is null
    );
  end if;

  -- Keep each active device as a separate delivery attempt while retaining the
  -- null-token row above as the durable in-app notification.
  insert into public.notification_recipients (
    notification_event_id,
    user_id,
    device_token_id,
    status
  )
  select v_event_id, in_app.user_id, token.id, 'PENDING'
  from public.notification_recipients in_app
  join public.device_tokens token
    on token.user_id = in_app.user_id
   and token.is_active
  where in_app.notification_event_id = v_event_id
    and in_app.device_token_id is null
  on conflict do nothing;

  return v_event_id;
end;
$function$;

create or replace function public.handle_shutdown_request_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_shutdown_request_notification(new.id, 'INITIATED');
  elsif old.status = 'PENDING_APPROVAL'
    and new.status in ('APPROVED', 'REJECTED') then
    perform public.enqueue_shutdown_request_notification(new.id, 'DECIDED');
  end if;
  return new;
exception when others then
  raise warning 'Shutdown notification generation failed for request %: %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists shutdown_request_notification on public.shutdown_requests;
create trigger shutdown_request_notification
after insert or update of status on public.shutdown_requests
for each row execute function public.handle_shutdown_request_notification();

revoke all on function public.enqueue_shutdown_request_notification(uuid, text) from public, anon, authenticated;
revoke all on function public.handle_shutdown_request_notification() from public, anon, authenticated;
