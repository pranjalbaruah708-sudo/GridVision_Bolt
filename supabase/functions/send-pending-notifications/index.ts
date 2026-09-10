import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PendingRecipient {
  id: string;
  notification_event_id: string;
  user_id: string;
  device_token_id: string;
  status: string;
}

interface NotificationEvent {
  id: string;
  station_id: string;
  feeder_id: string | null;
  event_time: string;
  message: string;
  max_unit_type: string;
  notification_class: "LIVE" | "DELAYED_SYNC" | "HISTORICAL_SYNC" | null;
  source_entry_mode: "ONLINE" | "OFFLINE" | null;
  source_recorded_at: string | null;
  source_synced_at: string | null;
}

const MAX_REQUEST_BYTES = 4 * 1024;

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isServiceRoleRequest(request: Request, serviceRoleKey: string): boolean {
  const authorization = request.headers.get("Authorization") ?? "";
  return constantTimeEqual(authorization, `Bearer ${serviceRoleKey}`);
}

function notificationTitle(event: NotificationEvent): string | null {
  if (!event.notification_class || event.notification_class === "LIVE") return null;
  const subject = /restored at/i.test(event.message)
    ? "Feeder Restored"
    : /tripped at/i.test(event.message)
      ? "Feeder Interruption"
      : "Operating Limit Alert";
  return `${event.notification_class === "DELAYED_SYNC" ? "Delayed Sync" : "Historical Sync"} · ${subject}`;
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";

  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function createFirebaseAccessToken(
  clientEmail: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
      }),
    ),
  );

  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope:
          "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const unsignedToken = `${header}.${payload}`;

  const keyData = pemToArrayBuffer(
    privateKey.replace(/\\n/g, "\n"),
  );

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64UrlEncode(
    new Uint8Array(signature),
  )}`;
}

async function getFirebaseAccessToken(
  clientEmail: string,
  privateKey: string,
): Promise<string> {
  const jwt = await createFirebaseAccessToken(
    clientEmail,
    privateKey,
  );

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Firebase OAuth error: ${JSON.stringify(data)}`,
    );
  }

  return data.access_token;
}

Deno.serve(async (req) => {
  // ==================================================
  // CORS
  // ==================================================

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Allow": "POST" },
    });
  }

  try {
    // ==================================================
    // Environment variables
    // ==================================================

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const supabaseServiceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const firebaseProjectId =
      Deno.env.get("FIREBASE_PROJECT_ID");

    const firebaseClientEmail =
      Deno.env.get(
        "FIREBASE_CLIENT_EMAIL",
      );

    const firebasePrivateKey =
      Deno.env.get(
        "FIREBASE_PRIVATE_KEY",
      );

    if (
      !supabaseUrl ||
      !supabaseServiceRoleKey ||
      !firebaseProjectId ||
      !firebaseClientEmail ||
      !firebasePrivateKey
    ) {
      throw new Error(
        "Required environment variables are missing.",
      );
    }

    if (!isServiceRoleRequest(req, supabaseServiceRoleKey)) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================================================
    // Supabase admin client
    // ==================================================

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );

    // ==================================================
    // Optional request body
    //
    // For now:
    //
    // {}
    //
    // processes all pending recipients.
    //
    // Later we can support:
    //
    // { "notification_event_id": "..." }
    // ==================================================

    let requestBody: {
      notification_event_id?: string;
    } = {};

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_REQUEST_BYTES) {
      return new Response(JSON.stringify({ success: false, error: "Request is too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
        const keys = Object.keys(parsed as Record<string, unknown>);
        if (keys.some((key) => key !== "notification_event_id")) throw new Error("Unexpected property");
        const notificationEventId = (parsed as Record<string, unknown>).notification_event_id;
        if (
          notificationEventId !== undefined &&
          (typeof notificationEventId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationEventId))
        ) throw new Error("Invalid notification event identifier");
        requestBody = notificationEventId === undefined ? {} : { notification_event_id: notificationEventId };
      } catch {
        return new Response(JSON.stringify({ success: false, error: "Invalid JSON request" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==================================================
    // Find pending notification recipients
    // ==================================================

    let recipientQuery = supabaseAdmin
      .from("notification_recipients")
      .select(
        `
        id,
        notification_event_id,
        user_id,
        device_token_id,
        status
        `,
      )
      .eq("status", "PENDING")
      .order("created_at", {
        ascending: true,
      })
      .limit(50);

    if (requestBody.notification_event_id) {
      recipientQuery =
        recipientQuery.eq(
          "notification_event_id",
          requestBody.notification_event_id,
        );
    }

    const {
      data: recipients,
      error: recipientError,
    } = await recipientQuery;

    if (recipientError) {
      throw new Error(
        `Unable to retrieve pending recipients: ${recipientError.message}`,
      );
    }

    if (!recipients || recipients.length === 0) {
      console.log(
        "No pending notification recipients found.",
      );

      return new Response(
        JSON.stringify({
          success: true,
          message:
            "No pending notifications found.",
          processed: 0,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

    console.log(
      `Found ${recipients.length} pending recipient(s).`,
    );

    // ==================================================
    // Firebase OAuth token
    // ==================================================

    const accessToken =
      await getFirebaseAccessToken(
        firebaseClientEmail,
        firebasePrivateKey,
      );

    const results = [];

    // ==================================================
    // Process each recipient
    // ==================================================

    for (const recipient of recipients as PendingRecipient[]) {
      try {
        console.log("Processing a pending notification recipient.");

        // ----------------------------------------------
        // Get notification event
        // ----------------------------------------------

        const {
          data: event,
          error: eventError,
        } = await supabaseAdmin
          .from("notification_events")
          .select(
            `
            id,
            station_id,
            feeder_id,
            event_time,
            message,
            max_unit_type,
            notification_class,
            source_entry_mode,
            source_recorded_at,
            source_synced_at
            `,
          )
          .eq(
            "id",
            recipient.notification_event_id,
          )
          .single();

        if (eventError || !event) {
          throw new Error(
            `Notification event not found: ${
              eventError?.message ??
              recipient.notification_event_id
            }`,
          );
        }

        // ----------------------------------------------
        // Get device token
        // ----------------------------------------------

        const {
          data: device,
          error: deviceError,
        } = await supabaseAdmin
          .from("device_tokens")
          .select(
            "id, fcm_token, platform",
          )
          .eq(
            "id",
            recipient.device_token_id,
          )
          .eq("is_active", true)
          .single();

        if (deviceError || !device) {
          throw new Error(
            `Active device token not found: ${
              deviceError?.message ??
              recipient.device_token_id
            }`,
          );
        }

        // ----------------------------------------------
        // Send FCM notification
        // ----------------------------------------------

        const title = notificationTitle(event as NotificationEvent);

        const body = event.message;

        console.log("Sending an FCM notification to a registered device.");

        const firebaseResponse =
          await fetch(
            `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
            {
              method: "POST",
              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                message: {
                  token: device.fcm_token,

                notification: {
                  ...(title ? { title } : {}),
                  body,
                  },

                  android: {
                    priority: "high",
                    notification: {
                    sound: "default",
                    channel_id:
                      "gridvision_urgent",
                    },
                  },

                data: {
                  ...(title ? { title } : {}),
                    notification_event_id:
                      event.id,

                    station_id:
                      event.station_id,

                    feeder_id:
                      event.feeder_id ?? "",

                    max_unit_type:
                      event.max_unit_type,

                    event_time:
                      event.event_time,

                    message:
                      event.message,

                    notification_class:
                      event.notification_class ?? "LIVE",

                    source_entry_mode:
                      event.source_entry_mode ?? "",

                    source_recorded_at:
                      event.source_recorded_at ?? "",

                    source_synced_at:
                      event.source_synced_at ?? "",
                  },
                },
              }),
            },
          );

        const firebaseResult =
          await firebaseResponse.json();

        // ----------------------------------------------
        // FCM failure
        // ----------------------------------------------

        if (!firebaseResponse.ok) {
          const errorMessage =
            JSON.stringify(
              firebaseResult,
            );

          console.error(
            `FCM failed for recipient ${recipient.id}:`,
            errorMessage,
          );

          await supabaseAdmin
            .from(
              "notification_recipients",
            )
            .update({
              status: "FAILED",
              delivery_message:
                errorMessage,
            })
            .eq(
              "id",
              recipient.id,
            );

          results.push({
            recipient_id:
              recipient.id,

            success: false,

            error:
              firebaseResult,
          });

          continue;
        }

        // ----------------------------------------------
        // FCM success
        // ----------------------------------------------

        const sentAt =
          new Date().toISOString();

        await supabaseAdmin
          .from(
            "notification_recipients",
          )
          .update({
            status: "SENT",
            delivery_message:
              JSON.stringify(
                firebaseResult,
              ),
            sent_at: sentAt,
          })
          .eq(
            "id",
            recipient.id,
          );

        console.log("Notification sent successfully to its recipient.");

        results.push({
          recipient_id:
            recipient.id,

          success: true,

          firebase:
            firebaseResult,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          `❌ Error processing recipient ${recipient.id}:`,
          errorMessage,
        );

        await supabaseAdmin
          .from(
            "notification_recipients",
          )
          .update({
            status: "FAILED",
            delivery_message:
              errorMessage,
          })
          .eq(
            "id",
            recipient.id,
          );

        results.push({
          recipient_id:
            recipient.id,

          success: false,

          error:
            errorMessage,
        });
      }
    }

    // ==================================================
    // Final response
    // ==================================================

    const successCount =
      results.filter(
        (result) =>
          result.success,
      ).length;

    const failedCount =
      results.length -
      successCount;

    return new Response(
      JSON.stringify({
        success:
          failedCount === 0,

        processed:
          results.length,

        sent:
          successCount,

        failed:
          failedCount,

        results,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  } catch (error) {
    console.error(
      "Send pending notifications error:",
      error,
    );

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  }
});
