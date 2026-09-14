import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AppHeader } from '@/components/ui/Page';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { operationalApi } from '@/services/operationalApi';
import { retryQueuedOperation } from '@/services/api';
import { conditionInput, enqueueStationCondition } from '@/services/stationConditionOffline';
import { getQueue, isOnline, OFFLINE_QUEUE_CHANGED_EVENT, type QueuedOp } from '@/services/offline';
import {
  beginStationConditionDraftSession, deleteStationConditionDraft, readStationConditionDraft,
  writeStationConditionDraft, type StationConditionDraft,
} from '@/services/operationalDrafts';
import { readOperationalSnapshot, writeOperationalSnapshot } from '@/services/operationalReadCache';
import { APP_RESUMED_EVENT } from '@/services/platform/runtime';
import type { StationCondition, StationConditionCategory, StationConditionValue } from '@/types/operational';

const categories: StationConditionCategory[] = ['EQUIPMENT', 'STATION_CONDITION', 'DEFECT', 'OTHER'];
const conditions: StationConditionValue[] = ['NORMAL', 'ATTENTION', 'ABNORMAL'];
const label = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const inputClass = 'mt-1 block w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900';
function nowIst() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16); }
function displayTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function freshDraft(userId: string, stationId: string): StationConditionDraft {
  return { userId, stationId, observedAt: nowIst(), category: 'STATION_CONDITION', equipmentArea: '',
    condition: 'NORMAL', observation: '', clientOperationId: crypto.randomUUID() };
}

export function StationConditionPage({ onBack }: { onBack: () => void }) {
  const { activeStation, loading } = useApp();
  const { user } = useAuth();
  return <div className="min-h-screen min-w-0 bg-slate-50 pb-24 lg:pb-8">
    <AppHeader title="Station Condition" subtitle="Optional operational observations" onBack={onBack} />
    <DesktopPageContainer width="wide">
      {user && activeStation ? <ConditionWorkspace key={`${user.id}:${activeStation.id}`} userId={user.id} stationId={activeStation.id} />
        : <p className="p-5 text-sm text-slate-600">{loading ? 'Loading authorized station…' : 'Select an authorized station to record observations.'}</p>}
    </DesktopPageContainer>
  </div>;
}

function ConditionWorkspace({ userId, stationId }: { userId: string; stationId: string }) {
  const { stations, setActiveStationId, online } = useApp();
  const [form, setForm] = useState(() => freshDraft(userId, stationId));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [listError, setListError] = useState('');
  const [rows, setRows] = useState<StationCondition[]>([]);
  const [pending, setPending] = useState<QueuedOp[]>([]);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const epoch = useRef(0);
  const cacheKey = `station-conditions:${stationId}`;

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    epoch.current = beginStationConditionDraftSession(userId, stationId);
    void (async () => {
      try {
        const draft = await readStationConditionDraft(userId, stationId);
        const queue = await getQueue(userId);
        // A crash after durable enqueue but before draft removal must not
        // restore an already-submitted form as a new observation.
        if (!cancelled && draft && !queue.some(op => op.clientOperationId === draft.clientOperationId)) setForm(draft);
      } catch {
        if (!cancelled) setDraftError('Could not restore the local draft. Check device storage before saving.');
      } finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; alive.current = false; generation.current++; };
  }, [stationId, userId]);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const current = () => alive.current && request === generation.current;
    setLoading(true);
    try {
      const queue = await getQueue(userId);
      if (!current()) return;
      setPending(queue.filter(op => op.operationType === 'ADD_STATION_CONDITION'
        && conditionInput(op.body)?.station_id === stationId));
      if (!isOnline()) {
        setRows(readOperationalSnapshot<StationCondition[]>(userId, cacheKey)?.value ?? []);
        setCached(true); setListError(''); return;
      }
      const result = await operationalApi.getRecentStationConditions(stationId);
      if (!current()) return;
      setRows(result); setCached(false); setListError('');
      writeOperationalSnapshot(userId, cacheKey, result);
    } catch (cause) {
      if (current()) {
        setListError(cause instanceof Error ? cause.message : 'Could not refresh conditions.');
        setCached(true);
      }
    } finally { if (current()) setLoading(false); }
  }, [cacheKey, stationId, userId]);

  useEffect(() => {
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, update);
    window.addEventListener(APP_RESUMED_EVENT, update);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, update);
      window.removeEventListener(APP_RESUMED_EVENT, update);
    };
  }, [online, refresh]);

  function change(patch: Partial<StationConditionDraft>) {
    const next = { ...form, ...patch };
    setForm(next); setMessage('');
    void writeStationConditionDraft(next, epoch.current).then(() => {
      if (alive.current) setDraftError('');
    }).catch(() => { if (alive.current) setDraftError('Draft could not be saved on this device. Keep this page open until you submit.'); });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !ready) return;
    const observedAt = new Date(`${form.observedAt}:00+05:30`);
    if (!form.observation.trim() || !Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now()) {
      setError('Enter an observation and a valid observed date/time that is not in the future.'); return;
    }
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const operation = await enqueueStationCondition({ station_id: stationId, observed_at: observedAt.toISOString(),
        category: form.category, condition: form.condition, equipment_area: form.equipmentArea.trim() || null,
        observation: form.observation.trim(), client_operation_id: form.clientOperationId }, userId);
      try { await deleteStationConditionDraft(userId, stationId); }
      catch { if (alive.current) setDraftError('Entry is stored, but the old draft could not be cleared.'); }
      if (!alive.current) return;
      epoch.current = beginStationConditionDraftSession(userId, stationId);
      setForm(freshDraft(userId, stationId));
      setMessage('Observation stored. Its sync status is shown below.');
      if (isOnline()) {
        try {
          await retryQueuedOperation(operation.id);
          const remaining = await getQueue(userId);
          if (alive.current) setMessage(remaining.some(op => op.id === operation.id)
            ? 'Entry remains on this device. Check its sync status below.' : 'Station condition saved.');
        } catch { if (alive.current) setMessage('Entry remains safely stored on this device. Sync will retry after access is verified.'); }
      }
      if (alive.current) await refresh();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not store the condition. Your form has been kept.');
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  async function rectify(id: string) {
    if (!isOnline()) { setError('Rectification requires an online connection.'); return; }
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await operationalApi.rectifyStationCondition(id);
      if (alive.current) { setMessage('Condition marked Rectified.'); await refresh(); }
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : 'Rectification was not confirmed. Refresh before retrying.'); await refresh(); }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  async function retry(id: string) {
    if (!isOnline() || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await retryQueuedOperation(id);
      const remaining = await getQueue(userId);
      if (alive.current) setMessage(remaining.some(op => op.id === id)
        ? 'Entry remains on this device. Check its sync status below.' : 'Station condition saved.');
    }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not retry sync.'); }
    finally { locked.current = false; if (alive.current) { setBusy(false); await refresh(); } }
  }

  const pendingIds = new Set(pending.map(op => op.clientOperationId));
  return <div className="min-w-0 space-y-4 p-4 lg:px-0 lg:py-6">
    <label className="block text-sm font-semibold text-slate-700">Station
      <select className={inputClass} value={stationId} disabled={busy} onChange={e => setActiveStationId(e.target.value)}>
        {stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
      </select>
    </label>
    {message && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <form onSubmit={event => void save(event)} className="min-w-0 self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
        <h2 className="text-lg font-bold text-slate-900">New observation</h2>
        <p className="mt-1 text-xs text-slate-500">Record only when needed. New entries are Open. Times are in IST.</p>
        <fieldset disabled={busy || !ready} className="mt-4 min-w-0 space-y-4 disabled:opacity-60">
          <label className="block text-sm font-semibold text-slate-700">Observed Date &amp; Time
            <input type="datetime-local" required className={inputClass} value={form.observedAt} max={nowIst()} onChange={e => change({ observedAt: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">Category
            <select className={inputClass} value={form.category} onChange={e => change({ category: e.target.value as StationConditionCategory })}>
              {categories.map(value => <option key={value} value={value}>{label(value)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Equipment / Area <span className="font-normal text-slate-500">(optional)</span>
            <input className={inputClass} maxLength={200} value={form.equipmentArea} onChange={e => change({ equipmentArea: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">Condition
            <select className={inputClass} value={form.condition} onChange={e => change({ condition: e.target.value as StationConditionValue })}>
              {conditions.map(value => <option key={value} value={value}>{label(value)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Observation
            <textarea required maxLength={4000} rows={4} className={`${inputClass} resize-y`} value={form.observation} onChange={e => change({ observation: e.target.value })} />
          </label>
          <button type="submit" className="min-h-11 w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : online ? 'Save observation' : 'Save offline'}</button>
        </fieldset>
        {draftError && <p role="status" className="mt-3 text-xs text-amber-800">{draftError}</p>}
      </form>
      <section className="min-w-0" aria-label="Recent station conditions">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-bold text-slate-900">Recent conditions</h2>
          <button type="button" disabled={loading || busy} onClick={() => void refresh()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {!online && <p className="mb-3 text-xs text-slate-600">Rectification requires an online connection.</p>}
        {cached && <p className="mb-3 text-xs text-slate-500">Saved records shown from the last loaded view; status may have changed.</p>}
        {listError && <p role="alert" className="mb-3 break-words text-sm text-red-700">{listError}</p>}
        <div className="space-y-3">
          {pending.map(op => {
            const item = conditionInput(op.body);
            if (!item) return null;
            const failed = Boolean(op.lastError) || op.syncState === 'NEEDS_ATTENTION';
            return <article key={op.id} className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <ConditionDetails item={item} status="OPEN" />
              <p className={`mt-2 text-xs font-bold ${failed ? 'text-red-700' : 'text-amber-800'}`}>{failed ? 'Sync Failed' : 'Pending Sync'} · On this device</p>
              {op.lastError && <p className="mt-2 break-words text-xs text-slate-700">{op.lastError}</p>}
              {online && <button type="button" disabled={busy} onClick={() => void retry(op.id)} className="mt-2 min-h-11 rounded-lg border border-amber-300 px-3 text-sm font-semibold disabled:opacity-50">Retry sync</button>}
            </article>;
          })}
          {rows.filter(row => !pendingIds.has(row.client_operation_id)).map(row => <article key={row.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <ConditionDetails item={row} status={row.status} />
            {row.status === 'OPEN' && <button type="button" disabled={!online || busy} onClick={() => void rectify(row.id)} className="mt-3 min-h-11 rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-40">Mark Rectified</button>}
          </article>)}
          {!loading && !rows.length && !pending.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">{online ? 'No recent conditions.' : 'No conditions stored on this device for this station.'}</p>}
        </div>
        {rows.length >= 50 && <p className="mt-3 text-xs text-slate-500">Showing the latest 50 saved conditions.</p>}
      </section>
    </div>
  </div>;
}

function ConditionDetails({ item, status }: { item: Pick<StationCondition, 'observed_at' | 'category' | 'condition' | 'observation'> & { equipment_area?: string | null }; status: string }) {
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2"><time className="text-xs text-slate-500">{displayTime(item.observed_at)} IST</time><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{status}</span></div>
    <p className="mt-2 text-sm font-semibold text-slate-900">{label(item.category)} <span className={item.condition === 'ABNORMAL' ? 'text-red-700' : item.condition === 'ATTENTION' ? 'text-amber-700' : 'text-emerald-700'}>· {label(item.condition)}</span></p>
    {item.equipment_area && <p className="mt-1 break-words text-xs text-slate-600">{item.equipment_area}</p>}
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{item.observation.length > 300 ? `${item.observation.slice(0, 300)}…` : item.observation}</p>
  </>;
}
