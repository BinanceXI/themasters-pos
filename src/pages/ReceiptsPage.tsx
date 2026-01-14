import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Printer,
  Save,
  RefreshCw,
  FileImage,
  Settings2,
  ShieldCheck,
  Receipt,
  Copy,
  WifiOff,
  Cloud,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { usePOS } from "@/contexts/POSContext";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { PrintableReceipt } from "@/components/pos/PrintableReceipt";
import type { CartItem, Product } from "@/types/pos";

// --------------------
// Offline queue helpers
// --------------------
const OFFLINE_QUEUE_KEY = "themasters_offline_queue";

function safeJSONParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --------------------
// URL helper (HashRouter safe)
// --------------------
function buildVerifyUrl(baseUrl: string, receiptId: string) {
  let b = (baseUrl || "").trim();
  if (!b) b = window.location.origin;

  // remove trailing slash
  b = b.replace(/\/+$/, "");

  // ensure hash base
  if (b.includes("#")) {
    // normalize to ".../#"
    if (!b.endsWith("#")) {
      b = b.split("#")[0].replace(/\/+$/, "") + "/#";
    }
  } else {
    b = b + "/#";
  }

  return `${b}/verify/${receiptId}`;
}

type StoreSettings = {
  id?: string;
  business_name?: string;
  address?: string;
  phone?: string;
  tax_id?: string;
  footer_message?: string;
  show_qr_code?: boolean;
  qr_code_data?: string;
};

type OnlineReceiptRow = {
  id: string;
  receipt_id: string;
  receipt_number: string;
  customer_name: string | null;
  total_amount: number | string;
  payment_method: string | null;
  status: string | null;
  created_at: string;
  profiles?: { full_name?: string | null } | null;
};

export const ReceiptsPage = () => {
  const { currentUser } = usePOS();
  const isAdmin = currentUser?.role === "admin";
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"settings" | "receipts">("settings");

  // Preview uses stable fake receipt id + number
  const [previewReceiptId] = useState(
    // @ts-ignore
    globalThis.crypto?.randomUUID?.() ?? `rcpt-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const [previewReceiptNumber] = useState(`TM-${Date.now().toString().slice(-6)}`);

  // printing
  const [printData, setPrintData] = useState<null | {
    cart: CartItem[];
    total: number;
    cashierName: string;
    customerName: string;
    receiptId: string;
    receiptNumber: string;
    paymentMethod: string;
  }>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!printData) return;
    const t = setTimeout(() => {
      try {
        setIsPrinting(true);
        window.print();
      } finally {
        setTimeout(() => setIsPrinting(false), 700);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [printData]);

  // --------------------
  // 1) Store settings (offline cached)
  // --------------------
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["storeSettings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("store_settings").select("*").single();

      // No row yet => defaults
      // Supabase "no rows" code often PGRST116
      if (error && (error as any).code !== "PGRST116") throw error;

      const defaults: StoreSettings = {
        business_name: "TheMasters",
        address: "",
        phone: "",
        tax_id: "",
        footer_message: "Thank you for your business!",
        show_qr_code: true,
        qr_code_data: window.location.origin,
      };

      return (data as StoreSettings) || defaults;
    },
    staleTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const [formData, setFormData] = useState<StoreSettings>({});
  useEffect(() => {
    if (settings) setFormData(settings);
  }, [settings]);

  // 2) Save settings
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: StoreSettings) => {
      if (!navigator.onLine) throw new Error("You are offline. Connect to save settings.");

      const payload = {
        id: settings?.id,
        ...newSettings,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("store_settings").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storeSettings"] });
      toast.success("Receipt settings saved");
    },
    onError: (err: any) => toast.error(err?.message || "Save failed"),
  });

  const handleSave = () => {
    if (!isAdmin) return toast.error("Admins only");
    updateSettingsMutation.mutate(formData);
  };

  // preview verify link (HashRouter safe)
  const previewVerifyUrl = useMemo(() => {
    const base = formData.qr_code_data || window.location.origin;
    return buildVerifyUrl(base, previewReceiptId);
  }, [formData.qr_code_data, previewReceiptId]);

  // --------------------
  // 3) Receipts list (online)
  // --------------------
  const [q, setQ] = useState("");
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  const { data: onlineReceipts = [], isLoading: receiptsLoading, refetch } = useQuery({
    queryKey: ["receipts", q],
    queryFn: async () => {
      if (!navigator.onLine) return [];

      const base = supabase
        .from("orders")
        .select(
          `
          id,
          receipt_id,
          receipt_number,
          customer_name,
          total_amount,
          payment_method,
          status,
          created_at,
          profiles:cashier_id ( full_name )
        `
        )
        .order("created_at", { ascending: false })
        .limit(80);

      if (q.trim()) {
        const s = q.trim();
        base.or(`receipt_number.ilike.%${s}%,customer_name.ilike.%${s}%`);
      }

      const { data, error } = await base;
      if (error) throw error;
      return (data || []) as OnlineReceiptRow[];
    },
    enabled: activeTab === "receipts",
    staleTime: 1000 * 30,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  // --------------------
  // 4) Offline pending receipts
  // --------------------
  const offlineQueue = useMemo(() => {
    const queue = safeJSONParse<any[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
    return (queue || []).slice().reverse();
  }, [activeTab, isOnline]);

  const pendingCount = offlineQueue.length;

  // --------------------
  // actions
  // --------------------
  const copyText = useCallback(async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  const printOnlineReceipt = useCallback(
    async (row: OnlineReceiptRow) => {
      try {
        const { data, error } = await supabase
          .from("order_items")
          .select("product_name, quantity, price_at_sale")
          .eq("order_id", row.id);

        if (error) throw error;

        const cart: CartItem[] = (data || []).map((it: any, idx: number) => {
          const product: Product = {
            id: `p-${idx}`,
            name: it.product_name,
            price: Number(it.price_at_sale) || 0,
            category: "General",
            type: "good",
          };

          return {
            lineId: `p-${idx}-${Date.now()}`,
            product,
            quantity: Number(it.quantity) || 1,
            discount: 0,
            discountType: "percentage",
            customPrice: Number(it.price_at_sale) || 0,
          };
        });

        setPrintData({
          cart,
          total: Number(row.total_amount) || 0,
          cashierName: row.profiles?.full_name || "Staff",
          customerName: row.customer_name || "",
          receiptId: row.receipt_id,
          receiptNumber: row.receipt_number,
          paymentMethod: row.payment_method || "cash",
        });
      } catch (e: any) {
        toast.error(e?.message || "Failed to load items to print");
      }
    },
    [setPrintData]
  );

  const printOfflineReceipt = useCallback(
    (sale: any) => {
      const cart: CartItem[] = (sale.items || []).map((it: any) => ({
        ...it,
        lineId: it.lineId || `off-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      }));

      setPrintData({
        cart,
        total: Number(sale.total) || 0,
        cashierName: currentUser?.name || "Staff",
        customerName: sale.customerName || "",
        receiptId: sale.meta?.receiptId,
        receiptNumber: sale.meta?.receiptNumber,
        paymentMethod: sale.payments?.[0]?.method || "cash",
      });
    },
    [currentUser?.name]
  );

  // --------------------
  // UI
  // --------------------
  return (
    <div className="flex h-full flex-col lg:flex-row gap-6 p-4 md:p-6 bg-slate-950 min-h-screen">
      {/* LEFT */}
      <div className="flex-1 flex flex-col gap-5 max-w-4xl">
        {/* Header */}
        <div className="flex items-start md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Receipts</h1>
            <p className="text-slate-400 text-sm">
              Settings, verification links, reprint, and offline pending receipts.
            </p>
          </div>

          {activeTab === "settings" && (
            <Button
              onClick={handleSave}
              disabled={updateSettingsMutation.isPending || !isAdmin}
              className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
              title={!isAdmin ? "Admins only" : undefined}
            >
              {updateSettingsMutation.isPending ? (
                <RefreshCw className="animate-spin mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex p-1 bg-slate-900/50 border border-slate-800 rounded-xl w-fit backdrop-blur-md">
          <TabButton
            active={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
            icon={FileImage}
            label="Settings"
          />
          <TabButton
            active={activeTab === "receipts"}
            onClick={() => setActiveTab("receipts")}
            icon={Receipt}
            label="Receipts"
          />
        </div>

        <AnimatePresence mode="wait">
          {/* SETTINGS TAB */}
          {activeTab === "settings" ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <SettingsCard title="Store Identity" icon={Settings2}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Business Name">
                    <Input
                      value={formData.business_name || ""}
                      onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white focus:ring-blue-500"
                      disabled={!isAdmin}
                    />
                  </Field>

                  <Field label="Tax ID / ZIMRA">
                    <Input
                      value={formData.tax_id || ""}
                      onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white focus:ring-blue-500"
                      disabled={!isAdmin}
                    />
                  </Field>

                  <Field label="Address" full>
                    <Input
                      value={formData.address || ""}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white focus:ring-blue-500"
                      disabled={!isAdmin}
                    />
                  </Field>

                  <Field label="Phone" full>
                    <Input
                      value={formData.phone || ""}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white focus:ring-blue-500"
                      disabled={!isAdmin}
                    />
                  </Field>

                  <Field label="Footer Message" full>
                    <Textarea
                      value={formData.footer_message || ""}
                      onChange={(e) => setFormData({ ...formData, footer_message: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white focus:ring-blue-500 min-h-[90px]"
                      disabled={!isAdmin}
                    />
                  </Field>
                </div>
              </SettingsCard>

              <SettingsCard title="Security & Verification" icon={ShieldCheck}>
                <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                  <div className="space-y-1">
                    <Label className="text-white">Show QR Code</Label>
                    <p className="text-xs text-slate-400">
                      QR contains the factual <b>receipt_id</b> and opens verification page.
                    </p>
                  </div>
                  <Switch
                    checked={formData.show_qr_code !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, show_qr_code: c })}
                    disabled={!isAdmin}
                  />
                </div>

                {formData.show_qr_code !== false && (
                  <div className="mt-4 space-y-2">
                    <Label className="text-slate-300">Verification Base URL</Label>
                    <Input
                      value={formData.qr_code_data || ""}
                      onChange={(e) => setFormData({ ...formData, qr_code_data: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
                      placeholder={window.location.origin}
                      disabled={!isAdmin}
                    />

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-slate-700 text-slate-300 hover:text-white"
                        onClick={() => copyText(previewVerifyUrl)}
                      >
                        <Copy className="w-4 h-4 mr-2" /> Copy Preview Link
                      </Button>
                      <div className="text-xs text-slate-400 font-mono truncate">{previewVerifyUrl}</div>
                    </div>

                    <div className="mt-4 bg-white rounded-xl p-4 w-fit">
                      {/* Preview QR */}
                      <div className="text-center text-xs font-mono mb-2">Preview QR</div>
                      {/* QRCodeSVG is already used in PrintableReceipt, no need here */}
                      <div className="text-[10px] text-slate-500 mt-2">
                        receipt_number: <b>{previewReceiptNumber}</b>
                      </div>
                    </div>
                  </div>
                )}
              </SettingsCard>
            </motion.div>
          ) : (
            /* RECEIPTS TAB */
            <motion.div
              key="receipts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              {/* top bar */}
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-xl w-fit">
                  {isOnline ? (
                    <>
                      <Cloud className="w-4 h-4 text-emerald-400" /> Online
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4 text-amber-400" /> Offline
                    </>
                  )}
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-300">
                    Pending Sync: <b className="text-white">{pendingCount}</b>
                  </span>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search receipt number / customer..."
                      className="pl-9 bg-slate-950 border-slate-800 text-white"
                      disabled={!isOnline}
                      title={!isOnline ? "Search needs internet" : undefined}
                    />
                    {q && (
                      <button
                        className="absolute right-2 top-2.5 text-slate-500 hover:text-white"
                        onClick={() => setQ("")}
                        type="button"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    className="border-slate-700 text-slate-300 hover:text-white"
                    onClick={() => refetch()}
                    disabled={!isOnline}
                    title={!isOnline ? "Offline" : "Refresh receipts"}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                  </Button>
                </div>
              </div>

              {/* OFFLINE PENDING */}
              {pendingCount > 0 && (
                <SettingsCard title="Offline Pending Receipts (Not Yet Synced)" icon={WifiOff}>
                  <div className="space-y-2">
                    {offlineQueue.slice(0, 10).map((sale: any, idx: number) => {
                      const rid = sale?.meta?.receiptId || "unknown";
                      const rnum = sale?.meta?.receiptNumber || "TM-??????";
                      const t = sale?.meta?.timestamp ? new Date(sale.meta.timestamp) : null;
                      const verifyUrl = buildVerifyUrl(formData.qr_code_data || window.location.origin, rid);

                      return (
                        <div
                          key={`${rid}-${idx}`}
                          className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/10"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-mono font-bold">{rnum}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">
                                PENDING SYNC
                              </span>
                            </div>
                            <div className="text-xs text-slate-200/80">
                              {sale.customerName ? `Customer: ${sale.customerName}` : "Walk-in"} •{" "}
                              {t ? t.toLocaleString() : "Unknown time"}
                            </div>
                            <div className="text-xs text-slate-200/70 font-mono break-all mt-1">
                              receipt_id: {rid}
                            </div>
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-700 text-slate-200 hover:text-white"
                              onClick={() => copyText(verifyUrl)}
                            >
                              <Copy className="w-4 h-4 mr-2" /> Copy Verify Link
                            </Button>

                            <Button
                              size="sm"
                              className="bg-white text-slate-900 hover:bg-slate-200"
                              onClick={() => printOfflineReceipt(sale)}
                            >
                              <Printer className="w-4 h-4 mr-2" /> Reprint
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {pendingCount > 10 && (
                      <div className="text-xs text-slate-400 mt-2">
                        Showing 10 of {pendingCount} pending receipts.
                      </div>
                    )}
                  </div>
                </SettingsCard>
              )}

              {/* ONLINE RECEIPTS */}
              <SettingsCard title="Receipts History (Online)" icon={Receipt}>
                {!isOnline ? (
                  <div className="text-sm text-slate-400">
                    You are offline. Online receipts history will show when connected.
                  </div>
                ) : receiptsLoading ? (
                  <div className="text-sm text-slate-400">Loading receipts…</div>
                ) : onlineReceipts.length === 0 ? (
                  <div className="text-sm text-slate-400">No receipts found.</div>
                ) : (
                  <div className="space-y-2">
                    {onlineReceipts.map((row) => {
                      const verifyUrl = buildVerifyUrl(formData.qr_code_data || window.location.origin, row.receipt_id);

                      return (
                        <div
                          key={row.id}
                          className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-950/40"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-mono font-bold">{row.receipt_number}</span>

                              <span
                                className={cn(
                                  "text-[10px] px-2 py-0.5 rounded-full border",
                                  row.status === "completed"
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                )}
                              >
                                {String(row.status || "").toUpperCase()}
                              </span>

                              <span className="text-slate-500 text-xs">•</span>
                              <span className="text-slate-300 text-xs">
                                {String(row.payment_method || "cash").toUpperCase()}
                              </span>
                            </div>

                            <div className="text-xs text-slate-400">
                              {row.customer_name ? `Customer: ${row.customer_name}` : "Walk-in"} •{" "}
                              {new Date(row.created_at).toLocaleString()}
                            </div>

                            <div className="text-xs text-slate-500">
                              Cashier: {row.profiles?.full_name || "Staff"} • Total:{" "}
                              <b className="text-white">${Number(row.total_amount || 0).toFixed(2)}</b>
                            </div>

                            <div className="text-[11px] text-slate-500 font-mono break-all mt-1">
                              receipt_id: {row.receipt_id}
                            </div>
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-700 text-slate-200 hover:text-white"
                              onClick={() => copyText(verifyUrl)}
                            >
                              <Copy className="w-4 h-4 mr-2" /> Copy Link
                            </Button>

                            <Button
                              size="sm"
                              className="bg-white text-slate-900 hover:bg-slate-200"
                              onClick={() => printOnlineReceipt(row)}
                            >
                              <Printer className="w-4 h-4 mr-2" /> Reprint
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SettingsCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* PRINT AREA */}
      <div id="receipt-print-area" className="fixed top-0 left-[-9999px]">
        {printData && (
          <PrintableReceipt
            cart={printData.cart}
            total={printData.total}
            cashierName={printData.cashierName}
            customerName={printData.customerName}
            receiptId={printData.receiptId}
            receiptNumber={printData.receiptNumber}
            paymentMethod={printData.paymentMethod}
          />
        )}
      </div>

      {isPrinting && (
        <div className="fixed bottom-4 right-4 bg-card border border-border px-3 py-2 rounded-xl shadow-lg text-xs">
          Printing…
        </div>
      )}
    </div>
  );
};

// ---- UI helpers ----

const SettingsCard = ({ title, icon: Icon, children }: any) => (
  <motion.div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
    <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
      <div className="p-2 bg-blue-500/10 rounded-lg">
        <Icon className="h-5 w-5 text-blue-400" />
      </div>
      <h3 className="font-semibold text-white">{title}</h3>
    </div>
    <div className="p-6">{children}</div>
  </motion.div>
);

const TabButton = ({ active, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
      active ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
    )}
    type="button"
  >
    <Icon className="h-4 w-4" />
    {label}
  </button>
);

const Field = ({ label, children, full }: { label: string; children: any; full?: boolean }) => (
  <div className={cn("space-y-2", full && "md:col-span-2")}>
    <Label className="text-slate-300">{label}</Label>
    {children}
  </div>
);
