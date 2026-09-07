import { useCallback, useEffect, useState } from 'react';
import { disablePlatformNotifications, readPlatformNotificationPermission, registerPlatformNotifications, requestPlatformNotificationPermission, type PlatformNotificationPermission } from '@/services/platform/notifications';
import { isNativeApp } from '@/services/platform/runtime';

const SETTINGS_KEY = 'gv_settings';
const FCM_TOKEN_KEY = 'gridvision_fcm_token';

export type NotificationPermissionState = PlatformNotificationPermission;
export type AppSettings = { notificationsEnabled: boolean; pushTokenRegistered: boolean; cacheClearedAt: number | null };

const DEFAULT: AppSettings = { notificationsEnabled: false, pushTokenRegistered: false, cacheClearedAt: null };

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT;
    const stored = parsed as Record<string, unknown>;
    return {
      notificationsEnabled: stored.notificationsEnabled === true,
      pushTokenRegistered: stored.pushTokenRegistered === true,
      cacheClearedAt: typeof stored.cacheClearedAt === 'number' && Number.isFinite(stored.cacheClearedAt) ? stored.cacheClearedAt : null,
    };
  }
  catch { return DEFAULT; }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('prompt');

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* best-effort preference */ } }, [settings]);

  const refreshNotificationState = useCallback(async () => {
    const permission = await readPlatformNotificationPermission();
    const hasToken = Boolean(localStorage.getItem(FCM_TOKEN_KEY));
    setNotificationPermission(permission);
    setSettings((current) => ({ ...current, notificationsEnabled: permission === 'granted' && (isNativeApp() ? current.notificationsEnabled : false), pushTokenRegistered: isNativeApp() && hasToken && current.notificationsEnabled }));
    return permission;
  }, []);

  useEffect(() => {
    void refreshNotificationState();
    const onToken = () => setSettings((current) => ({ ...current, notificationsEnabled: true, pushTokenRegistered: true }));
    window.addEventListener('fcm-token-received', onToken);
    return () => window.removeEventListener('fcm-token-received', onToken);
  }, [refreshNotificationState]);

  const requestNotificationPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    const state = await requestPlatformNotificationPermission();
    setNotificationPermission(state);
    if (state === 'granted' && isNativeApp()) {
      setSettings((current) => ({ ...current, notificationsEnabled: true }));
      await registerPlatformNotifications();
    }
    return state;
  }, []);

  const disableNotifications = useCallback(async () => {
    await disablePlatformNotifications();
    setSettings((current) => ({ ...current, notificationsEnabled: false, pushTokenRegistered: false }));
  }, []);

  return { settings, notificationPermission, requestNotificationPermission, disableNotifications, refreshNotificationState, setSettings };
}
