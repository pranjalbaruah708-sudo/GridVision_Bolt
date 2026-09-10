import { createClient } from '@supabase/supabase-js';

const required = [
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_OPERATOR_A_PASSWORD',
  'STAGING_OPERATOR_B_PASSWORD',
  'STAGING_OFFICER_A_PASSWORD',
  'STAGING_ADMIN_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const projectRef = 'fylnuppelaebrhqllzzh';
const url = process.env.STAGING_SUPABASE_URL;
if (!url.includes(projectRef)) throw new Error('Refusing test: URL is not GridVision Staging');

const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [
  ['operatorA', 'operator.a@gridvision-staging.test', process.env.STAGING_OPERATOR_A_PASSWORD],
  ['operatorB', 'operator.b@gridvision-staging.test', process.env.STAGING_OPERATOR_B_PASSWORD],
  ['officerA', 'officer.a@gridvision-staging.test', process.env.STAGING_OFFICER_A_PASSWORD],
  ['admin', 'admin@gridvision-staging.test', process.env.STAGING_ADMIN_PASSWORD],
];

const ids = {
  stationA1: '91000000-0000-0000-0000-000000000101',
  stationB1: '91000000-0000-0000-0000-000000000103',
  feederA1: '91000000-0000-0000-0000-000000000201',
  feederB1: '91000000-0000-0000-0000-000000000205',
  thresholdA: '93000000-0000-0000-0000-000000000001',
  thresholdB: '93000000-0000-0000-0000-000000000002',
  logA: '93000000-0000-0000-0000-000000000011',
  logB: '93000000-0000-0000-0000-000000000012',
  interruptionA: '93000000-0000-0000-0000-000000000021',
  interruptionB: '93000000-0000-0000-0000-000000000022',
};
const tables = ['log_book_entries', 'interruptions', 'parameter_alerts'];
const clients = {};
const events = {};
const channels = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertOk(promise, label) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function subscribe(name, client, suffix = 'main') {
  const received = [];
  const channel = client.channel(`security-realtime-${name}-${suffix}-${Date.now()}`);
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      received.push({ table, eventType: payload.eventType, new: payload.new, old: payload.old });
    });
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Subscription timeout: ${name}`)), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`Subscription failed for ${name}: ${status}`));
      }
    });
  });
  return { channel, received };
}

function matches(received, table, id) {
  return received.filter((event) => event.table === table && (event.new?.id === id || event.old?.id === id));
}

async function cleanup() {
  for (const [name, channel] of Object.entries(channels)) {
    if (channel) await clients[name]?.removeChannel(channel).catch(() => undefined);
  }
  await adminClient.from('parameter_alerts').delete().in('log_book_entry_id', [ids.logA, ids.logB]);
  await adminClient.from('notification_recipients').delete().in(
    'notification_event_id',
    (await adminClient.from('notification_events').select('id').in('station_id', [ids.stationA1, ids.stationB1]).gte('created_at', testStartedAt)).data?.map((row) => row.id) ?? [],
  );
  await adminClient.from('notification_events').delete().in('station_id', [ids.stationA1, ids.stationB1]).gte('created_at', testStartedAt);
  await adminClient.from('interruptions').delete().in('id', [ids.interruptionA, ids.interruptionB]);
  await adminClient.from('log_book_entries').delete().in('id', [ids.logA, ids.logB]);
  await adminClient.from('feeder_thresholds').delete().in('id', [ids.thresholdA, ids.thresholdB]);
}

const testStartedAt = new Date().toISOString();
let report;
try {
  await cleanup();
  await assertOk(adminClient.from('feeder_thresholds').insert([
    { id: ids.thresholdA, feeder_id: ids.feederA1, parameter_code: 'MW', max_value: 10 },
    { id: ids.thresholdB, feeder_id: ids.feederB1, parameter_code: 'MW', max_value: 10 },
  ]), 'threshold setup');

  for (const [name, email, password] of users) {
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await assertOk(client.auth.signInWithPassword({ email, password }), `sign in ${name}`);
    clients[name] = client;
    const subscription = await subscribe(name, client);
    channels[name] = subscription.channel;
    events[name] = subscription.received;
  }

  const operatorAId = (await clients.operatorA.auth.getUser()).data.user.id;
  const operatorBId = (await clients.operatorB.auth.getUser()).data.user.id;
  const now = Date.now();
  await assertOk(clients.operatorA.from('log_book_entries').insert({
    id: ids.logA, station_id: ids.stationA1, feeder_id: ids.feederA1, operator_id: operatorAId,
    actual_event_time: new Date(now - 3600000).toISOString(), mw: 99, remarks: 'Realtime authorization A1 probe',
  }), 'A1 log insert');
  await assertOk(clients.operatorB.from('log_book_entries').insert({
    id: ids.logB, station_id: ids.stationB1, feeder_id: ids.feederB1, operator_id: operatorBId,
    actual_event_time: new Date(now - 7200000).toISOString(), mw: 99, remarks: 'Realtime authorization B1 probe',
  }), 'B1 log insert');
  await assertOk(clients.operatorA.from('interruptions').insert({
    id: ids.interruptionA, station_id: ids.stationA1, feeder_id: ids.feederA1, operator_id: operatorAId,
    interruption_start: new Date(now - 300000).toISOString(), current_status: 'OPEN', cause: 'REALTIME_TEST', remarks: 'A1 probe',
  }), 'A1 interruption insert');
  await assertOk(clients.operatorB.from('interruptions').insert({
    id: ids.interruptionB, station_id: ids.stationB1, feeder_id: ids.feederB1, operator_id: operatorBId,
    interruption_start: new Date(now - 300000).toISOString(), current_status: 'OPEN', cause: 'REALTIME_TEST', remarks: 'B1 probe',
  }), 'B1 interruption insert');
  await assertOk(clients.operatorA.from('interruptions').update({
    current_status: 'RESTORED', interruption_end: new Date().toISOString(), duration_minutes: 5,
  }).eq('id', ids.interruptionA), 'A1 interruption restore');
  await assertOk(clients.operatorB.from('interruptions').update({
    current_status: 'RESTORED', interruption_end: new Date().toISOString(), duration_minutes: 5,
  }).eq('id', ids.interruptionB), 'B1 interruption restore');
  await sleep(4000);

  const matrix = {};
  for (const name of Object.keys(events)) {
    matrix[name] = {
      logA: matches(events[name], 'log_book_entries', ids.logA).length,
      logB: matches(events[name], 'log_book_entries', ids.logB).length,
      interruptionAInsert: matches(events[name], 'interruptions', ids.interruptionA).filter((e) => e.eventType === 'INSERT').length,
      interruptionAUpdate: matches(events[name], 'interruptions', ids.interruptionA).filter((e) => e.eventType === 'UPDATE').length,
      interruptionBInsert: matches(events[name], 'interruptions', ids.interruptionB).filter((e) => e.eventType === 'INSERT').length,
      interruptionBUpdate: matches(events[name], 'interruptions', ids.interruptionB).filter((e) => e.eventType === 'UPDATE').length,
      alertA: events[name].filter((e) => e.table === 'parameter_alerts' && e.new?.log_book_entry_id === ids.logA).length,
      alertB: events[name].filter((e) => e.table === 'parameter_alerts' && e.new?.log_book_entry_id === ids.logB).length,
    };
  }

  await assertOk(clients.operatorA.auth.refreshSession(), 'Operator A token refresh');
  const beforeRefresh = events.operatorA.length;
  await assertOk(clients.operatorA.from('log_book_entries').update({ remarks: 'After token refresh' }).eq('id', ids.logA), 'post-refresh update');
  await sleep(1500);
  const refreshDelivered = events.operatorA.length > beforeRefresh;

  await clients.operatorA.removeChannel(channels.operatorA);
  const reconnect = await subscribe('operatorA', clients.operatorA, 'reconnect');
  channels.operatorA = reconnect.channel;
  const beforeReconnect = reconnect.received.length;
  await assertOk(clients.operatorA.from('log_book_entries').update({ remarks: 'After reconnect' }).eq('id', ids.logA), 'post-reconnect update');
  await sleep(1500);
  const reconnectDelivered = reconnect.received.length > beforeReconnect;

  const switchClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await assertOk(switchClient.auth.signInWithPassword({ email: users[0][1], password: users[0][2] }), 'switch sign in A');
  const switchA = await subscribe('switchA', switchClient, 'switch-a');
  await switchClient.removeChannel(switchA.channel);
  await assertOk(switchClient.auth.signOut(), 'switch sign out A');
  await assertOk(switchClient.auth.signInWithPassword({ email: users[1][1], password: users[1][2] }), 'switch sign in B');
  const switchB = await subscribe('switchB', switchClient, 'switch-b');
  await assertOk(clients.operatorA.from('log_book_entries').update({ remarks: 'A1 after user switch' }).eq('id', ids.logA), 'switch A1 update');
  await assertOk(clients.operatorB.from('log_book_entries').update({ remarks: 'B1 after user switch' }).eq('id', ids.logB), 'switch B1 update');
  await sleep(2000);
  const switchResult = {
    staleAChannelEvents: switchA.received.length,
    currentBReceivesA1: matches(switchB.received, 'log_book_entries', ids.logA).length,
    currentBReceivesB1: matches(switchB.received, 'log_book_entries', ids.logB).length,
  };
  await switchClient.removeChannel(switchB.channel);
  await switchClient.auth.signOut();

  report = { projectRef, matrix, refreshDelivered, reconnectDelivered, switchResult };
} finally {
  await cleanup();
  for (const client of Object.values(clients)) await client.auth.signOut().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
