-- Structural rollback-only verification for the provisional release model.
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shift_handovers' and column_name='provisional_at') then raise exception 'provisional metadata missing'; end if;
  if not exists (select 1 from pg_constraint where conname='shift_handovers_v2_provisional_check') then raise exception 'provisional lifecycle constraint missing'; end if;
  if not exists (select 1 from pg_proc where proname='end_duty_and_handover_shift_v2') then raise exception 'V2 end RPC missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shift_handover_entries' and policyname='shift_handover_entries_read_authorized') then raise exception 'provisional entry RLS policy missing'; end if;
end $$;
select 'PASS: V2 provisional lifecycle schema, release metadata, read isolation and end-duty contract are installed' as result;
rollback;
