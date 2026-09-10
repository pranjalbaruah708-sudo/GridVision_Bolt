import { getOfflineStorage } from './offlineStorage';
import { pressureCleanupDisposableCaches } from './operationalReadCache';

export type StorageHealthLevel = 'HEALTHY' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
export type StorageHealth = { level: StorageHealthLevel; usage: number | null; quota: number | null; percent: number | null; persisted: boolean | null };

export async function estimateStorageHealth(): Promise<StorageHealth> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { level: 'UNAVAILABLE', usage: null, quota: null, percent: null, persisted: null };
  try {
    const [{ usage, quota }, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.().catch(() => false) ?? Promise.resolve(false),
    ]);
    const normalizedUsage = typeof usage === 'number' && Number.isFinite(usage) ? usage : null;
    const normalizedQuota = typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? quota : null;
    const percent = normalizedUsage !== null && normalizedQuota !== null ? Math.min(100, Math.max(0, normalizedUsage / normalizedQuota * 100)) : null;
    const level: StorageHealthLevel = percent === null ? 'UNAVAILABLE' : percent >= 90 ? 'CRITICAL' : percent >= 75 ? 'HIGH' : percent >= 50 ? 'MODERATE' : 'HEALTHY';
    return { level, usage: normalizedUsage, quota: normalizedQuota, percent, persisted: typeof persisted === 'boolean' ? persisted : null };
  } catch { return { level: 'UNAVAILABLE', usage: null, quota: null, percent: null, persisted: null }; }
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export async function runStorageMaintenance(): Promise<{ health: StorageHealth; removed: number }> {
  const initial = await estimateStorageHealth();
  const removed = initial.level === 'HIGH' || initial.level === 'CRITICAL' ? pressureCleanupDisposableCaches() : 0;
  // Opening the repository verifies that durable storage remains reachable; no durable records are removed here.
  await getOfflineStorage().countOperations();
  return { health: removed > 0 ? await estimateStorageHealth() : initial, removed };
}
