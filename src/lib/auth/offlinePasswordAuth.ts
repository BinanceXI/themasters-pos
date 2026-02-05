import { hashPassword, verifyPassword } from "@/lib/auth/passwordKdf";
import { getLocalUser, upsertLocalUser, type LocalAuthUser } from "@/lib/auth/localUserStore";

export const sanitizeUsername = (raw: string) =>
  (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

export type RemoteUserProfile = {
  id: string;
  username: string;
  full_name: string | null;
  role: string | null;
  permissions: any;
  active?: boolean | null;
};

export type VerifyPasswordResponse =
  | {
      ok: true;
      user: RemoteUserProfile;
      token_hash: string;
      type: "magiclink";
    }
  | { ok: false; error: string; details?: string };

export async function verifyPasswordLocal(username: string, password: string): Promise<LocalAuthUser | null> {
  const u = sanitizeUsername(username);
  const p = String(password || "");
  if (!u || !p) return null;

  const stored = await getLocalUser(u);
  if (!stored) return null;
  if (stored.active === false) return null;

  const ok = await verifyPassword(p, stored.password);
  return ok ? stored : null;
}

export async function seedLocalUserFromPassword(profile: RemoteUserProfile, password: string): Promise<LocalAuthUser> {
  const username = sanitizeUsername(profile.username);
  if (!username) throw new Error("Invalid username");

  const hashed = await hashPassword(password);

  const record: LocalAuthUser = {
    id: String(profile.id),
    username,
    full_name: profile.full_name ?? null,
    role: (profile.role === "admin" ? "admin" : "cashier") as any,
    permissions: profile.permissions || {},
    active: profile.active === false ? false : true,
    password: hashed,
    updated_at: new Date().toISOString(),
  };

  await upsertLocalUser(record);
  return record;
}

export async function callVerifyPassword(username: string, password: string): Promise<VerifyPasswordResponse> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) return { ok: false, error: "Supabase env missing" };

  // In DEV, call via Vite proxy to avoid browser CORS preflight issues.
  const endpoint = import.meta.env.DEV ? "/functions/v1/verify_password" : `${url}/functions/v1/verify_password`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to fetch" };
  }

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return { ok: false, error: String(data?.error || `HTTP ${res.status}`), details: data?.details };
  return data as VerifyPasswordResponse;
}
