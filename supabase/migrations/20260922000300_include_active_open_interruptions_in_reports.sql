-- An interruption report covers interruptions active during its selected
-- period, not only those first recorded during it. This keeps long-running
-- OPEN feeder outages visible until they are restored.
begin;

create or replace function public.get_interruption_report_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid default null,
  p_feeder_id uuid default null,
  p_status text default null,
  p_cause text default null
)
returns table(total_interruptions bigint, open_interruptions bigint, total_duration_minutes numeric, average_restoration_minutes numeric, longest_interruption_minutes numeric)
language sql stable set search_path=public as $$
with accessible as (
  select station_id from public.get_my_operational_station_ids()
), scoped as (
  select i.*,
    case
      when i.current_status = 'OPEN' then extract(epoch from (least(now(), p_end) - greatest(i.interruption_start, p_start))) / 60
      when i.interruption_end is not null then extract(epoch from (least(i.interruption_end, p_end) - greatest(i.interruption_start, p_start))) / 60
      else i.duration_minutes
    end as effective_duration_minutes
  from public.interruptions i
  join accessible a on a.station_id = i.station_id
  where i.interruption_start < p_end
    and (
      i.current_status = 'OPEN'
      or i.interruption_start >= p_start
      or i.interruption_end >= p_start
    )
    and (p_station_id is null or i.station_id = p_station_id)
    and (p_feeder_id is null or i.feeder_id = p_feeder_id)
    and (p_status is null or i.current_status = p_status)
    and (p_cause is null or i.cause = p_cause)
)
select count(*)::bigint,
  count(*) filter (where current_status = 'OPEN')::bigint,
  coalesce(round(sum(effective_duration_minutes), 1), 0),
  round(avg(effective_duration_minutes) filter (where current_status = 'RESTORED' and interruption_end is not null), 1),
  round(max(effective_duration_minutes), 1)
from scoped;
$$;

create or replace function public.get_interruption_report_trend(
  p_start timestamptz,
  p_end timestamptz,
  p_station_id uuid default null,
  p_feeder_id uuid default null,
  p_status text default null,
  p_cause text default null
)
returns table(date date, interruption_count bigint, duration_minutes numeric, open_count bigint)
language sql stable set search_path=public as $$
with accessible as (
  select station_id from public.get_my_operational_station_ids()
), scoped as (
  select i.*,
    case
      when i.current_status = 'OPEN' then extract(epoch from (least(now(), p_end) - greatest(i.interruption_start, p_start))) / 60
      when i.interruption_end is not null then extract(epoch from (least(i.interruption_end, p_end) - greatest(i.interruption_start, p_start))) / 60
      else i.duration_minutes
    end as effective_duration_minutes,
    greatest(i.interruption_start, p_start) as report_activity_start
  from public.interruptions i
  join accessible a on a.station_id = i.station_id
  where i.interruption_start < p_end
    and (
      i.current_status = 'OPEN'
      or i.interruption_start >= p_start
      or i.interruption_end >= p_start
    )
    and (p_station_id is null or i.station_id = p_station_id)
    and (p_feeder_id is null or i.feeder_id = p_feeder_id)
    and (p_status is null or i.current_status = p_status)
    and (p_cause is null or i.cause = p_cause)
)
select (report_activity_start at time zone 'Asia/Kolkata')::date,
  count(*)::bigint,
  coalesce(round(sum(effective_duration_minutes), 1), 0),
  count(*) filter (where current_status = 'OPEN')::bigint
from scoped
group by 1
order by 1;
$$;

create or replace function public.get_interruption_report_breakdown(
  p_start timestamptz,
  p_end timestamptz,
  p_group text,
  p_station_id uuid default null,
  p_feeder_id uuid default null,
  p_status text default null,
  p_cause text default null,
  p_limit integer default 5
)
returns table(label text, interruption_count bigint, duration_minutes numeric)
language sql stable set search_path=public as $$
with accessible as (
  select station_id from public.get_my_operational_station_ids()
), scoped as (
  select i.*, s.name as station_name, f.name as feeder_name,
    case
      when i.current_status = 'OPEN' then extract(epoch from (least(now(), p_end) - greatest(i.interruption_start, p_start))) / 60
      when i.interruption_end is not null then extract(epoch from (least(i.interruption_end, p_end) - greatest(i.interruption_start, p_start))) / 60
      else i.duration_minutes
    end as effective_duration_minutes
  from public.interruptions i
  join accessible a on a.station_id = i.station_id
  join public.stations s on s.id = i.station_id
  left join public.feeders f on f.id = i.feeder_id
  where i.interruption_start < p_end
    and (
      i.current_status = 'OPEN'
      or i.interruption_start >= p_start
      or i.interruption_end >= p_start
    )
    and (p_station_id is null or i.station_id = p_station_id)
    and (p_feeder_id is null or i.feeder_id = p_feeder_id)
    and (p_status is null or i.current_status = p_status)
    and (p_cause is null or i.cause = p_cause)
), grouped as (
  select case p_group
      when 'STATION' then station_name
      when 'FEEDER' then coalesce(feeder_name, 'Not recorded')
      when 'CAUSE' then coalesce(cause, 'Not recorded')
      else 'Not recorded'
    end as label,
    count(*)::bigint as interruption_count,
    coalesce(round(sum(effective_duration_minutes), 1), 0) as duration_minutes
  from scoped
  group by 1
)
select label, interruption_count, duration_minutes
from grouped
order by duration_minutes desc, interruption_count desc, label asc
limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

grant execute on function public.get_interruption_report_summary(timestamptz, timestamptz, uuid, uuid, text, text) to authenticated;
grant execute on function public.get_interruption_report_trend(timestamptz, timestamptz, uuid, uuid, text, text) to authenticated;
grant execute on function public.get_interruption_report_breakdown(timestamptz, timestamptz, text, uuid, uuid, text, text, integer) to authenticated;

commit;
