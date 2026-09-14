/*
 * Legacy DEV token-auth mutation validation, retained for compatibility.
 * Superseded by supabase/tests/database/shutdown_security_test.sql.
 */
import { createClient } from '@supabase/supabase-js';
import { createShutdownValidationActor, loadShutdownDevEnvironment } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();

const DEV_REF = 'eetlzxntgvjompmipprb';
if (!process.argv.includes('--dev')) throw new Error('STOPPED: pass --dev explicitly');
const required = ['DEV_SUPABASE_URL','DEV_SUPABASE_ANON_KEY','DEV_SUPABASE_SERVICE_ROLE_KEY','DEV_OPERATOR_A_EMAIL','DEV_OPERATOR_B_EMAIL','DEV_OFFICER_A_EMAIL','DEV_ADMIN_EMAIL','DEV_STATION_A_ID','DEV_STATION_B_ID','DEV_FEEDER_A_ID','DEV_FEEDER_B_ID'];
for (const name of required) if (!process.env[name]) throw new Error(`STOPPED: missing ${name}`);
const url = process.env.DEV_SUPABASE_URL;
if (new URL(url).hostname !== `${DEV_REF}.supabase.co`) throw new Error('STOPPED: URL is not GridVision DEV');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.DEV_SUPABASE_SERVICE_ROLE_KEY, opts);
const anonKey = process.env.DEV_SUPABASE_ANON_KEY;
const definitions = {
  operatorA: { label: 'Operator A', email: process.env.DEV_OPERATOR_A_EMAIL, password: process.env.DEV_OPERATOR_A_PASSWORD, accessToken: process.env.DEV_OPERATOR_A_ACCESS_TOKEN, refreshToken: process.env.DEV_OPERATOR_A_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OPERATOR_A_REFRESH_TOKEN' },
  operatorB: { label: 'Operator B', email: process.env.DEV_OPERATOR_B_EMAIL, password: process.env.DEV_OPERATOR_B_PASSWORD, accessToken: process.env.DEV_OPERATOR_B_ACCESS_TOKEN, refreshToken: process.env.DEV_OPERATOR_B_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OPERATOR_B_REFRESH_TOKEN' },
  officerA: { label: 'Officer A', email: process.env.DEV_OFFICER_A_EMAIL, password: process.env.DEV_OFFICER_A_PASSWORD, accessToken: process.env.DEV_OFFICER_A_ACCESS_TOKEN, refreshToken: process.env.DEV_OFFICER_A_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OFFICER_A_REFRESH_TOKEN' },
  admin: { label: 'Admin', email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD, accessToken: process.env.DEV_ADMIN_ACCESS_TOKEN, refreshToken: process.env.DEV_ADMIN_REFRESH_TOKEN, refreshTokenVariable: 'DEV_ADMIN_REFRESH_TOKEN' },
};
const stationA = process.env.DEV_STATION_A_ID;
const stationB = process.env.DEV_STATION_B_ID;
const feederA = process.env.DEV_FEEDER_A_ID;
const feederB = process.env.DEV_FEEDER_B_ID;
const clients = {}; const ids = {}; const created = [];
let failures = 0;
const assert = (ok, name, detail = '') => ok ? console.log(`[PASS] ${name}`) : (failures += 1, console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`));
const failed = (result) => Boolean(result.error);
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const args = (station, feeder = null, suffix = '') => ({ p_station_id: station, p_feeder_id: feeder, p_equipment_name: `Validation ${suffix}`, p_shutdown_type: 'Planned', p_purpose: 'Testing', p_work_description: 'Transactional staging validation', p_planned_start: future(24), p_expected_restoration: future(26), p_remarks: `validation-${Date.now()}` });
async function create(actor, input) { const result = await actor.rpc('create_shutdown_request', input); if (result.data?.id) created.push(result.data.id); return result; }

try {
  for (const [name, definition] of Object.entries(definitions)) {
    const authenticated = await createShutdownValidationActor({ url, anonKey, label: definition.label, expectedEmail: definition.email, password: definition.password, accessToken: definition.accessToken, refreshToken: definition.refreshToken, refreshTokenVariable: definition.refreshTokenVariable });
    clients[name] = authenticated.client; ids[name] = authenticated.user.id;
  }

  const valid = await create(clients.operatorA, args(stationA, feederA, 'valid'));
  assert(!valid.error, 'valid in-scope create succeeds', valid.error?.message);
  assert(valid.data?.requested_by === ids.operatorA && valid.data?.status === 'PENDING_APPROVAL', 'requester and pending status are server controlled');
  assert(/^SD-\d{4}-\d{6}$/.test(valid.data?.sd_number ?? ''), 'server SD number has required format');
  assert(failed(await clients.operatorA.rpc('create_shutdown_request', { ...args(stationA, feederA), p_status: 'APPROVED', p_requested_by: ids.admin })), 'caller cannot spoof controlled fields');
  assert(failed(await create(clients.operatorA, args(stationB, feederB, 'outside'))), 'out-of-scope station denied');
  assert(failed(await create(clients.operatorA, args(stationA, feederB, 'mismatch'))), 'feeder/station mismatch denied');

  const approved = await clients.officerA.rpc('approve_shutdown_request', { p_shutdown_id: valid.data.id, p_decision_remarks: 'Approved by validation' });
  assert(!approved.error && approved.data?.status === 'APPROVED' && approved.data?.decision_by === ids.officerA, 'eligible in-scope officer approves');
  assert(failed(await clients.admin.rpc('reject_shutdown_request', { p_shutdown_id: valid.data.id, p_decision_remarks: 'late' })), 'approved request cannot later be rejected');

  const selfOwned = await create(clients.officerA, args(stationA, feederA, 'self'));
  assert(failed(await clients.officerA.rpc('approve_shutdown_request', { p_shutdown_id: selfOwned.data?.id })), 'self-approval denied');
  assert(failed(await clients.operatorA.rpc('approve_shutdown_request', { p_shutdown_id: selfOwned.data?.id })), 'operator approval denied');

  const outside = await create(clients.operatorB, args(stationB, feederB, 'outside-decision'));
  assert(!outside.error, 'second scoped operator fixture created', outside.error?.message);
  assert(failed(await clients.officerA.rpc('approve_shutdown_request', { p_shutdown_id: outside.data?.id })), 'out-of-scope officer decision denied');

  const rejected = await create(clients.operatorA, args(stationA, feederA, 'reject'));
  assert(failed(await clients.officerA.rpc('reject_shutdown_request', { p_shutdown_id: rejected.data?.id, p_decision_remarks: '   ' })), 'blank rejection remarks denied');
  const rejection = await clients.officerA.rpc('reject_shutdown_request', { p_shutdown_id: rejected.data?.id, p_decision_remarks: 'Rejected by validation' });
  assert(!rejection.error && rejection.data?.status === 'REJECTED', 'valid rejection succeeds');
  assert(failed(await clients.admin.rpc('approve_shutdown_request', { p_shutdown_id: rejected.data?.id })), 'rejected request cannot later be approved');

  const raced = await create(clients.operatorA, args(stationA, feederA, 'race'));
  const race = await Promise.all([
    clients.officerA.rpc('approve_shutdown_request', { p_shutdown_id: raced.data?.id, p_decision_remarks: 'race approve' }),
    clients.admin.rpc('reject_shutdown_request', { p_shutdown_id: raced.data?.id, p_decision_remarks: 'race reject' }),
  ]);
  assert(race.filter((result) => !result.error).length === 1 && race.filter(failed).length === 1, 'concurrent decisions allow exactly one winner');

  const direct = { sd_number: `FORBIDDEN-${Date.now()}`, station_id: stationA, feeder_id: feederA, equipment_name: 'Direct validation', shutdown_type: 'Planned', purpose: 'Testing', work_description: 'Must be denied by table privileges', planned_start: future(24), expected_restoration: future(26), requested_by: ids.operatorA, requested_at: new Date().toISOString(), status: 'PENDING_APPROVAL' };
  assert(failed(await clients.operatorA.from('shutdown_requests').insert(direct)), 'direct INSERT remains denied');
  assert(failed(await clients.operatorA.from('shutdown_requests').update({ status: 'APPROVED' }).eq('id', selfOwned.data?.id)), 'direct UPDATE remains denied');
  assert(failed(await clients.operatorA.from('shutdown_requests').delete().eq('id', selfOwned.data?.id)), 'direct DELETE remains denied');
  if (failures) throw new Error(`${failures} validation assertion(s) failed`);
} finally {
  if (created.length) { const cleanup = await service.from('shutdown_requests').delete().in('id', created); if (cleanup.error) console.error(`[WARN] cleanup failed: ${cleanup.error.message}`); }
}
