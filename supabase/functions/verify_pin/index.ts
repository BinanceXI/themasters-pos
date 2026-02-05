import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hashPin, validatePin, verifyPin } from "../_shared/pin.ts";
import {
  getSupabaseEnv,
  supabaseAdminClient,
} from "../_shared/supabase.ts";

function sanitizeUsername(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

type ProfileRow = {
  id: string;
  username: string;
  full_name: string | null;
  role: "admin" | "cashier" | string | null;
  permissions: any;
  active: boolean | null;
};

type SecretRow = {
  pin_salt: string;
  pin_hash: string;
  pin_iter: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const env = getSupabaseEnv();

    const body = await req.json().catch(() => ({} as any));
    const username = sanitizeUsername(body?.username);
    const pinRes = validatePin(body?.pin);

    if (!username) return json(400, { error: "Username required" });
    if (!pinRes.ok) return json(400, { error: pinRes.reason });

    const admin = supabaseAdminClient(env);

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, username, full_name, role, permissions, active")
      .eq("username", username)
      .maybeSingle();

    if (profErr) return json(500, { error: "Profile lookup failed" });
    if (!profile) return json(401, { error: "Invalid credentials" });

    const p = profile as ProfileRow;
    if (p.active === false) return json(403, { error: "Account disabled" });

    let ok = false;

    // Prefer hashed PINs in profile_secrets
    const { data: secret, error: secErr } = await admin
      .from("profile_secrets")
      .select("pin_salt, pin_hash, pin_iter")
      .eq("id", p.id)
      .maybeSingle();

    if (secErr) {
      return json(500, {
        error: "PIN store not configured",
        details: secErr.message,
      });
    }

    if (secret) {
      ok = await verifyPin(pinRes.pin, secret as SecretRow);
    } else {
      // Legacy migration path: read plaintext pin_code (service role only), then upgrade to hash.
      const { data: legacy, error: legacyErr } = await admin
        .from("profiles")
        .select("pin_code")
        .eq("id", p.id)
        .maybeSingle();

      if (legacyErr || !legacy?.pin_code) return json(401, { error: "Invalid credentials" });
      if (String(legacy.pin_code) !== pinRes.pin) return json(401, { error: "Invalid credentials" });

      ok = true;

      const hashed = await hashPin(pinRes.pin);
      await admin.from("profile_secrets").upsert({
        id: p.id,
        ...hashed,
        updated_at: new Date().toISOString(),
      });

      // Best-effort: clear legacy pin_code
      await admin.from("profiles").update({ pin_code: null as any }).eq("id", p.id);
    }

    if (!ok) return json(401, { error: "Invalid credentials" });

    // ✅ Create a one-time magiclink token hash so the client can mint a real Supabase Auth session JWT
    const email = `${p.username}@themasterspos.app`;
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkErr || !link?.properties?.hashed_token) {
      return json(500, {
        error: "Failed to create session token",
        details: linkErr?.message || "missing hashed_token",
      });
    }

    return json(200, {
      ok: true,
      user: {
        id: p.id,
        username: p.username,
        full_name: p.full_name,
        role: p.role,
        permissions: p.permissions || {},
      },
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
  } catch (e: any) {
    return json(500, { error: "Unhandled error", details: e?.message || String(e) });
  }
});
