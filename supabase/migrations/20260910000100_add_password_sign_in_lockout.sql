-- Account lockout is enforced by Supabase Auth's Password Verification Hook,
-- so it applies equally to browser, SDK, and direct token endpoint sign-ins.

create schema if not exists private;

create table if not exists private.password_sign_in_lockouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempt_count integer not null default 0 check (failed_attempt_count between 0 and 5),
  locked_until timestamptz,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint password_sign_in_lockouts_state_check check (
    (failed_attempt_count < 5 and locked_until is null)
    or (failed_attempt_count = 5 and locked_until is not null)
  )
);

alter table private.password_sign_in_lockouts enable row level security;

create policy password_sign_in_lockouts_auth_admin_only
  on private.password_sign_in_lockouts
  for all
  to supabase_auth_admin
  using (true)
  with check (true);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.password_sign_in_lockouts from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select, insert, update, delete on table private.password_sign_in_lockouts to supabase_auth_admin;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_user_id uuid;
  v_valid boolean;
  v_lock private.password_sign_in_lockouts%rowtype;
  v_now timestamptz := now();
begin
  if event is null or jsonb_typeof(event) <> 'object' then
    raise exception 'Invalid password verification hook event' using errcode = '22023';
  end if;

  begin
    v_user_id := (event ->> 'user_id')::uuid;
    v_valid := (event ->> 'valid')::boolean;
  exception when invalid_text_representation then
    raise exception 'Invalid password verification hook event' using errcode = '22023';
  end;

  if v_user_id is null or v_valid is null then
    raise exception 'Invalid password verification hook event' using errcode = '22023';
  end if;

  -- Lock an existing state row before inspecting it. An upsert below safely
  -- serializes the first concurrent failed attempts when no row exists yet.
  select *
    into v_lock
    from private.password_sign_in_lockouts
   where user_id = v_user_id
   for update;

  if found and v_lock.locked_until > v_now then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Sign-in is temporarily unavailable. Please try again later.',
      'should_logout_user', false
    );
  end if;

  if v_valid then
    delete from private.password_sign_in_lockouts where user_id = v_user_id;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into private.password_sign_in_lockouts (
    user_id,
    failed_attempt_count,
    locked_until,
    first_failed_at,
    last_failed_at,
    updated_at
  )
  values (v_user_id, 1, null, v_now, v_now, v_now)
  on conflict (user_id) do update
    set failed_attempt_count = case
          when private.password_sign_in_lockouts.locked_until is not null
           and private.password_sign_in_lockouts.locked_until <= v_now then 1
          else private.password_sign_in_lockouts.failed_attempt_count + 1
        end,
        locked_until = case
          when (case
            when private.password_sign_in_lockouts.locked_until is not null
             and private.password_sign_in_lockouts.locked_until <= v_now then 1
            else private.password_sign_in_lockouts.failed_attempt_count + 1
          end) >= 5 then v_now + interval '15 minutes'
          else null
        end,
        first_failed_at = case
          when private.password_sign_in_lockouts.locked_until is not null
           and private.password_sign_in_lockouts.locked_until <= v_now then v_now
          else private.password_sign_in_lockouts.first_failed_at
        end,
        last_failed_at = v_now,
        updated_at = v_now;

  return jsonb_build_object('decision', 'continue');
end;
$$;

revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
