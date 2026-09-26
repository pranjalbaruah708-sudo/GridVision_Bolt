-- Keep app_users self-only RLS intact while allowing an authorised report row
-- to resolve only its own operator display name.

begin;

create or replace function public.get_scoped_report_operator_name(
  p_source text,
  p_record_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_station_id uuid;
  v_operator_id uuid;
  v_operator_name text;
begin
  if auth.uid() is null then
    return null;
  end if;

  if p_source = 'LOGBOOK' then
    select entry.station_id, entry.operator_id
      into v_station_id, v_operator_id
    from public.log_book_entries entry
    where entry.id = p_record_id;
  elsif p_source = 'INTERRUPTION' then
    select interruption.station_id, interruption.operator_id
      into v_station_id, v_operator_id
    from public.interruptions interruption
    where interruption.id = p_record_id;
  else
    raise exception 'Unsupported report source' using errcode = '22023';
  end if;

  if v_station_id is null or v_operator_id is null
     or not exists (
       select 1
       from public.get_my_operational_station_ids() scope
       where scope.station_id = v_station_id
     ) then
    return null;
  end if;

  select operator.full_name
    into v_operator_name
  from public.app_users operator
  where operator.id = v_operator_id;

  return v_operator_name;
end;
$$;

create or replace view public.scoped_logbook_report_entries
with (security_invoker = true, security_barrier = true) as
select
  entry.*,
  public.get_scoped_report_operator_name('LOGBOOK', entry.id) as operator_name
from public.log_book_entries entry
where entry.station_id in (
  select station_id from public.get_my_operational_station_ids()
);

create or replace view public.scoped_interruption_report_entries
with (security_invoker = true, security_barrier = true) as
select
  interruption.*,
  public.get_scoped_report_operator_name('INTERRUPTION', interruption.id) as operator_name
from public.interruptions interruption
where interruption.station_id in (
  select station_id from public.get_my_operational_station_ids()
);

revoke all on function public.get_scoped_report_operator_name(text, uuid) from public, anon, authenticated;
grant execute on function public.get_scoped_report_operator_name(text, uuid) to authenticated;
revoke all on public.scoped_logbook_report_entries, public.scoped_interruption_report_entries from public, anon, authenticated;
grant select on public.scoped_logbook_report_entries, public.scoped_interruption_report_entries to authenticated;

commit;
