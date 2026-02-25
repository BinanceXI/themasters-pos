import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { MobileBottomNav } from "./MobileBottomNav";

interface MobileShellProps {
  children: ReactNode;
}

/**
 * MobileShell provides a clean, single-column foundation for mobile devices.
 * It ensures consistent padding and a focus on simplicity.
 */
export const MobileShell = ({ children }: MobileShellProps) => {
  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Background subtle gradient for modern feel */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-primary/5 dark:to-black/30" />

      {/* TopBar already sticky and responsive-ish */}
      <TopBar />

      {/* Scroll container for mobile with safe-area padding */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] px-4 pt-4 pos-scrollbar">
        <div className="page-enter w-full">
          {children}
        </div>
      </main>

      {/* Fixed bottom navigation for mobile */}
      <MobileBottomNav />
    </div>
  );
};
