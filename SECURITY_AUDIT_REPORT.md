# GridVision Cyber-Security Audit Report

Audit date: 29 September 2026 (Asia/Kolkata)  
Scope: React/Vite/PWA client, Capacitor Android shell, Supabase Auth/PostgreSQL/RLS/Realtime/Storage/Edge Functions, FCM notification flow, Netlify configuration, dependencies, and reachable Git history.  
Status: source remediation completed and locally verified; production release remains blocked on Supabase migration-history reconciliation and external configuration verification. This report was created before code changes and then updated with remediation evidence.

## Executive summary

The current source tree contains substantial earlier hardening, including RLS on all application tables created by the migration chain, scoped database APIs, protected notification helpers, secure PWA caching rules, Netlify security headers, Android backup/cleartext protections, and defensive offline-sync authorization checks.

The audit nevertheless confirmed release-blocking deployment drift and several source-level weaknesses. A read-only security regression against the linked database proved that `feeder_thresholds`, `notification_config`, and `parameter_alerts` do not have RLS enabled there. Its migration history is also non-linear: multiple local security and business migrations are absent remotely while later dependent migrations are recorded as applied. The deployed `send-notification` function reports JWT verification disabled even though the local configuration requires it. These differences mean the repository cannot be treated as evidence of the deployed security boundary.

All confirmed source-level weaknesses were remediated in this checkout. The new migration reasserts RLS and grants, corrects the three database-function lint failures, introduces service-role-only atomic rate limits and a notification-worker lease, and prevents future PUBLIC function-execution drift. The four Edge Functions now enforce exact-origin CORS, bounded strict JSON, safer errors, and the appropriate authorization/abuse controls. The dependency audits are clean, Android release shrinking is enabled, and focused security tests were added. Nothing was deployed or written to the linked project during this audit.

No Supabase service-role JWT or embedded private-key block was found in the current tracked source or reachable Git history. The tracked Android `google-services.json` contains the expected client Firebase API key; that key is not a server credential, but its Google API/application restrictions must be verified externally.

## Findings

Evidence statements below describe the pre-remediation baseline captured before editing; each finding's status line records the final source/deployment state.

### Critical

#### GV-SEC-2026-001 — Linked Supabase migration history is incomplete and non-linear

- Affected component: deployed Supabase PostgreSQL schema, RLS, grants, RPCs, triggers, reports, shifts, handovers, shutdowns, alerts, and notifications.
- Evidence: the read-only linked migration inventory on 29 September 2026 showed the original baseline and multiple security migrations (including `20260909000100_harden_alert_and_notification_boundaries.sql`) absent remotely, while numerous later migrations were recorded as applied. Later local migrations through 26 September were also absent.
- Attack/failure scenario: production may retain anonymous table/function privileges fixed only in a missing migration, or execute later functions against an earlier schema. An attacker can target whichever older policy or RPC remains deployed; legitimate workflows can also fail unpredictably because the actual schema is not reproducible from migration history.
- Risk: authorization bypass, cross-scope data exposure or mutation, notification abuse, and inability to prove or safely reproduce the production security state.
- Exact remediation: reconcile the deployed catalogue against the full migration chain in a non-production clone; repair migration history only after verifying object definitions; apply a new idempotent security-boundary migration; run the full anonymous/role/scope negative matrix; then promote through an approved production change window.
- Existing-data exposure: possible. Catalogue and access-log review is required because the missing hardening migration previously addressed anonymous grants and internal notification RPC exposure.
- Remediation status: **implemented in source, open in production**. `20260929000100_close_security_audit_findings.sql` reasserts the sensitive-table boundary, but must be rehearsed only after the drift is reconciled. The linked read-only regression still fails, as expected, until deployment.

### High

#### GV-SEC-2026-002 — Edge Function deployment configuration differs from the audited source

- Affected component: deployed `send-notification` Edge Function.
- Evidence: the linked function inventory reports `verify_jwt=false`; local `supabase/config.toml` specifies `verify_jwt=true`. The deployed bundle version/hash cannot be proven equivalent to the local source from this checkout.
- Attack/failure scenario: if the deployed bundle lacks the local constant-time service-role bearer check, an unauthenticated caller could invoke a service-role/FCM boundary. Even if the inner check is present, disabling the gateway check removes one defense layer and increases abuse surface.
- Risk: trusted notification spoofing, FCM abuse, privileged database access through function defects, and configuration drift.
- Exact remediation: deploy the reviewed function with JWT verification enabled, retain the internal service/scheduler authentication check, and test missing, anon, ordinary-user, expired, malformed, and authorized service credentials.
- Existing-data exposure: unknown. Review Edge Function invocation logs and FCM delivery anomalies before closing the finding.
- Remediation status: **source configuration correct; deployed status open**. The internal constant-time credential check remains in place and `supabase/config.toml` requires JWT verification. Redeployment and remote inventory verification are required.

#### GV-SEC-2026-003 — Sensitive Edge Functions use unrestricted browser CORS

- Affected component: `invite-user`, `resend-setup-email`, `send-notification`, and `send-pending-notifications`.
- Evidence: all four functions currently emit `Access-Control-Allow-Origin: *`.
- Attack/failure scenario: a malicious website can drive credential-bearing requests from a signed-in administrator's browser to the administrative functions. Bearer-token acquisition is still constrained by the browser and Supabase client, so CORS alone is not an authentication bypass, but it unnecessarily permits hostile origins to interact with privileged endpoints and weakens defense in depth.
- Risk: cross-origin administrative abuse if a token is exposed to or reused by hostile script, broader endpoint probing, and failure to enforce the approved web/mobile origin boundary.
- Exact remediation: implement an environment-configured exact origin allowlist, emit CORS headers only for approved origins, allow origin-less trusted server/scheduler calls, reject disallowed preflights/requests, and document Netlify/Capacitor/development origins.
- Existing-data exposure: no direct exposure proven from CORS alone.
- Remediation status: **fixed in source**. All four functions use the shared exact-origin allowlist, preserve origin-less trusted calls, and reject hostile origin lookalikes. Production must set `ALLOWED_ORIGINS` before deploying.

#### GV-SEC-2026-004 — Administrative Edge Functions lack complete request-boundary and abuse controls

- Affected component: `invite-user` and `resend-setup-email`.
- Evidence: neither function enforces a request byte limit or JSON media type before parsing. `invite-user` has no server-side rate limit. The resend cooldown is a non-atomic read-then-send check and can race under concurrent requests. Invitation string/array lengths and UUID formats are incompletely constrained.
- Attack/failure scenario: an authenticated administrator account, malicious site combined with a stolen token, or automated client can submit oversized/malformed payloads, create excessive invitation traffic, or race setup-email sends. A compromised normal Admin can also supply arbitrary scope identifiers to a service-role client; authorization must be explicit rather than inherited from the UI.
- Risk: email abuse/cost, resource exhaustion, inconsistent assignments, and privilege/scope mistakes at a service-role boundary.
- Exact remediation: enforce content type, byte limits, strict object schemas, normalized email/text/array limits, UUID validation, role/scope authorization, and an atomic database-backed rate-limit primitive with an audit trail.
- Existing-data exposure: not indicated; audit invitation and resend events for anomalous volume.
- Remediation status: **fixed in source**. Administrative requests now have media-type, streaming byte, key, value, UUID, array-count, and text-length validation. Actor/target rate limits are atomic and fail closed; invitation partial failures trigger Auth-user rollback.

#### GV-SEC-2026-005 — Known vulnerable dependency chains remain in the lockfile

- Affected component: Android/Capacitor CLI and JavaScript build/lint toolchain.
- Evidence: `npm audit` reports 30 findings (28 high, 2 moderate); `npm audit --omit=dev` reports 8 (6 high, 2 moderate) because `@capacitor/cli` is incorrectly classified as a production dependency. Reported chains include `@xmldom/xmldom`, `brace-expansion`, `js-yaml`, and `nanoid` denial-of-service/injection issues.
- Attack/failure scenario: crafted XML/config/glob input processed in developer or CI tooling can trigger injection or resource exhaustion. The affected CLI is not imported by the shipped SPA, reducing end-user exploitability, but production classification and CI exposure are unsafe.
- Risk: CI/developer compromise or denial of service, unreliable software supply chain, and inflated production dependency surface.
- Exact remediation: move `@capacitor/cli` to development dependencies, update compatible direct packages, pin patched transitive versions only where compatibility tests pass, regenerate the lockfile, and rerun build/lint/typecheck/tests/Android build plus both audit modes.
- Existing-data exposure: none evidenced.
- Remediation status: **fixed**. The Capacitor CLI is development-only, compatible direct dependencies were updated, and the vulnerable Xcode UUID dependency is overridden to the patched API-compatible release. Both full and production-only npm audits report zero known vulnerabilities.

### Medium

#### GV-SEC-2026-006 — Database functions fail deployed lint checks

- Affected component: feeder-management scope, current-shift/handover audit, and duty-exception audit RPCs.
- Evidence: linked `db lint` reports an ambiguous `station_id` reference in `get_my_manageable_feeder_station_ids`, a write performed by STABLE `get_current_station_shift`, and a reference to nonexistent `app_users.is_active` in `record_shift_duty_exception`. Additional STABLE/volatile warnings were reported in shift/report functions.
- Attack/failure scenario: authorization helper failure can deny legitimate administrative operations; audit writes can fail silently or abort workflows; a broken audit RPC can prevent or omit security-relevant duty exception records.
- Risk: availability and audit-integrity loss, with possible inconsistent enforcement when callers fall back or handle errors differently.
- Exact remediation: qualify ambiguous columns, correct the authoritative `app_users.active` column, mark write-capable functions VOLATILE, and retest all dependent workflows.
- Existing-data exposure: no confidentiality exposure proven; audit gaps may already exist and should be checked.
- Remediation status: **fixed in migration, open in production**. The migration qualifies feeder station identifiers, uses `app_users.active`, enforces operator/station scope for duty exceptions, and marks the write-capable current-shift function VOLATILE.

#### GV-SEC-2026-007 — Database function default privileges do not prevent future PUBLIC execution drift

- Affected component: PostgreSQL functions added after security hardening.
- Evidence: the September 9 migration revokes current function execution from `PUBLIC`/`anon`, but does not set secure default function privileges. Later migrations repeatedly create/replace functions, and several trigger/internal helpers do not carry a local explicit revoke in their latest definition.
- Attack/failure scenario: a newly created `SECURITY DEFINER` RPC can inherit PostgreSQL's default PUBLIC EXECUTE privilege until a developer remembers a matching revoke. A future missing inner authorization check would become remotely exploitable.
- Risk: recurring privilege regression and enlarged RPC attack surface.
- Exact remediation: add an idempotent migration that revokes PUBLIC/anon execution across exposed schemas, restores only the explicit authenticated RPC allowlist, revokes internal helpers from authenticated, and changes the migration owner's default function privileges.
- Existing-data exposure: requires deployed catalogue verification; no exploit of a specific post-hardening function has yet been demonstrated.
- Remediation status: **fixed in migration, open in production**. Existing PUBLIC/anon execution is revoked from `SECURITY DEFINER` boundaries (and all internal-schema functions), secure defaults are established for future functions, and explicit user/service-role entry points are preserved.

### Low

#### GV-SEC-2026-008 — Android release code shrinking/obfuscation is disabled

- Affected component: Capacitor Android release build.
- Evidence: `android/app/build.gradle` sets `minifyEnabled false`.
- Attack/failure scenario: an attacker can more easily reverse engineer application flow, endpoint names, and client-side checks from the APK.
- Risk: reduced resistance to reconnaissance; server authorization remains the required control.
- Exact remediation: enable R8/minification in a controlled release stage, add required keep rules, and run full push notification, Capacitor bridge, PDF/file, and offline workflow regression tests.
- Existing-data exposure: none directly.
- Remediation status: **fixed in source**. R8 minification and resource shrinking are enabled for release builds. A native build could not start on this audit host because Gradle could not establish its required local loopback connection; CI/Android Studio release verification remains mandatory.

### Informational

#### GV-SEC-2026-009 — Browser/Android offline data remains readable after client compromise

- Affected component: Supabase browser session persistence, IndexedDB/localStorage offline queue, drafts, read caches, and FCM token storage.
- Attack/failure scenario: XSS, a rooted device, malware, or a compromised OS profile can read locally persisted session or operational data.
- Risk: endpoint/session and operational-data disclosure after client compromise.
- Exact remediation: continue treating local data as untrusted, clear user-scoped disposable data on logout/account switch, minimize retention, rely on OS/device controls, and document rooted-device residual risk. Hardware-backed encrypted storage can be considered for higher assurance mobile deployments.
- Existing-data exposure: not indicated; this is a threat-model limitation.

#### GV-SEC-2026-010 — External security configuration requires independent verification

- Affected component: Supabase Auth, Netlify, Google/Firebase, Android signing/Play Console, DNS/TLS, and monitoring.
- Attack/failure scenario: weak password/MFA settings, broad redirect URLs, unrestricted Firebase API keys, missing log retention/alerts, or incorrect Netlify environment separation can undermine correct source code.
- Risk: configuration-dependent.
- Exact remediation: complete the deployment and rotation checklists in this report after source remediation.
- Existing-data exposure: unknown until external configuration and logs are reviewed.

## Confirmed controls and negative findings

- No `dangerouslySetInnerHTML`, `eval`, `new Function`, or unescaped direct HTML-injection sink was found. The two report-print `document.write` calls escape the interpolated title and build table cells with `textContent`; their cloned report markup originates from React-rendered DOM.
- No embedded Supabase service-role JWT or private-key block was found in current tracked source or reachable Git history.
- All application tables created by the local migration chain enable RLS. Internal counters/receipts/audit tables intentionally expose no client policies. This local fact does not describe the drifted linked deployment, where the read-only regression found three sensitive tables with RLS disabled.
- Sensitive alert/configuration tables are RPC/trigger-bound in the local hardening migration.
- The client reads its effective role from the database and server-side RLS/RPC authorization remains the authoritative boundary; route gating is additional UX defense.
- Password recovery uses a non-enumerating success message. Sign-in errors are mapped to friendly messages.
- The service worker ignores cross-origin Supabase API traffic, uses network-first navigation, and does not intentionally cache authenticated API responses.
- Netlify source config includes CSP, HSTS, MIME sniffing, referrer, permissions, and anti-framing headers.
- Android backup and cleartext traffic are disabled; no broad deep-link intent filter was found.
- Current source contains no Storage bucket/upload implementation, so Storage policy testing is not applicable until that feature is introduced.

## Remediation log

- Added `supabase/functions/_shared/httpSecurity.ts` for exact-origin CORS, bounded streaming JSON parsing, security response headers, strict identifiers/timestamps, and hashed rate-limit subjects.
- Hardened `invite-user` and `resend-setup-email` with strict request schemas, active-role enforcement, Super Admin boundary checks, fail-closed database validation, and atomic actor/target rate limits.
- Hardened `send-notification` and `send-pending-notifications` by retaining constant-time privileged authentication, validating bounded payloads, removing raw FCM/database/device details from responses and stored delivery messages, and serializing worker runs with a database lease without adding a `PROCESSING` recipient state.
- Added `supabase/migrations/20260929000100_close_security_audit_findings.sql` for the rate-limit/lease primitives, database lint corrections, sensitive-table RLS reassertion, `SECURITY DEFINER`/default-function privilege hardening, and explicit authenticated/service-role allowlists.
- Added `supabase/tests/database/security_boundary_test.sql` to fail on public tables without RLS, anonymously executable `SECURITY DEFINER` functions, mutable audit ledgers, exposed Edge security primitives, missing service-role grants, or incorrect current-shift volatility.
- Added `tests/edgeHttpSecurity.test.mjs` and the `test:security` script for exact CORS, lookalike rejection, Capacitor origin handling, body/media limits, JSON shape, UUID, and timestamp validation.
- Updated the dependency graph and lockfiles; moved `@capacitor/cli` to development dependencies and applied a scoped, compatibility-checked `xcode -> uuid@11.1.1` override.
- Enabled Android release minification/resource shrinking and excluded generated Android/build and nested worktree output from the repository lint target.

## Verification evidence

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run build` | Pass; existing chunk-size and mixed static/dynamic import warnings only |
| `npm run test:security` | Pass, 6/6 |
| `npm run test:operational-write-errors` | Pass, 5/5 |
| `npm run test:duty-warning` | Pass, 4/4 |
| Deno type-check of all four changed Edge Functions | Pass |
| Focused ESLint of the new shared security helper | Pass |
| `npm audit` | Pass, 0 vulnerabilities |
| `npm audit --omit=dev` | Pass, 0 vulnerabilities |
| `npm ls --depth=1` | Pass; only expected optional packages are unmet |
| Capacitor Android sync | Pass |
| Android Gradle compile | Not run: host denied Gradle's local loopback connection before compilation |
| Full repository ESLint | Existing baseline failure: 24 errors and 20 warnings in unrelated application files; no changed security file is listed |
| Linked database security regression | Expected pre-deployment failure: RLS disabled on `feeder_thresholds`, `notification_config`, and `parameter_alerts` |
| Linked Supabase DB lint | Existing deployed errors confirmed; source corrections are in the new, not-yet-deployed migration |

The PostgreSQL migration could not be executed locally because the Supabase CLI requires a Docker-compatible local database, which is unavailable on this host. It was intentionally not applied to the drifted linked project. SQL execution and rollback must be proven on a disposable clone before production.

## Remaining external checks

- Export and compare the deployed database catalogue, policies, grants, triggers, publications, and function definitions against reviewed migrations.
- Review Supabase Auth password policy, leaked-password protection, CAPTCHA, MFA for privileged roles, redirect allowlist, recovery/invite expiry, refresh-token reuse detection, and session timeouts.
- Review Edge Function invocation logs, Auth logs, Postgres logs, administration audit logs, notification volume, and FCM delivery history for abuse during the potentially exposed period.
- Verify Netlify production/staging environment separation and response headers on the deployed domain.
- Restrict the Firebase client API key by Android package/signing certificate and only the required Google APIs; keep service-account material only in secret stores.
- Verify Play App Signing, release signing, WebView debugging state, rooted-device policy, screenshots/task-switcher requirements, and physical-device logout/account-switch behavior.

## Production deployment checklist

- Rehearse the complete migration chain and the new hardening migration on a disposable/staging clone.
- Resolve migration-history drift from catalogue evidence; never mark a migration applied merely to silence the CLI.
- Back up the production schema and record current policy/function/grant hashes.
- Deploy database changes before dependent Edge Functions where the migration documents that order.
- Configure `ALLOWED_ORIGINS` as a comma-separated list of exact web origins (for example, `https://app.example.com,https://staging.example.com`) and retain the scheduler secret in Supabase secrets. Do not include paths, wildcards, trailing slashes, or attacker-controlled preview domains. Capacitor's `http://localhost`, `https://localhost`, and `capacitor://localhost` origins are built in.
- Deploy all four reviewed functions and verify JWT settings from the remote inventory.
- Run anonymous, Operator, Officer, Admin, Super Admin, CCC/integration, and cross-station/office negative tests.
- Verify Realtime receives only RLS-authorized rows and that logout/token refresh/account switching removes old subscriptions.
- Smoke-test invitations, recovery, shifts, handovers, shutdowns, interruptions, reports, exports, offline replay, and FCM.
- Verify Netlify headers/CSP and Android release behavior.
- Monitor Auth, Edge Function, database, administration-audit, and FCM errors after release; retain a tested rollback plan.

Required deployment order: reconcile/rehearse migrations, apply the database migration, set Edge secrets, deploy the four functions, verify their remote JWT flags and hashes, execute the SQL/security role matrix, then release Netlify and Android clients. Do not deploy the functions before their rate-limit and lease RPCs exist.

## Secret rotation checklist

No committed server credential was confirmed by this audit. Rotation is therefore conditional, except where external log review identifies exposure.

- If a Supabase service-role key was ever copied to a client, log, CI artifact, or untrusted system: rotate it, update all Edge Function/Vault/CI consumers, and invalidate old credentials.
- Rotate Firebase service-account credentials if function logs, CI history, or secret stores show unauthorized access; update only Supabase secret storage.
- Rotate integration/CCC API credentials and revoke old tokens if their custody cannot be proven.
- Review and restrict the tracked Firebase client API key; regenerate only if misuse is detected or restrictions cannot be safely applied.
- Revoke active sessions for affected users if Auth logs indicate token theft or cross-origin abuse.
