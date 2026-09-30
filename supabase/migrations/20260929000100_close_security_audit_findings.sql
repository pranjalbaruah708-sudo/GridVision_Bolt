-- Close the 29 September 2026 security-audit findings without changing
-- application-visible business rules. This migration is intentionally
-- idempotent so it can be rehearsed against a clone of the drifted deployment.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.edge_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, subject_hash, window_start),
  constraint edge_rate_limits_bucket_check
    check (bucket ~ '^[a-z0-9][a-z0-9:-]{0,79}$'),
  constraint edge_rate_limits_subject_hash_check
    check (subject_hash ~ '^[0-9a-f]{64}$')
);
alter table private.edge_rate_limits enable row level security;
revoke all on table private.edge_rate_limits from public, anon, authenticated;
create index if not exists edge_rate_limits_updated_at_idx
  on private.edge_rate_limits(updated_at);

create table if not exists private.edge_function_leases (
  lease_name text primary key,
  owner_id uuid not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint edge_function_leases_name_check
    check (lease_name ~ '^[a-z0-9][a-z0-9:-]{0,79}$')
);
alter table private.edge_function_leases enable row level security;
revoke all on table private.edge_function_leases from public, anon, authenticated;

create or replace function public.consume_edge_rate_limit(
  p_bucket text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_attempts integer;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
     or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit request' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into private.edge_rate_limits(bucket, subject_hash, window_start, attempts, updated_at)
  values (p_bucket, p_subject_hash, v_window_start, 1, v_now)
  on conflict (bucket, subject_hash, window_start) do update
    set attempts = private.edge_rate_limits.attempts + 1,
        updated_at = excluded.updated_at
  returning attempts into v_attempts;

  -- Bounded opportunistic cleanup avoids an unbounded abuse-control ledger.
  delete from private.edge_rate_limits
  where updated_at < v_now - interval '2 days';

  return v_attempts <= p_limit;
end;
$$;

create or replace function public.acquire_edge_function_lease(
  p_lease_name text,
  p_owner uuid,
  p_lease_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
declare
  v_acquired boolean := false;
begin
  if p_lease_name is null or p_lease_name !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
     or p_owner is null
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'Invalid lease request' using errcode = '22023';
  end if;

  insert into private.edge_function_leases(lease_name, owner_id, expires_at, updated_at)
  values (p_lease_name, p_owner, clock_timestamp() + make_interval(secs => p_lease_seconds), clock_timestamp())
  on conflict (lease_name) do update
    set owner_id = excluded.owner_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    where private.edge_function_leases.expires_at <= clock_timestamp()
       or private.edge_function_leases.owner_id = excluded.owner_id
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_edge_function_lease(
  p_lease_name text,
  p_owner uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
declare
  v_released_count bigint;
begin
  delete from private.edge_function_leases
  where lease_name = p_lease_name and owner_id = p_owner;
  get diagnostics v_released_count = row_count;
  return v_released_count > 0;
end;
$$;

-- Re-assert the authoritative feeder-management scope with an unambiguous
-- output reference. The deployed project currently contains an older body.
create or replace function public.get_my_manageable_feeder_station_ids()
returns table(station_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_user_role;
begin
  select au.role into v_role
  from public.app_users au
  where au.id = auth.uid() and au.active;

  if v_role in ('ADMIN'::public.app_user_role, 'SUPER_ADMIN'::public.app_user_role) then
    return query
      select s.id from public.stations s where s.active order by s.name;
    return;
  end if;

  if v_role = 'FIELD_OFFICER'::public.app_user_role then
    return query
      select accessible.station_id
      from public.get_my_accessible_station_ids() accessible;
  end if;
end;
$$;

-- Correct the authoritative active-user column and use an explicit scoped
-- membership test. This table remains write-only through this RPC.
create or replace function public.record_shift_duty_exception(
  p_shift_id uuid,
  p_reason text
)
returns public.shift_duty_exception_audits
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.shift_duty_exception_audits;
  v_user public.app_users;
  v_shift public.station_shifts;
begin
  select * into v_user
  from public.app_users
  where id = auth.uid() and active and role = 'OPERATOR';
  if v_user.id is null then
    raise exception 'Only active operators may record an exception' using errcode = '42501';
  end if;

  select * into v_shift from public.station_shifts where id = p_shift_id;
  if v_shift.id is null or not exists (
    select 1 from public.get_my_accessible_station_ids() accessible
    where accessible.station_id = v_shift.station_id
  ) then
    raise exception 'Shift access is not authorized' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason between 1 and 1000 characters is required' using errcode = '22023';
  end if;

  insert into public.shift_duty_exception_audits(shift_id, station_id, user_id, reason)
  values (v_shift.id, v_shift.station_id, auth.uid(), btrim(p_reason))
  returning * into v_row;
  return v_row;
end;
$$;

-- The latest body writes an overdue-handover audit event and therefore must
-- not be declared STABLE.
alter function public.get_current_station_shift(uuid) volatile;

-- Re-assert the sensitive table boundary even if the earlier hardening
-- migration was skipped in a drifted environment.
alter table if exists public.feeder_thresholds enable row level security;
alter table if exists public.parameter_alerts enable row level security;
alter table if exists public.notification_config enable row level security;
revoke all on table public.feeder_thresholds from public, anon, authenticated;
revoke all on table public.notification_config from public, anon, authenticated;
revoke all on table public.parameter_alerts from public, anon, authenticated;
grant select on table public.parameter_alerts to authenticated;

drop policy if exists "Users read alerts for accessible stations" on public.parameter_alerts;
create policy "Users read alerts for accessible stations"
  on public.parameter_alerts for select to authenticated
  using (exists (
    select 1 from public.get_my_accessible_station_ids() accessible
    where accessible.station_id = parameter_alerts.station_id
  ));

-- PostgreSQL grants new function execution to PUBLIC unless the creator's
-- defaults say otherwise. Remove inherited execution from existing
-- SECURITY DEFINER boundaries without disrupting ordinary invoker/report
-- functions, then prevent recurrence for all newly created functions.
do $public_function_security$
declare
  signature text;
begin
  for signature in
    select format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    )
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', signature);
  end loop;
end
$public_function_security$;

alter default privileges in schema public revoke execute on functions from public;

do $security$
begin
  if to_regnamespace('gridvision_internal') is not null then
    execute 'revoke execute on all functions in schema gridvision_internal from public, anon';
    execute 'alter default privileges in schema gridvision_internal revoke execute on functions from public';
  end if;
end
$security$;

revoke all on function public.consume_edge_rate_limit(text,text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.acquire_edge_function_lease(text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.release_edge_function_lease(text,uuid)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text,text,integer,integer) to service_role;
grant execute on function public.acquire_edge_function_lease(text,uuid,integer) to service_role;
grant execute on function public.release_edge_function_lease(text,uuid) to service_role;

revoke all on function public.get_my_manageable_feeder_station_ids() from public, anon, authenticated;
grant execute on function public.get_my_manageable_feeder_station_ids() to authenticated;
revoke all on function public.record_shift_duty_exception(uuid,text) from public, anon, authenticated;
grant execute on function public.record_shift_duty_exception(uuid,text) to authenticated;

-- Internal notification plumbing remains trigger/owner/service-role only.
do $notification_security$
declare
  signature text;
begin
  foreach signature in array array[
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text)',
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text)',
    'public.get_notification_recipients(uuid)',
    'public.get_notification_recipients(uuid,text)',
    'public.get_notification_device_tokens(uuid)',
    'public.handle_interruption_notification()',
    'public.evaluate_logbook_parameter_thresholds()',
    'public.prepare_upcoming_shift_duty_notifications()'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', signature);
    end if;
  end loop;
end
$notification_security$;

commit;
