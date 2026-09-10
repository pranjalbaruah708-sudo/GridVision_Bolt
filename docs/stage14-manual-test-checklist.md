# Stage 14 manual failure matrix

Run against a non-production Supabase project with representative Operator and Admin accounts. Record the account, device/browser, build, timestamps, expected result, and actual result for every case.

## Connectivity

- Toggle online/offline five times rapidly, ending online. Confirm one queue replay, one current realtime subscription per view, stable UI state, and coherent diagnostics.
- Save offline, reconnect, and confirm authorization is revalidated before FIFO replay.
- Simulate HTTP 502/503/504 and 429. Confirm records remain Pending Sync, do not enter a retry loop, and synchronize after recovery.
- Simulate a fetch/network timeout. Confirm cached data remains visible and no authoritative empty state is shown.

## Lifecycle

- On Android, edit both operational forms, background and resume the app. Confirm drafts persist, access revalidates once, the current view refreshes, and replay is single-flight.
- Force-close after editing but before Save. Reopen and confirm the matching draft is restored.
- Force-close while several records synchronize. Reopen and confirm completed records stay removed and remaining records replay idempotently.
- Reload the browser during synchronization and verify the same recovery behavior.

## Concurrency

- Press **Sync now** repeatedly. Confirm one active flush and correct final counts.
- Press **Retry** repeatedly on one Needs Attention record. Confirm serialized replay and no duplicate server row.
- Rapidly switch feeder, date, and hour while entries load. Confirm only the final context populates the form.
- Receive a realtime update while a local record is pending. Confirm the pending record/draft remains visible and no client-side conflict is silently resolved.

## Identity and authorization

- Start a load or sync as User A, sign out, and sign in as User B. Confirm no A state appears or replays under B. Return to A and confirm A's local state remains.
- Revoke station/role access before reconnect. Confirm affected operations become Needs Attention and no unauthorized replay continues.
- Reconnect with an expired session. Confirm sign-in/recovery is required and queue/drafts remain intact.

## Storage

- Simulate quota/storage failure during an offline Save. Confirm the UI does not report durable success.
- Simulate local deletion/mapping failure after a successful server mutation. Confirm the queued operation remains recoverable and the next idempotent replay clears it without duplication.
- Clear local cache during an online refresh. Confirm queue, drafts, verified identity, authorization scope, and diagnostics remain; a later cache repopulation is acceptable.
- Simulate HIGH/CRITICAL storage pressure and confirm only disposable caches are pruned.

## Multi-device

- Edit the same feeder/hour or interruption from two devices using the same account, with one device offline. Reconnect it and confirm backend uniqueness wins, the conflict becomes Needs Attention, and no silent overwrite occurs.

## Acceptance evidence

- Inspect copied diagnostics for tokens, UUIDs, email, URLs, payloads, values, remarks, and raw database errors; none may be present.
- Confirm Android background/resume does not duplicate push listeners or notifications.
- Confirm the offline PWA shell loads after a production build and service-worker activation does not affect IndexedDB metadata or operations.
