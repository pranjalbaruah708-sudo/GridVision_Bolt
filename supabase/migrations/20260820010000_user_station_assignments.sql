/*
  Generic operator-to-station assignments.

  A user may be associated with multiple stations, while one station can be
  marked as the primary operational context used when the application opens.
  This model deliberately contains no utility-specific hierarchy assumptions.
*/

CREATE TABLE IF NOT EXISTS public.user_station_assignments (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_station_assignments_one_primary_station
  ON public.user_station_assignments (user_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS user_station_assignments_station_idx
  ON public.user_station_assignments (station_id);

ALTER TABLE public.user_station_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_station_assignments"
  ON public.user_station_assignments;

CREATE POLICY "users_read_own_station_assignments"
  ON public.user_station_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

/*
  Operators can only read, create, or restore interruption records belonging
  to one of their assigned stations. Assignment administration is intentionally
  excluded from client policies and should be handled by trusted backend/admin
  workflows.
*/

DROP POLICY IF EXISTS "anon_select_interruptions" ON public.interruptions;
DROP POLICY IF EXISTS "anon_insert_interruptions" ON public.interruptions;
DROP POLICY IF EXISTS "anon_update_interruptions" ON public.interruptions;
DROP POLICY IF EXISTS "anon_delete_interruptions" ON public.interruptions;

CREATE POLICY "operators_read_assigned_station_interruptions"
  ON public.interruptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_station_assignments assignment
      WHERE assignment.user_id = auth.uid()
        AND assignment.station_id = interruptions.station_id
    )
  );

CREATE POLICY "operators_insert_assigned_station_interruptions"
  ON public.interruptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_station_assignments assignment
      WHERE assignment.user_id = auth.uid()
        AND assignment.station_id = interruptions.station_id
    )
  );

CREATE POLICY "operators_update_assigned_station_interruptions"
  ON public.interruptions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_station_assignments assignment
      WHERE assignment.user_id = auth.uid()
        AND assignment.station_id = interruptions.station_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_station_assignments assignment
      WHERE assignment.user_id = auth.uid()
        AND assignment.station_id = interruptions.station_id
    )
  );
