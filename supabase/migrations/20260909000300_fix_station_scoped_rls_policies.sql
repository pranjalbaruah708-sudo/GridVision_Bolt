-- Restrict direct client access to the caller's authoritative station scope.
-- This migration intentionally leaves organisation metadata and internal
-- notification tables unchanged.

-- Station and feeder master data are visible only inside the same station
-- scope used by operational RPCs and alerts.
DROP POLICY IF EXISTS "Authenticated users can view stations"
  ON public.stations;
CREATE POLICY "Users read accessible stations"
  ON public.stations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.get_my_accessible_station_ids() AS accessible
      WHERE accessible.station_id = stations.id
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view feeders"
  ON public.feeders;
CREATE POLICY "Users read feeders for accessible stations"
  ON public.feeders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.get_my_accessible_station_ids() AS accessible
      WHERE accessible.station_id = feeders.station_id
    )
  );

-- FIELD_OFFICER read access follows organisation-derived station scope.
DROP POLICY IF EXISTS "Field officers can view all log entries"
  ON public.log_book_entries;
CREATE POLICY "Field officers read accessible log entries"
  ON public.log_book_entries
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'FIELD_OFFICER'::public.app_user_role
    AND EXISTS (
      SELECT 1
      FROM public.get_my_accessible_station_ids() AS accessible
      WHERE accessible.station_id = log_book_entries.station_id
    )
  );

DROP POLICY IF EXISTS "Field officers can view all interruptions"
  ON public.interruptions;
CREATE POLICY "Field officers read accessible interruptions"
  ON public.interruptions
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'FIELD_OFFICER'::public.app_user_role
    AND EXISTS (
      SELECT 1
      FROM public.get_my_accessible_station_ids() AS accessible
      WHERE accessible.station_id = interruptions.station_id
    )
  );

-- The legacy user_station_assignments policies duplicated the authoritative
-- user_stations model and did not constrain role or operator_id. The current
-- operator policies below are the sole write path for interruptions.
DROP POLICY IF EXISTS "operators_read_assigned_station_interruptions"
  ON public.interruptions;
DROP POLICY IF EXISTS "operators_insert_assigned_station_interruptions"
  ON public.interruptions;
DROP POLICY IF EXISTS "operators_update_assigned_station_interruptions"
  ON public.interruptions;

-- Ensure an authorized station cannot be paired with a feeder belonging to a
-- different station. NULL feeder values remain valid as in the existing schema.
DROP POLICY IF EXISTS "Operators can insert assigned log entries"
  ON public.log_book_entries;
CREATE POLICY "Operators can insert assigned log entries"
  ON public.log_book_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
    AND (
      feeder_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.feeders feeder
        WHERE feeder.id = log_book_entries.feeder_id
          AND feeder.station_id = log_book_entries.station_id
          AND feeder.active = true
      )
    )
  );

DROP POLICY IF EXISTS "Operators can update own assigned log entries"
  ON public.log_book_entries;
CREATE POLICY "Operators can update own assigned log entries"
  ON public.log_book_entries
  FOR UPDATE
  TO authenticated
  USING (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  )
  WITH CHECK (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
    AND (
      feeder_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.feeders feeder
        WHERE feeder.id = log_book_entries.feeder_id
          AND feeder.station_id = log_book_entries.station_id
          AND feeder.active = true
      )
    )
  );

DROP POLICY IF EXISTS "Operators can insert assigned interruptions"
  ON public.interruptions;
CREATE POLICY "Operators can insert assigned interruptions"
  ON public.interruptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
    AND (
      feeder_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.feeders feeder
        WHERE feeder.id = interruptions.feeder_id
          AND feeder.station_id = interruptions.station_id
          AND feeder.active = true
      )
    )
  );

DROP POLICY IF EXISTS "Operators can update own assigned interruptions"
  ON public.interruptions;
CREATE POLICY "Operators can update own assigned interruptions"
  ON public.interruptions
  FOR UPDATE
  TO authenticated
  USING (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
  )
  WITH CHECK (
    public.get_my_role() = 'OPERATOR'::public.app_user_role
    AND operator_id = auth.uid()
    AND public.is_assigned_to_station(station_id)
    AND (
      feeder_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.feeders feeder
        WHERE feeder.id = interruptions.feeder_id
          AND feeder.station_id = interruptions.station_id
          AND feeder.active = true
      )
    )
  );
