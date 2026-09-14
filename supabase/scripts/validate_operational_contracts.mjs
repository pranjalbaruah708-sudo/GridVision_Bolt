// DEV-only PostgREST contract smoke test. Uses existing synthetic dev accounts;
// creates only marked condition rows and deletes them in finally.
import { createClient } from '@supabase/supabase-js';
import { loadShutdownDevEnvironment } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();
if (!process.argv.includes('--dev')) throw new Error('Pass --dev explicitly');
const url = process.env.DEV_SUPABASE_URL;
if (!url || new URL(url).hostname !== 'eetlzxntgvjompmipprb.supabase.co') throw new Error('Development project required');
for (const key of ['DEV_SUPABASE_ANON_KEY','DEV_SUPABASE_SERVICE_ROLE_KEY','DEV_OPERATOR_A_EMAIL','DEV_OPERATOR_A_PASSWORD','DEV_STATION_A_ID']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = createClient(url, process.env.DEV_SUPABASE_ANON_KEY, options);
const service = createClient(url, process.env.DEV_SUPABASE_SERVICE_ROLE_KEY, options);
const operation = `operational-contract-${crypto.randomUUID()}`;
function assert(value, message) { if (!value) throw new Error(message); console.log(`PASS: ${message}`); }
try {
  const login = await client.auth.signInWithPassword({ email: process.env.DEV_OPERATOR_A_EMAIL, password: process.env.DEV_OPERATOR_A_PASSWORD });
  if (login.error) throw login.error;
  const input = { p_station_id: process.env.DEV_STATION_A_ID, p_observed_at: new Date(Date.now()-60000).toISOString(),
    p_category: 'OTHER', p_condition: 'NORMAL', p_observation: operation, p_client_operation_id: operation };
  const created = await client.rpc('create_station_condition', input);
  if (created.error) throw created.error;
  assert(typeof created.data?.id === 'string' && created.data.recorded_by === login.data.user.id, 'create returns composite object with authenticated recorder');
  const replay = await client.rpc('create_station_condition', input);
  assert(!replay.error && replay.data.id === created.data.id, 'REST replay returns same record');
  const read = await client.from('station_conditions').select('*').eq('id',created.data.id).maybeSingle();
  assert(!read.error && read.data.id === created.data.id, 'condition detail contract');
  const timeline = await client.rpc('get_operational_timeline', { p_period: 'TODAY', p_station_id: input.p_station_id, p_limit: 200 });
  assert(!timeline.error && Array.isArray(timeline.data), 'timeline REST contract');
  const summary = await client.rpc('get_operational_summary', { p_period: 'TODAY', p_station_id: input.p_station_id }).single();
  assert(!summary.error && typeof summary.data.conditions_observed === 'number', 'summary single-row numeric contract');
  const scopes = await client.rpc('get_operational_scope_options');
  assert(!scopes.error && scopes.data.some(row => row.scope_id === input.p_station_id), 'scope options contract');
  const spoof = await client.rpc('create_station_condition', { ...input, p_recorded_by: crypto.randomUUID() });
  assert(Boolean(spoof.error), 'recorder impersonation parameter rejected');
  const privateRead = await client.rpc('read_operational_events', { p_period: 'TODAY' });
  assert(Boolean(privateRead.error), 'unbounded internal projection is not exposed as a public REST RPC');
  const rectified = await client.rpc('rectify_station_condition', { p_id: created.data.id });
  assert(!rectified.error && rectified.data.status === 'RECTIFIED' && rectified.data.rectified_by === login.data.user.id, 'rectification composite contract');
} finally {
  const cleanup = await service.from('station_conditions').delete().eq('client_operation_id',operation);
  if (cleanup.error) throw new Error(`Fixture cleanup failed: ${cleanup.error.message}`);
  const remaining = await service.from('station_conditions').select('id').eq('client_operation_id',operation);
  assert(!remaining.error && remaining.data.length === 0, 'synthetic condition cleanup verified');
}
