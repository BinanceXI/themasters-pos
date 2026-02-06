// File: src/components/auth/LoginScreen.tsx
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, ShieldCheck, Wifi, WifiOff, Eye, EyeOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_PERMISSIONS, usePOS } from "@/contexts/POSContext";
import { supabase } from "@/lib/supabase";
import {
  callVerifyPassword,
  seedLocalUserFromPassword,
  verifyPasswordLocal,
} from "@/lib/auth/offlinePasswordAuth";
import { hashPassword } from "@/lib/auth/passwordKdf";
import { getLocalUser, listLocalUsers, upsertLocalUser } from "@/lib/auth/localUserStore";
import { toast } from "sonner";
import themastersLogo from "@/assets/themasters-logo.png";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

const sanitizeUsername = (raw: string) =>
  (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

const BIOMETRIC_SERVER = "themasterspos";
const BIOMETRIC_ENABLED_KEY = "themasters_biometric_enabled_v1";

export const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const { setCurrentUser, syncStatus } = usePOS();

  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState(""); // password
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [localUserCount, setLocalUserCount] = useState<number>(0);

  const [showOfflineSetup, setShowOfflineSetup] = useState(false);
  const [setupFullName, setSetupFullName] = useState("");
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPassword2, setSetupPassword2] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [saveForBiometric, setSaveForBiometric] = useState(() => {
    try {
      return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const usernameRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const users = await listLocalUsers();
        setLocalUserCount(users.length);
      } catch {
        setLocalUserCount(0);
      }

      try {
        const last = localStorage.getItem("themasters_last_username");
        if (last) setUsername((u) => (u ? u : last));
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    NativeBiometric.isAvailable()
      .then((res) => setBiometricAvailable(!!res?.isAvailable))
      .catch(() => setBiometricAvailable(false));
  }, []);

  const maybeSaveBiometricCredentials = async (u: string, password: string) => {
    if (!Capacitor.isNativePlatform()) return;
    if (!saveForBiometric) return;
    try {
      const available = await NativeBiometric.isAvailable();
      if (!available?.isAvailable) return;
      await NativeBiometric.setCredentials({ server: BIOMETRIC_SERVER, username: u, password });
      localStorage.setItem(BIOMETRIC_ENABLED_KEY, "1");
    } catch {
      // best-effort; don't block login
    }
  };

  // ✅ Fingerprint unlock: offline-first (unlocks the local user on this device).
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

      const last =
        sanitizeUsername(localStorage.getItem("themasters_last_username") || "") || sanitizeUsername(username);
      if (!last) {
        toast.error("No saved user on this device. Sign in with your password once.");
        return;
      }

      const local = await getLocalUser(last);
      if (!local) {
        toast.error("Offline login not set up on this device. Sign in with your password once.");
        return;
      }
      if (local.active === false) {
        toast.error("Account disabled");
        return;
      }

      // Best-effort: restore a real Supabase session for syncing (requires saved credentials).
      if (navigator.onLine) {
        try {
          const creds = await NativeBiometric.getCredentials({ server: BIOMETRIC_SERVER });
          const cu = sanitizeUsername(creds?.username || "");
          const cp = String((creds as any)?.password || "");

          if (cu && cp && cu === local.username) {
            // Prefer offline-password edge verification (no email required). Fallback to Supabase password sign-in
            // for older accounts or when edge functions are temporarily unavailable.
            let cloudOk = false;

            try {
              const verify = await callVerifyPassword(cu, cp);
              if (verify.ok) {
                const { error: otpErr } = await supabase.auth.verifyOtp({
                  token_hash: verify.token_hash,
                  type: "magiclink",
                });
                if (otpErr) throw otpErr;
                cloudOk = true;
              }
            } catch {
              // ignore (fallback below)
            }

            if (!cloudOk) {
              try {
                const email = cu.includes("@") ? cu : `${cu}@themasterspos.app`;
                const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: cp });
                if (signErr) throw signErr;
              } catch {
                // keep offline login working even if cloud session can't be restored
              }
            }
          }
        } catch {
          // keep offline login working even if cloud session can't be restored
        }
      }

      setCurrentUser({
        id: local.id,
        full_name: local.full_name || local.username,
        name: local.full_name || local.username,
        username: local.username,
        role: (local.role as any) || "cashier",
        permissions: local.permissions || {},
        active: true,
      } as any);

      sessionStorage.setItem("themasters_session_active", "1");
      localStorage.setItem("themasters_last_username", local.username);
      toast.success(`Welcome ${local.full_name || local.username}`);
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
          let cloudOk = false;
          try {
            const verify = await callVerifyPassword(u, password);
            if (!verify.ok) throw new Error(verify.error || "Cloud session unavailable");

            const { error: otpErr } = await supabase.auth.verifyOtp({
              token_hash: verify.token_hash,
              type: "magiclink",
            });
            if (otpErr) throw otpErr;
            cloudOk = true;
          } catch (e: any) {
            // Fallback: accounts that use Supabase Auth passwords.
            try {
              const email = u.includes("@") ? u : `${u}@themasterspos.app`;
              const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
              if (signErr) throw signErr;
              cloudOk = true;
            } catch (e2: any) {
              const msg = e2?.message || e?.message || "Signed in offline; cloud session unavailable";
              toast.warning(msg);
            }
          }

          if (!cloudOk) {
            // keep offline login working even if cloud session can't be restored
          }
        }

        void maybeSaveBiometricCredentials(u, password);
        toast.success(`Welcome ${localUser.full_name || localUser.username}`);
        onLogin();
        return;
      }

      // 2) No local user yet:
      if (!navigator.onLine) {
        if (localUserCount === 0) {
          throw new Error("No offline users found. Tap “Set up Offline Admin” to start without internet.");
        }
        throw new Error("Offline login not set up on this device. Connect once to sign in and enable offline access.");
      }

      // 3) Online sign-in (seed offline password hash locally)
      // Prefer edge-function username/password verification (no email required).
      const verify = await callVerifyPassword(u, password);
      if (verify.ok) {
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

        void maybeSaveBiometricCredentials(u, password);
        toast.success(`Welcome ${verify.user.full_name || verify.user.username}`);
        onLogin();
        return;
      }

      // Fallback: direct Supabase Auth password sign-in (for accounts that already exist in Auth).
      const email = u.includes("@") ? u : `${u}@themasterspos.app`;
      const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({ email, password });

      if (signErr || !signIn?.user?.id) {
        const msg = verify.ok ? "" : String(verify.error || "");
        const merged = msg || signErr?.message || "Invalid credentials";
        if (/cors|preflight|failed to fetch|err_failed/i.test(merged) && localUserCount === 0) {
          throw new Error("Cannot reach server to verify credentials. Tap “Set up Offline Admin” to start offline.");
        }
        throw new Error(merged);
      }

      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("id, username, full_name, role, permissions, active")
        .eq("id", signIn.user.id)
        .maybeSingle();

      if (profErr || !profile) throw new Error("Failed to load profile");
      if ((profile as any)?.active === false) throw new Error("Account disabled");

      await seedLocalUserFromPassword(profile as any, password);

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
      localStorage.setItem("themasters_last_username", String((profile as any).username || u));

      void maybeSaveBiometricCredentials(u, password);
      toast.success(`Welcome ${(profile as any).full_name || (profile as any).username || u}`);
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

  const handleOfflineAdminSetup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSetupError("");
    setSetupLoading(true);
    try {
      const existing = await listLocalUsers();
      if (existing.length > 0) throw new Error("Offline users already exist on this device. Use normal login.");

      const fullName = String(setupFullName || "").trim();
      const u = sanitizeUsername(setupUsername);
      const p1 = String(setupPassword || "");
      const p2 = String(setupPassword2 || "");

      if (!fullName) throw new Error("Full name required");
      if (!u) throw new Error("Username required");
      if (u.length < 3) throw new Error("Username must be 3+ characters");
      if (p1.length < 6) throw new Error("Password must be at least 6 characters");
      if (p1 !== p2) throw new Error("Passwords do not match");

      const id =
        (globalThis.crypto as any)?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const hashed = await hashPassword(p1);

      await upsertLocalUser({
        id,
        username: u,
        full_name: fullName,
        role: "admin",
        permissions: ADMIN_PERMISSIONS,
        active: true,
        password: hashed,
        updated_at: new Date().toISOString(),
      });

      setLocalUserCount(1);
      setShowOfflineSetup(false);
      setSetupFullName("");
      setSetupUsername("");
      setSetupPassword("");
      setSetupPassword2("");

      setCurrentUser({
        id,
        full_name: fullName,
        name: fullName,
        username: u,
        role: "admin",
        permissions: ADMIN_PERMISSIONS,
        active: true,
      } as any);

      sessionStorage.setItem("themasters_session_active", "1");
      localStorage.setItem("themasters_last_username", u);

      void maybeSaveBiometricCredentials(u, p1);
      toast.success(`Welcome ${fullName}`);
      onLogin();
    } catch (err: any) {
      const msg = err?.message || "Setup failed";
      setSetupError(msg);
      toast.error(msg);
    } finally {
      setSetupLoading(false);
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

            {Capacitor.isNativePlatform() && biometricAvailable && (
              <Button type="button" variant="outline" className="w-full h-12" onClick={handleFingerprintLogin}>
                Use Fingerprint
              </Button>
            )}

            {biometricAvailable && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">Enable fingerprint quick login</div>
                  <div className="text-[11px] text-muted-foreground">
                    Saves username + password securely on this device (for cloud sync without typing).
                  </div>
                </div>
                <Switch checked={saveForBiometric} onCheckedChange={setSaveForBiometric} />
              </div>
            )}

            <div className="text-xs text-muted-foreground text-center">
              Offline-first sign-in uses your local password. If online, a cloud session is also created for syncing.
            </div>

            {localUserCount === 0 && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full h-12"
                  onClick={() => setShowOfflineSetup(true)}
                >
                  Set up Offline Admin
                </Button>
                <div className="text-[11px] text-muted-foreground text-center mt-2">
                  First time on this device? Create a local admin and use the app completely offline.
                </div>
              </div>
            )}
          </form>
        </motion.div>
      </div>

      <Dialog open={showOfflineSetup} onOpenChange={setShowOfflineSetup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Offline Admin Setup</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleOfflineAdminSetup} className="space-y-4">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input
                value={setupFullName}
                onChange={(e) => setSetupFullName(e.target.value)}
                placeholder="Owner / Admin"
                autoCapitalize="words"
              />
            </div>

            <div className="space-y-2">
              <Label>Username</Label>
              <Input
                value={setupUsername}
                onChange={(e) => setSetupUsername(e.target.value)}
                placeholder="admin"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <div className="text-[11px] text-muted-foreground">Lowercase letters/numbers only; 3+ characters.</div>
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <div className="text-[11px] text-muted-foreground">Minimum 6 characters.</div>
            </div>

            <div className="space-y-2">
              <Label>Confirm password</Label>
              <Input
                type="password"
                value={setupPassword2}
                onChange={(e) => setSetupPassword2(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {setupError && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 p-3 rounded-md text-center">
                {setupError}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowOfflineSetup(false)} disabled={setupLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={setupLoading}>
                {setupLoading ? "Creating…" : "Create Offline Admin"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
