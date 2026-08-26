# GridVision Project Instructions

## Project Purpose
GridVision is a generic, multi-utility power-grid monitoring and operational logbook application.

The application must remain utility-agnostic and must not use APDCL-specific database naming or assumptions unless explicitly required.

## Technology Stack
- React
- TypeScript
- Vite
- Supabase / PostgreSQL
- Capacitor Android
- Firebase Cloud Messaging
- Recharts
- Lucide React

## General Coding Rules
- Preserve existing application behavior unless the requested change explicitly requires modification.
- Do not modify unrelated files.
- Prefer the smallest safe change.
- Do not invent database columns, tables, RPCs, triggers, or types.
- Treat the existing Supabase schema as authoritative.
- Reuse existing API methods where practical.
- Keep TypeScript strict-compatible.
- Avoid `any` unless absolutely necessary.
- Do not remove existing functionality while fixing another feature.
- Preserve the existing mobile-first UI style unless redesign is explicitly requested.

## Database Rules
- Supabase/PostgreSQL is the backend.
- `log_book_entries.actual_event_time` is the authoritative logbook timestamp.
- `interruptions` is the authoritative source for interruption events.
- `stations` and `feeders` provide station and feeder metadata.
- `feeders.consumer_count` is currently used for SAIDI/SAIFI calculations.
- All timestamps stored as `timestamptz` should be displayed in `Asia/Kolkata` unless otherwise specified.
- Do not replace current schema names with older schema assumptions.

## Interruption Rules
- A feeder already in OPEN interruption state must not be tripped again until restored.
- Interruption status values are:
  - OPEN
  - RESTORED
  - CANCELLED
- Notifications are generated for real interruption events.
- Do not alter notification behavior unless explicitly requested.

## Operator Logbook Rules
- Operator logbook data is stored in `log_book_entries`.
- Feeder readings are entered hourly.
- `actual_event_time` represents the selected date/hour.
- Existing entries may be edited.
- Save-and-next behavior should advance to the next feeder.

## Analytics Rules
- Use actual database data, not demo arrays.
- Analytics filters should remain independent where the current UI is designed that way.
- Custom date ranges must not exceed one year unless explicitly changed.
- Use `Asia/Kolkata` for date bucketing.
- SAIDI formula:
  Σ(interruption duration × consumers affected) / total consumers served
- SAIFI formula:
  Σ(consumers affected per interruption) / total consumers served

## Notification Architecture
- Notifications use Supabase + Firebase Cloud Messaging.
- Notification events and recipients are stored in:
  - notification_events
  - notification_recipients
  - device_tokens
- Logged-out device tokens should be deactivated without affecting tokens for the same user on other devices.
- Do not reintroduce a PROCESSING notification state unless explicitly requested.

## Scope / Roles
- OPERATOR users are station-assigned for operational entry.
- FIELD_OFFICER and ADMIN users may view all stations for dashboards and analytics.
- Do not use global `activeStationId = "ALL"` where other application logic expects a real station UUID.

## Before Editing
- Inspect the relevant existing files first.
- Check existing types and API methods before adding new ones.
- Identify whether a requested feature can reuse existing code.
- If a schema assumption is uncertain, stop and report it instead of guessing.

## After Editing
- Run:
  npm run typecheck

- Fix any TypeScript errors caused by the change.
- Do not silently modify unrelated files just to make typecheck pass.