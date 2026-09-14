// Actual Supabase client, RPC service, and IndexedDB replay implementation.
// This file is test-only; the production application never imports it.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from '../../src/services/supabase';
import { operationalApi } from '../../src/services/operationalApi';
import { enqueueStationCondition } from '../../src/services/stationConditionOffline';
import { getQueue, enqueueOp, enqueueInterruptionAdd, enqueueInterruptionRestore } from '../../src/services/offline';
import { getOfflineStorage } from '../../src/services/offlineStorage';
import { flushQueue, retryQueuedOperation } from '../../src/services/api';
import { setQueueSyncAuthorization } from '../../src/services/syncAuthorization';
import { AppProvider, useApp } from '../../src/context/AppContext';
import { StationConditionPage } from '../../src/pages/StationConditionPage';

const realFetch=window.fetch.bind(window);
let offline=false;
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>!offline});
window.fetch=(...args)=>offline ? Promise.reject(new TypeError('Integration test: network disconnected')) : realFetch(...args);
function setOffline(value:boolean){offline=value;window.dispatchEvent(new Event(value?'offline':'online'));}
const results=document.getElementById('results')!;
function report(message:string){const p=document.createElement('p');p.textContent=message;results.appendChild(p);}
function assert(ok:unknown,message:string){if(!ok)throw new Error(message);report(`PASS: ${message}`);}
const cfg=await (await realFetch('/context')).json();
const session=await supabase.auth.setSession({access_token:cfg.accessToken,refresh_token:''});
if(session.error)throw new Error('The supplied DEV test token must be refreshed');
supabase.auth.stopAutoRefresh();
const verified=await supabase.auth.getUser();
if(verified.error || verified.data.user?.id!==cfg.userId)throw new Error('DEV test actor verification failed');
const role=await supabase.rpc('get_my_role');
const scope=await supabase.rpc('get_my_accessible_station_ids');
if(role.data!=='OPERATOR' || !scope.data?.some((s:{station_id:string})=>s.station_id===cfg.stationId))throw new Error('Operator scope verification failed');
setQueueSyncAuthorization(cfg.userId);
const observed=new Date(Date.now()-3600000).toISOString();
const input=(id:string)=>({station_id:cfg.stationId,observed_at:observed,category:'STATION_CONDITION' as const,condition:'ATTENTION' as const,observation:cfg.run,client_operation_id:id});

async function checks(){
  const online=await operationalApi.createStationCondition(input(`${cfg.run}-online`));
  assert(online.recorded_by===cfg.userId && online.status==='OPEN','live RPC create with server recorder');
  const recent=await operationalApi.getRecentStationConditions(cfg.stationId);
  assert(recent.some(row=>row.id===online.id),'live recent-condition list includes created row');
  const rectified=await operationalApi.rectifyStationCondition(online.id);
  assert(rectified.status==='RECTIFIED' && rectified.rectified_by===cfg.userId && Boolean(rectified.rectified_at),'backend rectification stamps');
  let denied=false;
  try{await operationalApi.createStationCondition({...input(`${cfg.run}-denied`),station_id:cfg.outsideStationId});}catch{denied=true;}
  assert(denied,'unassigned station denied by real RPC');
  const forged=await supabase.from('station_conditions').update({recorded_by:crypto.randomUUID()}).eq('id',online.id);
  assert(Boolean(forged.error),'direct recorder reassignment denied');
  setOffline(true);
  const queued=await enqueueStationCondition(input(`${cfg.run}-offline`),cfg.userId);
  assert(getOfflineStorage().backend==='indexeddb' && Boolean(await getOfflineStorage().getOperation(queued.id)),'offline create persisted in real IndexedDB with network blocked');
  setQueueSyncAuthorization(null);denied=false;
  try{await flushQueue();}catch{denied=true;}
  assert(denied && (await getQueue(cfg.userId)).some(op=>op.id===queued.id),'invalidated session retains observation');
  setOffline(false);setQueueSyncAuthorization(cfg.userId);
  // Lose one response AFTER the real server committed, then replay its same ID.
  let lost=false;
  window.fetch=async(...args)=>{const response=await realFetch(...args);if(!lost && String(args[0]).includes('/rpc/create_station_condition')){lost=true;throw new TypeError('Integration test: response lost after commit');}return response;};
  await flushQueue();
  assert((await getQueue(cfg.userId)).some(op=>op.id===queued.id),'real committed row with lost response remains queued');
  window.fetch=realFetch;
  await retryQueuedOperation(queued.id);
  const persisted=await supabase.from('station_conditions').select('*').eq('client_operation_id',queued.clientOperationId);
  assert(!persisted.error && persisted.data?.length===1,'real Supabase replay creates exactly one row');
  const row=persisted.data![0];
  assert(row.observed_at && Date.parse(row.observed_at)===Date.parse(observed) && row.entry_mode==='OFFLINE'
    && Date.parse(row.recorded_at)===queued.recordedAt && Boolean(row.synced_at),'original event time and provenance preserved');
  assert(!(await getQueue(cfg.userId)).some(op=>op.id===queued.id),'local observation removed after confirmed replay');
  // Exercise an actual rejected token at the transport boundary, without
  // changing Auth settings or invalidating the operator's genuine session.
  const expired=await enqueueStationCondition(input(`${cfg.run}-expired`),cfg.userId);
  window.fetch=(url,options)=>realFetch(url,{...options,headers:{...(options?.headers as Record<string,string>),Authorization:'Bearer invalid-expired-test-token'}});
  await flushQueue();
  assert((await getQueue(cfg.userId)).some(op=>op.id===expired.id && op.failureCategory==='AUTHORIZATION'),'real rejected session retains queue with authorization failure');
  window.fetch=realFetch;await retryQueuedOperation(expired.id);
  await enqueueOp({method:'POST',table:'log_book_entries',operationType:'ADD_LOG_ENTRY',ownerUserId:cfg.userId,
    clientOperationId:`${cfg.run}-parameter`,body:{station_id:cfg.stationId,feeder_id:cfg.feederId,operator_id:cfg.userId,actual_event_time:observed,mw:0,voltage_kv:0,current_a:0}});
  await flushQueue();
  const reading=await supabase.from('log_book_entries').select('id').eq('client_operation_id',`${cfg.run}-parameter`);
  assert(!reading.error && reading.data?.length===1,'existing parameter replay reaches real Supabase');
  const trip=await enqueueInterruptionAdd({station_id:cfg.stationId,feeder_id:cfg.feederId,operator_id:cfg.userId,interruption_start:observed,cause:'Testing',remarks:cfg.run,current_status:'OPEN'},observed,cfg.userId);
  await enqueueInterruptionRestore({localEntityId:trip.localEntityId,ownerUserId:cfg.userId,eventTime:new Date(Date.now()-1800000).toISOString(),body:{interruption_end:new Date(Date.now()-1800000).toISOString(),current_status:'RESTORED'}});
  await flushQueue();
  const interruption=await supabase.from('interruptions').select('id,current_status').eq('client_operation_id',trip.clientOperationId);
  assert(!interruption.error && interruption.data?.length===1 && interruption.data[0].current_status==='RESTORED','existing historical interruption pair replay reaches real Supabase');
  assert((await getQueue(cfg.userId)).length===0,'all integration queue operations confirmed and cleared');
  report('ALL LIVE CHECKS PASSED');
}
function Page(){const app=useApp();React.useEffect(()=>{if(app.stations.some(s=>s.id===cfg.stationId))app.setActiveStationId(cfg.stationId);},[app.stations]);return <StationConditionPage onBack={()=>location.assign('/checks')} />;}
if(location.pathname==='/page')createRoot(document.getElementById('root')!).render(<AppProvider><Page/></AppProvider>);
else void checks().catch(error=>report(`FAIL: ${error.message}`));
