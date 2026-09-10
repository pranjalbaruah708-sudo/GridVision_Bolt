import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    throw new Error(
      `Firebase OAuth error: ${JSON.stringify(data)}`,
    );
  }

  return data.access_token as string;
}

Deno.serve(async (req) => {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

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
    // --------------------------------------------------
    // Environment variables
    // --------------------------------------------------

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")!;

    const supabaseServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseServiceRoleKey || !isServiceRoleRequest(req, supabaseServiceRoleKey)) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_REQUEST_BYTES) {
      return new Response(JSON.stringify({ success: false, error: "Request is too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let requestBody: NotificationRequest;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
      requestBody = parsed as NotificationRequest;
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user_id) ||
      typeof title !== "string" || title.length < 1 || title.length > 160 ||
      typeof body !== "string" || body.length < 1 || body.length > 2000
    ) {
      return new Response(JSON.stringify({ success: false, error: "Invalid notification request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const displayTitle = presentationTitle(title, notification_class);
    const showDisplayTitle = displayTitle.trim().toLocaleLowerCase() !== "gridvision notification";

    if (!user_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "user_id is required",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

    if (!title || !body) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "title and body are required",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

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
      console.error(
        "Device token query error:",
        deviceError,
      );

      throw new Error(
        `Unable to retrieve device tokens: ${deviceError.message}`,
      );
    }

    if (!devices || devices.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "No active device token found for this user",
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
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
          console.error(
            "Firebase error:",
            firebaseResult,
          );

          results.push({
            device_id: device.id,
            success: false,
            error: firebaseResult,
          });

          continue;
        }

        console.log("Notification sent successfully.");

        results.push({
          device_id: device.id,
          success: true,
          firebase: firebaseResult,
        });
      } catch (error) {
        console.error(
          `Error sending to device ${device.id}:`,
          error,
        );

        results.push({
          device_id: device.id,
          success: false,
          error: String(error),
        });
      }
    }

    const successCount = results.filter(
      (r) => r.success,
    ).length;

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        message: `Notification sent to ${successCount} of ${devices.length} device(s)`,
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
      "Send notification function error:",
      error,
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: String(error),
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
