import { getHandoverAccountability, type HandoverAccountability } from './handoverAccountability';
// Decoupled API service.
//
// All database interactions go through this module.
//
// Read path:
// localStorage cache first when offline,
// otherwise network then cache.
//
// Write path:
// network when online;
// offline writes are queued and flushed later.

import {
  REST_HEADERS,
  REST_URL,
  supabase,
} from './supabase';

import {
  clearCache,
  completeQueuedInterruptionAdd,
  dequeueOp,
  dequeueOps,
  enqueueOp,
  enqueueInterruptionAdd,
  enqueueInterruptionRestore,
  enqueueOrConsolidateLogBookOp,
  getQueuedOp,
  getQueue,
  isOnline,
  recordSuccessfulQueueSync,
  readCache,
  updateQueuedOp,
  updateQueuedInterruptionAddEtr,
  writeCache,
  type QueuedOp,
  type EnqueueOpInput,
  type SyncFailureCategory,
} from './offline';

import type {
  Feeder,
  Interruption,
  LogBookEntry,
  NewLogBookEntry,
  NewOverloadAlert,
  NewReliabilityIndex,
  NotificationClass,
  OverloadAlert,
  OperationalEntryMode,
  PeakLoadReading,
  PushToken,
  ReliabilityIndex,
  Station,
} from '@/types';
import type { StationCondition } from '@/types/operational';
import type { AppRole } from '@/security/permissions';
import { recordStorageFailure, recordSyncCompleted, recordSyncStarted } from './diagnostics';
import { isQueueSyncAuthorized } from './syncAuthorization';
import { stationConditionCreateArgs } from './operationalApi';
import { conditionInput } from './stationConditionOffline';
import {
  OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE,
  OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE,
  mapOperationalWriteError,
  offlineOperationalAuthorizationFailure,
  operationalWriteDiagnostic,
} from './operationalWriteErrors';
export type { AppRole } from '@/security/permissions';

export type MyProfile = {
  full_name: string;
  employee_code: string | null;
  phone: string | null;
  account_role: string;
  account_active: boolean;
  assigned_offices: string[];
  accessible_stations: string[];
};

export type DesktopIdentity = {
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  account_role: string;
  assigned_offices: string[];
  accessible_station_count: number;
};

export type NotificationDevice = {
  id: string;
  platform: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export type ParameterAlert = {
  id: string;
  station_id: string;
  feeder_id: string;
  feeder_name: string | null;
  parameter_code: string;
  actual_value: number;
  min_value: number | null;
  max_value: number | null;
  breach_type: 'BELOW_MIN' | 'ABOVE_MAX';
  triggered_at: string;
  notification_class: NotificationClass | null;
  source_entry_mode: OperationalEntryMode | null;
  source_recorded_at: string | null;
  source_synced_at: string | null;
  is_current: boolean;
  notification_suppressed: boolean;
};

export type StationShiftStatus = 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type ShiftDutyStatus = 'ON_DUTY' | 'ENDED';
export type ShiftRole = 'MEMBER' | 'IN_CHARGE';
export type ShiftHandoverStatus = 'DRAFT' | 'PROVISIONAL' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
export type ShiftHandoverSourceType = 'INTERRUPTION' | 'PARAMETER_ALERT' | 'LOGBOOK_ENTRY' | 'OPERATIONAL_NOTE';
export type EqualOperatorHandoverEntryPhase = 'DRAFT' | 'INITIAL' | 'AMENDMENT';
export type EqualOperatorHandoverEntryKind = 'COMMENT' | 'SOURCE_REFERENCE';
export type ShiftDutyHandoverSide = 'OUTGOING' | 'INCOMING';
export type ShiftDutyHandoverIndividualState =
  | 'SUBMITTED_AND_ENDED'
  | 'ENDED_LINKED_TO_SUBMITTED_HANDOVER'
  | 'ACCEPTED_AND_STARTED'
  | 'STARTED_WITHOUT_HANDOVER'
  | 'LATE_HANDOVER_REVIEW_REQUIRED'
  | 'LATE_HANDOVER_ACCEPTED';

export type StationShift = {
  id: string;
  station_id: string;
  shift_date: string;
  shift_name: string;
  scheduled_start: string;
  scheduled_end: string;
  status: StationShiftStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftDutySession = {
  id: string;
  shift_id: string;
  station_id: string;
  user_id: string;
  shift_role: ShiftRole;
  started_at: string;
  ended_at: string | null;
  status: ShiftDutyStatus;
  created_at: string;
  updated_at: string;
};

export type ShiftHandoverUnattendedState = {
  handover_id: string;
  incoming_shift_id: string;
  released_at: string;
  status: 'OPEN' | 'CLOSED';
};

export type ShiftRosterAssignment = {
  id: string;
  shift_id: string;
  user_id: string;
  full_name: string;
  duty_role: ShiftRole;
  created_at: string;
};

export type ShiftRosterAssignmentInput = {
  userId: string;
  dutyRole: ShiftRole;
};

export type StationShiftScheduleInput = {
  id?: string | null;
  stationId: string;
  shiftDate: string;
  shiftName: string;
  scheduledStart: string;
  scheduledEnd: string;
};

export type StationShiftPatternRepeatResult = {
  outcome: 'CREATED' | 'SKIPPED';
  seed_shift_id: string;
  shift_id: string | null;
  shift_name: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  skipped_reason: string | null;
  omitted_roster_count: number;
};

export type ShiftHandover = {
  accountability?: HandoverAccountability;
  id: string;
  station_id: string;
  outgoing_shift_id: string;
  incoming_shift_id: string;
  status: ShiftHandoverStatus;
  prepared_by_user_id: string | null;
  submitted_by_user_id: string | null;
  submitted_at: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  outgoing_notes: string | null;
  acceptance_comments: string | null;
  snapshot: Record<string, unknown> | null;
  workflow_version: number;
  row_version: number;
  submitted_duty_session_id: string | null;
  team_accepted_duty_session_id: string | null;
  initial_finalized_at: string | null;
  provisional_at?: string | null;
  provisional_by_user_id?: string | null;
  final_released_at?: string | null;
  final_released_by_user_id?: string | null;
  first_incoming_duty_started_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type EqualOperatorHandoverEntry = {
  id: string;
  handover_id: string;
  author_user_id: string;
  client_entry_id: string | null;
  entry_kind: EqualOperatorHandoverEntryKind;
  phase: EqualOperatorHandoverEntryPhase;
  source_type: ShiftHandoverSourceType | null;
  source_id: string | null;
  body: string | null;
  priority: ShiftHandoverItem['priority'];
  replaces_entry_id: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftDutyHandoverState = {
  id: string;
  duty_session_id: string;
  handover_id: string | null;
  shift_id: string;
  station_id: string;
  user_id: string;
  side: ShiftDutyHandoverSide;
  state: ShiftDutyHandoverIndividualState;
  no_handover_acknowledged_at: string | null;
  accepted_at: string | null;
  ended_at: string | null;
  acceptance_comments: string | null;
  late_notification_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftHandoverAuditEvent = {
  id: string;
  handover_id: string | null;
  station_id: string;
  shift_id: string | null;
  duty_session_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
  occurred_at: string;
};

export type EqualOperatorHandoverTransition = {
  handover: ShiftHandover | null;
  duty_session: ShiftDutySession;
  individual_state: ShiftDutyHandoverState;
  official_submission?: boolean;
  provisional?: boolean;
  team_first_acceptance?: boolean;
  existing_duty_session?: boolean;
};

export type DutyEndWithoutHandoverResult = {
  duty_session: ShiftDutySession;
  reason: 'NO_NEXT_SHIFT_SCHEDULED';
  note: string | null;
};

export type EqualOperatorHandoverDetail = {
  handover: ShiftHandover;
  entries: EqualOperatorHandoverEntry[];
  individual_states: ShiftDutyHandoverState[];
  audit_events: ShiftHandoverAuditEvent[];
};

export type ShiftHandoverAcceptanceOversightRow = {
  handover_id: string;
  station_id: string;
  station_name: string;
  outgoing_shift_id: string;
  outgoing_shift_name: string;
  incoming_shift_id: string;
  incoming_shift_name: string;
  team_status: ShiftHandoverStatus;
  operator_id: string;
  operator_name: string;
  duty_session_id: string | null;
  duty_started_at: string | null;
  duty_ended_at: string | null;
  individual_state: ShiftDutyHandoverIndividualState | null;
  individually_accepted_at: string | null;
  acceptance_comments: string | null;
  attention_state: 'ACCEPTED' | 'LATE_PENDING' | 'MISSED' | 'PENDING' | 'STARTED_WITHOUT_HANDOVER' | 'NOT_STARTED';
};

export type ShiftHandoverItem = {
  id: string;
  handover_id: string;
  source_type: ShiftHandoverSourceType;
  source_id: string | null;
  description: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  created_by: string | null;
  created_at: string;
};

export type ShiftHandoverDraftItemInput = {
  source_type: ShiftHandoverSourceType;
  source_id?: string | null;
  description?: string | null;
  priority?: ShiftHandoverItem['priority'];
};

export type ShiftComplianceRosterMember = {
  user_id: string;
  full_name: string;
  duty_role: ShiftRole;
  created_at: string;
};

export type ShiftComplianceDutyParticipant = {
  id: string;
  user_id: string;
  full_name: string;
  shift_role: ShiftRole;
  started_at: string;
  ended_at: string | null;
  status: ShiftDutyStatus;
};

export type ShiftComplianceHandover = {
  accountability?: HandoverAccountability;
  id: string;
  status: ShiftHandoverStatus;
  incoming_shift_id: string;
  submitted_by_user_id: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  accepted_by_user_id: string | null;
  accepted_by_name: string | null;
  accepted_at: string | null;
  outgoing_notes: string | null;
};

export type ShiftComplianceRow = Omit<StationShift, 'created_at' | 'updated_at'> & {
  roster: ShiftComplianceRosterMember[];
  duty_sessions: ShiftComplianceDutyParticipant[];
  handover: ShiftComplianceHandover | null;
};
export type OperatorDutyReportRow = {
  id: string; station_id: string; station_name: string; shift_date: string; shift_name: string;
  scheduled_start: string; scheduled_end: string; status: StationShiftStatus; user_id: string;
  operator_name: string; duty_role: ShiftRole; duty_state: 'OVER' | 'CURRENT' | 'UPCOMING';
};

export type OrgUnitType = { unit_type: string; hierarchy_rank: number };
export type OrgUnitRow = { id: string; code: string; name: string; unit_type: string; parent_id: string | null; parent_name: string | null; active: boolean; archived_at: string | null; child_count: number; station_count: number };
export type OrgUnitPage = { rows: OrgUnitRow[]; total: number };
export type OrgUnitDetail = OrgUnitRow & { archive_reason: string | null; child_names: string[]; station_names: string[] };
export type OrgUnitParentOption = { id: string; name: string; unit_type: string };
export type AdminStationRow = { id: string; code: string; name: string; location: string | null; voltage_level_kv: number | null; active: boolean; office_count: number; feeder_count: number };
export type AdminStationDetail = AdminStationRow & { archive_reason: string | null; office_ids: string[]; office_names: string[]; primary_office_id: string | null; authorised_users: string[] };
export type AdminFeederRow = { id: string; code: string; name: string; station_id: string; station_name: string; voltage_level_kv: number | null; consumer_count: number; active: boolean };
export type AdminFeederDetail = AdminFeederRow & { archive_reason: string | null; logbook_count: number; interruption_count: number };
export type UsersAccessRow = { id: string; full_name: string; employee_code: string | null; email: string | null; phone: string | null; role: AppRole; active: boolean; office_names: string[]; station_names: string[]; device_count: number; created_at: string; updated_at: string };
export type UsersAccessDetail = UsersAccessRow & { office_ids: string[]; station_ids: string[] };
export type UsersAccessScopeOption = { kind: 'OFFICE' | 'STATION'; id: string; name: string; code: string };
export type FeederThresholdRow = { id: string; station_id: string; station_name: string; feeder_id: string; feeder_name: string; parameter_code: string; min_value: number | null; max_value: number | null; feeder_active: boolean; updated_at: string; updated_by_name: string | null };
export type ThresholdScopeOption = { kind: 'STATION' | 'FEEDER'; id: string; name: string; station_id: string; station_name: string };
export type GlobalNotificationConfig = { id: string; active: boolean; max_unit_type: string; updated_at: string; updated_by_name: string | null };
export type AdministrationAuditRow = { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; record_label: string; actor_id: string | null; actor_name: string | null; actor_employee_code: string | null; station_id: string | null; station_name: string | null; org_unit_id: string | null; org_unit_name: string | null; visibility: 'SCOPED' | 'ADMIN_GLOBAL' | 'SUPER_ADMIN_ONLY'; reason: string | null; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null };
export type AdministrationAuditFilterOption = { kind: 'ACTOR' | 'STATION' | 'OFFICE'; id: string; label: string };

/* =========================================================
   APPLICATION ROLE
========================================================= */

type LoadEnergyAnalysisReading = {
  id: string;
  station_id: string;
  feeder_id: string | null;
  operator_id: string | null;
  actual_event_time: string;
  mw: number | null;
  mvar: number | null;
  voltage_kv: number | null;
  current_a: number | null;
  power_factor: number | null;
  frequency_hz: number | null;
  transformer_temp_c: number | null;
  oil_level_percent: number | null;
  tap_position: number | null;
  weather: string | null;
  remarks: string | null;
  updated_at: string;
};

export type LogBookReportSummary = {
  entered_readings: number;
  expected_readings: number;
  completeness_percent: number;
  feeders_reported: number;
  missing_feeder_hours: number;
};

export type LogBookReportPage = {
  rows: LogBookEntry[];
  total: number;
};

export type InterruptionReportSummary = {
  total_interruptions: number;
  open_interruptions: number;
  total_duration_minutes: number;
  average_restoration_minutes: number | null;
  longest_interruption_minutes: number | null;
};

export type InterruptionReportTrendRow = {
  date: string;
  interruption_count: number;
  duration_minutes: number;
  open_count: number;
};

export type InterruptionReportBreakdownRow = {
  label: string;
  interruption_count: number;
  duration_minutes: number;
};

export type InterruptionReportPage = {
  rows: Interruption[];
  total: number;
};

export type LoadEnergyReportSummary = {
  peak_mw: number | null;
  peak_time: string | null;
  minimum_mw: number | null;
  minimum_time: string | null;
  average_mw: number | null;
  estimated_energy_mwh: number | null;
  energy_eligible: boolean;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadEnergyReportSeriesRow = {
  bucket_start: string;
  peak_mw: number | null;
  minimum_mw: number | null;
  average_mw: number | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessReportSummary = {
  expected_feeder_hours: number;
  entered_feeder_hours: number;
  completeness_percent: number;
  stations_below_threshold: number;
  feeders_below_threshold: number;
};

export type DataCompletenessReportBreakdownRow = {
  id: string;
  name: string;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessReportTrendRow = {
  date: string;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY';
};

export type DataCompletenessMissingRow = {
  date: string;
  hour: number;
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  status: 'MISSING';
};

export type DataCompletenessMissingPage = {
  rows: DataCompletenessMissingRow[];
  total: number;
};

export type ParameterExceptionReportSummary = {
  total_exceptions: number;
  active_exceptions: number;
  affected_stations: number;
  affected_feeders: number;
  most_frequent_parameter: string | null;
};

export type ParameterExceptionBreakdownRow = {
  parameter_code: string;
  exception_count: number;
  affected_feeders: number;
};

export type ParameterExceptionDetailRow = {
  id: string;
  triggered_at: string;
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  parameter_code: string;
  actual_value: number;
  min_value: number | null;
  max_value: number | null;
  breach_type: 'BELOW_MIN' | 'ABOVE_MAX';
  deviation: number;
  status: 'ACTIVE';
};

export type ParameterExceptionDetailPage = {
  rows: ParameterExceptionDetailRow[];
  total: number;
};

export type PerformanceReportMetric = 'PEAK_MW' | 'AVERAGE_MW' | 'MIN_PF' | 'INTERRUPTIONS' | 'EXCEPTIONS' | 'COMPLETENESS';
export type PerformanceReportEntity = 'STATION' | 'FEEDER';
export type PerformanceReportSummary = {
  entity_count: number; peak_mw: number | null; average_mw: number | null; minimum_power_factor: number | null;
  interruption_count: number; interruption_duration_minutes: number; exception_count: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number; feeders_reporting: number;
};
export type PerformanceReportRow = {
  entity_id: string; entity_name: string; peak_mw: number | null; average_mw: number | null; minimum_power_factor: number | null;
  interruption_count: number; interruption_duration_minutes: number; exception_count: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number; feeders_reporting: number;
};
export type PerformanceReportPage = { rows: PerformanceReportRow[]; total: number };
export type PerformanceReportRankingRow = { entity_id: string; entity_name: string; metric_value: number | null };

export type ExecutiveSummaryReport = {
  peak_mw: number | null; peak_time: string | null; average_mw: number | null;
  minimum_voltage_kv: number | null; minimum_voltage_time: string | null;
  open_interruptions: number; total_interruptions: number; total_interruption_duration_minutes: number;
  active_parameter_exceptions: number; total_parameter_exceptions: number;
  entered_feeder_hours: number; expected_feeder_hours: number; completeness_percent: number;
  stations_reporting: number; total_stations: number; feeders_reporting: number; total_feeders: number;
};
export type ExecutiveSummaryAttentionRow = {
  id: string; entity_type: 'STATION' | 'FEEDER'; entity_name: string; issue_type: 'OPEN_INTERRUPTION' | 'PARAMETER_EXCEPTION' | 'LOW_COMPLETENESS';
  issue_count: number; completeness_percent: number | null;
};

export type OperatorActivityReportSummary = { entries_created: number; rows_subsequently_updated: number; missing_expected_entries: number; operators_active: number; stations_active: number };
export type OperatorActivityReportRow = { id: string; operator_id: string | null; station_name: string; feeder_name: string | null; actual_event_time: string; created_at: string; updated_at: string; activity_state: 'CREATED' | 'UPDATED' };
export type OperatorActivityReportPage = { rows: OperatorActivityReportRow[]; total: number };
export type NotificationDeliveryReportSummary = { events: number; intended_recipients: number; sent: number; failed: number; pending: number };
export type NotificationDeliveryReportRow = { id: string; event_time: string; source: string; station_name: string; intended_recipients: number; sent: number; failed: number; pending: number; delivery_message: string | null };
export type NotificationDeliveryReportPage = { rows: NotificationDeliveryReportRow[]; total: number };

function mapCompletenessStatus(value: unknown): 'FULL' | 'PARTIAL' | 'EMPTY' {
  return value === 'FULL' || value === 'PARTIAL' ? value : 'EMPTY';
}

function mapDataCompletenessBreakdown(rows: Record<string, unknown>[]): DataCompletenessReportBreakdownRow[] {
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name ?? 'Not recorded'),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0), fill_status: mapCompletenessStatus(row.fill_status),
  }));
}

function mapPerformanceReportRow(row: Record<string, unknown>): PerformanceReportRow {
  return {
    entity_id: String(row.entity_id), entity_name: String(row.entity_name),
    peak_mw: row.peak_mw === null || row.peak_mw === undefined ? null : Number(row.peak_mw),
    average_mw: row.average_mw === null || row.average_mw === undefined ? null : Number(row.average_mw),
    minimum_power_factor: row.minimum_power_factor === null || row.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor),
    interruption_count: Number(row.interruption_count ?? 0), interruption_duration_minutes: Number(row.interruption_duration_minutes ?? 0),
    exception_count: Number(row.exception_count ?? 0), entered_feeder_hours: Number(row.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row.expected_feeder_hours ?? 0), completeness_percent: Number(row.completeness_percent ?? 0), feeders_reporting: Number(row.feeders_reporting ?? 0),
  };
}

/* =========================================================
   INTERRUPTION TYPES
========================================================= */

export type InterruptionStatus =
  | 'OPEN'
  | 'RESTORED'
  | 'CANCELLED';

export type NewInterruptionPayload = {
  station_id: string;
  feeder_id: string;
  operator_id: string | null;

  interruption_start: string;
  interruption_end?: string | null;

  cause?: string | null;
  remarks?: string | null;

  current_status?:
    | 'OPEN'
    | 'RESTORED'
    | 'CANCELLED';

  duration_minutes?: number | null;
  etr?: string | null;

  entry_mode?: OperationalEntryMode | null;
  recorded_at?: string | null;
  synced_at?: string | null;
  client_operation_id?: string | null;
  restore_client_operation_id?: string | null;
};

/* =========================================================
   RPC RESULT TYPES
========================================================= */
export interface ShiftHandoverReportRow {
  id: string;
  station_id: string;
  outgoing_shift_id: string;
  incoming_shift_id: string;
  outgoing_shift_date: string;
  incoming_shift_date: string;
  outgoing_notes: string | null;
  acceptance_comments: string | null;
  created_at: string;
  updated_at: string;

  // Added from get_shift_handover_accountability()
  status: string;
  outgoing_shift_name: string;
  incoming_shift_name: string;
  outgoing_in_charge_name: string | null;
  incoming_in_charge_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  accepted_by_name: string | null;
  accepted_at: string | null;
  workflow_version: number;
  station_name: string;
  late_handover_submission_time: string | null;
  entries: ShiftHandoverReportEntry[];
  outgoing_operators: ShiftHandoverReportOperator[];
  incoming_operators: ShiftHandoverReportOperator[];
  audit_events: ShiftHandoverReportAuditEvent[];
}

export interface ShiftHandoverReportEntry {
  id: string;
  phase: EqualOperatorHandoverEntryPhase;
  entry_kind: EqualOperatorHandoverEntryKind;
  source_type: ShiftHandoverSourceType | null;
  source_id: string | null;
  body: string | null;
  priority: ShiftHandoverItem['priority'];
  author_user_id: string;
  author_name: string;
  replaces_entry_id: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
}

export interface ShiftHandoverReportOperator {
  user_id: string;
  operator_name: string;
  rostered: boolean;
  duty_session_id: string | null;
  duty_started_at: string | null;
  duty_ended_at: string | null;
  still_on_duty: boolean;
  individual_state: ShiftDutyHandoverIndividualState | null;
  individual_ended_at?: string | null;
  accepted_at?: string | null;
  no_handover_acknowledged_at?: string | null;
  acceptance_comments?: string | null;
  attention_state: string;
  duty_end_blocked?: boolean;
}

export interface ShiftHandoverReportAuditEvent {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  duty_session_id: string | null;
  occurred_at: string;
  details: Record<string, unknown>;
}




type MonthStatusRpcRow = {
  entry_date: string;

  entered_slots:
    number | string;

  expected_slots:
    number | string;

  fill_status:
    string;
};

type HourStatusRpcRow = {
  hour_no:
    number | string;

  entered_feeders:
    number | string;

  total_feeders:
    number | string;

  fill_status:
    string;
};

/* =========================================================
   LOAD TREND TYPE
========================================================= */

export type StationLoadTrendRow = {
  station_id: string;

  feeder_id:
    string | null;

  actual_event_time:
    string;

  mw:
    number | null;
};

export type LoadAnalysisDailyTrendRow = {
  trend_date: string;

  peak_time:
    string | null;

  peak_mw:
    number | null;

  entered_feeders:
    number;

  expected_feeders:
    number;

  fill_status:
    "FULL" |
    "PARTIAL" |
    "EMPTY";
};

export type LoadAnalysisOverviewRow = {
  peak_mw: number | null;
  peak_time: string | null;
  minimum_voltage_kv: number | null;
  minimum_voltage_time: string | null;
  maximum_current_a: number | null;
  maximum_current_time: string | null;
  minimum_power_factor: number | null;
  minimum_power_factor_time: string | null;
  maximum_transformer_temp_c: number | null;
  maximum_transformer_temp_time: string | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadAnalysisRankingRow = {
  id: string;
  name: string;
  peak_mw: number | null;
  minimum_voltage_kv: number | null;
  maximum_current_a: number | null;
  minimum_power_factor: number | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
};

export type LoadAnalysisParameterHealthRow = {
  low_pf_feeder_count: number;
  incomplete_feeder_count: number;
  minimum_voltage_kv: number | null;
  maximum_current_a: number | null;
  maximum_transformer_temp_c: number | null;
  completeness_percent: number;
};

export type LoadAnalysisFeederDailyProfileRow = {
  profile_date: string;
  value: number;
  source_time: string;
};

export type ParameterHealthDetailMetric =
  | 'LOW_PF'
  | 'INCOMPLETE_LOGBOOK'
  | 'MIN_VOLTAGE'
  | 'MAX_CURRENT'
  | 'MAX_TRANSFORMER_TEMP';

export type LoadAnalysisParameterHealthDetailRow = {
  station_id: string;
  station_name: string;
  feeder_id: string;
  feeder_name: string;
  metric_value: number | null;
  occurred_at: string | null;
  entered_hours: number | null;
  expected_hours: number | null;
  missing_hours: number | null;
  completeness_percent: number | null;
};

export type DashboardOperationalSummary = {
  peak_mw: number | null;
  peak_time: string | null;
  entered_feeder_hours: number;
  expected_feeder_hours: number;
  completeness_percent: number;
  stations_reporting: number;
  total_stations: number;
  feeders_reporting: number;
  total_feeders: number;
  open_interruptions: number;
  interruption_stations: number;
  active_parameter_alerts: number;
  alert_feeders: number;
};

export type DashboardTodayLoadTrendRow = {
  hour_no: number;
  hour_time: string;
  total_mw: number | null;
  entered_feeders: number;
  expected_feeders: number;
  fill_status: 'FULL' | 'PARTIAL' | 'EMPTY' | 'FUTURE';
};

export type DashboardAttentionItem = {
  issue_type: 'INTERRUPTION' | 'PARAMETER_ALERT' | 'COMPLETENESS';
  station_id: string;
  station_name: string;
  issue_count: number;
  completeness_percent: number | null;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
};

/* =========================================================
   LOW LEVEL HELPERS
========================================================= */

async function getAuthHeaders() {
  const {
    data: {
      session,
    },
  } =
    await supabase.auth.getSession();

  return {
    ...REST_HEADERS,

    ...(session?.access_token
      ? {
          Authorization:
            `Bearer ${session.access_token}`,
        }
      : {}),
  };
}

const OPERATIONAL_WRITE_TABLES = new Set(['log_book_entries', 'interruptions']);

async function restWriteFailure(response: Response, method: 'POST' | 'PATCH', table: string): Promise<unknown> {
  const responseText = await response.text();
  let body: PostgrestErrorBody | null = null;
  try {
    body = JSON.parse(responseText) as PostgrestErrorBody;
  } catch {
    // Preserve the existing non-JSON error handling below.
  }

  if (OPERATIONAL_WRITE_TABLES.has(table)) {
    const source = body ? { ...body, status: response.status } : { message: responseText, status: response.status };
    const mapped = mapOperationalWriteError(source, response.status);
    if (mapped !== source) return mapped;
  }

  return new Error(`${method} ${table} failed: ${response.status} ${responseText}`);
}

/* =========================================================
   REST GET
========================================================= */

async function restGet<T>(
  table: string,
  query: string,
  cacheKey: string
): Promise<T[]> {
  if (
    !isOnline()
  ) {
    const cached =
      readCache<T[]>(
        cacheKey
      );

    if (
      cached
    ) {
      return cached;
    }
  }

  const url =
    `${REST_URL}/${table}?${query}`;

  const headers =
    await getAuthHeaders();

  const res =
    await fetch(
      url,
      {
        headers,
        method:
          'GET',
      }
    );

  if (
    !res.ok
  ) {
    const errorText =
      await res.text();

    throw new Error(
      `GET ${table} failed: ${res.status} ${errorText}`
    );
  }

  const data =
    (await res.json()) as T[];

  writeCache(
    cacheKey,
    data
  );

  return data;
}

/* =========================================================
   REST PATCH
========================================================= */

async function restPatch<T>(
  table: string,
  filter:
    Record<
      string,
      string
    >,
  body: unknown,
  cacheKey: string,
  queueMetadata?: Partial<Pick<EnqueueOpInput, 'operationType' | 'eventTime' | 'recordedAt' | 'entryMode' | 'localEntityId' | 'serverEntityId' | 'dependsOn'>>
): Promise<T> {
  if (
    !isOnline()
  ) {
    const enqueue = table === 'log_book_entries' ? enqueueOrConsolidateLogBookOp : enqueueOp;
    await enqueue({
      method:
        'PATCH',

      table,

      filter,

      body,

      ownerUserId: await getQueueOwnerUserId(),

      ...queueMetadata,
    });

    return body as T;
  }

  const qs =
    Object.entries(
      filter
    )
      .map(
        ([
          key,
          value,
        ]) =>
          `${key}=eq.${encodeURIComponent(
            value
          )}`
      )
      .join(
        '&'
      );

  const headers =
    await getAuthHeaders();

  const url =
    `${REST_URL}/${table}?${qs}`;

  const res =
    await fetch(
      url,
      {
        method:
          'PATCH',

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (
    !res.ok
  ) {
    throw await restWriteFailure(res, 'PATCH', table);
  }

  const rows =
    (await res.json()) as T[];

  /*
   * Supabase may return HTTP 200 with []
   * when RLS prevents the row from being updated.
   */

  if (
    !Array.isArray(
      rows
    ) ||
    rows.length ===
      0
  ) {
    if (OPERATIONAL_WRITE_TABLES.has(table)) {
      throw new Error('The operational record could not be updated. Refresh and try again.');
    }
    throw new Error(`PATCH ${table} succeeded but no row was updated.`);
  }

  clearCache(
    cacheKey
  );

  return rows[0];
}

/* =========================================================
   REST POST
========================================================= */

async function restPost<T>(
  table: string,
  body: unknown,
  cacheKey: string,
  queueMetadata?: Partial<Pick<EnqueueOpInput, 'operationType' | 'eventTime' | 'recordedAt' | 'entryMode' | 'localEntityId' | 'serverEntityId' | 'dependsOn'>>
): Promise<T> {
  if (
    !isOnline()
  ) {
    const enqueue = table === 'log_book_entries' ? enqueueOrConsolidateLogBookOp : enqueueOp;
    await enqueue({
      method:
        'POST',

      table,

      body,

      ownerUserId: await getQueueOwnerUserId(),

      ...queueMetadata,
    });

    return body as T;
  }

  const headers =
    await getAuthHeaders();

  const res =
    await fetch(
      `${REST_URL}/${table}`,
      {
        method:
          'POST',

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (
    !res.ok
  ) {
    throw await restWriteFailure(res, 'POST', table);
  }

  const arr =
    (await res.json()) as T[];

  if (
    !Array.isArray(
      arr
    ) ||
    arr.length ===
      0
  ) {
    throw new Error(
      `POST ${table} succeeded but no row was returned.`
    );
  }

  clearCache(
    cacheKey
  );

  return arr[0];
}

/* =========================================================
   PUBLIC API
========================================================= */

function mapStationShift(row: Record<string, unknown>): StationShift {
  return {
    id: String(row.id), station_id: String(row.station_id), shift_date: String(row.shift_date),
    shift_name: String(row.shift_name), scheduled_start: String(row.scheduled_start), scheduled_end: String(row.scheduled_end),
    status: String(row.status) as StationShiftStatus, created_by: row.created_by == null ? null : String(row.created_by),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapShiftDutySession(row: Record<string, unknown>): ShiftDutySession {
  return {
    id: String(row.id), shift_id: String(row.shift_id), station_id: String(row.station_id), user_id: String(row.user_id),
    shift_role: String(row.shift_role) as ShiftRole, started_at: String(row.started_at), ended_at: row.ended_at == null ? null : String(row.ended_at),
    status: String(row.status) as ShiftDutyStatus, created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapShiftRosterAssignment(row: Record<string, unknown>): ShiftRosterAssignment {
  return {
    id: String(row.id), shift_id: String(row.shift_id), user_id: String(row.user_id),
    full_name: String(row.full_name), duty_role: String(row.duty_role) as ShiftRole,
    created_at: String(row.created_at),
  };
}

function mapShiftHandover(row: Record<string, unknown>): ShiftHandover {
  return {
    id: String(row.id), station_id: String(row.station_id), outgoing_shift_id: String(row.outgoing_shift_id), incoming_shift_id: String(row.incoming_shift_id),
    status: String(row.status) as ShiftHandoverStatus,
    prepared_by_user_id: row.prepared_by_user_id == null ? null : String(row.prepared_by_user_id),
    submitted_by_user_id: row.submitted_by_user_id == null ? null : String(row.submitted_by_user_id),
    submitted_at: row.submitted_at == null ? null : String(row.submitted_at),
    accepted_by_user_id: row.accepted_by_user_id == null ? null : String(row.accepted_by_user_id),
    accepted_at: row.accepted_at == null ? null : String(row.accepted_at),
    outgoing_notes: row.outgoing_notes == null ? null : String(row.outgoing_notes),
    acceptance_comments: row.acceptance_comments == null ? null : String(row.acceptance_comments),
    snapshot: row.snapshot && typeof row.snapshot === 'object' && !Array.isArray(row.snapshot) ? row.snapshot as Record<string, unknown> : null,
    workflow_version: Number(row.workflow_version ?? 1), row_version: Number(row.row_version ?? 1),
    submitted_duty_session_id: row.submitted_duty_session_id == null ? null : String(row.submitted_duty_session_id),
    team_accepted_duty_session_id: row.team_accepted_duty_session_id == null ? null : String(row.team_accepted_duty_session_id),
    initial_finalized_at: row.initial_finalized_at == null ? null : String(row.initial_finalized_at),
    provisional_at: row.provisional_at == null ? null : String(row.provisional_at),
    provisional_by_user_id: row.provisional_by_user_id == null ? null : String(row.provisional_by_user_id),
    final_released_at: row.final_released_at == null ? null : String(row.final_released_at),
    final_released_by_user_id: row.final_released_by_user_id == null ? null : String(row.final_released_by_user_id),
    first_incoming_duty_started_at: row.first_incoming_duty_started_at == null ? null : String(row.first_incoming_duty_started_at),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapEqualOperatorHandoverEntry(row: Record<string, unknown>): EqualOperatorHandoverEntry {
  return {
    id: String(row.id), handover_id: String(row.handover_id), author_user_id: String(row.author_user_id),
    client_entry_id: row.client_entry_id == null ? null : String(row.client_entry_id),
    entry_kind: String(row.entry_kind) as EqualOperatorHandoverEntryKind,
    phase: String(row.phase) as EqualOperatorHandoverEntryPhase,
    source_type: row.source_type == null ? null : String(row.source_type) as ShiftHandoverSourceType,
    source_id: row.source_id == null ? null : String(row.source_id), body: row.body == null ? null : String(row.body),
    priority: row.priority == null ? null : String(row.priority) as ShiftHandoverItem['priority'],
    replaces_entry_id: row.replaces_entry_id == null ? null : String(row.replaces_entry_id),
    finalized_at: row.finalized_at == null ? null : String(row.finalized_at),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapShiftDutyHandoverState(row: Record<string, unknown>): ShiftDutyHandoverState {
  return {
    id: String(row.id), duty_session_id: String(row.duty_session_id),
    handover_id: row.handover_id == null ? null : String(row.handover_id),
    shift_id: String(row.shift_id), station_id: String(row.station_id), user_id: String(row.user_id),
    side: String(row.side) as ShiftDutyHandoverSide, state: String(row.state) as ShiftDutyHandoverIndividualState,
    no_handover_acknowledged_at: row.no_handover_acknowledged_at == null ? null : String(row.no_handover_acknowledged_at),
    accepted_at: row.accepted_at == null ? null : String(row.accepted_at),
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    acceptance_comments: row.acceptance_comments == null ? null : String(row.acceptance_comments),
    late_notification_event_id: row.late_notification_event_id == null ? null : String(row.late_notification_event_id),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapReportOperator(row: Record<string, unknown>): ShiftHandoverReportOperator {
  return {
    user_id: String(row.user_id), operator_name: String(row.operator_name ?? 'Operator'),
    rostered: Boolean(row.rostered), duty_session_id: row.duty_session_id == null ? null : String(row.duty_session_id),
    duty_started_at: row.duty_started_at == null ? null : String(row.duty_started_at),
    duty_ended_at: row.duty_ended_at == null ? null : String(row.duty_ended_at),
    still_on_duty: Boolean(row.still_on_duty),
    individual_state: row.individual_state == null ? null : String(row.individual_state) as ShiftDutyHandoverIndividualState,
    individual_ended_at: row.individual_ended_at == null ? null : String(row.individual_ended_at),
    accepted_at: row.accepted_at == null ? null : String(row.accepted_at),
    no_handover_acknowledged_at: row.no_handover_acknowledged_at == null ? null : String(row.no_handover_acknowledged_at),
    acceptance_comments: row.acceptance_comments == null ? null : String(row.acceptance_comments),
    attention_state: String(row.attention_state ?? 'UNKNOWN'),
    duty_end_blocked: Boolean(row.duty_end_blocked),
  };
}

function mapShiftHandoverAuditEvent(row: Record<string, unknown>): ShiftHandoverAuditEvent {
  return {
    id: String(row.id), handover_id: row.handover_id == null ? null : String(row.handover_id),
    station_id: String(row.station_id), shift_id: row.shift_id == null ? null : String(row.shift_id),
    duty_session_id: row.duty_session_id == null ? null : String(row.duty_session_id),
    actor_user_id: row.actor_user_id == null ? null : String(row.actor_user_id), event_type: String(row.event_type),
    details: row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details as Record<string, unknown> : {},
    occurred_at: String(row.occurred_at),
  };
}

function mapEqualOperatorTransition(value: unknown): EqualOperatorHandoverTransition {
  const row = value as Record<string, unknown>;
  const handover = row.handover && typeof row.handover === 'object' && !Array.isArray(row.handover)
    ? mapShiftHandover(row.handover as Record<string, unknown>) : null;
  return {
    handover,
    duty_session: mapShiftDutySession(row.duty_session as Record<string, unknown>),
    individual_state: mapShiftDutyHandoverState(row.individual_state as Record<string, unknown>),
    ...(row.official_submission == null ? {} : { official_submission: Boolean(row.official_submission) }),
    ...(row.provisional == null ? {} : { provisional: Boolean(row.provisional) }),
    ...(row.team_first_acceptance == null ? {} : { team_first_acceptance: Boolean(row.team_first_acceptance) }),
    ...(row.existing_duty_session == null ? {} : { existing_duty_session: Boolean(row.existing_duty_session) }),
  };
}

function mapShiftHandoverItem(row: Record<string, unknown>): ShiftHandoverItem {
  return {
    id: String(row.id), handover_id: String(row.handover_id), source_type: String(row.source_type) as ShiftHandoverSourceType,
    source_id: row.source_id == null ? null : String(row.source_id), description: row.description == null ? null : String(row.description),
    priority: row.priority == null ? null : String(row.priority) as ShiftHandoverItem['priority'],
    created_by: row.created_by == null ? null : String(row.created_by), created_at: String(row.created_at),
  };
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function mapShiftComplianceRow(row: Record<string, unknown>): ShiftComplianceRow {
  const handover = row.handover && typeof row.handover === 'object' && !Array.isArray(row.handover)
    ? row.handover as Record<string, unknown>
    : null;
  return {
    id: String(row.id), station_id: String(row.station_id), shift_date: String(row.shift_date),
    shift_name: String(row.shift_name), scheduled_start: String(row.scheduled_start), scheduled_end: String(row.scheduled_end),
    status: String(row.status) as StationShiftStatus, created_by: null,
    roster: rows(row.roster).map((item) => ({
      user_id: String(item.user_id), full_name: String(item.full_name), duty_role: String(item.duty_role) as ShiftRole, created_at: String(item.created_at),
    })),
    duty_sessions: rows(row.duty_sessions).map((item) => ({
      id: String(item.id), user_id: String(item.user_id), full_name: String(item.full_name), shift_role: String(item.shift_role) as ShiftRole,
      started_at: String(item.started_at), ended_at: item.ended_at == null ? null : String(item.ended_at), status: String(item.status) as ShiftDutyStatus,
    })),
    handover: handover ? {
      id: String(handover.id), status: String(handover.status) as ShiftHandoverStatus, incoming_shift_id: String(handover.incoming_shift_id),
      submitted_by_user_id: handover.submitted_by_user_id == null ? null : String(handover.submitted_by_user_id),
      submitted_by_name: handover.submitted_by_name == null ? null : String(handover.submitted_by_name),
      submitted_at: handover.submitted_at == null ? null : String(handover.submitted_at),
      accepted_by_user_id: handover.accepted_by_user_id == null ? null : String(handover.accepted_by_user_id),
      accepted_by_name: handover.accepted_by_name == null ? null : String(handover.accepted_by_name),
      accepted_at: handover.accepted_at == null ? null : String(handover.accepted_at),
      outgoing_notes: handover.outgoing_notes == null ? null : String(handover.outgoing_notes),
    } : null,
  };
}

export const api = {


  /* =======================================================
     CURRENT USER ROLE
  ======================================================= */

  async getMyRole():
    Promise<
      AppRole | null
    > {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_my_role'
      );

    if (
      error
    ) {
      console.error('The current application role could not be loaded.');

      throw error;
    }

    if (
      data ===
        'OPERATOR' ||
      data ===
        'FIELD_OFFICER' ||
      data ===
        'ADMIN' ||
      data ===
        'SUPER_ADMIN'
    ) {
      return data;
    }

    return null;
  },

  /* =======================================================
     SHIFT DUTY / HANDOVER / ROSTER
  ======================================================= */

  async startShiftDuty(shiftId: string, shiftRole: ShiftRole = 'MEMBER'): Promise<ShiftDutySession> {
    const { data, error } = await supabase.rpc('start_shift_duty', { p_shift_id: shiftId, p_shift_role: shiftRole });
    if (error) throw error;
    return mapShiftDutySession(data as unknown as Record<string, unknown>);
  },
  async recordShiftDutyWarningAcknowledgement(shiftId: string, decision: 'START_DUTY' | 'CONTINUE_WITHOUT_STARTING', reasonCode?: string, reasonText?: string): Promise<void> {
    const { error } = await supabase.rpc('record_shift_duty_warning_acknowledgement', { p_shift_id: shiftId, p_decision: decision, p_reason_code: reasonCode ?? null, p_reason_text: reasonText ?? null });
    if (error) throw error;
  },
  async recordShiftDutyException(shiftId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('record_shift_duty_exception', { p_shift_id: shiftId, p_reason: reason });
    if (error) throw error;
  },

  async endShiftDuty(dutySessionId: string): Promise<ShiftDutySession> {
    const { data, error } = await supabase.rpc('end_shift_duty', { p_duty_session_id: dutySessionId });
    if (error) throw error;
    return mapShiftDutySession(data as unknown as Record<string, unknown>);
  },

  async getOrCreateShiftHandover(outgoingShiftId: string, incomingShiftId: string): Promise<ShiftHandover> {
    const { data, error } = await supabase.rpc('get_or_create_shift_handover', { p_outgoing_shift_id: outgoingShiftId, p_incoming_shift_id: incomingShiftId });
    if (error) throw error;
    return mapShiftHandover(data as unknown as Record<string, unknown>);
  },

  async submitShiftHandover(handoverId: string, outgoingNotes: string | null): Promise<ShiftHandover> {
    const { data, error } = await supabase.rpc('submit_shift_handover', { p_handover_id: handoverId, p_outgoing_notes: outgoingNotes });
    if (error) throw error;
    return mapShiftHandover(data as unknown as Record<string, unknown>);
  },

  async saveShiftHandoverDraft(handoverId: string, outgoingNotes: string | null, items: ShiftHandoverDraftItemInput[]): Promise<ShiftHandover> {
    const { data, error } = await supabase.rpc('save_shift_handover_draft', { p_handover_id: handoverId, p_outgoing_notes: outgoingNotes, p_items: items });
    if (error) throw error;
    return mapShiftHandover(data as unknown as Record<string, unknown>);
  },

  async acceptShiftHandover(handoverId: string, acceptanceComments: string | null = null): Promise<ShiftHandover> {
    const { data, error } = await supabase.rpc('accept_shift_handover', { p_handover_id: handoverId, p_acceptance_comments: acceptanceComments });
    if (error) throw error;
    return mapShiftHandover(data as unknown as Record<string, unknown>);
  },

  async getOrCreateEqualOperatorHandover(outgoingShiftId: string, incomingShiftId: string): Promise<ShiftHandover> {
    const { data, error } = await supabase.rpc('get_or_create_equal_operator_handover_v2', {
      p_outgoing_shift_id: outgoingShiftId,
      p_incoming_shift_id: incomingShiftId,
    });
    if (error) throw error;
    return mapShiftHandover(data as unknown as Record<string, unknown>);
  },

  async saveEqualOperatorHandoverEntry(input: {
    handoverId: string;
    entryId?: string | null;
    clientEntryId: string;
    entryKind: EqualOperatorHandoverEntryKind;
    sourceType?: ShiftHandoverSourceType | null;
    sourceId?: string | null;
    body?: string | null;
    priority?: ShiftHandoverItem['priority'];
    expectedHandoverVersion?: number | null;
  }): Promise<EqualOperatorHandoverEntry> {
    const { data, error } = await supabase.rpc('save_equal_operator_handover_entry_v2', {
      p_handover_id: input.handoverId,
      p_entry_id: input.entryId ?? null,
      p_client_entry_id: input.clientEntryId,
      p_entry_kind: input.entryKind,
      p_source_type: input.sourceType ?? null,
      p_source_id: input.sourceId ?? null,
      p_body: input.body ?? null,
      p_priority: input.priority ?? null,
      p_expected_handover_version: input.expectedHandoverVersion ?? null,
    });
    if (error) throw error;
    return mapEqualOperatorHandoverEntry(data as unknown as Record<string, unknown>);
  },

  async deleteEqualOperatorHandoverEntry(handoverId: string, entryId: string, idempotencyKey: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('delete_equal_operator_handover_entry_v2', {
      p_handover_id: handoverId, p_entry_id: entryId, p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return Boolean(data);
  },

  async endDutyAndHandoverShift(input: {
    dutySessionId: string;
    incomingShiftId: string;
    idempotencyKey: string;
    finalComment?: string | null;
  }): Promise<EqualOperatorHandoverTransition> {
    const { data, error } = await supabase.rpc('end_duty_and_handover_shift_v2', {
      p_duty_session_id: input.dutySessionId,
      p_incoming_shift_id: input.incomingShiftId,
      p_idempotency_key: input.idempotencyKey,
      p_final_comment: input.finalComment ?? null,
    });
    if (error) throw error;
    return mapEqualOperatorTransition(data);
  },

  async endDutyWithoutNextShift(input: {
    dutySessionId: string;
    idempotencyKey: string;
    note?: string | null;
  }): Promise<DutyEndWithoutHandoverResult> {
    const { data, error } = await supabase.rpc('end_duty_without_next_shift_v2', {
      p_duty_session_id: input.dutySessionId,
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note ?? null,
    });
    if (error) throw error;
    const row = data as Record<string, unknown>;
    return {
      duty_session: mapShiftDutySession(row.duty_session as Record<string, unknown>),
      reason: 'NO_NEXT_SHIFT_SCHEDULED',
      note: row.note == null ? null : String(row.note),
    };
  },

  async reviewHandoverAndStartDuty(input: {
    shiftId: string;
    handoverId?: string | null;
    acknowledgeNoHandover?: boolean;
    acceptanceComments?: string | null;
    idempotencyKey: string;
  }): Promise<EqualOperatorHandoverTransition> {
    const { data, error } = await supabase.rpc('review_handover_and_start_duty_v2', {
      p_shift_id: input.shiftId,
      p_handover_id: input.handoverId ?? null,
      p_acknowledge_no_handover: input.acknowledgeNoHandover ?? false,
      p_acceptance_comments: input.acceptanceComments ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return mapEqualOperatorTransition(data);
  },

  async acceptLateShiftHandover(input: {
    dutySessionId: string;
    handoverId: string;
    acceptanceComments?: string | null;
    idempotencyKey: string;
  }): Promise<EqualOperatorHandoverTransition> {
    const { data, error } = await supabase.rpc('accept_late_shift_handover_v2', {
      p_duty_session_id: input.dutySessionId,
      p_handover_id: input.handoverId,
      p_acceptance_comments: input.acceptanceComments ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return mapEqualOperatorTransition(data);
  },

  async addShiftHandoverAmendment(input: {
    handoverId: string;
    body: string;
    replacesEntryId?: string | null;
    clientEntryId: string;
  }): Promise<EqualOperatorHandoverEntry> {
    const { data, error } = await supabase.rpc('add_shift_handover_amendment_v2', {
      p_handover_id: input.handoverId, p_body: input.body,
      p_replaces_entry_id: input.replacesEntryId ?? null, p_client_entry_id: input.clientEntryId,
    });
    if (error) throw error;
    return mapEqualOperatorHandoverEntry(data as unknown as Record<string, unknown>);
  },

  async getEqualOperatorHandover(handoverId: string): Promise<EqualOperatorHandoverDetail> {
    const { data, error } = await supabase.rpc('get_equal_operator_handover_v2', { p_handover_id: handoverId });
    if (error) throw error;
    const row = data as unknown as Record<string, unknown>;
    return {
      handover: mapShiftHandover(row.handover as Record<string, unknown>),
      entries: rows(row.entries).map(mapEqualOperatorHandoverEntry),
      individual_states: rows(row.individual_states).map(mapShiftDutyHandoverState),
      audit_events: rows(row.audit_events).map(mapShiftHandoverAuditEvent),
    };
  },

  async getShiftHandoverAcceptanceOversight(input: {
    stationId?: string | null;
    from: string;
    to: string;
    limit?: number;
  }): Promise<ShiftHandoverAcceptanceOversightRow[]> {
    const { data, error } = await supabase.rpc('get_shift_handover_acceptance_oversight_v2', {
      p_station_id: input.stationId ?? null, p_from: input.from, p_to: input.to, p_limit: input.limit ?? 500,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      handover_id: String(row.handover_id), station_id: String(row.station_id), station_name: String(row.station_name),
      outgoing_shift_id: String(row.outgoing_shift_id), outgoing_shift_name: String(row.outgoing_shift_name),
      incoming_shift_id: String(row.incoming_shift_id), incoming_shift_name: String(row.incoming_shift_name),
      team_status: String(row.team_status) as ShiftHandoverStatus,
      operator_id: String(row.operator_id), operator_name: String(row.operator_name),
      duty_session_id: row.duty_session_id == null ? null : String(row.duty_session_id),
      duty_started_at: row.duty_started_at == null ? null : String(row.duty_started_at),
      duty_ended_at: row.duty_ended_at == null ? null : String(row.duty_ended_at),
      individual_state: row.individual_state == null ? null : String(row.individual_state) as ShiftDutyHandoverIndividualState,
      individually_accepted_at: row.individually_accepted_at == null ? null : String(row.individually_accepted_at),
      acceptance_comments: row.acceptance_comments == null ? null : String(row.acceptance_comments),
      attention_state: String(row.attention_state) as ShiftHandoverAcceptanceOversightRow['attention_state'],
    }));
  },

  async getCurrentStationShift(stationId: string): Promise<StationShift | null> {
    const { data, error } = await supabase.rpc('get_current_station_shift', { p_station_id: stationId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapStationShift(row as Record<string, unknown>) : null;
  },

  async getMyV2HandoverUnattended(stationId: string): Promise<ShiftHandoverUnattendedState | null> {
    const { data, error } = await supabase.rpc('get_my_v2_handover_unattended', { p_station_id: stationId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? {
      handover_id: String(row.handover_id),
      incoming_shift_id: String(row.incoming_shift_id),
      released_at: String(row.released_at),
      status: String(row.status) as ShiftHandoverUnattendedState['status'],
    } : null;
  },

  async getMyShiftDutySession(shiftId: string): Promise<ShiftDutySession | null> {
    const { data, error } = await supabase.rpc('get_my_shift_duty_session', { p_shift_id: shiftId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapShiftDutySession(row as Record<string, unknown>) : null;
  },

  async getShiftDutySessions(shiftId: string): Promise<ShiftDutySession[]> {
    const { data, error } = await supabase.from('shift_duty_sessions').select('*').eq('shift_id', shiftId).order('started_at');
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapShiftDutySession(row));
  },

  async getPendingIncomingShiftHandover(stationId: string): Promise<ShiftHandover | null> {
    const { data, error } = await supabase.rpc('get_pending_incoming_shift_handover', { p_station_id: stationId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapShiftHandover(row as Record<string, unknown>) : null;
  },

  async getShiftHandover(handoverId: string): Promise<ShiftHandover | null> {
    const { data, error } = await supabase.from('shift_handovers').select('*').eq('id', handoverId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const accountability = (await getHandoverAccountability([handoverId])).get(handoverId);
    return { ...mapShiftHandover(data as Record<string, unknown>), ...(accountability ? { status: accountability.status as ShiftHandoverStatus, submitted_at: accountability.submitted_at, accepted_at: accountability.accepted_at, accountability } : {}) };
  },

  async getShiftHandoverItems(handoverId: string): Promise<ShiftHandoverItem[]> {
    const { data, error } = await supabase.from('shift_handover_items').select('*').eq('handover_id', handoverId).order('created_at');
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapShiftHandoverItem(row));
  },

  async getStationShiftAttendance(stationId: string, day: string): Promise<ShiftDutySession[]> {
    const { data, error } = await supabase.rpc('get_station_shift_attendance', { p_station_id: stationId, p_day: day });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapShiftDutySession(row));
  },

  async getStationShiftHistory(stationId: string, limit = 50): Promise<StationShift[]> {
    const { data, error } = await supabase.rpc('get_station_shift_history', { p_station_id: stationId, p_limit: limit });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapStationShift(row));
  },

  async getStationShiftCompliance(stationId: string, from: string, to: string, limit = 100): Promise<ShiftComplianceRow[]> {
    const { data, error } = await supabase.rpc('get_station_shift_compliance', {
      p_station_id: stationId,
      p_from: from,
      p_to: to,
      p_limit: limit,
    });
    if (error) throw error;
    const rows: ShiftComplianceRow[] = (data ?? []).map((row: Record<string, unknown>) => mapShiftComplianceRow(row));
    const audit = await getHandoverAccountability(rows.flatMap(row => row.handover ? [row.handover.id] : []));
    return rows.map(row => {
      const accountability = row.handover && audit.get(row.handover.id);
      return accountability && row.handover ? { ...row, handover: { ...row.handover, ...accountability, status: accountability.status as ShiftHandoverStatus, accountability } } : row;
    });
  },
  async getOperatorDutyReport(from: string, to: string, stationId: string | null = null, operatorId: string | null = null): Promise<OperatorDutyReportRow[]> {
    const { data, error } = await supabase.rpc('get_operator_duty_report', { p_from: from, p_to: to, p_station_id: stationId, p_operator_id: operatorId });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id), station_id: String(row.station_id), station_name: String(row.station_name), shift_date: String(row.shift_date), shift_name: String(row.shift_name),
      scheduled_start: String(row.scheduled_start), scheduled_end: String(row.scheduled_end), status: String(row.status) as StationShiftStatus,
      user_id: String(row.user_id), operator_name: String(row.operator_name), duty_role: String(row.duty_role) as ShiftRole,
      duty_state: String(row.duty_state) === 'OVER' ? 'OVER' as const : String(row.duty_state) === 'CURRENT' ? 'CURRENT' as const : 'UPCOMING' as const,
    }));
  },

  async saveStationShift(input: StationShiftScheduleInput): Promise<StationShift> {
    const { data, error } = await supabase.rpc('save_station_shift', {
      p_id: input.id ?? null,
      p_station_id: input.stationId,
      p_shift_date: input.shiftDate,
      p_shift_name: input.shiftName,
      p_scheduled_start: input.scheduledStart,
      p_scheduled_end: input.scheduledEnd,
    });
    if (error) throw error;
    return mapStationShift(data as unknown as Record<string, unknown>);
  },

  async repeatStationShiftPattern(input: {
    stationId: string;
    patternFrom: string;
    patternTo: string;
    durationValue: number;
    durationUnit: 'days' | 'months';
  }): Promise<StationShiftPatternRepeatResult[]> {
    const { data, error } = await supabase.rpc('repeat_station_shift_pattern', {
      p_station_id: input.stationId,
      p_pattern_from: input.patternFrom,
      p_pattern_to: input.patternTo,
      p_duration_value: input.durationValue,
      p_duration_unit: input.durationUnit,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      outcome: String(row.outcome) as StationShiftPatternRepeatResult['outcome'],
      seed_shift_id: String(row.seed_shift_id),
      shift_id: row.shift_id == null ? null : String(row.shift_id),
      shift_name: String(row.shift_name),
      shift_date: String(row.shift_date),
      scheduled_start: String(row.scheduled_start),
      scheduled_end: String(row.scheduled_end),
      skipped_reason: row.skipped_reason == null ? null : String(row.skipped_reason),
      omitted_roster_count: Number(row.omitted_roster_count ?? 0),
    }));
  },

  async cancelStationShift(shiftId: string): Promise<StationShift> {
    const { data, error } = await supabase.rpc('cancel_station_shift', { p_shift_id: shiftId });
    if (error) throw error;
    return mapStationShift(data as unknown as Record<string, unknown>);
  },

  async saveStationShiftRoster(shiftId: string, assignments: ShiftRosterAssignmentInput[]): Promise<ShiftRosterAssignment[]> {
    const { data, error } = await supabase.rpc('save_station_shift_roster', {
      p_shift_id: shiftId,
      p_assignments: assignments.map((assignment) => ({ user_id: assignment.userId, duty_role: assignment.dutyRole })),
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapShiftRosterAssignment(row));
  },

  async getStationShiftSchedule(stationId: string, from: string, to: string): Promise<StationShift[]> {
    const { data, error } = await supabase.rpc('get_station_shift_schedule', { p_station_id: stationId, p_from: from, p_to: to });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapStationShift(row));
  },

  async getNextStationShift(stationId: string): Promise<StationShift | null> {
    const { data, error } = await supabase.rpc('get_next_station_shift', { p_station_id: stationId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapStationShift(row as Record<string, unknown>) : null;
  },

  async getShiftRoster(shiftId: string): Promise<ShiftRosterAssignment[]> {
    const { data, error } = await supabase.rpc('get_shift_roster', { p_shift_id: shiftId });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapShiftRosterAssignment(row));
  },

async getStationShiftHandoverReport(
  stationId: string | null,
  from: string,
  to: string,
  limit = 500,
): Promise<ShiftHandoverReportRow[]> {

  const { data, error } = await supabase.rpc(
    'get_shift_handover_report_v2',
    {
  p_station_id: stationId,
  p_from: from,
  p_to: to,
  p_limit: limit,
}
  );

  if (error) throw error;

  return (data ?? []).map((item: Record<string, unknown>) => {
    const row = (item.payload ?? item) as Record<string, unknown>;
    return {
      id: String(row.id), station_id: String(row.station_id), station_name: String(row.station_name ?? ''),
      workflow_version: Number(row.workflow_version ?? 1),
      outgoing_shift_id: String(row.outgoing_shift_id), incoming_shift_id: String(row.incoming_shift_id),
      outgoing_shift_date: String(row.outgoing_shift_date), incoming_shift_date: String(row.incoming_shift_date),
      outgoing_shift_name: String(row.outgoing_shift_name ?? 'Outgoing shift'), incoming_shift_name: String(row.incoming_shift_name ?? 'Incoming shift'),
      outgoing_in_charge_name: null, incoming_in_charge_name: null,
      outgoing_notes: row.outgoing_notes == null ? null : String(row.outgoing_notes),
      acceptance_comments: row.acceptance_comments == null ? null : String(row.acceptance_comments),
      submitted_by_name: row.submitted_by_name == null ? null : String(row.submitted_by_name),
      submitted_at: row.submitted_at == null ? null : String(row.submitted_at),
      accepted_by_name: row.accepted_by_name == null ? null : String(row.accepted_by_name),
      accepted_at: row.accepted_at == null ? null : String(row.accepted_at),
      late_handover_submission_time: row.late_handover_submission_time == null ? null : String(row.late_handover_submission_time),
      status: String(row.status ?? 'UNKNOWN'), created_at: String(row.created_at), updated_at: String(row.updated_at),
      entries: rows(row.entries).map((entry) => ({
        id: String(entry.id), phase: String(entry.phase) as EqualOperatorHandoverEntryPhase,
        entry_kind: String(entry.entry_kind) as EqualOperatorHandoverEntryKind,
        source_type: entry.source_type == null ? null : String(entry.source_type) as ShiftHandoverSourceType,
        source_id: entry.source_id == null ? null : String(entry.source_id), body: entry.body == null ? null : String(entry.body),
        priority: entry.priority == null ? null : String(entry.priority) as ShiftHandoverItem['priority'],
        author_user_id: String(entry.author_user_id), author_name: String(entry.author_name ?? 'Operator'),
        replaces_entry_id: entry.replaces_entry_id == null ? null : String(entry.replaces_entry_id),
        created_at: String(entry.created_at), updated_at: String(entry.updated_at), finalized_at: entry.finalized_at == null ? null : String(entry.finalized_at),
      })),
      outgoing_operators: rows(row.outgoing_operators).map(mapReportOperator),
      incoming_operators: rows(row.incoming_operators).map(mapReportOperator),
      audit_events: rows(row.audit_events).map((audit) => ({
        id: String(audit.id), event_type: String(audit.event_type),
        actor_user_id: audit.actor_user_id == null ? null : String(audit.actor_user_id),
        actor_name: audit.actor_name == null ? null : String(audit.actor_name),
        duty_session_id: audit.duty_session_id == null ? null : String(audit.duty_session_id),
        occurred_at: String(audit.occurred_at),
        details: audit.details && typeof audit.details === 'object' && !Array.isArray(audit.details) ? audit.details as Record<string, unknown> : {},
      })),
    };
  });
},



async getLoadEnergyReadings(
  startIso: string,
  endIso: string,
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyAnalysisReading[]> {
  const pageSize = 1000;
  const rows: LoadEnergyAnalysisReading[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("log_book_entries")
      .select(`
        id,
        station_id,
        feeder_id,
        operator_id,
        actual_event_time,
        mw,
        mvar,
        voltage_kv,
        current_a,
        power_factor,
        frequency_hz,
        transformer_temp_c,
        oil_level_percent,
        tap_position,
        weather,
        remarks,
        updated_at
      `)
      .not("feeder_id", "is", null)
      .gte("actual_event_time", startIso)
      .lt("actual_event_time", endIso)
      .order("actual_event_time", { ascending: true })
      .order("updated_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (stationId) {
      query = query.eq("station_id", stationId);
    }

    if (feederId) {
      query = query.eq("feeder_id", feederId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Load and energy analysis readings could not be loaded.');
      throw error;
    }

    const page =
      (data ?? []) as LoadEnergyAnalysisReading[];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows.map(
    (row) => ({
      id:
        row.id,

      station_id:
        row.station_id,

      feeder_id:
        row.feeder_id,

      operator_id:
        row.operator_id,

      actual_event_time:
        row.actual_event_time,

      mw:
        row.mw === null
          ? null
          : Number(row.mw),

      mvar:
        row.mvar === null
          ? null
          : Number(row.mvar),

      voltage_kv:
        row.voltage_kv === null
          ? null
          : Number(row.voltage_kv),

      current_a:
        row.current_a === null
          ? null
          : Number(row.current_a),

      power_factor:
        row.power_factor === null
          ? null
          : Number(row.power_factor),

      frequency_hz:
        row.frequency_hz === null
          ? null
          : Number(row.frequency_hz),

      transformer_temp_c:
        row.transformer_temp_c === null
          ? null
          : Number(row.transformer_temp_c),

      oil_level_percent:
        row.oil_level_percent === null
          ? null
          : Number(row.oil_level_percent),

      tap_position:
        row.tap_position === null
          ? null
          : Number(row.tap_position),

      weather:
        row.weather,

      remarks:
        row.remarks,

      updated_at:
        row.updated_at,
    })
  );
},

async getLoadAnalysisFeederDayReadings(
  feederId: string,
  startIso: string,
  endIso: string
): Promise<LoadEnergyAnalysisReading[]> {
  return this.getLoadEnergyReadings(
    startIso,
    endIso,
    null,
    feederId
  );
},

async getLoadAnalysisFeederDailyProfile(
  feederId: string,
  startIso: string,
  endIso: string,
  parameterCode: 'MW' | 'MVAR' | 'VOLTAGE' | 'CURRENT' | 'PF'
): Promise<LoadAnalysisFeederDailyProfileRow[]> {
  const { data, error } = await supabase.rpc(
    'get_load_analysis_feeder_daily_profile',
    {
      p_feeder_id: feederId,
      p_start: startIso,
      p_end: endIso,
      p_parameter_code: parameterCode,
    }
  );

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    profile_date: String(row.profile_date),
    value: Number(row.value),
    source_time: String(row.source_time),
  }));
},

  /* =======================================================
     OPERATIONAL DASHBOARD

     These RPCs intentionally return compact, server-aggregated data for the
     utility-wide Today dashboard. The database function enforces accessible
     station scope; callers do not pass a station identifier.
  ======================================================= */

  async getDashboardOperationalSummary(
    startIso: string,
    endIso: string
  ): Promise<DashboardOperationalSummary> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_operational_summary',
      { p_start: startIso, p_end: endIso }
    );

    if (error) throw error;

    const row = data?.[0];
    return {
      peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
      peak_time: row?.peak_time ?? null,
      entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
      expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
      completeness_percent: Number(row?.completeness_percent ?? 0),
      stations_reporting: Number(row?.stations_reporting ?? 0),
      total_stations: Number(row?.total_stations ?? 0),
      feeders_reporting: Number(row?.feeders_reporting ?? 0),
      total_feeders: Number(row?.total_feeders ?? 0),
      open_interruptions: Number(row?.open_interruptions ?? 0),
      interruption_stations: Number(row?.interruption_stations ?? 0),
      active_parameter_alerts: Number(row?.active_parameter_alerts ?? 0),
      alert_feeders: Number(row?.alert_feeders ?? 0),
    };
  },

  async getMyProfile(): Promise<MyProfile> {
    const { data, error } = await supabase.rpc('get_my_profile').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Your application profile could not be found.');
    const row = data as Record<string, unknown>;
    return {
      full_name: String(row.full_name ?? ''),
      employee_code: row.employee_code == null ? null : String(row.employee_code),
      phone: row.phone == null ? null : String(row.phone),
      account_role: String(row.account_role ?? ''),
      account_active: Boolean(row.account_active),
      assigned_offices: Array.isArray(row.assigned_offices) ? row.assigned_offices.map(String) : [],
      accessible_stations: Array.isArray(row.accessible_stations) ? row.accessible_stations.map(String) : [],
    };
  },

  async getMyDesktopIdentity(): Promise<DesktopIdentity> {
    const { data, error } = await supabase.rpc('get_my_desktop_identity').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Your desktop identity could not be loaded.');
    const row = data as Record<string, unknown>;
    return {
      full_name: String(row.full_name ?? ''),
      employee_code: row.employee_code == null ? null : String(row.employee_code),
      designation: row.designation == null ? null : String(row.designation),
      account_role: String(row.account_role ?? ''),
      assigned_offices: Array.isArray(row.assigned_offices) ? row.assigned_offices.map(String) : [],
      accessible_station_count: Number(row.accessible_station_count ?? 0),
    };
  },

  async updateMyProfile({ fullName, phone }: { fullName: string; phone: string | null }): Promise<Pick<MyProfile, 'full_name' | 'phone'>> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error('You must be signed in to update your profile.');
    const { data, error } = await supabase
      .from('app_users')
      .update({ full_name: fullName, phone, updated_at: new Date().toISOString() })
      .eq('id', userData.user.id)
      .select('full_name, phone')
      .single();
    if (error) throw error;
    return { full_name: String(data.full_name), phone: data.phone == null ? null : String(data.phone) };
  },

  async getMyNotificationDevices(): Promise<NotificationDevice[]> {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('id, platform, is_active, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      platform: row.platform,
      is_active: row.is_active,
      updated_at: row.updated_at,
    }));
  },

  async deactivateMyNotificationDevice(deviceId: string): Promise<void> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error('You must be signed in to manage devices.');
    const { error } = await supabase
      .from('device_tokens')
      .update({ is_active: false })
      .eq('id', deviceId)
      .eq('user_id', userData.user.id);
    if (error) throw error;
  },

  async getOrgUnitTypes(): Promise<OrgUnitType[]> {
    const { data, error } = await supabase.rpc('get_org_unit_types');
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({ unit_type: String(row.unit_type), hierarchy_rank: Number(row.hierarchy_rank) }));
  },

  async getOrgUnitsPage(search: string, active: boolean | null, page: number, pageSize: number): Promise<OrgUnitPage> {
    const { data, error } = await supabase.rpc('get_org_units_page', { p_search: search || null, p_active: active, p_page: page, p_page_size: pageSize });
    if (error) throw error;
    const rows = (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id), code: String(row.code), name: String(row.name), unit_type: String(row.unit_type), parent_id: row.parent_id == null ? null : String(row.parent_id), parent_name: row.parent_name == null ? null : String(row.parent_name), active: Boolean(row.active), archived_at: row.archived_at == null ? null : String(row.archived_at), child_count: Number(row.child_count), station_count: Number(row.station_count),
    }));
    return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 };
  },

  async getOrgUnitDetail(id: string): Promise<OrgUnitDetail> {
    const { data, error } = await supabase.rpc('get_org_unit_detail', { p_id: id }).single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    return { id: String(row.id), code: String(row.code), name: String(row.name), unit_type: String(row.unit_type), parent_id: row.parent_id == null ? null : String(row.parent_id), parent_name: row.parent_name == null ? null : String(row.parent_name), active: Boolean(row.active), archived_at: row.archived_at == null ? null : String(row.archived_at), child_count: 0, station_count: 0, archive_reason: row.archive_reason == null ? null : String(row.archive_reason), child_names: Array.isArray(row.child_names) ? row.child_names.map(String) : [], station_names: Array.isArray(row.station_names) ? row.station_names.map(String) : [] };
  },

  async getOrgUnitParentOptions(unitType: string, excludeId?: string): Promise<OrgUnitParentOption[]> {
    const { data, error } = await supabase.rpc('get_org_unit_parent_options', { p_unit_type: unitType, p_exclude_id: excludeId ?? null });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), name: String(row.name), unit_type: String(row.unit_type) }));
  },

  async saveOrgUnit(input: { id?: string; code: string; name: string; unitType: string; parentId: string | null; reason?: string | null }): Promise<string> {
    const { data, error } = await supabase.rpc('save_org_unit', { p_id: input.id ?? null, p_code: input.code, p_name: input.name, p_unit_type: input.unitType, p_parent_id: input.parentId, p_reason: input.reason ?? null });
    if (error) throw error;
    return String(data);
  },

  async archiveOrgUnit(id: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('archive_org_unit', { p_id: id, p_reason: reason });
    if (error) throw error;
  },

  async getAdminStationsPage(search: string, active: boolean | null, page: number, pageSize: number): Promise<{ rows: AdminStationRow[]; total: number }> {
    const { data, error } = await supabase.rpc('get_stations_admin_page', { p_search: search || null, p_active: active, p_page: page, p_page_size: pageSize }); if (error) throw error;
    const rows = (data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), code: String(row.code), name: String(row.name), location: row.location == null ? null : String(row.location), voltage_level_kv: row.voltage_level_kv == null ? null : Number(row.voltage_level_kv), active: Boolean(row.active), office_count: Number(row.office_count), feeder_count: Number(row.feeder_count) }));
    return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 };
  },
  async getAdminStationDetail(id: string): Promise<AdminStationDetail> {
    const { data, error } = await supabase.rpc('get_station_admin_detail', { p_id: id }).single(); if (error) throw error; const row = data as Record<string, unknown>;
    return { id: String(row.id), code: String(row.code), name: String(row.name), location: row.location == null ? null : String(row.location), voltage_level_kv: row.voltage_level_kv == null ? null : Number(row.voltage_level_kv), active: Boolean(row.active), office_count: 0, feeder_count: Number(row.feeder_count), archive_reason: row.archive_reason == null ? null : String(row.archive_reason), office_ids: Array.isArray(row.office_ids) ? row.office_ids.map(String) : [], office_names: Array.isArray(row.office_names) ? row.office_names.map(String) : [], primary_office_id: row.primary_office_id == null ? null : String(row.primary_office_id), authorised_users: Array.isArray(row.authorised_users) ? row.authorised_users.map(String) : [] };
  },
  async getActiveOfficeOptions(): Promise<OrgUnitParentOption[]> { const { data, error } = await supabase.rpc('get_active_office_options'); if (error) throw error; return (data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), name: String(row.name), unit_type: String(row.unit_type) })); },
  async saveAdminStation(input: { id?: string; code: string; name: string; location: string | null; voltageLevelKv: number | null; officeIds: string[]; primaryOfficeId: string | null; reason?: string | null }): Promise<string> { const { data, error } = await supabase.rpc('save_station_admin', { p_id: input.id ?? null, p_code: input.code, p_name: input.name, p_location: input.location, p_voltage_level_kv: input.voltageLevelKv, p_office_ids: input.officeIds, p_primary_office_id: input.primaryOfficeId, p_reason: input.reason ?? null }); if (error) throw error; return String(data); },
  async archiveAdminStation(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc('archive_station_admin', { p_id: id, p_reason: reason }); if (error) throw error; },
  async getAdminFeedersPage(search: string, active: boolean | null, stationId: string | null, page: number, pageSize: number): Promise<{ rows: AdminFeederRow[]; total: number }> { const { data, error } = await supabase.rpc('get_feeders_admin_page', { p_search: search || null, p_active: active, p_station_id: stationId, p_page: page, p_page_size: pageSize }); if (error) throw error; const rows = (data ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), code: String(r.code), name: String(r.name), station_id: String(r.station_id), station_name: String(r.station_name), voltage_level_kv: r.voltage_level_kv == null ? null : Number(r.voltage_level_kv), consumer_count: Number(r.consumer_count), active: Boolean(r.active) })); return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 }; },
  async getAdminFeederDetail(id: string): Promise<AdminFeederDetail> { const { data, error } = await supabase.rpc('get_feeder_admin_detail', { p_id: id }).single(); if (error) throw error; const r = data as Record<string, unknown>; return { id: String(r.id), code: String(r.code), name: String(r.name), station_id: String(r.station_id), station_name: String(r.station_name), voltage_level_kv: r.voltage_level_kv == null ? null : Number(r.voltage_level_kv), consumer_count: Number(r.consumer_count), active: Boolean(r.active), archive_reason: r.archive_reason == null ? null : String(r.archive_reason), logbook_count: Number(r.logbook_count), interruption_count: Number(r.interruption_count) }; },
  async getManageableStationOptions(): Promise<{ id: string; name: string; code: string }[]> { const { data, error } = await supabase.rpc('get_manageable_station_options'); if (error) throw error; return (data ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), name: String(r.name), code: String(r.code) })); },
  async saveAdminFeeder(input: { id?: string; code: string; name: string; stationId: string; voltageLevelKv: number | null; consumerCount: number; reason?: string | null }): Promise<string> { const { data, error } = await supabase.rpc('save_feeder_admin', { p_id: input.id ?? null, p_code: input.code, p_name: input.name, p_station_id: input.stationId, p_voltage_level_kv: input.voltageLevelKv, p_consumer_count: input.consumerCount, p_reason: input.reason ?? null }); if (error) throw error; return String(data); },
  async archiveAdminFeeder(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc('archive_feeder_admin', { p_id: id, p_reason: reason }); if (error) throw error; },

  async getUsersAccessPage(input: { search: string; role: AppRole | null; active: boolean | null; officeId: string | null; stationId: string | null; page: number; pageSize: number }): Promise<{ rows: UsersAccessRow[]; total: number }> {
    const { data, error } = await supabase.rpc('get_users_access_page', { p_search: input.search || null, p_role: input.role, p_active: input.active, p_office_id: input.officeId, p_station_id: input.stationId, p_page: input.page, p_page_size: input.pageSize });
    if (error) throw error;
    const rows = (data ?? []).map((row: Record<string, unknown>): UsersAccessRow => ({ id: String(row.id), full_name: String(row.full_name), employee_code: row.employee_code == null ? null : String(row.employee_code), email: row.email == null ? null : String(row.email), phone: row.phone == null ? null : String(row.phone), role: String(row.role) as AppRole, active: Boolean(row.active), office_names: Array.isArray(row.office_names) ? row.office_names.map(String) : [], station_names: Array.isArray(row.station_names) ? row.station_names.map(String) : [], device_count: Number(row.device_count ?? 0), created_at: String(row.created_at), updated_at: String(row.updated_at) }));
    return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 };
  },
  async getUserAccessDetail(id: string): Promise<UsersAccessDetail> {
    const { data, error } = await supabase.rpc('get_user_access_detail', { p_user_id: id }).single(); if (error) throw error;
    const row = data as Record<string, unknown>;
    return { id: String(row.id), full_name: String(row.full_name), employee_code: row.employee_code == null ? null : String(row.employee_code), email: row.email == null ? null : String(row.email), phone: row.phone == null ? null : String(row.phone), role: String(row.role) as AppRole, active: Boolean(row.active), office_names: Array.isArray(row.office_names) ? row.office_names.map(String) : [], station_names: Array.isArray(row.station_names) ? row.station_names.map(String) : [], office_ids: Array.isArray(row.office_ids) ? row.office_ids.map(String) : [], station_ids: Array.isArray(row.station_ids) ? row.station_ids.map(String) : [], device_count: Number(row.device_count ?? 0), created_at: String(row.created_at), updated_at: String(row.updated_at) };
  },
  async getUsersAccessScopeOptions(): Promise<UsersAccessScopeOption[]> {
    const { data, error } = await supabase.rpc('get_users_access_scope_options'); if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({ kind: String(row.kind) as UsersAccessScopeOption['kind'], id: String(row.id), name: String(row.name), code: String(row.code) }));
  },
  async manageUserAccess(input: { id: string; fullName: string; employeeCode: string | null; phone: string | null; role: AppRole; active: boolean; officeIds: string[]; stationIds: string[]; reason: string | null }): Promise<void> {
    const { error } = await supabase.rpc('manage_user_access', { p_user_id: input.id, p_full_name: input.fullName, p_employee_code: input.employeeCode, p_phone: input.phone, p_role: input.role, p_active: input.active, p_office_ids: input.officeIds, p_station_ids: input.stationIds, p_reason: input.reason }); if (error) throw error;
  },
  async inviteUser(input: { fullName: string; employeeCode: string | null; email: string; phone: string | null; role: AppRole; officeIds: string[]; stationIds: string[]; reason: string | null }): Promise<void> {
    const { error } = await supabase.functions.invoke('invite-user', { body: { fullName: input.fullName, employeeCode: input.employeeCode, email: input.email, phone: input.phone, role: input.role, officeIds: input.officeIds, stationIds: input.stationIds, reason: input.reason } }); if (error) throw error;
  },
  async resendSetupEmail(targetUserId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('resend-setup-email', { body: { targetUserId } });
    if (error) throw error;
  },
  async getFeederThresholdsPage(input: { search: string; stationId: string | null; feederId: string | null; parameterCode: string | null; feederActive: boolean | null; page: number; pageSize: number }): Promise<{ rows: FeederThresholdRow[]; total: number }> { const { data, error } = await supabase.rpc('get_feeder_thresholds_page', { p_search: input.search || null, p_station_id: input.stationId, p_feeder_id: input.feederId, p_parameter_code: input.parameterCode, p_feeder_active: input.feederActive, p_page: input.page, p_page_size: input.pageSize }); if (error) throw error; const rows = (data ?? []).map((row: Record<string, unknown>): FeederThresholdRow => ({ id: String(row.id), station_id: String(row.station_id), station_name: String(row.station_name), feeder_id: String(row.feeder_id), feeder_name: String(row.feeder_name), parameter_code: String(row.parameter_code), min_value: row.min_value == null ? null : Number(row.min_value), max_value: row.max_value == null ? null : Number(row.max_value), feeder_active: Boolean(row.feeder_active), updated_at: String(row.updated_at), updated_by_name: row.updated_by_name == null ? null : String(row.updated_by_name) })); return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 }; },
  async getThresholdScopeOptions(): Promise<ThresholdScopeOption[]> { const { data, error } = await supabase.rpc('get_threshold_scope_options'); if (error) throw error; return (data ?? []).map((row: Record<string, unknown>) => ({ kind: String(row.kind) as ThresholdScopeOption['kind'], id: String(row.id), name: String(row.name), station_id: String(row.station_id), station_name: String(row.station_name) })); },
  async saveFeederThreshold(input: { id?: string; feederId: string; parameterCode: string; min: number | null; max: number | null; reason: string | null }): Promise<string> { const { data, error } = await supabase.rpc('save_feeder_threshold', { p_id: input.id ?? null, p_feeder_id: input.feederId, p_parameter_code: input.parameterCode, p_min: input.min, p_max: input.max, p_reason: input.reason }); if (error) throw error; return String(data); },
  async getGlobalNotificationConfig(): Promise<GlobalNotificationConfig> { const { data, error } = await supabase.rpc('get_global_notification_config').single(); if (error) throw error; const row = data as Record<string, unknown>; return { id: String(row.id), active: Boolean(row.active), max_unit_type: String(row.max_unit_type), updated_at: String(row.updated_at), updated_by_name: row.updated_by_name == null ? null : String(row.updated_by_name) }; },
  async updateGlobalNotificationConfig(input: { id: string; active: boolean; maxUnitType: string; reason: string }): Promise<void> { const { error } = await supabase.rpc('update_global_notification_config', { p_id: input.id, p_active: input.active, p_max_unit_type: input.maxUnitType, p_reason: input.reason }); if (error) throw error; },
  async getAdministrationAuditPage(input: { from: string; to: string; action: string | null; entityType: string | null; actorId: string | null; stationId: string | null; orgUnitId: string | null; visibility: string | null; search: string; page: number; pageSize: number }): Promise<{ rows: AdministrationAuditRow[]; total: number }> { const { data, error } = await supabase.rpc('get_administration_audit_page', { p_from: input.from, p_to: input.to, p_action: input.action, p_entity_type: input.entityType, p_actor_id: input.actorId, p_station_id: input.stationId, p_org_unit_id: input.orgUnitId, p_visibility: input.visibility, p_search: input.search || null, p_page: input.page, p_page_size: input.pageSize }); if (error) throw error; const rows = (data ?? []).map((r: Record<string, unknown>): AdministrationAuditRow => ({ id: String(r.id), created_at: String(r.created_at), action: String(r.action), entity_type: String(r.entity_type), entity_id: r.entity_id == null ? null : String(r.entity_id), record_label: String(r.record_label ?? 'Administrative record'), actor_id: r.actor_id == null ? null : String(r.actor_id), actor_name: r.actor_name == null ? null : String(r.actor_name), actor_employee_code: r.actor_employee_code == null ? null : String(r.actor_employee_code), station_id: r.station_id == null ? null : String(r.station_id), station_name: r.station_name == null ? null : String(r.station_name), org_unit_id: r.org_unit_id == null ? null : String(r.org_unit_id), org_unit_name: r.org_unit_name == null ? null : String(r.org_unit_name), visibility: String(r.visibility) as AdministrationAuditRow['visibility'], reason: r.reason == null ? null : String(r.reason), old_values: r.old_values as Record<string, unknown> | null, new_values: r.new_values as Record<string, unknown> | null })); return { rows, total: rows.length ? Number((data?.[0] as Record<string, unknown>).total_count) : 0 }; },
  async getAdministrationAuditFilterOptions(): Promise<AdministrationAuditFilterOption[]> { const { data, error } = await supabase.rpc('get_administration_audit_filter_options'); if (error) throw error; return (data ?? []).map((r: Record<string, unknown>) => ({ kind: String(r.kind) as AdministrationAuditFilterOption['kind'], id: String(r.id), label: String(r.label) })); },

  async getDashboardTodayLoadTrend(
    startIso: string,
    endIso: string
  ): Promise<DashboardTodayLoadTrendRow[]> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_today_load_trend',
      { p_start: startIso, p_end: endIso }
    );

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
      hour_no: Number(row.hour_no ?? 0),
      hour_time: String(row.hour_time ?? ''),
      total_mw: row.total_mw === null || row.total_mw === undefined ? null : Number(row.total_mw),
      entered_feeders: Number(row.entered_feeders ?? 0),
      expected_feeders: Number(row.expected_feeders ?? 0),
      fill_status: row.fill_status === 'FULL' || row.fill_status === 'PARTIAL' || row.fill_status === 'EMPTY' || row.fill_status === 'FUTURE'
        ? row.fill_status
        : 'EMPTY',
    }));
  },

  async getDashboardAttentionItems(
    startIso: string,
    endIso: string,
    limit = 5
  ): Promise<DashboardAttentionItem[]> {
    const { data, error } = await supabase.rpc(
      'get_dashboard_attention_items',
      { p_start: startIso, p_end: endIso, p_limit: limit }
    );

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
      issue_type: row.issue_type === 'INTERRUPTION' || row.issue_type === 'PARAMETER_ALERT' || row.issue_type === 'COMPLETENESS'
        ? row.issue_type
        : 'COMPLETENESS',
      station_id: String(row.station_id),
      station_name: String(row.station_name ?? 'Station'),
      issue_count: Number(row.issue_count ?? 0),
      completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined
        ? null
        : Number(row.completeness_percent),
      severity: row.severity === 'HIGH' || row.severity === 'MEDIUM' || row.severity === 'LOW'
        ? row.severity
        : 'LOW',
    }));
  },

/* =======================================================
   LOAD ANALYSIS DAILY TREND

   Aggregation is performed in PostgreSQL instead of
   downloading every feeder/hour record into the browser.

   stationId:
     null → all stations

   feederId:
     null → all relevant feeders
======================================================= */

async getLoadAnalysisOverview(startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null): Promise<LoadAnalysisOverviewRow> {
  const { data, error } = await supabase.rpc('get_load_analysis_overview', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw), peak_time: row?.peak_time ?? null,
    minimum_voltage_kv: row?.minimum_voltage_kv === null || row?.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv), minimum_voltage_time: row?.minimum_voltage_time ?? null,
    maximum_current_a: row?.maximum_current_a === null || row?.maximum_current_a === undefined ? null : Number(row.maximum_current_a), maximum_current_time: row?.maximum_current_time ?? null,
    minimum_power_factor: row?.minimum_power_factor === null || row?.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor), minimum_power_factor_time: row?.minimum_power_factor_time ?? null,
    maximum_transformer_temp_c: row?.maximum_transformer_temp_c === null || row?.maximum_transformer_temp_c === undefined ? null : Number(row.maximum_transformer_temp_c), maximum_transformer_temp_time: row?.maximum_transformer_temp_time ?? null,
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), completeness_percent: Number(row?.completeness_percent ?? 0),
  };
},

async getLoadAnalysisRanking(startIso: string, endIso: string, stationId: string | null = null): Promise<LoadAnalysisRankingRow[]> {
  const { data, error } = stationId
    ? await supabase.rpc('get_load_analysis_feeder_ranking', { p_start: startIso, p_end: endIso, p_station_id: stationId })
    : await supabase.rpc('get_load_analysis_station_ranking', { p_start: startIso, p_end: endIso });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.feeder_id ?? row.station_id), name: String(row.feeder_name ?? row.station_name),
    peak_mw: row.peak_mw === null ? null : Number(row.peak_mw), minimum_voltage_kv: row.minimum_voltage_kv === null || row.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv), maximum_current_a: row.maximum_current_a === null || row.maximum_current_a === undefined ? null : Number(row.maximum_current_a), minimum_power_factor: row.minimum_power_factor === null ? null : Number(row.minimum_power_factor),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0), completeness_percent: Number(row.completeness_percent ?? 0),
  }));
},

async getLoadAnalysisParameterHealth(startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null): Promise<LoadAnalysisParameterHealthRow> {
  const { data, error } = await supabase.rpc('get_load_analysis_parameter_health', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId });
  if (error) throw error;
  const row = data?.[0];
  return { low_pf_feeder_count: Number(row?.low_pf_feeder_count ?? 0), incomplete_feeder_count: Number(row?.incomplete_feeder_count ?? 0), minimum_voltage_kv: row?.minimum_voltage_kv === null || row?.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv), maximum_current_a: row?.maximum_current_a === null || row?.maximum_current_a === undefined ? null : Number(row.maximum_current_a), maximum_transformer_temp_c: row?.maximum_transformer_temp_c === null || row?.maximum_transformer_temp_c === undefined ? null : Number(row.maximum_transformer_temp_c), completeness_percent: Number(row?.completeness_percent ?? 0) };
},

async getLoadAnalysisParameterHealthDetails(
  startIso: string,
  endIso: string,
  metric: ParameterHealthDetailMetric,
  stationId: string | null = null,
  feederId: string | null = null,
  limit = 50
): Promise<LoadAnalysisParameterHealthDetailRow[]> {
  const { data, error } = await supabase.rpc(
    'get_load_analysis_parameter_health_details',
    {
      p_start: startIso,
      p_end: endIso,
      p_station_id: stationId,
      p_feeder_id: feederId,
      p_metric: metric,
      p_limit: limit,
    }
  );
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    station_id: String(row.station_id),
    station_name: String(row.station_name ?? 'Station'),
    feeder_id: String(row.feeder_id),
    feeder_name: String(row.feeder_name ?? 'Feeder'),
    metric_value: row.metric_value === null || row.metric_value === undefined ? null : Number(row.metric_value),
    occurred_at: row.occurred_at === null || row.occurred_at === undefined ? null : String(row.occurred_at),
    entered_hours: row.entered_hours === null || row.entered_hours === undefined ? null : Number(row.entered_hours),
    expected_hours: row.expected_hours === null || row.expected_hours === undefined ? null : Number(row.expected_hours),
    missing_hours: row.missing_hours === null || row.missing_hours === undefined ? null : Number(row.missing_hours),
    completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined ? null : Number(row.completeness_percent),
  }));
},

async getLoadAnalysisDailyTrend(
  startIso: string,
  endIso: string,
  stationId:
    string | null = null,
  feederId:
    string | null = null
): Promise<
  LoadAnalysisDailyTrendRow[]
> {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "get_load_analysis_daily_trend",
      {
        p_start:
          startIso,

        p_end:
          endIso,

        p_station_id:
          stationId,

        p_feeder_id:
          feederId,
      }
    );

  if (error) {
    console.error('The daily load-analysis trend could not be loaded.');

    throw error;
  }

  return (
    data ?? []
  ).map(
    (
      row: {
        trend_date:
          string;

        peak_time:
          string | null;

        peak_mw:
          number | string | null;

        entered_feeders:
          number | string;

        expected_feeders:
          number | string;

        fill_status:
          string;
      }
    ) => ({
      trend_date:
        row.trend_date,

      peak_time:
        row.peak_time,

      peak_mw:
        row.peak_mw ===
        null
          ? null
          : Number(
              row.peak_mw
            ),

      entered_feeders:
        Number(
          row.entered_feeders
        ),

      expected_feeders:
        Number(
          row.expected_feeders
        ),

      fill_status:
        row.fill_status ===
        "FULL"
          ? "FULL"
          : row.fill_status ===
              "EMPTY"
            ? "EMPTY"
            : "PARTIAL",
    })
  );
},

async getLoadEnergyReportSummary(
  startIso: string,
  endIso: string,
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyReportSummary> {
  const { data, error } = await supabase.rpc('get_load_energy_report_summary', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
    peak_time: row?.peak_time ?? null,
    minimum_mw: row?.minimum_mw === null || row?.minimum_mw === undefined ? null : Number(row.minimum_mw),
    minimum_time: row?.minimum_time ?? null,
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    estimated_energy_mwh: row?.estimated_energy_mwh === null || row?.estimated_energy_mwh === undefined ? null : Number(row.estimated_energy_mwh),
    energy_eligible: Boolean(row?.energy_eligible),
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0),
  };
},

async getLoadEnergyReportSeries(
  startIso: string,
  endIso: string,
  interval: 'HOURLY' | 'DAILY',
  stationId: string | null = null,
  feederId: string | null = null
): Promise<LoadEnergyReportSeriesRow[]> {
  const { data, error } = await supabase.rpc('get_load_energy_report_series', {
    p_start: startIso, p_end: endIso, p_interval: interval, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    bucket_start: String(row.bucket_start),
    peak_mw: row.peak_mw === null || row.peak_mw === undefined ? null : Number(row.peak_mw),
    minimum_mw: row.minimum_mw === null || row.minimum_mw === undefined ? null : Number(row.minimum_mw),
    average_mw: row.average_mw === null || row.average_mw === undefined ? null : Number(row.average_mw),
    entered_feeder_hours: Number(row.entered_feeder_hours ?? 0),
    expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0),
    fill_status: row.fill_status === 'FULL' || row.fill_status === 'PARTIAL' ? row.fill_status : 'EMPTY',
  }));
},

async getDataCompletenessReportSummary(
  startIso: string, endIso: string, threshold: number,
  stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportSummary> {
  const { data, error } = await supabase.rpc('get_data_completeness_report_summary', {
    p_start: startIso, p_end: endIso, p_threshold: threshold, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0), stations_below_threshold: Number(row?.stations_below_threshold ?? 0),
    feeders_below_threshold: Number(row?.feeders_below_threshold ?? 0),
  };
},

async getDataCompletenessStationBreakdown(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_station_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return mapDataCompletenessBreakdown(data ?? []);
},

async getDataCompletenessFeederBreakdown(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_feeder_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return mapDataCompletenessBreakdown(data ?? []);
},

async getDataCompletenessReportTrend(
  startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessReportTrendRow[]> {
  const { data, error } = await supabase.rpc('get_data_completeness_report_trend', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    date: String(row.date), entered_feeder_hours: Number(row.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row.expected_feeder_hours ?? 0),
    completeness_percent: Number(row.completeness_percent ?? 0), fill_status: mapCompletenessStatus(row.fill_status),
  }));
},

async getDataCompletenessMissingPage(
  startIso: string, endIso: string, page: number, pageSize: number,
  stationId: string | null = null, feederId: string | null = null
): Promise<DataCompletenessMissingPage> {
  const { data, error } = await supabase.rpc('get_data_completeness_missing_slots', {
    p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    date: String(row.date), hour: Number(row.hour), station_id: String(row.station_id), station_name: String(row.station_name),
    feeder_id: String(row.feeder_id), feeder_name: String(row.feeder_name), status: 'MISSING' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getParameterExceptionReportSummary(
  startIso: string, endIso: string, stationId: string | null = null,
  feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionReportSummary> {
  const { data, error } = await supabase.rpc('get_parameter_exception_report_summary', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    total_exceptions: Number(row?.total_exceptions ?? 0), active_exceptions: Number(row?.active_exceptions ?? 0),
    affected_stations: Number(row?.affected_stations ?? 0), affected_feeders: Number(row?.affected_feeders ?? 0),
    most_frequent_parameter: row?.most_frequent_parameter ?? null,
  };
},

async getParameterExceptionBreakdown(
  startIso: string, endIso: string, stationId: string | null = null,
  feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionBreakdownRow[]> {
  const { data, error } = await supabase.rpc('get_parameter_exception_report_breakdown', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    parameter_code: String(row.parameter_code), exception_count: Number(row.exception_count ?? 0), affected_feeders: Number(row.affected_feeders ?? 0),
  }));
},

async getParameterExceptionParameters(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_parameter_exception_parameters');
  if (error) throw error;
  return (data ?? []).map((row: { parameter_code: string | null }) => row.parameter_code).filter((value: string | null): value is string => Boolean(value));
},

async getParameterExceptionDetailPage(
  startIso: string, endIso: string, page: number, pageSize: number,
  stationId: string | null = null, feederId: string | null = null, parameterCode: string | null = null
): Promise<ParameterExceptionDetailPage> {
  const { data, error } = await supabase.rpc('get_parameter_exception_detail_page', {
    p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize,
    p_station_id: stationId, p_feeder_id: feederId, p_parameter_code: parameterCode,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), triggered_at: String(row.triggered_at), station_id: String(row.station_id), station_name: String(row.station_name),
    feeder_id: String(row.feeder_id), feeder_name: String(row.feeder_name), parameter_code: String(row.parameter_code), actual_value: Number(row.actual_value),
    min_value: row.min_value === null || row.min_value === undefined ? null : Number(row.min_value),
    max_value: row.max_value === null || row.max_value === undefined ? null : Number(row.max_value),
    breach_type: row.breach_type === 'BELOW_MIN' ? 'BELOW_MIN' as const : 'ABOVE_MAX' as const,
    deviation: Number(row.deviation ?? 0), status: 'ACTIVE' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getPerformanceReportSummary(
  startIso: string, endIso: string, entity: PerformanceReportEntity,
  stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportSummary> {
  const { data, error } = await supabase.rpc('get_performance_report_summary', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    entity_count: Number(row?.entity_count ?? 0), peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw),
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    minimum_power_factor: row?.minimum_power_factor === null || row?.minimum_power_factor === undefined ? null : Number(row.minimum_power_factor),
    interruption_count: Number(row?.interruption_count ?? 0), interruption_duration_minutes: Number(row?.interruption_duration_minutes ?? 0),
    exception_count: Number(row?.exception_count ?? 0), entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0),
    completeness_percent: Number(row?.completeness_percent ?? 0), feeders_reporting: Number(row?.feeders_reporting ?? 0),
  };
},

async getPerformanceReportPage(
  startIso: string, endIso: string, entity: PerformanceReportEntity, metric: PerformanceReportMetric,
  page: number, pageSize: number, stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportPage> {
  const { data, error } = await supabase.rpc('get_performance_report_page', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_metric: metric, p_page: page, p_page_size: pageSize,
    p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => mapPerformanceReportRow(row));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getPerformanceReportRanking(
  startIso: string, endIso: string, entity: PerformanceReportEntity, metric: PerformanceReportMetric,
  stationId: string | null = null, feederId: string | null = null
): Promise<PerformanceReportRankingRow[]> {
  const { data, error } = await supabase.rpc('get_performance_report_ranking', {
    p_start: startIso, p_end: endIso, p_entity: entity, p_metric: metric, p_station_id: stationId, p_feeder_id: feederId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    entity_id: String(row.entity_id), entity_name: String(row.entity_name), metric_value: row.metric_value === null || row.metric_value === undefined ? null : Number(row.metric_value),
  }));
},

async getExecutiveSummaryReport(
  startIso: string, endIso: string, stationId: string | null = null
): Promise<ExecutiveSummaryReport> {
  const { data, error } = await supabase.rpc('get_executive_summary_report', {
    p_start: startIso, p_end: endIso, p_station_id: stationId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    peak_mw: row?.peak_mw === null || row?.peak_mw === undefined ? null : Number(row.peak_mw), peak_time: row?.peak_time ?? null,
    average_mw: row?.average_mw === null || row?.average_mw === undefined ? null : Number(row.average_mw),
    minimum_voltage_kv: row?.minimum_voltage_kv === null || row?.minimum_voltage_kv === undefined ? null : Number(row.minimum_voltage_kv),
    minimum_voltage_time: row?.minimum_voltage_time ?? null,
    open_interruptions: Number(row?.open_interruptions ?? 0), total_interruptions: Number(row?.total_interruptions ?? 0), total_interruption_duration_minutes: Number(row?.total_interruption_duration_minutes ?? 0),
    active_parameter_exceptions: Number(row?.active_parameter_exceptions ?? 0), total_parameter_exceptions: Number(row?.total_parameter_exceptions ?? 0),
    entered_feeder_hours: Number(row?.entered_feeder_hours ?? 0), expected_feeder_hours: Number(row?.expected_feeder_hours ?? 0), completeness_percent: Number(row?.completeness_percent ?? 0),
    stations_reporting: Number(row?.stations_reporting ?? 0), total_stations: Number(row?.total_stations ?? 0), feeders_reporting: Number(row?.feeders_reporting ?? 0), total_feeders: Number(row?.total_feeders ?? 0),
  };
},

async getExecutiveSummaryAttention(
  startIso: string, endIso: string, stationId: string | null = null
): Promise<ExecutiveSummaryAttentionRow[]> {
  const { data, error } = await supabase.rpc('get_executive_summary_attention', {
    p_start: startIso, p_end: endIso, p_station_id: stationId, p_limit: 5,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), entity_type: row.entity_type === 'FEEDER' ? 'FEEDER' : 'STATION', entity_name: String(row.entity_name),
    issue_type: row.issue_type === 'PARAMETER_EXCEPTION' || row.issue_type === 'LOW_COMPLETENESS' ? row.issue_type : 'OPEN_INTERRUPTION',
    issue_count: Number(row.issue_count ?? 0), completeness_percent: row.completeness_percent === null || row.completeness_percent === undefined ? null : Number(row.completeness_percent),
  }));
},

async getOperatorActivityReportSummary(startIso: string, endIso: string, stationId: string | null = null): Promise<OperatorActivityReportSummary> {
  const { data, error } = await supabase.rpc('get_operator_activity_report_summary', { p_start: startIso, p_end: endIso, p_station_id: stationId });
  if (error) throw error;
  const row = data?.[0];
  return { entries_created: Number(row?.entries_created ?? 0), rows_subsequently_updated: Number(row?.rows_subsequently_updated ?? 0), missing_expected_entries: Number(row?.missing_expected_entries ?? 0), operators_active: Number(row?.operators_active ?? 0), stations_active: Number(row?.stations_active ?? 0) };
},

async getOperatorActivityReportPage(startIso: string, endIso: string, page: number, pageSize: number, stationId: string | null = null): Promise<OperatorActivityReportPage> {
  const { data, error } = await supabase.rpc('get_operator_activity_report_page', { p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), operator_id: row.operator_id === null || row.operator_id === undefined ? null : String(row.operator_id), station_name: String(row.station_name), feeder_name: row.feeder_name === null || row.feeder_name === undefined ? null : String(row.feeder_name),
    actual_event_time: String(row.actual_event_time), created_at: String(row.created_at), updated_at: String(row.updated_at), activity_state: row.activity_state === 'UPDATED' ? 'UPDATED' as const : 'CREATED' as const,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

async getNotificationDeliveryReportSummary(startIso: string, endIso: string, stationId: string | null = null, status: string | null = null): Promise<NotificationDeliveryReportSummary> {
  const { data, error } = await supabase.rpc('get_notification_delivery_report_summary', { p_start: startIso, p_end: endIso, p_station_id: stationId, p_status: status });
  if (error) throw error;
  const row = data?.[0];
  return { events: Number(row?.events ?? 0), intended_recipients: Number(row?.intended_recipients ?? 0), sent: Number(row?.sent ?? 0), failed: Number(row?.failed ?? 0), pending: Number(row?.pending ?? 0) };
},

async getNotificationDeliveryReportPage(startIso: string, endIso: string, page: number, pageSize: number, stationId: string | null = null, status: string | null = null): Promise<NotificationDeliveryReportPage> {
  const { data, error } = await supabase.rpc('get_notification_delivery_report_page', { p_start: startIso, p_end: endIso, p_page: page, p_page_size: pageSize, p_station_id: stationId, p_status: status });
  if (error) throw error;
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), event_time: String(row.event_time), source: String(row.source), station_name: String(row.station_name), intended_recipients: Number(row.intended_recipients ?? 0), sent: Number(row.sent ?? 0), failed: Number(row.failed ?? 0), pending: Number(row.pending ?? 0), delivery_message: row.delivery_message === null || row.delivery_message === undefined ? null : String(row.delivery_message),
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
},

/* =======================================================
     STATION LOAD TREND

     stationId:
       UUID → one station

       null → ALL STATIONS

     The DB/RLS remains responsible for deciding
     which records the authenticated user may read.
  ======================================================= */

  async getStationLoadTrend(
    stationId:
      string | null,

    date:
      string
  ): Promise<
    StationLoadTrendRow[]
  > {
    /*
     * date format:
     *
     * YYYY-MM-DD
     *
     * Operational timezone:
     * Asia/Kolkata
     */

    const start =
      new Date(
        `${date}T00:00:00+05:30`
      );

    const end =
      new Date(
        `${date}T00:00:00+05:30`
      );

    /*
     * Add one calendar day in UTC.
     *
     * Since the start already represents
     * midnight IST as a specific instant,
     * +24 hours gives next midnight IST.
     */

    end.setTime(
      end.getTime() +
        24 *
          60 *
          60 *
          1000
    );

    let query =
      supabase
        .from(
          'log_book_entries'
        )
        .select(
  'station_id,feeder_id,actual_event_time,mw'
  )
        .gte(
          'actual_event_time',
          start.toISOString()
        )
        .lt(
          'actual_event_time',
          end.toISOString()
        )
        .order(
          'actual_event_time',
          {
            ascending:
              true,
          }
        );

    /*
     * null means ALL STATIONS.
     */

    if (
      stationId
    ) {
      query =
        query.eq(
          'station_id',
          stationId
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (
      error
    ) {
      console.error('The station load trend could not be loaded.');

      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row
      ) => ({
        station_id:
          row.station_id,

        feeder_id:
          row.feeder_id,

        actual_event_time:
          row.actual_event_time,

        mw:
          row.mw ===
          null
            ? null
            : Number(
                row.mw
              ),
      })
    );
  },

  /* =======================================================
     PRIMARY OPERATOR STATION
  ======================================================= */

  async getMyPrimaryStationId():
    Promise<
      string | null
    > {
    const {
      data: {
        user,
      },

      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError
    ) {
      throw userError;
    }

    if (
      !user
    ) {
      return null;
    }

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'user_stations'
        )
        .select(
          'station_id'
        )
        .eq(
          'user_id',
          user.id
        )
        .limit(
          1
        )
        .maybeSingle();

    if (
      error
    ) {
      throw error;
    }

    return (
      data?.station_id ??
      null
    );
  },

  /* =======================================================
     ACCESSIBLE STATIONS

     Current DB function logic:

     OPERATOR
     → assigned station(s)

     FIELD_OFFICER
     → all active stations

     ADMIN
     → all active stations
  ======================================================= */

  async getMyAccessibleStationIds():
    Promise<
      string[]
    > {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_my_accessible_station_ids'
      );

    if (
      error
    ) {
      console.error('Accessible stations could not be loaded.');

      throw error;
    }

    return (
      data ??
      []
    )
      .map(
        (
          row: {
            station_id:
              string;
          }
        ) =>
          row.station_id
      )
      .filter(
        Boolean
      );
  },

  async getMyOperationalStationIds(): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_my_operational_station_ids');
    if (error) throw error;
    return (data ?? [])
      .map((row: { station_id: string }) => row.station_id)
      .filter(Boolean);
  },

  /* =======================================================
     GET ONE OPERATOR LOG ENTRY
  ======================================================= */

  async getOperatorLogEntry(
    stationId:
      string,

    feederId:
      string,

    date:
      string,

    hour:
      string
  ) {
    /*
     * Explicit +05:30 avoids depending on
     * device/browser timezone.
     *
     * hour example:
     * 08:00
     */

    const start =
      new Date(
        `${date}T${hour}:00+05:30`
      );

    const end =
      new Date(
        start.getTime() +
          60 *
            60 *
            1000
      );

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'log_book_entries'
        )
        .select(
          '*'
        )
        .eq(
          'station_id',
          stationId
        )
        .eq(
          'feeder_id',
          feederId
        )
        .gte(
          'actual_event_time',
          start.toISOString()
        )
        .lt(
          'actual_event_time',
          end.toISOString()
        )
        .maybeSingle();

    if (
      error
    ) {
      throw error;
    }

    return data;
  },

  /* =======================================================
     UPDATE LOG ENTRY
  ======================================================= */

  async updateLogEntry(
    id:
      string,

    row:
      Record<
        string,
        unknown
      >
  ): Promise<LogBookEntry> {
    const eventTime = typeof row.actual_event_time === 'string' ? row.actual_event_time : undefined;
    return restPatch<LogBookEntry>(
      'log_book_entries',
      { id },
      row,
      'logbook:all',
      {
        operationType: 'UPDATE_LOG_ENTRY',
        eventTime,
        recordedAt: Date.now(),
        entryMode: 'OFFLINE',
      }
    );
  },

  /* =======================================================
     MONTHLY OPERATOR ENTRY STATUS
  ======================================================= */

  async getOperatorMonthEntryStatus(
    stationId:
      string,

    year:
      number,

    month:
      number
  ) {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_logbook_month_status',
        {
          p_station_id:
            stationId,

          p_year:
            year,

          p_month:
            month,
        }
      );

    if (
      error
    ) {
      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row:
          MonthStatusRpcRow
      ) => ({
        date:
          row.entry_date,

        enteredSlots:
          Number(
            row.entered_slots
          ),

        expectedSlots:
          Number(
            row.expected_slots
          ),

        status:
          row.fill_status,
      })
    );
  },

  /* =======================================================
     SINGLE STATION DAY/HOUR STATUS
  ======================================================= */

  async getOperatorDayHourStatus(
    stationId:
      string,

    date:
      string
  ) {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        'get_logbook_day_hour_status',
        {
          p_station_id:
            stationId,

          p_date:
            date,
        }
      );

    if (
      error
    ) {
      throw error;
    }

    return (
      data ??
      []
    ).map(
      (
        row:
          HourStatusRpcRow
      ) => ({
        hour:
          Number(
            row.hour_no
          ),

        entered:
          Number(
            row.entered_feeders
          ),

        total:
          Number(
            row.total_feeders
          ),

        status:
          row.fill_status,
      })
    );
  },

  /* =======================================================
     STATIONS
  ======================================================= */

  async getStations():
    Promise<
      Station[]
    > {
    return restGet<
      Station
    >(
      'stations',

      'order=name.asc',

      'stations'
    );
  },

  /* =======================================================
     FEEDERS
  ======================================================= */

  async getFeeders(
    stationId?:
      string
  ): Promise<
    Feeder[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=name.asc`
        : 'order=name.asc';

    return restGet<
      Feeder
    >(
      'feeders',

      query,

      `feeders:${
        stationId ??
        'all'
      }`
    );
  },

  /* =======================================================
     PEAK LOAD
  ======================================================= */

  async getPeakLoad(
    stationId:
      string,

    days =
      31
  ): Promise<
    PeakLoadReading[]
  > {
    const since =
      new Date(
        Date.now() -
          days *
            86400_000
      ).toISOString();

    const query =
      `station_id=eq.${encodeURIComponent(
        stationId
      )}` +
      `&recorded_at=gte.${encodeURIComponent(
        since
      )}` +
      `&order=recorded_at.asc`;

    return restGet<
      PeakLoadReading
    >(
      'peak_load_readings',

      query,

      `peak:${stationId}:${days}`
    );
  },

  async addPeakLoad(
    row:
      Omit<
        PeakLoadReading,
        'id' |
          'created_at'
      >
  ): Promise<
    PeakLoadReading
  > {
    return restPost<
      PeakLoadReading
    >(
      'peak_load_readings',

      row,

      `peak:${row.station_id}`
    );
  },

  /* =======================================================
     INTERRUPTIONS
  ======================================================= */

  async getInterruptions(
    stationId?:
      string,

    status?:
      InterruptionStatus,

    startIso?: string,

    endIso?: string
  ): Promise<
    Interruption[]
  > {
    const filters:
      string[] = [];

    if (
      stationId
    ) {
      filters.push(
        `station_id=eq.${encodeURIComponent(
          stationId
        )}`
      );
    }

    if (
      status
    ) {
      filters.push(
        `current_status=eq.${encodeURIComponent(
          status
        )}`
      );
    }

    if (startIso) {
      filters.push(`interruption_start=gte.${encodeURIComponent(startIso)}`);
    }

    if (endIso) {
      filters.push(`interruption_start=lt.${encodeURIComponent(endIso)}`);
    }

    filters.push(
      'order=interruption_start.desc'
    );

    const query =
      filters.join(
        '&'
      );

    return restGet<
      Interruption
    >(
      'interruptions',

      query,

      `interruptions:${
        stationId ??
        'all'
      }:${
        status ??
        'all'
      }:${startIso ?? 'all'}:${endIso ?? 'all'}`
    );
  },

  /* =======================================================
     CREATE INTERRUPTION
  ======================================================= */

  async addInterruption(
    row:
      NewInterruptionPayload
  ): Promise<
    Interruption
  > {
    const body = {
      ...row,

      current_status:
        row.current_status ??
        'OPEN',

      interruption_end:
        row.interruption_end ??
        null,
    };

    if (!isOnline()) {
      const queued = await enqueueInterruptionAdd(body, body.interruption_start, await getQueueOwnerUserId());
      return {
        ...body,
        id: queued.localEntityId as string,
        duration_minutes: row.duration_minutes ?? null,
        etr: row.etr ?? null,
      } as Interruption;
    }

    return restPost<
      Interruption
    >(
      'interruptions',

      body,

      'interruptions:all:all'
    );
  },

  /* =======================================================
     RESTORE INTERRUPTION
  ======================================================= */

  async restoreInterruption(
    id:
      string,

    restoreTime:
      string,

    localEntityId?:
      string
  ): Promise<
    Interruption
  > {
    if (!isOnline() && localEntityId?.startsWith('local:int:')) {
      await enqueueInterruptionRestore({
        body: {
          interruption_end: restoreTime,
          current_status: 'RESTORED',
        },
        eventTime: restoreTime,
        localEntityId,
        ownerUserId: await getQueueOwnerUserId(),
      });
      return {
        id: localEntityId,
        station_id: '',
        feeder_id: null,
        operator_id: null,
        interruption_start: restoreTime,
        interruption_end: restoreTime,
        duration_minutes: null,
        cause: null,
        remarks: null,
        current_status: 'RESTORED',
        etr: null,
      };
    }

    return restPatch<
      Interruption
    >(
      'interruptions',

      {
        id,
      },

      {
        interruption_end:
          restoreTime,

        current_status:
          'RESTORED',
      },

      'interruptions:all:all',

      {
        operationType: 'RESTORE_INTERRUPTION',
        eventTime: restoreTime,
        recordedAt: Date.now(),
        entryMode: 'OFFLINE',
        serverEntityId: id,
      }
    );
  },

  async getOpenInterruptionsForStation(stationId: string, limit = 100): Promise<Interruption[]> {
    const query =
      `station_id=eq.${encodeURIComponent(stationId)}` +
      '&current_status=eq.OPEN' +
      '&order=interruption_start.desc' +
      `&limit=${Math.max(1, Math.min(limit, 100))}`;
    return restGet<Interruption>('interruptions', query, `interruptions:${stationId}:open`);
  },

  async getInterruptionsForPeriod(stationId: string, startIso: string, endIso: string, limit = 100): Promise<Interruption[]> {
    const query =
      `station_id=eq.${encodeURIComponent(stationId)}` +
      `&interruption_start=gte.${encodeURIComponent(startIso)}` +
      `&interruption_start=lt.${encodeURIComponent(endIso)}` +
      '&order=interruption_start.desc' +
      `&limit=${Math.max(1, Math.min(limit, 100))}`;
    return restGet<Interruption>('interruptions', query, `interruptions:${stationId}:${startIso}:${endIso}`);
  },

  async updateInterruptionEtr(id: string, etr: string | null): Promise<void> {
    const ownerUserId = await getQueueOwnerUserId();
    if (id.startsWith('local:int:')) {
      await updateQueuedInterruptionAddEtr(id, etr, ownerUserId);
      return;
    }

    await restPatch<Interruption>(
      'interruptions',
      { id },
      { etr },
      'interruptions:all:all',
      {
        operationType: 'UPDATE_INTERRUPTION_ETR',
        eventTime: new Date().toISOString(),
        recordedAt: Date.now(),
        entryMode: 'OFFLINE',
        serverEntityId: id,
      }
    );
  },

  /* =======================================================
     CANCEL INTERRUPTION
  ======================================================= */

  async cancelInterruption(
    id:
      string
  ): Promise<
    Interruption
  > {
    return restPatch<
      Interruption
    >(
      'interruptions',

      {
        id,
      },

      {
        current_status:
          'CANCELLED',
      },

      'interruptions:all:all'
    );
  },

  /* =======================================================
     OVERLOAD ALERTS
  ======================================================= */

  async getOverloadAlerts(
    stationId?:
      string
  ): Promise<
    OverloadAlert[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=alert_time.desc`
        : 'order=alert_time.desc';

    return restGet<
      OverloadAlert
    >(
      'overload_alerts',

      query,

      `overload:${
        stationId ??
        'all'
      }`
    );
  },

  async addOverloadAlert(
    row:
      NewOverloadAlert
  ): Promise<
    OverloadAlert
  > {
    return restPost<
      OverloadAlert
    >(
      'overload_alerts',

      row,

      `overload:${row.station_id}`
    );
  },

  async acknowledgeAlert(
    id:
      string
  ): Promise<
    OverloadAlert
  > {
    return restPatch<
      OverloadAlert
    >(
      'overload_alerts',

      {
        id,
      },

      {
        acknowledged:
          true,
      },

      'overload:all'
    );
  },

  /* =======================================================
     RELIABILITY
  ======================================================= */

  async getReliability(
    stationId?:
      string
  ): Promise<
    ReliabilityIndex[]
  > {
    const query =
      stationId
        ? `station_id=eq.${encodeURIComponent(
            stationId
          )}&order=month.desc`
        : 'order=month.desc';

    return restGet<
      ReliabilityIndex
    >(
      'reliability_indices',

      query,

      `reliability:${
        stationId ??
        'all'
      }`
    );
  },

  async addReliability(
    row:
      NewReliabilityIndex
  ): Promise<
    ReliabilityIndex
  > {
    return restPost<
      ReliabilityIndex
    >(
      'reliability_indices',

      row,

      `reliability:${row.station_id}`
    );
  },

  /* =======================================================
     LOG BOOK
  ======================================================= */

  async getLogBook(
    stationId:
      string,

    limit =
      100
  ): Promise<
    LogBookEntry[]
  > {
    /*
     * Correct current schema:
     *
     * actual_event_time
     *
     * The old entry_date / entry_time columns
     * no longer exist.
     */

    const query =
      `station_id=eq.${encodeURIComponent(
        stationId
      )}` +
      `&order=actual_event_time.desc` +
      `&limit=${limit}`;

    return restGet<
      LogBookEntry
    >(
      'log_book_entries',

      query,

      `logbook:${stationId}`
    );
  },

  async getLogBookForPeriod(stationId: string, startIso: string, endIso: string, limit = 200): Promise<LogBookEntry[]> {
    const query =
      `station_id=eq.${encodeURIComponent(stationId)}` +
      `&actual_event_time=gte.${encodeURIComponent(startIso)}` +
      `&actual_event_time=lt.${encodeURIComponent(endIso)}` +
      '&order=actual_event_time.desc' +
      `&limit=${Math.max(1, Math.min(limit, 200))}`;
    return restGet<LogBookEntry>('log_book_entries', query, `logbook:${stationId}:${startIso}:${endIso}`);
  },

  async getParameterAlerts(
    stationId?: string,
    startIso?: string,
    endIso?: string
  ): Promise<ParameterAlert[]> {
    let query = supabase
      .from('parameter_alerts')
      .select('id,station_id,feeder_id,parameter_code,actual_value,min_value,max_value,breach_type,triggered_at,notification_class,source_entry_mode,source_recorded_at,source_synced_at,is_current,notification_suppressed,feeders(name)')
      .order('triggered_at', { ascending: false });

    if (stationId) {
      query = query.eq('station_id', stationId);
    }

    if (startIso) {
      query = query.gte('triggered_at', startIso);
    }

    if (endIso) {
      query = query.lt('triggered_at', endIso);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row) => {
      const feeder = row.feeders as { name?: string | null } | null;
      return {
        id: row.id,
        station_id: row.station_id,
        feeder_id: row.feeder_id,
        feeder_name: feeder?.name ?? null,
        parameter_code: row.parameter_code,
        actual_value: Number(row.actual_value),
        min_value: row.min_value === null ? null : Number(row.min_value),
        max_value: row.max_value === null ? null : Number(row.max_value),
        breach_type: row.breach_type as 'BELOW_MIN' | 'ABOVE_MAX',
        triggered_at: row.triggered_at,
        notification_class: row.notification_class as NotificationClass | null,
        source_entry_mode: row.source_entry_mode as OperationalEntryMode | null,
        source_recorded_at: row.source_recorded_at,
        source_synced_at: row.source_synced_at,
        is_current: row.is_current,
        notification_suppressed: row.notification_suppressed,
      };
    });
  },

  async getCurrentParameterAlerts(stationId: string, limit = 100): Promise<ParameterAlert[]> {
    const { data, error } = await supabase
      .from('parameter_alerts')
      .select('id,station_id,feeder_id,parameter_code,actual_value,min_value,max_value,breach_type,triggered_at,notification_class,source_entry_mode,source_recorded_at,source_synced_at,is_current,notification_suppressed,feeders(name)')
      .eq('station_id', stationId)
      .eq('is_current', true)
      .order('triggered_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 100)));
    if (error) throw error;
    return (data ?? []).map((row) => {
      const feeder = row.feeders as { name?: string | null } | null;
      return {
        id: row.id, station_id: row.station_id, feeder_id: row.feeder_id, feeder_name: feeder?.name ?? null,
        parameter_code: row.parameter_code, actual_value: Number(row.actual_value),
        min_value: row.min_value === null ? null : Number(row.min_value), max_value: row.max_value === null ? null : Number(row.max_value),
        breach_type: row.breach_type as 'BELOW_MIN' | 'ABOVE_MAX', triggered_at: row.triggered_at,
        notification_class: row.notification_class as NotificationClass | null,
        source_entry_mode: row.source_entry_mode as OperationalEntryMode | null,
        source_recorded_at: row.source_recorded_at, source_synced_at: row.source_synced_at,
        is_current: row.is_current, notification_suppressed: row.notification_suppressed,
      };
    });
  },

  async getInterruptionReportSummary(
    startIso: string,
    endIso: string,
    stationId: string | null = null,
    feederId: string | null = null,
    status: InterruptionStatus | null = null,
    cause: string | null = null
  ): Promise<InterruptionReportSummary> {
    const { data, error } = await supabase.rpc('get_interruption_report_summary', {
      p_start: startIso, p_end: endIso, p_station_id: stationId,
      p_feeder_id: feederId, p_status: status, p_cause: cause,
    });
    if (error) throw error;
    const row = data?.[0];
    return {
      total_interruptions: Number(row?.total_interruptions ?? 0),
      open_interruptions: Number(row?.open_interruptions ?? 0),
      total_duration_minutes: Number(row?.total_duration_minutes ?? 0),
      average_restoration_minutes: row?.average_restoration_minutes === null || row?.average_restoration_minutes === undefined ? null : Number(row.average_restoration_minutes),
      longest_interruption_minutes: row?.longest_interruption_minutes === null || row?.longest_interruption_minutes === undefined ? null : Number(row.longest_interruption_minutes),
    };
  },

  async getInterruptionReportTrend(
    startIso: string, endIso: string, stationId: string | null = null, feederId: string | null = null,
    status: InterruptionStatus | null = null, cause: string | null = null
  ): Promise<InterruptionReportTrendRow[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_trend', {
      p_start: startIso, p_end: endIso, p_station_id: stationId, p_feeder_id: feederId, p_status: status, p_cause: cause,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      date: String(row.date), interruption_count: Number(row.interruption_count ?? 0),
      duration_minutes: Number(row.duration_minutes ?? 0), open_count: Number(row.open_count ?? 0),
    }));
  },

  async getInterruptionReportBreakdown(
    startIso: string, endIso: string, group: 'STATION' | 'FEEDER' | 'CAUSE', stationId: string | null = null,
    feederId: string | null = null, status: InterruptionStatus | null = null, cause: string | null = null, limit = 5
  ): Promise<InterruptionReportBreakdownRow[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_breakdown', {
      p_start: startIso, p_end: endIso, p_group: group, p_station_id: stationId,
      p_feeder_id: feederId, p_status: status, p_cause: cause, p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      label: String(row.label ?? 'Not recorded'), interruption_count: Number(row.interruption_count ?? 0),
      duration_minutes: Number(row.duration_minutes ?? 0),
    }));
  },

  async getInterruptionReportCauses(): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_interruption_report_causes');
    if (error) throw error;
    return (data ?? []).map((row: { cause: string | null }) => row.cause).filter((cause: string | null): cause is string => Boolean(cause));
  },

  async getInterruptionReportPage(
    startIso: string, endIso: string, accessibleStationIds: string[], page: number, pageSize: number,
    stationId: string | null = null, feederId: string | null = null,
    status: InterruptionStatus | null = null, cause: string | null = null
  ): Promise<InterruptionReportPage> {
    if (accessibleStationIds.length === 0) return { rows: [], total: 0 };
    let query = supabase
      .from('scoped_interruption_report_entries')
      .select('id,station_id,feeder_id,operator_id,operator_name,interruption_start,interruption_end,duration_minutes,cause,remarks,current_status,etr,created_at,updated_at', { count: 'exact' })
      .in('station_id', accessibleStationIds)
      .lt('interruption_start', endIso)
      .or(`current_status.eq.OPEN,interruption_start.gte.${startIso},interruption_end.gte.${startIso}`)
      .order('interruption_start', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (stationId) query = query.eq('station_id', stationId);
    if (feederId) query = query.eq('feeder_id', feederId);
    if (status) query = query.eq('current_status', status);
    if (cause) query = query.eq('cause', cause);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: (data ?? []) as Interruption[], total: count ?? 0 };
  },

  async getStationConditionReportPage(
    startIso: string,
    endIso: string,
    accessibleStationIds: string[],
    page: number,
    pageSize: number,
    stationId: string | null = null,
    status: 'OPEN' | 'RECTIFIED' | null = null,
  ): Promise<{ rows: StationCondition[]; total: number }> {
    if (accessibleStationIds.length === 0) return { rows: [], total: 0 };
    let query = supabase
      .from('station_conditions')
      .select('id,station_id,observed_at,category,equipment_area,condition,observation,status,recorded_by,created_at,updated_at,rectified_at,rectified_by,client_operation_id,entry_mode,recorded_at,synced_at', { count: 'exact' })
      .in('station_id', accessibleStationIds)
      .gte('observed_at', startIso)
      .lt('observed_at', endIso)
      .order('observed_at', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (stationId) query = query.eq('station_id', stationId);
    if (status) query = query.eq('status', status);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: (data ?? []) as StationCondition[], total: count ?? 0 };
  },

  async getFeedersForStations(
    stationIds: string[]
  ): Promise<Feeder[]> {
    if (stationIds.length === 0) return [];
    const { data, error } = await supabase
      .from('feeders')
      .select('id,station_id,code,name,voltage_level_kv,active,created_at,updated_at')
      .in('station_id', stationIds)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Feeder[];
  },

  async getLogBookReportSummary(
    startIso: string,
    endIso: string,
    stationId: string | null = null,
    feederId: string | null = null
  ): Promise<LogBookReportSummary> {
    const { data, error } = await supabase.rpc(
      'get_logbook_report_summary',
      {
        p_start: startIso,
        p_end: endIso,
        p_station_id: stationId,
        p_feeder_id: feederId,
      }
    );

    if (error) throw error;
    const row = data?.[0];
    return {
      entered_readings: Number(row?.entered_readings ?? 0),
      expected_readings: Number(row?.expected_readings ?? 0),
      completeness_percent: Number(row?.completeness_percent ?? 0),
      feeders_reported: Number(row?.feeders_reported ?? 0),
      missing_feeder_hours: Number(row?.missing_feeder_hours ?? 0),
    };
  },

  async getLogBookReportPage(
    startIso: string,
    endIso: string,
    accessibleStationIds: string[],
    page: number,
    pageSize: number,
    stationId: string | null = null,
    feederId: string | null = null
  ): Promise<LogBookReportPage> {
    if (accessibleStationIds.length === 0) return { rows: [], total: 0 };

    let query = supabase
      .from('scoped_logbook_report_entries')
      .select(
        'id,station_id,feeder_id,operator_id,operator_name,actual_event_time,mw,mvar,voltage_kv,current_a,power_factor,frequency_hz,transformer_temp_c,oil_level_percent,tap_position,weather,remarks,created_at,updated_at',
        { count: 'exact' }
      )
      .in('station_id', accessibleStationIds)
      .gte('actual_event_time', startIso)
      .lt('actual_event_time', endIso)
      .order('actual_event_time', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (stationId) query = query.eq('station_id', stationId);
    if (feederId) query = query.eq('feeder_id', feederId);

    const { data, error, count } = await query;
    if (error) throw error;
    return {
      rows: (data ?? []) as LogBookEntry[],
      total: count ?? 0,
    };
  },

  async addLogEntry(
    row:
      NewLogBookEntry
  ): Promise<
    LogBookEntry
  > {
    return restPost<
      LogBookEntry
    >(
      'log_book_entries',

      row,

      `logbook:${row.station_id}`,

      {
        operationType: 'ADD_LOG_ENTRY',
        eventTime: row.actual_event_time,
        recordedAt: Date.now(),
        entryMode: 'OFFLINE',
      }
    );
  },

  /* =======================================================
     PUSH TOKENS
  ======================================================= */

  async getPushTokens():
    Promise<
      PushToken[]
    > {
    return restGet<
      PushToken
    >(
      'push_tokens',

      'order=created_at.desc',

      'push_tokens'
    );
  },

  async registerPushToken(
    token:
      string
  ): Promise<
    PushToken
  > {
    return restPost<
      PushToken
    >(
      'push_tokens',

      {
        token,

        enabled:
          true,
      },

      'push_tokens'
    );
  },

  async setPushEnabled(
    id:
      string,

    enabled:
      boolean
  ): Promise<
    PushToken
  > {
    return restPatch<
      PushToken
    >(
      'push_tokens',

      {
        id,
      },

      {
        enabled,
      },

      'push_tokens'
    );
  },
};

/* =========================================================
   OFFLINE QUEUE FLUSHER
========================================================= */

let activeFlush: Promise<{ ok: number; failed: number }> | null = null;
let activeFlushOwnerUserId: string | null = null;

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  const ownerUserId = await getQueueOwnerUserId();
  if (activeFlush) {
    if (activeFlushOwnerUserId === ownerUserId) return activeFlush;
    await activeFlush;
    return flushQueue();
  }
  activeFlushOwnerUserId = ownerUserId;
  activeFlush = flushQueueInternal(ownerUserId).finally(() => { activeFlush = null; activeFlushOwnerUserId = null; });
  return activeFlush;
}

export async function retryQueuedOperation(operationId: string): Promise<{ ok: number; failed: number }> {
  const ownerUserId = await getQueueOwnerUserId();
  if (activeFlush) {
    await activeFlush;
    return retryQueuedOperation(operationId);
  }
  activeFlushOwnerUserId = ownerUserId;
  activeFlush = flushQueueInternal(ownerUserId, operationId, true).finally(() => { activeFlush = null; activeFlushOwnerUserId = null; });
  return activeFlush;
}

async function flushQueueInternal(ownerUserId: string, targetOperationId?: string, includeNeedsAttention = false):
  Promise<{
    ok: number;
    failed: number;
  }> {
  if (!isQueueSyncAuthorized(ownerUserId)) {
    throw new Error('GridVision access must be revalidated online before pending changes can sync.');
  }
  const queue = await getQueue(ownerUserId);
  const allowedOperationIds = new Set<string>();
  if (targetOperationId) {
    const target = queue.find((op) => op.id === targetOperationId || op.clientOperationId === targetOperationId);
    if (!target) return { ok: 0, failed: 0 };
    const includeWithDependencies = (operation: QueuedOp) => {
      if (allowedOperationIds.has(operation.id)) return;
      operation.dependsOn?.forEach((dependencyId) => {
        const dependency = queue.find((candidate) => candidate.id === dependencyId || candidate.clientOperationId === dependencyId);
        if (dependency) includeWithDependencies(dependency);
      });
      allowedOperationIds.add(operation.id);
    };
    includeWithDependencies(target);
  }
  if (!(await queueSyncSessionIsCurrent(ownerUserId))) {
    throw new Error('The signed-in user changed before synchronization could start.');
  }
  await recordSyncStarted(ownerUserId);

  let ok =
    0;

  let failed =
    0;
  const failureCategories: SyncFailureCategory[] = [];
  let sessionChanged = false;
  const logBookOperationsWithLaterReading = queuedLogBookOperationsWithLaterReading(queue);

  for (
    const op of
    queue
  ) {
    if (!(await queueSyncSessionIsCurrent(ownerUserId))) { sessionChanged = true; break; }
    if (targetOperationId && !allowedOperationIds.has(op.id)) continue;
    if (!includeNeedsAttention && op.syncState === 'NEEDS_ATTENTION') continue;
    const currentOp = await getQueuedOp(op.id, ownerUserId);
    if (!currentOp) continue;

    const historicalRestore = currentOp.operationType === 'ADD_INTERRUPTION'
      ? (await getQueue(ownerUserId)).find((candidate) =>
          candidate.operationType === 'RESTORE_INTERRUPTION'
          && candidate.table === 'interruptions'
          && candidate.dependsOn?.includes(currentOp.id))
      : undefined;

    if (historicalRestore) {
      if (!includeNeedsAttention && historicalRestore.syncState === 'NEEDS_ATTENTION') continue;
      try {
        await runHistoricalInterruptionPair(currentOp, historicalRestore, ownerUserId);
        try { await dequeueOps([currentOp.id, historicalRestore.id]); }
        catch (cause) { throw new QueuedLocalCompletionError(cause); }
        ok += 2;
      } catch (cause) {
        if (cause instanceof QueuedSyncSessionChangedError) { sessionChanged = true; break; }
        if (cause instanceof QueuedLocalCompletionError) {
          failed += 2;
          await recordStorageFailure(ownerUserId);
          continue;
        }
        failed += 2;
        for (const failedOp of [currentOp, historicalRestore]) {
          try {
            const failure = queuedFailureMetadata(cause, failedOp);
            if (failure.failureCategory) failureCategories.push(failure.failureCategory);
            await updateQueuedOp(failedOp.id, {
              retryCount: failedOp.retryCount + 1,
              ...failure,
            });
          } catch {
            /* Both operations remain queued if diagnostic persistence fails. */
          }
        }
      }
      continue;
    }

    if (currentOp.dependsOn && (await Promise.all(currentOp.dependsOn.map((dependency) => getQueuedOp(dependency, ownerUserId)))).some(Boolean)) {
      if (currentOp.failureCategory !== 'DEPENDENCY') {
        await updateQueuedOp(currentOp.id, {
          failureCategory: 'DEPENDENCY',
          syncState: 'PENDING',
          lastError: 'Waiting for the related trip record to synchronize.',
        });
      }
      continue;
    }

    try {
      const replayResult = await runQueued(
        currentOp,
        ownerUserId,
        !logBookOperationsWithLaterReading.has(currentOp.id),
      );

      if (currentOp.operationType === 'ADD_INTERRUPTION') {
        if (!replayResult.serverEntityId) throw new Error('Interruption replay succeeded without a server record identifier.');
        try { await completeQueuedInterruptionAdd(currentOp.id, replayResult.serverEntityId); }
        catch (cause) { throw new QueuedLocalCompletionError(cause); }
      } else {
        try { await dequeueOp(currentOp.id); }
        catch (cause) { throw new QueuedLocalCompletionError(cause); }
      }

      ok +=
        1;
    } catch (cause) {
      if (cause instanceof QueuedSyncSessionChangedError) { sessionChanged = true; break; }
      if (cause instanceof QueuedLocalCompletionError) {
        failed += 1;
        await recordStorageFailure(ownerUserId);
        continue;
      }
      failed +=
        1;

      try {
        const failure = queuedFailureMetadata(cause, currentOp);
        if (failure.failureCategory) failureCategories.push(failure.failureCategory);
        await updateQueuedOp(currentOp.id, {
          retryCount: currentOp.retryCount + 1,
          ...failure,
        });
      } catch {
        /* The operation remains queued if diagnostic persistence fails. */
      }
    }
  }

  if (ok > 0) {
    try { await recordSuccessfulQueueSync(ownerUserId); } catch { /* Successful replay remains authoritative if status metadata cannot be written. */ }
  }

  const dominantFailureCategory = failureCategories.length
    ? [...failureCategories].sort((left, right) => failureCategories.filter((item) => item === right).length - failureCategories.filter((item) => item === left).length)[0]
    : null;
  if (!sessionChanged) await recordSyncCompleted(ownerUserId, { ok, failed, dominantFailureCategory });

  return { ok, failed };
}

async function getQueueOwnerUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id;
  if (!userId) throw new Error('An authenticated session is required to save offline operations.');
  return userId;
}

async function queueSyncSessionIsCurrent(ownerUserId: string): Promise<boolean> {
  if (!isQueueSyncAuthorized(ownerUserId)) return false;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === ownerUserId;
}

function queuedBody(op: QueuedOp): Record<string, unknown> {
  if (!op.body || typeof op.body !== 'object' || Array.isArray(op.body)) {
    throw new Error('Invalid queued interruption data.');
  }
  return op.body as Record<string, unknown>;
}

function requiredQueuedString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing queued interruption ${key}.`);
  return value;
}

async function runHistoricalInterruptionPair(addOp: QueuedOp, restoreOp: QueuedOp, ownerUserId: string): Promise<string> {
  const add = queuedBody(addOp);
  const restore = queuedBody(restoreOp);
  const headers = await getAuthHeaders();
  if (!(await queueSyncSessionIsCurrent(ownerUserId))) throw new QueuedSyncSessionChangedError();
  const response = await fetch(`${REST_URL}/rpc/sync_historical_interruption`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_station_id: requiredQueuedString(add, 'station_id'),
      p_feeder_id: requiredQueuedString(add, 'feeder_id'),
      p_interruption_start: requiredQueuedString(add, 'interruption_start'),
      p_interruption_end: requiredQueuedString(restore, 'interruption_end'),
      p_cause: typeof add.cause === 'string' ? add.cause : null,
      p_remarks: typeof add.remarks === 'string' ? add.remarks : null,
      p_etr: typeof add.etr === 'string' ? add.etr : null,
      p_add_recorded_at: new Date(addOp.recordedAt).toISOString(),
      p_restore_recorded_at: new Date(restoreOp.recordedAt).toISOString(),
      p_add_client_operation_id: addOp.clientOperationId,
      p_restore_client_operation_id: restoreOp.clientOperationId,
    }),
  });
  if (!response.ok) throw await readQueuedReplayError(response);
  const id = await response.json() as unknown;
  if (typeof id !== 'string' || !id) throw new Error('Historical interruption sync returned no server identifier.');
  return id;
}

function queuedFailureMetadata(cause: unknown, operation: QueuedOp): Pick<QueuedOp, 'failureCategory' | 'syncState' | 'lastError' | 'lastAttemptAt'> & Partial<Pick<QueuedOp, 'lastHttpStatus' | 'lastDatabaseCode' | 'lastDiagnostic'>> {
  const status = cause instanceof QueuedReplayError ? cause.status : undefined;
  const databaseCode = cause instanceof QueuedReplayError ? cause.postgresCode ?? undefined : undefined;
  let failureCategory: SyncFailureCategory = 'UNKNOWN';
  if (cause instanceof QueuedDependencyError) failureCategory = 'DEPENDENCY';
  else if (!(cause instanceof QueuedReplayError) && (!isOnline() || cause instanceof TypeError)) failureCategory = 'TRANSIENT';
  else if (status === 401 || status === 403 || databaseCode === '42501') failureCategory = 'AUTHORIZATION';
  else if (status === 409 || databaseCode === '23505' || databaseCode === '23P01') failureCategory = 'CONFLICT';
  else if (status === 408 || status === 429 || (status !== undefined && status >= 500)) failureCategory = 'TRANSIENT';
  else if (status === 400 || status === 422 || databaseCode?.startsWith('22') || ['23502', '23503', '23514'].includes(databaseCode ?? '')) failureCategory = 'VALIDATION';

  const dutyAuthorizationFailure = databaseCode === '42501';
  const authorization = dutyAuthorizationFailure
    ? offlineOperationalAuthorizationFailure(cause, status)
    : null;
  const lastError = failureCategory === 'TRANSIENT'
    ? 'GridVision could not reach the server. It will retry when connectivity is available.'
    : failureCategory === 'AUTHORIZATION'
      ? dutyAuthorizationFailure
        ? operation.entryMode === 'OFFLINE'
          ? OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE
          : OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE
        : 'Your access changed before this record could synchronize. The record remains safely stored on this device.'
      : failureCategory === 'CONFLICT' && operation.table === 'interruptions'
        ? 'This feeder already has an open interruption on the server. Review the current interruption before retrying.'
        : failureCategory === 'CONFLICT' && operation.table === 'log_book_entries'
          ? 'A server record already exists for this feeder and hour. Review the latest record before deciding how to proceed.'
          : failureCategory === 'VALIDATION'
            ? 'The server rejected this record. Review the entry before retrying.'
            : failureCategory === 'DEPENDENCY'
              ? 'Waiting for the related trip record to synchronize.'
              : 'The record could not synchronize. It remains safely stored for review.';
  return {
    failureCategory,
    syncState: failureCategory === 'CONFLICT' || failureCategory === 'VALIDATION' || failureCategory === 'AUTHORIZATION' || failureCategory === 'UNKNOWN' ? 'NEEDS_ATTENTION' : 'PENDING',
    lastError,
    lastAttemptAt: Date.now(),
    lastHttpStatus: status,
    lastDatabaseCode: databaseCode?.slice(0, 20),
    lastDiagnostic: authorization?.diagnostic.technicalMessage ?? undefined,
  };
}

/* =========================================================
   RUN QUEUED OPERATION
========================================================= */

async function runQueued(
  op:
    QueuedOp,
  ownerUserId: string,
  offlineSequenceFinal: boolean,
): Promise<{ serverEntityId?: string }> {
  if (op.operationType === 'ADD_STATION_CONDITION') {
    const input = conditionInput(op.body);
    if (!input || op.table !== 'station_conditions' || op.method !== 'POST' || op.ownerUserId !== ownerUserId) {
      throw new Error('Invalid queued station condition.');
    }
    const headers = await getAuthHeaders();
    if (!(await queueSyncSessionIsCurrent(ownerUserId))) throw new QueuedSyncSessionChangedError();
    const args = stationConditionCreateArgs({ ...input,
      client_operation_id: op.clientOperationId, entry_mode: op.entryMode,
      recorded_at: new Date(op.recordedAt).toISOString(),
    });
    const response = await fetch(`${REST_URL}/rpc/create_station_condition`, {
      method: 'POST', headers,
      body: JSON.stringify(args),
    });
    if (import.meta.env.DEV) {
      // Diagnostics only: never emit the payload, identity, credentials or headers.
      // A fingerprint lets first-save and retry payloads be compared without their contents.
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(args)));
        const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        const body: unknown = response.ok ? null : await response.clone().json().catch(() => null);
        const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const safeMessages = [
          'Invalid observation or recording time/mode',
          'Station write access is not authorized',
          'Operation identifier already used for a different record',
        ];
        const serverTime = Date.parse(response.headers.get('date') ?? '');
        console.info('[StationCondition replay DEV]', {
          rpc: 'create_station_condition', operationType: op.operationType,
          attempt: op.retryCount + 1, entryMode: op.entryMode, payloadFingerprint: fingerprint,
          httpStatus: response.status,
          databaseCode: typeof error.code === 'string' && /^[A-Z0-9]{5,12}$/.test(error.code) ? error.code : null,
          safeMessage: typeof error.message === 'string' && safeMessages.includes(error.message)
            ? error.message : response.ok ? 'Accepted' : 'Backend message omitted: not in safe allowlist',
          // HTTP Date has one-second precision; deltas are diagnostic, not a clock correction.
          recordedAheadOfServerMs: Number.isFinite(serverTime) ? op.recordedAt - serverTime : null,
          observedAheadOfServerMs: Number.isFinite(serverTime) ? Date.parse(input.observed_at) - serverTime : null,
          navigatorOnline: isOnline(),
        });
      } catch { /* Diagnostics must never affect confirmation or queue retention. */ }
    }
    if (!response.ok) throw await readQueuedReplayError(response);
    const row: unknown = await response.json();
    if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string'
      || !('recorded_by' in row) || row.recorded_by !== ownerUserId
      || !('station_id' in row) || row.station_id !== input.station_id
      || !('client_operation_id' in row) || row.client_operation_id !== op.clientOperationId) {
      throw new Error('Station condition replay returned no confirmed record.');
    }
    return { serverEntityId: row.id };
  }
  if (op.operationType === 'RESTORE_INTERRUPTION' && !op.filter?.id) {
    throw new QueuedDependencyError();
  }

  const qs =
    op.filter
      ? Object.entries(
          op.filter
        )
          .map(
            ([
              key,
              value,
            ]) =>
              `${key}=eq.${encodeURIComponent(
                value
              )}`
          )
          .join(
            '&'
          )
      : '';

  const url =
    op.filter
      ? `${REST_URL}/${op.table}?${qs}`
      : `${REST_URL}/${op.table}`;

  const headers =
    await getAuthHeaders();
  if (!(await queueSyncSessionIsCurrent(ownerUserId))) throw new QueuedSyncSessionChangedError();

  const replayBody =
    buildQueuedReplayBody(op, offlineSequenceFinal);

  const res =
    await fetch(
      url,
      {
        method:
          op.method,

        headers: {
          ...headers,

          Prefer:
            'return=representation',
        },

        body:
          replayBody
            ? JSON.stringify(
                replayBody
              )
            : undefined,
      }
    );

  if (
    !res.ok
  ) {
    const replayError = await readQueuedReplayError(res);
    const existingServerId = await confirmedClientOperationDuplicateId(op, replayError, ownerUserId);
    if (existingServerId) return { serverEntityId: existingServerId };
    throw replayError;
  }

  if (op.operationType === 'ADD_INTERRUPTION') {
    const rows = await res.json() as Array<{ id?: unknown }>;
    const serverEntityId = Array.isArray(rows) && typeof rows[0]?.id === 'string' ? rows[0].id : undefined;
    return { serverEntityId };
  }

  return {};
}

const IDEMPOTENT_OPERATION_TABLES = new Set(['log_book_entries', 'interruptions']);

type PostgrestErrorBody = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

class QueuedReplayError extends Error {
  constructor(
    readonly status: number,
    readonly postgresCode: string | null,
    readonly diagnosticMessage: string | null,
  ) {
    super(`Queued operation replay failed with HTTP ${status}`);
    this.name = 'QueuedReplayError';
  }
}

class QueuedDependencyError extends Error {
  constructor() {
    super('Pending interruption restore is waiting for its server record.');
    this.name = 'QueuedDependencyError';
  }
}

class QueuedSyncSessionChangedError extends Error {
  constructor() {
    super('The signed-in user changed while synchronization was running.');
    this.name = 'QueuedSyncSessionChangedError';
  }
}

class QueuedLocalCompletionError extends Error {
  constructor(readonly cause: unknown) {
    super('The server accepted the operation, but local completion could not be stored.');
    this.name = 'QueuedLocalCompletionError';
  }
}

function buildQueuedReplayBody(op: QueuedOp, offlineSequenceFinal: boolean): unknown {
  if (!IDEMPOTENT_OPERATION_TABLES.has(op.table) || (op.method !== 'POST' && op.method !== 'PATCH')) return op.body;
  if (!op.body || typeof op.body !== 'object' || Array.isArray(op.body)) return op.body;
  // An ETR revision is naturally idempotent. Preserve the interruption's
  // original create/restore provenance instead of replacing its operation IDs.
  if (op.operationType === 'UPDATE_INTERRUPTION_ETR') return op.body;

  const operationIdentity = op.table === 'interruptions' && op.operationType === 'RESTORE_INTERRUPTION'
    ? { restore_client_operation_id: op.clientOperationId }
    : { client_operation_id: op.clientOperationId };

  const parameterSequence = op.table === 'log_book_entries'
    ? { offline_sequence_final: offlineSequenceFinal }
    : {};

  return {
    ...(op.body as Record<string, unknown>),
    entry_mode: 'OFFLINE',
    recorded_at: new Date(op.recordedAt).toISOString(),
    synced_at: new Date().toISOString(),
    ...operationIdentity,
    ...parameterSequence,
  };
}

function queuedLogBookOperationsWithLaterReading(queue: QueuedOp[]): Set<string> {
  const latestByFeeder = new Map<string, number>();
  const rows: Array<{ id: string; feederKey: string; eventMillis: number }> = [];
  queue.forEach((operation) => {
    if (operation.table !== 'log_book_entries' || !operation.body || typeof operation.body !== 'object' || Array.isArray(operation.body)) return;
    const body = operation.body as Record<string, unknown>;
    const stationId = typeof body.station_id === 'string' ? body.station_id : null;
    const feederId = typeof body.feeder_id === 'string' ? body.feeder_id : null;
    const eventTime = typeof body.actual_event_time === 'string' ? body.actual_event_time : operation.eventTime;
    if (!stationId || !feederId || !eventTime) return;
    const eventMillis = Date.parse(eventTime);
    if (!Number.isFinite(eventMillis)) return;
    const feederKey = `${stationId}:${feederId}`;
    latestByFeeder.set(feederKey, Math.max(latestByFeeder.get(feederKey) ?? Number.NEGATIVE_INFINITY, eventMillis));
    rows.push({ id: operation.id, feederKey, eventMillis });
  });
  return new Set(rows.filter((row) => row.eventMillis < (latestByFeeder.get(row.feederKey) ?? row.eventMillis)).map((row) => row.id));
}

async function readQueuedReplayError(response: Response): Promise<QueuedReplayError> {
  let body: PostgrestErrorBody | null = null;
  try {
    body = await response.json() as PostgrestErrorBody;
  } catch {
    // Non-JSON failures remain ordinary retryable replay errors.
  }
  const diagnostic = operationalWriteDiagnostic(body, response.status);
  return new QueuedReplayError(
    response.status,
    typeof body?.code === 'string' ? body.code : null,
    diagnostic.technicalMessage,
  );
}

async function confirmedClientOperationDuplicateId(op: QueuedOp, error: QueuedReplayError, ownerUserId: string): Promise<string | null> {
  if (error.status !== 409 || error.postgresCode !== '23505') return null;
  if (!IDEMPOTENT_OPERATION_TABLES.has(op.table) || !op.clientOperationId) return null;
  const identityColumn = op.table === 'interruptions' && op.operationType === 'RESTORE_INTERRUPTION'
    ? 'restore_client_operation_id'
    : 'client_operation_id';
  return findByClientOperationId(op.table as 'log_book_entries' | 'interruptions', identityColumn, op.clientOperationId, ownerUserId);
}

async function findByClientOperationId(
  table: 'log_book_entries' | 'interruptions',
  identityColumn: 'client_operation_id' | 'restore_client_operation_id',
  clientOperationId: string,
  ownerUserId: string,
): Promise<string | null> {
  const headers = await getAuthHeaders();
  if (!(await queueSyncSessionIsCurrent(ownerUserId))) return null;
  const query = `${identityColumn}=eq.${encodeURIComponent(clientOperationId)}&select=id&limit=1`;
  const response = await fetch(`${REST_URL}/${table}?${query}`, { method: 'GET', headers });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ id?: unknown }>;
  const id = Array.isArray(rows) ? rows.find((row) => typeof row.id === 'string')?.id : undefined;
  return typeof id === 'string' ? id : null;
}
