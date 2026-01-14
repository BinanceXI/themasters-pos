import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wifi,
  WifiOff,
  Cloud,
  User,
  LogOut,
  ChevronDown,
  Moon,
  Sun,
  CloudOff,
} from 'lucide-react';
import { usePOS } from '@/contexts/POSContext';
import { supabase } from '@/lib/supabase'; // ✅ Added Supabase Import
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationPanel } from '@/components/ui/NotificationPanel';

export const TopBar = () => {
  const { currentUser, syncStatus, setCurrentUser, pendingSyncCount } = usePOS();
  const [isDark, setIsDark] = useState(true);

  // ✅ FIXED LOGOUT FUNCTION
  const handleLogout = async () => {
    // 1. Tell Supabase to kill the session
    await supabase.auth.signOut();

    // 2. Delete the saved user from the hard drive (CRITICAL STEP)
    localStorage.removeItem('themasters_user');
    localStorage.removeItem('sb-cdxazhylmefeevytokpk-auth-token'); // Clear Supabase token

    // 3. Clear the app state
    setCurrentUser(null);

    // 4. Reload to force the Login Screen to appear
    window.location.href = '/'; 
    window.location.reload();
  };

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  const getSyncStatusDisplay = () => {
    switch (syncStatus) {
      case 'online':
        return { icon: <Wifi className="w-4 h-4 text-success" />, label: 'Online', color: 'text-success', bg: 'bg-success/10' };
      case 'offline':
        return { icon: <WifiOff className="w-4 h-4 text-warning" />, label: 'Offline', color: 'text-warning', bg: 'bg-warning/10' };
      case 'syncing':
        return { icon: <Cloud className="w-4 h-4 text-info animate-pulse" />, label: 'Syncing', color: 'text-info', bg: 'bg-info/10' };
      default:
        return { icon: <CloudOff className="w-4 h-4 text-destructive" />, label: 'Error', color: 'text-destructive', bg: 'bg-destructive/10' };
    }
  };

  const syncDisplay = getSyncStatusDisplay();

  return (
    <header className="h-14 md:h-16 border-b border-border bg-card px-4 flex items-center justify-between shrink-0">
      {/* Left Side: Sync Status */}
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${syncDisplay.bg}`}>
          {syncDisplay.icon}
          <span className={`text-xs font-medium ${syncDisplay.color} hidden sm:inline`}>{syncDisplay.label}</span>
          {pendingSyncCount > 0 && (
            <span className="px-1.5 py-0.5 bg-warning/20 text-warning text-[10px] font-bold rounded-full">{pendingSyncCount}</span>
          )}
        </div>
      </div>

      {/* Right Side: User & Actions */}
      <div className="flex items-center gap-2 md:gap-3">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground h-9 w-9">
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <NotificationPanel />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-2 pr-3 h-9">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium leading-none">{currentUser?.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{currentUser?.role}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer">
              <User className="w-4 h-4 mr-2" />Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" />Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};