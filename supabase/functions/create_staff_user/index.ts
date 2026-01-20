import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // ---- AUTH CHECK (who is calling) ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Missing Authorization header", { status: 401 });
    }

    const supabaseUrl = Deno.env.get("PROJECT_URL")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")!;

    // Client to read the caller (anon key not needed)
    const userClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response("Invalid user", { status: 401 });
    }

    // Check admin role
    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return new Response("Admins only", { status: 403 });
    }

    // ---- REQUEST BODY ----
    const {
      username,
      password,
      full_name,
      role,
      permissions,
      pin_code,
    } = await req.json();

    if (!username || !password || password.length < 6) {
      return new Response("Invalid input", { status: 400 });
    }

    const email = `${username}@themasterspos.app`;

    // ---- SERVICE ROLE CLIENT ----
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Create auth user
    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (createErr || !created.user) {
      return new Response(createErr?.message ?? "User creation failed", {
        status: 400,
      });
    }

    // Create profile
    const { error: profileErr } = await adminClient.from("profiles").insert({
      id: created.user.id,
      username,
      full_name,
      role: role || "cashier",
      permissions: permissions || {},
      pin_code: pin_code || null,
    });

    if (profileErr) {
      return new Response(profileErr.message, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});