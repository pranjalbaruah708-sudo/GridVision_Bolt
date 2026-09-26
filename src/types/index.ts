export type Station = {
  id: string;
  code?: string;
  name: string;
  location: string | null;
  voltage_level_kv?: number | null;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type UserStationAssignment = {
  id?: string;
  user_id: string;
  station_id: string;

  /*
   * Current DB structure uses active.
   * Keep is_primary optional only if older code
   * still references it somewhere.
   */
  is_primary?: boolean;
  active?: boolean;

  assigned_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type Feeder = {
  id: string;
  station_id: string;
  code?: string;
  name: string;

  /*
   * Actual DB field is voltage_level_kv.
   * capacity_kv is retained as optional only
   * for compatibility with any older UI code.
   */
  voltage_level_kv?: number | null;
  capacity_kv?: number;

  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type PeakLoadReading = {
  id: string;
  feeder_id: string | null;
  station_id: string;

  reading_mw: number;
  voltage_kv: number;
  current_a: number;

  recorded_at: string;

  created_at?: string;
};

export type InterruptionReason =
  | 'Equipment Fault'
  | 'External Fault'
  | 'Scheduled Work'
  | 'Overload'
  | 'Others';

/* =========================================================
   INTERRUPTION
   Matches current interruptions table
========================================================= */

export type InterruptionStatus =
  | 'OPEN'
  | 'RESTORED'
  | 'CANCELLED';

export type OperationalEntryMode =
  | 'ONLINE'
  | 'OFFLINE';

export type NotificationClass =
  | 'LIVE'
  | 'DELAYED_SYNC'
  | 'HISTORICAL_SYNC';

export type Interruption = {
  id: string;

  station_id: string;
  feeder_id: string | null;
  operator_id: string | null;
  operator_name?: string | null;

  interruption_start: string;
  interruption_end: string | null;

  duration_minutes: number | null;

  cause: string | null;
  remarks: string | null;

  current_status: InterruptionStatus;

  etr: string | null;

  entry_mode?: OperationalEntryMode | null;
  recorded_at?: string | null;
  synced_at?: string | null;
  client_operation_id?: string | null;
  restore_client_operation_id?: string | null;

  created_at?: string;
  updated_at?: string;
};

export type NewInterruption = Omit<
  Interruption,
  | 'id'
  | 'duration_minutes'
  | 'created_at'
  | 'updated_at'
>;

/* =========================================================
   OVERLOAD ALERT
========================================================= */

export type OverloadAlert = {
  id: string;

  asset_id: string;

  asset_type:
    | 'Feeder'
    | 'Transformer';

  station_id: string;

  parameter: string;

  value: number;
  limit_value: number;

  alert_time: string;

  acknowledged: boolean;

  created_at?: string;
};

export type NewOverloadAlert = Omit<
  OverloadAlert,
  'id' | 'acknowledged' | 'created_at'
>;

/* =========================================================
   RELIABILITY INDEX
========================================================= */

export type ReliabilityIndex = {
  id: string;

  station_id: string;

  month: string;

  caidi_hours: number;
  caifi_nos: number;

  created_at?: string;
};

export type NewReliabilityIndex = Omit<
  ReliabilityIndex,
  'id' | 'created_at'
>;

/* =========================================================
   LOG BOOK ENTRY
   Matches current log_book_entries table
========================================================= */

export type LogBookEntry = {
  id: string;

  station_id: string;
  feeder_id: string | null;
  operator_id: string | null;
  operator_name?: string | null;

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

  entry_mode?: OperationalEntryMode | null;
  recorded_at?: string | null;
  synced_at?: string | null;
  client_operation_id?: string | null;
  offline_sequence_final?: boolean | null;

  created_at?: string;
  updated_at?: string;
};

export type NewLogBookEntry = Omit<
  LogBookEntry,
  'id' | 'created_at' | 'updated_at'
>;

/* =========================================================
   PUSH TOKEN
========================================================= */

export type PushToken = {
  id: string;

  /*
   * Keep these old fields if parts of the app
   * still use push_tokens.
   */
  token?: string;
  enabled?: boolean;

  /*
   * Current device_tokens table uses:
   */
  user_id?: string;
  fcm_token?: string;
  platform?: string;
  is_active?: boolean;
  updated_at?: string;

  created_at?: string;
};
