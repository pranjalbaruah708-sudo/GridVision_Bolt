begin;

-- The report returns timestamptz values and the client formats them in
-- Asia/Kolkata. Returning min_time after AT TIME ZONE converted the local
-- wall-clock value back through the database session timezone, shifting the
-- instant. Preserve the original timestamptz instead.
do $do$
declare
  definition text;
begin
  select pg_get_functiondef(p.oid)
    into definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_executive_summary_report'
    and pg_get_function_identity_arguments(p.oid) = 'p_start timestamp with time zone, p_end timestamp with time zone, p_station_id uuid';

  if definition is null then
    raise exception 'get_executive_summary_report definition was not found';
  end if;

  definition := replace(
    definition,
    'min_voltage_time.min_time AT TIME ZONE ''Asia/Kolkata''',
    'min_voltage_time.min_time'
  );
  execute definition;
end
$do$;

commit;
