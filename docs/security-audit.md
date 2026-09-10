# GridVision Security Audit and Pre-VAPT Readiness

Audit date: 9 September 2026 (IST)  
Scope: React/Vite web client, Capacitor Android shell, Supabase/PostgreSQL, Edge Functions, FCM, offline storage/sync, Netlify, exports, and build dependencies.  
Status: source/configuration review plus read-only live Supabase catalogue inspection. This is not an independent penetration-test certificate.

## 1. Executive security assessment

The review found three connected release-blocking trust-boundary failures in the deployed notification/alert data plane: three sensitive tables have RLS disabled with broad anonymous grants; a public Edge Function can send trusted FCM messages with a service-role client; and legacy SECURITY DEFINER RPCs expose recipient PII/FCM tokens and permit notification-event creation. Local remediations are included in this working tree, but the live release blockers remain until the migration and Edge Functions are independently reviewed, deployed, and dynamically retested.

The offline architecture has meaningful safeguards (owner binding, authorization revalidation, FIFO/single-flight replay, idempotency identifiers, diagnostic minimization), but device-local operational data remains recoverable on a compromised/rooted device. The web build lacked response hardening headers and exports allowed spreadsheet formula interpretation; local fixes are included.

Final classification: **A. SECURITY HARDENING INCOMPLETE — RELEASE BLOCKERS REMAIN**.

## 2. Architecture and trust boundaries

Browser and Android WebView clients use Supabase Auth, PostgREST/RPC, Realtime, and local IndexedDB/localStorage. Operational mutations can be queued locally and replayed after server-side authorization revalidation. Database triggers create notification events/recipients; privileged Edge Functions use the service-role key and Firebase service-account material to deliver FCM. Netlify serves the web/PWA shell; Capacitor exposes selected native plugins.

Threat actors considered: anonymous clients, ordinary users, Operators, Officers, Admins, compromised privileged users, malicious insiders, bots, cross-organisation users, storage-tampering attackers, stolen/rooted devices, network attackers, and dependency/build-chain compromise. Assets include sessions, authorization scope, readings, interruptions, alerts, station/office assignments, audit records, FCM tokens, queued mutations, drafts, cached reports, and profile PII.

## 3. Standards used

- OWASP Top 10:2025 and OWASP API Security Top 10
- OWASP ASVS 5 (architecture, authentication, access control, validation, data protection, API and configuration controls)
- OWASP MASVS/MASTG (storage, network, platform, code and resilience)
- CWE and NIST SSDF secure-development practices
- PostgreSQL/Supabase RLS, SECURITY DEFINER, and least-privilege guidance

## 4. OWASP Top 10 matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Broken access control | Fail / release blocker | RLS/grants and privileged function findings GV-SEC-001/003 |
| Security misconfiguration | Fail | Public function grants and missing response headers |
| Supply-chain failures | Needs remediation | `npm audit` reports vulnerable build/CLI dependency chains |
| Cryptographic failures | Conditional | TLS endpoints used; device-local operational data is plaintext |
| Injection | Partially remediated | Parameterized Supabase calls; CSV and print sinks fixed locally |
| Insecure design | Fail | Notification service boundary trusted callers without authenticating them |
| Authentication failures | No bypass found statically | Supabase Auth used; invite/reset functions manually validate callers |
| Integrity failures | Needs dynamic test | Offline idempotency exists; client storage is tamperable by design |
| Logging/monitoring failures | Partial | Audit/diagnostics exist; centralized production security monitoring not evidenced |
| Exceptional conditions | Partial | Queue retains failed work; Edge Functions need abuse/load testing |

## 5. OWASP API Top 10 matrix

Object- and property-level authorization principally rely on RLS and scoped RPCs. Findings GV-SEC-001/003 were direct authorization failures. Resource consumption controls are incomplete on notification endpoints and large report queries. Administrative RPCs generally perform role checks, but default PUBLIC execute grants enlarge the attack surface. SSRF was not identified; outbound destinations in reviewed functions are fixed Google/Supabase endpoints. API inventory/version retirement and dynamic fuzzing remain required.

## 6. ASVS assessment summary

Architecture and access-control controls are partially satisfied; critical database and function exposure fails the access-control gate in the currently deployed state. Authentication is delegated to Supabase and no client-side service-role secret was found. Validation is strongest in operational UI/RPC paths but inconsistent at Edge Function boundaries. Stored data protection is adequate for server-side secrets but device-local data assumes OS protection. Deployment configuration and security monitoring require further evidence.

## 7. Android MASVS/MASTG summary

The launcher activity is the only exported app component found; the FileProvider is non-exported. No remote Capacitor server or broad navigation allow-list is configured. Local hardening disables Android backup and cleartext traffic. Release minification remains disabled. Offline data, drafts, and sessions require physical-device tests on backup, rooted/stolen-device, screenshot, task-switcher, logcat, notification-intent, and WebView debugging scenarios.

## 8–13. Authentication, authorization, RLS, RPC, Edge Functions, and API

Supabase Auth persists/refreshes sessions using the SDK. Invite and resend functions disable gateway verification to support preflight but manually call `auth.getUser()` and enforce active Admin/Super Admin roles; resend also has a target cooldown. Account enumeration, password policy, recovery-link expiry/reuse, MFA readiness, and privileged-operation reauthentication require hosted dynamic testing.

Live RLS inventory (17 tables): RLS is enabled on `administration_audit_log`, `app_users`, `device_tokens`, `feeders`, `interruptions`, `log_book_entries`, `notification_events`, `notification_recipients`, `org_units`, `station_org_units`, `stations`, `user_org_units`, `user_station_assignments`, and `user_stations`. It is disabled on `feeder_thresholds`, `parameter_alerts`, and `notification_config`; all three grant all table privileges to `anon` and `authenticated`.

The live public schema contains numerous invoker and SECURITY DEFINER RPCs. All inspected definer functions set `search_path=public` except generic trigger helpers. Many inherit PUBLIC execute. Most administrative functions contain explicit active-role/scope checks, but the legacy notification functions in GV-SEC-003 do not. A complete deny/allow catalogue and negative-role regression suite should replace reliance on PostgreSQL's default PUBLIC grants.

Edge Function inventory:

| Function | Privilege boundary | Result |
| --- | --- | --- |
| `invite-user` | Manual authenticated Admin/Super Admin check | Partial; add origin/rate abuse tests |
| `resend-setup-email` | Manual role check and 5-minute cooldown | Partial; add distributed abuse tests |
| `send-notification` | Service role + Firebase sender | Critical before local fix |
| `send-pending-notifications` | Service-role recipient processor | High before local fix |

## 14–18. Validation, injection, browser policy, sessions, and secrets

Supabase query builders/RPC parameters avoid hand-built SQL in reviewed client paths. React output encoding is used and no `dangerouslySetInnerHTML`, `eval`, or `new Function` sink was found. The print helper used an unescaped title in generated HTML and CSV exported attacker-controlled formula prefixes; both are neutralized locally. Dynamic stored-XSS and spreadsheet-client tests remain required.

Netlify had no declared CSP, anti-framing, MIME, referrer, permissions, or HSTS headers. A restrictive, application-compatible baseline is added locally. Hosted verification must confirm Supabase HTTP/WebSocket, service worker, blob/data images, PDF/print, and Android behavior. Browser sessions remain script-readable through the Supabase persistence model, making XSS prevention essential. No service-role/database/Firebase private key was found in client code or tracked files. `.env` is ignored and contains only the names of public Vite Supabase URL/anon-key variables; values were not copied into this report.

## 19. Dependency and supply-chain findings

The lockfile exists. `npm audit` reported 30 issues overall (28 high, 2 moderate) and 8 with development dependencies omitted (6 high, 2 moderate). The latter are reached through `@capacitor/cli`/`native-run`/`plist`/`xmldom` and glob tooling; the CLI is currently listed as a production dependency although it is build tooling. No automatic force-upgrade was applied because npm reports no complete compatible fix and exploitability differs from runtime exposure. Pinning/upstream upgrades and CI audit policy require a controlled dependency stage.

## 20–24. Android, Capacitor, offline storage, replay, and cross-user isolation

Capacitor uses bundled assets and a narrow plugin set. Android backup and cleartext traffic are disabled locally; release minification/obfuscation is not enabled and is a hardening recommendation rather than a substitute for access control. IndexedDB/localStorage content is not a trusted authorization source. Queue operations are user-bound, replay is FIFO/single-flight, authorization is checked before sync, dependencies/idempotency metadata are present, and failed work is retained. Physical-device and tampering tests must verify cross-user logout/login, stale authorization, queue edits, restore dependencies, quota/eviction, process death, and rooted extraction.

## 25–32. Notifications, PWA, exports, privacy, business logic, and availability

FCM tokens are sensitive bearer-like routing identifiers and must never be client-enumerable. Notification source classifications and PENDING→SENT/FAILED behavior are preserved. The service worker caches only same-origin GET responses; Supabase API data is cross-origin and was not observed in its cache logic, but stale-shell/update and cache-poisoning tests remain. CSV/print sinks are locally hardened. Diagnostics appear summarized and user-bound; no raw queue payload/token logging was identified. Existing interruption open/restore constraints, ETR time rules, station scope, idempotency, and concurrency require authenticated negative and race tests. Large-query, reconnect-storm, Realtime, and notification retry load tests remain outstanding.

## 33. Security fixes applied locally

| Fix | Files | Regression surface / validation |
| --- | --- | --- |
| Add RLS/grant boundary and scoped alert SELECT; revoke internal notification RPCs | `20260909000100_harden_alert_and_notification_boundaries.sql` | Alerts/reports/Realtime and trigger notification generation; migration not yet applied |
| Require service-role bearer and POST on both notification functions; validate direct-send input | Edge Function sources and `supabase/config.toml` | Scheduled/server invocation must send service-role bearer; not yet deployed |
| Add Netlify response headers/CSP | `netlify.toml` | Hosted Supabase/WebSocket/PDF/PWA smoke test required |
| Neutralize CSV formulas and escape generated print titles | report helpers | Typecheck/build pass; spreadsheet/browser tests required |
| Disable Android backup and cleartext traffic | Android manifest | Android build passes when confirmed below; physical-device checks required |

## 34–37. Findings register

| ID | Severity | Vulnerability and realistic attack | Impact / likelihood | Remediation status |
| --- | --- | --- | --- | --- |
| GV-SEC-001 | Critical | Anonymous full-table access to thresholds, alerts, notification config | Easy remote disclosure/tampering/deletion; operational integrity and availability compromise | Local migration prepared; remote blocker remains |
| GV-SEC-002 | Critical | Unauthenticated `send-notification` uses service role and Firebase credentials for caller-selected recipient/content | Trusted notification spoofing/phishing/harassment and cost abuse | Local auth/input patch prepared; deployment required |
| GV-SEC-003 | Critical | PUBLIC/anon execution of legacy recipient/token and event-creation SECURITY DEFINER RPCs | PII/FCM token disclosure and forged notification events | Local revocation migration prepared; remote blocker remains |
| GV-SEC-004 | High | Pending notification processor lacks an internal-only caller check | Delivery amplification, races, privileged job abuse by ordinary user | Local service-role check prepared; deployment required |
| GV-SEC-005 | High | Broad default PUBLIC execution across public RPC catalogue | Enlarged attack surface; a missed inner check becomes privilege bypass | Critical helpers fixed locally; full explicit grant catalogue pending |
| GV-SEC-006 | Medium | Missing production web response headers | Increased XSS/clickjacking/browser-feature impact | Fixed locally; hosted verification pending |
| GV-SEC-007 | Medium | Android backup/plaintext local operational data exposure | Data recovery from compromised/stolen/rooted device | Backup fixed locally; rooted-device residual risk accepted/test pending |
| GV-SEC-008 | Medium | CSV formula and print-title injection sinks | Spreadsheet code/link execution with user interaction; print DOM injection | Fixed locally |
| GV-SEC-009 | Medium | No demonstrated centralized security monitoring/rate limiting | Slower detection and abuse containment | Operational work pending |
| GV-SEC-010 | Medium | Vulnerable CLI/build dependency chains reported by npm | Developer/CI DoS or crafted-input risk; not shown reachable in shipped SPA | Controlled dependency update pending |
| GV-SEC-011 | Low | Android release minification disabled | Easier reverse engineering; no direct authorization bypass | Optional controlled hardening |
| GV-SEC-012 | Informational | Browser/Android offline data is readable after client compromise | Explicit threat-model limitation; server never trusts it for authorization | Document and test |

No remaining Critical/High issue can be considered resolved in production until the local migration/functions are deployed and negative tests pass. Lower-risk findings must not distract from those gates.

## 38–40. Dynamic/manual VAPT and evidence still required

- Anonymous and each role: CRUD/RPC matrix for every table/function, cross-station and cross-organisation IDOR, mass assignment, altered JWT, expired/deactivated account, and direct REST/RPC calls.
- Edge Functions: missing/user/anon/service-role tokens, malformed/oversized JSON, method/content-type, replay, concurrency, rate limiting, recipient enumeration, and spoof attempts.
- Browser: CSP report/console, clickjacking, stored/reflected/DOM XSS, auth recovery/invite, logout/back cache, Realtime authorization, service-worker update, CSV/PDF payloads.
- Android physical device: backup/extraction, rooted storage, WebView debugging, deep links/intents, notification tap/spoofing, logcat, screenshots/task switcher, offline queue tampering, user A→B isolation, process death and network interception.
- Evidence package: tool versions/configs, request/response captures with secrets redacted, migration/deployment IDs, Supabase policy/function snapshots, dependency SBOM/audit, APK manifest/signing inspection, screenshots, retest results, and risk acceptance approvals.

## 41. Release-blocker status

**Blocked.** The deployed database and notification functions retain GV-SEC-001 through GV-SEC-004 until approved deployment and retest. Dependency and hosted/physical-device evidence are also incomplete.

## 42. Final readiness classification

**A. SECURITY HARDENING INCOMPLETE — RELEASE BLOCKERS REMAIN**

## 43. Recommended next action

Review the prepared database migration and internal notification-caller contract in a non-production Supabase project. Apply the migration, deploy both functions together, execute anonymous/ordinary/service-role negative tests and Alerts/Realtime/FCM regressions, then repeat the live catalogue inventory. Only after those gates pass should dependency upgrades and broader medium-risk hardening proceed.
