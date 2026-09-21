-- DEV reset: remove all shift-duty and handover test data while preserving
-- users, station configuration, operational data, and non-shift notifications.
begin;

-- Immutable V2 audit/entry guards protect operational history in normal use.
-- This is an explicitly requested DEV test-data reset.
alter table public.shift_handover_entries disable trigger user;
alter table public.shift_handover_audit_events disable trigger user;

delete from public.notification_recipients r
using public.notification_events e
where r.notification_event_id = e.id
  and (e.source_operation_id like 'SHIFT_%' or e.source_operation_id like 'HANDOVER_%');

delete from public.notification_events
where source_operation_id like 'SHIFT_%' or source_operation_id like 'HANDOVER_%';

delete from public.shift_handover_command_receipts;
delete from public.shift_handover_audit_events;
delete from public.shift_duty_handover_states;
delete from public.shift_handover_unattended_states;
delete from public.shift_handover_entries;
delete from public.shift_handover_items;
delete from public.shift_handovers;
delete from public.shift_duty_sessions;
delete from public.station_shift_assignments;
delete from public.station_shifts;

alter table public.shift_handover_entries enable trigger user;
alter table public.shift_handover_audit_events enable trigger user;

commit;
