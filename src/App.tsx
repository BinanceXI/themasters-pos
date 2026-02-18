import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

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
import { ExpensesPage } from "./pages/ExpensesPage";
import NotFound from "./pages/NotFound";
import { EXPECTED_SUPABASE_REFS, getBackendInfo } from "@/lib/backendInfo";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24 * 7,
      staleTime: 1000 * 60 * 5,
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

  return (
    <Routes>
      {/* ✅ Public verify route (no login needed) */}
      <Route path="/verify/:id" element={<VerifyReceiptPage />} />

      {/* ✅ Auth gate */}
      {!currentUser ? (
        <Route path="*" element={<LoginScreen onLogin={() => {}} />} />
      ) : (
        <>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route
            path="/dashboard"
            element={
              <MainLayout>
                <DashboardPage />
              </MainLayout>
            }
          />
          <Route
            path="/pos"
            element={
              <MainLayout>
                <POSPage />
              </MainLayout>
            }
          />
          <Route
            path="/inventory"
            element={
              <MainLayout>
                <InventoryPage />
              </MainLayout>
            }
          />
          <Route
            path="/profit"
            element={
              <MainLayout>
                <ProfitAnalysisPage />
              </MainLayout>
            }
          />
          <Route
            path="/receipts"
            element={
              <MainLayout>
                <ReceiptsPage />
              </MainLayout>
            }
          />
          <Route
            path="/reports"
            element={
              <MainLayout>
                <ReportsPage />
              </MainLayout>
            }
          />
          <Route
            path="/expenses"
            element={
              <MainLayout>
                <ExpensesPage />
              </MainLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <MainLayout>
                <SettingsPage />
              </MainLayout>
            }
          />

          {/* ✅ Proper NotFound (NO recursion) */}
          <Route
            path="*"
            element={
              <MainLayout>
                <NotFound />
              </MainLayout>
            }
          />
        </>
      )}
    </Routes>
  );
};

const App = () => {
  useEffect(() => {
    const saved = localStorage.getItem("themasters_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDark = saved ? saved === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  useEffect(() => {
    const b = getBackendInfo();
    const expected = EXPECTED_SUPABASE_REFS as readonly string[];
    const ok = !!b.supabaseRef && expected.includes(b.supabaseRef);

    const msg = `[backend] ref=${b.supabaseRef || "unknown"} mode=${b.mode || "unknown"}${
      b.appVersion ? ` version=${b.appVersion}` : ""
    }${b.appCommit ? ` commit=${b.appCommit.slice(0, 7)}` : ""}`;

    if (!b.supabaseUrl) {
      console.warn("[backend] Missing VITE_SUPABASE_URL. App will not be connected.");
      return;
    }

    if (!ok) {
      console.warn(`${msg} expected=${expected.join(", ")}`, { supabaseUrl: b.supabaseUrl });
    } else {
      console.info(msg, { supabaseUrl: b.supabaseUrl });
    }
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        buster: "themasters-v1",
      }}
    >
      <TooltipProvider>
        <POSProvider>
          <Toaster />
          <Sonner />
          <AppRoutes />
        </POSProvider>
      </TooltipProvider>
    </PersistQueryClientProvider>
  );
};

export default App;
