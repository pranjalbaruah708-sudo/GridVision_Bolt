import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HttpRequestError, allowedOrigins, corsHeadersFor, isUuid, jsonResponse,
  readJsonObject, rejectDisallowedOrigin, sha256Hex,
} from '../_shared/httpSecurity.ts';

type ResendSetupRequest = { targetUserId?: unknown };
type AppRole = 'OPERATOR' | 'FIELD_OFFICER' | 'ADMIN' | 'SUPER_ADMIN';
const MAX_REQUEST_BYTES = 4 * 1024;

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
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, { ...corsHeaders, Allow: 'POST' });

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

    const { data: { user: callerUser } } = await caller.auth.getUser();
    if (!callerUser) return jsonResponse({ error: 'Unauthorised' }, 401, corsHeaders);

    const { data: actor } = await admin
      .from('app_users')
      .select('role,active')
      .eq('id', callerUser.id)
      .single<{ role: AppRole; active: boolean }>();
    if (!actor?.active || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const rateLimit = (args: Record<string, unknown>) => admin.rpc('consume_edge_rate_limit', args as never);
    const actorLimit = await consumeRateLimit(rateLimit, 'resend-setup-email:actor', callerUser.id, 30, 3600);
    if (actorLimit === 'unavailable') return jsonResponse({ error: 'Setup email service is temporarily unavailable' }, 503, corsHeaders);
    if (actorLimit === 'limited') return jsonResponse({ error: 'Too many setup email requests. Please try again later.' }, 429, corsHeaders);

    const rawBody = await readJsonObject(request, MAX_REQUEST_BYTES);
    if (Object.keys(rawBody).some((key) => key !== 'targetUserId')) {
      return jsonResponse({ error: 'Invalid user selection' }, 400, corsHeaders);
    }
    const body = rawBody as ResendSetupRequest;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    if (!isUuid(targetUserId)) return jsonResponse({ error: 'Invalid user selection' }, 400, corsHeaders);

    const { data: target } = await admin
      .from('app_users')
      .select('id,role,active')
      .eq('id', targetUserId)
      .maybeSingle<{ id: string; role: AppRole; active: boolean }>();
    if (!target || !target.active) return jsonResponse({ error: 'User is not eligible to receive a setup email' }, 400, corsHeaders);
    if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const targetLimit = await consumeRateLimit(rateLimit, 'resend-setup-email:target', targetUserId, 3, 3600);
    if (targetLimit === 'unavailable') return jsonResponse({ error: 'Setup email service is temporarily unavailable' }, 503, corsHeaders);
    if (targetLimit === 'limited') return jsonResponse({ error: 'A setup email was sent recently. Please wait before trying again.' }, 429, corsHeaders);

    const passwordSetupRedirectUrl = Deno.env.get('PASSWORD_SETUP_REDIRECT_URL')?.trim();
    if (!passwordSetupRedirectUrl) {
      return jsonResponse({ error: 'Password setup email delivery is not configured. Please contact an administrator.' }, 500, corsHeaders);
    }

    const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(targetUserId);
    if (targetAuthError || !targetAuth.user?.email) {
      return jsonResponse({ error: 'User is not eligible to receive a setup email' }, 400, corsHeaders);
    }

    const cooldownStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentResend } = await admin
      .from('administration_audit_log')
      .select('id')
      .eq('entity_type', 'APP_USER')
      .eq('entity_id', targetUserId)
      .eq('action', 'RESEND_SETUP_EMAIL')
      .gte('created_at', cooldownStart)
      .limit(1);
    if (recentResend?.length) {
      return jsonResponse({ error: 'A setup email was sent recently. Please wait before trying again.' }, 429, corsHeaders);
    }

    const visibility = target.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN_ONLY' : 'ADMIN_GLOBAL';
    const audit = async (action: 'RESEND_SETUP_EMAIL' | 'RESEND_SETUP_EMAIL_FAILED') => {
      await admin.from('administration_audit_log').insert({
        actor_id: callerUser.id,
        action,
        entity_type: 'APP_USER',
        entity_id: targetUserId,
        visibility,
        old_values: null,
        new_values: { outcome: action === 'RESEND_SETUP_EMAIL' ? 'SENT' : 'FAILED', delivery: 'PASSWORD_RECOVERY' },
        reason: 'Password setup email resent by administrator.',
      });
    };

    const { error: recoveryError } = await admin.auth.resetPasswordForEmail(targetAuth.user.email, {
      redirectTo: passwordSetupRedirectUrl,
    });
    if (recoveryError) {
      await audit('RESEND_SETUP_EMAIL_FAILED');
      return jsonResponse({ error: 'Unable to send setup email. Please try again.' }, 502, corsHeaders);
    }

    await audit('RESEND_SETUP_EMAIL');
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (error) {
    if (error instanceof HttpRequestError) return jsonResponse({ error: error.publicMessage }, error.status, corsHeaders);
    return jsonResponse({ error: 'Unable to process the setup email request. Please try again.' }, 500, corsHeaders);
  }
});
