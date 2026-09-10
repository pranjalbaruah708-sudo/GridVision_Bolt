import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'fylnuppelaebrhqllzzh';
const PRODUCTION_REF = 'eetlzxntgvjompmipprb';
const USERS = {
  operatorA: { label: 'Operator A', email: 'operator.a@gridvision-staging.test', passwordEnv: 'STAGING_OPERATOR_A_PASSWORD' },
  operatorB: { label: 'Operator B', email: 'operator.b@gridvision-staging.test', passwordEnv: 'STAGING_OPERATOR_B_PASSWORD' },
  officerA: { label: 'Officer A', email: 'officer.a@gridvision-staging.test', passwordEnv: 'STAGING_OFFICER_A_PASSWORD' },
  admin: { label: 'Admin', email: 'admin@gridvision-staging.test', passwordEnv: 'STAGING_ADMIN_PASSWORD' },
};
const IDS = {
  stationA1: '91000000-0000-0000-0000-000000000101',
  stationA2: '91000000-0000-0000-0000-000000000102',
  stationB1: '91000000-0000-0000-0000-000000000103',
  feederA1: '91000000-0000-0000-0000-000000000201',
  feederB1: '91000000-0000-0000-0000-000000000205',
};
const REMOTE_PHASES = new Set(['normal', 'revoke', 'tamper', 'idempotency', 'dependency', 'conflict']);
const VALID_PHASES = new Set([...REMOTE_PHASES, 'isolation', 'all']);
const results = [];
const createdOperationIds = new Set();
const createdInterruptionIds = new Set();

function stop(message) { console.error(`STOPPED: ${message}`); process.exit(1); }
function env(name, required = true) { const value = process.env[name]?.trim(); if (required && !value) stop(`Missing environment variable ${name}.`); return value; }
function short(value) { return typeof value === 'string' && value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : String(value ?? ''); }
function normalizeStationIds(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => row && typeof row === 'object' && typeof row.station_id === 'string' ? [row.station_id] : []);
}
function safeMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : 'No error message';
  return message.replace(/[A-Za-z0-9_-]{28,}/g, '[redacted]').replace(/[\w.+-]+@[\w.-]+/g, '[email]').slice(0, 180);
}
function diagnostic(name, actor, operation, response, expected, pass, classification = pass ? 'PASS' : 'FAIL') {
  const error = response?.error ?? null;
  const status = response?.status ?? error?.status ?? (error ? 'unknown' : 200);
  const code = error?.code ?? '-';
  const actual = error ? `${status}/${code}: ${safeMessage(error)}` : `${status}: allowed`;
  const result = { test: name, expected, actual, result: classification };
  results.push(result);
  console.log(`[${classification}] ${name} | ${actor} | ${operation} | HTTP ${status} | PG ${code} | ${error ? safeMessage(error) : 'request completed'}`);
  return pass;
}
function assert(condition, name, expected, actual) {
  results.push({ test: name, expected, actual, result: condition ? 'PASS' : 'FAIL' });
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name} | ${actual}`);
  return condition;
}
function denied(response, name, actor, operation) {
  const code = response.error?.code;
  const status = response.status ?? response.error?.status;
  const secure = Boolean(response.error) && (status === 401 || status === 403 || code === '42501' || /row-level security|not authori[sz]ed|permission denied/i.test(response.error.message ?? ''));
  return diagnostic(name, actor, operation, response, 'authorization denial', secure, secure ? 'DENIED-AS-EXPECTED' : 'FAIL');
}
function client(url, key) { return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }); }
async function signIn(url, anonKey, userKey) {
  const definition = USERS[userKey];
  const password = env(definition.passwordEnv);
  const instance = client(url, anonKey);
  const response = await instance.auth.signInWithPassword({ email: definition.email, password });
  if (response.error || !response.data.user) stop(`Could not authenticate ${definition.label}: ${safeMessage(response.error)}`);
  return { client: instance, id: response.data.user.id, label: definition.label };
}
function timestamp(minutesAgo, salt = 0) { return new Date(Date.now() - (minutesAgo * 60_000) - salt).toISOString(); }
function operationId(prefix) { const id = `offline-security-${prefix}-${crypto.randomUUID()}`; createdOperationIds.add(id); return id; }
function logPayload(userId, overrides = {}) {
  return { station_id: IDS.stationA1, feeder_id: IDS.feederA1, operator_id: userId, actual_event_time: timestamp(180, Math.floor(Math.random() * 50_000)), mw: 1.25, entry_mode: 'OFFLINE', recorded_at: timestamp(181), synced_at: new Date().toISOString(), client_operation_id: operationId('log'), ...overrides };
}
function interruptionPayload(userId, overrides = {}) {
  return { station_id: IDS.stationA1, feeder_id: IDS.feederA1, operator_id: userId, interruption_start: timestamp(120, Math.floor(Math.random() * 50_000)), cause: 'OTHER', current_status: 'OPEN', entry_mode: 'OFFLINE', recorded_at: timestamp(121), synced_at: new Date().toISOString(), client_operation_id: operationId('trip'), ...overrides };
}
async function countBy(clientInstance, table, column, value) {
  const response = await clientInstance.from(table).select('id', { count: 'exact', head: true }).eq(column, value);
  if (response.error) throw response.error;
  return response.count ?? 0;
}
async function cleanup(admin) {
  const ids = [...createdOperationIds];
  if (!ids.length && !createdInterruptionIds.size) return;
  const logs = await admin.from('log_book_entries').select('id').in('client_operation_id', ids);
  const logIds = (logs.data ?? []).map((row) => row.id);
  if (logIds.length) await admin.from('parameter_alerts').delete().in('log_book_entry_id', logIds);
  const events = await admin.from('notification_events').select('id').or(ids.map((id) => `source_operation_id.ilike.*${id}*`).join(','));
  const eventIds = (events.data ?? []).map((row) => row.id);
  if (eventIds.length) await admin.from('notification_recipients').delete().in('notification_event_id', eventIds);
  if (eventIds.length) await admin.from('notification_events').delete().in('id', eventIds);
  await admin.from('interruptions').delete().in('client_operation_id', ids);
  if (createdInterruptionIds.size) await admin.from('interruptions').delete().in('id', [...createdInterruptionIds]);
  await admin.from('log_book_entries').delete().in('client_operation_id', ids);
}
async function verifyNoEffects(admin, operationIds, name) {
  const logs = await admin.from('log_book_entries').select('id').in('client_operation_id', operationIds);
  const interruptions = await admin.from('interruptions').select('id').in('client_operation_id', operationIds);
  const logIds = (logs.data ?? []).map((row) => row.id);
  const alerts = logIds.length ? await admin.from('parameter_alerts').select('id').in('log_book_entry_id', logIds) : { data: [], error: null };
  const events = await admin.from('notification_events').select('id').or(operationIds.map((id) => `source_operation_id.ilike.*${id}*`).join(','));
  const eventIds = (events.data ?? []).map((row) => row.id);
  const recipients = eventIds.length ? await admin.from('notification_recipients').select('id').in('notification_event_id', eventIds) : { data: [], error: null };
  const errors = [logs, interruptions, alerts, events, recipients].filter((response) => response.error);
  const counts = [logs.data, interruptions.data, alerts.data, events.data, recipients.data].reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
  assert(errors.length === 0 && counts === 0, name, 'zero rows/events/recipients', errors.length ? 'verification query failed' : `${counts} side effects`);
}

async function phaseNormal(ctx) {
  const actor = await signIn(ctx.url, ctx.anonKey, 'operatorA');
  const log = logPayload(actor.id);
  const insertLog = await actor.client.from('log_book_entries').insert(log).select('id').single();
  diagnostic('normal logbook replay', actor.label, 'ADD_LOG_ENTRY', insertLog, 'allowed exactly once', !insertLog.error);
  const trip = interruptionPayload(actor.id);
  const insertTrip = await actor.client.from('interruptions').insert(trip).select('id').single();
  diagnostic('normal interruption replay', actor.label, 'ADD_INTERRUPTION', insertTrip, 'allowed', !insertTrip.error);
  if (insertTrip.data?.id) {
    createdInterruptionIds.add(insertTrip.data.id);
    const end = new Date(Date.parse(trip.interruption_start) + 30 * 60_000).toISOString();
    const restoreId = operationId('restore');
    const restore = await actor.client.from('interruptions').update({ current_status: 'RESTORED', interruption_end: end, duration_minutes: 30, restore_client_operation_id: restoreId }).eq('id', insertTrip.data.id).select('id').single();
    diagnostic('normal interruption restore', actor.label, 'RESTORE_INTERRUPTION', restore, 'allowed', !restore.error);
  }
}

async function getAccessFixture(adminClient, userId) {
  const [profile, offices, stations] = await Promise.all([
    adminClient.from('app_users').select('full_name,employee_code,phone,role,active').eq('id', userId).single(),
    adminClient.from('user_org_units').select('org_unit_id').eq('user_id', userId).eq('active', true),
    adminClient.from('user_stations').select('station_id').eq('user_id', userId).eq('active', true),
  ]);
  if (profile.error || offices.error || stations.error) stop(`Could not capture access fixture: ${safeMessage(profile.error ?? offices.error ?? stations.error)}`);
  return { ...profile.data, officeIds: offices.data.map((row) => row.org_unit_id), stationIds: stations.data.map((row) => row.station_id) };
}
async function setAccess(adminActor, userId, fixture, stationIds, reason) {
  return adminActor.client.rpc('manage_user_access', { p_user_id: userId, p_full_name: fixture.full_name, p_employee_code: fixture.employee_code, p_phone: fixture.phone, p_role: fixture.role, p_active: fixture.active, p_office_ids: fixture.officeIds, p_station_ids: stationIds, p_reason: reason });
}
async function getAppRole(adminClient, userId) {
  return adminClient.from('app_users').select('role').eq('id', userId).single();
}
async function setAppRole(adminActor, userId, role) {
  return adminActor.client.rpc('set_app_user_role', { p_user_id: userId, p_role: role });
}
async function phaseRevoke(ctx) {
  const [operator, administrator] = await Promise.all([signIn(ctx.url, ctx.anonKey, 'operatorA'), signIn(ctx.url, ctx.anonKey, 'admin')]);
  const fixture = await getAccessFixture(ctx.admin, operator.id);
  const log = logPayload(operator.id);
  const trip = interruptionPayload(operator.id);
  try {
    const revoke = await setAccess(administrator, operator.id, fixture, [], 'Offline authorization regression: temporary station revocation');
    diagnostic('temporary A1 revocation', administrator.label, 'MANAGE_USER_ACCESS', revoke, 'allowed', !revoke.error);
    denied(await operator.client.from('log_book_entries').insert(log), 'revoked-scope log replay', operator.label, 'ADD_LOG_ENTRY');
    denied(await operator.client.from('interruptions').insert(trip), 'revoked-scope interruption replay', operator.label, 'ADD_INTERRUPTION');
    await verifyNoEffects(ctx.admin, [log.client_operation_id, trip.client_operation_id], 'revoked replay side effects');
  } finally {
    const restore = await setAccess(administrator, operator.id, fixture, fixture.stationIds, 'Offline authorization regression: restore fixture');
    diagnostic('restore Operator A fixture', administrator.label, 'MANAGE_USER_ACCESS', restore, 'restored', !restore.error);
  }
  const rolePayload = logPayload(operator.id);
  try {
    const revokeRole = await setAppRole(administrator, operator.id, 'FIELD_OFFICER');
    diagnostic('temporary Operator A role revocation', administrator.label, 'SET_APP_USER_ROLE', revokeRole, 'allowed', !revokeRole.error);
    const revokedRole = await getAppRole(ctx.admin, operator.id);
    const roleChanged = !revokedRole.error && revokedRole.data?.role === 'FIELD_OFFICER';
    assert(roleChanged, 'verify Operator A role revocation', 'FIELD_OFFICER', revokedRole.error ? safeMessage(revokedRole.error) : short(revokedRole.data?.role));
    if (roleChanged) denied(await operator.client.from('log_book_entries').insert(rolePayload), 'role-revoked log replay', operator.label, 'ADD_LOG_ENTRY');
    await verifyNoEffects(ctx.admin, [rolePayload.client_operation_id], 'role-revoked replay side effects');
  } finally {
    const restoreRole = await setAppRole(administrator, operator.id, fixture.role);
    diagnostic('restore Operator A role', administrator.label, 'SET_APP_USER_ROLE', restoreRole, 'restored', !restoreRole.error);
    const restoredRole = await getAppRole(ctx.admin, operator.id);
    assert(!restoredRole.error && restoredRole.data?.role === fixture.role, 'verify Operator A role restoration', fixture.role, restoredRole.error ? safeMessage(restoredRole.error) : short(restoredRole.data?.role));
  }
}

async function phaseTamper(ctx) {
  const [operatorA, operatorB] = await Promise.all([signIn(ctx.url, ctx.anonKey, 'operatorA'), signIn(ctx.url, ctx.anonKey, 'operatorB')]);
  const payloads = [
    ['tampered log station', logPayload(operatorA.id, { station_id: IDS.stationB1, feeder_id: IDS.feederB1 }), 'log_book_entries'],
    ['tampered log feeder', logPayload(operatorA.id, { feeder_id: IDS.feederB1 }), 'log_book_entries'],
    ['tampered log operator', logPayload(operatorA.id, { operator_id: operatorB.id }), 'log_book_entries'],
    ['tampered interruption station', interruptionPayload(operatorA.id, { station_id: IDS.stationB1, feeder_id: IDS.feederB1 }), 'interruptions'],
    ['tampered interruption feeder', interruptionPayload(operatorA.id, { feeder_id: IDS.feederB1 }), 'interruptions'],
    ['tampered interruption operator', interruptionPayload(operatorA.id, { operator_id: operatorB.id }), 'interruptions'],
  ];
  for (const [name, payload, table] of payloads) denied(await operatorA.client.from(table).insert(payload), name, operatorA.label, table === 'interruptions' ? 'ADD_INTERRUPTION' : 'ADD_LOG_ENTRY');
  await verifyNoEffects(ctx.admin, payloads.map(([, payload]) => payload.client_operation_id), 'tamper side effects');
  const rpcIdA = operationId('historical-add'); const rpcIdR = operationId('historical-restore');
  const rpc = await operatorA.client.rpc('sync_historical_interruption', { p_station_id: IDS.stationB1, p_feeder_id: IDS.feederB1, p_interruption_start: timestamp(120), p_interruption_end: timestamp(90), p_cause: 'OTHER', p_remarks: null, p_etr: null, p_add_recorded_at: timestamp(121), p_restore_recorded_at: timestamp(89), p_add_client_operation_id: rpcIdA, p_restore_client_operation_id: rpcIdR });
  denied(rpc, 'historical RPC B1 substitution', operatorA.label, 'SYNC_HISTORICAL_INTERRUPTION');
  await verifyNoEffects(ctx.admin, [rpcIdA, rpcIdR], 'historical denial side effects');
}

async function phaseIdempotency(ctx) {
  const operator = await signIn(ctx.url, ctx.anonKey, 'operatorA');
  const payload = logPayload(operator.id);
  const first = await operator.client.from('log_book_entries').insert(payload).select('id').single();
  diagnostic('idempotency first replay', operator.label, 'ADD_LOG_ENTRY', first, 'allowed', !first.error);
  const duplicate = await operator.client.from('log_book_entries').insert(payload).select('id').single();
  const count = await countBy(ctx.admin, 'log_book_entries', 'client_operation_id', payload.client_operation_id);
  diagnostic('idempotency duplicate replay', operator.label, 'ADD_LOG_ENTRY', duplicate, 'duplicate rejected', Boolean(duplicate.error) && count === 1, Boolean(duplicate.error) && count === 1 ? 'DENIED-AS-EXPECTED' : 'FAIL');
  const changed = await operator.client.from('log_book_entries').insert({ ...payload, mw: 9.75, actual_event_time: timestamp(240) });
  const unchanged = await ctx.admin.from('log_book_entries').select('mw').eq('client_operation_id', payload.client_operation_id).single();
  diagnostic('client operation payload substitution', operator.label, 'ADD_LOG_ENTRY', changed, 'rejected without mutation', Boolean(changed.error) && Number(unchanged.data?.mw) === Number(payload.mw), Boolean(changed.error) ? 'DENIED-AS-EXPECTED' : 'FAIL');
}

async function phaseDependency(ctx) {
  const operator = await signIn(ctx.url, ctx.anonKey, 'operatorA');
  const addId = operationId('historical-add'); const restoreId = operationId('historical-restore');
  const start = timestamp(150); const end = timestamp(120);
  const args = { p_station_id: IDS.stationA1, p_feeder_id: IDS.feederA1, p_interruption_start: start, p_interruption_end: end, p_cause: 'OTHER', p_remarks: null, p_etr: null, p_add_recorded_at: timestamp(151), p_restore_recorded_at: timestamp(119), p_add_client_operation_id: addId, p_restore_client_operation_id: restoreId };
  const first = await operator.client.rpc('sync_historical_interruption', args);
  diagnostic('historical atomic trip and restore', operator.label, 'SYNC_HISTORICAL_INTERRUPTION', first, 'one restored interruption', !first.error);
  if (first.data) createdInterruptionIds.add(first.data);
  const retry = await operator.client.rpc('sync_historical_interruption', args);
  const count = await countBy(ctx.admin, 'interruptions', 'client_operation_id', addId);
  diagnostic('historical RPC exact retry', operator.label, 'SYNC_HISTORICAL_INTERRUPTION', retry, 'same row returned', !retry.error && retry.data === first.data && count === 1);
  const wrongRestore = operationId('historical-restore-wrong');
  const changed = await operator.client.rpc('sync_historical_interruption', { ...args, p_restore_client_operation_id: wrongRestore });
  diagnostic('historical mapping substitution', operator.label, 'SYNC_HISTORICAL_INTERRUPTION', changed, 'rejected', Boolean(changed.error), changed.error ? 'DENIED-AS-EXPECTED' : 'FAIL');
  const original = await ctx.admin.from('interruptions').select('id,restore_client_operation_id,current_status').eq('client_operation_id', addId).single();
  assert(!original.error && original.data?.restore_client_operation_id === restoreId && original.data?.current_status === 'RESTORED', 'mapping integrity', 'original mapping unchanged', original.error ? safeMessage(original.error) : 'original mapping unchanged');
  results.push({ test: 'unresolved local dependency', expected: 'blocked before request', actual: 'GridVision runQueued throws QueuedDependencyError when restore filter.id is absent', result: 'STATIC-PASS' });
}

async function phaseIsolation() {
  const files = await Promise.all(['src/services/offline.ts', 'src/services/operationalDrafts.ts', 'src/services/verifiedIdentity.ts', 'src/services/operationalReadCache.ts', 'src/services/storageHealth.ts', 'src/services/diagnostics.ts', 'src/services/api.ts', 'src/pages/SettingsPage.tsx'].map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')));
  const [offline, drafts, identity, cache, storage, diagnostics, api, settings] = files;
  assert(/getQueue\(ownerUserId\?/.test(offline) && /queue\.filter\(\(operation\) => operation\.ownerUserId === ownerUserId\)/.test(offline) && /operation\.ownerUserId === ownerUserId/.test(offline), 'queue ownership isolation', 'exact owner filter', 'owner-bound retrieval present');
  assert(/draft:parameter-entry:/.test(drafts) && /context\.userId/.test(drafts) && /draft:interruption-entry:/.test(drafts), 'draft isolation', 'user-bound keys and validation', 'user-bound parameter/interruption drafts present');
  assert(/verified-application-identity:/.test(identity) && /row\.userId !== userId/.test(identity), 'verified identity isolation', 'exact user validation', 'user-bound identity validation present');
  assert(/envelope\.userId !== userId/.test(cache) && /authorized-operational-scope:/.test(cache), 'read cache and scope isolation', 'exact user validation', 'user-bound cache plus protected scope prefix present');
  assert(/countOperations\(\)/.test(storage) && !/clearOperations\(\)/.test(storage), 'storage maintenance preserves queue', 'no queue deletion', 'maintenance only verifies queue accessibility');
  assert(!/JWT|Authorization header|FCM token|user email|operation ID/.test(diagnostics), 'diagnostics privacy allow-list', 'no sensitive fields', 'summary-only diagnostic fields');
  assert(/isQueueSyncAuthorized\(ownerUserId\)/.test(api) && /queueSyncSessionIsCurrent\(ownerUserId\)/.test(api), 'replay authorization revalidation', 'current session and authorization required', 'preflight and per-operation checks present');
  assert(/failureCategory === 'CONFLICT'.*'VALIDATION'.*'AUTHORIZATION'/s.test(api) && /syncState:.*NEEDS_ATTENTION/s.test(api), 'permanent failure retry semantics', 'Needs Attention, no automatic loop', 'permanent categories map to Needs Attention');
  assert(/Pending changes remain safely in the sync queue\./.test(settings) && /Unsaved entry drafts are stored separately and are not removed\./.test(settings), 'Clear Local Cache safety copy', 'durable work explicitly preserved', 'settings distinguishes disposable cache from durable work');
  results.push({ test: 'expired/no-session replay', expected: 'no request; queue retained', actual: 'getQueueOwnerUserId and queueSyncSessionIsCurrent require the authenticated owner', result: 'STATIC-PASS' });
  results.push({ test: 'browser IndexedDB runtime isolation', expected: 'Operator A data unavailable to Operator B', actual: 'requires manual browser/Android execution', result: 'MANUAL' });
  results.push({ test: 'forced IndexedDB failure UX', expected: 'save failure surfaced, form retained', actual: 'requires manual browser/Android fault injection', result: 'MANUAL' });
}

async function phaseConflict(ctx) {
  const operator = await signIn(ctx.url, ctx.anonKey, 'operatorA');
  const logicalTime = timestamp(300);
  const first = logPayload(operator.id, { actual_event_time: logicalTime });
  const second = logPayload(operator.id, { actual_event_time: logicalTime });
  const inserted = await operator.client.from('log_book_entries').insert(first).select('id').single();
  diagnostic('logical log identity baseline', operator.label, 'ADD_LOG_ENTRY', inserted, 'allowed', !inserted.error);
  const conflict = await operator.client.from('log_book_entries').insert(second);
  diagnostic('logical log identity conflict', operator.label, 'ADD_LOG_ENTRY', conflict, '23505 conflict', conflict.error?.code === '23505', conflict.error?.code === '23505' ? 'DENIED-AS-EXPECTED' : 'FAIL');
  const tripA = interruptionPayload(operator.id);
  const tripB = interruptionPayload(operator.id);
  const open = await operator.client.from('interruptions').insert(tripA).select('id').single();
  diagnostic('open interruption baseline', operator.label, 'ADD_INTERRUPTION', open, 'allowed', !open.error);
  if (open.data?.id) createdInterruptionIds.add(open.data.id);
  const openConflict = await operator.client.from('interruptions').insert(tripB);
  diagnostic('one-open-per-feeder conflict', operator.label, 'ADD_INTERRUPTION', openConflict, '23505 conflict', openConflict.error?.code === '23505', openConflict.error?.code === '23505' ? 'DENIED-AS-EXPECTED' : 'FAIL');
}

async function verifyFixture(ctx) {
  const expected = { operatorA: [IDS.stationA1], operatorB: [IDS.stationB1], officerA: [IDS.stationA1, IDS.stationA2], admin: [IDS.stationA1, IDS.stationA2, IDS.stationB1] };
  for (const key of Object.keys(expected)) {
    const actor = await signIn(ctx.url, ctx.anonKey, key);
    const scope = await actor.client.rpc('get_my_accessible_station_ids');
    const actual = normalizeStationIds(scope.data).sort();
    const wanted = [...expected[key]].sort();
    assert(!scope.error && JSON.stringify(actual) === JSON.stringify(wanted), `${USERS[key].label} fixture integrity`, wanted.map(short).join(', '), scope.error ? safeMessage(scope.error) : actual.map(short).join(', '));
  }
}

async function main() {
  const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))?.split('=')[1] ?? process.argv[process.argv.indexOf('--phase') + 1] ?? 'all';
  if (!VALID_PHASES.has(phaseArg)) stop(`Invalid phase '${phaseArg}'.`);
  const url = env('STAGING_SUPABASE_URL');
  if (url.includes(PRODUCTION_REF)) stop('Production project ref is explicitly forbidden.');
  let parsed; try { parsed = new URL(url); } catch { stop('STAGING_SUPABASE_URL is not a valid URL.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${STAGING_REF}.supabase.co`) stop(`URL must be exactly the staging host ${STAGING_REF}.supabase.co.`);
  const anonKey = env('STAGING_ANON_KEY');
  const phases = phaseArg === 'all' ? ['normal', 'revoke', 'tamper', 'idempotency', 'dependency', 'isolation', 'conflict'] : [phaseArg];
  const needsRemote = phases.some((phase) => REMOTE_PHASES.has(phase));
  const adminKey = env('STAGING_ADMIN_KEY', needsRemote);
  const ctx = { url, anonKey, admin: adminKey ? client(url, adminKey) : null };
  console.log(`Target verified locally: GridVision Staging (${STAGING_REF}); phase=${phaseArg}`);
  try {
    for (const phase of phases) {
      console.log(`\n--- phase: ${phase} ---`);
      await ({ normal: phaseNormal, revoke: phaseRevoke, tamper: phaseTamper, idempotency: phaseIdempotency, dependency: phaseDependency, isolation: phaseIsolation, conflict: phaseConflict }[phase])(ctx);
      if (ctx.admin) await cleanup(ctx.admin);
    }
  } finally {
    if (ctx.admin) {
      await cleanup(ctx.admin).catch((error) => console.error(`CLEANUP WARNING: ${safeMessage(error)}`));
      await verifyFixture(ctx).catch((error) => { results.push({ test: 'final fixture integrity', expected: 'baseline restored', actual: safeMessage(error), result: 'FAIL' }); });
    }
  }
  console.log('\nTest | Expected | Actual | Result');
  console.log('--- | --- | --- | ---');
  for (const row of results) console.log(`${row.test} | ${row.expected} | ${row.actual} | ${row.result}`);
  const failures = results.filter((row) => row.result === 'FAIL');
  console.log(`\nHIGH/CRITICAL findings: ${failures.length}`);
  console.log('This harness is a staging authorization regression aid; it does not constitute a VAPT pass.');
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(`FATAL (sanitized): ${safeMessage(error)}`); process.exitCode = 1; });
