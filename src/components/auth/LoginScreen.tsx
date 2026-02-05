// File: src/components/auth/LoginScreen.tsx
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, ShieldCheck, Wifi, WifiOff, Eye, EyeOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePOS } from "@/contexts/POSContext";
import { supabase } from "@/lib/supabase";
import {
  callVerifyPassword,
  seedLocalUserFromPassword,
  verifyPasswordLocal,
} from "@/lib/auth/offlinePasswordAuth";
import { toast } from "sonner";
import themastersLogo from "@/assets/themasters-logo.png";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

const sanitizeUsername = (raw: string) =>
  (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

export const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const { setCurrentUser, syncStatus } = usePOS();

  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState(""); // password
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const usernameRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const last = localStorage.getItem("themasters_last_username");
      if (last && !username) setUsername(last);
    } catch {}
  }, []);

  // ✅ Fingerprint unlock: requires an existing Supabase auth session (online setup)
  const handleFingerprintLogin = async () => {
    if (!Capacitor.isNativePlatform()) {
      toast.error("Fingerprint works only on Android app");
      return;
    }

    try {
      const available = await NativeBiometric.isAvailable();
      if (!available?.isAvailable) {
        toast.error("Biometric not available on this device");
        return;
      }

      await NativeBiometric.verifyIdentity({
        reason: "Use fingerprint to access TheMasters POS",
        title: "Fingerprint Login",
        subtitle: "Confirm your identity",
        description: "Scan your fingerprint",
      });

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) {
        toast.error("No active session. Please sign in with your password.");
        return;
      }

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        toast.error("Session expired. Please sign in with your password.");
        return;
      }

      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("id, username, full_name, role, permissions, active")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (profErr || !profile) {
        toast.error("Failed to load profile");
        return;
      }
      if ((profile as any)?.active === false) {
        toast.error("Account disabled");
        return;
      }

      setCurrentUser({
        id: String((profile as any).id),
        full_name: (profile as any).full_name || (profile as any).username,
        name: (profile as any).full_name || (profile as any).username,
        username: (profile as any).username,
        role: (profile as any).role || "cashier",
        permissions: (profile as any).permissions || {},
        active: true,
      } as any);

      sessionStorage.setItem("themasters_session_active", "1");
      toast.success(`Welcome ${(profile as any).full_name || (profile as any).username}`);
      onLogin();
    } catch (err: any) {
      toast.error(err?.message || "Fingerprint cancelled / failed");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const u = sanitizeUsername(username);
      const password = String(secret || "");

      if (!u || !password) throw new Error("Enter username and password");

      // 1) OFFLINE-FIRST: try local password verification
      const localUser = await verifyPasswordLocal(u, password);

      if (localUser) {
        setCurrentUser({
          id: localUser.id,
          full_name: localUser.full_name || localUser.username,
          name: localUser.full_name || localUser.username,
          username: localUser.username,
          role: (localUser.role as any) || "cashier",
          permissions: localUser.permissions || {},
          active: true,
        } as any);

        sessionStorage.setItem("themasters_session_active", "1");
        localStorage.setItem("themasters_last_username", localUser.username);

        // 2) If online, best-effort: mint/refresh Supabase session for sync + RLS.
        if (navigator.onLine) {
          try {
            const verify = await callVerifyPassword(u, password);
            if (verify.ok) {
              const { error: otpErr } = await supabase.auth.verifyOtp({
                token_hash: verify.token_hash,
                type: "magiclink",
              });
              if (otpErr) throw otpErr;
            }
          } catch (e: any) {
            toast.warning(e?.message || "Signed in offline; cloud session unavailable");
          }
        }

        toast.success(`Welcome ${localUser.full_name || localUser.username}`);
        onLogin();
        return;
      }

      // 2) No local user yet:
      if (!navigator.onLine) {
        throw new Error("Offline login not set up on this device. Connect once to sign in and enable offline access.");
      }

      // 3) Online verification (and seed offline password hash locally)
      const verify = await callVerifyPassword(u, password);
      if (!verify.ok) throw new Error(verify.error || "Invalid credentials");

      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: verify.token_hash,
        type: "magiclink",
      });
      if (otpErr) throw otpErr;

      await seedLocalUserFromPassword(verify.user, password);

      setCurrentUser({
        id: verify.user.id,
        full_name: verify.user.full_name || verify.user.username,
        name: verify.user.full_name || verify.user.username,
        username: verify.user.username,
        role: (verify.user.role as any) || "cashier",
        permissions: verify.user.permissions || {},
        active: true,
      } as any);

      sessionStorage.setItem("themasters_session_active", "1");
      localStorage.setItem("themasters_last_username", verify.user.username);

      toast.success(`Welcome ${verify.user.full_name || verify.user.username}`);
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

          <h1 className="text-4xl font-bold text-center mb-4">Tech & Repair Business Solution</h1>

          <p className="text-slate-300 text-center max-w-lg text-lg leading-relaxed">
            Phone repairs, satellite installations, accessories sales — all managed from one powerful offline-first system.
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

          <div className="absolute bottom-6 text-xs text-slate-400">© {new Date().getFullYear()} Masters of Technology</div>
        </div>
      </div>

      {/* RIGHT LOGIN PANEL */}
      <div className="flex-1 flex items-center justify-center px-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
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
              <Label>Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={secretRef}
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 pr-10 h-12"
                  autoComplete="current-password"
                  inputMode="text"
                  enterKeyHint="done"
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

            {/* ✅ FIX: this is the exact button placement */}
            <Button type="button" variant="outline" className="w-full h-12" onClick={handleFingerprintLogin}>
              Use Fingerprint
            </Button>

            <div className="text-xs text-muted-foreground text-center">
              Offline-first sign-in uses your local password. If online, a cloud session is also created for syncing.
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

/* --- small helpers --- */

const Tag = ({ label }: { label: string }) => (
  <span className="px-3 py-1 text-xs rounded-full bg-white/10 border border-white/10">{label}</span>
);

const StatusBadge = ({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) => (
  <span
    className={`flex items-center gap-2 px-3 py-1 text-xs rounded-full border ${
      ok ? "bg-green-500/20 border-green-500/40 text-green-300" : "bg-amber-500/20 border-amber-500/40 text-amber-300"
    }`}
  >
    {ok ? <Wifi size={14} /> : <WifiOff size={14} />}
    {ok ? okLabel : badLabel}
  </span>
);
