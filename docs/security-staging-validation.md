# GridVision Staging Security Validation

Date opened: 9 September 2026 (IST)  
Last updated: 9 September 2026 (IST)  
Status: **STAGING DATABASE AND STRUCTURAL SECURITY VALIDATION PASSED — Auth/Realtime/FCM regression pending**

## Environment identity

- Previous linked project: `GridVision` / `eetlzxntgvjompmipprb` (production; excluded from this stage)
- Verified current linked project: `GridVision Staging` / `fylnuppelaebrhqllzzh`
- Staging region/status: `ap-southeast-1` / `ACTIVE_HEALTHY`
- Available Supabase projects inspected: production and staging
- Local Docker/Supabase alternative: unavailable (`docker` command not installed)
- Production changes made in this stage: none

The staging project identity was verified through `supabase projects list` before linking and before every subsequent remote operation. `supabase/.temp/project-ref` now contains `fylnuppelaebrhqllzzh` and was checked after linking.

## Read-only production schema extraction

The user explicitly authorized schema-only inspection of production project
`GridVision` / `eetlzxntgvjompmipprb`. Before every production catalog query,
`supabase projects list` was checked for the exact name/ref and healthy state.
Every database command used `db query --linked --project-ref
eetlzxntgvjompmipprb` and contained only `SELECT` statements against PostgreSQL
catalogs or `pg_get_*` definition helpers. No migration, function deployment,
DML, Auth, Vault, cron, secret, or notification command was issued.

The preferred command, `supabase db dump --project-ref ... --schema public`,
could not run because the CLI requires Docker or Podman for `pg_dump`, and
neither is installed. It failed before extraction and made no database change.
The safe fallback extracted definitions through catalog-only queries over
`information_schema.columns`, `pg_class`, `pg_namespace`, `pg_type`, `pg_enum`,
`pg_constraint`, `pg_indexes`, `pg_policies`, `pg_trigger`, `pg_proc`, and the
`pg_get_*` definition helpers.

Production contained 17 public tables, 76 public indexes, 38 RLS policies, 8
application triggers, one enum (`app_user_role`), and 88 function overloads
(inventory names are not necessarily unique). No table rows were queried or
exported.

### Sanitization

The catalog output contained schema identifiers such as the `fcm_token` column
name and function bodies that operate on notification rows. It contained no
token values, users, operational rows, passwords, JWTs, API keys, service-role
credentials, Firebase credentials, Vault values, connection strings,
production URLs, or cron/pg_net calls. The baseline contains no seed `INSERT`,
`COPY`, ownership reassignment, project ref, or secret.

## Pre-20260820 baseline reconstruction

The prepared file is
`supabase/migrations/20260819000000_gridvision_baseline.sql`. Reconstruction
used the production definitions, a reverse diff of every checked-in migration,
and Git history. Git recovered the deleted
`20260727105248_gridvision_schema.sql` prototype, but it was not restored: it
describes obsolete tables/columns and contains seed rows, so it cannot bootstrap
the current migration chain.

The new baseline contains 13 pre-existing tables, the three original role enum
values, 33 supporting indexes, 13 required function definitions, 5 triggers,
RLS enablement, 18 initial authenticated policies, and constrained grants.
Known later additions were removed: the four tables created by checked-in
migrations, `SUPER_ADMIN`, administration archive/audit columns, offline and
alert provenance, later indexes/policies, and later RPCs.

The historical six-argument `create_notification_event` function was recovered
exactly. The pre-provenance `handle_interruption_notification` body was not
retained in Git and cannot be proven byte-for-byte. Its baseline version was
conservatively reconstructed from the first checked-in replacement by removing
later provenance and ETR notification behavior. It uses only baseline columns
and is replaced by later migrations. This is the one material historical
definition uncertainty.

## Static migration-chain validation

- The baseline sorts first in a 43-migration sequence.
- None of its 13 tables is recreated later.
- Later-created tables are `user_station_assignments`, `feeder_thresholds`,
  `parameter_alerts`, and `administration_audit_log`.
- Reversed columns and constraints are reintroduced by their owning migration.
- Required access helpers exist before analytics/report RPCs reference them.
- `20260908000100` sorts before `20260909000100`.
- No baseline policy collides with later policies created without a prior drop.
- The baseline passes whitespace/error and data/secret scans.

Executable chain validation remains pending because Docker/Podman and a local
PostgreSQL client are unavailable. Per the required review checkpoint, staging
was not used as a test target and the baseline was not applied. The next safe
action is review approval, then a positively verified staging-only dry run and
application followed by full post-migration security inspection.

## Completed provisioning handoff

The dedicated project was created and positively verified. The repository was safely relinked from production to staging. No production data, user, token, Vault secret, Firebase credential, or database object was copied.

Public frontend staging values have not been written because they were not safely supplied through the existing environment. `.env.staging` remains ignored and `.env.staging.example` contains placeholders only.

## Mandatory target guard for the continuation

Before any migration, secret, Vault, cron, function, or test-fixture operation:

1. Read the candidate staging project reference from the explicit handoff.
2. Run `supabase projects list` and confirm that reference is named `GridVision Staging`.
3. Compare it with `supabase/.temp/project-ref`; abort if the latter is still production.
4. Link only after the operator states the old and new non-secret project names/references and confirms the new target.
5. Run `supabase migration list --linked` and confirm the staging database has no unexpected migration history. This completed successfully: staging has no applied repository migrations.
6. Immediately before each deploy, run `supabase functions list --project-ref <STAGING_REF>` and use the explicit staging ref in the deployment command.

## Database baseline discovery

The original empty-staging blocker was resolved by the reviewed
`20260819000000_gridvision_baseline.sql`. Before bootstrap, staging had zero
public application tables and zero applied repository migrations. The complete
43-migration chain now runs from the baseline through `20260909000100`.

The repository does **not** contain the original GridVision baseline schema. Its first migration, `20260820000000_interruption_lifecycle_integrity.sql`, starts with `ALTER TABLE interruptions`; the next migration references pre-existing `stations`; later migrations assume `app_users`, `feeders`, `log_book_entries`, `notification_config`, `notification_events`, `notification_recipients`, `org_units`, `station_org_units`, `user_org_units`, `user_stations`, enums, functions, and policies already exist. Only `user_station_assignments`, `feeder_thresholds`, `parameter_alerts`, and `administration_audit_log` are created by the checked-in migration series.

Therefore the existing migrations cannot build a new project from an empty database. A blind push was not attempted. The required sequence, once an authoritative baseline migration is supplied, is:

1. Apply a reviewed, schema-only baseline migration representing the database immediately before `20260820000000`.
2. Apply the existing repository migrations in timestamp order.
3. Validate the baseline before `20260908000100`.
4. Apply and validate `20260908000100_include_etr_in_interruption_notifications.sql`.
5. Apply `20260909000100_harden_alert_and_notification_boundaries.sql`.
6. Inspect actual RLS state, policies, table grants, function ACLs, and SECURITY DEFINER properties.

The security migration does not functionally depend on ETR, but normal migration ordering requires ETR first. A selective manual SQL execution that bypasses migration history is not approved.

## Planned staging-only services

- Deploy `send-notification` and `send-pending-notifications` using the explicit staging project ref.
- Configure only staging Firebase credentials through Supabase staging secrets.
- Store the staging service-role credential in staging Vault, never in migrations or Vite variables.
- Configure staging `pg_cron` → `pg_net.http_post` → staging function URL with Vault-backed Authorization.
- Verify the scheduled URL contains the staging project ref before enabling the job.
- Keep `device_tokens` empty until a dedicated test device registers.

## Synthetic fixtures planned

No users, passwords, or data have been created. The minimum fixture set remains:

- TEST Utility; Office A and Office B
- Station A1, Station A2, Station B1
- At least two feeders per station
- TEST_OPERATOR_A scoped only to Station A1
- TEST_OPERATOR_B scoped only to Station B1
- TEST_OFFICER_A scoped to Office A
- TEST_ADMIN with the intended staging administrative scope

Emails must be synthetic/test-controlled and passwords must remain outside source control and reports.

## Synthetic authorization fixture execution

Date: 9 September 2026 (IST)

The target was positively verified as `GridVision Staging` /
`fylnuppelaebrhqllzzh` before the fixture write. The four existing staging Auth
users were resolved and connected to application users:

| Identity | Synthetic Auth UUID | Role | Employee code |
| --- | --- | --- | --- |
| Operator A | `640239ac-164f-42b2-8424-3cc2a0725656` | OPERATOR | STG-OP-A |
| Operator B | `b5f42676-24e3-48b3-a5e1-68cf82df5ecc` | OPERATOR | STG-OP-B |
| Officer A | `331d67c0-7ddf-4723-8a0f-f6a9499f1169` | FIELD_OFFICER | STG-OFF-A |
| Admin | `d9299a8c-79c8-4a20-9b04-1e73ef3aded7` | ADMIN | STG-ADMIN |

No password, token, JWT, service-role credential, or production identity was
read or recorded.

The current model has no separate organisation table, so the synthetic utility
is represented by the root `org_units` record `GridVision Test Utility`
(`STG-UTILITY`, type HQ). Its children are Office A (`STG-OFFICE-A`, DIVISION)
and Office B (`STG-OFFICE-B`, DIVISION).

- Office A maps to Station A1 (`STG-A1`) and Station A2 (`STG-A2`).
- Office B maps to Station B1 (`STG-B1`).
- Each station has two active synthetic 11 kV feeders, six feeders total.
- Operator A is mapped only to Station A1 in both the current `user_stations`
  model and the legacy `user_station_assignments` policy table.
- Operator B is mapped only to Station B1 in both mapping tables.
- Officer A is mapped only to Office A through `user_org_units`.
- Admin is mapped to the synthetic HQ root; the current ADMIN access resolver
  independently grants all active stations.

The normal administration RPCs could not bootstrap these records: office and
station creation requires an existing SUPER_ADMIN actor, while this approved
fixture set intentionally contains no SUPER_ADMIN and initially had no
`app_users`. A single explicit transaction under the staging database
administration connection was therefore used for initial fixture bootstrap.
No RLS, grants, functions, triggers, migrations, or security settings changed.

### Effective access result and stop condition

The same `get_my_accessible_station_ids()` RPC used by GridVision returned:

- Operator A: Station A1 only — expected.
- Operator B: Station B1 only — expected.
- Admin: Station A1, Station A2, Station B1 — expected current ADMIN behavior.
- Officer A: Station A1, Station A2, **and Station B1** — unexpected for the
  deliberately Office-A-only test scope.

`get_my_accessible_org_unit_ids()` correctly returns only Office A for Officer
A. The station-scope discrepancy comes from the current
`get_my_accessible_station_ids()` implementation, which grants every active
station to FIELD_OFFICER instead of deriving stations from assigned
organisation units. Per the stage stop rule, no policy/function was changed and
no IDOR, mutation, queue, Realtime, session, or FCM test was started.

Referential-integrity checks passed with zero orphaned Auth/application users,
organisation parents, station-office mappings, feeder-station mappings,
user-office mappings, current user-station mappings, or legacy assignments.

### Focused FIELD_OFFICER station-scope correction

On 9 September 2026, migration `20260909000200_fix_field_officer_station_scope`
was applied to **GridVision Staging** (`fylnuppelaebrhqllzzh`) only. It replaces
the FIELD_OFFICER branch of `get_my_accessible_station_ids()` so station access
is derived from the officer's active organisation-unit hierarchy via
`get_my_accessible_org_unit_ids()` and `station_org_units`. OPERATOR access
continues to use explicit active `user_stations` assignments, while ADMIN and
SUPER_ADMIN retain access to all active stations.

The corrected function remains `SECURITY DEFINER` with
`search_path = public`. EXECUTE is granted to `authenticated` and remains
revoked from PUBLIC and `anon`. Authenticated-context regression results were:

- Operator A: Station A1 only.
- Operator B: Station B1 only.
- Officer A: Station A1 and Station A2 only; Station B1 excluded.
- Admin: Station A1, Station A2, and Station B1.

A rollback-only direct RLS test inserted synthetic alerts for A1 and B1.
Officer A could read the A1 alert and received zero rows for B1. The staging
migration history is aligned at 44 local/remote migrations, ending with
`20260909000200`.

Dependency review confirmed that `parameter_alerts` relies on the corrected
helper. Some older direct table policies remain broader by design/history,
including authenticated read access to stations/feeders and FIELD_OFFICER read
policies on logbook entries and interruptions. Those policies were not changed
in this focused correction and require a separate scoped security review before
claiming comprehensive organisation isolation.

### Direct table RLS review and remediation

Date: 9 September 2026 (IST)

The final staging database was inventoried before modification. All 17 public
application tables had RLS enabled, with 33 policies in total. Confirmed direct
authorization bypasses were:

- `Authenticated users can view stations`: unrestricted authenticated SELECT.
- `Authenticated users can view feeders`: unrestricted authenticated SELECT.
- `Field officers can view all log entries`: FIELD_OFFICER-wide SELECT.
- `Field officers can view all interruptions`: FIELD_OFFICER-wide SELECT.
- `operators_read_assigned_station_interruptions`,
  `operators_insert_assigned_station_interruptions`, and
  `operators_update_assigned_station_interruptions`: a parallel legacy mapping
  path without an OPERATOR-role or `operator_id` ownership condition.

Migration `20260909000300_fix_station_scoped_rls_policies.sql` replaced the
four broad read policies with station-scoped policies, removed the three legacy
interruption policies, and strengthened OPERATOR logbook/interruption INSERT and
UPDATE `WITH CHECK` expressions so a feeder cannot be substituted from another
station. It did not add DELETE access.

Initial validation exposed a pre-existing ambiguous column reference in
`get_my_manageable_feeder_station_ids()`. Additive migration
`20260909000400_fix_manageable_feeder_station_scope.sql` corrected the function
and made its FIELD_OFFICER result reuse `get_my_accessible_station_ids()`. The
function remains `SECURITY DEFINER`, uses `search_path=public`, is executable by
`authenticated`, and is not executable by PUBLIC or `anon`.

Authenticated-context results using deterministic staging fixtures:

- Operator A saw only A1 and its two feeders; permitted A1 logbook and
  interruption inserts succeeded inside automatically rolled-back probes.
- Operator B saw only B1 and its two feeders; permitted B1 logbook and
  interruption inserts succeeded inside automatically rolled-back probes.
- Officer A saw A1/A2, read two A1/A2 logbook and two A1/A2 interruption probe
  rows, and saw zero B1 station, feeder, logbook, interruption, or parameter
  alert rows.
- Officer A B1 logbook and interruption INSERT attempts failed with SQLSTATE
  `42501`; a direct B1 interruption UPDATE affected zero rows.
- Admin saw A1, A2, B1, all six test feeders, and the B1 operational probes.
- `parameter_alerts` was unchanged because its SELECT policy already uses
  `get_my_accessible_station_ids()`.

All committed test probe rows were removed with triggers disabled and a final
count of zero. The final database has 30 RLS policies and 46 aligned migrations,
ending at `20260909000400`.

Notification review found owner-only policies on `device_tokens` and no client
policies on `notification_events` or `notification_recipients`; RLS therefore
continues to deny direct authenticated access to the internal notification
tables despite their table grants. Organisation-table metadata policies were
left unchanged because hierarchy/profile administration requires separate
minimum-visibility analysis.

The SECURITY DEFINER review identified one remaining **HIGH** station-scope
bypass: authenticated Officer A can call `get_logbook_day_hour_status(B1, ...)`
and `get_logbook_month_status(B1, ...)`. The functions returned B1 feeder counts
(2 feeders and 48 expected daily slots) because neither validates the requested
station against `get_my_accessible_station_ids()`. This was not changed in the
direct-table RLS migration and blocks progression to Realtime/offline/FCM
regression until a focused RPC authorization migration is applied and tested.

### SECURITY DEFINER logbook-status RPC authorization remediation

Date: 9 September 2026 (IST)

The confirmed bypass arose because both user-facing SECURITY DEFINER functions
accepted `p_station_id` and queried feeders/logbook data without validating the
argument against the caller's station scope. Migration
`20260909000500_fix_logbook_status_rpc_station_authorization.sql` now requires
the station to be returned by `get_my_accessible_station_ids()` before either
function executes its unchanged status calculation.

The hardened signatures remain:

- `get_logbook_day_hour_status(uuid, date)` returning hour number, entered
  feeders, total feeders, and fill status.
- `get_logbook_month_status(uuid, integer, integer)` returning date, entered
  slots, expected slots, and fill status.

Both remain STABLE SECURITY DEFINER functions with `search_path=public`.
Authenticated EXECUTE remains granted; PUBLIC and `anon` EXECUTE remain
revoked. Unauthorized and nonexistent UUIDs produce the identical SQLSTATE
`42501` response, `Station is outside your permitted scope`, before feeder,
slot, completion, station, or logbook information is calculated.

Authenticated-context regression matrix:

| Identity | Day A1 | Day A2 | Day B1 | Month A1 | Month A2 | Month B1 |
| --- | --- | --- | --- | --- | --- | --- |
| Operator A | 24 rows, 2 feeders | 42501 | 42501 | 31 rows, 48 expected slots | 42501 | 42501 |
| Operator B | 42501 | 42501 | 24 rows, 2 feeders | 42501 | 42501 | 31 rows, 48 expected slots |
| Officer A | 24 rows, 2 feeders | 24 rows, 2 feeders | 42501 | 31 rows, 48 expected slots | 31 rows, 48 expected slots | 42501 |
| Admin | 24 rows, 2 feeders | 24 rows, 2 feeders | 24 rows, 2 feeders | 31 rows, 48 expected slots | 31 rows, 48 expected slots | 31 rows, 48 expected slots |

For every identity, a nonexistent UUID produced `42501` for both functions.
The authorized calls retained the original 24-hour and calendar-month result
shapes and expected feeder/slot calculations.

A narrow review of other authenticated-callable SECURITY DEFINER RPCs accepting
station, feeder, organisation-unit, or user identifiers found authorization
markers through the accessible/manageable station helpers, audit scope, caller
role, caller identity, or operator assignment. Manual definition review of
`manage_user_access`, `set_app_user_role`, and `is_assigned_to_station` found
their existing administrative/ownership checks intact. No additional bypass
was confirmed in this focused pass.

### Staging Realtime authorization regression

Date: 9 September 2026 (IST)

The target was verified before every operation as **GridVision Staging** / 
`fylnuppelaebrhqllzzh`. The existing `supabase_realtime` publication was present
but empty, so the application could not receive operational invalidations. After
inspection, only the three tables used by GridVision were added on staging:

- `log_book_entries`
- `interruptions`
- `parameter_alerts`

All three have RLS enabled and retain default replica identity. No unrelated or
user-sensitive table was published. The application code has two subscriptions:
Dashboard subscribes to all three tables; Alerts subscribes to interruptions and
parameter alerts. Both use `useRealtimeRefresh`, unfiltered `postgres_changes`
subscriptions, a 250 ms coalescing window, stable page-specific channel names,
and `removeChannel` cleanup on unmount. Server-side RLS—not the absence or
presence of a client filter—was tested as the authorization boundary.

Live subscriptions were established with independent Supabase clients and real
staging sessions for Operator A, Operator B, Officer A, and Admin. Results are
event counts for each deterministic row:

| Identity | A1 log | B1 log | A1 interruption INSERT/UPDATE | B1 interruption INSERT/UPDATE | A1 alert | B1 alert |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Operator A | 1 | 0 | 1 / 1 | 0 / 0 | 1 | 0 |
| Operator B | 0 | 1 | 0 / 0 | 1 / 1 | 0 | 1 |
| Officer A | 1 | 0 | 1 / 1 | 0 / 0 | 1 | 0 |
| Admin | 1 | 1 | 1 / 1 | 1 / 1 | 1 | 1 |

No unauthorized client received an event, metadata-only signal, NEW/OLD record,
station/feeder/operator identifier, remark, electrical value, interruption
cause/timestamp, or alert value. Authorized clients received exactly one event
per tested mutation, with no duplicate delivery observed.

An explicit token refresh preserved Operator A's A1 subscription. Removing the
channel, reconnecting with the current session, and mutating A1 delivered the
expected event. In an Operator A logout → Operator B login test, the removed A
channel received zero later events; the B session received one B1 event and zero
A1 events. This validates the underlying client lifecycle. Static review confirms
the GridVision hook removes its channel and timer on component unmount and uses
the current singleton Supabase session when creating a channel.

The scope-revocation-while-connected scenario was not executed because it would
require changing and restoring the persistent synthetic authorization fixture.
Natural token expiry, Android background/resume socket behavior, and authenticated
Dashboard/Alerts visual refresh remain runtime/manual checks. The source and
built-client scan found no service-role or `sb_secret_` credential use; the only
source occurrence is a defensive sensitive-field regular expression.

All deterministic test logbook rows, interruptions, alerts, thresholds, related
notification events, and recipients were removed. Final cleanup counts were
zero. No fixture users, organisation units, stations, or feeders were deleted.

Classification: **B. REALTIME AUTHORIZATION PASSED — RUNTIME EDGE CASES REMAIN**.

## Security regression matrix

| Test | Expected | Actual | Status |
| --- | --- | --- | --- |
| Anonymous protected-table CRUD | Denied | Grants/RLS structurally verified; HTTP client test pending | PARTIAL |
| Anonymous/internal RPC execution | Denied | Zero PUBLIC/anon function EXECUTE grants | PASS |
| Edge Function auth/method/input matrix | Only service-role POST accepted | Functions deployed with JWT verification; authenticated HTTP matrix pending | PARTIAL |
| Operator A → Station A1 alerts | Allowed | Not run | BLOCKED |
| Operator A → Station B1 alerts/direct UUID | No rows/denied | Not run | BLOCKED |
| Officer A effective station scope | Office A stations only | RPC returned Station A1 and A2; direct B1 alert read returned zero rows | PASS |
| Authorized/unauthorized Realtime | Only A1 data delivered | Not run | BLOCKED |
| Offline revoked-scope replay | Server rejects; queue retained | Not run | BLOCKED |
| Tampered queued station A1 → B1 | Server rejects | Not run | BLOCKED |
| Cross-user device-token operations | Denied | Not run | BLOCKED |
| Admin legitimate operations/operator escalation | Allow/deny respectively | Not run | BLOCKED |
| Cron and LIVE/DELAYED/HISTORICAL FCM | One intended staging-device delivery | Not run | BLOCKED |
| Notification foreground/background/cold tap | Auth/bootstrap then Alerts | Not run | BLOCKED |
| Netlify staging headers and CSP | Headers present; core features work | Not run | BLOCKED |
| CSV/print injection payloads | Harmless text/no formulas | Local code only; manual client test pending | BLOCKED |
| Android staging build/workflows | Staging-only endpoint; core/offline/FCM work | Not run | BLOCKED |

## Migration and deployment evidence

- Target verified before every write: `GridVision Staging` / `fylnuppelaebrhqllzzh`
- Dry-run migrations identified: 43
- Migrations attempted/applied: 43/43, with no failure or baseline correction
- Migration history: 43 matching local/remote versions; earliest
  `20260819000000`, latest `20260909000100`, no missing or duplicate version
- Final public schema: 17 tables, 90 function overloads, 33 RLS policies, and
  8 application triggers
- Edge Functions deployed to staging only:
  - `send-notification`, ACTIVE, version 1, JWT verification enabled
  - `send-pending-notifications`, ACTIVE, version 1, JWT verification enabled
- Staging Vault/cron configured: no
- Persistent test users/data created: none; database regression fixtures were
  transaction-local and rolled back
- Production migration/function/Vault/cron/user/FCM changes: none

## Executable database and security validation

The migration chain bootstrapped the empty staging project without error. No
historical migration or baseline change was required during execution.

All checked protected tables have RLS enabled. `anon` has no access to
`feeder_thresholds`, `notification_config`, or `parameter_alerts`.
`authenticated` has only SELECT on `parameter_alerts` among these tables, and
the sole policy scopes reads through `get_my_accessible_station_ids()`.
Threshold/config tables remain RPC-only.

No public-schema function is executable by PUBLIC or anon. Internal
notification functions are also not executable by authenticated. The sampled
application RPC set retained authenticated EXECUTE, including profile,
dashboard, analytics, reports, device-token ownership operations, and the
operator-authorized historical sync RPC. All 45 SECURITY DEFINER functions
have `search_path=public` and no unsafe search-path result was found.

All eight expected application triggers exist once; duplicate named triggers:
zero. Final function markers confirm ETR notification text, historical
interruption suppression, parameter-alert suppression/classification, and the
historical interruption sync function.

### Rollback-only synthetic regression

A transaction-local synthetic station, feeder, notification configuration,
threshold, interruption, and readings were created and then rolled back:

- OPEN interruption: one trip event; ETR present in message
- restoration: status RESTORED and one restoration event
- historical interruption guard: zero notification events
- normal reading: zero parameter alerts
- live breach: one LIVE, unsuppressed alert
- stale offline breach: one HISTORICAL_SYNC, suppressed alert
- current offline breach: one DELAYED_SYNC, unsuppressed alert
- parameter notifications: two, matching the two unsuppressed breaches

The authenticated `sync_historical_interruption` path, cross-user RLS,
Realtime, and Auth role matrix remain pending because staging Auth test users
do not yet exist.

## Remaining manual configuration and regression

Staging Edge Functions currently have only Supabase-managed environment
secrets. Required staging Firebase secrets are absent:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Configure these directly in the staging Supabase Dashboard or CLI from a secure
local environment; do not place their values in source control or chat. Actual
FCM tests must use a dedicated staging Firebase project/device. Vault-backed
service-role configuration and a staging-only pg_cron/pg_net schedule are not
configured and must not be enabled until the staging function URL, Vault secret,
and authorization header are verified manually.

Create synthetic Auth users for Operator A, Operator B, Officer A, and Admin
through the staging Auth Dashboard, using test-controlled addresses and secrets
kept outside the repository. Then bind them to synthetic Office A/B and Station
A1/A2/B1 fixtures for cross-scope RLS, Realtime, offline replay, and FCM tests.

## Release gate and classification

All mandatory security, Realtime, offline, FCM, browser, and Android gates remain untested. Production security deployment is not recommended.

Classification: **C. STAGING DATABASE + SECURITY STRUCTURAL VALIDATION PASSED — READY FOR AUTHORIZATION / REALTIME / FCM REGRESSION**

Exact continuation point: securely configure the three staging Firebase secrets
and create the four synthetic staging Auth users outside chat/source control.
Then run the authorization, cross-scope RLS, Realtime, offline replay, and
staging-device FCM regression matrix. Do not configure or test production.

## Offline replay/tampering harness prepared (not executed)

`supabase/scripts/validate_offline_security.mjs` is a staging-locked,
phase-based Node.js harness for the offline authorization regression. It uses
environment-only credentials, rejects the production ref, logs sanitized HTTP
and PostgreSQL diagnostics, tracks test operation identifiers, cleans created
operational/notification rows, and restores temporary Operator A access and
role changes in `finally` blocks.

Supported phases are `normal`, `revoke`, `tamper`, `idempotency`,
`dependency`, `isolation`, `conflict`, and `all`. The harness has only received
syntax/static validation in this preparation step; no phase has been executed
against staging and no result below should be interpreted as runtime evidence.
Browser IndexedDB isolation and forced persistence-failure UX remain explicitly
marked manual because a Node process cannot faithfully represent the browser or
Capacitor storage runtime. FCM is outside this harness and was not started.
