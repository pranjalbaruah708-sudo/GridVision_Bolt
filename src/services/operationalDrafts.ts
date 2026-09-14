import { getOfflineStorage } from './offlineStorage';
import type { StationConditionCategory, StationConditionValue } from '@/types/operational';

const CONDITION_DRAFT_PREFIX = 'draft:station-condition:';
export type StationConditionDraft = {
  userId: string; stationId: string; observedAt: string; category: StationConditionCategory;
  equipmentArea: string; condition: StationConditionValue; observation: string; clientOperationId: string;
};
function conditionDraftKey(userId: string, stationId: string) { return `${CONDITION_DRAFT_PREFIX}${userId}:${stationId}`; }
export function beginStationConditionDraftSession(userId: string, stationId: string): number {
  return beginWriteSession(conditionDraftKey(userId, stationId));
}
export async function readStationConditionDraft(userId: string, stationId: string): Promise<StationConditionDraft | null> {
  const key = conditionDraftKey(userId, stationId);
  await writeChains.get(key)?.catch(() => undefined);
  const value = await getOfflineStorage().getMetadata<unknown>(key);
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.userId !== userId || row.stationId !== stationId
    || typeof row.observedAt !== 'string' || typeof row.equipmentArea !== 'string'
    || typeof row.observation !== 'string' || typeof row.clientOperationId !== 'string'
    || !['EQUIPMENT','STATION_CONDITION','DEFECT','OTHER'].includes(String(row.category))
    || !['NORMAL','ATTENTION','ABNORMAL'].includes(String(row.condition))) return null;
  return row as unknown as StationConditionDraft;
}
export async function writeStationConditionDraft(input: StationConditionDraft, epoch: number): Promise<void> {
  const key = conditionDraftKey(input.userId, input.stationId);
  await serializeForKey(key, async () => {
    if (writeEpochs.get(key) !== epoch) return;
    await getOfflineStorage().setMetadata(key, { ...input, schemaVersion: 1, updatedAt: new Date().toISOString() });
  });
}
export async function deleteStationConditionDraft(userId: string, stationId: string): Promise<void> {
  const key = conditionDraftKey(userId, stationId);
  invalidateWrites(key);
  await serializeForKey(key, () => getOfflineStorage().deleteMetadata(key));
}

const PARAMETER_DRAFT_VERSION = 1 as const;
const PARAMETER_DRAFT_PREFIX = 'draft:parameter-entry:';
const INTERRUPTION_DRAFT_VERSION = 1 as const;
const INTERRUPTION_DRAFT_PREFIX = 'draft:interruption-entry:';
const SHIFT_HANDOVER_DRAFT_VERSION = 1 as const;
const SHIFT_HANDOVER_DRAFT_PREFIX = 'draft:shift-handover:';

export type ParameterEntryDraft = {
  schemaVersion: typeof PARAMETER_DRAFT_VERSION;
  userId: string;
  stationId: string;
  feederId: string;
  actualEventTime: string;
  values: Record<string, string>;
  updatedAt: string;
};

export type InterruptionEntryDraft = {
  schemaVersion: typeof INTERRUPTION_DRAFT_VERSION;
  userId: string;
  stationId: string;
  feederId: string;
  reason: string;
  otherReason: string;
  tripTime: string;
  etr?: string;
  updatedAt: string;
};

export type ShiftHandoverLocalDraft = {
  schemaVersion: typeof SHIFT_HANDOVER_DRAFT_VERSION;
  userId: string;
  stationId: string;
  outgoingShiftId: string;
  incomingShiftId: string;
  handoverId: string;
  baseServerUpdatedAt: string;
  outgoingNotes: string;
  selectedSourceKeys: string[];
  updatedAt: string;
};

export type DraftInventory = {
  total: number;
  recent: number;
  old: number;
  veryOld: number;
  oldestUpdatedAt: number | null;
};

const writeChains = new Map<string, Promise<void>>();
const writeEpochs = new Map<string, number>();

function parameterKey(context: { userId: string; stationId: string; feederId: string; actualEventTime: string }): string {
  return `${PARAMETER_DRAFT_PREFIX}${context.userId}:${context.stationId}:${context.feederId}:${context.actualEventTime}`;
}

function interruptionKey(userId: string, stationId: string): string {
  return `${INTERRUPTION_DRAFT_PREFIX}${userId}:${stationId}:trip`;
}

function shiftHandoverKey(context: Pick<ShiftHandoverLocalDraft, 'userId' | 'stationId' | 'outgoingShiftId' | 'incomingShiftId' | 'handoverId'>): string {
  return `${SHIFT_HANDOVER_DRAFT_PREFIX}${context.userId}:${context.stationId}:${context.outgoingShiftId}:${context.incomingShiftId}:${context.handoverId}`;
}

function serializeForKey(key: string, write: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const current = previous.then(write, write);
  writeChains.set(key, current);
  return current.finally(() => { if (writeChains.get(key) === current) writeChains.delete(key); });
}

function beginWriteSession(key: string): number {
  const epoch = (writeEpochs.get(key) ?? 0) + 1;
  writeEpochs.set(key, epoch);
  return epoch;
}

function invalidateWrites(key: string): void {
  writeEpochs.set(key, (writeEpochs.get(key) ?? 0) + 1);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');
}

export function beginParameterDraftSession(context: { userId: string; stationId: string; feederId: string; actualEventTime: string }): number {
  return beginWriteSession(parameterKey(context));
}

export async function readParameterEntryDraft(context: { userId: string; stationId: string; feederId: string; actualEventTime: string }): Promise<ParameterEntryDraft | null> {
  const key = parameterKey(context);
  await writeChains.get(key)?.catch(() => undefined);
  const value = await getOfflineStorage().getMetadata<unknown>(key);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== PARAMETER_DRAFT_VERSION || row.userId !== context.userId || row.stationId !== context.stationId
    || row.feederId !== context.feederId || row.actualEventTime !== context.actualEventTime
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt)) || !isStringRecord(row.values)) return null;
  return row as ParameterEntryDraft;
}

export async function writeParameterEntryDraft(input: Omit<ParameterEntryDraft, 'schemaVersion' | 'updatedAt'>, writeEpoch?: number): Promise<void> {
  const key = parameterKey(input);
  const value: ParameterEntryDraft = { ...input, values: { ...input.values }, schemaVersion: PARAMETER_DRAFT_VERSION, updatedAt: new Date().toISOString() };
  await serializeForKey(key, async () => {
    if (writeEpoch !== undefined && writeEpochs.get(key) !== writeEpoch) return;
    await getOfflineStorage().setMetadata(key, value);
  });
}

export async function deleteParameterEntryDraft(context: { userId: string; stationId: string; feederId: string; actualEventTime: string }): Promise<void> {
  const key = parameterKey(context);
  invalidateWrites(key);
  await serializeForKey(key, () => getOfflineStorage().deleteMetadata(key));
}

export function beginInterruptionDraftSession(userId: string, stationId: string): number {
  return beginWriteSession(interruptionKey(userId, stationId));
}

export async function readInterruptionEntryDraft(userId: string, stationId: string): Promise<InterruptionEntryDraft | null> {
  const key = interruptionKey(userId, stationId);
  await writeChains.get(key)?.catch(() => undefined);
  const value = await getOfflineStorage().getMetadata<unknown>(key);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== INTERRUPTION_DRAFT_VERSION || row.userId !== userId || row.stationId !== stationId
    || typeof row.feederId !== 'string' || typeof row.reason !== 'string' || typeof row.otherReason !== 'string'
    || typeof row.tripTime !== 'string' || (row.etr !== undefined && typeof row.etr !== 'string')
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  return row as InterruptionEntryDraft;
}

export async function writeInterruptionEntryDraft(input: Omit<InterruptionEntryDraft, 'schemaVersion' | 'updatedAt'>, writeEpoch?: number): Promise<void> {
  const key = interruptionKey(input.userId, input.stationId);
  const value: InterruptionEntryDraft = { ...input, schemaVersion: INTERRUPTION_DRAFT_VERSION, updatedAt: new Date().toISOString() };
  await serializeForKey(key, async () => {
    if (writeEpoch !== undefined && writeEpochs.get(key) !== writeEpoch) return;
    await getOfflineStorage().setMetadata(key, value);
  });
}

export async function deleteInterruptionEntryDraft(userId: string, stationId: string): Promise<void> {
  const key = interruptionKey(userId, stationId);
  invalidateWrites(key);
  await serializeForKey(key, () => getOfflineStorage().deleteMetadata(key));
}

export function beginShiftHandoverDraftSession(context: Pick<ShiftHandoverLocalDraft, 'userId' | 'stationId' | 'outgoingShiftId' | 'incomingShiftId' | 'handoverId'>): number {
  return beginWriteSession(shiftHandoverKey(context));
}

export async function readShiftHandoverLocalDraft(context: Pick<ShiftHandoverLocalDraft, 'userId' | 'stationId' | 'outgoingShiftId' | 'incomingShiftId' | 'handoverId'>): Promise<ShiftHandoverLocalDraft | null> {
  const key = shiftHandoverKey(context);
  await writeChains.get(key)?.catch(() => undefined);
  const value = await getOfflineStorage().getMetadata<unknown>(key);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== SHIFT_HANDOVER_DRAFT_VERSION || row.userId !== context.userId || row.stationId !== context.stationId
    || row.outgoingShiftId !== context.outgoingShiftId || row.incomingShiftId !== context.incomingShiftId || row.handoverId !== context.handoverId
    || typeof row.baseServerUpdatedAt !== 'string' || !Number.isFinite(Date.parse(row.baseServerUpdatedAt))
    || typeof row.outgoingNotes !== 'string' || !Array.isArray(row.selectedSourceKeys) || !row.selectedSourceKeys.every((item) => typeof item === 'string')
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  return row as ShiftHandoverLocalDraft;
}

export async function writeShiftHandoverLocalDraft(input: Omit<ShiftHandoverLocalDraft, 'schemaVersion' | 'updatedAt'>, writeEpoch?: number): Promise<void> {
  const key = shiftHandoverKey(input);
  const value: ShiftHandoverLocalDraft = { ...input, selectedSourceKeys: [...new Set(input.selectedSourceKeys)], schemaVersion: SHIFT_HANDOVER_DRAFT_VERSION, updatedAt: new Date().toISOString() };
  await serializeForKey(key, async () => {
    if (writeEpoch !== undefined && writeEpochs.get(key) !== writeEpoch) return;
    await getOfflineStorage().setMetadata(key, value);
  });
}

export async function deleteShiftHandoverLocalDraft(context: Pick<ShiftHandoverLocalDraft, 'userId' | 'stationId' | 'outgoingShiftId' | 'incomingShiftId' | 'handoverId'>): Promise<void> {
  const key = shiftHandoverKey(context);
  invalidateWrites(key);
  await serializeForKey(key, () => getOfflineStorage().deleteMetadata(key));
}

export async function getDraftInventory(userId: string): Promise<DraftInventory> {
  const rows = [
    ...await getOfflineStorage().listMetadata(PARAMETER_DRAFT_PREFIX),
    ...await getOfflineStorage().listMetadata(INTERRUPTION_DRAFT_PREFIX),
    ...await getOfflineStorage().listMetadata(SHIFT_HANDOVER_DRAFT_PREFIX),
    ...await getOfflineStorage().listMetadata(CONDITION_DRAFT_PREFIX),
  ].flatMap(({ value }) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (row.userId !== userId || typeof row.updatedAt !== 'string') return [];
    const timestamp = Date.parse(row.updatedAt);
    return Number.isFinite(timestamp) ? [timestamp] : [];
  });
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    recent: rows.filter((timestamp) => now - timestamp < day).length,
    old: rows.filter((timestamp) => now - timestamp >= day && now - timestamp < 7 * day).length,
    veryOld: rows.filter((timestamp) => now - timestamp >= 7 * day).length,
    oldestUpdatedAt: rows.length ? Math.min(...rows) : null,
  };
}
