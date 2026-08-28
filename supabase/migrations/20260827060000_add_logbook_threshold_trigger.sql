DROP TRIGGER IF EXISTS trg_evaluate_logbook_parameter_thresholds
  ON public.log_book_entries;

CREATE TRIGGER trg_evaluate_logbook_parameter_thresholds
AFTER INSERT OR UPDATE OF
  mw,
  mvar,
  voltage_kv,
  current_a,
  power_factor,
  frequency_hz,
  transformer_temp_c,
  oil_level_percent
ON public.log_book_entries
FOR EACH ROW
EXECUTE FUNCTION public.evaluate_logbook_parameter_thresholds();
