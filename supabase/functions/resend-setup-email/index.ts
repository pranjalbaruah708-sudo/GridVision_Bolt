import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ResendSetupRequest = { targetUserId?: unknown };
type AppRole = 'OPERATOR' | 'FIELD_OFFICER' | 'ADMIN' | 'SUPER_ADMIN';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

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
    if (!callerUser) return json({ error: 'Unauthorised' }, 401);

    const { data: actor } = await admin
      .from('app_users')
      .select('role,active')
      .eq('id', callerUser.id)
      .single<{ role: AppRole; active: boolean }>();
    if (!actor?.active || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = await request.json() as ResendSetupRequest;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    if (!isUuid(targetUserId)) return json({ error: 'Invalid user selection' }, 400);

    const { data: target } = await admin
      .from('app_users')
      .select('id,role,active')
      .eq('id', targetUserId)
      .maybeSingle<{ id: string; role: AppRole; active: boolean }>();
    if (!target || !target.active) return json({ error: 'User is not eligible to receive a setup email' }, 400);
    if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
      return json({ error: 'Forbidden' }, 403);
    }

    const passwordSetupRedirectUrl = Deno.env.get('PASSWORD_SETUP_REDIRECT_URL')?.trim();
    if (!passwordSetupRedirectUrl) {
      return json({ error: 'Password setup email delivery is not configured. Please contact an administrator.' }, 500);
    }

    const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(targetUserId);
    if (targetAuthError || !targetAuth.user?.email) {
      return json({ error: 'User is not eligible to receive a setup email' }, 400);
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
      return json({ error: 'A setup email was sent recently. Please wait before trying again.' }, 429);
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
      return json({ error: 'Unable to send setup email. Please try again.' }, 502);
    }

    await audit('RESEND_SETUP_EMAIL');
    return json({ success: true });
  } catch {
    return json({ error: 'Unable to process the setup email request. Please try again.' }, 500);
  }
});
