# GridVision Security Remediation Deployment Record

Date: 9 September 2026 (IST)  
Target reviewed: the only linked Supabase project, `GridVision`  
Deployment decision: **not deployed**. No separate staging project exists and Docker/local Supabase is unavailable.

## 1–3. Migration state, order, and second-pass result

Remote migration history is current through `20260907000100`. Two local migrations are pending:

| Migration | Purpose | Dependency |
| --- | --- | --- |
| `20260908000100_include_etr_in_interruption_notifications.sql` | Replaces the interruption notification trigger function so trip messages include ETR; preserves historical-sync suppression and existing event creation | Independent business change, but timestamp ordering places it first |
| `20260909000100_harden_alert_and_notification_boundaries.sql` | Enables RLS on three exposed tables, removes broad grants, adds station-scoped alert SELECT, removes anonymous RPC execution and protects internal notification functions | Does not require the ETR behavior; must run after it in normal migration order |

Safest order in a non-production environment is ETR first, security second, then both Edge Functions. A normal `db push` would apply both migrations. Executing only the security SQL manually would desynchronize migration history and is not recommended. No migration was applied in this stage.

Second-pass result: the security migration now removes all table privileges from PUBLIC/anon/authenticated for thresholds and notification configuration; grants authenticated SELECT only on alerts; scopes those rows through `get_my_accessible_station_ids()`; and removes implicit PUBLIC/anon execute from every public-schema function. Live ACL inspection confirmed legitimate client RPCs already have direct `authenticated` grants. Internal notification helpers additionally lose `authenticated` execute. Service-role/table-owner trigger paths retain their backend access.

## 4. Expected RLS matrix after remediation

| Resource | anon | Operator | Officer | Admin | service_role |
| --- | --- | --- | --- | --- | --- |
| `feeder_thresholds` direct table | Deny | Deny; use authorized RPC where offered | Deny direct; scoped management RPC | Deny direct; management RPC | Backend access |
| `notification_config` direct table | Deny | Deny | Deny direct; authorized read RPC | Deny direct; authorized read/update RPC | Backend access |
| `parameter_alerts` SELECT | Deny | Accessible stations only | Accessible stations only | Scope returned by authoritative station function | Backend access |
| Alert INSERT/UPDATE/DELETE | Deny | Deny | Deny | Deny direct | Trusted trigger/backend only |

No INSERT/UPDATE `WITH CHECK` policy is needed because no client role receives alert writes.

## 5. Sensitive RPC permission matrix after remediation

| Function group | PUBLIC | anon | authenticated | service_role/owner |
| --- | --- | --- | --- | --- |
| Legitimate application RPCs | Deny | Deny | Existing explicit grant; internal role/scope checks and/or RLS remain authoritative | Available |
| `create_notification_event` (all three overloads) | Deny | Deny | Deny | Trigger/owner only |
| `get_notification_recipients` (both overloads) | Deny | Deny | Deny | Internal backend only |
| `get_notification_device_tokens` | Deny | Deny | Deny | Internal backend only |
| `handle_interruption_notification` | Deny | Deny | Deny | Trigger only |
| `evaluate_logbook_parameter_thresholds` | Deny | Deny | Deny | Trigger only |

All reviewed SECURITY DEFINER functions use a fixed `search_path=public`. The migration handles legacy functions conditionally so a clean environment without an old overload does not fail.

## 6–7. Edge Function authorization and actual caller

Both local function implementations are POST-only and compare the bearer credential to the runtime service-role secret using a constant-time comparison. Missing, invalid, anon, or ordinary-user credentials return a generic 401. GET returns 405. Direct sending accepts only a valid UUID plus bounded title/body; both functions enforce request-size limits and return generic 400/413 responses for malformed or oversized JSON.

The actual automatic caller is a live `pg_cron` job (job 1), active every 30 seconds. It uses `pg_net.http_post`, supplies an Authorization header, and obtains the service-role credential from Supabase Vault. It does not reference an anon credential or expose the key to React/Android. Therefore the hardened contract is architecturally compatible. Dynamic acceptance remains unproved until deployed in staging.

Current production deployments remain vulnerable/unremediated: `send-notification` version 9 and `send-pending-notifications` version 8 both report `verify_jwt=false`.

## 8–17. Authorization and notification regression results

| Test | Role | Resource | Expected | Actual | Result |
| --- | --- | --- | --- | --- | --- |
| Protected tables after migration | anon | thresholds/alerts/config | Denied | Not run; no staging | BLOCKED |
| Internal notification RPC | anon | recipient/event helpers | Execute denied | Local ACL design verified only | BLOCKED |
| Internal notification RPC | Operator | recipient/event helpers | Execute denied | Local ACL design verified only | BLOCKED |
| Missing/invalid bearer | anon | both Edge Functions | 401 | Source reviewed; deployed versions unchanged | BLOCKED |
| Ordinary JWT | Operator | both Edge Functions | 401 | Source reviewed; no staging identity test | BLOCKED |
| Service-role caller | cron | pending sender | Accepted | Caller capability verified; hardened deployment not tested | BLOCKED |
| Authorized alerts | Operator A | Station A | Rows returned | Not run | BLOCKED |
| Cross-station alerts | Operator A | Station B | No rows | Not run | BLOCKED |
| Authorized Realtime | Operator A | Station A alert | Delivered | Not run | BLOCKED |
| Unauthorized Realtime | Operator A | Station B alert | Not delivered | Not run | BLOCKED |
| Officer/Admin scope | Officer/Admin | intended stations/admin RPCs | Existing legitimate access | Static policy/RPC review only | BLOCKED |
| FCM LIVE interruption | recipient | end-to-end pipeline | SENT, urgent channel, one delivery | Not run | BLOCKED |
| FCM parameter/delayed/historical | recipient | end-to-end pipeline | Classification preserved | Not run | BLOCKED |
| Notification tap | Android user | foreground/background/cold start | Auth then Alerts | Not run on physical device | BLOCKED |
| Cross-user FCM token access | Operator | another user token | Denied | Migration design denies helper RPC; not deployed | BLOCKED |
| Cross-user token mutation | Operator | device tokens | Denied by existing RPC/RLS | Static review only | BLOCKED |

Production data was not selected through vulnerable anonymous endpoints, and no forged event/notification was created merely to demonstrate impact.

## 15–17. Headers and export regressions

Netlify security headers are present in local configuration but no preview/staging deployment was available, so actual response headers and CSP compatibility remain untested. CSV formula neutralization covers string cells whose first effective character is `=`, `+`, `-`, or `@`; numeric negative values remain numeric. Print titles escape `<`, `>`, `"`, `'`, and `&`. TypeScript/build validation passed, but Excel/LibreOffice and browser execution tests remain manual.

## 18. Android regression

`npx cap sync android` passed and `assembleDebug` completed successfully after disabling backup and cleartext traffic. Startup, authentication, HTTPS, operational entry, notification channel/tap, offline operation, and physical backup tests require an Android device and test account.

## 19. Production npm-audit findings

| Package | Severity | Relationship | Exposure | Fixed version/action |
| --- | --- | --- | --- | --- |
| `@capacitor/cli` 8.4.2 | High aggregate | Direct | Build/CLI only; not bundled application runtime | No complete audit fix; keep aligned with Capacitor and move to devDependencies in controlled stage |
| `native-run` 2.0.3 | Moderate | Transitive via CLI | Developer device-launch tooling | Upgrade when Capacitor supports updated chain |
| `plist` 3.1.1 | Moderate aggregate | Transitive | Crafted plist parsing during tooling operations | Upstream/Capacitor-controlled |
| `@xmldom/xmldom` 0.9.10 | High | Transitive via plist | Crafted XML injection/DoS in tooling, not normal app runtime | Version above affected `<=0.9.11`; requires upstream plist/native-run resolution |
| `rimraf` 6.1.3 | High aggregate | Transitive via CLI | Build cleanup tooling | Update through Capacitor dependency chain |
| `glob` 13.0.6 | High aggregate | Transitive via rimraf | Build-time matching | Audit reports fix available; update through parent |
| `minimatch` 10.2.6 | High aggregate | Transitive via glob | Build-time matching | Update parent chain |
| `brace-expansion` 5.0.8 | High | Transitive via minimatch | Build-time resource-exhaustion risk | `>=5.0.9`; use controlled lockfile/upstream update |

No `npm audit fix --force` or dependency upgrade was performed.

## 20. ESLint separation

Targeted lint of the modified application export files has zero errors and one pre-existing Fast Refresh warning. Full lint still reports 16 errors: one comes from a generated Android `native-bridge.js`; the others are existing unused imports/functions/parameters in Charts, Dashboard, Reports, Indices, and Load Analysis. No new security-patch lint error was identified. Broad cleanup was intentionally excluded.

## 21–27. Gate, remaining findings, recommendation, and classification

Completed and verified:

- Pending/applied migration inventory and dependency order.
- Live RLS/table grants, direct authenticated RPC ACLs, and sensitive helper exposure.
- Actual cron/Vault/service-role caller architecture.
- Hardened local SQL and Edge Function source review.
- Typecheck, production build, diff check, Capacitor sync, and Android debug build.

Not automatically testable in the available environment:

- All post-remediation anonymous, role, station, Realtime, FCM, device-token, header, browser spreadsheet/print, and physical Android tests.

Remaining Critical issues: GV-SEC-001, GV-SEC-002, and GV-SEC-003 remain live because nothing was deployed. Remaining High issues: GV-SEC-004 and the public RPC default remain live; hardened local changes are unvalidated. Medium findings include unverified CSP/headers, device-local exposure, production monitoring/rate limits, dependency chains, and disabled release minification.

Production recommendation: **do not deploy yet**. Create a separate Supabase staging project (preferred) or install Docker Desktop and run the full local Supabase stack. Apply the two migrations in timestamp order, deploy both functions, run the complete matrix, then promote the exact reviewed artifacts to production.

Final classification: **A. SECURITY HARDENING INCOMPLETE — RELEASE BLOCKERS REMAIN**.

Exact next action: provision/identify the non-production Supabase target and provide test identities for Operator A/Station A, an out-of-scope Station B, Officer, Admin, and an Android FCM device. Then repeat this stage against that target without relinking or modifying production until every mandatory gate passes.
