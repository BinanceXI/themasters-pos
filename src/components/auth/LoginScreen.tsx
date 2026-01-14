import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Lock, 
  Mail, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  Eye, 
  EyeOff, 
  Monitor, 
  Keyboard, 
  Cpu 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePOS } from '@/contexts/POSContext';
// ✅ CORRECT IMPORT PATH
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import themastersLogo from '@/assets/themasters-logo.png';

export const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { setCurrentUser, syncStatus } = usePOS();
  
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (authError) {
        throw new Error(authError.message === "Invalid login credentials" 
          ? "Incorrect email or password." 
          : authError.message);
      }

      if (authData.user) {
        // 2. Fetch User Profile
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        // 🚨 LOGIC FIX: Check if this is the Master Admin Email
        // If the DB fails (profileError), we check the email directly.
        const isMasterEmail = email.toLowerCase().includes('admin'); 
        
        const MASTER_PERMISSIONS = {
          allowRefunds: true,
          allowVoid: true,
          allowPriceEdit: true,
          allowDiscount: true,
          allowReports: true,
          allowInventory: true,
          allowSettings: true,
          allowEditReceipt: true
        };

        if (profileError) {
          console.error("Profile Fetch Error (Using Fallback):", profileError);
          
          // Fallback Logic: If DB fails but email says 'admin', FORCE ADMIN
          setCurrentUser({
            id: authData.user.id,
            name: authData.user.email || 'Staff',
            role: isMasterEmail ? 'admin' : 'cashier', // <--- FORCE ADMIN HERE
            permissions: isMasterEmail ? MASTER_PERMISSIONS : [],
            active: true,
            username: authData.user.email || '',
            email: authData.user.email || ''
          });
        } else {
          // Success from DB
          setCurrentUser({
            id: profile.id,
            name: profile.full_name || authData.user.email,
            username: authData.user.email,
            email: authData.user.email,
            role: profile.role || 'cashier',
            active: true,
            permissions: profile.permissions || [],
            pin_code: profile.pin_code
          });
        }

        toast.success(`Welcome, ${isMasterEmail ? 'Master' : (profile?.full_name || 'Staff')}`);
        onLogin();
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message);
      toast.error(err.message);
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900/40" />
        
        {/* Background Grid */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }} />
        
        <div className="relative z-10 flex flex-col items-center justify-center p-12 text-white h-full w-full">
          
          {/* ✅ LOGO SECTION - HUGE & WHITE TEXT */}
          <div className="w-full max-w-[800px] mb-12 flex justify-center relative">
             {/* Glow effect behind logo to make it pop */}
             <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full" />
             <img 
               src={themastersLogo} 
               alt="Masters of Technology" 
               className="w-full h-auto object-contain drop-shadow-2xl relative z-10"
               style={{ 
                 maxHeight: '300px',
                 // CSS TRICK: Invert colors (Black->White) then Rotate Hue 180deg (Orange->Blue)
                 filter: 'invert(1) hue-rotate(180deg) contrast(1.2)'
               }} 
             />
          </div>

          <div className="space-y-8 text-center">
            <div>
              <h1 className="text-4xl font-bold leading-tight mb-4 tracking-tight">
                Tech & Repair<br />
                <span className="text-blue-400">Management System</span>
              </h1>
              <p className="text-slate-300 text-lg max-w-lg mx-auto leading-relaxed">
                The centralized hub for TheMasters. Manage repairs, sales, and services.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3 text-sm font-medium">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${
                syncStatus === 'online' 
                  ? 'bg-green-500/20 border-green-500/50 text-green-300' 
                  : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
              }`}>
                {syncStatus === 'online' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                <span>{syncStatus === 'online' ? 'System Online' : 'Offline Mode'}</span>
              </div>
              
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/10">
                <Monitor className="w-4 h-4 text-blue-300" />
                <span>Windows App</span>
              </div>
            </div>
          </div>

          <div className="absolute bottom-8 text-slate-500 text-sm font-mono">
            System ID: MST-POS-01 • {new Date().getFullYear()} Masters of Technology
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          
          {/* Mobile Header - LOGO HUGE HERE TOO */}
          <div className="lg:hidden flex flex-col items-center gap-4 mb-12">
            <div className="w-[280px] h-[120px] flex items-center justify-center">
                <img 
                src={themastersLogo} 
                alt="Masters of Technology" 
                className="w-full h-full object-contain drop-shadow-lg"
                style={{ filter: 'invert(1) hue-rotate(180deg) contrast(1.2)' }}
                />
            </div>
            <h1 className="text-2xl font-bold text-center mt-4">TheMasters POS</h1>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-inner">
                <ShieldCheck className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-3xl font-bold mb-2 tracking-tight">Welcome Back</h2>
              <p className="text-muted-foreground">Sign in to access the terminal</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    ref={emailRef}
                    id="email"
                    type="email"
                    placeholder="admin@themasters.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-12 bg-background border-input transition-all focus:ring-2 focus:ring-primary/20"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">PIN / Password</Label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-12 bg-background border-input transition-all focus:ring-2 focus:ring-primary/20"
                    autoComplete="current-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 hover:bg-transparent text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </Button>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-destructive/15 text-destructive text-sm font-medium p-3 rounded-md text-center border border-destructive/20"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                disabled={!email || !password || isLoading}
                className="w-full h-12 text-lg font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    Authenticating...
                  </div>
                ) : (
                  'Access System'
                )}
              </Button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
};