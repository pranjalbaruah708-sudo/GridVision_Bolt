# GridVision offline and resilience readiness

## Architecture summary

GridVision keeps critical pending operational writes in the `gridvision-offline` IndexedDB database. The `OfflineStorage` repository owns persistence and provides a localStorage fallback only where IndexedDB is unavailable. Existing `gv_pending_queue` records are migrated defensively and remain replayable.

- **Queue:** durable, user-owned Parameter Entry and Interruption mutations. Items have stable client-operation IDs, FIFO ordering, retry state, dependency metadata, and a Pending/Needs Attention state. Queue persistence is durable-or-fail; the UI must never claim an offline save when persistence failed.
- **Drafts:** user/context-bound form recovery in IndexedDB metadata. They preserve unsaved edits across navigation, reload, backgrounding, and process restart. Draft epochs prevent a stale delayed write from recreating a deleted draft.
- **Read cache:** bounded, disposable, user-bound Dashboard/Alerts/operational snapshots stored under `gv_cache:*`. Cached data carries freshness metadata and must not be presented as live data. It may be pruned under storage pressure.
- **Verified scope and diagnostics:** device-local IndexedDB metadata used for offline authorization decisions and privacy-safe support status. Clear Local Cache must preserve both.

## Reconnect sequence

1. Detect connectivity/resume without polling.
2. Refresh the authenticated session and revalidate current role/station scope online.
3. If the session or scope changed, stop replay and retain affected records for review.
4. Start one user-bound queue flush. Replay serially in FIFO order; dependencies are not parallelized.
5. Treat stable client-operation IDs and server constraints as the idempotency boundary.
6. Remove a queue item only after confirmed server success and successful local completion. A local cleanup failure leaves the operation recoverable for idempotent retry.
7. Classify failures as transient, authorization, conflict, validation, dependency, or unknown. Transient work remains pending; actionable failures become Needs Attention.
8. Refresh operational views/realtime state after successful synchronization without overwriting pending local state.

## Notifications

Operational database events remain the authoritative notification source. The app registers an authenticated Android device through the existing notification service; web does not offer native registration controls. Notification recipients are processed by the deployed Edge Functions. Application diagnostics and server logs must not contain tokens, payload values, email addresses, raw authorization data, user/device/recipient UUIDs, or raw backend errors.

## Storage maintenance and diagnostics

Storage pressure cleanup removes only rebuildable caches. It must not delete the operation queue, drafts, verified scope, identity metadata, or diagnostics. The Settings **Clear Local Cache** action has the same boundary. Diagnostics are best effort and summarize timestamps, counts, broad failure categories, backend/access state, storage health, cache/draft counts, and notification capability. They intentionally omit operational values and identifiers.

## Known limitations

- Unsynchronized operations and drafts are local to one browser profile/device and are not a backup.
- The queue flush lock is runtime-local; database idempotency and constraints remain necessary across tabs and devices.
- Browser storage quota, eviction, and persistence guarantees vary by platform.
- Analytics and large historical reports remain primarily network-dependent; only explicitly cached operational views support offline display.
- Physical Android lifecycle, notification delivery, hosted HTTPS/PWA, concurrent-device conflicts, and final report rendering require controlled manual validation.

## Stage 15 acceptance matrix

`PASS` means evidence was produced in this Stage 15 run. `NOT TESTED` is deliberately not inferred from compilation or code inspection.

| Area | Status | Evidence / required manual check |
| --- | --- | --- |
| A. Authentication | NOT TESTED | Inspect/reset/invite code passed static review; exercise sign-in, sign-out, reset and invite on the hosted production origin. |
| B. Online operations | NOT TESTED | Exercise create/edit Parameter Entry and trip/restore against a non-production account. |
| C. Offline Parameter Entry | NOT TESTED | Save, reload/restart, reconnect, confirm one server row and queue removal. |
| D. Offline Interruption Entry | NOT TESTED | Test trip, restore, restart and dependency ordering on a physical device. |
| E. Sync/reconnect | NOT TESTED | Single-flight/FIFO/session guards passed static review; run the rapid reconnect matrix. |
| F. Conflicts | NOT TESTED | Force uniqueness/validation conflicts and verify Needs Attention/retry behavior. |
| G. Authorization | NOT TESTED | Revoke role/station access before reconnect and verify replay stops safely. |
| H. Draft recovery | NOT TESTED | Epoch/lifecycle protection passed static review; verify background, force-close and reload. |
| I. Cached offline views | NOT TESTED | Cache boundaries/freshness passed static review; verify Dashboard and Alerts offline. |
| J. Notifications | NOT TESTED | Source/log privacy reviewed; physical delivery, deduplication and logout behavior remain manual. |
| K. Storage | NOT TESTED | Cleanup boundaries passed static review; quota and eviction simulation remain manual. |
| L. Diagnostics | PASS | Static inspection confirms summarized, user-bound diagnostics with no payload/token fields. |
| M. Android lifecycle | NOT TESTED | Requires background/resume/force-stop testing on a physical Android device. |
| N. Web/PWA | NOT TESTED | Production build is validated; no browser automation or hosted deployment was available. |
| O. Cross-user/multi-device | NOT TESTED | User ownership/session guards passed static review; runtime A/B and two-device tests remain manual. |
| P. Reports/PDF | NOT TESTED | Export adapter and build are present; verify actual PDF/CSV/print files on web and Android. |
| Q. Responsive UI | NOT TESTED | No automated browser surface was available; inspect mobile and desktop breakpoints manually. |

## Manual release checklist

Use a non-production Supabase project and record app build, account/role, device/browser, timestamps, expected outcome, and actual outcome. Complete all `NOT TESTED` rows above plus the detailed failure scenarios in `stage14-manual-test-checklist.md`. A controlled production pilot should not be declared until critical operational, authorization, cross-user, lifecycle, notification, and report cases have recorded evidence.
