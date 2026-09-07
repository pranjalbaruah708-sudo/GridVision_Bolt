BEGIN;

-- Supabase's API roles can receive explicit function EXECUTE grants in addition
-- to PUBLIC defaults. Keep the authenticated historical RPC callable, while
-- preventing anonymous access and direct calls to its internal event helper.
REVOKE ALL ON FUNCTION public.sync_historical_interruption(uuid, uuid, timestamptz, timestamptz, text, text, timestamptz, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_historical_interruption(uuid, uuid, timestamptz, timestamptz, text, text, timestamptz, timestamptz, timestamptz, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_notification_event(uuid, uuid, timestamptz, text, uuid, text, text, text, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;

COMMIT;
