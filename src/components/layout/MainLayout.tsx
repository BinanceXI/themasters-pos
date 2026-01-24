import { ReactNode } from "react";
import { POSSidebar } from "./POSSidebar";
import { TopBar } from "./TopBar";
import { MobileBottomNav } from "./MobileBottomNav";

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Desktop Sidebar - hidden on mobile */}
      <POSSidebar />

      {/* ✅ Critical: min-h-0 makes overflow scrolling work inside flex on mobile */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* TopBar already handles its own sticky */}
        <TopBar />

        {/* ✅ The ONLY scroll container */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pos-scrollbar pb-20 md:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav - visible only on mobile */}
      <MobileBottomNav />
    </div>
  );
};