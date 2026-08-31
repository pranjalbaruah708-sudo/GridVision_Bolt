import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function message(body: InviteRequest): string | null {
  return typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
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
    if (!user) return json({ error: 'Unauthorised' }, 401);

    const { data: actor } = await admin
      .from('app_users')
      .select('role,active')
      .eq('id', user.id)
      .single();

    if (!actor?.active || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = await request.json() as InviteRequest;
    const requestedRole = typeof body.role === 'string' && roles.includes(body.role as AppRole)
      ? body.role as AppRole
      : null;
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';

    if (!email || !fullName || !requestedRole || (actor.role !== 'SUPER_ADMIN' && requestedRole === 'SUPER_ADMIN')) {
      return json({ error: 'Invalid invitation' }, 400);
    }

    const employeeCode = typeof body.employeeCode === 'string' && body.employeeCode.trim()
      ? body.employeeCode.trim()
      : null;
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
    const officeIds = Array.isArray(body.officeIds)
      ? [...new Set(body.officeIds.filter((id): id is string => typeof id === 'string'))]
      : [];
    const stationIds = Array.isArray(body.stationIds)
      ? [...new Set(body.stationIds.filter((id): id is string => typeof id === 'string'))]
      : [];

    const [{ data: existingEmail }, { data: existingEmployee }, { data: offices }, { data: stations }] = await Promise.all([
      admin.from('app_users').select('id').eq('email', email).limit(1),
      employeeCode ? admin.from('app_users').select('id').eq('employee_code', employeeCode).limit(1) : Promise.resolve({ data: [] }),
      officeIds.length ? admin.from('org_units').select('id').in('id', officeIds).eq('active', true) : Promise.resolve({ data: [] }),
      stationIds.length ? admin.from('stations').select('id').in('id', stationIds).eq('active', true) : Promise.resolve({ data: [] }),
    ]);

    if (existingEmail?.length || existingEmployee?.length || (offices?.length ?? 0) !== officeIds.length || (stations?.length ?? 0) !== stationIds.length) {
      return json({ error: 'Duplicate or invalid user scope' }, 400);
    }

    const inviteRedirectUrl = Deno.env.get('INVITE_REDIRECT_URL')?.trim();
    if (!inviteRedirectUrl) {
      return json({ error: 'Invitation delivery is not configured. Please contact an administrator.' }, 500);
    }

    const { data, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: inviteRedirectUrl,
    });
    if (invitationError || !data.user) {
      return json({ error: 'Unable to send invitation' }, 400);
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
    if (profileError) return json({ error: 'Unable to create the user profile' }, 400);

    const reason = message(body);
    await admin.from('administration_audit_log').insert({
      actor_id: user.id,
      action: 'INVITE',
      entity_type: 'APP_USER',
      entity_id: data.user.id,
      visibility: requestedRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN_ONLY' : 'ADMIN_GLOBAL',
      old_values: null,
      new_values: { full_name: fullName, employee_code: employeeCode, role: requestedRole, active: true },
      reason,
    });

    const { data: officeAssignments, error: officeAssignmentError } = officeIds.length
      ? await admin.from('user_org_units').insert(officeIds.map((org_unit_id) => ({ user_id: data.user.id, org_unit_id, active: true }))).select('id,org_unit_id')
      : { data: [], error: null };
    const { data: stationAssignments, error: stationAssignmentError } = stationIds.length
      ? await admin.from('user_stations').insert(stationIds.map((station_id) => ({ user_id: data.user.id, station_id, active: true }))).select('id,station_id')
      : { data: [], error: null };

    if (officeAssignmentError || stationAssignmentError) {
      return json({ error: 'Invitation created, but assignment setup failed. Please contact an administrator.' }, 500);
    }

    const assignmentAudits = [
      ...(officeAssignments ?? []).map(({ id, org_unit_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_OFFICE_ASSIGNMENT', entity_id: id, org_unit_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, org_unit_id, active: true }, reason })),
      ...(stationAssignments ?? []).map(({ id, station_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_STATION_ASSIGNMENT', entity_id: id, station_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, station_id, active: true }, reason })),
    ];
    if (assignmentAudits.length) await admin.from('administration_audit_log').insert(assignmentAudits);

    return json({ id: data.user.id });
  } catch {
    return json({ error: 'Unable to process the invitation. Please try again.' }, 500);
  }
});
