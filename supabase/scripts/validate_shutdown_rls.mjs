/*
 * DEV-only Shutdown RLS regression check. It is deliberately inert unless
 * --dev is supplied and the URL exactly matches the approved DEV ref.
 * Stage 1 and Stage 2 migrations must already be applied before running it.
 * Superseded for database authorization regression testing by
 * supabase/tests/database/shutdown_security_test.sql; retained for compatibility.
 */
import { createClient } from '@supabase/supabase-js';
import { createShutdownValidationActor, loadShutdownDevEnvironment } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();

const DEV_REF = 'eetlzxntgvjompmipprb';
if (!process.argv.includes('--dev')) throw new Error('STOPPED: pass --dev explicitly');
const required = ['DEV_SUPABASE_URL','DEV_SUPABASE_ANON_KEY','DEV_SUPABASE_SERVICE_ROLE_KEY','DEV_OPERATOR_A_EMAIL','DEV_OPERATOR_B_EMAIL','DEV_OFFICER_A_EMAIL','DEV_ADMIN_EMAIL','DEV_STATION_A_ID','DEV_STATION_B_ID'];
for (const name of required) if (!process.env[name]) throw new Error(`STOPPED: missing ${name}`);
const url = process.env.DEV_SUPABASE_URL;
if (new URL(url).hostname !== `${DEV_REF}.supabase.co`) throw new Error('STOPPED: URL is not GridVision DEV');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.DEV_SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.DEV_SUPABASE_ANON_KEY, options);
const actors = {
  operatorA: { label: 'Operator A', email: process.env.DEV_OPERATOR_A_EMAIL, password: process.env.DEV_OPERATOR_A_PASSWORD, accessToken: process.env.DEV_OPERATOR_A_ACCESS_TOKEN, refreshToken: process.env.DEV_OPERATOR_A_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OPERATOR_A_REFRESH_TOKEN' },
  operatorB: { label: 'Operator B', email: process.env.DEV_OPERATOR_B_EMAIL, password: process.env.DEV_OPERATOR_B_PASSWORD, accessToken: process.env.DEV_OPERATOR_B_ACCESS_TOKEN, refreshToken: process.env.DEV_OPERATOR_B_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OPERATOR_B_REFRESH_TOKEN' },
  officerA: { label: 'Officer A', email: process.env.DEV_OFFICER_A_EMAIL, password: process.env.DEV_OFFICER_A_PASSWORD, accessToken: process.env.DEV_OFFICER_A_ACCESS_TOKEN, refreshToken: process.env.DEV_OFFICER_A_REFRESH_TOKEN, refreshTokenVariable: 'DEV_OFFICER_A_REFRESH_TOKEN' },
  admin: { label: 'Admin', email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD, accessToken: process.env.DEV_ADMIN_ACCESS_TOKEN, refreshToken: process.env.DEV_ADMIN_REFRESH_TOKEN, refreshTokenVariable: 'DEV_ADMIN_REFRESH_TOKEN' },
};
const stationA = process.env.DEV_STATION_A_ID;
const stationB = process.env.DEV_STATION_B_ID;
const run = `shutdown-rls-${Date.now()}`;
const created = [];
let failures = 0;
const assert = (value, label) => value ? console.log(`[PASS] ${label}`) : (failures += 1, console.error(`[FAIL] ${label}`));
const denied = (result) => Boolean(result.error);

try {
  const clients = {};
  const ids = {};
  for (const [name, actor] of Object.entries(actors)) {
    const authenticated = await createShutdownValidationActor({ url, anonKey: process.env.DEV_SUPABASE_ANON_KEY, label: actor.label, expectedEmail: actor.email, password: actor.password, accessToken: actor.accessToken, refreshToken: actor.refreshToken, refreshTokenVariable: actor.refreshTokenVariable });
    clients[name] = authenticated.client; ids[name] = authenticated.user.id;
  }
  const fixtures = [
    { id: crypto.randomUUID(), sd_number: `${run}-A-OWN`, station_id: stationA, requested_by: ids.operatorA },
    { id: crypto.randomUUID(), sd_number: `${run}-A-OTHER`, station_id: stationA, requested_by: ids.operatorB },
    { id: crypto.randomUUID(), sd_number: `${run}-B-OTHER`, station_id: stationB, requested_by: ids.operatorB },
  ].map((item, index) => ({ ...item, shutdown_type: 'Planned', purpose: 'Testing', work_description: 'Staging RLS validation fixture', planned_start: new Date(Date.now() + (index + 1) * 86400000).toISOString(), expected_restoration: new Date(Date.now() + (index + 1) * 86400000 + 3600000).toISOString() }));
  const setup = await service.from('shutdown_requests').insert(fixtures);
  if (setup.error) throw new Error(`Fixture setup failed: ${setup.error.message}`);
  created.push(...fixtures.map((item) => item.id));

  const visible = async (client) => (await client.from('shutdown_requests').select('id').in('id', created)).data?.map((row) => row.id) ?? [];
  assert((await anon.from('shutdown_requests').select('id').in('id', created)).error !== null, 'anonymous SELECT denied');
  const operatorAVisible = await visible(clients.operatorA);
  assert(operatorAVisible.includes(fixtures[0].id), 'operator sees own request');
  assert(operatorAVisible.includes(fixtures[1].id), 'operator sees another request at an in-scope station');
  assert(!operatorAVisible.includes(fixtures[2].id), 'operator cannot see out-of-scope request');
  const operatorBVisible = await visible(clients.operatorB);
  assert(!operatorBVisible.includes(fixtures[0].id), 'different operator cannot see another user out of scope');
  assert(operatorBVisible.includes(fixtures[2].id), 'owner visibility is retained');
  const officerVisible = await visible(clients.officerA);
  assert(officerVisible.includes(fixtures[0].id) && officerVisible.includes(fixtures[1].id) && !officerVisible.includes(fixtures[2].id), 'field officer sees only authorised jurisdiction');
  assert((await visible(clients.admin)).length === fixtures.length, 'admin scope follows existing accessible-station helper');

  const probe = { ...fixtures[0], id: crypto.randomUUID(), sd_number: `${run}-DIRECT` };
  assert(denied(await clients.operatorA.from('shutdown_requests').insert(probe)), 'direct INSERT denied');
  assert(denied(await clients.operatorA.from('shutdown_requests').update({ remarks: 'forbidden' }).eq('id', fixtures[0].id)), 'direct UPDATE denied');
  assert(denied(await clients.operatorA.from('shutdown_requests').delete().eq('id', fixtures[0].id)), 'direct DELETE denied');
  if (failures) throw new Error(`${failures} authorization assertion(s) failed`);
} finally {
  if (created.length) {
    const cleanup = await service.from('shutdown_requests').delete().in('id', created);
    if (cleanup.error) console.error(`[WARN] cleanup failed: ${cleanup.error.message}`);
  }
}
