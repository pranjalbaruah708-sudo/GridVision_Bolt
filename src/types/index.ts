export type Station = {
  id: string;
  name: string;
  location: string;
  created_at?: string;
};

export type Feeder = {
  id: string;
  station_id: string;
  name: string;
  capacity_kv: number;
  created_at?: string;
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

export type Interruption = {
  id: string;
  feeder_id: string | null;
  station_id: string;
  reason: InterruptionReason;
  started_at: string;
  restored_at: string | null;
  duration_hours: number | null;
  status: 'open' | 'closed';
  etr: string | null;
  created_at?: string;
};

export type NewInterruption = Omit<Interruption, 'id' | 'duration_hours' | 'created_at'>;

export type OverloadAlert = {
  id: string;
  asset_id: string;
  asset_type: 'Feeder' | 'Transformer';
  station_id: string;
  parameter: string;
  value: number;
  limit_value: number;
  alert_time: string;
  acknowledged: boolean;
  created_at?: string;
};

export type NewOverloadAlert = Omit<OverloadAlert, 'id' | 'acknowledged' | 'created_at'>;

export type ReliabilityIndex = {
  id: string;
  station_id: string;
  month: string;
  caidi_hours: number;
  caifi_nos: number;
  created_at?: string;
};

export type NewReliabilityIndex = Omit<ReliabilityIndex, 'id' | 'created_at'>;

export type LogBookEntry = {
  id: string;
  station_id: string;
  feeder_id: string | null;
  entry_date: string;
  entry_time: string;
  mw: number;
  voltage_kv: number;
  current_a: number;
  remarks: string;
  created_at?: string;
};

export type NewLogBookEntry = Omit<LogBookEntry, 'id' | 'created_at'>;

export type PushToken = {
  id: string;
  token: string;
  enabled: boolean;
  created_at?: string;
};
