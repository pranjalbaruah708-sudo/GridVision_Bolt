import { supabase } from './supabase';
import { enqueueOp, getQueue, isOnline, type QueuedOp } from './offline';
import type { CreateStationConditionInput } from '@/types/operational';

export function conditionInput(value: unknown): CreateStationConditionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.station_id !== 'string' || typeof row.observed_at !== 'string'
    || !Number.isFinite(Date.parse(row.observed_at)) || typeof row.observation !== 'string'
    || typeof row.client_operation_id !== 'string'
    || !['EQUIPMENT', 'STATION_CONDITION', 'DEFECT', 'OTHER'].includes(String(row.category))
    || !['NORMAL', 'ATTENTION', 'ABNORMAL'].includes(String(row.condition))
    || (row.equipment_area != null && typeof row.equipment_area !== 'string')) return null;
  return row as unknown as CreateStationConditionInput;
}

export async function enqueueStationCondition(input: CreateStationConditionInput, ownerUserId: string): Promise<QueuedOp> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !ownerUserId || data.session?.user.id !== ownerUserId) {
    throw new Error('The signed-in user changed. Your form has not been submitted.');
  }
  const existing = (await getQueue(ownerUserId)).find(op => op.operationType === 'ADD_STATION_CONDITION'
    && op.clientOperationId === input.client_operation_id);
  if (existing) return existing;
  const recordedAt = Date.now();
  const entryMode = isOnline() ? 'ONLINE' : 'OFFLINE';
  return enqueueOp({
    method: 'POST', table: 'station_conditions', operationType: 'ADD_STATION_CONDITION',
    ownerUserId, clientOperationId: input.client_operation_id, eventTime: input.observed_at,
    recordedAt, entryMode,
    body: { ...input, entry_mode: entryMode, recorded_at: new Date(recordedAt).toISOString() },
  });
}
