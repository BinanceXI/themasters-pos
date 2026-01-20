import { ReactNode } from 'react';
import { POSSidebar } from './POSSidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  return (
   <div className="flex min-h-[100dvh] bg-background">
      {/* Desktop Sidebar - hidden on mobile */}
      <POSSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto pos-scrollbar pb-20 md:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav - visible only on mobile */}
      <MobileBottomNav />
    </div>
  );
};
