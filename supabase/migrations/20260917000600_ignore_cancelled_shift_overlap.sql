-- Cancelled shifts no longer reserve their time window. Scheduled and active
-- shifts continue to obey the existing no-overlap rule.
create or replace function public.enforce_station_shift_no_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.station_id::text, 0));
  if new.status <> 'CANCELLED' and exists (
    select 1
    from public.station_shifts s
    where s.station_id = new.station_id
      and s.id is distinct from new.id
      and s.status <> 'CANCELLED'
      and s.scheduled_start < new.scheduled_end
      and s.scheduled_end > new.scheduled_start
  ) then
    raise exception 'Station shifts cannot overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
