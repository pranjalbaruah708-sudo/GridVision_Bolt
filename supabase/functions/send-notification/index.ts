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

  try {
    // --------------------------------------------------
    // Environment variables
    // --------------------------------------------------

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")!;

    const supabaseServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const {
      user_id,
      title,
      body,
    }: NotificationRequest = await req.json();

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

    console.log(
      `Looking for device tokens for user: ${user_id}`,
    );

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
        console.log(
          `Sending notification to device ${device.id}`,
        );

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
                  title,
                  body,
                },

                android: {
                  priority: "high",
                  notification: {
                    sound: "default",
                    channel_id:
                      "default",
                  },
                },

                data: {
                  title,
                  body,
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

        console.log(
          `Notification sent successfully to device ${device.id}`,
        );

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