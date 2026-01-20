import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, ShieldCheck, Wifi, WifiOff, Eye, EyeOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePOS } from "@/contexts/POSContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import themastersLogo from "@/assets/themasters-logo.png";

type CachedProfile = {
  id: string;
  username: string;
  full_name?: string | null;
  role?: "admin" | "cashier" | string;
  permissions?: any;
  pin_code?: string | null;
};

const PROFILES_CACHE_KEY = "themasters_profiles_cache_v1";

const sanitizeUsername = (raw: string) =>
  (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

const readProfilesCache = (): CachedProfile[] => {
  try {
    const raw = localStorage.getItem(PROFILES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedProfile[]) : [];
  } catch {
    return [];
  }
};

const writeProfilesCache = (profiles: CachedProfile[]) => {
  try {
    localStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(profiles || []));
  } catch {
    // ignore
  }
};

export const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const { setCurrentUser, syncStatus } = usePOS();

  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState(""); // PIN
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const usernameRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  // ✅ Prefetch profiles when ONLINE (NOT during login click)
  // This makes offline login possible later without touching Supabase at login time.
  useEffect(() => {
    let cancelled = false;

    const prefetch = async () => {
      if (!navigator.onLine) return;
      try {
        const { data, error: err } = await supabase
          .from("profiles")
          .select("id, username, full_name, role, permissions, pin_code")
          .order("full_name");

        if (cancelled) return;
        if (err) return;

        const cleaned = (data || [])
          .filter((p: any) => p?.id && p?.username)
          .map((p: any) => ({
            id: String(p.id),
            username: String(p.username),
            full_name: p.full_name ?? null,
            role: p.role ?? "cashier",
            permissions: p.permissions ?? {},
            pin_code: p.pin_code ?? null,
          })) as CachedProfile[];

        writeProfilesCache(cleaned);
      } catch {
        // ignore
      }
    };

    prefetch();
    window.addEventListener("online", prefetch);
    return () => {
      cancelled = true;
      window.removeEventListener("online", prefetch);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const u = sanitizeUsername(username);
      const pin = String(secret || "").trim();

      if (!u || !pin) throw new Error("Enter username and PIN");

      // ✅ OFFLINE-FIRST: DO NOT call Supabase here.
      const cache = readProfilesCache();
      const profile = cache.find((p) => sanitizeUsername(p.username) === u);

      if (!profile) {
        throw new Error(
          "User not found on this device. Connect to internet once (to cache staff) then try again."
        );
      }

      if (String(profile.pin_code || "") !== pin) throw new Error("Invalid PIN");

      setCurrentUser({
        id: profile.id,
        // keep BOTH so your UI never breaks no matter which field is used
        full_name: profile.full_name || profile.username,
        name: profile.full_name || profile.username,
        username: profile.username,
        role: profile.role || "cashier",
        permissions: profile.permissions || {},
        pin_code: profile.pin_code || null,
        active: true,
      } as any);

      toast.success(`Welcome ${profile.full_name || profile.username}`);
      onLogin();
    } catch (err: any) {
      setError(err?.message || "Login failed");
      toast.error(err?.message || "Login failed");
      setSecret("");
      secretRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* LEFT BRAND PANEL */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900" />

        <div className="relative z-10 flex flex-col items-center text-white px-12 w-full">
          {/* HUGE LOGO */}
          <div className="mb-12 w-full flex justify-center">
            <img
              src={themastersLogo}
              alt="TheMasters POS"
              className="w-[460px] max-w-full drop-shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
              style={{ filter: "invert(1) hue-rotate(180deg) contrast(1.25)" }}
            />
          </div>

          <h1 className="text-4xl font-bold text-center mb-4">
            Tech & Repair Business Solution
          </h1>

          <p className="text-slate-300 text-center max-w-lg text-lg leading-relaxed">
            Phone repairs, satellite installations, accessories sales —
            all managed from one powerful offline-first system.
          </p>

          <div className="flex gap-3 mt-8 flex-wrap justify-center">
            <StatusBadge
              ok={syncStatus === "online"}
              okLabel="Online (Synced)"
              badLabel={syncStatus === "syncing" ? "Syncing…" : "Offline Mode"}
            />
            <Tag label="Desktop Ready" />
            <Tag label="Keyboard-First" />
            <Tag label="Offline-First POS" />
          </div>

          <div className="absolute bottom-6 text-xs text-slate-400">
            © {new Date().getFullYear()} Masters of Technology
          </div>
        </div>
      </div>

      {/* RIGHT LOGIN PANEL */}
      <div className="flex-1 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-6"
        >
          {/* MOBILE LOGO */}
          <div className="lg:hidden flex justify-center mb-8">
            <img
              src={themastersLogo}
              alt="TheMasters POS"
              className="w-[300px]"
              style={{ filter: "invert(1) hue-rotate(180deg) contrast(1.25)" }}
            />
          </div>

          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-3xl font-bold">Sign In</h2>
            <p className="text-muted-foreground">Enter your staff credentials</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label>Username</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="john"
                  className="pl-10 h-12"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>PIN</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={secretRef}
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••"
                  className="pl-10 pr-10 h-12"
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowSecret((v) => !v)}
                >
                  {showSecret ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 p-3 rounded-md text-center">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-lg" disabled={loading}>
              {loading ? "Signing in…" : "Access System"}
            </Button>

            <div className="text-xs text-muted-foreground text-center">
              First time on a new device? Go online once to cache staff accounts.
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

/* --- small helpers --- */

const Tag = ({ label }: { label: string }) => (
  <span className="px-3 py-1 text-xs rounded-full bg-white/10 border border-white/10">
    {label}
  </span>
);

const StatusBadge = ({
  ok,
  okLabel,
  badLabel,
}: {
  ok: boolean;
  okLabel: string;
  badLabel: string;
}) => (
  <span
    className={`flex items-center gap-2 px-3 py-1 text-xs rounded-full border ${
      ok
        ? "bg-green-500/20 border-green-500/40 text-green-300"
        : "bg-amber-500/20 border-amber-500/40 text-amber-300"
    }`}
  >
    {ok ? <Wifi size={14} /> : <WifiOff size={14} />}
    {ok ? okLabel : badLabel}
  </span>
);
