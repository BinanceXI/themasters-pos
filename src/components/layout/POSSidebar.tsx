//binanceXI//
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  Printer,
  ChevronLeft,
  ChevronRight,
  PieChart
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePOS } from '@/contexts/POSContext';
import themastersLogo from '@/assets/themasters-logo.png';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/pos', label: 'Point of Sale', icon: ShoppingCart },
  { path: '/inventory', label: 'Inventory', icon: Package },
  { path: '/profit', label: 'Profit Analysis', icon: PieChart },
  { path: '/receipts', label: 'Receipts', icon: Printer },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export const POSSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { currentUser } = usePOS();

  // Helper to safely check permissions
  const canView = (item: typeof navItems[0]) => {
    // 1. Always show basic apps (Prevents "Blank Sidebar" panic)
    if (item.path === '/dashboard' || item.path === '/pos' || item.path === '/receipts') {
      return true;
    }

    // 2. If user data isn't loaded yet, hide sensitive stuff safely
    if (!currentUser) return false;
    
    // 3. Admin sees EVERYTHING
    if (currentUser.role === 'admin') return true;

    // 4. Hide Admin-Only pages from Cashiers
    if (item.path === '/settings' || item.path === '/profit') return false;

    // 5. Check specific permissions for Cashiers
    const perms = currentUser.permissions;
    
    // Handle Array format (e.g. ['sell', 'inventory'])
    if (Array.isArray(perms)) {
      if (item.path === '/reports') return perms.includes('reports');
      if (item.path === '/inventory') return perms.includes('inventory');
    }

    // Handle Object format (e.g. { allowReports: true })
    if (typeof perms === 'object' && perms !== null) {
      const p = perms as any;
      if (item.path === '/reports') return !!p.allowReports;
      if (item.path === '/inventory') return !!p.allowInventory;
    }

    return true;
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.2 }}
      className="hidden md:flex h-screen bg-sidebar flex-col border-r border-sidebar-border shadow-xl z-20"
    >
      {/* Logo Section - HUGE & BLUE/WHITE */}
      <div className={cn(
        "flex items-center justify-center border-b border-sidebar-border overflow-hidden transition-all duration-300 relative",
        collapsed ? "h-20 px-2" : "h-32 px-6"
      )}>
        <img 
          src={themastersLogo} 
          alt="Masters of Technology" 
          className={cn(
            "object-contain transition-all duration-300 relative z-10",
            collapsed ? "w-10 h-10" : "w-full h-24"
          )}
          style={{ 
            // ✨ THE MAGIC FILTER: 
            // Inverts colors (Black -> White) 
            // Rotates Hue 180deg (Orange -> Blue)
            // Increases Contrast (Makes it pop)
            filter: 'invert(1) hue-rotate(180deg) contrast(1.5)' 
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto pos-scrollbar">
        {navItems.map((item) => {
          if (!canView(item)) return null;

          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative font-medium mb-1',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-sidebar-primary rounded-r-full"
                />
              )}
              
              <item.icon className={cn('w-5 h-5 shrink-0', isActive && 'text-sidebar-primary')} />
              
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm truncate"
                >
                  {item.label}
                </motion.span>
              )}

              {/* Hover Tooltip for Collapsed State */}
              {collapsed && (
                <div className="absolute left-full ml-4 px-3 py-1.5 bg-popover text-popover-foreground rounded-md text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap shadow-md z-50 border border-border">
                  {item.label}
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse Button */}
      <div className="p-4 border-t border-sidebar-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm font-medium">Collapse Sidebar</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
};