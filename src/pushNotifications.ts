import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/services/supabase';

let pendingFcmToken: string | null = null;
let authListenerStarted = false;

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
      console.error(
        '❌ Error getting authenticated user:',
        userError
      );

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
      console.error(
        '❌ Error claiming FCM token:',
        error
      );

      // Keep it pending so it can be retried
      pendingFcmToken = token;
      return;
    }

    // Token has successfully been associated
    pendingFcmToken = null;

  } catch (error) {
    console.error(
      '❌ Unexpected error while saving FCM token:',
      error
    );

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
    console.error(
      '❌ Failed to deactivate device token:',
      error
    );

    throw error;
  }

}

// --------------------------------------------------
// Main push notification initialization
// --------------------------------------------------

export async function initPushNotifications() {
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

        window.dispatchEvent(
          new CustomEvent(
            'fcm-token-received',
            {
              detail: token.value,
            }
          )
        );

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
      (error) => {

        console.error(
          '========================================'
        );

        console.error(
          '❌ PUSH NOTIFICATION REGISTRATION ERROR'
        );

        console.error(
          error
        );

        console.error(
          '========================================'
        );
      }
    );

    // --------------------------------------------------
    // Notification received while app is open
    // --------------------------------------------------

    await PushNotifications.addListener(
      'pushNotificationReceived',
      () => undefined
    );

    // --------------------------------------------------
    // User tapped notification
    // --------------------------------------------------

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      () => undefined
    );

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

    // --------------------------------------------------
    // 5. REGISTER WITH FCM
    // --------------------------------------------------

    await PushNotifications.register();

  } catch (error) {

    console.error(
      '❌ Push notification initialization failed:',
      error
    );
  }
}
