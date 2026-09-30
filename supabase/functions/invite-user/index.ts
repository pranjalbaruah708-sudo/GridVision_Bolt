import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HttpRequestError, allowedOrigins, corsHeadersFor, isUuid, jsonResponse,
  readJsonObject, rejectDisallowedOrigin, sha256Hex,
} from '../_shared/httpSecurity.ts';

const roles = ['OPERATOR', 'FIELD_OFFICER', 'ADMIN', 'SUPER_ADMIN'] as const;
type AppRole = (typeof roles)[number];

type InviteRequest = {
  fullName?: unknown;
  employeeCode?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  officeIds?: unknown;
  stationIds?: unknown;
  reason?: unknown;
};

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_ASSIGNMENTS = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function message(body: InviteRequest): string | null {
  return typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
}

function validOptionalText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length <= maxLength);
}

function uuidList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSIGNMENTS || value.some((id) => !isUuid(id))) return null;
  return [...new Set(value)];
}

async function consumeRateLimit(
  invoke: (args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<'allowed' | 'limited' | 'unavailable'> {
  const subjectHash = await sha256Hex(`${bucket}:${subject}`);
  const { data, error } = await invoke({
    p_bucket: bucket,
    p_subject_hash: subjectHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== 'boolean') return 'unavailable';
  return data ? 'allowed' : 'limited';
}

Deno.serve(async (request) => {
  const origins = allowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));
  const corsHeaders = corsHeadersFor(request, origins);
  const originError = rejectDisallowedOrigin(request, origins, corsHeaders);
  if (originError) return originError;
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, { ...corsHeaders, Allow: 'POST' });
  }

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await caller.auth.getUser();
    if (!user) return jsonResponse({ error: 'Unauthorised' }, 401, corsHeaders);

    const { data: actor } = await admin
      .from('app_users')
      .select('role,active')
      .eq('id', user.id)
      .single();

    if (!actor?.active || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const rateLimit = (args: Record<string, unknown>) => admin.rpc('consume_edge_rate_limit', args as never);
    const actorLimit = await consumeRateLimit(rateLimit, 'invite-user:actor', user.id, 20, 3600);
    if (actorLimit === 'unavailable') return jsonResponse({ error: 'Invitation service is temporarily unavailable' }, 503, corsHeaders);
    if (actorLimit === 'limited') return jsonResponse({ error: 'Too many invitation requests. Please try again later.' }, 429, corsHeaders);

    const rawBody = await readJsonObject(request, MAX_REQUEST_BYTES);
    const body = rawBody as InviteRequest;
    const allowedKeys = new Set(['fullName', 'employeeCode', 'email', 'phone', 'role', 'officeIds', 'stationIds', 'reason']);
    if (Object.keys(rawBody).some((key) => !allowedKeys.has(key))) {
      return jsonResponse({ error: 'Invalid invitation' }, 400, corsHeaders);
    }
    const requestedRole = typeof body.role === 'string' && roles.includes(body.role as AppRole)
      ? body.role as AppRole
      : null;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const officeIds = uuidList(body.officeIds);
    const stationIds = uuidList(body.stationIds);

    if (
      !EMAIL_PATTERN.test(email) || email.length > 254 || !fullName || fullName.length > 120 ||
      !requestedRole || !officeIds || !stationIds ||
      !validOptionalText(body.employeeCode, 64) || !validOptionalText(body.phone, 32) ||
      !validOptionalText(body.reason, 500) ||
      (actor.role !== 'SUPER_ADMIN' && requestedRole === 'SUPER_ADMIN')
    ) {
      return jsonResponse({ error: 'Invalid invitation' }, 400, corsHeaders);
    }

    const employeeCode = typeof body.employeeCode === 'string' && body.employeeCode.trim()
      ? body.employeeCode.trim()
      : null;
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

    const targetLimit = await consumeRateLimit(rateLimit, 'invite-user:target', email, 3, 86400);
    if (targetLimit === 'unavailable') return jsonResponse({ error: 'Invitation service is temporarily unavailable' }, 503, corsHeaders);
    if (targetLimit === 'limited') return jsonResponse({ error: 'Too many invitation requests. Please try again later.' }, 429, corsHeaders);

    const [existingEmailResult, existingEmployeeResult, officesResult, stationsResult] = await Promise.all([
      admin.from('app_users').select('id').eq('email', email).limit(1),
      employeeCode ? admin.from('app_users').select('id').eq('employee_code', employeeCode).limit(1) : Promise.resolve({ data: [] }),
      officeIds.length ? admin.from('org_units').select('id').in('id', officeIds).eq('active', true) : Promise.resolve({ data: [] }),
      stationIds.length ? admin.from('stations').select('id').in('id', stationIds).eq('active', true) : Promise.resolve({ data: [] }),
    ]);

    if (existingEmailResult.error || ('error' in existingEmployeeResult && existingEmployeeResult.error) ||
        ('error' in officesResult && officesResult.error) || ('error' in stationsResult && stationsResult.error)) {
      return jsonResponse({ error: 'Unable to validate the invitation' }, 503, corsHeaders);
    }

    if (existingEmailResult.data?.length || existingEmployeeResult.data?.length ||
        (officesResult.data?.length ?? 0) !== officeIds.length || (stationsResult.data?.length ?? 0) !== stationIds.length) {
      return jsonResponse({ error: 'Duplicate or invalid user scope' }, 400, corsHeaders);
    }

    const inviteRedirectUrl = Deno.env.get('INVITE_REDIRECT_URL')?.trim();
    if (!inviteRedirectUrl) {
      return jsonResponse({ error: 'Invitation delivery is not configured. Please contact an administrator.' }, 500, corsHeaders);
    }

    const { data, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: inviteRedirectUrl,
    });
    if (invitationError || !data.user) {
      return jsonResponse({ error: 'Unable to send invitation' }, 400, corsHeaders);
    }

    const { error: profileError } = await admin.from('app_users').upsert({
      id: data.user.id,
      full_name: fullName,
      email,
      employee_code: employeeCode,
      phone,
      role: requestedRole,
      active: true,
    }, { onConflict: 'id' });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      return jsonResponse({ error: 'Unable to create the user profile' }, 400, corsHeaders);
    }

    const { data: officeAssignments, error: officeAssignmentError } = officeIds.length
      ? await admin.from('user_org_units').insert(officeIds.map((org_unit_id) => ({ user_id: data.user.id, org_unit_id, active: true }))).select('id,org_unit_id')
      : { data: [], error: null };
    const { data: stationAssignments, error: stationAssignmentError } = stationIds.length
      ? await admin.from('user_stations').insert(stationIds.map((station_id) => ({ user_id: data.user.id, station_id, active: true }))).select('id,station_id')
      : { data: [], error: null };

    if (officeAssignmentError || stationAssignmentError) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      return jsonResponse({ error: 'Unable to create the invitation. Please try again.' }, 500, corsHeaders);
    }

    const reason = message(body);
    const auditRows = [
      { actor_id: user.id, action: 'INVITE', entity_type: 'APP_USER', entity_id: data.user.id,
        visibility: requestedRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN_ONLY' : 'ADMIN_GLOBAL',
        old_values: null, new_values: { full_name: fullName, employee_code: employeeCode, role: requestedRole, active: true }, reason },
      ...(officeAssignments ?? []).map(({ id, org_unit_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_OFFICE_ASSIGNMENT', entity_id: id, org_unit_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, org_unit_id, active: true }, reason })),
      ...(stationAssignments ?? []).map(({ id, station_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_STATION_ASSIGNMENT', entity_id: id, station_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, station_id, active: true }, reason })),
    ];
    const { error: auditError } = await admin.from('administration_audit_log').insert(auditRows);
    if (auditError) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      return jsonResponse({ error: 'Unable to create the invitation audit record. Please try again.' }, 500, corsHeaders);
    }

    return jsonResponse({ id: data.user.id }, 200, corsHeaders);
  } catch (error) {
    if (error instanceof HttpRequestError) return jsonResponse({ error: error.publicMessage }, error.status, corsHeaders);
    return jsonResponse({ error: 'Unable to process the invitation. Please try again.' }, 500, corsHeaders);
  }
});
