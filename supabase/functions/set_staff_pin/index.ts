import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hashPin, validatePin } from "../_shared/pin.ts";
import {
  getBearerToken,
  getSupabaseEnv,
  isClearlyNotAUserJwt,
  supabaseAdminClient,
  supabaseAuthClient,
} from "../_shared/supabase.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const env = getSupabaseEnv();
    const jwt = getBearerToken(req);

    // ✅ Reject anon-key auth (and service key)
    if (!jwt || isClearlyNotAUserJwt(jwt, env)) {
      return json(401, { error: "Missing or invalid user session" });
    }

    // ✅ Verify the token against Supabase Auth
    const userClient = supabaseAuthClient(env, jwt);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: "Invalid user session" });

    const admin = supabaseAdminClient(env);
    const { data: caller, error: callerErr } = await admin
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle();

    if (callerErr) return json(500, { error: "Failed to check caller role" });
    if (!caller || caller.active === false) return json(403, { error: "Account disabled" });
    if (caller.role !== "admin") return json(403, { error: "Admins only" });

    const body = await req.json().catch(() => ({} as any));
    const user_id = String(body?.user_id || "").trim();
    const pinRes = validatePin(body?.pin);

    if (!user_id) return json(400, { error: "Missing user_id" });
    if (!pinRes.ok) return json(400, { error: pinRes.reason });

    const hashed = await hashPin(pinRes.pin);
    const { error: upErr } = await admin.from("profile_secrets").upsert({
      id: user_id,
      ...hashed,
      updated_at: new Date().toISOString(),
    });

    if (upErr) {
      return json(500, { error: "PIN update failed", details: upErr.message });
    }

    // Best-effort: clear legacy pin_code
    await admin.from("profiles").update({ pin_code: null as any }).eq("id", user_id);

    return json(200, { success: true });
  } catch (e: any) {
    return json(500, { error: "Unhandled error", details: e?.message || String(e) });
  }
});

