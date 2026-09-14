// Browser-only test fixture, bundled by serve_station_condition_checks.mjs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { state, toggleOnline } from 'synthetic-test-context';
import { StationConditionPage } from '../../src/pages/StationConditionPage';
import { enqueueStationCondition } from '../../src/services/stationConditionOffline';
import { getQueue, enqueueOp } from '../../src/services/offline';
import { getOfflineStorage } from '../../src/services/offlineStorage';
import { flushQueue, retryQueuedOperation } from '../../src/services/api';
import { setQueueSyncAuthorization } from '../../src/services/syncAuthorization';
import { canAccessRoute } from '../../src/security/permissions';
import { operationalApi } from '../../src/services/operationalApi';
import { beginStationConditionDraftSession, readStationConditionDraft, writeStationConditionDraft, deleteStationConditionDraft } from '../../src/services/operationalDrafts';

const root = document.getElementById('root')!;
const report = (message: string) => { const p = document.createElement('p'); p.textContent = message; root.appendChild(p); };
const assert = (ok: unknown, title: string) => { if (!ok) throw new Error(title); report(`PASS: ${title}`); };
const input = (id = crypto.randomUUID()) => ({ station_id: 'station-a', observed_at: '2026-09-01T00:00:00.000Z', category: 'DEFECT' as const,
  condition: 'ATTENTION' as const, observation: 'Synthetic offline observation', client_operation_id: id });

async function checks() {
  const storage = getOfflineStorage();
  assert(storage.backend === 'indexeddb', 'real browser IndexedDB backend');
  const stage = sessionStorage.getItem('condition-check-stage');
  if (stage !== 'reload') {
    await storage.clearOperations();
    toggleOnline(false);
    const op = await enqueueStationCondition(input('reload-test'), 'operator-a');
    assert(op.entryMode === 'OFFLINE', 'offline origin captured');
    sessionStorage.setItem('condition-check-stage','reload');
    location.reload(); return;
  }
  sessionStorage.removeItem('condition-check-stage');
  assert((await getQueue('operator-a')).some(op=>op.clientOperationId==='reload-test'), 'queued entry survived actual page reload');
  setQueueSyncAuthorization('operator-a');
  state.mode='lost';
  await flushQueue();
  assert((await getQueue('operator-a')).length===1 && state.rows.size===1, 'lost response retains local entry after server acceptance');
  const op=(await getQueue('operator-a'))[0];
  await retryQueuedOperation(op.id);
  assert(state.rows.size===1 && (await getQueue('operator-a')).length===0, 'retry creates exactly one synthetic server row and clears queue');
  const saved=state.rows.get('reload-test');
  assert(saved.observed_at==='2026-09-01T00:00:00.000Z' && saved.entry_mode==='OFFLINE' && saved.recorded_at===new Date(op.recordedAt).toISOString(), 'event time and offline recording provenance preserved');
  const denied=await enqueueStationCondition(input(),'operator-a');
  state.mode='denied'; await flushQueue();
  assert((await getQueue('operator-a'))[0].syncState==='NEEDS_ATTENTION', 'authorization rejection retained as attention state');
  state.user='operator-b';setQueueSyncAuthorization('operator-b');
  assert((await getQueue('operator-b')).length===0, 'cross-user queue isolation');
  await flushQueue();
  assert((await getQueue('operator-a')).some(row=>row.id===denied.id), 'other account cannot drain original queue');
  state.user='operator-a';setQueueSyncAuthorization(null);
  let blocked=false;try{await flushQueue();}catch{blocked=true;}
  assert(blocked && (await getQueue('operator-a')).length===1,'unverified session cannot remove queued data');
  setQueueSyncAuthorization('operator-a');state.mode='malformed';
  await retryQueuedOperation(denied.id);
  assert((await getQueue('operator-a')).length===1,'HTTP success without confirmed record does not dequeue');
  state.mode='ok';await retryQueuedOperation(denied.id);
  assert((await getQueue('operator-a')).length===0,'successful retry clears failed entry');
  toggleOnline(false);
  const before=state.calls;blocked=false;
  try{await operationalApi.rectifyStationCondition(saved.id);}catch{blocked=true;}
  assert(blocked && state.calls===before,'offline rectification blocked before transport');
  const epoch=beginStationConditionDraftSession('operator-a','station-a');
  await writeStationConditionDraft({userId:'operator-a',stationId:'station-a',observedAt:'',category:'OTHER',condition:'NORMAL',equipmentArea:'',observation:'Unfinished text',clientOperationId:'draft-test'},epoch);
  assert((await readStationConditionDraft('operator-a','station-a'))?.observation==='Unfinished text','incomplete draft preserved');
  assert(await readStationConditionDraft('operator-b','station-a')===null,'draft account isolation');
  await deleteStationConditionDraft('operator-a','station-a');
  // Existing operation normalization/storage remains intact alongside new kind.
  const legacy=await enqueueOp({method:'POST',table:'log_book_entries',operationType:'ADD_LOG_ENTRY',ownerUserId:'operator-a',body:{station_id:'station-a'}});
  assert((await getQueue('operator-a')).some(row=>row.id===legacy.id && row.operationType==='ADD_LOG_ENTRY'),'existing parameter queue kind preserved');
  toggleOnline(true);
  await flushQueue();
  assert((await getQueue('operator-a')).length===0,'existing parameter replay path still completes');
  await enqueueOp({method:'POST',table:'interruptions',operationType:'ADD_INTERRUPTION',ownerUserId:'operator-a',body:{station_id:'station-a'},localEntityId:'local-trip'});
  await flushQueue();
  assert((await getQueue('operator-a')).length===0,'existing interruption replay path still completes');
  assert(canAccessRoute('OPERATOR',{tab:'more',sub:'station-condition'}) && !canAccessRoute('FIELD_OFFICER',{tab:'more',sub:'station-condition'}),'new route uses existing operator capability');
  await storage.clearOperations();
  report('ALL CHECKS PASSED — synthetic transport, real IndexedDB. No remote data changed.');
  const link=document.createElement('a');link.href='/mobile';link.textContent='Open mobile preview';root.appendChild(link);
}

if(location.pathname==='/tests') void checks().catch(error=>report(`FAIL: ${error.message}`));
else {
  setQueueSyncAuthorization('operator-a');
  state.rows.set('preview', { ...input('preview'), id:'preview-row', category:'EQUIPMENT', equipment_area:'Transformer bay',
    observed_at:new Date(Date.now()-3600000).toISOString(), observation:'Synthetic inspection: temperature indicator requires attention.',status:'OPEN',recorded_by:'operator-a' });
  const toolbar=document.createElement('div');toolbar.style.padding='10px';
  const button=document.createElement('button');button.textContent='Toggle simulated offline';button.onclick=()=>toggleOnline(!state.online);toolbar.appendChild(button);
  root.before(toolbar);
  createRoot(root).render(<StationConditionPage onBack={()=>location.assign('/tests')} />);
  setInterval(()=>{toolbar.dataset.overflow=String(document.documentElement.scrollWidth>innerWidth);toolbar.title=`Horizontal overflow: ${toolbar.dataset.overflow}`;},500);
}
