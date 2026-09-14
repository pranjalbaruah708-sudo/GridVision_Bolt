export type StationConditionCategory = 'EQUIPMENT' | 'STATION_CONDITION' | 'DEFECT' | 'OTHER';
export type StationConditionValue = 'NORMAL' | 'ATTENTION' | 'ABNORMAL';
export type StationConditionStatus = 'OPEN' | 'RECTIFIED';

export interface StationCondition {
  id: string;
  station_id: string;
  observed_at: string;
  category: StationConditionCategory;
  equipment_area: string | null;
  condition: StationConditionValue;
  observation: string;
  status: StationConditionStatus;
  recorded_by: string;
  created_at: string;
  updated_at: string;
  rectified_at: string | null;
  rectified_by: string | null;
  client_operation_id: string;
  entry_mode: 'ONLINE' | 'OFFLINE';
  recorded_at: string;
  synced_at: string | null;
}

/** Keep client_operation_id stable across retries; recorder is always server-derived. */
export interface CreateStationConditionInput {
  station_id: string;
  observed_at: string;
  category: StationConditionCategory;
  equipment_area?: string | null;
  condition: StationConditionValue;
  observation: string;
  client_operation_id: string;
  entry_mode?: 'ONLINE' | 'OFFLINE';
  recorded_at?: string | null;
}

export type OperationalPeriod =
  | { period: 'TODAY' | 'THIS_MONTH'; from?: never; to?: never }
  | { period: 'CUSTOM'; from: string; to: string };
export type OperationalScope =
  | { kind: 'ALL' }
  | { kind: 'STATION'; id: string }
  | { kind: 'OFFICE'; id: string };
export type OperationalQuery = OperationalPeriod & { scope: OperationalScope };
export interface OperationalScopeOption {
  scope_kind: OperationalScope['kind'];
  scope_id: string | null;
  label: string;
  office_type: string | null;
}
export type OperationalEventType = 'PARAMETER_ENTRY' | 'INTERRUPTION' | 'RESTORATION' | 'ALERT'
  | 'STATION_CONDITION' | 'DUTY_STARTED' | 'DUTY_ENDED' | 'HANDOVER_SUBMITTED' | 'HANDOVER_ACCEPTED';
export interface OperationalTimelineEvent {
  event_type: OperationalEventType;
  source_id: string;
  event_time: string;
  station_id: string;
  feeder_id: string | null;
  equipment_area: string | null;
  title: string;
  details: string | null;
  severity: StationConditionValue | null;
  status: string | null;
}
export interface OperationalSummary {
  start_at: string;
  end_at: string;
  as_of: string;
  station_count: number;
  parameter_entries: number;
  interruptions_started: number;
  restorations: number;
  alerts: number;
  conditions_observed: number;
  /** Current snapshot across the scope, independent of the event period. */
  current_open_conditions: number;
  duty_starts: number;
  duty_ends: number;
  handovers_submitted: number;
  handovers_accepted: number;
}
