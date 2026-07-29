import { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw, Trash2, Smartphone, Info, Cloud, CloudOff, Shield, ChevronRight } from 'lucide-react';
import { api } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/hooks/useSettings';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { online, pending, flush } = useApp();
  const { settings, requestNotificationPermission, disableNotifications } = useSettings();
  const [tokenCount, setTokenCount] = useState(0);
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      const t = await api.getPushTokens();
      setTokenCount(t.length);
    } catch {
      // offline — ignore
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const handleToggle = async () => {
    setWorking(true);
    try {
      if (settings.notificationsEnabled) {
        disableNotifications();
        flash('Notifications disabled');
      } else {
        const perm = await requestNotificationPermission();
        if (perm === 'granted') {
          flash('Notifications enabled — token registered');
          void loadTokens();
        } else {
          flash('Permission denied');
        }
      }
    } finally {
      setWorking(false);
    }
  };

  const handleSync = async () => {
    setWorking(true);
    try {
      const res = await flush();
      flash(res ? `Synced ${res.ok} item${res.ok === 1 ? '' : 's'}` : 'Up to date');
    } finally {
      setWorking(false);
    }
  };

  const handleClearCache = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('gv_cache:'))
        .forEach((k) => localStorage.removeItem(k));
      flash('Cache cleared');
    } catch {
      flash('Could not clear cache');
    }
  };

  return (
    <Screen>
      <AppHeader title="Settings" subtitle="App preferences" onBack={onBack} />
      <PageBody>
        <div className="space-y-4">
          {/* Connection */}
          <Section title="Connection" icon={<Cloud className="h-4 w-4 text-gray-500" />}>
            <Row label="Status" value={online ? 'Online' : 'Offline'} valueClass={online ? 'text-green-600' : 'text-amber-600'} />
            <Row label="Pending sync" value={`${pending} item${pending === 1 ? '' : 's'}`} valueClass={pending ? 'text-amber-600' : 'text-gray-700'} />
            <button
              onClick={handleSync}
              disabled={working || pending === 0}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${working ? 'animate-spin' : ''}`} />
              Sync Now
            </button>
          </Section>

          {/* Notifications */}
          <Section title="Notifications" icon={<Bell className="h-4 w-4 text-amber-500" />}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Enable Notifications</p>
                <p className="text-[11px] text-gray-500">
                  {settings.notificationsEnabled ? 'Active — token on file' : 'Get outage & overload alerts'}
                </p>
              </div>
              <Toggle checked={settings.notificationsEnabled} onChange={handleToggle} disabled={working} />
            </div>
            <Row label="Registered tokens" value={String(tokenCount)} />
          </Section>

          {/* Data */}
          <Section title="Data & Cache" icon={<Trash2 className="h-4 w-4 text-emerald-600" />}>
            <button
              onClick={handleClearCache}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <Trash2 className="h-4 w-4" />
              Clear Local Cache
            </button>
            <p className="mt-2 text-[11px] text-gray-400">
              Cached lookups serve data offline; pending writes stay in the sync queue.
            </p>
          </Section>

          {/* App */}
          <Section title="About" icon={<Info className="h-4 w-4 text-sky-600" />}>
            <Row label="Version" value="1.0.0" />
            <Row label="Mode" value="PWA · Standalone" />
            <Row label="Platform" value="Web" />
          </Section>

          <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-gray-400">
            <Shield className="h-3 w-3" />
            Row-level security · Encrypted in transit
          </div>
        </div>
      </PageBody>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </Screen>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">{icon}{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, valueClass = 'text-gray-700' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-gray-300'} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
