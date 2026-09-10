-- Security hardening: keep alert/configuration tables behind RLS/RPC boundaries
-- and remove public access to internal notification helper functions.

ALTER TABLE public.feeder_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parameter_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.feeder_thresholds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.parameter_alerts FROM PUBLIC, anon, authenticated;

-- Alerts are read directly by the Alerts page and by SECURITY INVOKER reports.
-- Restrict those reads to the caller's established station scope. Alert writes
-- remain available only to trusted table owners/service-role trigger paths.
GRANT SELECT ON TABLE public.parameter_alerts TO authenticated;

DROP POLICY IF EXISTS "Users read alerts for accessible stations"
  ON public.parameter_alerts;

CREATE POLICY "Users read alerts for accessible stations"
  ON public.parameter_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.get_my_accessible_station_ids() AS accessible
      WHERE accessible.station_id = parameter_alerts.station_id
    )
  );

-- All user-facing RPCs in the current schema already carry explicit grants to
-- authenticated. Remove PostgreSQL's implicit PUBLIC execute default so anon
-- cannot probe either invoker or SECURITY DEFINER functions. The narrower
-- block below also removes authenticated access from internal notification
-- plumbing that must only be reached by trusted trigger/owner paths.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- These functions are internal notification plumbing. PostgreSQL grants
-- EXECUTE to PUBLIC by default unless it is explicitly revoked. Trigger and
-- owner/service-role calls continue to work after these client grants are
-- removed.
DO $security$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text)',
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.create_notification_event(uuid,uuid,timestamp with time zone,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text)',
    'public.get_notification_recipients(uuid)',
    'public.get_notification_recipients(uuid,text)',
    'public.get_notification_device_tokens(uuid)',
    'public.handle_interruption_notification()',
    'public.evaluate_logbook_parameter_thresholds()'
  ]
  LOOP
    -- Older notification helpers exist on the linked project but may not be
    -- present in a clean environment built from the current migration set.
    IF to_regprocedure(signature) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        signature
      );
    END IF;
  END LOOP;
END
$security$;
