/*
 * Stage 2 server-contract validation. This script is deliberately inert unless
 * invoked with --remote and an explicitly confirmed non-production target.
 * It never contains credentials, URLs, fixture IDs, or test passwords.
 */
import { createClient } from '@supabase/supabase-js';

const DEVELOPMENT_PROJECT_REF = 'eetlzxntgvjompmipprb';
const DEVELOPMENT_CONFIRMATION = 'I_CONFIRM_THIS_IS_THE_GRIDVISION_DEVELOPMENT_PROJECT';
const remote = process.argv.includes('--remote');
const runId = `shift-contract-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const created = { stations: [], shifts: [], duties: [], handovers: [], stationScopes: [] };
let failures = 0;

function stop(message) { throw new Error(`STOPPED: ${message}`); }
function env(name, required = true) {
  const value = process.env[name]?.trim();
  if (required && !value) stop(`Missing environment variable ${name}.`);
  return value;
}
function pass(name) { console.log(`[PASS] ${name}`); }
function fail(name, detail) { failures += 1; console.error(`[FAIL] ${name}: ${detail}`); }
function assert(condition, name, detail = '') { if (condition) pass(name); else fail(name, detail || 'assertion failed'); }
function isDenied(response) {
  const status = response?.status ?? response?.error?.status;
  const code = response?.error?.code;
  return Boolean(response?.error) && (status === 401 || status === 403 || code === '42501' || /authori[sz]ed|permission denied|row-level security/i.test(response.error.message ?? ''));
}
async function denied(name, request) {
  const response = await request();
  assert(isDenied(response), name, response.error?.message ?? 'request was not denied');
  return response;
}
async function rejectedWithHandoverState(admin, name, handoverId, request, stateIsIntact) {
  const response = await request();
  const after = await admin.from('shift_handovers')
    .select('status,submitted_by_user_id,submitted_at,accepted_by_user_id,accepted_at')
    .eq('id', handoverId)
    .single();
  const rejected = Boolean(response.error);
  const intact = !after.error && Boolean(after.data) && stateIsIntact(after.data);
  assert(rejected && intact, name, response.error?.message ?? after.error?.message ?? 'forbidden transition was allowed or changed state');
  return response;
}
function client(url, key, accessToken) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}
function iso(offsetMinutes) { return new Date(Date.now() + offsetMinutes * 60_000).toISOString(); }
function localDate(value) { return value.slice(0, 10); }

function configuration() {
  const url = env('SHIFT_TEST_SUPABASE_URL');
  const allowedRef = env('SHIFT_TEST_ALLOWED_PROJECT_REF');
  const confirmation = env('SHIFT_TEST_NON_PRODUCTION_CONFIRMATION');
  if (confirmation !== DEVELOPMENT_CONFIRMATION) stop('Explicit GridVision development confirmation is required.');
  if (allowedRef !== DEVELOPMENT_PROJECT_REF) stop('Only the approved GridVision development project ref is permitted.');
  let parsed;
  try { parsed = new URL(url); } catch { stop('SHIFT_TEST_SUPABASE_URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${DEVELOPMENT_PROJECT_REF}.supabase.co`) stop('URL host must exactly match the approved GridVision development project.');
  return {
    url, anonKey: env('SHIFT_TEST_ANON_KEY'), serviceKey: env('SHIFT_TEST_SERVICE_ROLE_KEY'),
    actorTokens: ['A', 'B', 'C'].map((label) => env(`SHIFT_TEST_ACTOR_${label}_ACCESS_TOKEN`)),
  };
}

async function rpc(actor, name, args) { return actor.rpc(name, args); }
async function actorUser(actor, label) {
  const { data, error } = await actor.auth.getUser();
  if (error || !data.user) stop(`Could not resolve test actor ${label}.`);
  return data.user.id;
}
async function selectStationScopeOperator(admin, actors) {
  const actorIds = actors.map((actor) => actor.id);
  const { data, error } = await admin.from('app_users').select('id,role,active').in('id', actorIds);
  if (error || !data) stop('Could not resolve supplied actors against the application user profile.');
  const profileById = new Map(data.map((profile) => [profile.id, profile]));
  const operator = actors.find((actor) => {
    const profile = profileById.get(actor.id);
    return profile?.active === true && profile.role === 'OPERATOR';
  });
  if (!operator) stop('Stage 2 station-scope tests require at least one active OPERATOR actor.');
  return operator;
}
async function insertStation(admin, suffix) {
  const code = `${runId}-${suffix}`.toUpperCase().slice(0, 60);
  const { data, error } = await admin.from('stations').insert({ code, name: `Synthetic shift validation ${suffix}`, active: true }).select('id').single();
  if (error || !data) stop(`Could not create synthetic station: ${error?.message ?? 'no row'}`);
  created.stations.push(data.id);
  return data.id;
}
async function insertShift(admin, stationId, name, start, end) {
  const { data, error } = await admin.from('station_shifts').insert({ station_id: stationId, shift_date: localDate(start), shift_name: name, scheduled_start: start, scheduled_end: end, status: 'SCHEDULED' }).select('*').single();
  if (error || !data) stop(`Could not create synthetic shift: ${error?.message ?? 'no row'}`);
  created.shifts.push(data.id);
  return data;
}
async function assign(admin, userId, stationId) {
  const { data, error } = await admin.from('user_stations').upsert(
    { user_id: userId, station_id: stationId, active: true },
    { onConflict: 'user_id,station_id' },
  ).select('id').single();
  if (error || !data) stop(`Could not create synthetic station assignment: ${error?.message ?? 'no row'}`);
  if (!created.stationScopes.includes(data.id)) created.stationScopes.push(data.id);
  return data.id;
}
async function activeStationScopes(admin, userId, stationId) {
  const { data, error } = await admin.from('user_stations')
    .select('id,user_id,station_id,active')
    .eq('user_id', userId)
    .eq('station_id', stationId)
    .eq('active', true);
  if (error) stop(`Could not verify synthetic station scope: ${error.message}`);
  return data ?? [];
}
async function requireNoActiveStationScope(admin, userId, stationId, label) {
  const rows = await activeStationScopes(admin, userId, stationId);
  if (rows.length) stop(`${label}: active station scope precondition could not be cleared.`);
}
async function deleteSyntheticStationScope(admin, scopeId, label) {
  if (!created.stationScopes.includes(scopeId)) stop(`${label}: refusing to delete an untracked station assignment.`);
  const { data, error } = await admin.from('user_stations').delete().eq('id', scopeId).select('id');
  if (error || data?.length !== 1 || data[0].id !== scopeId) stop(`${label}: synthetic station assignment was not removed.`);
  created.stationScopes = created.stationScopes.filter((id) => id !== scopeId);
}
async function cleanup(admin) {
  const handovers = created.handovers;
  const shifts = created.shifts;
  const stations = created.stations;
  if (handovers.length) await admin.from('shift_handovers').delete().in('id', handovers);
  if (shifts.length) await admin.from('shift_duty_sessions').delete().in('shift_id', shifts);
  if (shifts.length) await admin.from('station_shifts').delete().in('id', shifts);
  if (created.stationScopes.length) await admin.from('user_stations').delete().in('id', created.stationScopes);
  if (stations.length) await admin.from('stations').delete().in('id', stations);
}

async function run() {
  const cfg = configuration();
  const admin = client(cfg.url, cfg.serviceKey);
  const [a, b, c] = cfg.actorTokens.map((token) => client(cfg.url, cfg.anonKey, token));
  const [aId, bId, cId] = await Promise.all([actorUser(a, 'A'), actorUser(b, 'B'), actorUser(c, 'C')]);
  const stationScopeActor = await selectStationScopeOperator(admin, [
    { id: aId, client: a, label: 'A' }, { id: bId, client: b, label: 'B' }, { id: cId, client: c, label: 'C' },
  ]);
  const [stationA, stationB, unauthorizedStation, handoverStation] = await Promise.all([
    insertStation(admin, 'a'), insertStation(admin, 'b'), insertStation(admin, 'unauthorized'), insertStation(admin, 'handover'),
  ]);
  await Promise.all([
    assign(admin, aId, stationA), assign(admin, bId, stationA), assign(admin, cId, stationA),
    assign(admin, aId, handoverStation), assign(admin, bId, handoverStation), assign(admin, cId, handoverStation),
  ]);

  const start = iso(-20); const end = iso(20);
  const overnightStartDate = new Date(Date.now() + 2 * 24 * 60 * 60_000);
  overnightStartDate.setUTCHours(22, 0, 0, 0);
  const overnightStart = overnightStartDate.toISOString();
  const overnightEnd = new Date(overnightStartDate.getTime() + 8 * 60 * 60_000).toISOString();
  const daytime = await insertShift(admin, stationA, 'Synthetic daytime', start, end);
  const overnight = await insertShift(admin, stationA, 'Synthetic overnight', overnightStart, overnightEnd);
  assert(Boolean(daytime.id) && Boolean(overnight.id), 'daytime and overnight shift fixtures created');
  const overlap = await admin.from('station_shifts').insert({ station_id: stationA, shift_date: localDate(iso(-10)), shift_name: 'Overlap', scheduled_start: iso(-10), scheduled_end: iso(30) });
  assert(Boolean(overlap.error), 'overlapping same-station shift rejected', overlap.error?.message ?? 'allowed');
  const otherStationShift = await insertShift(admin, stationB, 'Same window different station', start, end);
  assert(Boolean(otherStationShift.id), 'same time window at another station allowed');

  const firstStart = await rpc(a, 'start_shift_duty', { p_shift_id: daytime.id, p_shift_role: 'MEMBER' });
  assert(!firstStart.error && firstStart.data?.user_id === aId, 'authorized operator starts own duty', firstStart.error?.message);
  if (firstStart.data?.id) created.duties.push(firstStart.data.id);
  const repeatStart = await rpc(a, 'start_shift_duty', { p_shift_id: daytime.id, p_shift_role: 'MEMBER' });
  assert(!repeatStart.error && repeatStart.data?.id === firstStart.data?.id, 'repeated Start Duty is idempotent/safe', repeatStart.error?.message);
  const bStart = await rpc(b, 'start_shift_duty', { p_shift_id: daytime.id, p_shift_role: 'MEMBER' });
  assert(!bStart.error && bStart.data?.user_id === bId, 'second operator can join same shift', bStart.error?.message);
  if (bStart.data?.id) created.duties.push(bStart.data.id);
  const deniedShift = await insertShift(admin, unauthorizedStation, 'Unauthorized shift', start, end);
  await requireNoActiveStationScope(admin, stationScopeActor.id, unauthorizedStation, 'unauthorized station Start Duty denied');
  await denied('unauthorized station Start Duty denied', () => rpc(stationScopeActor.client, 'start_shift_duty', { p_shift_id: deniedShift.id, p_shift_role: 'MEMBER' }));
  await denied('direct duty insert cannot impersonate another operator', () => a.from('shift_duty_sessions').insert({ shift_id: daytime.id, station_id: stationA, user_id: bId, shift_role: 'MEMBER' }));
  await denied('one operator cannot end another operator duty', () => rpc(a, 'end_shift_duty', { p_duty_session_id: bStart.data.id }));
  const endOwn = await rpc(a, 'end_shift_duty', { p_duty_session_id: firstStart.data.id });
  assert(!endOwn.error && endOwn.data?.status === 'ENDED', 'own End Duty succeeds', endOwn.error?.message);
  const repeatEnd = await rpc(a, 'end_shift_duty', { p_duty_session_id: firstStart.data.id });
  assert(!repeatEnd.error && repeatEnd.data?.id === firstStart.data?.id, 'repeated End Duty is safe', repeatEnd.error?.message);

  const outgoing = await insertShift(admin, handoverStation, 'Outgoing handover shift', iso(-80), iso(-40));
  const incoming = await insertShift(admin, handoverStation, 'Incoming handover shift', iso(-40), iso(40));
  const outgoingDuty = await admin.from('shift_duty_sessions').insert({ shift_id: outgoing.id, station_id: handoverStation, user_id: aId, shift_role: 'MEMBER', status: 'ENDED', started_at: iso(-75), ended_at: iso(-45) }).select('id').single();
  const incomingB = await admin.from('shift_duty_sessions').insert({ shift_id: incoming.id, station_id: handoverStation, user_id: bId, shift_role: 'MEMBER', status: 'ON_DUTY', started_at: iso(-35) }).select('id').single();
  const incomingC = await admin.from('shift_duty_sessions').insert({ shift_id: incoming.id, station_id: handoverStation, user_id: cId, shift_role: 'MEMBER', status: 'ON_DUTY', started_at: iso(-34) }).select('id').single();
  created.duties.push(outgoingDuty.data?.id, incomingB.data?.id, incomingC.data?.id);
  const draft = await rpc(a, 'get_or_create_shift_handover', { p_outgoing_shift_id: outgoing.id, p_incoming_shift_id: incoming.id });
  assert(!draft.error && draft.data?.status === 'DRAFT', 'outgoing participant obtains handover draft', draft.error?.message);
  if (draft.data?.id) created.handovers.push(draft.data.id);
  const saved = await rpc(a, 'save_shift_handover_draft', { p_handover_id: draft.data.id, p_outgoing_notes: 'Synthetic handover note', p_items: [{ source_type: 'OPERATIONAL_NOTE', description: 'Synthetic note', priority: 'LOW' }] });
  assert(!saved.error && saved.data?.status === 'DRAFT', 'draft save works', saved.error?.message);
  await denied('non-participant cannot edit outgoing draft', () => rpc(b, 'save_shift_handover_draft', { p_handover_id: draft.data.id, p_outgoing_notes: 'attempt', p_items: [] }));
  await rejectedWithHandoverState(
    admin,
    'DRAFT handover cannot be accepted',
    draft.data.id,
    () => rpc(b, 'accept_shift_handover', { p_handover_id: draft.data.id, p_acceptance_comments: null }),
    (row) => row.status === 'DRAFT' && row.accepted_by_user_id == null && row.accepted_at == null,
  );
  const submitted = await rpc(a, 'submit_shift_handover', { p_handover_id: draft.data.id, p_outgoing_notes: 'Synthetic handover note' });
  assert(!submitted.error && submitted.data?.status === 'SUBMITTED', 'submit transitions DRAFT to SUBMITTED', submitted.error?.message);
  await denied('duplicate competing submit prevented', () => rpc(b, 'submit_shift_handover', { p_handover_id: draft.data.id, p_outgoing_notes: 'attempt' }));
  await denied('incoming user must be actively on duty to accept', () => rpc(a, 'accept_shift_handover', { p_handover_id: draft.data.id, p_acceptance_comments: null }));
  const accepted = await rpc(b, 'accept_shift_handover', { p_handover_id: draft.data.id, p_acceptance_comments: 'Synthetic acceptance' });
  assert(!accepted.error && accepted.data?.status === 'ACCEPTED' && accepted.data?.accepted_by_user_id === bId, 'incoming on-duty user accepts submitted handover', accepted.error?.message);
  await rejectedWithHandoverState(
    admin,
    'competing second acceptance prevented',
    draft.data.id,
    () => rpc(c, 'accept_shift_handover', { p_handover_id: draft.data.id, p_acceptance_comments: 'attempt' }),
    (row) => row.status === 'ACCEPTED' && row.accepted_by_user_id === bId && row.accepted_at != null,
  );
  await rejectedWithHandoverState(
    admin,
    'accepted handover cannot be resubmitted',
    draft.data.id,
    () => rpc(a, 'submit_shift_handover', { p_handover_id: draft.data.id, p_outgoing_notes: 'attempt' }),
    (row) => row.status === 'ACCEPTED'
      && row.submitted_by_user_id === accepted.data?.submitted_by_user_id
      && row.submitted_at === accepted.data?.submitted_at
      && row.accepted_by_user_id === accepted.data?.accepted_by_user_id
      && row.accepted_at === accepted.data?.accepted_at,
  );
  const crossStation = await rpc(a, 'get_or_create_shift_handover', { p_outgoing_shift_id: outgoing.id, p_incoming_shift_id: otherStationShift.id });
  assert(Boolean(crossStation.error), 'different-station transition rejected', crossStation.error?.message);

  const anon = client(cfg.url, cfg.anonKey);
  await denied('anon RPC execution unavailable', () => rpc(anon, 'start_shift_duty', { p_shift_id: daytime.id, p_shift_role: 'MEMBER' }));
  const scopeRows = await activeStationScopes(admin, stationScopeActor.id, stationA);
  if (scopeRows.length !== 1) stop('station scope is re-evaluated server-side: expected exactly one tracked synthetic station assignment before revocation.');
  await deleteSyntheticStationScope(admin, scopeRows[0].id, 'station scope is re-evaluated server-side');
  await requireNoActiveStationScope(admin, stationScopeActor.id, stationA, 'station scope is re-evaluated server-side');
  await denied('station scope is re-evaluated server-side', () => rpc(stationScopeActor.client, 'get_current_station_shift', { p_station_id: stationA }));
  await assign(admin, stationScopeActor.id, stationA);

  const sourceIds = {
    interruption: env('SHIFT_TEST_VALID_INTERRUPTION_ID', false),
    alert: env('SHIFT_TEST_VALID_PARAMETER_ALERT_ID', false),
    logbook: env('SHIFT_TEST_VALID_LOGBOOK_ENTRY_ID', false),
    otherStation: env('SHIFT_TEST_OTHER_STATION_SOURCE_ID', false),
    station: env('SHIFT_TEST_SOURCE_STATION_ID', false),
  };
  if (sourceIds.interruption && sourceIds.alert && sourceIds.logbook && sourceIds.otherStation && sourceIds.station) {
    const sourceOutgoing = await insertShift(admin, sourceIds.station, 'Synthetic source outgoing', iso(180), iso(220));
    const sourceIncoming = await insertShift(admin, sourceIds.station, 'Synthetic source incoming', iso(220), iso(280));
    const sourceDuty = await admin.from('shift_duty_sessions').insert({ shift_id: sourceOutgoing.id, station_id: sourceIds.station, user_id: aId, shift_role: 'MEMBER', status: 'ENDED', started_at: iso(185), ended_at: iso(215) }).select('id').single();
    if (sourceDuty.error) stop(`Could not create synthetic source duty: ${sourceDuty.error.message}`);
    created.duties.push(sourceDuty.data.id);
    const sourceDraft = await rpc(a, 'get_or_create_shift_handover', { p_outgoing_shift_id: sourceOutgoing.id, p_incoming_shift_id: sourceIncoming.id });
    if (sourceDraft.data?.id) created.handovers.push(sourceDraft.data.id);
    const validSources = await rpc(a, 'save_shift_handover_draft', { p_handover_id: sourceDraft.data.id, p_outgoing_notes: null, p_items: [
      { source_type: 'INTERRUPTION', source_id: sourceIds.interruption }, { source_type: 'PARAMETER_ALERT', source_id: sourceIds.alert }, { source_type: 'LOGBOOK_ENTRY', source_id: sourceIds.logbook },
    ] });
    assert(!validSources.error, 'valid same-station interruption/alert/logbook references accepted', validSources.error?.message);
    const wrongSource = await rpc(a, 'save_shift_handover_draft', { p_handover_id: sourceDraft.data.id, p_outgoing_notes: null, p_items: [{ source_type: 'INTERRUPTION', source_id: sourceIds.otherStation }] });
    assert(Boolean(wrongSource.error), 'different-station source reference rejected', wrongSource.error?.message);
    const duplicateSource = await rpc(a, 'save_shift_handover_draft', { p_handover_id: sourceDraft.data.id, p_outgoing_notes: null, p_items: [{ source_type: 'INTERRUPTION', source_id: sourceIds.interruption }, { source_type: 'INTERRUPTION', source_id: sourceIds.interruption }] });
    assert(Boolean(duplicateSource.error), 'duplicate source reference rejected', duplicateSource.error?.message);
  } else {
    console.log('[SKIP] source-reference fixture checks require an isolated source station and four explicitly supplied, non-mutated source IDs.');
  }
}

if (!remote) {
  console.log('SAFE: no remote validation run. Re-run with --remote and explicit GridVision development environment variables after applying the migration.');
} else {
  let admin;
  try {
    const cfg = configuration(); admin = client(cfg.url, cfg.serviceKey);
    await run();
  } catch (error) {
    fail('validation setup/run', error instanceof Error ? error.message : 'unknown error');
  } finally {
    if (admin) await cleanup(admin).catch((error) => fail('synthetic fixture cleanup', error instanceof Error ? error.message : 'unknown error'));
  }
  process.exitCode = failures ? 1 : 0;
}
