import type { SyncFailureCategory } from './offline';
import { getOfflineStorage, LAST_DURABLE_WRITE_KEY } from './offlineStorage';

const SCHEMA_VERSION = 1 as const;
const PREFIX = 'diagnostics:summary:';
export const DIAGNOSTICS_CHANGED_EVENT = 'gv-diagnostics-changed';
const writeChains = new Map<string, Promise<void>>();

export type SyncDiagnosticResult = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NO_CHANGES';
export type AuthorizationDiagnosticStatus = 'VERIFIED' | 'REVOKED' | 'TEMPORARILY_UNAVAILABLE' | 'REQUIRES_RECONNECTION';
export type DiagnosticSummary = {
  schemaVersion: typeof SCHEMA_VERSION; userId: string; updatedAt: string;
  lastSyncAttemptAt: string | null; lastSuccessfulSyncAt: string | null; lastSyncResult: SyncDiagnosticResult | null;
  lastSyncSucceeded: number; lastSyncFailed: number; dominantFailureCategory: SyncFailureCategory | null;
  backendStatus: 'REACHABLE' | 'TEMPORARY_ISSUE' | 'NOT_VERIFIED';
  authorizationStatus: AuthorizationDiagnosticStatus | null; authorizationVerifiedAt: string | null;
  lastStorageFailureAt: string | null; lastCacheCleanupAt: string | null; lastCacheCleanupCount: number;
};
type DiagnosticPatch = Partial<Omit<DiagnosticSummary, 'schemaVersion' | 'userId' | 'updatedAt'>>;

const isoNow = () => new Date().toISOString();
const validIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isFailureCategory = (value: unknown): value is SyncFailureCategory => ['TRANSIENT', 'AUTHORIZATION', 'CONFLICT', 'VALIDATION', 'DEPENDENCY', 'UNKNOWN'].includes(String(value));

function emptySummary(userId: string): DiagnosticSummary {
  return { schemaVersion: SCHEMA_VERSION, userId, updatedAt: isoNow(), lastSyncAttemptAt: null, lastSuccessfulSyncAt: null,
    lastSyncResult: null, lastSyncSucceeded: 0, lastSyncFailed: 0, dominantFailureCategory: null, backendStatus: 'NOT_VERIFIED',
    authorizationStatus: null, authorizationVerifiedAt: null, lastStorageFailureAt: null, lastCacheCleanupAt: null, lastCacheCleanupCount: 0 };
}

function normalize(userId: string, value: unknown): DiagnosticSummary {
  const fallback = emptySummary(userId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== SCHEMA_VERSION || row.userId !== userId) return fallback;
  const syncResult = ['SUCCESS', 'PARTIAL', 'FAILED', 'NO_CHANGES'].includes(String(row.lastSyncResult)) ? row.lastSyncResult as SyncDiagnosticResult : null;
  const authStatus = ['VERIFIED', 'REVOKED', 'TEMPORARILY_UNAVAILABLE', 'REQUIRES_RECONNECTION'].includes(String(row.authorizationStatus)) ? row.authorizationStatus as AuthorizationDiagnosticStatus : null;
  const backendStatus = ['REACHABLE', 'TEMPORARY_ISSUE', 'NOT_VERIFIED'].includes(String(row.backendStatus)) ? row.backendStatus as DiagnosticSummary['backendStatus'] : 'NOT_VERIFIED';
  return { ...fallback, updatedAt: validIso(row.updatedAt) ? row.updatedAt : fallback.updatedAt,
    lastSyncAttemptAt: validIso(row.lastSyncAttemptAt) ? row.lastSyncAttemptAt : null,
    lastSuccessfulSyncAt: validIso(row.lastSuccessfulSyncAt) ? row.lastSuccessfulSyncAt : null, lastSyncResult: syncResult,
    lastSyncSucceeded: validCount(row.lastSyncSucceeded) ? row.lastSyncSucceeded : 0,
    lastSyncFailed: validCount(row.lastSyncFailed) ? row.lastSyncFailed : 0,
    dominantFailureCategory: isFailureCategory(row.dominantFailureCategory) ? row.dominantFailureCategory : null,
    backendStatus, authorizationStatus: authStatus,
    authorizationVerifiedAt: validIso(row.authorizationVerifiedAt) ? row.authorizationVerifiedAt : null,
    lastStorageFailureAt: validIso(row.lastStorageFailureAt) ? row.lastStorageFailureAt : null,
    lastCacheCleanupAt: validIso(row.lastCacheCleanupAt) ? row.lastCacheCleanupAt : null,
    lastCacheCleanupCount: validCount(row.lastCacheCleanupCount) ? row.lastCacheCleanupCount : 0 };
}

export async function getDiagnosticSummary(userId: string): Promise<DiagnosticSummary> {
  if (!userId) return emptySummary('');
  try {
    const storage = getOfflineStorage();
    const summary = normalize(userId, await storage.getMetadata<unknown>(PREFIX + userId));
    if (!summary.lastSuccessfulSyncAt) {
      const legacy = await storage.getMetadata<unknown>('last-successful-sync:' + userId);
      if (typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0) summary.lastSuccessfulSyncAt = new Date(legacy).toISOString();
    }
    return summary;
  } catch { return emptySummary(userId); }
}

export async function updateDiagnosticSummary(userId: string, patch: DiagnosticPatch): Promise<void> {
  if (!userId) return;
  const previous = writeChains.get(userId) ?? Promise.resolve();
  const write = previous.then(async () => {
    try {
      const current = await getDiagnosticSummary(userId);
      await getOfflineStorage().setMetadata(PREFIX + userId, { ...current, ...patch, schemaVersion: SCHEMA_VERSION, userId, updatedAt: isoNow() });
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
    } catch { /* Diagnostics are best effort and must not block operational work. */ }
  }, () => undefined);
  writeChains.set(userId, write);
  await write;
  if (writeChains.get(userId) === write) writeChains.delete(userId);
}

export function recordSyncStarted(userId: string): Promise<void> { return updateDiagnosticSummary(userId, { lastSyncAttemptAt: isoNow() }); }
export function recordSyncCompleted(userId: string, result: { ok: number; failed: number; dominantFailureCategory?: SyncFailureCategory | null }): Promise<void> {
  const now = isoNow();
  const lastSyncResult: SyncDiagnosticResult = result.failed > 0 ? (result.ok > 0 ? 'PARTIAL' : 'FAILED') : (result.ok > 0 ? 'SUCCESS' : 'NO_CHANGES');
  return updateDiagnosticSummary(userId, { lastSyncAttemptAt: now, ...(result.ok > 0 ? { lastSuccessfulSyncAt: now } : {}), lastSyncResult,
    lastSyncSucceeded: result.ok, lastSyncFailed: result.failed, dominantFailureCategory: result.dominantFailureCategory ?? null,
    backendStatus: result.dominantFailureCategory === 'TRANSIENT' && result.ok === 0 ? 'TEMPORARY_ISSUE' : 'REACHABLE' });
}
export function recordAuthorizationDiagnostic(userId: string, status: AuthorizationDiagnosticStatus): Promise<void> {
  return updateDiagnosticSummary(userId, { authorizationStatus: status,
    ...(status === 'VERIFIED' || status === 'REVOKED' ? { authorizationVerifiedAt: isoNow() } : {}),
    ...(status === 'VERIFIED' ? { backendStatus: 'REACHABLE' as const } : {}) });
}
export function recordStorageFailure(userId: string): Promise<void> { return updateDiagnosticSummary(userId, { lastStorageFailureAt: isoNow() }); }
export function recordCacheCleanup(userId: string, count: number): Promise<void> { return updateDiagnosticSummary(userId, { lastCacheCleanupAt: isoNow(), lastCacheCleanupCount: Math.max(0, Math.floor(count)) }); }
export async function getLastDurableWriteAt(): Promise<number | null> {
  try { const value = await getOfflineStorage().getMetadata<unknown>(LAST_DURABLE_WRITE_KEY); return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null; }
  catch { return null; }
}
export function friendlyFailureCategory(value: SyncFailureCategory | null): string {
  return ({ TRANSIENT: 'Temporary connection issue', AUTHORIZATION: 'Access changed', CONFLICT: 'Conflict', VALIDATION: 'Entry needs review', DEPENDENCY: 'Waiting for related record', UNKNOWN: 'Unknown issue' } as Record<SyncFailureCategory, string>)[value ?? 'UNKNOWN'];
}

export type CopyDiagnosticsInput = { generatedAt: Date; appVersion: string; platform: string; runtime: string; online: boolean;
  summary: DiagnosticSummary; pending: number; needsAttention: number; oldestPendingAt: number | null; storageHealth: string;
  storageUsage: string; storagePersistence: string; lastDurableWriteAt: number | null; drafts: number; oldestDraftAt: number | null;
  cachedViews: number; notificationPermission: string; notificationDevice: string };

export function buildSanitizedDiagnosticsText(input: CopyDiagnosticsInput): string {
  const exact = (value: string | number | null) => value == null ? 'Not available' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }).format(typeof value === 'number' ? value : Date.parse(value));
  const syncResult = input.summary.lastSyncResult === 'SUCCESS' ? `${input.summary.lastSyncSucceeded} synchronized`
    : input.summary.lastSyncResult === 'PARTIAL' ? `${input.summary.lastSyncSucceeded} synchronized, ${input.summary.lastSyncFailed} needs attention`
      : input.summary.lastSyncResult === 'FAILED' ? friendlyFailureCategory(input.summary.dominantFailureCategory)
        : input.summary.lastSyncResult === 'NO_CHANGES' ? 'No pending changes' : 'Not yet attempted';
  const authorization = input.summary.authorizationStatus === 'VERIFIED' ? 'Verified' : input.summary.authorizationStatus === 'REVOKED' ? 'Access changed'
    : input.summary.authorizationStatus === 'TEMPORARILY_UNAVAILABLE' ? 'Temporarily unavailable'
      : input.summary.authorizationStatus === 'REQUIRES_RECONNECTION' ? 'Requires reconnection' : 'Not verified';
  return ['GridVision Diagnostics', `Generated: ${exact(input.generatedAt.getTime())}`, '', `App version: ${input.appVersion}`,
    `Platform: ${input.platform}`, `Runtime: ${input.runtime}`, `Connectivity: ${input.online ? 'Online' : 'Offline'}`,
    `Backend: ${input.online ? ({ REACHABLE: 'Reachable', TEMPORARY_ISSUE: 'Temporary connection issue', NOT_VERIFIED: 'Not recently verified' }[input.summary.backendStatus]) : 'Not currently reachable'}`,
    `Access verification: ${authorization}`, `Access last verified: ${exact(input.summary.authorizationVerifiedAt)}`,
    `Last sync attempt: ${exact(input.summary.lastSyncAttemptAt)}`, `Last successful sync: ${exact(input.summary.lastSuccessfulSyncAt)}`,
    `Last sync result: ${syncResult}`, `Pending sync: ${input.pending}`, `Needs attention: ${input.needsAttention}`,
    `Oldest pending: ${exact(input.oldestPendingAt)}`, `Storage health: ${input.storageHealth}`, `Storage usage: ${input.storageUsage}`,
    `Storage persistence: ${input.storagePersistence}`, `Last successful storage write: ${exact(input.lastDurableWriteAt)}`,
    `Last storage failure: ${exact(input.summary.lastStorageFailureAt)}`, `Last cache cleanup: ${exact(input.summary.lastCacheCleanupAt)}`,
    `Cache items removed: ${input.summary.lastCacheCleanupCount}`, `Unsaved drafts: ${input.drafts}`, `Oldest draft: ${exact(input.oldestDraftAt)}`,
    `Cached operational views: ${input.cachedViews}`, `Push notification permission: ${input.notificationPermission}`,
    `Push notification device: ${input.notificationDevice}`].join('\n');
}
