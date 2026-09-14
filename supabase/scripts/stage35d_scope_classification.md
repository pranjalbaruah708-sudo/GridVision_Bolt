# Stage 3.5D dependency classification

DEV: eetlzxntgvjompmipprb. Classified before dependency changes.

A: Broad Dashboard/Load Analysis and identity station counts.
B: Current office/station scope for Shift and Reports module (including performance/management reports).
C: Feature-specific role/ownership/mutation rules. Shutdown scope moves; its other predicates remain. Condition writes and admin-only reports remain unchanged.

| Function | Class | Action |
|---|---|---|
| get_dashboard_operational_summary | A | Unchanged |
| get_dashboard_today_load_trend | A | Unchanged |
| get_interruption_report_breakdown | B | Replace only station helper with dedicated operational helper |
| get_parameter_exception_report_breakdown | B | Replace only station helper with dedicated operational helper |
| get_load_analysis_overview | A | Unchanged |
| get_load_analysis_station_ranking | A | Unchanged |
| get_load_analysis_feeder_ranking | A | Unchanged |
| get_load_analysis_parameter_health | A | Unchanged |
| get_dashboard_attention_items | A | Unchanged |
| get_performance_report_metrics | B | Replace only station helper with dedicated operational helper |
| get_load_analysis_feeder_daily_profile | A | Unchanged |
| get_load_analysis_parameter_health_details | A | Unchanged |
| get_interruption_report_summary | B | Replace only station helper with dedicated operational helper |
| get_interruption_report_trend | B | Replace only station helper with dedicated operational helper |
| get_interruption_report_causes | B | Replace only station helper with dedicated operational helper |
| get_load_energy_report_summary | B | Replace only station helper with dedicated operational helper |
| get_load_energy_report_series | B | Replace only station helper with dedicated operational helper |
| get_parameter_exception_report_summary | B | Replace only station helper with dedicated operational helper |
| get_parameter_exception_detail_page | B | Replace only station helper with dedicated operational helper |
| get_logbook_report_summary | B | Replace only station helper with dedicated operational helper |
| get_executive_summary_report | B | Replace only station helper with dedicated operational helper |
| get_my_profile | A | Unchanged |
| get_data_completeness_report_summary | B | Replace only station helper with dedicated operational helper |
| get_data_completeness_station_breakdown | B | Replace only station helper with dedicated operational helper |
| get_data_completeness_feeder_breakdown | B | Replace only station helper with dedicated operational helper |
| get_data_completeness_report_trend | B | Replace only station helper with dedicated operational helper |
| get_data_completeness_missing_slots | B | Replace only station helper with dedicated operational helper |
| get_parameter_exception_parameters | B | Replace only station helper with dedicated operational helper |
| get_my_desktop_identity | A | Unchanged |
| get_executive_summary_attention | B | Replace only station helper with dedicated operational helper |
| get_operator_activity_report_summary | C | Unchanged |
| get_operator_activity_report_page | C | Unchanged |
| get_notification_delivery_report_summary | C | Unchanged |
| get_notification_delivery_report_page | C | Unchanged |
| assert_shift_station_access | B | Replace only station helper with dedicated operational helper |
| decide_shutdown_request | C | Replace only station helper with dedicated operational helper |
| create_shutdown_request | C | Replace only station helper with dedicated operational helper |
| list_shutdown_dashboard_requests | C | Replace only station helper with dedicated operational helper |
| get_shutdown_dashboard_kpis | C | Replace only station helper with dedicated operational helper |
| get_shutdown_request | C | Replace only station helper with dedicated operational helper |
| list_shutdown_report_requests | C | Replace only station helper with dedicated operational helper |
| create_station_condition | C | Unchanged |
| rectify_station_condition | C | Unchanged |

Policies: all five Shift read policies and Shutdown owned-or-scoped SELECT move to operational scope. Ownership predicates remain.
Application: useStations -> api.getMyAccessibleStationIds -> global helper stays broad for Dashboard/Analytics. Shift/Shutdown/report station selectors share that context, but their server contracts enforce narrow access. Direct logbook/interruption report reads move to scoped views. Other report RPCs retain signatures and formulas.
New Timeline/Summary/scope options and Condition SELECT already use dedicated operational scope and remain unchanged.
Administrative operator-activity/notification-delivery reports retain ADMIN/SUPER_ADMIN gates; FIELD_OFFICER gains no access. Notification creation/delivery is unchanged.

## Applied and verified

DEV only, in order: 20260914000250_separate_restricted_station_scope, then unchanged pending 20260914000300_restore_global_field_officer_scope. Both registered in migration history.

Post-apply definition comparison: 26 functions changed by EXACT helper-name substitution only; 17 original dependencies unchanged. Six policies retain their original predicates with only the helper substituted. The dedicated operational helper was not modified.

PASS: final synthetic broad Dashboard/Analytics vs narrow Operational/Shift/Reports/Shutdown tests; existing Shutdown security suite; operational foundation and scope suites; Condition lifecycle; Shift duty start/retry/end; typecheck; build; git diff --check. Build retains existing chunk-size advisory.

No page layouts, formulas, notification processing, or Stage 4 UI changed. Shared app station selectors still obtain global station metadata; restricted server contracts enforce their separate scope. Two report detail API methods now read server-scoped views.

Earlier real browser offline replay and Android checks remain outstanding from Stage 3.5A; they were not part of this database scope reconciliation.
