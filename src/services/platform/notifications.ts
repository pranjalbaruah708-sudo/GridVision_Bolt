import { PushNotifications } from '@capacitor/push-notifications';
import { deactivateCurrentDeviceToken } from '@/pushNotifications';
import { isNativeApp } from './runtime';

export type PlatformNotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function readPlatformNotificationPermission(): Promise<PlatformNotificationPermission> {
  if (isNativeApp()) {
    const status = await PushNotifications.checkPermissions();
    return status.receive === 'granted' ? 'granted' : status.receive === 'denied' ? 'denied' : 'prompt';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function requestPlatformNotificationPermission(): Promise<PlatformNotificationPermission> {
  if (!isNativeApp()) {
    if (typeof Notification === 'undefined') return 'unsupported';
    const permission = await Notification.requestPermission();
    return permission === 'default' ? 'prompt' : permission;
  }

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
  }
  const state: PlatformNotificationPermission = permission.receive === 'granted' ? 'granted' : 'denied';
  return state;
}

export async function registerPlatformNotifications(): Promise<void> {
  if (isNativeApp()) await PushNotifications.register();
}

export async function disablePlatformNotifications(): Promise<void> {
  if (isNativeApp()) await deactivateCurrentDeviceToken();
}
