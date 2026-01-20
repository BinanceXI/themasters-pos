// File: src/components/pos/PrintableReceipt.tsx
import { forwardRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import type { CartItem, Discount } from "@/types/pos";
import themastersLogo from "@/assets/themasters-logo.png";
import { buildVerifyUrl } from "@/lib/verifyUrl";

type DiscountType = "percentage" | "fixed";

interface ReceiptProps {
  cart: CartItem[];
  cashierName: string;
  customerName?: string;

  receiptId: string; // orders.receipt_id
  receiptNumber: string; // TM-...
  paymentMethod: string;

  // ✅ NEW: totals breakdown from POSPage snapshot (so VS doesn't go red)
  subtotal: number;
  discount: number; // global discount amount ($)
  tax: number;
  total: number;

  // ✅ optional: show global discount label (VIP10 etc.)
  activeDiscount?: Discount | null;

  // ✅ optional: show tax rate line if you want
  taxRatePct?: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fmtMoney(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return `$${x.toFixed(2)}`;
}

export const PrintableReceipt = forwardRef<HTMLDivElement, ReceiptProps>((props, ref) => {
  const {
    cart,
    cashierName,
    customerName,
    receiptId,
    receiptNumber,
    paymentMethod,
    subtotal,
    discount,
    tax,
    total,
    activeDiscount,
    taxRatePct,
  } = props;

  const { data: settings } = useQuery({
    queryKey: ["storeSettings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("store_settings").select("*").maybeSingle();
      if (error) throw error;
      return data || {};
    },
    staleTime: 1000 * 60 * 60,
  });

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://themasters.tech";

  const baseUrl = (settings as any)?.qr_code_data || origin;
  const qrUrl = buildVerifyUrl(baseUrl, receiptId);

  const now = useMemo(() => new Date(), [receiptId]);

  const lineSummaries = useMemo(() => {
    return (cart || []).map((item: any) => {
      const unit = Number(item.customPrice ?? item.product?.price ?? 0);
      const qty = Number(item.quantity ?? 0);
      const lineTotal = unit * qty;

      const dType = (item.discountType as DiscountType | undefined) ?? "percentage";
      const dVal = Number(item.discount ?? 0);

      const lineDiscount = dVal > 0 ? (dType === "percentage" ? lineTotal * (dVal / 100) : dVal) : 0;
      const safeLineDiscount = round2(Math.max(0, Math.min(lineDiscount, lineTotal)));

      const finalLine = round2(lineTotal - safeLineDiscount);

      const impliedPercent =
        dType === "fixed" && lineTotal > 0 ? round2((safeLineDiscount / lineTotal) * 100) : null;

      return {
        key: item.lineId || `${item.product?.id}-${Math.random()}`,
        name: item.product?.name ?? "Item",
        qty,
        unit,
        lineTotal: round2(lineTotal),
        discountType: dType,
        discountValue: round2(dVal),
        lineDiscount: safeLineDiscount,
        impliedPercent,
        finalLine,
        customDescription: item.customDescription || "",
      };
    });
  }, [cart]);

  const showTax = Number(tax || 0) > 0;
  const showGlobalDiscount = Number(discount || 0) > 0;

  return (
    <div className="w-[80mm] p-2 text-black font-mono text-sm leading-tight bg-white" ref={ref}>
      {/* HEADER */}
      <div className="text-center mb-4">
        <img
          src={themastersLogo}
          alt="Logo"
          className="h-12 mx-auto mb-2 object-contain"
          style={{ filter: "grayscale(100%) contrast(200%)" }}
        />

        <h2 className="font-black text-xl uppercase leading-none mb-1">
          {(settings as any)?.business_name || "TheMasters"}
        </h2>

        {(settings as any)?.address && <p className="text-[10px]">{(settings as any).address}</p>}
        {(settings as any)?.phone && <p className="text-[10px]">{(settings as any).phone}</p>}
        {(settings as any)?.tax_id && (
          <p className="text-[10px] font-bold mt-1">TAX: {(settings as any).tax_id}</p>
        )}
      </div>

      <div className="border-b-2 border-dashed border-black my-2" />

      {/* META */}
      <div className="text-[10px] uppercase mb-2 space-y-1">
        <div className="flex justify-between">
          <div>
            <p>{now.toLocaleDateString()}</p>
            <p>{now.toLocaleTimeString()}</p>
          </div>
          <div className="text-right">
            <p className="font-bold">#{receiptNumber}</p>
            <p>Staff: {cashierName}</p>
          </div>
        </div>

        <p className="text-center font-bold border border-black py-1 mt-2">
          Customer: {customerName?.trim() ? customerName : "Walk-in"}
        </p>
      </div>

      <div className="border-b-2 border-dashed border-black my-2" />

      {/* ITEMS */}
      <div className="space-y-2 mb-4">
        {lineSummaries.map((it) => (
          <div key={it.key}>
            <div className="flex justify-between text-xs font-bold">
              <span>
                {it.qty} x {it.name}
              </span>
              <span>{fmtMoney(it.lineTotal)}</span>
            </div>

            {/* ✅ item discount line */}
            {it.lineDiscount > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>
                  Discount{" "}
                  {it.discountType === "percentage"
                    ? `(${it.discountValue}%)`
                    : it.impliedPercent !== null
                      ? `(${it.discountValue}$ ~${it.impliedPercent}%)`
                      : `(${it.discountValue}$)`}
                </span>
                <span>-{fmtMoney(it.lineDiscount)}</span>
              </div>
            )}

            {/* ✅ final line after discount */}
            {it.lineDiscount > 0 && (
              <div className="flex justify-between text-[10px] font-bold">
                <span>Line Total</span>
                <span>{fmtMoney(it.finalLine)}</span>
              </div>
            )}

            {it.customDescription ? (
              <p className="text-[10px] italic pl-2">- {it.customDescription}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-b-2 border-dashed border-black my-2" />

      {/* TOTALS */}
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{fmtMoney(subtotal)}</span>
        </div>

        {showGlobalDiscount && (
          <div className="flex justify-between">
            <span>
              Discount{activeDiscount?.name ? ` (${activeDiscount.name})` : ""}
            </span>
            <span>-{fmtMoney(discount)}</span>
          </div>
        )}

        {showTax && (
          <div className="flex justify-between">
            <span>Tax{typeof taxRatePct === "number" ? ` (${taxRatePct}%)` : ""}</span>
            <span>{fmtMoney(tax)}</span>
          </div>
        )}

        <div className="flex justify-between font-black text-lg mt-2">
          <span>TOTAL</span>
          <span>{fmtMoney(total)}</span>
        </div>

        <p className="text-center text-[10px] mt-2 uppercase border-t border-black pt-1">
          Paid via {paymentMethod}
        </p>
      </div>

      {/* FOOTER & QR */}
      <div className="mt-6 text-center space-y-2">
        {(settings as any)?.show_qr_code !== false && (
          <div className="flex flex-col items-center">
            <QRCodeSVG value={qrUrl} size={90} />
            <p className="text-[8px] mt-1">Scan to Verify</p>
            <p className="text-[8px] opacity-70 break-all">ID: {receiptId}</p>
          </div>
        )}

        {(settings as any)?.footer_message && (
          <p className="text-[10px] uppercase px-2 whitespace-pre-wrap">
            {(settings as any).footer_message}
          </p>
        )}

        <p className="text-[8px] font-bold mt-2">POWERED BY THEMASTERS</p>
      </div>
    </div>
  );
});

PrintableReceipt.displayName = "PrintableReceipt";

