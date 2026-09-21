export const OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE =
  'Entry could not be saved because you are not currently authorised for duty at this station. Check Current Shift and start or accept your assigned duty before trying again.';

export const OPERATIONAL_WRITE_DUTY_ENDED_MESSAGE =
  'Your duty has ended. Operational entries can no longer be submitted for this shift.';

export const OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE =
  'This offline entry could not be synced because your duty authorisation was no longer valid when synchronization was attempted. The entry has been retained for review.';

type ErrorRecord = {
  code?: unknown;
  postgresCode?: unknown;
  message?: unknown;
  diagnosticMessage?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
};

export type OperationalWriteDiagnostic = {
  postgresCode: string | null;
  httpStatus: number | null;
  technicalMessage: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function errorRecord(error: unknown): ErrorRecord {
  if (isRecord(error)) return error;
  if (error instanceof Error) return { message: error.message };
  return {};
}

function cleanTechnicalText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function operationalWriteDiagnostic(error: unknown, httpStatus?: number | null): OperationalWriteDiagnostic {
  if (error instanceof OperationalWriteAuthorizationError) return error.diagnostic;
  const record = errorRecord(error);
  const status = typeof httpStatus === 'number' && Number.isInteger(httpStatus)
    ? httpStatus
    : typeof record.status === 'number' && Number.isInteger(record.status) ? record.status : null;
  return {
    postgresCode: typeof record.code === 'string' ? record.code.slice(0, 20)
      : typeof record.postgresCode === 'string' ? record.postgresCode.slice(0, 20) : null,
    httpStatus: status,
    technicalMessage: cleanTechnicalText(record.diagnosticMessage ?? record.message),
  };
}

export function isOperationalWriteAuthorizationFailure(error: unknown): boolean {
  return operationalWriteDiagnostic(error).postgresCode === '42501';
}

function dutyEndedIsKnown(error: unknown): boolean {
  const record = errorRecord(error);
  const text = [record.message, record.details, record.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return /\bduty\b[^.]{0,80}\b(?:ended|closed|completed)\b/i.test(text)
    || /\b(?:ended|closed|completed)\b[^.]{0,80}\bduty\b/i.test(text);
}

export class OperationalWriteAuthorizationError extends Error {
  readonly code = '42501';
  readonly diagnostic: OperationalWriteDiagnostic;

  constructor(
    diagnostic: OperationalWriteDiagnostic,
    dutyEnded = false,
  ) {
    super(dutyEnded ? OPERATIONAL_WRITE_DUTY_ENDED_MESSAGE : OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE);
    this.name = 'OperationalWriteAuthorizationError';
    this.diagnostic = diagnostic;
  }
}

/** Maps only PostgreSQL authorization failures; all other errors keep their existing handling. */
export function mapOperationalWriteError(error: unknown, httpStatus?: number | null): unknown {
  if (error instanceof OperationalWriteAuthorizationError) return error;
  const diagnostic = operationalWriteDiagnostic(error, httpStatus);
  if (diagnostic.postgresCode !== '42501') return error;
  return new OperationalWriteAuthorizationError(diagnostic, dutyEndedIsKnown(error));
}

export function operationalWriteUserMessage(error: unknown, fallback: string): string {
  const mapped = mapOperationalWriteError(error);
  return mapped instanceof Error ? mapped.message : fallback;
}

export function offlineOperationalAuthorizationFailure(error: unknown, httpStatus?: number | null) {
  return {
    failureCategory: 'AUTHORIZATION' as const,
    syncState: 'NEEDS_ATTENTION' as const,
    userMessage: OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE,
    diagnostic: operationalWriteDiagnostic(error, httpStatus),
  };
}

/** Keeps expected authorization denials out of the error console while retaining safe diagnostics. */
export function reportOperationalWriteFailure(label: string, error: unknown): void {
  const diagnostic = operationalWriteDiagnostic(error);
  if (diagnostic.postgresCode === '42501') {
    console.info(label, diagnostic);
    return;
  }
  console.error(label, diagnostic);
}
