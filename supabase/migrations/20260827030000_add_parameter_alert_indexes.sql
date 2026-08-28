CREATE INDEX IF NOT EXISTS idx_parameter_alerts_station_time
  ON public.parameter_alerts (station_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_parameter_alerts_feeder_time
  ON public.parameter_alerts (feeder_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_parameter_alerts_log_entry
  ON public.parameter_alerts (log_book_entry_id);
