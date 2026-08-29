import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/services/supabase';

let pendingFcmToken: string | null = null;
let authListenerStarted = false;

// --------------------------------------------------
// Save / claim FCM token to Supabase
// --------------------------------------------------

async function saveFcmTokenToSupabase(token: string) {
  console.log('🔄 Claiming FCM token for current user...');

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
      console.log(
        '⏳ No authenticated user yet. Token will be saved after login.'
      );

      pendingFcmToken = token;
      return;
    }

    console.log(
      '👤 Authenticated user:',
      user.id
    );

    // --------------------------------------------------
    // Claim token through secure database function
    // --------------------------------------------------

    const {
      data,
      error,
    } = await supabase.rpc(
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

    console.log(
      '✅ FCM token successfully associated with current user:',
      data
    );

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
    console.log(
      'ℹ️ Push authentication listener already started'
    );
    return;
  }

  authListenerStarted = true;

  console.log(
    '🔐 Starting push notification authentication listener...'
  );

  supabase.auth.onAuthStateChange(
    async (event, session) => {

      console.log(
        '🔐 Push notification auth event:',
        event
      );

      // --------------------------------------------------
      // User has successfully logged in
      // --------------------------------------------------

      if (
        event === 'SIGNED_IN' &&
        session?.user
      ) {
        console.log(
          '👤 User authenticated:',
          session.user.email
        );

        console.log(
          '🆔 Authenticated user ID:',
          session.user.id
        );

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
          console.log(
            '📱 FCM token available after login'
          );

          console.log(
            '🔄 Associating FCM token with newly logged-in user...'
          );

          await saveFcmTokenToSupabase(token);

        } else {
          console.log(
            '⚠️ No FCM token available after login'
          );
        }
      }

      // --------------------------------------------------
      // User logged out
      // --------------------------------------------------

      if (event === 'SIGNED_OUT') {
        console.log(
          '🚪 User signed out'
        );

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
    console.log(
      'ℹ️ No FCM token found. Nothing to deactivate.'
    );
    return;
  }

  console.log(
    '🚪 Deactivating FCM token before logout...'
  );

  const { data, error } = await supabase.rpc(
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

  console.log(
    '✅ Current device token deactivated:',
    data
  );
}

// --------------------------------------------------
// Main push notification initialization
// --------------------------------------------------

export async function initPushNotifications() {

  console.log(
    '🔔 Starting push notification initialization...'
  );

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

        console.log(
          '========================================'
        );

        console.log(
          '🎉 PUSH NOTIFICATION TOKEN RECEIVED'
        );

        console.log(
          '========================================'
        );

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
      (notification) => {

        console.log(
          '========================================'
        );

        console.log(
          '🔔 PUSH NOTIFICATION RECEIVED'
        );

        console.log(
          notification
        );

        console.log(
          '========================================'
        );
      }
    );

    // --------------------------------------------------
    // User tapped notification
    // --------------------------------------------------

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (notification) => {

        console.log(
          '========================================'
        );

        console.log(
          '👆 PUSH NOTIFICATION TAPPED'
        );

        console.log(
          notification
        );

        console.log(
          '========================================'
        );
      }
    );

    console.log(
      '✅ Push notification listeners registered'
    );

    // --------------------------------------------------
    // 3. CHECK PERMISSION
    // --------------------------------------------------

    let permissionStatus =
      await PushNotifications.checkPermissions();

    console.log(
      '📱 Push notification permission:',
      permissionStatus.receive
    );

    // --------------------------------------------------
    // 4. REQUEST PERMISSION IF NECESSARY
    // --------------------------------------------------

    if (
      permissionStatus.receive === 'prompt'
    ) {

      permissionStatus =
        await PushNotifications.requestPermissions();

      console.log(
        '📱 Permission after request:',
        permissionStatus.receive
      );
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

    console.log(
      '🚀 Calling PushNotifications.register()...'
    );

    await PushNotifications.register();

    console.log(
      '✅ PushNotifications.register() completed'
    );

  } catch (error) {

    console.error(
      '❌ Push notification initialization failed:',
      error
    );
  }
}
