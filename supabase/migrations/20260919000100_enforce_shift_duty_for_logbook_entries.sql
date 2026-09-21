begin;

-- A station operator may write when no shift is currently scheduled. While a
-- shift is active, the caller must be rostered for that shift and on duty.
create or replace function public.can_operator_make_station_entry(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and public.is_assigned_to_station(p_station_id)
    and (
      not exists (
        select 1
        from public.station_shifts s
        where s.station_id = p_station_id
          and s.status <> 'CANCELLED'
          and now() >= s.scheduled_start
          and now() < s.scheduled_end
      )
      or exists (
        select 1
        from public.station_shifts s
        join public.station_shift_assignments a
          on a.shift_id = s.id
         and a.user_id = auth.uid()
        join public.shift_duty_sessions d
          on d.shift_id = s.id
         and d.user_id = auth.uid()
         and d.status = 'ON_DUTY'
        where s.station_id = p_station_id
          and s.status <> 'CANCELLED'
          and now() >= s.scheduled_start
          and now() < s.scheduled_end
      )
    );
$$;

revoke all on function public.can_operator_make_station_entry(uuid) from public, anon;
grant execute on function public.can_operator_make_station_entry(uuid) to authenticated;

-- The logbook slot belongs to the station, so assigned operators must be able
-- to load an existing row instead of attempting a duplicate insert.
drop policy if exists "Operators can view own log entries" on public.log_book_entries;
drop policy if exists "Operators read assigned log entries" on public.log_book_entries;
create policy "Operators read assigned log entries"
  on public.log_book_entries
  for select
  to authenticated
  using (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and public.is_assigned_to_station(station_id)
  );

drop policy if exists "Operators can insert assigned log entries" on public.log_book_entries;
create policy "Operators can insert assigned log entries"
  on public.log_book_entries
  for insert
  to authenticated
  with check (
    operator_id = auth.uid()
    and public.can_operator_make_station_entry(station_id)
    and (
      feeder_id is null
      or exists (
        select 1 from public.feeders feeder
        where feeder.id = log_book_entries.feeder_id
          and feeder.station_id = log_book_entries.station_id
          and feeder.active = true
      )
    )
  );

drop policy if exists "Operators can update own assigned log entries" on public.log_book_entries;
create policy "Operators can update assigned log entries while on duty"
  on public.log_book_entries
  for update
  to authenticated
  using (public.can_operator_make_station_entry(station_id))
  with check (
    operator_id = auth.uid()
    and public.can_operator_make_station_entry(station_id)
    and (
      feeder_id is null
      or exists (
        select 1 from public.feeders feeder
        where feeder.id = log_book_entries.feeder_id
          and feeder.station_id = log_book_entries.station_id
          and feeder.active = true
      )
    )
  );

commit;
