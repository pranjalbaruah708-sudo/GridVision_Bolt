-- An open interruption is a station operational record. A later rostered,
-- on-duty operator must be able to restore or update it without replacing the
-- original operator attribution.
begin;

create or replace function public.prevent_interruption_operator_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.operator_id is distinct from old.operator_id then
    raise exception 'Interruption operator attribution cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_interruption_operator_reassignment() from public, anon, authenticated;

drop trigger if exists prevent_interruption_operator_reassignment on public.interruptions;
create trigger prevent_interruption_operator_reassignment
before update on public.interruptions
for each row execute function public.prevent_interruption_operator_reassignment();

drop policy if exists "Operators can update own assigned interruptions" on public.interruptions;
create policy "On-duty operators can update station interruptions"
  on public.interruptions
  for update
  to authenticated
  using (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and public.can_operator_make_station_entry(station_id)
  )
  with check (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    and public.can_operator_make_station_entry(station_id)
    and (
      feeder_id is null
      or exists (
        select 1
        from public.feeders feeder
        where feeder.id = interruptions.feeder_id
          and feeder.station_id = interruptions.station_id
          and feeder.active = true
      )
    )
  );

commit;
