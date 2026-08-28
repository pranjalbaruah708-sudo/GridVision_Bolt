CREATE UNIQUE INDEX IF NOT EXISTS parameter_alerts_log_entry_parameter_unique
  ON public.parameter_alerts (log_book_entry_id, parameter_code);
