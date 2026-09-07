import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, Cloud, CloudOff, HardDrive, Info, Loader2, RefreshCw, Shield, Smartphone, Trash2 } from 'lucide-react';
import { api, type NotificationDevice } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { useSettings, type NotificationPermissionState } from '@/hooks/useSettings';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';
import { getPlatformName, getRuntimeMode, isNativeApp } from '@/services/platform/runtime';

const permissionLabel = (permission: NotificationPermissionState) => ({ granted: 'Allowed', denied: 'Denied', prompt: 'Not requested', unsupported: 'Unsupported' }[permission]);

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { online, pending, queueError, flush } = useApp();
  const { settings, notificationPermission, requestNotificationPermission, disableNotifications, setSettings } = useSettings();
  const [devices, setDevices] = useState<NotificationDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notificationWorking, setNotificationWorking] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try { setDevices(await api.getMyNotificationDevices()); }
    catch (cause) { setDevicesError(cause instanceof Error ? cause.message : 'Could not load notification devices.'); }
    finally { setDevicesLoading(false); }
  }, []);
  useEffect(() => { void loadDevices(); }, [loadDevices]);
  useEffect(() => {
    const refreshDevices = () => { void loadDevices(); };
    window.addEventListener('fcm-token-received', refreshDevices);
    return () => window.removeEventListener('fcm-token-received', refreshDevices);
  }, [loadDevices]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

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
    finally { setSyncing(false); }
  };

  const handleClearCache = () => {
    try {
      Object.keys(localStorage).filter((key) => key.startsWith('gv_cache:')).forEach((key) => localStorage.removeItem(key));
      setSettings((current) => ({ ...current, cacheClearedAt: Date.now() }));
      setConfirmClear(false); flash('Local cache cleared');
    } catch { flash('Could not clear the local cache'); }
  };

  const activeDevices = devices.filter((device) => device.is_active).length;
  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'Development build';
  const mode = getRuntimeMode();
  const lastCleared = settings.cacheClearedAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(settings.cacheClearedAt) : 'Never';

  return <Screen showStatusBar={false}>
    <AppHeader title="Settings" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Settings" subtitle="Application preferences and notifications" />
    <PageBody className="lg:max-w-none lg:px-0 lg:py-0 lg:pb-10"><DesktopPageContainer width="wide"><div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0 lg:pt-6">
      <Section title="Connectivity & Sync" icon={online ? <Cloud className="h-4 w-4 text-emerald-600" /> : <CloudOff className="h-4 w-4 text-amber-600" />}>
        <Row label="Connection" value={online ? 'Online' : 'Offline'} valueClass={online ? 'text-emerald-700' : 'text-amber-700'} />
        <Row label="Pending changes" value={`${pending} item${pending === 1 ? '' : 's'}`} valueClass={pending ? 'text-amber-700' : 'text-slate-700'} />
        {queueError ? <p role="alert" className="mt-2 text-xs font-medium text-red-700">{queueError}</p> : null}
        <button type="button" onClick={() => void handleSync()} disabled={syncing || !online || pending === 0} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Syncing…' : !online ? 'Offline' : pending === 0 ? 'No pending changes' : 'Sync now'}</button>
      </Section>

      <Section title="Notifications" icon={<Bell className="h-4 w-4 text-amber-600" />} ariaBusy={devicesLoading}>
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">Push notifications</p><p className="text-[11px] text-slate-500">Outage and operating-limit alerts on this device</p></div><Toggle checked={settings.notificationsEnabled} onChange={() => void handleToggle()} disabled={notificationWorking || !isNativeApp()} label="Push notifications on this device" /></div>
        <div className="mt-3 border-t border-slate-100 pt-2"><Row label="Permission" value={permissionLabel(notificationPermission)} /><Row label="Local preference" value={settings.notificationsEnabled ? 'Enabled' : 'Disabled'} valueClass={settings.notificationsEnabled ? 'text-emerald-700' : 'text-slate-600'} /><Row label="Current device" value={settings.pushTokenRegistered ? 'Registered' : notificationWorking ? 'Updating…' : 'Not registered'} valueClass={settings.pushTokenRegistered ? 'text-emerald-700' : 'text-slate-600'} /><Row label="Active devices" value={devicesLoading ? 'Loading…' : devicesError ? 'Unavailable' : String(activeDevices)} /></div>
        {devicesLoading && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Refreshing device status…</p>}
        {devicesError && <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-red-50 p-2.5 text-[11px] leading-4 text-red-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="flex-1">{devicesError}</span><button type="button" onClick={() => void loadDevices()} className="font-bold text-red-800 underline">Retry</button></div>}
        {!isNativeApp() && <p className="mt-2 flex gap-1.5 rounded-xl bg-blue-50 p-2.5 text-[11px] leading-4 text-blue-800"><Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>Manage in Android app.</strong> Push registration is available in GridVision mobile; device details remain available in My Profile.</span></p>}
      </Section>

      <Section title="Storage" icon={<HardDrive className="h-4 w-4 text-emerald-600" />}>
        <Row label="Cache last cleared" value={lastCleared} />
        <button type="button" onClick={() => setConfirmClear(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:border-amber-200 lg:bg-amber-50/50 lg:font-semibold lg:text-amber-800 lg:hover:bg-amber-50 lg:focus-visible:outline-amber-600"><Trash2 className="h-4 w-4" />Clear local cache</button>
        <p className="mt-2 text-[11px] text-slate-500">Removes cached lookups only. Pending changes remain safely in the sync queue.</p>
      </Section>

      <Section title="App Information" icon={<Info className="h-4 w-4 text-sky-600" />}><Row label="Version" value={appVersion} /><Row label="Mode" value={mode} /><Row label="Platform" value={getPlatformName()} /></Section>
      <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400 lg:col-span-2"><Shield className="h-3 w-3" />Row-level security · Encrypted in transit</div>
    </div></DesktopPageContainer></PageBody>

    {confirmClear && <ClearCacheDialog onCancel={() => setConfirmClear(false)} onConfirm={handleClearCache} />}
    {toast && <div role="status" aria-live="polite" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-center text-xs font-medium text-white shadow-lg lg:bottom-6">{toast}</div>}
  </Screen>;
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
      <p id="clear-cache-description" className="mt-1 text-sm leading-6 text-slate-600">Cached lookups will be downloaded again when needed. Pending unsynced changes will not be removed.</p>
      <div className="mt-5 flex gap-2"><button ref={cancelRef} type="button" onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Cancel</button><button type="button" onClick={onConfirm} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600">Clear cache</button></div>
    </section>
  </div>;
}

function Section({ title, icon, children, ariaBusy }: { title: string; icon: React.ReactNode; children: React.ReactNode; ariaBusy?: boolean }) { return <section aria-busy={ariaBusy} className="rounded-2xl bg-white p-4 shadow-sm lg:border lg:border-slate-100 lg:p-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">{icon}{title}</h2>{children}</section>; }
function Row({ label, value, valueClass = 'text-slate-700' }: { label: string; value: string; valueClass?: string }) { return <div className="flex items-center justify-between gap-3 py-1 text-sm"><span className="text-slate-500">{label}</span><span className={`text-right font-medium ${valueClass}`}>{value}</span></div>; }
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) { return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${checked ? 'bg-blue-600' : 'bg-slate-300'} disabled:opacity-50`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} /></button>; }
