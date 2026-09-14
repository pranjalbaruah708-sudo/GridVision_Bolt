import { supabase } from './supabase';
import { isOnline } from './offline';
import type {
  CreateStationConditionInput, OperationalQuery, OperationalScopeOption,
  OperationalSummary, OperationalTimelineEvent, StationCondition,
} from '@/types/operational';

function queryArgs(query: OperationalQuery) {
  return {
    p_period: query.period,
    p_from: query.period === 'CUSTOM' ? query.from : null,
    p_to: query.period === 'CUSTOM' ? query.to : null,
    p_station_id: query.scope.kind === 'STATION' ? query.scope.id : null,
    p_office_id: query.scope.kind === 'OFFICE' ? query.scope.id : null,
  };
}

export function stationConditionCreateArgs(input: CreateStationConditionInput) {
  return {
    p_station_id: input.station_id, p_observed_at: input.observed_at,
    p_category: input.category, p_condition: input.condition, p_observation: input.observation,
    p_client_operation_id: input.client_operation_id, p_equipment_area: input.equipment_area ?? null,
    p_entry_mode: input.entry_mode ?? 'ONLINE', p_recorded_at: input.recorded_at ?? null,
  };
}

export const operationalApi = {
  async createStationCondition(input: CreateStationConditionInput): Promise<StationCondition> {
    const { data, error } = await supabase.rpc('create_station_condition', stationConditionCreateArgs(input));
    if (error) throw error;
    return data as StationCondition;
  },
  async rectifyStationCondition(id: string): Promise<StationCondition> {
    if (!isOnline()) throw new Error('Rectification requires an online connection.');
    const { data, error } = await supabase.rpc('rectify_station_condition', { p_id: id });
    if (error) throw error;
    return data as StationCondition;
  },
  async getStationCondition(id: string): Promise<StationCondition | null> {
    const { data, error } = await supabase.from('station_conditions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as StationCondition | null;
  },
  async getRecentStationConditions(stationId: string): Promise<StationCondition[]> {
    const { data, error } = await supabase.from('station_conditions').select('*')
      .eq('station_id', stationId).order('observed_at', { ascending: false })
      .order('id', { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as StationCondition[];
  },
  async getScopeOptions(): Promise<OperationalScopeOption[]> {
    const { data, error } = await supabase.rpc('get_operational_scope_options');
    if (error) throw error;
    return (data ?? []) as OperationalScopeOption[];
  },
  /** Stable order: event_time DESC, event_type ASC, source_id ASC.
   * Limit 1–200; offset 0–100000. Reload pagination after source changes.
   */
  async getTimeline(query: OperationalQuery, limit = 50, offset = 0): Promise<OperationalTimelineEvent[]> {
    const { data, error } = await supabase.rpc('get_operational_timeline', {
      ...queryArgs(query), p_limit: limit, p_offset: offset,
    });
    if (error) throw error;
    return (data ?? []) as OperationalTimelineEvent[];
  },
  async getSummary(query: OperationalQuery): Promise<OperationalSummary> {
    const { data, error } = await supabase.rpc('get_operational_summary', queryArgs(query)).single();
    if (error) throw error;
    return data as OperationalSummary;
  },
};
