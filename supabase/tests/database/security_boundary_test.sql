-- Read-only security regression. Run against a disposable/staging database
-- after applying all migrations. The transaction is always rolled back.

begin;

do $test$
declare
  v_names text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_names
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_names is not null then
    raise exception 'Public application tables without RLS: %', v_names;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'gridvision_internal')
    and p.prosecdef
    and (
      coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      or exists (
        select 1
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    );
  if v_names is not null then
    raise exception 'SECURITY DEFINER functions executable by anon/PUBLIC: %', v_names;
  end if;

  if exists (
    select 1 from (values
      ('feeder_thresholds'), ('parameter_alerts'), ('notification_config'),
      ('administration_audit_log'), ('shift_duty_exception_audits'),
      ('shift_handover_audit_events'), ('shift_handover_command_receipts')
    ) required(table_name)
    left join pg_catalog.pg_class c
      on c.oid = pg_catalog.to_regclass('public.' || required.table_name)
    where c.oid is null or not c.relrowsecurity
  ) then
    raise exception 'A required sensitive table is absent or does not have RLS enabled';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.administration_audit_log', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.administration_audit_log', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.administration_audit_log', 'DELETE') then
    raise exception 'Authenticated clients can mutate the administration audit ledger directly';
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'public.consume_edge_rate_limit(text,text,integer,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.acquire_edge_function_lease(text,uuid,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.release_edge_function_lease(text,uuid)', 'EXECUTE') then
    raise exception 'Authenticated clients can execute an internal Edge security primitive';
  end if;

  if not pg_catalog.has_function_privilege('service_role', 'public.consume_edge_rate_limit(text,text,integer,integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.acquire_edge_function_lease(text,uuid,integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.release_edge_function_lease(text,uuid)', 'EXECUTE') then
    raise exception 'Service role is missing an Edge security primitive grant';
  end if;

  if (select p.provolatile from pg_catalog.pg_proc p where p.oid = 'public.get_current_station_shift(uuid)'::regprocedure) <> 'v' then
    raise exception 'get_current_station_shift must be VOLATILE because it writes audit state';
  end if;
end
$test$;

rollback;
