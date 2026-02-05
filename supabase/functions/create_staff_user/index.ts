import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hashPassword, validatePassword } from "../_shared/password.ts";
import {
  getBearerToken,
  getSupabaseEnv,
  isClearlyNotAUserJwt,
  supabaseAdminClient,
  supabaseAuthClient,
} from "../_shared/supabase.ts";

function sanitizeUsername(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

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

    // ✅ Admin check
    const adminClient = supabaseAdminClient(env);
    const { data: caller, error: callerErr } = await adminClient
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle();

    if (callerErr) return json(500, { error: "Failed to check caller role" });
    if (!caller || caller.active === false) return json(403, { error: "Account disabled" });
    if (caller.role !== "admin") return json(403, { error: "Admins only" });

    const body = await req.json().catch(() => ({} as any));

    const username = sanitizeUsername(body?.username);
    const full_name = String(body?.full_name || "").trim();
    const role = (body?.role === "admin" ? "admin" : "cashier") as "admin" | "cashier";
    const permissions = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};

    const password = String(body?.password || "");
    const passRes = validatePassword(password);

    if (!username) return json(400, { error: "Username required" });
    if (username.length < 3) return json(400, { error: "Username must be 3+ characters" });
    if (!full_name) return json(400, { error: "Full name required" });
    if (!passRes.ok) return json(400, { error: passRes.reason });

    const email = `${username}@themasterspos.app`;

    // Create auth user
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: passRes.password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (createErr || !created.user) {
      return json(400, { error: createErr?.message ?? "User creation failed" });
    }

    // Create profile (NO password secrets stored in profiles)
    const { error: profileErr } = await adminClient.from("profiles").insert({
      id: created.user.id,
      username,
      full_name,
      role,
      permissions,
      active: true,
    });

    if (profileErr) {
      return json(400, { error: profileErr.message });
    }

    // Store hashed PASSWORD in profile_secrets (offline-first login)
    const passHash = await hashPassword(passRes.password);
    const { error: passErr } = await adminClient.from("profile_secrets").upsert({
      id: created.user.id,
      ...passHash,
      updated_at: new Date().toISOString(),
    });

    if (passErr) {
      return json(500, {
        error: "Password storage failed",
        details: passErr.message,
      });
    }

    // Best-effort: clear legacy pin_code if column exists
    await adminClient.from("profiles").update({ pin_code: null as any }).eq("id", created.user.id);

    return json(200, { success: true });
  } catch (e: any) {
    return json(500, { error: "Unhandled error", details: e?.message || String(e) });
  }
});
