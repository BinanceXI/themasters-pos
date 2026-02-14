import { createClient } from "@supabase/supabase-js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL/PROJECT_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY");

  const username = String(process.env.ADMIN_USERNAME || "tendainashe").trim().toLowerCase();
  const password = mustEnv("ADMIN_PASSWORD");
  const fullName = String(process.env.ADMIN_FULL_NAME || "Platform Admin").trim();

  const email = `${username}@binancexi-pos.app`;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created?.user?.id) {
    throw new Error(createErr?.message || "Auth user creation failed");
  }

  const userId = created.user.id;

  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      username,
      full_name: fullName,
      role: "platform_admin",
      permissions: {},
      active: true,
      business_id: null,
    },
    { onConflict: "id" }
  );
  if (profErr) throw new Error(profErr.message);

  console.log(`Platform admin created: ${email} (${userId})`);
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});
