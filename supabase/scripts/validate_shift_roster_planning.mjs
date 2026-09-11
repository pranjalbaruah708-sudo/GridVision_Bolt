/*
 * Stage 4 roster-planning server-contract validation.
 * Deliberately inert without --remote.  It creates only run-labelled fixtures
 * and removes them in finally; credentials are read only from the process env.
 */
import { createClient } from '@supabase/supabase-js';

const DEVELOPMENT_PROJECT_REF = 'eetlzxntgvjompmipprb';
const DEVELOPMENT_CONFIRMATION = 'I_CONFIRM_THIS_IS_THE_GRIDVISION_DEVELOPMENT_PROJECT';
const remote = process.argv.includes('--remote');
const runId = `roster-contract-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const created = { stations: [], shifts: [], assignments: [], stationScopes: [] };
let failures = 0;

function stop(message) { throw new Error(`STOPPED: ${message}`); }
function env(name, required = true) { const value = process.env[name]?.trim(); if (required && !value) stop(`Missing environment variable ${name}.`); return value; }
function pass(name) { console.log(`[PASS] ${name}`); }
function fail(name, detail) { failures += 1; console.error(`[FAIL] ${name}: ${detail}`); }
function assert(ok, name, detail = 'assertion failed') { ok ? pass(name) : fail(name, detail); }
function client(url, key, token) { return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined }); }
function iso(minutes) { return new Date(Date.now() + minutes * 60_000).toISOString(); }
function date(value) { return value.slice(0, 10); }
function message(result) { return result?.error?.message ?? 'request unexpectedly succeeded'; }
function denied(result) { return Boolean(result?.error); }
function sameShift(a, b) { return a && b && a.station_id === b.station_id && a.shift_date === b.shift_date && a.shift_name === b.shift_name && a.scheduled_start === b.scheduled_start && a.scheduled_end === b.scheduled_end && a.status === b.status; }
function sameInstant(left, right) { return new Date(left).getTime() === new Date(right).getTime(); }
function sanitizedAuthMessage(error) {
  return String(error?.message ?? 'Authentication failed.')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<redacted-email>')
    .replace(/\beyJ[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}\b/g, '<redacted-token>')
    .slice(0, 240);
}

function configuration() {
  const url = env('SHIFT_ROSTER_TEST_SUPABASE_URL');
  const allowedRef = env('SHIFT_ROSTER_TEST_ALLOWED_PROJECT_REF');
  if (env('SHIFT_ROSTER_TEST_NON_PRODUCTION_CONFIRMATION') !== DEVELOPMENT_CONFIRMATION) stop('Explicit GridVision development confirmation is required.');
  if (allowedRef !== DEVELOPMENT_PROJECT_REF) stop('Only the approved GridVision development project ref is permitted.');
  let parsed; try { parsed = new URL(url); } catch { stop('SHIFT_ROSTER_TEST_SUPABASE_URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${DEVELOPMENT_PROJECT_REF}.supabase.co`) stop('URL host must exactly match the approved GridVision development project.');
  return { url, anon: env('SHIFT_ROSTER_TEST_ANON_KEY'), service: env('SHIFT_ROSTER_TEST_SERVICE_ROLE_KEY'), operator: env('SHIFT_ROSTER_TEST_OPERATOR_ACCESS_TOKEN'), officer: env('SHIFT_ROSTER_TEST_FIELD_OFFICER_ACCESS_TOKEN'), admin: env('SHIFT_ROSTER_TEST_ADMIN_ACCESS_TOKEN') };
}

async function userId(actor, name, accessToken) {
  const { data, error } = await actor.auth.getUser(accessToken);
  if (error || !data.user) {
    const status = error?.status ?? 'unavailable';
    const code = error?.code ?? 'unavailable';
    console.error(`[INFO] ${name} token diagnostics: present=${Boolean(accessToken)}; length=${accessToken.length}; auth.getUser success=no; status=${status}; code=${code}; message=${sanitizedAuthMessage(error)}; resolved user id=no`);
    stop(`Could not resolve ${name} test actor.`);
  }
  return data.user.id;
}
async function rpc(actor, name, args) { return actor.rpc(name, args); }
async function station(admin, suffix) {
  const { data, error } = await admin.from('stations').insert({ code: `${runId}-${suffix}`.toUpperCase().slice(0, 60), name: `Synthetic roster validation ${suffix}`, active: true }).select('id').single();
  if (error || !data) stop(`Could not create synthetic station: ${error?.message ?? 'no row'}`); created.stations.push(data.id); return data.id;
}
async function scope(admin, userIdValue, stationId) {
  const { data, error } = await admin.from('user_stations').insert({ user_id: userIdValue, station_id: stationId, active: true }).select('id').single();
  if (error || !data) stop(`Could not create synthetic station scope: ${error?.message ?? 'no row'}`); created.stationScopes.push(data.id); return data.id;
}
async function rawShift(admin, stationId, suffix, start, end, status = 'SCHEDULED') {
  const { data, error } = await admin.from('station_shifts').insert({ station_id: stationId, shift_date: date(start), shift_name: `Synthetic ${suffix}`, scheduled_start: start, scheduled_end: end, status }).select('*').single();
  if (error || !data) stop(`Could not create synthetic shift: ${error?.message ?? 'no row'}`); created.shifts.push(data.id); return data;
}
async function getShift(admin, id) { const { data, error } = await admin.from('station_shifts').select('*').eq('id', id).single(); return error ? null : data; }
async function roster(admin, shiftId) { const { data, error } = await admin.from('station_shift_assignments').select('*').eq('shift_id', shiftId).order('user_id'); return error ? null : data; }
async function rosterUnchanged(admin, shiftId, before) { const after = await roster(admin, shiftId); return JSON.stringify(after) === JSON.stringify(before); }
async function userScopes(admin, userIds, stationId) { const { data, error } = await admin.from('user_stations').select('id,user_id,station_id,active').in('user_id', userIds).eq('station_id', stationId).order('id'); return error ? null : data; }
async function denialWithState(name, request, unchanged) { const result = await request(); const intact = await unchanged(); assert(denied(result) && intact, name, message(result)); return result; }

async function cleanup(admin) {
  const warnings = [];
  const remove = async (label, query) => { const { error } = await query; if (error) warnings.push(`${label}: ${error.message}`); };
  if (created.shifts.length) await remove('roster assignments', admin.from('station_shift_assignments').delete().in('shift_id', created.shifts));
  if (created.shifts.length) await remove('duty sessions', admin.from('shift_duty_sessions').delete().in('shift_id', created.shifts));
  if (created.shifts.length) await remove('shifts', admin.from('station_shifts').delete().in('id', created.shifts));
  if (created.stationScopes.length) await remove('station scopes', admin.from('user_stations').delete().in('id', created.stationScopes));
  if (created.stations.length) await remove('stations', admin.from('stations').delete().in('id', created.stations));
  for (const warning of warnings) console.error(`[WARN] synthetic cleanup: ${warning}`);
}

async function run() {
  const cfg = configuration(); const service = client(cfg.url, cfg.service);
  const operator = client(cfg.url, cfg.anon, cfg.operator); const officer = client(cfg.url, cfg.anon, cfg.officer); const administrator = client(cfg.url, cfg.anon, cfg.admin); const anon = client(cfg.url, cfg.anon);
  const [operatorId, officerId, adminId] = await Promise.all([
    userId(operator, 'operator', cfg.operator), userId(officer, 'field officer', cfg.officer), userId(administrator, 'admin', cfg.admin),
  ]);
  const [stationA, stationB, stationC] = await Promise.all([station(service, 'A'), station(service, 'B'), station(service, 'C')]);
  await Promise.all([scope(service, officerId, stationA), scope(service, operatorId, stationA), scope(service, adminId, stationA), scope(service, adminId, stationC)]);
  const start = iso(24 * 60); const end = iso(24 * 60 + 60);
  const createArgs = (stationId, suffix, at = start, until = end) => ({ p_id: null, p_station_id: stationId, p_shift_date: date(at), p_shift_name: `Synthetic ${suffix}`, p_scheduled_start: at, p_scheduled_end: until });
  const planned = await rpc(officer, 'save_station_shift', createArgs(stationA, 'planner-create'));
  assert(!planned.error && planned.data?.status === 'SCHEDULED', 'FIELD_OFFICER can create future SCHEDULED shift within authorized station scope', message(planned));
  if (!planned.data?.id) stop('Planner fixture was not created.'); created.shifts.push(planned.data.id);
  const broaderScopeShift = await rpc(officer, 'save_station_shift', createArgs(stationB, 'field-officer-broader-scope'));
  assert(!broaderScopeShift.error && broaderScopeShift.data?.id, 'FIELD_OFFICER broader station scope follows the current authorization model', message(broaderScopeShift));
  if (!broaderScopeShift.data?.id) stop('Field Officer broader-scope fixture was not created.'); created.shifts.push(broaderScopeShift.data.id);
  assert(
    broaderScopeShift.data.station_id === stationB
      && broaderScopeShift.data.station_id !== planned.data.station_id
      && sameInstant(broaderScopeShift.data.scheduled_start, planned.data.scheduled_start)
      && sameInstant(broaderScopeShift.data.scheduled_end, planned.data.scheduled_end),
    'same time window at another station allowed',
    'the distinct-station fixture did not retain the requested window',
  );
  assert(denied(await rpc(operator, 'save_station_shift', createArgs(stationA, 'operator'))), 'OPERATOR cannot create shift');
  const adminShift = await rpc(administrator, 'save_station_shift', createArgs(stationC, 'admin', iso(24 * 60 + 240), iso(24 * 60 + 300)));
  assert(!adminShift.error && adminShift.data?.id, 'ADMIN/SUPER_ADMIN planner path works according to existing authorization model', message(adminShift)); if (adminShift.data?.id) created.shifts.push(adminShift.data.id);
  if (!adminShift.data?.id) stop('Admin planner fixture was not created.');
  assert(denied(await rpc(officer, 'save_station_shift', createArgs(stationA, 'past', iso(-60), iso(-30)))), 'shift scheduled_start must be in the future');
  assert(denied(await rpc(officer, 'save_station_shift', createArgs(stationA, 'end-before-start', iso(26 * 60), iso(25 * 60)))), 'end must be after start');
  assert(denied(await rpc(officer, 'save_station_shift', createArgs(stationA, 'overlap', iso(24 * 60 + 20), iso(24 * 60 + 80)))), 'overlapping same-station future shift rejected');
  const editedStart = iso(24 * 60 + 120); const editedEnd = iso(24 * 60 + 180);
  const edited = await rpc(officer, 'save_station_shift', { ...createArgs(stationA, 'edited', editedStart, editedEnd), p_id: planned.data.id });
  assert(
    !edited.error
      && edited.data?.id === planned.data.id
      && sameInstant(edited.data.scheduled_start, editedStart)
      && sameInstant(edited.data.scheduled_end, editedEnd),
    'future SCHEDULED shift edit succeeds',
    edited.error?.message ?? 'authoritative edited timestamps did not match the requested values',
  );
  for (const status of ['ACTIVE', 'CLOSED', 'CANCELLED']) {
    const fixture = await rawShift(service, stationA, `${status}-edit`, iso(30 * 60 + ['ACTIVE', 'CLOSED', 'CANCELLED'].indexOf(status) * 180), iso(31 * 60 + ['ACTIVE', 'CLOSED', 'CANCELLED'].indexOf(status) * 180), status);
    const before = await getShift(service, fixture.id);
    await denialWithState(`${status} shift edit denied`, () => rpc(officer, 'save_station_shift', { ...createArgs(stationA, 'forbidden-edit', iso(40 * 60), iso(41 * 60)), p_id: fixture.id }), () => getShift(service, fixture.id).then((row) => sameShift(row, before)));
  }
  const cancelled = await rpc(officer, 'cancel_station_shift', { p_shift_id: planned.data.id });
  assert(!cancelled.error && cancelled.data?.status === 'CANCELLED', 'future SCHEDULED shift cancellation succeeds', message(cancelled));
  for (const status of ['ACTIVE', 'CLOSED']) {
    const fixture = await rawShift(service, stationA, `${status}-cancel`, iso(45 * 60 + ['ACTIVE', 'CLOSED'].indexOf(status) * 180), iso(46 * 60 + ['ACTIVE', 'CLOSED'].indexOf(status) * 180), status);
    const before = await getShift(service, fixture.id);
    await denialWithState(`${status} shift cancellation denied`, () => rpc(officer, 'cancel_station_shift', { p_shift_id: fixture.id }), () => getShift(service, fixture.id).then((row) => sameShift(row, before)));
  }

  const rosterShift = await rawShift(service, stationA, 'roster', iso(55 * 60), iso(56 * 60));
  const member = [{ user_id: operatorId, duty_role: 'MEMBER' }];
  const scopesBefore = await userScopes(service, [operatorId, officerId, adminId], stationA);
  const dutyBefore = await service.from('shift_duty_sessions').select('id,user_id').eq('shift_id', rosterShift.id);
  const firstRoster = await rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: member });
  assert(!firstRoster.error && firstRoster.data?.length === 1 && firstRoster.data[0].duty_role === 'MEMBER', 'authorized station user can be assigned as MEMBER', message(firstRoster));
  assert(JSON.stringify(await userScopes(service, [operatorId, officerId, adminId], stationA)) === JSON.stringify(scopesBefore), 'creating a roster assignment does not create or modify user_stations');
  const dutyAfter = await service.from('shift_duty_sessions').select('id,user_id').eq('shift_id', rosterShift.id);
  assert(!dutyBefore.error && !dutyAfter.error && dutyBefore.data.length === dutyAfter.data.length, 'roster assignment alone creates no shift_duty_sessions');
  assert(!dutyAfter.data.some((row) => row.user_id === operatorId), 'rostered operator is not ON_DUTY merely because assigned');
  const multiple = await rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [{ user_id: operatorId, duty_role: 'MEMBER' }, { user_id: officerId, duty_role: 'MEMBER' }] });
  assert(!multiple.error && multiple.data?.length === 2, 'multiple MEMBER users can be assigned', message(multiple));
  const beforeDuplicate = await roster(service, rosterShift.id);
  await denialWithState('duplicate assignment for same user/shift rejected', () => rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [member[0], member[0]] }), () => rosterUnchanged(service, rosterShift.id, beforeDuplicate));
  const oneInCharge = await rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [{ user_id: operatorId, duty_role: 'IN_CHARGE' }, { user_id: officerId, duty_role: 'MEMBER' }] });
  assert(!oneInCharge.error && oneInCharge.data?.filter((row) => row.duty_role === 'IN_CHARGE').length === 1, 'one IN_CHARGE can be assigned', message(oneInCharge));
  const beforeSecond = await roster(service, rosterShift.id);
  await denialWithState('second IN_CHARGE rejected', () => rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [{ user_id: operatorId, duty_role: 'IN_CHARGE' }, { user_id: officerId, duty_role: 'IN_CHARGE' }] }), () => rosterUnchanged(service, rosterShift.id, beforeSecond));
  const removed = await rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [] });
  assert(!removed.error && removed.data?.length === 0 && JSON.stringify(await userScopes(service, [operatorId, officerId, adminId], stationA)) === JSON.stringify(scopesBefore), 'removing a roster assignment does not remove or modify user_stations', message(removed));
  const operatorScope = (await userScopes(service, [operatorId], stationA))?.find((row) => row.user_id === operatorId);
  if (!operatorScope) stop('Synthetic operator station scope not found.');
  const revoke = await service.from('user_stations').delete().eq('id', operatorScope.id); if (revoke.error) stop('Could not revoke synthetic operator scope.'); created.stationScopes = created.stationScopes.filter((id) => id !== operatorScope.id);
  const beforeUnauthorized = await roster(service, rosterShift.id);
  await denialWithState('unauthorized station user cannot be rostered', () => rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: member }), () => rosterUnchanged(service, rosterShift.id, beforeUnauthorized));
  await scope(service, operatorId, stationA);
  assert(denied(await rpc(officer, 'save_station_shift_roster', { p_shift_id: adminShift.data.id, p_assignments: member })), 'FIELD_OFFICER cannot roster outside own station scope');
  const beforeOperator = await roster(service, rosterShift.id);
  await denialWithState('OPERATOR cannot add roster members', () => rpc(operator, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: member }), () => rosterUnchanged(service, rosterShift.id, beforeOperator));
  await denialWithState('OPERATOR cannot change own roster role', () => rpc(operator, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [{ user_id: operatorId, duty_role: 'MEMBER' }] }), () => rosterUnchanged(service, rosterShift.id, beforeOperator));
  await denialWithState('OPERATOR cannot self-promote to IN_CHARGE', () => rpc(operator, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: [{ user_id: operatorId, duty_role: 'IN_CHARGE' }] }), () => rosterUnchanged(service, rosterShift.id, beforeOperator));
  const scheduledRoster = await rpc(officer, 'save_station_shift_roster', { p_shift_id: rosterShift.id, p_assignments: member });
  assert(!scheduledRoster.error, 'future SCHEDULED roster mutation succeeds', message(scheduledRoster));
  for (const status of ['ACTIVE', 'CLOSED', 'CANCELLED']) {
    const fixture = await rawShift(service, stationA, `${status}-roster`, iso(65 * 60 + ['ACTIVE', 'CLOSED', 'CANCELLED'].indexOf(status) * 180), iso(66 * 60 + ['ACTIVE', 'CLOSED', 'CANCELLED'].indexOf(status) * 180), status);
    const before = await roster(service, fixture.id);
    await denialWithState(`${status} shift roster mutation denied`, () => rpc(officer, 'save_station_shift_roster', { p_shift_id: fixture.id, p_assignments: member }), () => rosterUnchanged(service, fixture.id, before));
  }

  const concurrent = await rawShift(service, stationA, 'concurrent-in-charge', iso(80 * 60), iso(81 * 60));
  const competing = await Promise.all([rpc(officer, 'save_station_shift_roster', { p_shift_id: concurrent.id, p_assignments: [{ user_id: operatorId, duty_role: 'IN_CHARGE' }] }), rpc(administrator, 'save_station_shift_roster', { p_shift_id: concurrent.id, p_assignments: [{ user_id: officerId, duty_role: 'IN_CHARGE' }] })]);
  const finalConcurrent = await roster(service, concurrent.id); const successes = competing.filter((result) => !result.error).length; const inCharges = finalConcurrent?.filter((row) => row.duty_role === 'IN_CHARGE').length ?? 99;
  assert(successes >= 1 && inCharges === 1, 'IN_CHARGE protection remains concurrency-safe', `successes=${successes}, final_in_charges=${inCharges}`);

  const scheduleOperator = await rpc(operator, 'get_station_shift_schedule', { p_station_id: stationA, p_from: iso(0), p_to: iso(100 * 60) });
  assert(!scheduleOperator.error && scheduleOperator.data?.every((row) => row.station_id === stationA), 'operator can read permitted current/future shift or roster data', message(scheduleOperator));
  const scheduleOfficer = await rpc(officer, 'get_station_shift_schedule', { p_station_id: stationA, p_from: iso(0), p_to: iso(100 * 60) });
  assert(!scheduleOfficer.error && scheduleOfficer.data?.every((row) => row.station_id === stationA), 'FIELD_OFFICER can read permitted scoped schedule/roster', message(scheduleOfficer));
  assert(denied(await rpc(operator, 'get_station_shift_schedule', { p_station_id: stationB, p_from: iso(0), p_to: iso(100 * 60) })), 'unauthorized station roster data is not returned');
  const next = await rpc(operator, 'get_next_station_shift', { p_station_id: stationA });
  assert(!next.error && next.data?.every((row) => row.station_id === stationA), 'next-shift lookup is station scoped', message(next));
  const rosterRead = await rpc(operator, 'get_shift_roster', { p_shift_id: rosterShift.id });
  const allowedFields = new Set(['id', 'shift_id', 'user_id', 'full_name', 'duty_role', 'created_at']);
  assert(!rosterRead.error && rosterRead.data?.every((row) => Object.keys(row).every((key) => allowedFields.has(key)) && !('email' in row) && !('phone' in row)), 'roster read returns only intended display fields', message(rosterRead));
  assert(!rosterRead.error && rosterRead.data?.every((row) => !('email' in row) && !('phone' in row)), 'no email/phone/private profile fields are exposed', message(rosterRead));
  assert(denied(await rpc(anon, 'get_station_shift_schedule', { p_station_id: stationA, p_from: iso(0), p_to: iso(100 * 60) })), 'anon access denied where intended');
}

if (!remote) {
  console.log('SAFE: no remote validation run. Re-run with --remote and explicitly confirmed GridVision development credentials only after the reviewed migration is applied.');
} else {
  let service;
  try { const cfg = configuration(); service = client(cfg.url, cfg.service); await run(); }
  catch (error) { fail('validation setup/run', error instanceof Error ? error.message : 'unknown error'); }
  finally { if (service) await cleanup(service); }
  process.exitCode = failures ? 1 : 0;
}
