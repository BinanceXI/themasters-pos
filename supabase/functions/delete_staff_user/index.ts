import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("PROJECT_URL")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user_id } = await req.json();
    if (!user_id) return new Response("Missing user_id", { status: 400 });

    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) throw error;

    return Response.json({ success: true });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});