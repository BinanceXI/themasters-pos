import { createClient } from "@supabase/supabase-js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function findUserByEmail(admin, email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const hit = users.find((u) => String(u?.email || "").trim().toLowerCase() === target);
    if (hit) return hit;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
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

  let userId = null;
  let createdNew = false;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (!createErr && created?.user?.id) {
    userId = created.user.id;
    createdNew = true;
  } else {
    const msg = String(createErr?.message || "");
    // If the user already exists, treat this script as a password reset / metadata update.
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
      const existing = await findUserByEmail(admin, email);
      if (!existing?.id) throw new Error("Platform admin exists but could not be found by email");
      userId = existing.id;

      const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (updateErr) throw updateErr;
    } else {
      throw new Error(createErr?.message || "Auth user creation failed");
    }
  }

  if (!userId) throw new Error("Missing admin user id");

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

  console.log(`${createdNew ? "Platform admin created" : "Platform admin updated"}: ${email} (${userId})`);
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});
