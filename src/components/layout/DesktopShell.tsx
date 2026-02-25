import { ReactNode } from "react";
import { POSSidebar } from "./POSSidebar";
import { TopBar } from "./TopBar";

interface DesktopShellProps {
  children: ReactNode;
}

/**
 * DesktopShell preserves the original desktop layout of the application.
 * Guaranteed to have zero visual impact on md+ screens.
 */
export const DesktopShell = ({ children }: DesktopShellProps) => {
  return (
    <div className="relative flex h-[100dvh] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/5 dark:to-black/30" />
      
      {/* Sidebar - only visible/functional on desktop */}
      <POSSidebar />

      <div className="relative z-10 flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar />

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pos-scrollbar">
          <div className="page-enter w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
