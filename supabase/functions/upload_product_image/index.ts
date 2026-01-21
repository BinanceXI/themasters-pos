import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

    if (!SUPABASE_URL) return json(500, { error: "Missing SUPABASE_URL" });
    if (!SERVICE_ROLE_KEY) return json(500, { error: "Missing SERVICE_ROLE_KEY secret" });

    // ✅ Admin client (DO NOT use req Authorization header)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { fileName, contentType, base64 } = await req.json();

    if (!fileName || !base64) {
      return json(400, { error: "Missing fileName or base64" });
    }

    // ✅ Decode base64 -> bytes
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    // ✅ Safe filename
    const cleanName = String(fileName).replace(/[^\w.\-]/g, "_");
    const path = `products/${crypto.randomUUID()}-${cleanName}`;

    const { error: uploadError } = await admin.storage
      .from("product-images")
      .upload(path, bytes, {
        contentType: contentType || "image/png",
        upsert: true,
      });

    if (uploadError) {
      return json(500, { error: "Storage upload failed", details: uploadError.message });
    }

    const { data } = admin.storage.from("product-images").getPublicUrl(path);

    return json(200, { publicUrl: data.publicUrl, path });
  } catch (e: any) {
    return json(500, { error: "Unhandled error", details: e?.message || String(e) });
  }
});