-- Shutdown Management backend Stage 2: read authorization only.
-- All mutations remain reserved for future security-definer workflow RPCs.

begin;

revoke all on table public.shutdown_requests from public, anon, authenticated;
grant select on table public.shutdown_requests to authenticated;

drop policy if exists "Users read owned or scoped shutdown requests"
  on public.shutdown_requests;
create policy "Users read owned or scoped shutdown requests"
  on public.shutdown_requests
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    or exists (
      select 1
      from public.get_my_accessible_station_ids() as accessible
      where accessible.station_id = shutdown_requests.station_id
    )
  );

-- Deliberately no INSERT, UPDATE or DELETE policies and no corresponding
-- authenticated grants. Stage 3 RPCs will own all mutations and enforce
-- role, jurisdiction, pending-state and self-approval rules atomically.

commit;
