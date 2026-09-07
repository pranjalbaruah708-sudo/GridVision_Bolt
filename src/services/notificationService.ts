import { supabase } from '@/services/supabase';
import type {
  NotificationClass,
  OperationalEntryMode,
} from '@/types';

// ======================================================
// Notification hierarchy levels
// ======================================================

export type NotificationLevel =
  | 'SUB_DIVISION'
  | 'DIVISION'
  | 'CIRCLE'
  | 'ZONE'
  | 'REGION'
  | 'HQ';

// ======================================================
// Input for creating a notification
// ======================================================

export interface CreateNotificationParams {
  stationId: string;
  feederId?: string | null;
  message: string;
  maxUnitType: NotificationLevel;
  eventTime?: string;
}

// ======================================================
// Recipient returned by
// get_notification_recipients()
// ======================================================

export interface NotificationRecipient {
  user_id: string;
  full_name: string;
  email: string | null;
  org_unit_id: string;
  org_unit_name: string;
  org_unit_type: string;
  device_token_id: string;
  fcm_token: string;
  platform: string;
}

// ======================================================
// Result returned after notification creation
// ======================================================

export interface NotificationResult {
  event: {
    id: string;
    station_id: string;
    feeder_id: string | null;
    event_time: string;
    message: string;
    max_unit_type: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    notification_class?: NotificationClass | null;
    source_entry_mode?: OperationalEntryMode | null;
    source_recorded_at?: string | null;
    source_synced_at?: string | null;
    source_operation_id?: string | null;
  };

  recipients: NotificationRecipient[];
}

// ======================================================
// Create Notification
//
// This function:
//
// 1. Gets the authenticated user
// 2. Creates notification_events record
// 3. Resolves eligible recipients
// 4. Creates notification_recipients records
// 5. Leaves them in PENDING state
//
// FCM sending is deliberately handled separately.
// ======================================================

export async function createNotification(
  params: CreateNotificationParams
): Promise<NotificationResult> {
  const {
    stationId,
    feederId = null,
    message,
    maxUnitType,
    eventTime,
  } = params;

  // ==================================================
  // 1. Get currently authenticated user
  // ==================================================

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error(
      '❌ Error getting authenticated user:',
      userError
    );

    throw userError;
  }

  if (!user) {
    throw new Error(
      'User must be authenticated to create a notification.'
    );
  }

  // ==================================================
  // 2. Create notification event
  // ==================================================

  const {
    data: event,
    error: eventError,
  } = await supabase
    .from('notification_events')
    .insert({
      station_id: stationId,
      feeder_id: feederId,
      event_time:
        eventTime ?? new Date().toISOString(),
      message,
      max_unit_type: maxUnitType,
      created_by: user.id,
    })
    .select()
    .single();

  if (eventError) {
    console.error(
      '❌ Error creating notification event:',
      eventError
    );

    throw eventError;
  }

  if (!event) {
    throw new Error(
      'Notification event was created but no record was returned.'
    );
  }

  // ==================================================
  // 3. Resolve notification recipients
  //
  // IMPORTANT:
  // We explicitly use the TWO-PARAMETER function:
  //
  // get_notification_recipients(
  //     p_station_id,
  //     p_max_unit_type
  // )
  //
  // This allows each event to decide how far the
  // notification should travel in the hierarchy.
  // ==================================================

  const {
    data: recipients,
    error: recipientError,
  } = await supabase.rpc(
    'get_notification_recipients',
    {
      p_station_id: stationId,
      p_max_unit_type: maxUnitType,
    }
  );

  if (recipientError) {
    console.error(
      '❌ Error resolving notification recipients:',
      recipientError
    );

    throw recipientError;
  }

  const resolvedRecipients =
    (recipients ?? []) as NotificationRecipient[];

  // ==================================================
  // 4. No recipients
  //
  // The event has already been created, so we do NOT
  // delete it merely because there are currently no
  // active devices.
  // ==================================================

  if (resolvedRecipients.length === 0) {
    return {
      event,
      recipients: [],
    };
  }

  // ==================================================
  // 5. Create notification recipient records
  //
  // Each returned device gets its own recipient record.
  //
  // This is intentional because one officer may have
  // multiple active devices.
  // ==================================================

  const recipientRows =
    resolvedRecipients.map((recipient) => ({
      notification_event_id: event.id,
      user_id: recipient.user_id,
      org_unit_id: recipient.org_unit_id,
      org_unit_name: recipient.org_unit_name,
      org_unit_type: recipient.org_unit_type,
      device_token_id: recipient.device_token_id,
      status: 'PENDING',
    }));

  const {
    data: insertedRecipients,
    error: insertError,
  } = await supabase
    .from('notification_recipients')
    .insert(recipientRows)
    .select();

  if (insertError) {
    console.error(
      '❌ Error creating notification recipient records:',
      insertError
    );

    throw insertError;
  }

const finalRecipients = insertedRecipients ?? [];

  // ==================================================
  // 6. Return event + recipients
  //
  // IMPORTANT:
  //
  // We DO NOT send FCM here.
  //
  // The next service/function will take the PENDING
  // recipients and perform the actual FCM delivery.
  // ==================================================

  return {
    event,
    recipients: finalRecipients,
  };
}
