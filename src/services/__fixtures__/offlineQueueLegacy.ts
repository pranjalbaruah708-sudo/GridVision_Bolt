/** Legacy localStorage records used for manual/browser migration validation. */
export const legacyOfflineQueueFixture: unknown[] = [
  {
    id: 'legacy-log-add', method: 'POST', table: 'log_book_entries',
    body: { station_id: 'station-1', feeder_id: 'feeder-1', operator_id: 'user-a', actual_event_time: '2026-09-07T04:30:00.000Z' },
    operationType: 'ADD_LOG_ENTRY', enqueuedAt: 1_000,
  },
  {
    id: 'legacy-log-update', method: 'PATCH', table: 'log_book_entries', filter: { id: 'entry-1' },
    body: { station_id: 'station-1', feeder_id: 'feeder-2', operator_id: 'user-a', actual_event_time: '2026-09-07T05:30:00.000Z' },
    operationType: 'UPDATE_LOG_ENTRY', enqueuedAt: 2_000,
  },
  {
    id: 'legacy-trip', clientOperationId: 'legacy-trip-client', method: 'POST', table: 'interruptions',
    body: { station_id: 'station-1', feeder_id: 'feeder-1', operator_id: 'user-a', interruption_start: '2026-09-07T06:30:00.000Z' },
    operationType: 'ADD_INTERRUPTION', localEntityId: 'local:int:legacy-trip-client', enqueuedAt: 3_000,
  },
  {
    id: 'legacy-restore', method: 'PATCH', table: 'interruptions',
    body: { interruption_end: '2026-09-07T07:30:00.000Z' }, operationType: 'RESTORE_INTERRUPTION',
    localEntityId: 'local:int:legacy-trip-client', dependsOn: ['legacy-trip'], enqueuedAt: 4_000,
  },
  {
    id: 'legacy-failed', method: 'POST', table: 'log_book_entries',
    body: { station_id: 'station-1', feeder_id: 'feeder-3', operator_id: 'user-a', actual_event_time: '2026-09-07T08:30:00.000Z' },
    operationType: 'ADD_LOG_ENTRY', retryCount: 3, lastError: 'Replay failed with HTTP 503.', enqueuedAt: 5_000,
  },
];
