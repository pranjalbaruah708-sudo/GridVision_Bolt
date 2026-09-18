-- Bounded current snapshot for the Operational Summary attention card.
create or replace function public.get_operational_open_conditions(
  p_period text, p_from date default null, p_to date default null,
  p_station_id uuid default null, p_office_id uuid default null
)
returns table(id uuid, station_id uuid, station_name text, observed_at timestamptz,
  category text, equipment_area text, condition text, observation text)
language plpgsql stable security invoker set search_path = public as $$
begin
  perform * from public.get_operational_period_range(p_period,p_from,p_to);
  return query
    select c.id, c.station_id, s.name, c.observed_at, c.category,
      c.equipment_area, c.condition, c.observation
    from public.station_conditions c
    join public.resolve_operational_station_scope(p_station_id,p_office_id) scope
      on scope.station_id = c.station_id
    join public.stations s on s.id = c.station_id
    where c.status = 'OPEN'
    order by c.observed_at desc, c.id desc
    limit 100;
end;
$$;

revoke all on function public.get_operational_open_conditions(text,date,date,uuid,uuid) from public, anon;
grant execute on function public.get_operational_open_conditions(text,date,date,uuid,uuid) to authenticated;
