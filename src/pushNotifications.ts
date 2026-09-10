import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { supabase } from '@/services/supabase';
import { isAndroidApp } from '@/services/platform/runtime';

let pendingFcmToken: string | null = null;
let authListenerStarted = false;
let pushInitialization: Promise<void> | null = null;
export const GRIDVISION_NOTIFICATION_OPENED_EVENT = 'gv-notification-opened';
let pendingNotificationNavigation = false;
const FOREGROUND_CHANNEL_ID = 'gridvision_urgent';
const displayedForegroundNotifications = new Set<string>();
const FOREGROUND_DATA_KEYS = [
  'notification_event_id', 'station_id', 'feeder_id', 'max_unit_type',
  'event_time', 'message', 'notification_class', 'source_recorded_at', 'source_synced_at',
] as const;

function requestNotificationNavigation(): void {
  pendingNotificationNavigation = true;
  window.dispatchEvent(new Event(GRIDVISION_NOTIFICATION_OPENED_EVENT));
}

export function consumePendingNotificationNavigation(): boolean {
  if (!pendingNotificationNavigation) return false;
  pendingNotificationNavigation = false;
  return true;
}

function foregroundNotificationKey(notification: { id: string; title?: string; body?: string; data?: unknown }): string {
  const data = notification.data && typeof notification.data === 'object'
    ? notification.data as Record<string, unknown>
    : {};
  const eventId = typeof data.notification_event_id === 'string' ? data.notification_event_id : '';
  return notification.id || eventId || `${notification.title ?? ''}|${notification.body ?? ''}`;
}

function foregroundNotificationId(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = ((hash * 31) + key.charCodeAt(index)) | 0;
  return hash === -2147483648 ? 2147483647 : Math.abs(hash) || 1;
}

function safeForegroundExtra(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const source = data as Record<string, unknown>;
  return Object.fromEntries(FOREGROUND_DATA_KEYS.flatMap((key) => {
    const value = source[key];
    return typeof value === 'string' && value.length <= 500 ? [[key, value]] : [];
  }));
}

async function displayForegroundNotification(notification: { id: string; title?: string; body?: string; data?: unknown }): Promise<void> {
  if (!isAndroidApp()) return;
  const key = foregroundNotificationKey(notification);
  if (displayedForegroundNotifications.has(key)) return;
  displayedForegroundNotifications.add(key);
  if (displayedForegroundNotifications.size > 100) {
    const oldest = displayedForegroundNotifications.values().next().value;
    if (oldest) displayedForegroundNotifications.delete(oldest);
  }

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      displayedForegroundNotifications.delete(key);
      return;
    }
    const incomingTitle = notification.title?.trim() ?? '';
    const incomingBody = notification.body?.trim() ?? '';
    const hasGenericTitle = !incomingTitle || incomingTitle.toLocaleLowerCase() === 'gridvision notification';
    await LocalNotifications.schedule({ notifications: [{
      id: foregroundNotificationId(key),
      title: hasGenericTitle ? incomingBody || 'GridVision' : incomingTitle,
      body: hasGenericTitle ? '' : incomingBody,
      largeBody: hasGenericTitle ? undefined : incomingBody || undefined,
      channelId: FOREGROUND_CHANNEL_ID,
      extra: safeForegroundExtra(notification.data),
    }] });
  } catch {
    displayedForegroundNotifications.delete(key);
    console.error('A foreground notification could not be displayed.');
  }
}

// --------------------------------------------------
// Save / claim FCM token to Supabase
// --------------------------------------------------

async function saveFcmTokenToSupabase(token: string) {
  try {
    // --------------------------------------------------
    // Get currently authenticated Supabase user
    // --------------------------------------------------

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('Push notification registration could not verify the signed-in user.');

      // Keep token so it can be saved after login
      pendingFcmToken = token;
      return;
    }

    if (!user) {
      pendingFcmToken = token;
      return;
    }

    // --------------------------------------------------
    // Claim token through secure database function
    // --------------------------------------------------

    const { error } = await supabase.rpc(
      'claim_device_token',
      {
        p_fcm_token: token,
        p_platform: 'android',
      }
    );

    if (error) {
      console.error('Push notification device registration could not be completed.');

      // Keep it pending so it can be retried
      pendingFcmToken = token;
      return;
    }

    // Token has successfully been associated
    pendingFcmToken = null;

  } catch {
    console.error('Push notification device registration encountered an unexpected error.');

    pendingFcmToken = token;
  }
}

// --------------------------------------------------
// Listen for Supabase authentication changes
// --------------------------------------------------

function startAuthListener() {
  // Prevent duplicate listeners
  if (authListenerStarted) {
    return;
  }

  authListenerStarted = true;

  supabase.auth.onAuthStateChange(
    async (event, session) => {

      // --------------------------------------------------
      // User has successfully logged in
      // --------------------------------------------------

      if (
        event === 'SIGNED_IN' &&
        session?.user
      ) {
        // --------------------------------------------------
        // Find existing FCM token
        // --------------------------------------------------

        let token = pendingFcmToken;

        if (!token) {
          token = localStorage.getItem(
            'gridvision_fcm_token'
          );
        }

        if (token) {
          await saveFcmTokenToSupabase(token);
        }
      }

      // --------------------------------------------------
      // User logged out
      // --------------------------------------------------

      if (event === 'SIGNED_OUT') {
        /*
         * IMPORTANT:
         *
         * Do NOT remove the FCM token from localStorage.
         *
         * The same physical device may subsequently
         * be used by another user.
         *
         * When the next user signs in, the token will be
         * claimed again through claim_device_token().
         */
      }
    }
  );
}

export async function deactivateCurrentDeviceToken() {
  const token = localStorage.getItem(
    'gridvision_fcm_token'
  );

  if (!token) {
    return;
  }

  const { error } = await supabase.rpc(
    'deactivate_current_device_token',
    {
      p_fcm_token: token,
    }
  );

  if (error) {
    console.error('The current push notification device could not be deactivated.');

    throw error;
  }

}

// --------------------------------------------------
// Main push notification initialization
// --------------------------------------------------

export function initPushNotifications(): Promise<void> {
  pushInitialization ??= initializePushNotifications();
  return pushInitialization;
}

async function initializePushNotifications(): Promise<void> {
  try {

    // --------------------------------------------------
    // 1. Start authentication listener FIRST
    // --------------------------------------------------

    startAuthListener();

    // --------------------------------------------------
    // 2. REGISTER ALL PUSH LISTENERS
    // --------------------------------------------------

    // --------------------------------------------------
    // FCM registration
    // --------------------------------------------------

    await PushNotifications.addListener(
      'registration',
      async (token) => {
        // --------------------------------------------------
        // Save token locally
        // --------------------------------------------------

        localStorage.setItem(
          'gridvision_fcm_token',
          token.value
        );

        // --------------------------------------------------
        // Keep token available
        // --------------------------------------------------

        pendingFcmToken = token.value;

        // --------------------------------------------------
        // Notify application
        // --------------------------------------------------

        window.dispatchEvent(new Event('fcm-token-received'));

        // --------------------------------------------------
        // Try to associate token immediately
        //
        // If nobody is logged in yet, the function will
        // keep the token pending.
        // --------------------------------------------------

        await saveFcmTokenToSupabase(
          token.value
        );
      }
    );

    // --------------------------------------------------
    // FCM registration error
    // --------------------------------------------------

    await PushNotifications.addListener(
      'registrationError',
      () => {
        console.error('Push notification registration failed.');
      }
    );

    // --------------------------------------------------
    // Notification received while app is open
    // --------------------------------------------------

    await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        void displayForegroundNotification(notification);
      }
    );

    // --------------------------------------------------
    // User tapped notification
    // --------------------------------------------------

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      () => requestNotificationNavigation()
    );

    if (isAndroidApp()) {
      // Tapping a local notification opens/resumes GridVision, matching the
      // current push-action behavior. No second routing system is introduced.
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        () => requestNotificationNavigation()
      );
    }

    // --------------------------------------------------
    // 3. CHECK PERMISSION
    // --------------------------------------------------

    let permissionStatus =
      await PushNotifications.checkPermissions();

    // --------------------------------------------------
    // 4. REQUEST PERMISSION IF NECESSARY
    // --------------------------------------------------

    if (
      permissionStatus.receive === 'prompt'
    ) {

      permissionStatus =
        await PushNotifications.requestPermissions();

    }

    // --------------------------------------------------
    // Permission denied
    // --------------------------------------------------

    if (
      permissionStatus.receive !== 'granted'
    ) {

      console.warn(
        '⚠️ Push notification permission was not granted'
      );

      return;
    }

    if (isAndroidApp()) {
      const localPermission = await LocalNotifications.checkPermissions();
      if (localPermission.display !== 'granted') {
        console.warn('Local notification display permission is unavailable.');
      } else {
        await LocalNotifications.createChannel({
          id: FOREGROUND_CHANNEL_ID,
          name: 'GridVision Operational Alerts',
          description: 'Important GridVision operational notifications',
          importance: 5,
          visibility: 1,
          vibration: true,
        });
      }
    }

    // --------------------------------------------------
    // 5. REGISTER WITH FCM
    // --------------------------------------------------

    await PushNotifications.register();

  } catch {
    console.error('Push notification initialization failed.');
  }
}
