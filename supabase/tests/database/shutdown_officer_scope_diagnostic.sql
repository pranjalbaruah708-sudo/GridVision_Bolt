-- Read-only DEV diagnostic for Officer A organisation/station scope.
-- Run only against linked project eetlzxntgvjompmipprb.

begin;

set local statement_timeout = '30s';

-- A scalar subquery fails on duplicates. The UUID cast below fails if the
-- required active FIELD_OFFICER record is absent or has the wrong role.
select set_config(
  'shutdown_scope_diag.officer_id',
  (
    select au.id::text
    from public.app_users au
    where lower(au.email) = lower('testofficer@gridvision.com')
      and au.active = true
      and au.role = 'FIELD_OFFICER'::public.app_user_role
  ),
  true
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('shutdown_scope_diag.officer_id')::uuid,
    'role', 'authenticated'
  )::text,
  true
);

-- Division by zero stops the diagnostic if the simulated identity is wrong.
select 1 / case
  when auth.uid() = current_setting('shutdown_scope_diag.officer_id')::uuid then 1
  else 0
end as auth_uid_verified;

reset role;

with recursive
officer as (
  select au.id, au.email, au.role, au.active
  from public.app_users au
  where au.id = current_setting('shutdown_scope_diag.officer_id')::uuid
),
direct_assignments as (
  select
    uou.id as assignment_id,
    uou.user_id,
    uou.org_unit_id,
    uou.is_primary,
    uou.active as assignment_active,
    uou.assigned_at,
    uou.created_at,
    uou.updated_at,
    ou.name as org_unit_name,
    ou.unit_type,
    ou.parent_id,
    ou.active as org_unit_active
  from public.user_org_units uou
  join public.org_units ou on ou.id = uou.org_unit_id
  where uou.user_id = (select id from officer)
    and uou.active = true
),
org_paths as (
  select
    da.org_unit_id,
    da.org_unit_name,
    da.unit_type,
    da.parent_id,
    0 as depth,
    true as directly_assigned,
    da.org_unit_id as root_assignment_id,
    array[da.org_unit_id] as id_path,
    array[da.org_unit_name] as name_path
  from direct_assignments da
  where da.org_unit_active = true

  union all

  select
    child.id,
    child.name,
    child.unit_type,
    child.parent_id,
    parent.depth + 1,
    false,
    parent.root_assignment_id,
    parent.id_path || child.id,
    parent.name_path || child.name
  from org_paths parent
  join public.org_units child on child.parent_id = parent.org_unit_id
  where child.active = true
    and not child.id = any(parent.id_path)
),
effective_org as (
  select distinct on (op.org_unit_id)
    op.org_unit_id,
    op.org_unit_name,
    op.unit_type,
    op.parent_id,
    op.depth,
    op.directly_assigned,
    op.root_assignment_id,
    op.id_path,
    op.name_path
  from org_paths op
  order by op.org_unit_id, op.depth, op.root_assignment_id
),
mapping_paths as (
  select
    eo.root_assignment_id,
    eo.org_unit_id,
    eo.org_unit_name,
    eo.unit_type,
    eo.depth,
    eo.directly_assigned,
    eo.id_path,
    eo.name_path,
    sou.id as station_mapping_id,
    sou.active as station_mapping_active,
    sou.is_primary,
    sou.station_id,
    s.name as station_name,
    s.active as station_active
  from effective_org eo
  join public.station_org_units sou
    on sou.org_unit_id = eo.org_unit_id
   and sou.active = true
  join public.stations s on s.id = sou.station_id
),
helper_org as (
  select h.org_unit_id
  from public.get_my_accessible_org_unit_ids() h
),
helper_stations as (
  select h.station_id, s.name as station_name, s.active as station_active
  from public.get_my_accessible_station_ids() h
  left join public.stations s on s.id = h.station_id
)
select jsonb_build_object(
  'officer', (select to_jsonb(o) from officer o),
  'auth_context', jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_role', current_setting('request.jwt.claims', true)::jsonb->>'role',
    'jwt_sub', current_setting('request.jwt.claims', true)::jsonb->>'sub'
  ),
  'deployed_functions', jsonb_build_object(
    'get_my_accessible_org_unit_ids', pg_get_functiondef('public.get_my_accessible_org_unit_ids()'::regprocedure),
    'get_my_accessible_station_ids', pg_get_functiondef('public.get_my_accessible_station_ids()'::regprocedure)
  ),
  'direct_user_org_assignments', coalesce(
    (select jsonb_agg(to_jsonb(da) order by da.org_unit_name, da.org_unit_id) from direct_assignments da),
    '[]'::jsonb
  ),
  'effective_org_scope_traced', coalesce(
    (select jsonb_agg(to_jsonb(eo) order by eo.depth, eo.org_unit_name, eo.org_unit_id) from effective_org eo),
    '[]'::jsonb
  ),
  'helper_org_unit_ids', coalesce(
    (select jsonb_agg(ho.org_unit_id order by ho.org_unit_id) from helper_org ho),
    '[]'::jsonb
  ),
  'active_station_mapping_paths', coalesce(
    (select jsonb_agg(to_jsonb(mp) order by mp.station_name, mp.depth, mp.org_unit_name) from mapping_paths mp),
    '[]'::jsonb
  ),
  'helper_station_scope', coalesce(
    (select jsonb_agg(to_jsonb(hs) order by hs.station_name, hs.station_id) from helper_stations hs),
    '[]'::jsonb
  ),
  'houston_in_scope', exists(
    select 1 from helper_stations where station_id = 'f41b520a-3cc7-41d4-82de-3ca74f7f2347'
  ),
  'miami_in_scope', exists(
    select 1 from helper_stations where station_id = '9af902b7-688d-4b13-90ce-8dc113d63124'
  ),
  'houston_mapping_paths', coalesce(
    (select jsonb_agg(to_jsonb(mp) order by mp.depth, mp.org_unit_name) from mapping_paths mp
      where mp.station_id = 'f41b520a-3cc7-41d4-82de-3ca74f7f2347'),
    '[]'::jsonb
  ),
  'miami_mapping_paths', coalesce(
    (select jsonb_agg(to_jsonb(mp) order by mp.depth, mp.org_unit_name) from mapping_paths mp
      where mp.station_id = '9af902b7-688d-4b13-90ce-8dc113d63124'),
    '[]'::jsonb
  )
) as shutdown_officer_scope_diagnostic;

rollback;
