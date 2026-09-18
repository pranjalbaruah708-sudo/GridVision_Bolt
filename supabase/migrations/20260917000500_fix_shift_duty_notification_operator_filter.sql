-- Correct the operator filter used by the scheduled 15-minute reminder.
-- GridVision app_users uses role and active as the authoritative fields.
create or replace function public.prepare_upcoming_shift_duty_notifications()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_shift record;
  v_event uuid;
  v_message text;
begin
  for v_shift in
    select s.id, s.station_id, s.scheduled_start, st.name as station_name
    from public.station_shifts s
    join public.stations st on st.id = s.station_id
    where s.status = 'SCHEDULED'
      and s.scheduled_start > now() + interval '14 minutes'
      and s.scheduled_start <= now() + interval '16 minutes'
      and exists (select 1 from public.station_shift_assignments a where a.shift_id = s.id)
  loop
    v_message := format('Upcoming Shift Duty: Your shift at %s starts in 15 minutes at %s. Please be ready to take charge.', v_shift.station_name, to_char(v_shift.scheduled_start at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI'));
    insert into public.notification_events(station_id, event_time, message, max_unit_type, created_by, source_operation_id, notification_class)
    select v_shift.station_id, v_shift.scheduled_start, v_message, coalesce((select max_unit_type from public.notification_config where active order by updated_at desc limit 1), 'HQ'), null, 'SHIFT_DUTY_15MIN:' || v_shift.id::text, 'LIVE'
    where not exists (select 1 from public.notification_events e where e.source_operation_id = 'SHIFT_DUTY_15MIN:' || v_shift.id::text)
    returning id into v_event;
    if v_event is not null then
      insert into public.notification_recipients(notification_event_id, user_id, device_token_id, status)
      select v_event, a.user_id, dt.id, 'PENDING'
      from public.station_shift_assignments a
      join public.app_users u on u.id = a.user_id and u.role = 'OPERATOR' and u.active = true
      join public.device_tokens dt on dt.user_id = a.user_id and dt.is_active = true
      on conflict (notification_event_id, device_token_id) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.prepare_upcoming_shift_duty_notifications() from public, anon, authenticated;
grant execute on function public.prepare_upcoming_shift_duty_notifications() to service_role;
