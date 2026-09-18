// Node-only DEV validation. Administrative access is restricted to bootstrap and cleanup.
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadShutdownDevEnvironment } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();
const expectedUrl = 'https://eetlzxntgvjompmipprb.supabase.co';
const url = process.env.SUPABASE_URL ?? process.env.DEV_SUPABASE_URL;
if (url !== expectedUrl || !process.argv.includes('--dev') ||
    process.env.STAGE6_NON_PRODUCTION_CONFIRMATION !== 'I_CONFIRM_THIS_IS_THE_GRIDVISION_DEVELOPMENT_PROJECT') {
  throw new Error('Refusing execution: exact DEV URL, --dev and explicit Stage 6 development confirmation required');
}
const anonKey = process.env.DEV_SUPABASE_ANON_KEY;
const serviceKey = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error('Missing local DEV administrative configuration');
const options = { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `stage6-${randomUUID()}`;
const actors = [];
const results = [];
const ids = { stations: [], offices: [] };
function record(area, status, detail = '') {
  results.push({ area, status, detail });
  console.log(`${status}: ${area}${detail ? ` — ${detail}` : ''}`);
}
function assert(value, label) { if (!value) throw new Error(label); }
async function checked(query) { const r = await query; if (r.error) throw new Error(`Database request failed (${r.error.code ?? 'unknown'})`); return r.data; }
async function denied(query) { const r = await query; assert(r.error?.code === '42501', 'Expected authorization denial'); }
const sameTime = (a,b) => Date.parse(a) === Date.parse(b);
async function normalTests() {
  // This function receives only normal authenticated clients; never an admin header.
  const [a,b,officer,administrator] = actors.map(actor => actor.client);
  const [station,descendant,outside] = ids.stations;
  for (const actor of actors) {
    const identity = await actor.client.auth.getUser();
    assert(!identity.error && identity.data.user?.id === actor.id, 'Authenticated identity mismatch');
    assert(await checked(actor.client.rpc('get_my_role')) === actor.role, 'Application role mismatch');
    const global = await checked(actor.client.rpc('get_my_accessible_station_ids'));
    const operational = await checked(actor.client.rpc('get_my_operational_station_ids'));
    const scope = operational.map(row => row.station_id);
    assert(scope.includes(station), 'Assigned station missing');
    if (actor.role === 'OPERATOR') assert(scope.length === 1 && global.length === 1, 'Operator scope broadened');
    if (actor.role === 'FIELD_OFFICER') {
      assert(global.some(row => row.station_id === outside), 'Global officer scope narrowed');
      assert(scope.includes(descendant) && !scope.includes(outside) && scope.length === 2, 'Operational officer scope incorrect');
    }
    if (actor.role === 'ADMIN') assert(scope.includes(outside) && global.some(row => row.station_id === outside), 'Admin breadth missing');
    record(`${actor.label} identity/role/dual scope`, 'PASS');
    const refreshed = await actor.client.auth.refreshSession();
    assert(!refreshed.error && refreshed.data.session?.user.id === actor.id, `Session refresh failed (${refreshed.error?.code ?? 'incomplete_session'})`);
    record(`${actor.label} refresh-token exchange`, 'PASS');
  }
  for (const category of ['EQUIPMENT','STATION_CONDITION','DEFECT','OTHER']) {
    const observed = new Date(Date.now()-7200000).toISOString();
    const args = {p_station_id:station,p_observed_at:observed,p_category:category,p_condition:'ATTENTION',p_observation:run,p_client_operation_id:`${run}-${category}`};
    const row = await checked(a.rpc('create_station_condition',args));
    assert(row.recorded_by === actors[0].id && sameTime(row.observed_at,observed) && row.status === 'OPEN', 'Condition provenance incorrect');
    const read = await checked(a.from('station_conditions').select('*').eq('id',row.id).single());
    assert(read.id === row.id, 'Condition read missing');
    const rectified = await checked(a.rpc('rectify_station_condition',{p_id:row.id}));
    assert(rectified.rectified_by === actors[0].id && rectified.rectified_at && rectified.status === 'RECTIFIED', 'Rectification provenance incorrect');
    const again = await checked(a.rpc('rectify_station_condition',{p_id:row.id}));
    assert(again.rectified_at === rectified.rectified_at, 'Rectification changed on retry');
    await denied(a.rpc('create_station_condition',{...args,p_station_id:outside,p_client_operation_id:`${run}-denied-${category}`}));
    record(`Condition ${category} create/read/rectify/provenance/denial`, 'PASS');
  }
  for (const name of ['get_operational_timeline','get_operational_summary']) await denied(officer.rpc(name,{p_period:'TODAY',p_station_id:outside}));
  await denied(officer.rpc('get_station_shift_history',{p_station_id:outside}));
  const reports = await checked(officer.from('scoped_logbook_report_entries').select('station_id').eq('station_id',outside));
  assert(reports.length === 0, 'Restricted reports leaked');
  record('Operational and Shift unrelated-station RPC denial', 'PASS');
  record('Restricted report unrelated-station read', 'PASS', 'Empty fixture scope only; positive report data validation remains outstanding');
  void b; void administrator;
}
async function cleanup() {
  const failures = [];
  async function remove(table, column, values) {
    if (!values.length) return;
    try { await checked(admin.from(table).delete().in(column,values));
      const remaining = await checked(admin.from(table).select(column).in(column,values));
      assert(remaining.length === 0, 'Cleanup rows remain');
    } catch { failures.push(table); }
  }
  // IDs were generated by this run; no name-prefix deletion or real-user mutation.
  await remove('station_conditions','station_id',ids.stations);
  await remove('station_org_units','station_id',ids.stations);
  await remove('user_stations','user_id',actors.map(a=>a.id));
  await remove('user_org_units','user_id',actors.map(a=>a.id));
  await remove('stations','id',ids.stations);
  for (const id of [...ids.offices].reverse()) await remove('org_units','id',[id]);
  await remove('app_users','id',actors.map(a=>a.id));
  for (const actor of actors) {
    actor.client?.auth.stopAutoRefresh();
    const deleted = await admin.auth.admin.deleteUser(actor.id);
    const remaining = await admin.auth.admin.getUserById(actor.id);
    if (deleted.error || remaining.data?.user || (remaining.error && remaining.error.status !== 404)) failures.push(`${actor.label} auth cleanup`);
  }
  assert(failures.length === 0, `Cleanup requires attention: ${failures.join(', ')}`);
  record('ADMIN CLEANUP and absence verification', 'PASS');
}
try {
  for (const [label,role] of [['OPERATOR_A','OPERATOR'],['OPERATOR_B','OPERATOR'],['FIELD_OFFICER','FIELD_OFFICER'],['ADMIN','ADMIN']]) {
    const email = `${run}-${label.toLowerCase()}@example.invalid`;
    const password = randomBytes(40).toString('base64url');
    const created = await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:run}});
    if (created.error || !created.data.user) throw new Error(`Synthetic auth bootstrap failed (${created.error?.code ?? 'no_user'})`);
    const actor = {label,role,id:created.data.user.id,email,password};
    actors.push(actor);
    await checked(admin.from('app_users').upsert({id:actor.id,full_name:run,role,active:true}));
    record(`ADMIN BOOTSTRAP ${label}`, 'PASS');
  }
  // Attempt every role, even if one is blocked. No magic-link/admin-generated login fallback.
  for (const actor of actors) {
    actor.client = createClient(url,anonKey,options);
    const login = await actor.client.auth.signInWithPassword({email:actor.email,password:actor.password});
    delete actor.password; delete actor.email;
    if (login.error || !login.data.session) {
      // Error codes/status are safe to report; never dump request/response objects.
      record(`NORMAL AUTH ${actor.label}`, 'BLOCKED', `${login.error?.code ?? 'no_session'}; HTTP ${login.error?.status ?? 'unknown'}`);
      continue;
    }
    const session = login.data.session;
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
    assert(claims.sub === actor.id && claims.iss === `${url}/auth/v1` && claims.role === 'authenticated', 'Session project/identity mismatch');
    actor.authenticated = true;
    record(`NORMAL AUTH ${actor.label}`, 'PASS');
  }
  if (actors.every(a=>a.authenticated)) {
    ids.stations = [randomUUID(),randomUUID(),randomUUID()];
    ids.offices = [randomUUID(),randomUUID()];
    await checked(admin.from('stations').insert(ids.stations.map((id,i)=>({id,code:`${run}-${i}`,name:run,active:true}))));
    await checked(admin.from('org_units').insert({id:ids.offices[0],code:`${run}-root`,name:run,unit_type:'DIVISION'}));
    await checked(admin.from('org_units').insert({id:ids.offices[1],code:`${run}-child`,name:run,unit_type:'SUB_DIVISION',parent_id:ids.offices[0]}));
    await checked(admin.from('station_org_units').insert(ids.offices.map((id,i)=>({station_id:ids.stations[i],org_unit_id:id}))));
    await checked(admin.from('user_org_units').insert({user_id:actors[2].id,org_unit_id:ids.offices[0]}));
    await checked(admin.from('user_stations').insert(actors.slice(0,2).map(a=>({user_id:a.id,station_id:ids.stations[0],active:true}))));
    await normalTests();
  } else {
    record('Normal-user runtime / real offline replay / session refresh', 'BLOCKED', 'Normal password authentication did not establish every actor session; fixtures/tests not substituted with admin access');
    process.exitCode = 2;
  }
} catch (error) {
  record('Harness', 'FAIL', error.message);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { record('ADMIN CLEANUP','FAIL',error.message); process.exitCode = 1; }
  await writeFile('supabase/scripts/stage6_authenticated_runtime_results.json',JSON.stringify({date:new Date().toISOString(),project:'eetlzxntgvjompmipprb',results},null,2)+'\n');
}
