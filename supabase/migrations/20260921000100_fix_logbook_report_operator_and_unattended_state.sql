-- Correct report display data and clear durable unattended indicators once a
-- V2 incoming operator has accepted and started duty.
begin;

create or replace view public.scoped_logbook_report_entries
with (security_invoker = true, security_barrier = true) as
select
  l.*,
  operator.full_name as operator_name
from public.log_book_entries l
left join public.app_users operator on operator.id = l.operator_id
where l.station_id in (
  select station_id from public.get_my_operational_station_ids()
);

revoke all on public.scoped_logbook_report_entries from public, anon, authenticated;
grant select on public.scoped_logbook_report_entries to authenticated;

update public.shift_handover_unattended_states unattended
set
  status = 'CLOSED',
  closed_at = coalesce(unattended.closed_at, handover.accepted_at, now()),
  first_incoming_duty_session_id = coalesce(
    unattended.first_incoming_duty_session_id,
    handover.team_accepted_duty_session_id
  )
from public.shift_handovers handover
where handover.id = unattended.handover_id
  and unattended.status = 'OPEN'
  and handover.workflow_version = 2
  and handover.status = 'ACCEPTED';

create or replace function public.get_my_v2_handover_unattended(p_station_id uuid)
returns table(handover_id uuid,incoming_shift_id uuid,released_at timestamptz,status text)
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.assert_shift_station_access(p_station_id);
  return query
  select u.handover_id,u.incoming_shift_id,u.released_at,u.status
  from public.shift_handover_unattended_states u
  join public.station_shifts incoming on incoming.id=u.incoming_shift_id
  join public.shift_handovers h on h.id=u.handover_id
  where u.station_id=p_station_id
    and u.status='OPEN'
    and h.status='SUBMITTED'
    and not exists (
      select 1
      from public.shift_duty_handover_states state
      join public.shift_duty_sessions duty on duty.id=state.duty_session_id
      where state.handover_id=u.handover_id
        and state.side='INCOMING'
        and state.state='ACCEPTED_AND_STARTED'
        and duty.status='ON_DUTY'
        and duty.ended_at is null
    )
    and (
      exists(select 1 from public.station_shift_assignments a where a.shift_id=incoming.id and a.user_id=auth.uid())
      or incoming.created_by=auth.uid()
    )
  order by u.released_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_v2_handover_unattended(uuid) from public, anon;
grant execute on function public.get_my_v2_handover_unattended(uuid) to authenticated;

commit;
