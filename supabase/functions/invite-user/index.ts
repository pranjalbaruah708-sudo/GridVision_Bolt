import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const authHeader = request.headers.get('Authorization') ?? '';
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser(); if (!user) return new Response('Unauthorised', { status: 401 });
  const { data: actor } = await admin.from('app_users').select('role,active').eq('id', user.id).single(); if (!actor?.active || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) return new Response('Forbidden', { status: 403 });
  const body = await request.json(); const requestedRole = body.role as string;
  if (!body.email || !body.fullName || !['OPERATOR','FIELD_OFFICER','ADMIN','SUPER_ADMIN'].includes(requestedRole) || (actor.role !== 'SUPER_ADMIN' && requestedRole === 'SUPER_ADMIN')) return new Response('Invalid invitation', { status: 400 });
  const officeIds = Array.isArray(body.officeIds) ? [...new Set(body.officeIds.filter((id: unknown) => typeof id === 'string'))] : [];
  const stationIds = Array.isArray(body.stationIds) ? [...new Set(body.stationIds.filter((id: unknown) => typeof id === 'string'))] : [];
  const [{ data: existingEmail }, { data: existingEmployee }, { data: offices }, { data: stations }] = await Promise.all([
    admin.from('app_users').select('id').eq('email', body.email).limit(1),
    body.employeeCode ? admin.from('app_users').select('id').eq('employee_code', body.employeeCode).limit(1) : Promise.resolve({ data: [] }),
    officeIds.length ? admin.from('org_units').select('id').in('id', officeIds).eq('active', true) : Promise.resolve({ data: [] }),
    stationIds.length ? admin.from('stations').select('id').in('id', stationIds).eq('active', true) : Promise.resolve({ data: [] }),
  ]);
  if (existingEmail?.length || existingEmployee?.length || (offices?.length ?? 0) !== officeIds.length || (stations?.length ?? 0) !== stationIds.length) return new Response('Duplicate or invalid user scope', { status: 400 });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, { data: { full_name: body.fullName } }); if (error || !data.user) return new Response(error?.message ?? 'Invite failed', { status: 400 });
  const { error: profileError } = await admin.from('app_users').upsert({ id: data.user.id, full_name: body.fullName, email: body.email, employee_code: body.employeeCode ?? null, phone: body.phone ?? null, role: requestedRole, active: true }, { onConflict: 'id' }); if (profileError) return new Response(profileError.message, { status: 400 });
  await admin.from('administration_audit_log').insert({
    actor_id: user.id,
    action: 'INVITE',
    entity_type: 'APP_USER',
    entity_id: data.user.id,
    visibility: requestedRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN_ONLY' : 'ADMIN_GLOBAL',
    old_values: null,
    new_values: { full_name: body.fullName, employee_code: body.employeeCode ?? null, role: requestedRole, active: true },
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
  });
  const { data: officeAssignments, error: officeAssignmentError } = officeIds.length
    ? await admin.from('user_org_units').insert(officeIds.map((org_unit_id) => ({ user_id: data.user.id, org_unit_id, active: true }))).select('id,org_unit_id')
    : { data: [], error: null };
  const { data: stationAssignments, error: stationAssignmentError } = stationIds.length
    ? await admin.from('user_stations').insert(stationIds.map((station_id) => ({ user_id: data.user.id, station_id, active: true }))).select('id,station_id')
    : { data: [], error: null };
  if (officeAssignmentError || stationAssignmentError) return new Response('Invitation created, but assignment setup failed. Please contact an administrator.', { status: 500 });
  const assignmentAudits = [
    ...(officeAssignments ?? []).map(({ id, org_unit_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_OFFICE_ASSIGNMENT', entity_id: id, org_unit_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, org_unit_id, active: true }, reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null })),
    ...(stationAssignments ?? []).map(({ id, station_id }) => ({ actor_id: user.id, action: 'CREATE_ASSIGNMENT', entity_type: 'USER_STATION_ASSIGNMENT', entity_id: id, station_id, visibility: 'SCOPED', old_values: null, new_values: { user_id: data.user.id, station_id, active: true }, reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null })),
  ];
  if (assignmentAudits.length) await admin.from('administration_audit_log').insert(assignmentAudits);
  return Response.json({ id: data.user.id });
});
