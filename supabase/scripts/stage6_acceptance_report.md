# Stage 6 acceptance validation — 15 September 2026

Development project: `eetlzxntgvjompmipprb` only.

**STATION MANAGEMENT EXPANSION ACCEPTANCE: NOT READY**

No product defect was identified in the executed checks. Stage 6B replaced manual tokens with temporary synthetic actors and normal password login. All four logins were rejected by Supabase Auth with captcha_failed (HTTP 400). Bootstrap and verified cleanup succeeded. No product CAPTCHA setting or authentication behavior was changed.

PASS below applies only to the evidence described. SQL rollback tests exercise deployed DEV functions/RLS with transaction-local actor claims. Browser fixtures run actual components and queue/IndexedDB code with synthetic authentication/transport; they do not establish real authenticated end-to-end success.

| Area / item | Status | Evidence or limitation |
| --- | --- | --- |
| A. Condition online create through authenticated app | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400). SQL category/lifecycle tests and synthetic UI save passed separately. |
| A. Condition rectification through authenticated app | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400). DEV rollback lifecycle/provenance checks and synthetic UI OPEN → RECTIFIED passed. |
| A. Condition authorization | PASS | DEV rollback tests: assigned/descendant access, unrelated denial, admin breadth, operator assignment, inactive denial. |
| A. Condition drafts | PASS | Browser suite: incomplete draft persistence and account isolation. |
| A. Condition real offline replay | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400); no real app-to-DEV replay performed. |
| A. Condition local offline persistence/failure retention | PASS | Real browser IndexedDB reload, stable retry, lost response, invalid/unverified session, cross-user isolation, malformed success and queue retention tests. Synthetic server transport. Pending Sync UI also observed. |
| B. Parameter Entry local replay regression | PASS | Existing actual queue/replay path executed with synthetic transport. Real DEV replay remains BLOCKED by the synthetic password-login CAPTCHA rejection. |
| B. Interruption local replay regression | PASS | Existing actual queue/replay path executed with synthetic transport. DEV historical-sync rollback suite also passed. |
| B. Restoration backend dependency/idempotency | PASS | DEV historical-sync rollback suite. |
| B. Restoration application offline replay | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400); not covered by the synthetic browser suite. |
| C. Timeline periods | PASS | DEV period/IST boundary tests; browser Today/This Month and Custom control visibility. Custom date editing interaction remains NOT TESTED because automated date fill did not update React state. |
| C. Timeline scopes | PASS | DEV scope tests; browser station/office and role-specific scope options. |
| C. Timeline nine event types / filters | PASS | Browser fixture renders all nine; category filters, separate interruption/restoration and newest-first order verified. |
| C. Timeline pagination | PASS | DEV deterministic pagination; browser Load More, duplicate overlap removal, and 1,000-event cap with narrowing message. |
| C. Timeline authorization | PASS | DEV operational-scope and separated-scope suites. |
| C. Timeline historical timestamps | PASS | DEV foundation tests and browser source timestamp ordering; real offline observation-to-timeline flow remains BLOCKED. |
| C. Timeline empty/error/retry/offline states | PASS | Actual component with controlled synthetic responses. |
| D. Summary periods | PASS | DEV period tests and browser Today/This Month selectors. Custom date-input interaction remains NOT TESTED. |
| D. Summary scopes | PASS | DEV descendant/dedup scope tests; browser authorized station, office option, all-authorized versus admin Entire Utility. |
| D. Summary KPI counts | PASS | DEV fixture assertions against source counts; browser formatting of returned counts, including large values. No authenticated UI-to-live-count comparison performed. |
| D. Summary details | PASS | Activity, Shift & Handover, Current Attention rendered from fixture response. |
| D. Summary IST/date/current-state semantics | PASS | DEV boundary/custom-limit and historical-independent current-open assertions. |
| D. Summary authorization | PASS | DEV operational-scope and separated-scope suites. |
| D. Summary Refresh/Retry/empty/offline | PASS | Actual component with controlled synthetic responses. |
| D. View Timeline navigation | NOT TESTED | Correct hash href inspected; full authenticated shell navigation not executed. |
| E. Dashboard/Analytics scope | PASS | DEV actual dashboard-total/load-analysis checks: unrelated active station remains globally visible to FIELD_OFFICER. |
| E. Operational scope | PASS | Assigned office + active descendants + mapped stations only; unrelated stations denied simultaneously with broad global access. |
| E. Shift authorization, history/compliance, duty start/end | PASS | DEV separated-scope suite, including unrelated station denial and start/retry/end duty. |
| E. Shift schedule/roster, submit/accept handover runtime | BLOCKED | Authenticated runtime scripts require a successful normal synthetic-actor login. Directly inserted foundation handover fixtures are not counted as mutation-flow validation. |
| E. Restricted Reports authorization/data | PASS | DEV scoped report views return authorized data and exclude unrelated stations. |
| E. Report exports and formula UI regression | NOT TESTED | No authenticated export session executed. |
| E. Shutdown security | PASS | DEV existing Shutdown security SQL suite and separated-scope ownership/decision tests. |
| E. Shutdown authenticated runtime | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400). |
| F. 390px component layouts | PASS | All three actual page components; measured innerWidth 390, document client/scroll width 375/375; screenshot review. |
| F. 1024px component layouts | PASS | All three components; measured client/scroll width 1009/1009; screenshot review. |
| F. 1440px component layouts | PASS | All three components; measured client/scroll width 1425/1425; screenshot review. |
| F. Full authenticated responsive shell/navigation | BLOCKED | Synthetic normal login rejected: captcha_failed (HTTP 400). Component previews do not include the complete authenticated shell. |
| G. Android | NOT TESTED | `adb devices` returned no connected device/emulator. |
| H. npm run typecheck | PASS | Exit 0. |
| H. npm run build | PASS | Exit 0, 2469 modules; bundle-size warning only. |
| H. git diff --check | PASS | Exit 0; working-copy line-ending warnings only. |

Responsive fixtures included long Timeline station/office names, an unbroken long Timeline condition description, long Condition observation, and large Summary counts. No document horizontal overflow was found. Extremely large mobile KPI values wrap within cards. A separate long-alert-description fixture and every long-name combination were not independently tested.

## Executed DEV SQL suites

All completed successfully and rolled back fixtures:

1. `validate_operational_foundation_rollback.sql`
2. `validate_operational_scope_rollback.sql`
3. `validate_station_condition_stage3_rollback.sql`
4. `validate_separated_scopes_rollback.sql`
5. `validate_global_scope_reconciliation_rollback.sql`
6. `../tests/database/shutdown_security_test.sql`
7. `validate_stage7_historical_sync_rollback.sql`
8. `validate_stage8_parameter_notifications_rollback.sql`

Browser offline suite `/tests` finished with `ALL CHECKS PASSED — synthetic transport, real IndexedDB`. This includes queue removal only after confirmed success and retention after server acceptance with lost response. It is explicitly not the required real Supabase offline replay.

## Changes and remaining work

- Stage 6 changed `supabase/scripts/serve_timeline_checks.mjs` only for test fixtures (Summary preview, response modes, long labels and large counts) and added this report.
- Existing modifications to App, sidebar, More, Administration, Timeline and the new Summary page predate Stage 6.
- Migrations created/applied during Stage 6: none.
- Product defects found/fixed during executed checks: none.
- No operational/global helper, notification, realtime, schema, route or product feature changes in Stage 6.
- Current prerequisite: a supported normal synthetic-actor login that satisfies the deployed CAPTCHA challenge. Manual JWT copying is no longer the validation approach. No bypass or admin-generated login was attempted.
- Remaining untested items include authenticated full-shell navigation, real replay of all queue kinds, Shift handover/roster runtime, report exports/formula UI checks, Custom date-input interaction, and Android.

No new feature stage was started.

## Stage 6B synthetic actor run

The Node-only `stage6_authenticated_runtime_validation.mjs` uses the existing local DEV admin credentials solely for bootstrap and cleanup. Passwords are generated in memory; credentials, emails and tokens are not written to results. Exact DEV URL and `STAGE6_NON_PRODUCTION_CONFIRMATION=I_CONFIRM_THIS_IS_THE_GRIDVISION_DEVELOPMENT_PROJECT` plus `--dev` are required. Missing-confirmation refusal was executed and verified before any remote work.

| Actor / check | Status | Result |
| --- | --- | --- |
| ADMIN BOOTSTRAP: four synthetic actors and application profiles | PASS | Confirmed Auth users and active app_users roles created. |
| NORMAL AUTH: OPERATOR_A | BLOCKED | signInWithPassword: captcha_failed; HTTP 400. |
| NORMAL AUTH: OPERATOR_B | BLOCKED | signInWithPassword: captcha_failed; HTTP 400. |
| NORMAL AUTH: FIELD_OFFICER | BLOCKED | signInWithPassword: captcha_failed; HTTP 400. |
| NORMAL AUTH: ADMIN | BLOCKED | signInWithPassword: captcha_failed; HTTP 400. |
| Normal-user identity/role/scope verification | BLOCKED | No normal session issued. |
| Condition runtime | BLOCKED | No normal session issued. |
| Real IndexedDB-to-DEV offline replay and old queue regressions | BLOCKED | No normal session issued; no synthetic transport substitution. |
| Shift lifecycle/handover runtime | BLOCKED | No normal session issued. |
| Shutdown ownership/decision runtime | BLOCKED | No normal session issued. |
| Restricted Reports normal-user runtime | BLOCKED | No normal session issued. |
| Session refresh | BLOCKED | Login returned no refresh token. This is not a refresh-exchange failure. |
| ADMIN CLEANUP | PASS | Finally logic deleted profiles and all four temporary Auth users; absence checked using exact run-owned IDs. |
| Operational fixtures | NOT TESTED | Intentionally deferred until all normal logins succeed; none created. |

Bootstrap PASS is not an RLS/authentication PASS. No actual application/RPC test used service-role headers. The script contains normal-client scope and Condition checks behind successful authentication, but those branches were not executed. Shift/Shutdown/real-browser offline orchestration remains unfinished behind the authentication blocker; the script is not a completed replacement for all runtime suites.

Stage 6B files: `stage6_authenticated_runtime_validation.mjs`, credential-free `stage6_authenticated_runtime_results.json`, and this updated report. Previous Stage 6 evidence is retained above. Syntax validation and missing-guard refusal passed. No product source or migrations changed. No product defect identified. Android, exports, date-input interaction and full-shell navigation remain untested as recorded above.

Final acceptance remains **NOT READY** because CAPTCHA prevents the required normal synthetic-user sessions. No manually copied JWT dependency, permanent actors, authentication bypass, or new feature stage was introduced.

## CAPTCHA-independent JWT feasibility inspection

**AUTHENTICATED RUNTIME: BLOCKED — CAPTCHA-protected Supabase Auth cannot be automated with the currently available DEV test credentials/configuration.**

Inspection was read-only. The DEV public `/auth/v1/.well-known/jwks.json` endpoint returned HTTP 200 and an EC/ES256 signing key. This establishes that asymmetric public verification material is published; it does not establish the complete signing-key lifecycle or whether legacy verification remains enabled. The locally configured anon and service-role API tokens have HS256 headers and the correct DEV project reference. These are already-signed API tokens, not JWT signing secrets.

The workspace environment files, loaded DEV validation environment, process signing-variable names, and checked-in Supabase configuration were inspected without printing credentials. No JWT secret or private signing key is available in the existing validation environment. The public ES256 key cannot mint actor tokens. Per the requested stop condition, no private material was retrieved/exported and no signed-actor implementation or password-login retry was attempted.

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| JWT signing feasibility with available credentials | BLOCKED | Asymmetric public key published; no local private key or JWT signing secret. |
| OPERATOR_A identity proof | BLOCKED | No actor JWT minted. |
| OPERATOR_B identity proof | BLOCKED | No actor JWT minted. |
| FIELD_OFFICER identity proof | BLOCKED | No actor JWT minted. |
| ADMIN identity proof | BLOCKED | No actor JWT minted. |
| RLS/RPC authenticated runtime | BLOCKED | No authenticated actor client created in this inspection. Prior SQL rollback evidence retained. |
| Condition runtime | BLOCKED | No authenticated actor JWT. |
| Real offline replay | BLOCKED | No authenticated actor JWT. |
| Shift runtime | BLOCKED | No authenticated actor JWT. |
| Shutdown runtime | BLOCKED | No authenticated actor JWT. |
| Reports runtime | BLOCKED | No authenticated actor JWT. |
| Session refresh | NOT TESTED | No genuine Supabase refresh-token flow exercised; manually signed tokens would not prove it. |
| Previous synthetic-run cleanup | PASS | Previously verified deletion evidence retained above. This inspection created no users, assignments or operational fixtures. |

Authentication mechanism actually used in this inspection: none. Only the public JWKS endpoint was queried; local token headers/project claims were inspected without using the service-role token for application tests. The earlier bootstrap/password-login run remains separately recorded above and was not repeated.

Files changed in this inspection: this report only. Product authentication, RLS, Auth configuration, JWT settings, migrations and harness behavior were unchanged. No secrets were displayed or exported. Acceptance remains **NOT READY**; existing SQL/RLS rollback suites remain the authorization evidence, not a substitute claim of authenticated runtime success.

Reference: [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) distinguishes legacy signed API tokens from signing material and documents asymmetric private-key handling.

## Reported first-save Station Condition defect — investigation open

The user reports two real authenticated ONLINE submissions that initially displayed Sync Failed / server rejected, then succeeded on Retry Sync. This supersedes earlier statements that no runtime defect had been observed. Other Stage 6 manual acceptance is paused pending this investigation.

Initial Save calls `enqueueStationCondition`, which verifies the session owner, persists a stable operation in IndexedDB, and chooses ONLINE/OFFLINE using `isOnline()`. The page immediately calls `retryQueuedOperation` when online. Manual Retry calls the same function. Both reach `runQueued` and `create_station_condition` with the same queue-derived operation ID, station, observation, category, condition, optional equipment/null, entry mode and recording timestamp. No status, local row ID, recorded_by or rectified_by is sent. Both obtain headers from the current Supabase session and recheck the queue owner/session. Retry changes retry metadata and elapsed time, not the intended payload.

The friendly server-rejected message means VALIDATION classification: HTTP 400/422 or a supported database validation code. The existing reader discards the backend message. This message alone does not identify the root cause or prove an authentication problem.

A candidate cause is client/server clock skew: client-generated recorded_at is sent even for ONLINE entries, and the checked-in RPC rejects future recording timestamps before assigning the server recording time. Elapsed time could explain retry success. This is a hypothesis, not a captured diagnosis; no timestamp or error-classification behavior has been changed.

`src/services/api.ts` now emits DEV-only Station Condition replay diagnostics: HTTP status, allowlisted safe backend message, sanitized database code, RPC/operation type, attempt, entry mode, payload SHA-256 fingerprint, network classification and timestamp deltas relative to HTTP Date. HTTP Date precision is one second. No payload content, identity, credentials or auth headers are logged. Diagnostics are guarded and cannot change queue completion on error.

| Requested validation | Status | Current evidence |
| --- | --- | --- |
| Exact first-attempt HTTP status/code/message | BLOCKED | Awaiting reproduction with DEV diagnostics in the user's real authenticated session. |
| Exact root cause / fix | BLOCKED | Payload/auth path traced; candidate timing cause requires actual response evidence. |
| Online first-save ×3 after fix | NOT TESTED | No behavioral fix yet. |
| Real offline replay after fix | NOT TESTED | No behavioral fix yet. |
| Retry/idempotency after fix | NOT TESTED | User reports retry success; no new post-fix test executed. |
| Parameter/Interruption/Restoration regression after fix | NOT TESTED | Existing evidence retained; not rerun for an unconfirmed fix. |

Only safe diagnostic instrumentation and this report were changed for this investigation. No other Stage 6 manual tests were resumed.

Static checks after the diagnostic change: `npm run typecheck` PASS; `npm run build` PASS (existing large-chunk warning); `git diff --check` PASS.

## Station Condition recording-clock fix — applied to DEV

This section supersedes the open root-cause hypothesis above. The user supplied real authenticated first-save evidence: HTTP 400, PostgreSQL `22023`, `Invalid observation or recording time/mode`, ONLINE mode, network online, observed timestamp approximately 77 seconds in the past, and recorded timestamp 110 ms ahead of the response HTTP Date. The deployed function definition was inspected directly.

The exact rejecting clause was:

```sql
or (p_recorded_at is not null and
    (not isfinite(p_recorded_at) or p_recorded_at > now()))
```

It applied to both ONLINE and OFFLINE, before ONLINE `recorded_at` was replaced with server `now()`. The new rollback test reproduced `22023` before migration at the first positive offset (+100 ms). The user-reported 110 ms is relative to the one-second-resolution HTTP Date header, so it is not an exact measurement against database `now()`; the error, deployed predicate and deterministic reproduction establish the zero-tolerance defect.

New migration: `supabase/migrations/20260915000100_tolerate_station_condition_recording_clock_skew.sql`. The only function-body change is `p_recorded_at > now()` → `p_recorded_at > now() + interval '5 seconds'`. Five seconds is the requested small explicit allowance; it does not admit arbitrary future timestamps. `observed_at`, finite timestamp/mode checks, authorization, conflict checks, original offline provenance, server sync time and ONLINE server recording time are unchanged. Historical migrations were not edited.

Applied only to `eetlzxntgvjompmipprb`; the single applied migration was recorded in migration history. A post-application query confirmed both the deployed five-second predicate and version `20260915000100` in history. No staging/production changes.

| Check | Status | Evidence |
| --- | --- | --- |
| Pre-fix reproduction | PASS | Rollback suite failed with the expected original 22023 at +100 ms. |
| ONLINE recorded_at -1s, now, +100ms, +1s, +4.9s | PASS | Each accepted after migration, using transaction-stable now(). |
| Beyond tolerance (+6s) | PASS | Rejected for both ONLINE and OFFLINE. |
| Invalid mode/infinite recording/null or future observation | PASS | Rejected; observed_at received no tolerance. |
| Authorization / server-controlled recorder | PASS | Unrelated station denied; recorded_by matched actor claims; operational scope suites passed. |
| ONLINE recording time / idempotency | PASS | Server now() stored; replay returned the same ID; no duplicate rows. |
| OFFLINE provenance / idempotency | PASS | Original observation and recording times retained; server synced_at populated; conflicting provenance denied. |
| Condition / foundation / operational scope / separated scopes | PASS | Four existing DEV rollback suites rerun successfully. |
| Interruption/Restoration historical sync backend regression | PASS | Existing historical-sync rollback suite rerun successfully. |
| Parameter notification backend regression | PASS | Existing parameter-notification rollback suite rerun successfully. |
| Parameter/Interruption/Restoration browser queue replay after migration | NOT TESTED | This run exercised SQL backends; prior synthetic browser evidence retained, not represented as a fresh real replay. |
| Typecheck / build / git diff --check | PASS | All exit 0; existing build size and line-ending warnings only. |
| Real authenticated ONLINE first-save ×3 | NOT TESTED | Requested next from the user's working normal session. |
| Real authenticated offline reconnect/replay | NOT TESTED | Requested next. |

Added `supabase/scripts/validate_station_condition_clock_skew_rollback.sql`. All SQL fixtures ran within rolled-back transactions. Files changed for the root-cause fix: the new migration, the new boundary suite, and this report. The previously added safe DEV diagnostics remain temporarily enabled as requested. No queue architecture, other-operation timestamp semantics, product authorization or error classification changes.

Next manual check, after reloading the DEV app with a normal OPERATOR session:

1. Save three distinct valid ONLINE Station Conditions. Each must succeed on its first attempt, show no Sync Failed, need no Retry Sync, and have exactly one server record. Keep the DEV response diagnostics for each.
2. While authenticated with scope loaded, disconnect, save one observation, and confirm Pending Sync. Reconnect and allow normal replay; confirm exactly one server record, original observed_at, and removal of the local queue item after success.

Do not resume other Stage 6 manual acceptance until those checks confirm the fix. Overall acceptance remains NOT READY pending the recorded outstanding real-runtime items.

## Shift Handover browser acceptance — preparation

User explicitly advanced to real two-operator browser handover testing. No extensive SQL suites were repeated.

- Station: Houston Central Substation (`f41b520a-3cc7-41d4-82de-3ca74f7f2347`).
- Outgoing: existing shift `3572b5ee-acf3-4c3a-9d61-3bc3d047c1ec`, with Operator A already ON_DUTY and rostered IN_CHARGE; originally ends 15 September 2026 16:00 IST. No handover existed at inspection.
- Created incoming shift `d925fa12-9f9b-4d16-998e-bd6459b94c29`, named `Stage 6 authenticated incoming 20260915`, initially 16:00–20:00 IST; Operator B rostered IN_CHARGE. No duty or handover lifecycle was fabricated through the administrative client.
- User authorized shortening the existing DEV outgoing shift **after submission**, then moving the incoming start to the same boundary for immediate B testing. This adjustment has not yet been executed.
- Existing source interruption `e81632fb-75f7-43df-929d-4c29a2b1d786` was OPEN at baseline; it has not been modified. It can be referenced through the browser and checked after acceptance.
- Normal DEV app server restarted at port 5185. Browser is at the normal login screen; Operator A password/login completion is pending from the user. Submission, freeze, full logout, B acceptance, attribution and source-state verification remain NOT TESTED.

Only fixture setup and this report changed in this block; no product code/authentication changes. Incoming fixture is retained for the requested ongoing browser test.

## Handover accountability display

Added a shared compact definition-list display to submitted/accepted Timeline cards, Shift Handover, and Shift History audit detail. Rostered in-charge names are independent of actual submit/accept identities. Empty roster roles display `Not assigned`. Both card directions retain submission and acceptance attribution and show the same current server lifecycle status (`SUBMITTED` displayed as `AWAITING ACCEPTANCE`). Mobile uses a stacked layout and larger widths use a grid.

Read-contract addition: `get_shift_handover_accountability(uuid[])`, limited to 200 identifiers and restricted by the existing operational station helper. It joins current handover status/action identities, both shift names and each shift's rostered IN_CHARGE. The existing Timeline and History API reads add one batch enrichment request, not one request per card. Existing RPC signatures, lifecycle functions, authorization policies and roster mutation behavior remain unchanged. This migration was applied and recorded only in DEV as `20260915000200`.

The existing internal Timeline SQL already used `h.status` for both events; the initial investigation comment about a hardcoded submitted status was incorrect. Page open/Refresh fetches fresh Timeline accountability; loading another event for the same handover also reconciles already-loaded cards. History detail refetches when opened. Shift Handover reloads authoritative detail after existing read/mutation paths; no separate outgoing/incoming status is maintained. No realtime architecture was added. Changes in another session become visible on open/Refresh rather than a new live subscription.

Verified the actual Stage 6 handover `ad08c811-ea7a-49b3-a056-19594f32da20` through the scoped SQL read:

- Outgoing: Stage5 concurrency outgoing; in-charge and submitter: **Houstan Operator**.
- Incoming: Stage 6 authenticated incoming 20260915; in-charge and acceptor: **Houstan Operator 2**.
- Status: ACCEPTED.
- Submitted: 15 September 2026 13:49:57 IST; accepted: 15 September 2026 16:56:05 IST.
- Names are actual profile spellings, not hardcoded example names. This read verifies stored data, not a newly executed browser submit/accept flow.

Validation: new rollback suite PASS for different roster/action users, SUBMITTED→ACCEPTED authoritative read, no roster fallback to acceptor, duplicate identifiers, 200-ID bound and unrelated station denial. Shared actual-component render assertions PASS for both card directions and history, full accepted attribution, awaiting status and Not assigned. Typecheck and build PASS; diff check PASS. Browser visual breakpoint testing and external-Chrome runtime are not claimed by these render assertions.

Files for this change: `src/components/HandoverAccountability.tsx`, `src/services/handoverAccountability.ts`, `src/services/api.ts`, `src/services/operationalApi.ts`, `src/types/operational.ts`, `src/pages/OperationalTimelinePage.tsx`, `src/pages/ShiftHandoverPage.tsx`, `src/pages/ShiftOperationsPage.tsx`, the new DEV migration, `validate_handover_accountability_rollback.sql`, `validate_handover_accountability_display.mjs`, and this report. Pre-existing modifications from earlier stages remain separate.
