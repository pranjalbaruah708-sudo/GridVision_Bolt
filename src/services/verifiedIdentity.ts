import type { AppRole } from '@/security/permissions';
import type { DesktopIdentity } from './api';
import { getOfflineStorage } from './offlineStorage';

const IDENTITY_SCHEMA_VERSION = 1;
const IDENTITY_KEY_PREFIX = 'verified-application-identity:';

export type VerifiedApplicationIdentity = {
  schemaVersion: typeof IDENTITY_SCHEMA_VERSION;
  userId: string;
  role: AppRole;
  active: true;
  displayName: string | null;
  desktopIdentity: DesktopIdentity | null;
  verifiedAt: string;
};

function isRole(value: unknown): value is AppRole {
  return value === 'OPERATOR' || value === 'FIELD_OFFICER' || value === 'ADMIN' || value === 'SUPER_ADMIN';
}

function isDesktopIdentity(value: unknown): value is DesktopIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.full_name === 'string'
    && (row.employee_code === null || typeof row.employee_code === 'string')
    && (row.designation === null || typeof row.designation === 'string')
    && typeof row.account_role === 'string'
    && Array.isArray(row.assigned_offices)
    && row.assigned_offices.every((item) => typeof item === 'string')
    && typeof row.accessible_station_count === 'number';
}

function identityKey(userId: string): string {
  return IDENTITY_KEY_PREFIX + userId;
}

export async function readVerifiedApplicationIdentity(userId: string): Promise<VerifiedApplicationIdentity | null> {
  if (!userId) return null;
  const value = await getOfflineStorage().getMetadata<unknown>(identityKey(userId));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== IDENTITY_SCHEMA_VERSION || row.userId !== userId || row.active !== true || !isRole(row.role)) return null;
  if (typeof row.verifiedAt !== 'string' || !Number.isFinite(Date.parse(row.verifiedAt))) return null;
  if (row.displayName !== null && typeof row.displayName !== 'string') return null;
  if (row.desktopIdentity !== null && !isDesktopIdentity(row.desktopIdentity)) return null;
  return row as VerifiedApplicationIdentity;
}

export async function writeVerifiedApplicationIdentity(input: {
  userId: string;
  role: AppRole;
  displayName: string | null;
  desktopIdentity?: DesktopIdentity | null;
}): Promise<VerifiedApplicationIdentity> {
  const previous = await readVerifiedApplicationIdentity(input.userId);
  const value: VerifiedApplicationIdentity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    userId: input.userId,
    role: input.role,
    active: true,
    displayName: input.displayName,
    desktopIdentity: input.desktopIdentity === undefined ? previous?.desktopIdentity ?? null : input.desktopIdentity,
    verifiedAt: new Date().toISOString(),
  };
  await getOfflineStorage().setMetadata(identityKey(input.userId), value);
  return value;
}

export async function deleteVerifiedApplicationIdentity(userId: string): Promise<void> {
  if (userId) await getOfflineStorage().deleteMetadata(identityKey(userId));
}

export function isTransientConnectivityError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|fetch failed|network|timeout|timed out|load failed|connection|dns|offline/i.test(message);
}
