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
    (current_status = 'OPEN' AND interruption_end IS NULL)
    OR
    (
      current_status = 'RESTORED'
      AND interruption_end IS NOT NULL
      AND interruption_end >= interruption_start
    )
    OR
    current_status = 'CANCELLED'
  );

CREATE UNIQUE INDEX IF NOT EXISTS interruptions_one_open_per_feeder
  ON interruptions (feeder_id)
  WHERE current_status = 'OPEN' AND feeder_id IS NOT NULL;
