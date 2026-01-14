import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { POSProvider, usePOS } from "./contexts/POSContext";
import { LoginScreen } from "./components/auth/LoginScreen";
import { MainLayout } from "./components/layout/MainLayout";
import { VerifyReceiptPage } from "./pages/VerifyReceiptPage";

import { DashboardPage } from "./pages/Dashboard";
import { POSPage } from "./pages/POSPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProfitAnalysisPage } from "./pages/ProfitAnalysisPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24 * 7,  // 7 days
      staleTime: 1000 * 60 * 5,         // 5 minutes
      retry: 0,
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
});

const AppRoutes = () => {
  const { currentUser } = usePOS();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const session = localStorage.getItem("sb-cdxazhylmefeevytokpk-auth-token");
    if (session || currentUser) setIsAuthenticated(true);
  }, [currentUser]);

  const handleLogin = () => setIsAuthenticated(true);

  // ✅ Verify route should work regardless of layout decisions
  // If you want verify to work without login, keep it OUTSIDE the auth check:
  return (
    <Routes>
      <Route path="/verify/:id" element={<VerifyReceiptPage />} />

      {!isAuthenticated && !currentUser ? (
        <Route path="*" element={<LoginScreen onLogin={handleLogin} />} />
      ) : (
        <Route
          path="*"
          element={
            <MainLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/pos" element={<POSPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/profit" element={<ProfitAnalysisPage />} />
                <Route path="/receipts" element={<ReceiptsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </MainLayout>
          }
        />
      )}
    </Routes>
  );
};

const App = () => {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7, // ✅ keep persisted cache 7 days
        buster: "themasters-v1",         // ✅ change to bust cache after schema changes
      }}
    >
      <TooltipProvider>
        <POSProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </POSProvider>
      </TooltipProvider>
    </PersistQueryClientProvider>
  );
};

export default App;
