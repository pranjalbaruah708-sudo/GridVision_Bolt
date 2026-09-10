import { readCache, writeCacheOrThrow } from './offline';

const SCHEMA_VERSION = 1 as const;
const MAX_SNAPSHOTS_PER_USER = 48;
const PRESSURE_SNAPSHOT_LIMIT = 12;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_STORAGE_PREFIX = `gv_cache:operational-read:v${SCHEMA_VERSION}:`;
export const STORAGE_MAINTENANCE_EVENT = 'gv-storage-maintenance';
export const RECENT_OPERATIONAL_CACHE_MS = 15 * 60 * 1000;

export type DataFreshness = 'LIVE' | 'RECENT_CACHE' | 'STALE_CACHE' | 'NO_CACHE';
export type OperationalCacheEnvelope<T> = { schemaVersion: typeof SCHEMA_VERSION; userId: string; queryKey: string; cachedAt: string; value: T };
type CacheRow = { key: string; cachedAt: number; queryKey: string; userId: string };

function storageKey(userId: string, queryKey: string): string {
  return `operational-read:v${SCHEMA_VERSION}:${encodeURIComponent(userId)}:${queryKey}`;
}

export function readOperationalSnapshot<T>(userId: string, queryKey: string): OperationalCacheEnvelope<T> | null {
  const candidate = readCache<unknown>(storageKey(userId, queryKey));
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const envelope = candidate as Partial<OperationalCacheEnvelope<T>>;
  if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.userId !== userId || envelope.queryKey !== queryKey
    || typeof envelope.cachedAt !== 'string' || !Number.isFinite(Date.parse(envelope.cachedAt))
    || !Object.prototype.hasOwnProperty.call(envelope, 'value')) return null;
  return envelope as OperationalCacheEnvelope<T>;
}

export function writeOperationalSnapshot<T>(userId: string, queryKey: string, value: T): OperationalCacheEnvelope<T> {
  const envelope: OperationalCacheEnvelope<T> = { schemaVersion: SCHEMA_VERSION, userId, queryKey, cachedAt: new Date().toISOString(), value };
  try { writeCacheOrThrow(storageKey(userId, queryKey), envelope); }
  catch {
    pressureCleanupDisposableCaches();
    try { writeCacheOrThrow(storageKey(userId, queryKey), envelope); }
    catch { notifyStorageMaintenance({ failureAt: Date.now() }); }
  }
  pruneOperationalReadCache(userId);
  return envelope;
}

function operationalRows(userId?: string): CacheRow[] {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(CACHE_STORAGE_PREFIX)).flatMap((key) => {
      try {
        const wrapper = JSON.parse(localStorage.getItem(key) ?? '') as { value?: unknown };
        if (!wrapper.value || typeof wrapper.value !== 'object' || Array.isArray(wrapper.value)) return [];
        const envelope = wrapper.value as Partial<OperationalCacheEnvelope<unknown>>;
        if (envelope.schemaVersion !== SCHEMA_VERSION || typeof envelope.userId !== 'string' || typeof envelope.queryKey !== 'string'
          || typeof envelope.cachedAt !== 'string') return [];
        const cachedAt = Date.parse(envelope.cachedAt);
        if (!Number.isFinite(cachedAt) || (userId && envelope.userId !== userId)) return [];
        return [{ key, cachedAt, queryKey: envelope.queryKey, userId: envelope.userId }];
      } catch { return []; }
    }).sort((left, right) => right.cachedAt - left.cachedAt);
  } catch { return []; }
}

export function countOperationalReadCaches(userId: string): number { return operationalRows(userId).length; }

export function clearOperationalReadCache(userId?: string): number {
  const rows = operationalRows(userId);
  rows.forEach(({ key }) => { try { localStorage.removeItem(key); } catch { /* best effort */ } });
  if (rows.length) notifyStorageMaintenance({ cleanupAt: Date.now(), cleanupCount: rows.length });
  return rows.length;
}

export function pruneOperationalReadCache(userId?: string, mode: 'NORMAL' | 'PRESSURE' = 'NORMAL'): number {
  const rows = operationalRows(userId);
  const limit = mode === 'PRESSURE' ? PRESSURE_SNAPSHOT_LIMIT : MAX_SNAPSHOTS_PER_USER;
  const rankByUser = new Map<string, number>();
  const newestByContext = new Set<string>();
  const remove = rows.filter((row) => {
    const rank = rankByUser.get(row.userId) ?? 0;
    rankByUser.set(row.userId, rank + 1);
    const context = `${row.userId}:${row.queryKey.split('|').slice(0, 2).join('|')}`;
    const newest = !newestByContext.has(context);
    newestByContext.add(context);
    return rank >= limit || (Date.now() - row.cachedAt > RETENTION_MS && !newest);
  });
  remove.forEach(({ key }) => { try { localStorage.removeItem(key); } catch { /* best effort */ } });
  if (remove.length) notifyStorageMaintenance({ cleanupAt: Date.now(), cleanupCount: remove.length });
  return remove.length;
}

export function pressureCleanupDisposableCaches(): number {
  let removed = pruneOperationalReadCache(undefined, 'PRESSURE');
  try {
    const disposable = Object.keys(localStorage).filter((key) => key.startsWith('gv_cache:')
      && !key.startsWith(CACHE_STORAGE_PREFIX)
      && !key.startsWith('gv_cache:authorized-operational-scope:'));
    disposable.forEach((key) => localStorage.removeItem(key));
    removed += disposable.length;
  } catch { /* best effort */ }
  if (removed) notifyStorageMaintenance({ cleanupAt: Date.now(), cleanupCount: removed });
  return removed;
}

export function clearDisposableCaches(): number {
  let removed = clearOperationalReadCache();
  try {
    const disposable = Object.keys(localStorage).filter((key) => key.startsWith('gv_cache:')
      && !key.startsWith('gv_cache:authorized-operational-scope:'));
    disposable.forEach((key) => localStorage.removeItem(key));
    removed += disposable.length;
  } catch { /* best effort */ }
  return removed;
}

export function cachedFreshness(cachedAt: string | null): DataFreshness {
  if (!cachedAt || !Number.isFinite(Date.parse(cachedAt))) return 'NO_CACHE';
  return Date.now() - Date.parse(cachedAt) <= RECENT_OPERATIONAL_CACHE_MS ? 'RECENT_CACHE' : 'STALE_CACHE';
}

export function formatCacheAge(cachedAt: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(cachedAt));
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `${Math.floor(elapsed / 86_400_000)} day${elapsed < 172_800_000 ? '' : 's'} ago`;
}

function notifyStorageMaintenance(detail: { cleanupAt?: number; cleanupCount?: number; failureAt?: number }): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_MAINTENANCE_EVENT, { detail }));
}
