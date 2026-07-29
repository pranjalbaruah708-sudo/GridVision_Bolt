import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';

const SETTINGS_KEY = 'gv_settings';

export type AppSettings = {
  notificationsEnabled: boolean;
  pushTokenRegistered: boolean;
  theme: 'dark';
  cacheClearedAt: number | null;
};

const DEFAULT: AppSettings = {
  notificationsEnabled: false,
  pushTokenRegistered: false,
  theme: 'dark',
  cacheClearedAt: null,
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Mimic a permission request + registration token flow (placeholder).
  const requestNotificationPermission = useCallback(async (): Promise<'granted' | 'denied' | 'default'> => {
    if (typeof Notification === 'undefined') return 'denied';
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      // Generate a placeholder registration token
      const token = `gv-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      try {
        await api.registerPushToken(token);
      } catch {
        // network/offline — still flip the local flag; queued later
      }
      setSettings((s) => ({ ...s, notificationsEnabled: true, pushTokenRegistered: true }));
    } else {
      setSettings((s) => ({ ...s, notificationsEnabled: false }));
    }
    return perm;
  }, []);

  const disableNotifications = useCallback(() => {
    setSettings((s) => ({ ...s, notificationsEnabled: false }));
  }, []);

  return {
    settings,
    requestNotificationPermission,
    disableNotifications,
    setSettings,
  };
}
