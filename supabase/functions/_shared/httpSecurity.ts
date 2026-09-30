const DEFAULT_NATIVE_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
] as const;

export class HttpRequestError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(
    status: number,
    publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'HttpRequestError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:', 'capacitor:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return null;
  }
}

export function allowedOrigins(configuredOrigins: string | undefined): ReadonlySet<string> {
  const configured = (configuredOrigins ?? '')
    .split(',')
    .map(normalizedOrigin)
    .filter((origin): origin is string => Boolean(origin));
  return new Set([...DEFAULT_NATIVE_ORIGINS, ...configured]);
}

export function corsHeadersFor(
  request: Request,
  origins: ReadonlySet<string>,
  allowedHeaders = 'authorization, x-client-info, apikey, content-type',
): Record<string, string> {
  const origin = request.headers.get('Origin');
  return {
    ...(origin && origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function rejectDisallowedOrigin(
  request: Request,
  origins: ReadonlySet<string>,
  headers: Record<string, string>,
): Response | null {
  const origin = request.headers.get('Origin');
  if (!origin || origins.has(origin)) return null;
  return jsonResponse({ error: 'Origin is not allowed' }, 403, headers);
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function contentLength(request: Request): number | null {
  const raw = request.headers.get('Content-Length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function readJsonObject(
  request: Request,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  const declaredLength = contentLength(request);
  if (mediaType !== 'application/json') {
    if (options.allowEmpty && (request.body === null || declaredLength === 0)) return {};
    throw new HttpRequestError(415, 'Content-Type must be application/json');
  }

  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new HttpRequestError(413, 'Request is too large');
  }

  const reader = request.body?.getReader();
  if (!reader) {
    if (options.allowEmpty) return {};
    throw new HttpRequestError(400, 'Invalid JSON request');
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel('request body limit exceeded').catch(() => undefined);
      throw new HttpRequestError(413, 'Request is too large');
    }
    chunks.push(value);
  }

  if (totalBytes === 0 && options.allowEmpty) return {};
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpRequestError(400, 'Invalid JSON request');
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
