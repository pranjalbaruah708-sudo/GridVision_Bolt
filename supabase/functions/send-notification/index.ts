import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  HttpRequestError, allowedOrigins, corsHeadersFor, isIsoTimestamp, isUuid,
  jsonResponse, readJsonObject, rejectDisallowedOrigin,
} from "../_shared/httpSecurity.ts";

interface NotificationRequest {
  user_id: string;
  title: string;
  body: string;
  notification_class?: "LIVE" | "DELAYED_SYNC" | "HISTORICAL_SYNC";
  event_time?: string;
  source_recorded_at?: string;
  source_synced_at?: string;
  station_id?: string;
  feeder_id?: string;
  message?: string;
}

const MAX_REQUEST_BYTES = 16 * 1024;
const REQUEST_KEYS = new Set([
  "user_id", "title", "body", "notification_class", "event_time",
  "source_recorded_at", "source_synced_at", "station_id", "feeder_id", "message",
]);

function firebaseErrorCode(value: unknown): string {
  if (!value || typeof value !== "object") return "FCM_REQUEST_FAILED";
  const error = "error" in value && value.error && typeof value.error === "object"
    ? value.error as Record<string, unknown>
    : value as Record<string, unknown>;
  const status = typeof error.status === "string" && /^[A-Z0-9_]{1,80}$/.test(error.status)
    ? error.status
    : null;
  return status ?? "FCM_REQUEST_FAILED";
}

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

function presentationTitle(title: string, notificationClass?: NotificationRequest["notification_class"]): string {
  if (notificationClass === "DELAYED_SYNC" && !title.startsWith("Delayed Sync ·")) return `Delayed Sync · ${title}`;
  if (notificationClass === "HISTORICAL_SYNC" && !title.startsWith("Historical Sync ·")) return `Historical Sync · ${title}`;
  return title;
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
) {
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

  const jwt = `${unsignedToken}.${base64UrlEncode(
    new Uint8Array(signature),
  )}`;

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
    throw new Error("Firebase OAuth request failed");
  }

  return data.access_token as string;
}

Deno.serve(async (req) => {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

  const origins = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));
  const corsHeaders = corsHeadersFor(req, origins);
  const originError = rejectDisallowedOrigin(req, origins, corsHeaders);
  if (originError) return originError;

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405, { ...corsHeaders, Allow: "POST" });
  }

  try {
    // --------------------------------------------------
    // Environment variables
    // --------------------------------------------------

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")!;

    const supabaseServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseServiceRoleKey || !isServiceRoleRequest(req, supabaseServiceRoleKey)) {
      return jsonResponse({ success: false, error: "Unauthorised" }, 401, corsHeaders);
    }

    const firebaseProjectId =
      Deno.env.get("FIREBASE_PROJECT_ID")!;

    const firebaseClientEmail =
      Deno.env.get("FIREBASE_CLIENT_EMAIL")!;

    const firebasePrivateKey =
      Deno.env.get("FIREBASE_PRIVATE_KEY")!;

    // --------------------------------------------------
    // Supabase admin client
    // --------------------------------------------------

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );

    // --------------------------------------------------
    // Request body
    // --------------------------------------------------

    const parsedBody = await readJsonObject(req, MAX_REQUEST_BYTES);
    const requestBody = parsedBody as unknown as NotificationRequest;

    const {
      user_id,
      title,
      body,
      notification_class,
      event_time,
      source_recorded_at,
      source_synced_at,
      station_id,
      feeder_id,
      message,
    } = requestBody;

    if (
      typeof user_id !== "string" ||
      !isUuid(user_id) || Object.keys(parsedBody).some((key) => !REQUEST_KEYS.has(key)) ||
      typeof title !== "string" || title.trim().length < 1 || title.length > 160 ||
      typeof body !== "string" || body.trim().length < 1 || body.length > 2000 ||
      (notification_class !== undefined && !["LIVE", "DELAYED_SYNC", "HISTORICAL_SYNC"].includes(notification_class)) ||
      (event_time !== undefined && !isIsoTimestamp(event_time)) ||
      (source_recorded_at !== undefined && !isIsoTimestamp(source_recorded_at)) ||
      (source_synced_at !== undefined && !isIsoTimestamp(source_synced_at)) ||
      (station_id !== undefined && !isUuid(station_id)) ||
      (feeder_id !== undefined && !isUuid(feeder_id)) ||
      (message !== undefined && (typeof message !== "string" || message.length > 2000))
    ) {
      return jsonResponse({ success: false, error: "Invalid notification request" }, 400, corsHeaders);
    }

    const displayTitle = presentationTitle(title, notification_class);
    const showDisplayTitle = displayTitle.trim().toLocaleLowerCase() !== "gridvision notification";

    console.log("Looking for registered notification devices.");

    // --------------------------------------------------
    // Get active device tokens for target user
    // --------------------------------------------------

    const { data: devices, error: deviceError } =
      await supabaseAdmin
        .from("device_tokens")
        .select("id, fcm_token, platform")
        .eq("user_id", user_id)
        .eq("is_active", true);

    if (deviceError) {
      console.error("Device token query failed.");
      throw new Error("Unable to retrieve device tokens");
    }

    if (!devices || devices.length === 0) {
      return jsonResponse({ success: false, message: "No active device token found for this user" }, 404, corsHeaders);
    }

    console.log(
      `Found ${devices.length} device(s)`,
    );

    // --------------------------------------------------
    // Get Firebase OAuth access token
    // --------------------------------------------------

    const accessToken =
      await createFirebaseAccessToken(
        firebaseClientEmail,
        firebasePrivateKey,
      );

    // --------------------------------------------------
    // Send notification to every active device
    // --------------------------------------------------

    const results = [];

    for (const device of devices) {
      try {
        console.log("Sending notification to a registered device.");

        const firebaseResponse = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              message: {
                token: device.fcm_token,

                notification: {
                  ...(showDisplayTitle ? { title: displayTitle } : {}),
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
                  ...(showDisplayTitle ? { title: displayTitle } : {}),
                  body,
                  ...(notification_class ? { notification_class } : {}),
                  ...(event_time ? { event_time } : {}),
                  ...(source_recorded_at ? { source_recorded_at } : {}),
                  ...(source_synced_at ? { source_synced_at } : {}),
                  ...(station_id ? { station_id } : {}),
                  ...(feeder_id ? { feeder_id } : {}),
                  ...(message ? { message } : {}),
                },
              },
            }),
          },
        );

        const firebaseResult =
          await firebaseResponse.json();

        if (!firebaseResponse.ok) {
          const errorCode = firebaseErrorCode(firebaseResult);
          console.error("Firebase notification request failed:", errorCode);

          results.push({
            success: false,
            error_code: errorCode,
          });

          continue;
        }

        console.log("Notification sent successfully.");

        results.push({
          success: true,
        });
      } catch (error) {
        console.error("Notification delivery failed for a registered device.");

        results.push({
          success: false,
          error_code: error instanceof HttpRequestError ? "INVALID_REQUEST" : "DELIVERY_FAILED",
        });
      }
    }

    const successCount = results.filter(
      (r) => r.success,
    ).length;

    return jsonResponse({
      success: successCount > 0,
      message: `Notification sent to ${successCount} of ${devices.length} device(s)`,
      sent: successCount,
      failed: devices.length - successCount,
    }, 200, corsHeaders);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      return jsonResponse({ success: false, error: error.publicMessage }, error.status, corsHeaders);
    }
    console.error("Send notification function failed.");
    return jsonResponse({ success: false, error: "Unable to send notification" }, 500, corsHeaders);
  }
});
