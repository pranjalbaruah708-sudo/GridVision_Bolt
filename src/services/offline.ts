import type { Feeder, Station } from '@/types';
import {
  LEGACY_MIGRATION_KEY,
  LEGACY_QUEUE_KEY,
  OfflineStorageError,
  getOfflineStorage,
  type StoredOperation,
} from './offlineStorage';
import { recordStorageFailure } from './diagnostics';

// Offline cache + pending sync queue backed by localStorage.
// Cache writes are best-effort. Queue writes are durable-or-fail because an
// offline operational write must never be reported as queued unless persisted.

const CACHE_PREFIX = 'gv_cache:';
const AUTHORIZED_SCOPE_CACHE_PREFIX = 'authorized-operational-scope:';
const AUTHORIZED_SCOPE_SCHEMA_VERSION = 1;
export const OFFLINE_QUEUE_CHANGED_EVENT = 'gv-offline-queue-changed';

export type QueuedMethod = 'POST' | 'PATCH' | 'DELETE';
export type OfflineEntryMode = 'ONLINE' | 'OFFLINE';
export type SyncFailureCategory = 'TRANSIENT' | 'AUTHORIZATION' | 'CONFLICT' | 'VALIDATION' | 'DEPENDENCY' | 'UNKNOWN';
export type QueuedSyncState = 'PENDING' | 'NEEDS_ATTENTION';
export type OfflineOperationType =
  | 'ADD_STATION_CONDITION'
  | 'ADD_LOG_ENTRY'
  | 'UPDATE_LOG_ENTRY'
  | 'ADD_INTERRUPTION'
  | 'RESTORE_INTERRUPTION'
  | 'UPDATE_INTERRUPTION_ETR'
  | 'GENERIC_POST'
  | 'GENERIC_PATCH'
  | 'GENERIC_DELETE'
  | (string & {});

export type QueuedOp = {
  id: string;
  clientOperationId: string;
  method: QueuedMethod;
  table: string;
  body?: unknown;
  filter?: Record<string, string>;
  operationType: OfflineOperationType;
  eventTime?: string;
  recordedAt: number;
  entryMode: OfflineEntryMode;
  localEntityId?: string;
  serverEntityId?: string;
  dependsOn?: string[];
  retryCount: number;
  lastError: string | null;
  failureCategory?: SyncFailureCategory;
  syncState?: QueuedSyncState;
  lastAttemptAt?: number;
  lastHttpStatus?: number;
  lastDatabaseCode?: string;
  enqueuedAt: number;
  ownerUserId?: string;
};

export type EnqueueOpInput = Pick<QueuedOp, 'method' | 'table'> & Partial<Omit<QueuedOp, 'id' | 'method' | 'table' | 'enqueuedAt'>>;
export type QueuedOpUpdate = Partial<Pick<QueuedOp, 'serverEntityId' | 'dependsOn' | 'retryCount' | 'lastError' | 'failureCategory' | 'syncState' | 'lastAttemptAt' | 'lastHttpStatus' | 'lastDatabaseCode'>>;

export type AuthorizedOperationalScopeCache = {
  version: typeof AUTHORIZED_SCOPE_SCHEMA_VERSION;
  userId: string;
  authorizedStationIds: string[];
  stations: Station[];
  feeders: Feeder[];
  cachedAt: string;
};

export class OfflineQueuePersistenceError extends Error {
  constructor(cause?: unknown) {
    super('GridVision could not safely store this record on this device because local storage may be unavailable or full. Free device storage and try again.');
    void cause;
    this.name = 'OfflineQueuePersistenceError';
  }
}

export const isOnline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine;

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as { value: T; ts: number };
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    writeCacheOrThrow(key, value);
  } catch {
    // Under storage pressure, remove only rebuildable caches and retry once.
    // Authorized scope is required for verified offline startup and is protected.
    try {
      const target = CACHE_PREFIX + key;
      Object.keys(localStorage)
        .filter((storedKey) => storedKey.startsWith(CACHE_PREFIX) && storedKey !== target && !storedKey.startsWith(CACHE_PREFIX + AUTHORIZED_SCOPE_CACHE_PREFIX))
        .forEach((storedKey) => localStorage.removeItem(storedKey));
      writeCacheOrThrow(key, value);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gv-storage-maintenance'));
    } catch {
      // Successful server reads remain usable even when their disposable cache cannot be updated.
    }
  }
}

export function writeCacheOrThrow<T>(key: string, value: T): void {
  localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, ts: Date.now() }));
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // Cache removal is best effort.
  }
}

export function clearAuthorizedOperationalScope(userId: string): void {
  if (userId) clearCache(AUTHORIZED_SCOPE_CACHE_PREFIX + userId);
}

function createStableId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return randomUuid();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMethod(value: unknown): value is QueuedMethod {
  return value === 'POST' || value === 'PATCH' || value === 'DELETE';
}

function inferOperationType(method: QueuedMethod): OfflineOperationType {
  if (method === 'POST') return 'GENERIC_POST';
  if (method === 'PATCH') return 'GENERIC_PATCH';
  return 'GENERIC_DELETE';
}

function asPositiveTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isFailureCategory(value: unknown): value is SyncFailureCategory {
  return value === 'TRANSIENT' || value === 'AUTHORIZATION' || value === 'CONFLICT' || value === 'VALIDATION' || value === 'DEPENDENCY' || value === 'UNKNOWN';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringFilter(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function isStation(value: unknown): value is Station {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isFeeder(value: unknown): value is Feeder {
  return isRecord(value) && typeof value.id === 'string' && typeof value.station_id === 'string' && typeof value.name === 'string';
}

export function readAuthorizedOperationalScope(userId: string): AuthorizedOperationalScopeCache | null {
  if (!userId) return null;
  const value = readCache<unknown>(AUTHORIZED_SCOPE_CACHE_PREFIX + userId);
  if (!isRecord(value) || value.version !== AUTHORIZED_SCOPE_SCHEMA_VERSION || value.userId !== userId) return null;
  if (!Array.isArray(value.authorizedStationIds) || !value.authorizedStationIds.every((id) => typeof id === 'string')) return null;
  if (!Array.isArray(value.stations) || !value.stations.every(isStation) || value.stations.length === 0) return null;
  if (!Array.isArray(value.feeders) || !value.feeders.every(isFeeder) || typeof value.cachedAt !== 'string') return null;

  const authorizedIds = new Set(value.authorizedStationIds);
  const stationIds = new Set(value.stations.map((station) => station.id));
  if (!Number.isFinite(Date.parse(value.cachedAt))) return null;
  if (authorizedIds.size === 0 || stationIds.size !== value.stations.length || authorizedIds.size !== stationIds.size) return null;
  if (value.authorizedStationIds.some((id) => !stationIds.has(id))) return null;
  if (value.feeders.some((feeder) => !authorizedIds.has(feeder.station_id))) return null;
  return value as AuthorizedOperationalScopeCache;
}

export function writeAuthorizedOperationalScope(scope: Omit<AuthorizedOperationalScopeCache, 'version' | 'cachedAt'>): void {
  writeCache(AUTHORIZED_SCOPE_CACHE_PREFIX + scope.userId, {
    ...scope,
    version: AUTHORIZED_SCOPE_SCHEMA_VERSION,
    cachedAt: new Date().toISOString(),
  } satisfies AuthorizedOperationalScopeCache);
}

export function normalizeQueuedOp(value: unknown, fallbackTimestamp = Date.now()): QueuedOp | null {
  if (!isRecord(value) || !isMethod(value.method) || typeof value.table !== 'string' || !value.table.trim()) return null;
  const enqueuedAt = asPositiveTimestamp(value.enqueuedAt, fallbackTimestamp);
  const id = asOptionalString(value.id) ?? createStableId('queue');
  const clientOperationId = asOptionalString(value.clientOperationId) ?? createStableId('operation');
  const operationType = asOptionalString(value.operationType) ?? inferOperationType(value.method);
  const dependsOn = Array.isArray(value.dependsOn) ? value.dependsOn.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : undefined;

  return {
    id,
    clientOperationId,
    method: value.method,
    table: value.table,
    ...(Object.prototype.hasOwnProperty.call(value, 'body') ? { body: value.body } : {}),
    ...(asStringFilter(value.filter) ? { filter: asStringFilter(value.filter) } : {}),
    operationType,
    ...(asOptionalString(value.eventTime) ? { eventTime: asOptionalString(value.eventTime) } : {}),
    recordedAt: asPositiveTimestamp(value.recordedAt, enqueuedAt),
    entryMode: value.entryMode === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
    ...(asOptionalString(value.localEntityId) ? { localEntityId: asOptionalString(value.localEntityId) } : {}),
    ...(asOptionalString(value.serverEntityId) ? { serverEntityId: asOptionalString(value.serverEntityId) } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
    retryCount: typeof value.retryCount === 'number' && Number.isInteger(value.retryCount) && value.retryCount >= 0 ? value.retryCount : 0,
    lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 240) : null,
    ...(isFailureCategory(value.failureCategory) ? { failureCategory: value.failureCategory } : {}),
    ...(value.syncState === 'PENDING' || value.syncState === 'NEEDS_ATTENTION' ? { syncState: value.syncState } : {}),
    ...(typeof value.lastAttemptAt === 'number' && Number.isFinite(value.lastAttemptAt) && value.lastAttemptAt > 0 ? { lastAttemptAt: value.lastAttemptAt } : {}),
    ...(typeof value.lastHttpStatus === 'number' && Number.isInteger(value.lastHttpStatus) ? { lastHttpStatus: value.lastHttpStatus } : {}),
    ...(asOptionalString(value.lastDatabaseCode) ? { lastDatabaseCode: asOptionalString(value.lastDatabaseCode)?.slice(0, 20) } : {}),
    enqueuedAt,
    ...(asOptionalString(value.ownerUserId) ? { ownerUserId: asOptionalString(value.ownerUserId) } : {}),
  };
}

export function notifyQueueChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGED_EVENT));
}

let initialization: Promise<void> | null = null;
let mutationTail: Promise<void> = Promise.resolve();

function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work, work);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function inferLegacyOwner(operation: QueuedOp): string | undefined {
  if (operation.ownerUserId) return operation.ownerUserId;
  if (!isRecord(operation.body)) return undefined;
  return asOptionalString(operation.body.operator_id) ?? asOptionalString(operation.body.user_id);
}

async function initializeQueueStorage(): Promise<void> {
  const storage = getOfflineStorage();
  if (storage.backend !== 'indexeddb' || typeof localStorage === 'undefined') return;
  const alreadyMigrated = await storage.getMetadata<boolean>(LEGACY_MIGRATION_KEY);
  const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
  if (alreadyMigrated && !raw) return;
  if (!raw) {
    await storage.setMetadata(LEGACY_MIGRATION_KEY, true);
    return;
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (cause) { throw new OfflineStorageError('The legacy offline queue could not be read safely.', cause); }
  if (!Array.isArray(parsed)) throw new OfflineStorageError('The legacy offline queue has an invalid format.');
  const normalized = parsed.map((item, index) => normalizeQueuedOp(item, Date.now() + index));
  if (normalized.some((item) => item === null)) throw new OfflineStorageError('The legacy offline queue contains an invalid operation and was left untouched.');

  await storage.mutateOperations((stored) => {
    const combined = new Map<string, StoredOperation>();
    stored.forEach((item) => combined.set(typeof item.clientOperationId === 'string' ? item.clientOperationId : item.id, item));
    const legacy = (normalized as QueuedOp[]).map((item) => ({
      ...item,
      ...(inferLegacyOwner(item) ? { ownerUserId: inferLegacyOwner(item) } : {}),
    }));
    const ownerById = new Map(legacy.filter((item) => item.ownerUserId).map((item) => [item.id, item.ownerUserId as string]));
    legacy.forEach((item) => {
      const dependencyOwner = item.dependsOn?.map((id) => ownerById.get(id)).find(Boolean);
      const owned = item.ownerUserId || !dependencyOwner ? item : { ...item, ownerUserId: dependencyOwner };
      const key = owned.clientOperationId || owned.id;
      if (!combined.has(key)) combined.set(key, owned);
    });
    return [...combined.values()];
  });
  await storage.setMetadata(LEGACY_MIGRATION_KEY, true);
  localStorage.removeItem(LEGACY_QUEUE_KEY);
  notifyQueueChanged();
}

async function ensureInitialized(): Promise<void> {
  initialization ??= initializeQueueStorage().catch((cause) => { initialization = null; throw cause; });
  return initialization;
}

function normalizedStoredQueue(values: StoredOperation[]): QueuedOp[] {
  const normalized = values.map((item, index) => normalizeQueuedOp(item, Date.now() + index));
  if (normalized.some((item) => item === null)) throw new OfflineStorageError('Offline storage contains an invalid operation. No queue data was changed.');
  return (normalized as QueuedOp[]).sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.id.localeCompare(right.id));
}

export async function getQueue(ownerUserId?: string): Promise<QueuedOp[]> {
  await ensureInitialized();
  const stored = await getOfflineStorage().getAllOperations();
  const queue = normalizedStoredQueue(stored);
  if (JSON.stringify(stored) !== JSON.stringify(queue)) {
    await getOfflineStorage().putOperations(queue);
    notifyQueueChanged();
  }
  if (ownerUserId && queue.some((operation) => !operation.ownerUserId)) {
    throw new OfflineStorageError('A legacy pending operation has no verified user owner. It was preserved but cannot be synced under this account.');
  }
  return ownerUserId ? queue.filter((operation) => operation.ownerUserId === ownerUserId) : queue;
}

export async function enqueueOp(op: EnqueueOpInput): Promise<QueuedOp> {
  const now = Date.now();
  const full = normalizeQueuedOp({
    ...op,
    id: createStableId('queue'),
    clientOperationId: op.clientOperationId ?? createStableId('operation'),
    operationType: op.operationType ?? inferOperationType(op.method),
    entryMode: op.entryMode ?? 'OFFLINE',
    recordedAt: op.recordedAt ?? now,
    retryCount: op.retryCount ?? 0,
    lastError: op.lastError ?? null,
    syncState: op.syncState ?? 'PENDING',
    enqueuedAt: now,
  }, now);
  if (!full) throw new Error('Invalid offline operation.');
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().putOperation(full);
  }).catch((cause) => {
    if (op.ownerUserId) void recordStorageFailure(op.ownerUserId);
    throw new OfflineQueuePersistenceError(cause);
  });
  notifyQueueChanged();
  return full;
}

function logBookIdentity(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const stationId = asOptionalString(body.station_id);
  const feederId = asOptionalString(body.feeder_id);
  const eventTime = asOptionalString(body.actual_event_time);
  return stationId && feederId && eventTime ? `${stationId}:${feederId}:${eventTime}` : null;
}

export async function enqueueOrConsolidateLogBookOp(op: EnqueueOpInput): Promise<QueuedOp> {
  if (op.table !== 'log_book_entries') return enqueueOp(op);
  const identity = logBookIdentity(op.body);
  if (!identity) return enqueueOp(op);

  return serializeMutation(async () => {
    await ensureInitialized();
    let result: QueuedOp | null = null;
    await getOfflineStorage().mutateOperations((stored) => {
      const queue = normalizedStoredQueue(stored);
      const index = queue.findIndex((queued) => queued.ownerUserId === op.ownerUserId && queued.table === 'log_book_entries' &&
        (queued.method === 'POST' || queued.method === 'PATCH') && logBookIdentity(queued.body) === identity);
      if (index < 0) {
        const now = Date.now();
        result = normalizeQueuedOp({ ...op, id: createStableId('queue'), clientOperationId: op.clientOperationId ?? createStableId('operation'), operationType: op.operationType ?? inferOperationType(op.method), entryMode: 'OFFLINE', recordedAt: op.recordedAt ?? now, retryCount: 0, lastError: null, enqueuedAt: now }, now);
        if (!result) throw new Error('Invalid offline log-book operation.');
        return [...queue, result];
      }
      const existing = queue[index];
      result = normalizeQueuedOp({ ...existing, body: isRecord(existing.body) && isRecord(op.body) ? { ...existing.body, ...op.body } : op.body,
        operationType: existing.method === 'POST' ? 'ADD_LOG_ENTRY' : 'UPDATE_LOG_ENTRY', eventTime: op.eventTime ?? existing.eventTime,
        recordedAt: op.recordedAt ?? Date.now(), entryMode: 'OFFLINE', retryCount: 0, lastError: null,
        syncState: 'PENDING', failureCategory: undefined, lastAttemptAt: undefined,
        lastHttpStatus: undefined, lastDatabaseCode: undefined }, existing.enqueuedAt);
      if (!result) throw new Error('Invalid offline log-book operation.');
      queue[index] = result;
      return queue;
    });
    notifyQueueChanged();
    if (!result) throw new Error('Offline log-book operation was not persisted.');
    return result;
  }).catch((cause) => {
    if (op.ownerUserId) void recordStorageFailure(op.ownerUserId);
    if (cause instanceof OfflineQueuePersistenceError) throw cause;
    throw new OfflineQueuePersistenceError(cause);
  });
}

export async function getQueuedLogBookOp(stationId: string, feederId: string, eventTime: string, ownerUserId: string): Promise<QueuedOp | undefined> {
  const identity = `${stationId}:${feederId}:${eventTime}`;
  return (await getQueue(ownerUserId)).find((op) => op.table === 'log_book_entries' && logBookIdentity(op.body) === identity);
}

export async function enqueueInterruptionAdd(body: unknown, eventTime: string, ownerUserId: string): Promise<QueuedOp> {
  const clientOperationId = createStableId('operation');
  return enqueueOp({
    method: 'POST',
    table: 'interruptions',
    body,
    clientOperationId,
    localEntityId: `local:int:${clientOperationId}`,
    operationType: 'ADD_INTERRUPTION',
    eventTime,
    recordedAt: Date.now(),
    entryMode: 'OFFLINE',
    ownerUserId,
  });
}

export async function enqueueInterruptionRestore(input: {
  body: unknown;
  eventTime: string;
  localEntityId?: string;
  serverEntityId?: string;
  ownerUserId: string;
}): Promise<QueuedOp> {
  const queue = await getQueue(input.ownerUserId);
  const addOperation = input.localEntityId
    ? queue.find((op) => op.table === 'interruptions' && op.operationType === 'ADD_INTERRUPTION' && op.localEntityId === input.localEntityId)
    : undefined;

  if (input.localEntityId && !addOperation && !input.serverEntityId) {
    throw new Error('The pending interruption could not be found. Reopen the page and try again.');
  }

  return enqueueOp({
    method: 'PATCH',
    table: 'interruptions',
    body: input.body,
    ...(input.serverEntityId ? { filter: { id: input.serverEntityId }, serverEntityId: input.serverEntityId } : {}),
    ...(input.localEntityId ? { localEntityId: input.localEntityId } : {}),
    ...(addOperation ? { dependsOn: [addOperation.id] } : {}),
    operationType: 'RESTORE_INTERRUPTION',
    eventTime: input.eventTime,
    recordedAt: Date.now(),
    entryMode: 'OFFLINE',
    ownerUserId: input.ownerUserId,
  });
}

export async function updateQueuedInterruptionAddEtr(localEntityId: string, etr: string | null, ownerUserId: string): Promise<QueuedOp> {
  let updated: QueuedOp | null = null;
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => normalizedStoredQueue(stored).map((operation) => {
      if (operation.ownerUserId !== ownerUserId || operation.operationType !== 'ADD_INTERRUPTION'
        || operation.localEntityId !== localEntityId || !isRecord(operation.body)) return operation;
      updated = { ...operation, body: { ...operation.body, etr }, retryCount: 0, lastError: null,
        failureCategory: undefined, syncState: 'PENDING', lastAttemptAt: undefined,
        lastHttpStatus: undefined, lastDatabaseCode: undefined };
      return updated;
    }));
  });
  if (!updated) throw new Error('The pending interruption could not be found. Reopen the page and try again.');
  notifyQueueChanged();
  return updated;
}

export async function getQueuedInterruptionOperations(ownerUserId: string, stationId?: string): Promise<QueuedOp[]> {
  return (await getQueue(ownerUserId)).filter((op) => {
    if (op.table !== 'interruptions' || !isRecord(op.body)) return false;
    return !stationId || op.body.station_id === stationId;
  });
}

export async function resolveQueuedInterruptionAdd(addOperationId: string, serverEntityId: string): Promise<void> {
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => {
      const queue = normalizedStoredQueue(stored);
      const addOperation = queue.find((op) => op.id === addOperationId);
      if (!addOperation) return queue;
      return queue.map((op) => {
    if (op.id === addOperationId) return { ...op, serverEntityId };
    if (!op.dependsOn?.includes(addOperationId)) return op;
    const remainingDependencies = op.dependsOn.filter((dependency) => dependency !== addOperationId);
    return {
      ...op,
      serverEntityId,
      filter: { id: serverEntityId },
      ...(remainingDependencies.length ? { dependsOn: remainingDependencies } : { dependsOn: undefined }),
    };
      });
    });
  });
  notifyQueueChanged();
}

/** Atomically maps dependent restores and removes the successfully synced ADD. */
export async function completeQueuedInterruptionAdd(addOperationId: string, serverEntityId: string): Promise<void> {
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => normalizedStoredQueue(stored).flatMap((op) => {
      if (op.id === addOperationId) return [];
      if (!op.dependsOn?.includes(addOperationId)) return [op];
      const remainingDependencies = op.dependsOn.filter((dependency) => dependency !== addOperationId);
      const updated = normalizeQueuedOp({
        ...op,
        serverEntityId,
        filter: { id: serverEntityId },
        dependsOn: remainingDependencies.length ? remainingDependencies : undefined,
      }, op.enqueuedAt);
      return updated ? [updated] : [op];
    }));
  });
  notifyQueueChanged();
}

export async function getQueuedOp(id: string, ownerUserId?: string): Promise<QueuedOp | undefined> {
  await ensureInitialized();
  const stored = await getOfflineStorage().getOperation(id);
  if (stored) {
    const operation = normalizeQueuedOp(stored);
    if (!operation) throw new OfflineStorageError('Offline storage contains an invalid operation.');
    if (!ownerUserId || operation.ownerUserId === ownerUserId) return operation;
    return undefined;
  }
  return (await getQueue(ownerUserId)).find((op) => op.clientOperationId === id);
}

export async function updateQueuedOp(id: string, changes: QueuedOpUpdate): Promise<QueuedOp | null> {
  return serializeMutation(async () => {
    let result: QueuedOp | null = null;
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => {
      const queue = normalizedStoredQueue(stored);
      const index = queue.findIndex((op) => op.id === id || op.clientOperationId === id);
      if (index < 0) return queue;
      result = normalizeQueuedOp({ ...queue[index], ...changes }, queue[index].enqueuedAt);
      if (result) queue[index] = result;
      return queue;
    });
    notifyQueueChanged();
    return result;
  });
}

export async function dequeueOp(id: string): Promise<void> {
  await serializeMutation(async () => {
    await ensureInitialized();
    const storage = getOfflineStorage();
    const stored = await storage.getOperation(id);
    if (stored) await storage.deleteOperation(id);
    else await storage.mutateOperations((values) => normalizedStoredQueue(values).filter((op) => op.clientOperationId !== id));
  });
  notifyQueueChanged();
}

export async function dequeueOps(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const remove = new Set(ids);
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => normalizedStoredQueue(stored).filter((op) => !remove.has(op.id) && !remove.has(op.clientOperationId)));
  });
  notifyQueueChanged();
}

export async function queueLength(ownerUserId?: string): Promise<number> {
  return (await getQueue(ownerUserId)).length;
}

export type QueueHealth = {
  total: number;
  pending: number;
  needsAttention: number;
  oldestEnqueuedAt: number | null;
  lastSuccessfulSyncAt: number | null;
};

const LAST_SUCCESSFUL_SYNC_PREFIX = 'last-successful-sync:';

export async function getQueueHealth(ownerUserId: string, knownOperations?: QueuedOp[]): Promise<QueueHealth> {
  const operations = knownOperations ?? await getQueue(ownerUserId);
  const storedLastSync = await getOfflineStorage().getMetadata<unknown>(LAST_SUCCESSFUL_SYNC_PREFIX + ownerUserId);
  return {
    total: operations.length,
    pending: operations.filter((op) => op.syncState !== 'NEEDS_ATTENTION').length,
    needsAttention: operations.filter((op) => op.syncState === 'NEEDS_ATTENTION').length,
    oldestEnqueuedAt: operations.length ? Math.min(...operations.map((op) => op.enqueuedAt)) : null,
    lastSuccessfulSyncAt: typeof storedLastSync === 'number' && Number.isFinite(storedLastSync) && storedLastSync > 0
      ? storedLastSync
      : null,
  };
}

export async function recordSuccessfulQueueSync(ownerUserId: string): Promise<void> {
  await getOfflineStorage().setMetadata(LAST_SUCCESSFUL_SYNC_PREFIX + ownerUserId, Date.now());
  notifyQueueChanged();
}

export async function markQueuedOperationsAuthorizationAttention(ownerUserId: string): Promise<void> {
  await serializeMutation(async () => {
    await ensureInitialized();
    await getOfflineStorage().mutateOperations((stored) => normalizedStoredQueue(stored).map((op) => op.ownerUserId === ownerUserId ? {
      ...op,
      syncState: 'NEEDS_ATTENTION' as const,
      failureCategory: 'AUTHORIZATION' as const,
      lastAttemptAt: Date.now(),
      lastError: 'Your access changed before this record could synchronize. The record remains safely stored on this device.',
    } : op));
  });
  notifyQueueChanged();
}
