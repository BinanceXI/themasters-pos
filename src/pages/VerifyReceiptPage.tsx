import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { motion } from "framer-motion";
import { XCircle, Loader2, ShieldCheck, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import themastersLogo from "@/assets/themasters-logo.png";

type OrderItem = {
  product_name: string;
  quantity: number;
  price_at_sale: number;
};

type OrderRow = {
  receipt_id: string;
  receipt_number: string;
  customer_name: string | null;
  total_amount: number;
  payment_method: string | null;
  status: string | null;
  created_at: string;
  order_items: OrderItem[];
  profiles?: { full_name: string | null } | null;
};

export const VerifyReceiptPage = () => {
  const { id } = useParams<{ id: string }>(); // ✅ this is receipt_id
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [store, setStore] = useState<{ business_name?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  useEffect(() => {
    const fetchAll = async () => {
      if (!id) return;

      // verification needs internet
      if (!isOnline) {
        setLoading(false);
        setError(true);
        return;
      }

      try {
        setLoading(true);
        setError(false);

        // store settings
        const { data: storeSettings, error: storeErr } = await supabase
          .from("store_settings")
          .select("business_name")
          .maybeSingle();

        if (!storeErr) setStore(storeSettings || null);

        // ✅ factual lookup: receipt_id
        const { data, error: ordErr } = await supabase
          .from("orders")
          .select(
            `
            receipt_id,
            receipt_number,
            customer_name,
            total_amount,
            payment_method,
            status,
            created_at,
            order_items (
              product_name,
              quantity,
              price_at_sale
            ),
            profiles:cashier_id ( full_name )
          `
          )
          .eq("receipt_id", id)
          .maybeSingle();

        if (ordErr || !data) throw ordErr;

        setOrder(data as any);
      } catch (err) {
        console.error(err);
        setError(true);
        setOrder(null);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [id, isOnline]);

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-primary w-10 h-10" />
        <p className="text-sm text-muted-foreground animate-pulse">Verifying Receipt...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex h-screen items-center justify-center bg-red-50 p-4">
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="w-full max-w-md">
          <Card className="border-red-200 shadow-2xl">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
                {isOnline ? <XCircle className="w-10 h-10 text-red-600" /> : <WifiOff className="w-10 h-10 text-amber-600" />}
              </div>

              <h2 className="text-2xl font-bold text-red-900">{isOnline ? "Receipt Not Found" : "Offline"}</h2>

              <p className="text-red-600 mt-2">
                {isOnline ? (
                  <>
                    The receipt ID <b className="font-mono break-all">{id}</b> does not exist in our records.
                  </>
                ) : (
                  <>
                    Receipt verification needs internet. Connect and try again.
                    <div className="mt-3 text-xs font-mono bg-white/60 border border-red-200 px-3 py-2 rounded-lg break-all">
                      receipt_id: {id}
                    </div>
                  </>
                )}
              </p>

              {isOnline && <p className="text-xs text-red-400 mt-4">If this is recent, please wait 2–5 minutes for sync.</p>}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const isValid = String(order.status || "").toLowerCase() === "completed";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 py-8 px-4 flex justify-center items-start">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative">
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-6 py-2 rounded-full flex items-center gap-2 shadow-xl z-20 border-4 border-slate-100">
          <ShieldCheck className="w-5 h-5" />
          <span className="font-bold text-sm tracking-wide">{isValid ? "OFFICIAL RECEIPT" : "NOT CONFIRMED"}</span>
        </div>

        <Card className="overflow-hidden shadow-2xl border-none">
          <div className="bg-slate-900 text-white p-8 pt-12 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500 to-transparent" />
            <img
              src={themastersLogo}
              alt="Logo"
              className="h-16 mx-auto object-contain mb-4 relative z-10"
              style={{ filter: "brightness(0) invert(1)" }}
            />

            <h1 className="text-2xl font-bold relative z-10 tracking-tight">{store?.business_name || "TheMasters"}</h1>

            <Badge variant="outline" className="mt-3 text-emerald-400 border-emerald-400/30 bg-emerald-400/10">
              {isValid ? "Paid" : "Status"} • {String(order.payment_method || "").toUpperCase()}
            </Badge>
          </div>

          <CardContent className="space-y-6 pt-8 bg-white relative">
            <div
              className="absolute top-0 left-0 right-0 h-4 bg-slate-900"
              style={{
                maskImage:
                  "linear-gradient(45deg, transparent 50%, black 50%), linear-gradient(-45deg, transparent 50%, black 50%)",
                maskSize: "20px 20px",
                maskRepeat: "repeat-x",
                maskPosition: "bottom",
                transform: "rotate(180deg)",
              }}
            />

            <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Receipt No</span>
                <span className="font-mono font-bold text-slate-900">{order.receipt_number}</span>
              </div>

              <div className="flex flex-col text-right">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Date</span>
                <span className="font-medium">{new Date(order.created_at).toLocaleDateString()}</span>
              </div>

              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cashier</span>
                <span className="font-medium truncate">{order.profiles?.full_name || "Staff"}</span>
              </div>

              <div className="flex flex-col text-right">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Time</span>
                <span className="font-medium">
                  {new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="flex flex-col col-span-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Customer</span>
                <span className="font-medium">{order.customer_name || "Walk-in"}</span>
              </div>

              <div className="flex flex-col col-span-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Receipt ID</span>
                <span className="font-mono text-xs break-all">{order.receipt_id}</span>
              </div>
            </div>

            <Separator className="my-2" />

            <div className="space-y-3">
              {(order.order_items || []).map((item, i) => (
                <div key={i} className="flex justify-between items-start text-sm">
                  <div className="flex gap-3">
                    <span className="font-bold text-slate-400 w-4">{item.quantity}</span>
                    <span className="text-slate-700 font-medium">{item.product_name}</span>
                  </div>
                  <span className="font-mono font-semibold">
                    ${(Number(item.price_at_sale) * Number(item.quantity)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <Separator className="my-2" />

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground uppercase font-bold">Total Amount</span>
                <span className="text-xs text-slate-400">Incl. Tax</span>
              </div>
              <span className="text-3xl font-black text-slate-900 tracking-tight">
                ${Number(order.total_amount).toFixed(2)}
              </span>
            </div>

            <div className="text-center pt-4 pb-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Digital Verification System</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};
