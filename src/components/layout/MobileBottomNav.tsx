import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  Wallet,
  MoreHorizontal,
  Printer,
  PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePOS, type UserPermissions } from "@/contexts/POSContext";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  path: string;
  label: string;
  icon: any;
  adminOnly?: boolean;
  permission?: keyof UserPermissions;
};

export const MobileBottomNav = () => {
  const location = useLocation();
  const { currentUser, cart } = usePOS();

  const canShow = (item: NavItem) => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;

    if (item.adminOnly) return false;
    if (!currentUser.permissions) return true;
    if (item.permission && !currentUser.permissions[item.permission]) return false;
    return true;
  };

  const primaryItems: NavItem[] = [
    { path: "/dashboard", label: "Home", icon: LayoutDashboard },
    { path: "/pos", label: "POS", icon: ShoppingCart },
    { path: "/inventory", label: "Stock", icon: Package, permission: "allowInventory" },
  ].filter(canShow);

  const moreItems: NavItem[] = [
    { path: "/receipts", label: "Receipts", icon: Printer },
    { path: "/profit", label: "Profit", icon: PieChart, permission: "allowReports" },
    { path: "/expenses", label: "Expenses", icon: Wallet, adminOnly: true },
    { path: "/reports", label: "Reports", icon: BarChart3, permission: "allowReports" },
    { path: "/settings", label: "Settings", icon: Settings, permission: "allowSettings" },
  ].filter(canShow);

  const isMoreActive = moreItems.some((i) => location.pathname === i.path);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {primaryItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors relative",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="mobileActiveIndicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full"
                />
              )}
              <div className="relative">
                <item.icon className="w-6 h-6" />
                {item.path === "/pos" && cart.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                    {cart.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          );
        })}

        {/* More (slide sheet) */}
        {moreItems.length > 0 && (
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors relative",
                  isMoreActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {isMoreActive && (
                  <motion.div
                    layoutId="mobileActiveIndicator"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full"
                  />
                )}
                <MoreHorizontal className="w-6 h-6" />
                <span className="text-[10px] font-medium">More</span>
              </button>
            </SheetTrigger>

            <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-6 pt-4">
              <SheetHeader className="text-left">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {moreItems.map((item) => (
                  <SheetClose key={item.path} asChild>
                    <NavLink
                      to={item.path}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3",
                        location.pathname === item.path ? "text-primary" : "text-foreground"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </NavLink>
                  </SheetClose>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </nav>
  );
};
