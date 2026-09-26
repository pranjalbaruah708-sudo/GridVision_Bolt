-- Current Shift must only present an unattended final-release alert while the
-- incoming shift can still be taken up. Historical unresolved handovers remain
-- available to oversight and report contracts as missed acceptance records.
begin;

create or replace function public.get_my_v2_handover_unattended(p_station_id uuid)
returns table(handover_id uuid,incoming_shift_id uuid,released_at timestamptz,status text)
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.assert_shift_station_access(p_station_id);

  return query
  select
    unattended.handover_id,
    unattended.incoming_shift_id,
    unattended.released_at,
    unattended.status
  from public.shift_handover_unattended_states unattended
  join public.station_shifts incoming
    on incoming.id = unattended.incoming_shift_id
  join public.shift_handovers handover
    on handover.id = unattended.handover_id
  where unattended.station_id = p_station_id
    and unattended.status = 'OPEN'
    and handover.workflow_version = 2
    and handover.status = 'SUBMITTED'
    -- An expired incoming shift is a historical missed-acceptance case, not a
    -- current operational alert. It must not keep the officer banner visible.
    and now() < incoming.scheduled_end
    and not exists (
      select 1
      from public.shift_duty_handover_states individual_state
      join public.shift_duty_sessions duty
        on duty.id = individual_state.duty_session_id
      where individual_state.handover_id = unattended.handover_id
        and individual_state.side = 'INCOMING'
        and individual_state.state = 'ACCEPTED_AND_STARTED'
        and duty.status = 'ON_DUTY'
        and duty.ended_at is null
    )
    and (
      exists (
        select 1
        from public.station_shift_assignments assignment
        where assignment.shift_id = incoming.id
          and assignment.user_id = auth.uid()
      )
      or incoming.created_by = auth.uid()
    )
  order by unattended.released_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_v2_handover_unattended(uuid) from public, anon;
grant execute on function public.get_my_v2_handover_unattended(uuid) to authenticated;

commit;
