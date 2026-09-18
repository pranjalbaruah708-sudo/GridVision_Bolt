begin;
-- Bounded read enrichment only; no lifecycle or authorization changes.
create function public.get_shift_handover_accountability(p_ids uuid[])
returns table(id uuid, status text, outgoing_shift_name text, incoming_shift_name text,
  outgoing_in_charge_name text, incoming_in_charge_name text,
  submitted_by_name text, submitted_at timestamptz, accepted_by_name text, accepted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_ids is null or cardinality(p_ids)>200 then
    raise exception 'Provide at most 200 handover identifiers' using errcode='22023';
  end if;
  return query
  select h.id,h.status,o.shift_name,i.shift_name,oc.full_name,ic.full_name,
    submitted.full_name,h.submitted_at,accepted.full_name,h.accepted_at
  from public.shift_handovers h
  join public.station_shifts o on o.id=h.outgoing_shift_id
  join public.station_shifts i on i.id=h.incoming_shift_id
  left join public.app_users submitted on submitted.id=h.submitted_by_user_id
  left join public.app_users accepted on accepted.id=h.accepted_by_user_id
  left join lateral (
    select u.full_name from public.station_shift_assignments a
    join public.app_users u on u.id=a.user_id
    where a.shift_id=h.outgoing_shift_id and a.duty_role='IN_CHARGE'
    order by a.created_at,a.id limit 1
  ) oc on true
  left join lateral (
    select u.full_name from public.station_shift_assignments a
    join public.app_users u on u.id=a.user_id
    where a.shift_id=h.incoming_shift_id and a.duty_role='IN_CHARGE'
    order by a.created_at,a.id limit 1
  ) ic on true
  where h.id=any(p_ids) and h.station_id in (select s.station_id from public.get_my_operational_station_ids() s);
end;
$$;
revoke all on function public.get_shift_handover_accountability(uuid[]) from public,anon;
grant execute on function public.get_shift_handover_accountability(uuid[]) to authenticated;
commit;
