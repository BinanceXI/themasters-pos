import { forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import { CartItem } from "@/types/pos";
import themastersLogo from "@/assets/themasters-logo.png";

interface ReceiptProps {
  cart: CartItem[];
  total: number;
  cashierName: string;
  customerName?: string;

  receiptId: string;       // factual unique ID saved in orders.receipt_id
  receiptNumber: string;   // friendly TM-XXXXXX shown to humans
  paymentMethod: string;
}

export const PrintableReceipt = forwardRef<HTMLDivElement, ReceiptProps>((props, ref) => {
  const { cart, total, cashierName, customerName, receiptId, receiptNumber, paymentMethod } = props;

  const { data: settings } = useQuery({
    queryKey: ["storeSettings"],
    queryFn: async () => {
      // safer than .single() (won’t throw if empty)
      const { data, error } = await supabase.from("store_settings").select("*").maybeSingle();
      if (error) throw error;
      return data || {};
    },
    staleTime: 1000 * 60 * 60,
  });

  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://themasters.tech";

  const baseUrl = settings?.qr_code_data || window.location.origin;
const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

// if app uses HashRouter, verify route needs #/
const verifyBase = cleanBase.includes("#") ? cleanBase : `${cleanBase}/#`;

const qrUrl = `${verifyBase}/verify/${receiptId}`;

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
            <p>{new Date().toLocaleDateString()}</p>
            <p>{new Date().toLocaleTimeString()}</p>
          </div>
          <div className="text-right">
            <p className="font-bold">#{receiptNumber}</p>
            <p>Staff: {cashierName}</p>
          </div>
        </div>

        {/* ✅ CUSTOMER */}
        <p className="text-center font-bold border border-black py-1 mt-2">
          Customer: {customerName?.trim() ? customerName : "Walk-in"}
        </p>
      </div>

      <div className="border-b-2 border-dashed border-black my-2" />

      {/* ITEMS */}
      <div className="space-y-1 mb-4">
        {cart.map((item, i) => {
          const unit = item.customPrice ?? item.product.price ?? 0;
          const lineTotal = unit * item.quantity;

          return (
            <div key={item.lineId || i}>
              <div className="flex justify-between text-xs font-bold">
                <span>
                  {item.quantity} x {item.product.name}
                </span>
                <span>${lineTotal.toFixed(2)}</span>
              </div>

              {item.customDescription ? (
                <p className="text-[10px] italic pl-2">- {item.customDescription}</p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-b-2 border-dashed border-black my-2" />

      {/* TOTALS */}
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>${total.toFixed(2)}</span>
        </div>

        <div className="flex justify-between font-black text-lg mt-2">
          <span>TOTAL</span>
          <span>${total.toFixed(2)}</span>
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
          <p className="text-[10px] uppercase px-2 whitespace-pre-wrap">{(settings as any).footer_message}</p>
        )}

        <p className="text-[8px] font-bold mt-2">POWERED BY THEMASTERS</p>
      </div>
    </div>
  );
});

PrintableReceipt.displayName = "PrintableReceipt";

