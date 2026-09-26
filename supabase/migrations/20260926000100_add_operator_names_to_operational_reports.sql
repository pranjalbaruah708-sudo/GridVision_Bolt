-- Report views must expose display names, never raw operational user IDs.

begin;

create or replace view public.scoped_logbook_report_entries
with (security_invoker = true, security_barrier = true) as
select
  entry.*,
  operator.full_name as operator_name
from public.log_book_entries entry
left join public.app_users operator on operator.id = entry.operator_id
where entry.station_id in (
  select station_id from public.get_my_operational_station_ids()
);

create or replace view public.scoped_interruption_report_entries
with (security_invoker = true, security_barrier = true) as
select
  interruption.*,
  operator.full_name as operator_name
from public.interruptions interruption
left join public.app_users operator on operator.id = interruption.operator_id
where interruption.station_id in (
  select station_id from public.get_my_operational_station_ids()
);

revoke all on public.scoped_logbook_report_entries, public.scoped_interruption_report_entries from public, anon, authenticated;
grant select on public.scoped_logbook_report_entries, public.scoped_interruption_report_entries to authenticated;

commit;
