-- Shutdown Management backend Stage 1: persistent core request record only.
-- Authorization policies, workflow RPCs, SD number generation, attachments,
-- notifications and advanced lifecycle states are intentionally deferred.

begin;

create table public.shutdown_requests (
  id uuid primary key default gen_random_uuid(),
  sd_number text not null unique,
  station_id uuid not null references public.stations(id) on delete restrict,
  feeder_id uuid references public.feeders(id) on delete restrict,
  equipment_name text,
  shutdown_type text not null,
  purpose text not null,
  work_description text not null,
  planned_start timestamptz not null,
  expected_restoration timestamptz not null,
  remarks text,
  status text not null default 'PENDING_APPROVAL',
  requested_by uuid not null references public.app_users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decision_by uuid references public.app_users(id) on delete set null,
  decision_at timestamptz,
  decision_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shutdown_requests_sd_number_not_blank check (btrim(sd_number) <> ''),
  constraint shutdown_requests_type_not_blank check (btrim(shutdown_type) <> ''),
  constraint shutdown_requests_purpose_not_blank check (btrim(purpose) <> ''),
  constraint shutdown_requests_work_description_not_blank check (btrim(work_description) <> ''),
  constraint shutdown_requests_equipment_name_not_blank check (
    equipment_name is null or btrim(equipment_name) <> ''
  ),
  constraint shutdown_requests_window_check check (
    expected_restoration > planned_start
  ),
  constraint shutdown_requests_status_check check (
    status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')
  ),
  constraint shutdown_requests_decision_fields_check check (
    (status = 'PENDING_APPROVAL'
      and decision_by is null
      and decision_at is null
      and decision_remarks is null)
    or (status in ('APPROVED', 'REJECTED')
      and decision_by is not null
      and decision_at is not null)
    or status = 'CANCELLED'
  )
);

create index shutdown_requests_station_idx
  on public.shutdown_requests (station_id);
create index shutdown_requests_requested_by_idx
  on public.shutdown_requests (requested_by);
create index shutdown_requests_status_idx
  on public.shutdown_requests (status);
create index shutdown_requests_requested_at_idx
  on public.shutdown_requests (requested_at desc);
create index shutdown_requests_planned_start_idx
  on public.shutdown_requests (planned_start);
create index shutdown_requests_station_status_idx
  on public.shutdown_requests (station_id, status, planned_start);

create trigger shutdown_requests_updated_at
before update on public.shutdown_requests
for each row execute function public.update_updated_at_column();

alter table public.shutdown_requests enable row level security;

-- No policies are created in this stage. Stage 2 must add server-enforced
-- jurisdiction, ownership and approval authorization before client access.

commit;
