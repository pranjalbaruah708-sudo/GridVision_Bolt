/*
  Enforce the core feeder interruption lifecycle in PostgreSQL.

  The UI also validates these rules, but database constraints protect every
  caller (including offline replay and future integrations) from invalid or
  duplicate operational records.
*/

ALTER TABLE interruptions
  DROP CONSTRAINT IF EXISTS interruptions_lifecycle_consistency;

ALTER TABLE interruptions
  ADD CONSTRAINT interruptions_lifecycle_consistency CHECK (
    (status = 'open' AND restored_at IS NULL)
    OR
    (status = 'closed' AND restored_at IS NOT NULL AND restored_at >= started_at)
  );

CREATE UNIQUE INDEX IF NOT EXISTS interruptions_one_open_per_feeder
  ON interruptions (feeder_id)
  WHERE status = 'open' AND feeder_id IS NOT NULL;
