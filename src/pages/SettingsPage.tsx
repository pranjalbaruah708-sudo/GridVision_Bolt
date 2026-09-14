import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Clock3, Cloud, CloudOff, Copy, HardDrive, Info, Loader2, RefreshCw, RotateCcw, Shield, Smartphone, Trash2, X } from 'lucide-react';
import { api, retryQueuedOperation, type NotificationDevice } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { useSettings, type NotificationPermissionState } from '@/hooks/useSettings';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { getPlatformName, getRuntimeMode, isNativeApp } from '@/services/platform/runtime';
import { getQueue, getQueueHealth, OFFLINE_QUEUE_CHANGED_EVENT, type QueueHealth, type QueuedOp } from '@/services/offline';
import { supabase } from '@/services/supabase';
import { getDraftInventory, type DraftInventory } from '@/services/operationalDrafts';
import { clearDisposableCaches, countOperationalReadCaches, STORAGE_MAINTENANCE_EVENT } from '@/services/operationalReadCache';
import { estimateStorageHealth, formatStorageBytes, runStorageMaintenance, type StorageHealth } from '@/services/storageHealth';
import { buildSanitizedDiagnosticsText, DIAGNOSTICS_CHANGED_EVENT, friendlyFailureCategory, getDiagnosticSummary, getLastDurableWriteAt, recordCacheCleanup, recordStorageFailure, type DiagnosticSummary } from '@/services/diagnostics';

const permissionLabel = (permission: NotificationPermissionState) => ({ granted: 'Allowed', denied: 'Denied', prompt: 'Not requested', unsupported: 'Unsupported' }[permission]);

export function SettingsPage({ onBack, onReviewOperation }: { onBack: () => void; onReviewOperation?: (operation: QueuedOp) => void }) {
  const { online, queueError, flush, stations, feeders } = useApp();
  const { settings, notificationPermission, requestNotificationPermission, disableNotifications, setSettings } = useSettings();
  const [devices, setDevices] = useState<NotificationDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notificationWorking, setNotificationWorking] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [queueOperations, setQueueOperations] = useState<QueuedOp[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth>({ total: 0, pending: 0, needsAttention: 0, oldestEnqueuedAt: null, lastSuccessfulSyncAt: null });
  const [queueLoading, setQueueLoading] = useState(true);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [retryingOperationId, setRetryingOperationId] = useState<string | null>(null);
  const [draftInventory, setDraftInventory] = useState<DraftInventory>({ total: 0, recent: 0, old: 0, veryOld: 0, oldestUpdatedAt: null });
  const [cachedViewCount, setCachedViewCount] = useState(0);
  const [storageHealth, setStorageHealth] = useState<StorageHealth>({ level: 'UNAVAILABLE', usage: null, quota: null, percent: null, persisted: null });
  const [lastCleanup, setLastCleanup] = useState<{ at: number; count: number } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSummary | null>(null);
  const [lastDurableWriteAt, setLastDurableWriteAt] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceLoadGeneration = useRef(0);
  const settingsLoadGeneration = useRef(0);

  const loadDevices = useCallback(async () => {
    const generation = ++deviceLoadGeneration.current;
    setDevicesLoading(true);
    setDevicesError(null);
    try { const result = await api.getMyNotificationDevices(); if (generation === deviceLoadGeneration.current) setDevices(result); }
    catch (cause) { if (generation === deviceLoadGeneration.current) setDevicesError(cause instanceof Error ? cause.message : 'Could not load notification devices.'); }
    finally { if (generation === deviceLoadGeneration.current) setDevicesLoading(false); }
  }, []);
  useEffect(() => { void loadDevices(); }, [loadDevices]);
  useEffect(() => {
    const refreshDevices = () => { void loadDevices(); };
    window.addEventListener('fcm-token-received', refreshDevices);
    return () => window.removeEventListener('fcm-token-received', refreshDevices);
  }, [loadDevices]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const loadQueueHealth = useCallback(async () => {
    const generation = ++settingsLoadGeneration.current;
    setQueueLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) { setQueueOperations([]); return; }
      setCurrentUserId(userId);
      const [operations, drafts, storage, diagnosticSummary, durableWrite] = await Promise.all([getQueue(userId), getDraftInventory(userId), estimateStorageHealth(), getDiagnosticSummary(userId), getLastDurableWriteAt()]);
      const health = await getQueueHealth(userId, operations);
      if (generation !== settingsLoadGeneration.current) return;
      setQueueOperations(operations);
      setQueueHealth(health);
      setDraftInventory(drafts);
      setCachedViewCount(countOperationalReadCaches(userId));
      setStorageHealth(storage);
      setDiagnostics(diagnosticSummary);
      setLastDurableWriteAt(durableWrite);
    } finally { if (generation === settingsLoadGeneration.current) setQueueLoading(false); }
  }, []);
  useEffect(() => {
    void loadQueueHealth();
    const refresh = () => { void loadQueueHealth(); };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh);
    window.addEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh);
    return () => { window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh); window.removeEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh); };
  }, [loadQueueHealth]);
  useEffect(() => {
    void runStorageMaintenance().then(({ health, removed }) => {
      setStorageHealth(health);
      if (removed) {
        setLastCleanup({ at: Date.now(), count: removed });
        if (currentUserId) void recordCacheCleanup(currentUserId, removed);
      }
    }).then(loadQueueHealth).catch(() => undefined);
    const onMaintenance = (event: Event) => {
      const detail = (event as CustomEvent<{ cleanupAt?: number; cleanupCount?: number; failureAt?: number }>).detail;
      if (detail?.cleanupAt) {
        setLastCleanup({ at: detail.cleanupAt, count: detail.cleanupCount ?? 0 });
        if (currentUserId) void recordCacheCleanup(currentUserId, detail.cleanupCount ?? 0);
      }
      if (detail?.failureAt && currentUserId) void recordStorageFailure(currentUserId);
      void loadQueueHealth();
    };
    window.addEventListener(STORAGE_MAINTENANCE_EVENT, onMaintenance);
    return () => window.removeEventListener(STORAGE_MAINTENANCE_EVENT, onMaintenance);
  }, [currentUserId, loadQueueHealth]);

  const flash = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async () => {
    setNotificationWorking(true);
    try {
      if (settings.notificationsEnabled) { await disableNotifications(); flash('Notifications disabled on this device'); }
      else {
        const permission = await requestNotificationPermission();
        if (permission === 'granted' && isNativeApp()) { flash('Notification registration requested'); await loadDevices(); }
        else if (permission === 'granted') flash('Browser permission allowed; push registration is available in the mobile app');
        else if (permission === 'unsupported') flash('Notifications are not supported on this platform');
        else flash('Notification permission was not granted');
      }
    } catch (cause) { flash(cause instanceof Error ? cause.message : 'Could not update notifications'); }
    finally { setNotificationWorking(false); }
  };

  const handleSync = async () => {
    if (!online) { flash('Connect to the internet before syncing'); return; }
    setSyncing(true);
    try {
      const result = await flush();
      if (!result) flash('No pending changes');
      else if (result.failed) flash(`Synced ${result.ok}; ${result.failed} item${result.failed === 1 ? '' : 's'} still pending`);
      else flash(result.ok ? `Synced ${result.ok} item${result.ok === 1 ? '' : 's'}` : 'No pending changes');
    } catch (cause) { flash(cause instanceof Error ? cause.message : 'Sync failed; pending changes were kept'); }
    finally { setSyncing(false); await loadQueueHealth(); }
  };

  const handleRetryOperation = async (operation: QueuedOp) => {
    if (!online) { flash('Connect to the internet before retrying this record'); return; }
    setRetryingOperationId(operation.id);
    try {
      const result = await retryQueuedOperation(operation.id);
      flash(result.ok ? 'Record synchronized successfully' : 'Record remains safely pending for review');
    } catch (cause) { flash(cause instanceof Error ? cause.message : 'Retry failed; the record remains safely pending'); }
    finally { setRetryingOperationId(null); await loadQueueHealth(); }
  };

  const handleClearCache = () => {
    try {
      const removed = clearDisposableCaches();
      setSettings((current) => ({ ...current, cacheClearedAt: Date.now() }));
      setCachedViewCount(0);
      setLastCleanup({ at: Date.now(), count: removed });
      if (currentUserId) void recordCacheCleanup(currentUserId, removed);
      setConfirmClear(false); flash('Downloaded and cached views cleared');
    } catch { flash('Could not clear the local cache'); }
  };

  const activeDevices = devices.filter((device) => device.is_active).length;
  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'Development build';
  const mode = getRuntimeMode();
  const lastCleared = settings.cacheClearedAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(settings.cacheClearedAt) : 'Never';
  const lastSync = queueHealth.lastSuccessfulSyncAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(queueHealth.lastSuccessfulSyncAt) : 'Not yet';
  const storageUsage = storageHealth.usage !== null && storageHealth.quota !== null ? `${formatStorageBytes(storageHealth.usage)} of ${formatStorageBytes(storageHealth.quota)}` : 'Unavailable on this device';
  const storageTone = storageHealth.level === 'CRITICAL' ? 'text-red-700' : storageHealth.level === 'HIGH' ? 'text-amber-700' : storageHealth.level === 'MODERATE' ? 'text-orange-700' : 'text-emerald-700';
  const storageLabel = storageHealth.level === 'UNAVAILABLE' ? 'Unavailable' : storageHealth.level.charAt(0) + storageHealth.level.slice(1).toLowerCase();
  const notificationDeviceLabel = settings.pushTokenRegistered ? 'Registered on this device' : 'Not registered';
  const authorizationLabel = diagnostics?.authorizationStatus === 'VERIFIED' ? 'Verified' : diagnostics?.authorizationStatus === 'REVOKED' ? 'Access changed' : diagnostics?.authorizationStatus === 'TEMPORARILY_UNAVAILABLE' ? 'Temporarily unavailable' : diagnostics?.authorizationStatus === 'REQUIRES_RECONNECTION' ? 'Requires reconnection' : 'Not verified';
  const diagnosticSyncLabel = diagnostics?.lastSyncResult === 'SUCCESS' ? 'Successful' : diagnostics?.lastSyncResult === 'PARTIAL' ? `${diagnostics.lastSyncSucceeded} synchronized · ${diagnostics.lastSyncFailed} needs attention` : diagnostics?.lastSyncResult === 'FAILED' ? (diagnostics.dominantFailureCategory ? friendlyFailureCategory(diagnostics.dominantFailureCategory) : 'Could not synchronize') : diagnostics?.lastSyncResult === 'NO_CHANGES' ? 'No pending changes' : 'Not yet attempted';

  const copyDiagnostics = async () => {
    if (!diagnostics) return;
    const text = buildSanitizedDiagnosticsText({ generatedAt: new Date(), appVersion, platform: getPlatformName(), runtime: mode, online, summary: diagnostics,
      pending: queueHealth.pending, needsAttention: queueHealth.needsAttention, oldestPendingAt: queueHealth.oldestEnqueuedAt,
      storageHealth: storageLabel, storageUsage, storagePersistence: storageHealth.persisted === null ? 'Unavailable' : storageHealth.persisted ? 'Persistent' : 'Best effort', lastDurableWriteAt,
      drafts: draftInventory.total, oldestDraftAt: draftInventory.oldestUpdatedAt, cachedViews: cachedViewCount,
      notificationPermission: permissionLabel(notificationPermission), notificationDevice: notificationDeviceLabel });
    try {
      await navigator.clipboard.writeText(text);
      flash('Diagnostics copied');
    } catch {
      const field = document.createElement('textarea');
      field.value = text; field.readOnly = true; field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select();
      const copied = document.execCommand('copy');
      field.remove();
      flash(copied ? 'Diagnostics copied' : 'Could not copy diagnostics on this device');
    }
  };

  return <Screen showStatusBar={false}>
    <AppHeader title="Settings" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Settings" subtitle="Application preferences and notifications" />
    <PageBody className="lg:max-w-none lg:px-0 lg:py-0 lg:pb-10"><DesktopPageContainer width="wide"><div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0 lg:pt-6">
      <Section title="Connectivity & Sync" icon={online ? <Cloud className="h-4 w-4 text-emerald-600" /> : <CloudOff className="h-4 w-4 text-amber-600" />}>
        <Row label="Connection" value={online ? 'Online' : 'Offline'} valueClass={online ? 'text-emerald-700' : 'text-amber-700'} />
        <Row label="Pending" value={queueLoading ? 'Loading…' : `${queueHealth.pending} item${queueHealth.pending === 1 ? '' : 's'}`} valueClass={queueHealth.pending ? 'text-amber-700' : 'text-slate-700'} />
        <Row label="Needs attention" value={queueLoading ? 'Loading…' : `${queueHealth.needsAttention} item${queueHealth.needsAttention === 1 ? '' : 's'}`} valueClass={queueHealth.needsAttention ? 'text-red-700' : 'text-slate-700'} />
        <Row label="Last successful sync" value={lastSync} />
        {queueError ? <p role="alert" className="mt-2 text-xs font-medium text-red-700">{queueError}</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void handleSync()} disabled={syncing || !online || queueHealth.pending === 0} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Syncing…' : !online ? 'Offline' : queueHealth.pending === 0 ? 'No pending changes' : 'Sync now'}</button><button type="button" onClick={() => setSyncDetailsOpen(true)} disabled={!queueOperations.length} className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-40"><Clock3 className="h-4 w-4" />View Sync Details</button></div>
      </Section>

      <Section title="Notifications" icon={<Bell className="h-4 w-4 text-amber-600" />} ariaBusy={devicesLoading}>
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">Push notifications</p><p className="text-[11px] text-slate-500">Outage and operating-limit alerts on this device</p></div><Toggle checked={settings.notificationsEnabled} onChange={() => void handleToggle()} disabled={notificationWorking || !isNativeApp()} label="Push notifications on this device" /></div>
        <div className="mt-3 border-t border-slate-100 pt-2"><Row label="Permission" value={permissionLabel(notificationPermission)} /><Row label="Local preference" value={settings.notificationsEnabled ? 'Enabled' : 'Disabled'} valueClass={settings.notificationsEnabled ? 'text-emerald-700' : 'text-slate-600'} /><Row label="Current device" value={settings.pushTokenRegistered ? 'Registered' : notificationWorking ? 'Updating…' : 'Not registered'} valueClass={settings.pushTokenRegistered ? 'text-emerald-700' : 'text-slate-600'} /><Row label="Active devices" value={devicesLoading ? 'Loading…' : devicesError ? 'Unavailable' : String(activeDevices)} /></div>
        {devicesLoading && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Refreshing device status…</p>}
        {devicesError && <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-red-50 p-2.5 text-[11px] leading-4 text-red-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="flex-1">{devicesError}</span><button type="button" onClick={() => void loadDevices()} className="font-bold text-red-800 underline">Retry</button></div>}
        {!isNativeApp() && <p className="mt-2 flex gap-1.5 rounded-xl bg-blue-50 p-2.5 text-[11px] leading-4 text-blue-800"><Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>Manage in Android app.</strong> Push registration is available in GridVision mobile; device details remain available in My Profile.</span></p>}
      </Section>

      <Section title="Storage" icon={<HardDrive className="h-4 w-4 text-emerald-600" />}>
        <Row label="Local storage health" value={storageHealth.level === 'UNAVAILABLE' ? 'Unavailable' : storageHealth.level.charAt(0) + storageHealth.level.slice(1).toLowerCase()} valueClass={storageTone} />
        <Row label="Used" value={storageUsage} />
        {storageHealth.persisted !== null ? <Row label="Browser storage" value={storageHealth.persisted ? 'Persistent' : 'Best effort'} /> : null}
        <Row label="Pending Sync" value={`${queueHealth.pending} record${queueHealth.pending === 1 ? '' : 's'}`} />
        <Row label="Needs Attention" value={`${queueHealth.needsAttention} record${queueHealth.needsAttention === 1 ? '' : 's'}`} valueClass={queueHealth.needsAttention ? 'text-red-700' : 'text-slate-700'} />
        <Row label="Unsaved drafts" value={String(draftInventory.total)} />
        <Row label="Cached operational views" value={String(cachedViewCount)} />
        {draftInventory.veryOld > 0 ? <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[11px] font-medium text-amber-800">{draftInventory.veryOld} draft{draftInventory.veryOld === 1 ? ' is' : 's are'} more than 7 days old. Drafts are never removed automatically.</p> : null}
        {storageHealth.level === 'HIGH' ? <p role="alert" className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[11px] font-medium text-amber-900">Local device storage is becoming limited. GridVision can safely remove old cached views while preserving operational records.</p> : null}
        {storageHealth.level === 'CRITICAL' ? <p role="alert" className="mt-2 rounded-xl bg-red-50 p-2.5 text-[11px] font-medium text-red-800">Device storage is critically low. Pending operational data is still protected, but new offline saves may fail if storage becomes exhausted.</p> : null}
        {lastCleanup ? <Row label="Last safe cleanup" value={`${lastCleanup.count} item${lastCleanup.count === 1 ? '' : 's'}`} /> : null}
        <Row label="Cache last cleared" value={lastCleared} />
        <button type="button" onClick={() => setConfirmClear(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:border-amber-200 lg:bg-amber-50/50 lg:font-semibold lg:text-amber-800 lg:hover:bg-amber-50 lg:focus-visible:outline-amber-600"><Trash2 className="h-4 w-4" />Clear local cache</button>
        <p className="mt-2 text-[11px] text-slate-500">Removes cached lookups only. Pending changes remain safely in the sync queue.</p>
        <p className="mt-1 text-[11px] text-slate-500">Cached operational views help GridVision remain useful offline. Unsaved entry drafts are stored separately and are not removed.</p>
      </Section>

      <Section title="App Information" icon={<Info className="h-4 w-4 text-sky-600" />}><Row label="Version" value={appVersion} /><Row label="Mode" value={mode} /><Row label="Platform" value={getPlatformName()} /></Section>
      <Section title="Diagnostics & Support" icon={<Activity className="h-4 w-4 text-blue-600" />}>
        <Row label="Connectivity" value={online ? 'Online' : 'Offline'} valueClass={online ? 'text-emerald-700' : 'text-amber-700'} />
        <Row label="Access verification" value={authorizationLabel} />
        <Row label="Last sync" value={diagnosticSyncLabel} />
        <Row label="Pending Sync" value={String(queueHealth.pending)} />
        <Row label="Needs Attention" value={String(queueHealth.needsAttention)} valueClass={queueHealth.needsAttention ? 'text-red-700' : 'text-slate-700'} />
        <Row label="Storage health" value={storageLabel} valueClass={storageTone} />
        <Row label="Push notifications" value={notificationDeviceLabel} />
        <button type="button" onClick={() => setDiagnosticsOpen(true)} disabled={!diagnostics} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-40"><Activity className="h-4 w-4" />View Diagnostics</button>
      </Section>
      <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400 lg:col-span-2"><Shield className="h-3 w-3" />Row-level security · Encrypted in transit</div>
    </div></DesktopPageContainer></PageBody>

    {confirmClear && <ClearCacheDialog onCancel={() => setConfirmClear(false)} onConfirm={handleClearCache} />}
    {syncDetailsOpen && <SyncDetailsDialog operations={queueOperations} stations={stations} feeders={feeders} online={online} retryingId={retryingOperationId} onRetry={(operation) => void handleRetryOperation(operation)} onReview={onReviewOperation} onKeep={() => flash('Record kept safely in the sync queue')} onClose={() => setSyncDetailsOpen(false)} />}
    {diagnosticsOpen && diagnostics && <DiagnosticsDialog diagnostics={diagnostics} online={online} appVersion={appVersion} mode={mode} platform={getPlatformName()} queueHealth={queueHealth} storageHealth={storageHealth} storageUsage={storageUsage} lastDurableWriteAt={lastDurableWriteAt} drafts={draftInventory} cachedViews={cachedViewCount} notificationPermission={permissionLabel(notificationPermission)} notificationDevice={notificationDeviceLabel} onCopy={() => void copyDiagnostics()} onClose={() => setDiagnosticsOpen(false)} />}
    {toast && <div role="status" aria-live="polite" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-center text-xs font-medium text-white shadow-lg lg:bottom-6">{toast}</div>}
  </Screen>;
}

function queueOperationLabel(operation: QueuedOp): string {
  const labels: Partial<Record<QueuedOp['operationType'], string>> = {
    ADD_LOG_ENTRY: 'Parameter entry', UPDATE_LOG_ENTRY: 'Parameter entry update', ADD_STATION_CONDITION: 'Station condition',
    ADD_INTERRUPTION: 'Interruption trip', RESTORE_INTERRUPTION: 'Interruption restore', UPDATE_INTERRUPTION_ETR: 'Interruption ETR update',
    GENERIC_POST: 'Pending record', GENERIC_PATCH: 'Pending update', GENERIC_DELETE: 'Pending removal',
  };
  return labels[operation.operationType] ?? 'Pending operation';
}

function operationBody(operation: QueuedOp): Record<string, unknown> {
  return operation.body && typeof operation.body === 'object' && !Array.isArray(operation.body)
    ? operation.body as Record<string, unknown> : {};
}

function queueAge(timestamp: number): { label: string; tone: string } {
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours >= 72) return { label: `${Math.floor(hours / 24)} days old`, tone: 'text-red-700 bg-red-50' };
  if (hours >= 24) return { label: `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''} old`, tone: 'text-amber-700 bg-amber-50' };
  return { label: hours ? `${hours} hour${hours === 1 ? '' : 's'} old` : 'Recently saved', tone: 'text-slate-600 bg-slate-100' };
}

function DiagnosticsDialog({ diagnostics, online, appVersion, mode, platform, queueHealth, storageHealth, storageUsage, lastDurableWriteAt, drafts, cachedViews, notificationPermission, notificationDevice, onCopy, onClose }: {
  diagnostics: DiagnosticSummary; online: boolean; appVersion: string; mode: string; platform: string; queueHealth: QueueHealth;
  storageHealth: StorageHealth; storageUsage: string; lastDurableWriteAt: number | null; drafts: DraftInventory; cachedViews: number;
  notificationPermission: string; notificationDevice: string; onCopy: () => void; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  const exact = (value: string | number | null) => value == null ? 'Not available' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(typeof value === 'number' ? value : Date.parse(value));
  const relative = (value: string | number | null) => {
    if (value == null) return 'Not available';
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
  const authorization = diagnostics.authorizationStatus === 'VERIFIED' ? `Verified ${relative(diagnostics.authorizationVerifiedAt)}` : diagnostics.authorizationStatus === 'REVOKED' ? 'Access changed' : diagnostics.authorizationStatus === 'TEMPORARILY_UNAVAILABLE' ? 'Temporarily unavailable' : diagnostics.authorizationStatus === 'REQUIRES_RECONNECTION' ? 'Requires reconnection' : 'Not verified';
  const syncResult = diagnostics.lastSyncResult === 'SUCCESS' ? `${diagnostics.lastSyncSucceeded} synchronized` : diagnostics.lastSyncResult === 'PARTIAL' ? `${diagnostics.lastSyncSucceeded} synchronized · ${diagnostics.lastSyncFailed} needs attention` : diagnostics.lastSyncResult === 'FAILED' ? (diagnostics.dominantFailureCategory ? friendlyFailureCategory(diagnostics.dominantFailureCategory) : 'Could not synchronize') : diagnostics.lastSyncResult === 'NO_CHANGES' ? 'No pending changes' : 'Not yet attempted';
  const healthLabel = storageHealth.level === 'UNAVAILABLE' ? 'Unavailable' : storageHealth.level.charAt(0) + storageHealth.level.slice(1).toLowerCase();
  return <div className="fixed inset-0 z-[75] bg-slate-950/50 lg:grid lg:place-items-center lg:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="diagnostics-title" className="flex h-full w-full flex-col bg-slate-50 lg:h-auto lg:max-h-[88vh] lg:max-w-4xl lg:rounded-2xl lg:shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] lg:rounded-t-2xl lg:p-5"><div><h2 id="diagnostics-title" className="text-lg font-bold text-slate-900">Diagnostics & Support</h2><p className="text-xs text-slate-500">Privacy-safe local application health</p></div><button ref={closeRef} type="button" aria-label="Close diagnostics" onClick={onClose} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
      <div className="flex-1 overflow-y-auto p-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:p-5">
        <DiagnosticGroup title="Application"><Row label="Version" value={appVersion} /><Row label="Platform" value={platform} /><Row label="Runtime" value={mode} /><Row label="Generated" value={exact(Date.now())} /></DiagnosticGroup>
        <DiagnosticGroup title="Connectivity & Access"><Row label="Connectivity" value={online ? 'Online' : 'Offline'} valueClass={online ? 'text-emerald-700' : 'text-amber-700'} /><Row label="Backend" value={!online ? 'Not currently reachable' : diagnostics.backendStatus === 'REACHABLE' ? 'Reachable' : diagnostics.backendStatus === 'TEMPORARY_ISSUE' ? 'Temporary connection issue' : 'Not recently verified'} /><Row label="Access verification" value={authorization} /><Row label="Last verified" value={exact(diagnostics.authorizationVerifiedAt)} /></DiagnosticGroup>
        <DiagnosticGroup title="Synchronization"><Row label="Last attempt" value={exact(diagnostics.lastSyncAttemptAt)} /><Row label="Last successful sync" value={exact(diagnostics.lastSuccessfulSyncAt)} /><Row label="Result" value={syncResult} /><Row label="Pending Sync" value={String(queueHealth.pending)} /><Row label="Needs Attention" value={String(queueHealth.needsAttention)} valueClass={queueHealth.needsAttention ? 'text-red-700' : 'text-slate-700'} /><Row label="Oldest pending" value={queueHealth.oldestEnqueuedAt ? `${relative(queueHealth.oldestEnqueuedAt)} · ${exact(queueHealth.oldestEnqueuedAt)}` : 'None'} />{diagnostics.dominantFailureCategory ? <Row label="Most recent issue" value={friendlyFailureCategory(diagnostics.dominantFailureCategory)} /> : null}</DiagnosticGroup>
        <DiagnosticGroup title="Storage"><Row label="Health" value={healthLabel} /><Row label="Usage" value={storageUsage} /><Row label="Persistence" value={storageHealth.persisted === null ? 'Unavailable' : storageHealth.persisted ? 'Persistent' : 'Best effort'} /><Row label="Last successful write" value={exact(lastDurableWriteAt)} /><Row label="Last storage failure" value={exact(diagnostics.lastStorageFailureAt)} /><Row label="Last cache cleanup" value={exact(diagnostics.lastCacheCleanupAt)} /><Row label="Items removed" value={String(diagnostics.lastCacheCleanupCount)} /><Row label="Unsaved drafts" value={String(drafts.total)} /><Row label="Oldest draft" value={drafts.oldestUpdatedAt ? `${relative(drafts.oldestUpdatedAt)} · ${exact(drafts.oldestUpdatedAt)}` : 'None'} /><Row label="Cached operational views" value={String(cachedViews)} /></DiagnosticGroup>
        <DiagnosticGroup title="Notifications"><Row label="Permission" value={notificationPermission} /><Row label="Current device" value={notificationDevice} /></DiagnosticGroup>
      </div>
      <footer className="border-t border-slate-200 bg-white p-4 lg:rounded-b-2xl lg:p-5"><button type="button" onClick={onCopy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Copy className="h-4 w-4" />Copy Diagnostics</button><p className="mt-2 text-center text-[11px] text-slate-500">Contains statuses, counts, and timestamps only—no account identifiers, tokens, entry values, or remarks.</p></footer>
    </section>
  </div>;
}

function DiagnosticGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:mb-0"><h3 className="mb-2 text-sm font-bold text-slate-900">{title}</h3>{children}</section>;
}

function SyncDetailsDialog({ operations, stations, feeders, online, retryingId, onRetry, onReview, onKeep, onClose }: {
  operations: QueuedOp[];
  stations: Array<{ id: string; name: string }>;
  feeders: Array<{ id: string; name: string }>;
  online: boolean;
  retryingId: string | null;
  onRetry: (operation: QueuedOp) => void;
  onReview?: (operation: QueuedOp) => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  const visibleOperations = operations.slice(0, 200);
  const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const context = (operation: QueuedOp) => {
    const body = operationBody(operation);
    const station = stations.find((item) => item.id === body.station_id)?.name ?? 'Station unavailable in current scope';
    const feeder = feeders.find((item) => item.id === body.feeder_id)?.name;
    const eventValue = typeof operation.eventTime === 'string' ? operation.eventTime : typeof body.actual_event_time === 'string' ? body.actual_event_time : typeof body.interruption_start === 'string' ? body.interruption_start : null;
    const parsed = eventValue ? Date.parse(eventValue) : NaN;
    return { station, feeder, event: Number.isFinite(parsed) ? dateFormat.format(parsed) : 'Event time unavailable' };
  };
  const canReview = (operation: QueuedOp) => operation.table === 'log_book_entries' || operation.table === 'interruptions';

  const OperationActions = ({ operation }: { operation: QueuedOp }) => <div className="flex flex-wrap gap-2">
    <button type="button" disabled={!online || retryingId !== null} onClick={() => onRetry(operation)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><RotateCcw className={`h-3.5 w-3.5 ${retryingId === operation.id ? 'animate-spin' : ''}`} />Retry</button>
    {canReview(operation) && onReview ? <button type="button" onClick={() => onReview(operation)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Review Entry</button> : null}
    <button type="button" onClick={onKeep} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">Keep Pending</button>
  </div>;

  return <div className="fixed inset-0 z-[70] bg-slate-950/50 lg:grid lg:place-items-center lg:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="sync-details-title" className="flex h-full w-full flex-col bg-slate-50 lg:h-auto lg:max-h-[88vh] lg:max-w-6xl lg:rounded-2xl lg:shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] lg:rounded-t-2xl lg:p-5"><div><h2 id="sync-details-title" className="text-lg font-bold text-slate-900">Sync Details</h2><p className="text-xs text-slate-500">Pending operational records stored safely on this device</p></div><button ref={closeRef} type="button" aria-label="Close sync details" onClick={onClose} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
      <div className="flex-1 overflow-y-auto p-4 lg:p-5">
        {!visibleOperations.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No pending operations.</div> : null}
        <div className="space-y-3 lg:hidden">{visibleOperations.map((operation) => { const item = context(operation); const age = queueAge(operation.enqueuedAt); const attention = operation.syncState === 'NEEDS_ATTENTION'; return <article key={operation.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${attention ? 'border-red-200' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{queueOperationLabel(operation)}</h3><p className="mt-0.5 text-xs text-slate-500">{item.station}{item.feeder ? ` · ${item.feeder}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${attention ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{attention ? 'Needs Attention' : operation.failureCategory === 'DEPENDENCY' ? 'Waiting' : 'Pending Sync'}</span></div><p className="mt-2 text-xs text-slate-600">{item.event}</p><span className={`mt-2 inline-block rounded-full px-2 py-1 text-[10px] font-semibold ${age.tone}`}>{age.label}</span>{operation.lastError ? <p role="alert" className="mt-3 rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-700">{operation.lastError}</p> : null}<div className="mt-3"><OperationActions operation={operation} /></div></article>; })}</div>
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Operation</th><th className="px-4 py-3">Context</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleOperations.map((operation) => { const item = context(operation); const age = queueAge(operation.enqueuedAt); const attention = operation.syncState === 'NEEDS_ATTENTION'; return <tr key={operation.id} className="align-top"><td className="px-4 py-4"><strong className="text-slate-900">{queueOperationLabel(operation)}</strong><p className="mt-1 text-xs text-slate-500">{item.event}</p></td><td className="px-4 py-4 text-slate-700">{item.station}<p className="text-xs text-slate-500">{item.feeder}</p></td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${attention ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{attention ? 'Needs Attention' : operation.failureCategory === 'DEPENDENCY' ? 'Waiting' : 'Pending Sync'}</span><p className={`mt-2 w-max rounded-full px-2 py-1 text-[10px] ${age.tone}`}>{age.label}</p></td><td className="max-w-xs px-4 py-4 text-xs leading-5 text-slate-600">{operation.lastError ?? 'Waiting for the next synchronization.'}</td><td className="px-4 py-4"><OperationActions operation={operation} /></td></tr>; })}</tbody></table></div>
        {operations.length > visibleOperations.length ? <p className="mt-3 text-xs text-amber-700">Showing the oldest 200 operations. Synchronize or resolve these records to view the remainder.</p> : null}
      </div>
    </section>
  </div>;
}

function ClearCacheDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus(); };
  }, [onCancel]);

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="clear-cache-title" aria-describedby="clear-cache-description" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50"><Trash2 className="h-6 w-6 text-amber-600" /></span>
      <h2 id="clear-cache-title" className="mt-3 text-base font-bold text-slate-900">Clear local cache?</h2>
      <p id="clear-cache-description" className="mt-1 text-sm leading-6 text-slate-600">This removes downloaded and cached views. Pending operational records, unsaved drafts, and offline authorization scope are preserved.</p>
      <div className="mt-5 flex gap-2"><button ref={cancelRef} type="button" onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Cancel</button><button type="button" onClick={onConfirm} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600">Clear cache</button></div>
    </section>
  </div>;
}

function Section({ title, icon, children, ariaBusy }: { title: string; icon: React.ReactNode; children: React.ReactNode; ariaBusy?: boolean }) { return <section aria-busy={ariaBusy} className="rounded-2xl bg-white p-4 shadow-sm lg:border lg:border-slate-100 lg:p-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">{icon}{title}</h2>{children}</section>; }
function Row({ label, value, valueClass = 'text-slate-700' }: { label: string; value: string; valueClass?: string }) { return <div className="flex items-center justify-between gap-3 py-1 text-sm"><span className="text-slate-500">{label}</span><span className={`text-right font-medium ${valueClass}`}>{value}</span></div>; }
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) { return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${checked ? 'bg-blue-600' : 'bg-slate-300'} disabled:opacity-50`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} /></button>; }
