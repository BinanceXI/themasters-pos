// File: src/contexts/POSContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
  useCallback,
} from "react";
import type { CartItem, Product, SyncStatus, Sale, POSMode, Discount } from "@/types/pos";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

/* ---------------------------------- USER TYPES --------------------------------- */
export type Role = "admin" | "cashier";

export type UserPermissions = {
  allowRefunds: boolean;
  allowVoid: boolean;
  allowPriceEdit: boolean;
  allowDiscount: boolean;
  allowReports: boolean;
  allowInventory: boolean;
  allowSettings: boolean;
  allowEditReceipt: boolean;
};

export type POSUser = {
  id: string;
  username: string;
  role: Role;
  permissions: UserPermissions;
  pin_code?: string | null;

  // convenience
  full_name?: string;
  name?: string;
  active?: boolean;
};

export const ADMIN_PERMISSIONS: UserPermissions = {
  allowRefunds: true,
  allowVoid: true,
  allowPriceEdit: true,
  allowDiscount: true,
  allowReports: true,
  allowInventory: true,
  allowSettings: true,
  allowEditReceipt: true,
};

// ✅ FIX: cashier must be able to discount if you want discounts to work at the till
export const CASHIER_DEFAULT_PERMISSIONS: UserPermissions = {
  allowRefunds: false,
  allowVoid: false,
  allowPriceEdit: false,
  allowDiscount: true, // ✅ was false (this blocked discounts)
  allowReports: false,
  allowInventory: false,
  allowSettings: false,
  allowEditReceipt: false,
};

/* ---------------------------------- TYPES --------------------------------- */

export type SaleMeta = {
  receiptId: string;
  receiptNumber: string;
  timestamp: string;
};

type Payment = { method: string; amount: number };

type OfflineSale = {
  cashierId: string;
  customerName: string;
  total: number;
  payments: Payment[];
  items: CartItem[];
  meta: SaleMeta;
  synced: boolean;
  lastError?: string;
};

interface POSContextType {
  currentUser: POSUser | null;
  setCurrentUser: (user: POSUser | null) => void;

  can: (permission: keyof UserPermissions) => boolean;

  cart: CartItem[];
  addToCart: (product: Product, customDescription?: string, customPrice?: number) => void;
  removeFromCart: (lineId: string) => void;
  updateCartItemQuantity: (lineId: string, quantity: number) => void;
  updateCartItemCustom: (lineId: string, customDescription?: string, customPrice?: number) => void;
  updateCartItemDiscount: (
    lineId: string,
    discount: number,
    discountType: "percentage" | "fixed"
  ) => void;
  clearCart: () => void;

  syncStatus: SyncStatus;
  setSyncStatus: (status: SyncStatus) => void;
  pendingSyncCount: number;

  heldSales: Sale[];
  holdCurrentSale: () => void;
  resumeSale: (saleId: string) => void;

  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;

  posMode: POSMode;
  setPosMode: (mode: POSMode) => void;

  customerName: string;
  setCustomerName: (name: string) => void;

  activeDiscount: Discount | null;
  setActiveDiscount: (discount: Discount | null) => void;
  applyDiscountCode: (code: string) => boolean;

  completeSale: (payments: Payment[], total: number, meta: SaleMeta) => Promise<void>;

  getSecureTime: () => Date;
}

/* -------------------------------- CONTEXT --------------------------------- */

const POSContext = createContext<POSContextType | undefined>(undefined);

export const usePOS = () => {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used within a POSProvider");
  return ctx;
};

/* ----------------------------- STORAGE KEYS -------------------------------- */

const OFFLINE_QUEUE_KEY = "themasters_offline_queue";
const HELD_SALES_KEY = "themasters_held_sales";
const USER_KEY = "themasters_user";

/* -------------------------------- HELPERS ---------------------------------- */

const newLineId = () => `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const ensureLineIds = (items: any[]): CartItem[] =>
  (items || []).map((it: any) => ({
    ...it,
    lineId: it.lineId || newLineId(),
    discountType: it.discountType || "percentage",
    discount: typeof it.discount === "number" ? it.discount : 0,
  }));

const safeJSONParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const errorToMessage = (err: any) =>
  err?.message ||
  err?.error_description ||
  err?.details ||
  (typeof err === "string" ? err : JSON.stringify(err));

/* -------------------------- STOCK DECREMENT RPC ---------------------------- */

const decrementStockForItems = async (items: CartItem[]) => {
  for (const item of items) {
    if (item.product?.type !== "good") continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const { error } = await supabase.rpc("decrement_stock", {
      p_product_id: item.product.id,
      p_qty: qty,
    });

    if (error) throw error;
  }
};

/* ------------------------------- PROVIDER ---------------------------------- */

export const POSProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const [currentUser, _setCurrentUser] = useState<POSUser | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("online");

  const [heldSales, setHeldSales] = useState<Sale[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [posMode, setPosMode] = useState<POSMode>("retail");

  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [customerName, setCustomerName] = useState("");
  const [activeDiscount, setActiveDiscount] = useState<Discount | null>(null);

  const syncingRef = useRef(false);

  /* --------------------------- SESSION PERSISTENCE -------------------------- */

  useEffect(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (!saved) return;
    try {
      _setCurrentUser(JSON.parse(saved));
    } catch {
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  const setCurrentUser = (user: POSUser | null) => {
    _setCurrentUser(user);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  };

  const can = (permission: keyof UserPermissions) => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    return !!currentUser.permissions?.[permission];
  };

  /* ---------------------- LOAD HELD SALES & QUEUE --------------------------- */

  useEffect(() => {
    const savedHeld = safeJSONParse<Sale[]>(localStorage.getItem(HELD_SALES_KEY), []);
    setHeldSales(
      savedHeld.map((s: any) => ({
        ...s,
        items: ensureLineIds(s.items || []),
      }))
    );

    const queue = safeJSONParse<OfflineSale[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
    setPendingSyncCount(queue.length);
  }, []);

  useEffect(() => {
    localStorage.setItem(HELD_SALES_KEY, JSON.stringify(heldSales));
  }, [heldSales]);

  const saveToOfflineQueue = (sale: OfflineSale) => {
    const queue = safeJSONParse<OfflineSale[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
    queue.push(sale);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    setPendingSyncCount(queue.length);
  };

  const writeQueue = (queue: OfflineSale[]) => {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    setPendingSyncCount(queue.length);
  };

  /* ------------------------------ OFFLINE SYNC ------------------------------ */

  const processOfflineQueue = useCallback(async () => {
    if (syncingRef.current) return;

    const queue = safeJSONParse<OfflineSale[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);

    if (!queue.length) {
      setPendingSyncCount(0);
      return;
    }

    syncingRef.current = true;
    setSyncStatus("syncing");
    toast.loading(`Syncing ${queue.length} offline sales...`);

    const failed: OfflineSale[] = [];

    for (const sale of queue) {
      try {
        const saleItems = ensureLineIds(sale.items || []);
        const saleTime = new Date(sale.meta.timestamp);

        let orderId: string | null = null;

        const { data: existing } = await supabase
          .from("orders")
          .select("id")
          .eq("receipt_id", sale.meta.receiptId)
          .maybeSingle();

        if (existing?.id) {
          orderId = existing.id;
        } else {
          const { data, error } = await supabase
            .from("orders")
            .insert({
              cashier_id: sale.cashierId,
              customer_name: sale.customerName,
              total_amount: sale.total,
              payment_method: sale.payments[0]?.method || "cash",
              status: "completed",
              created_at: saleTime,
              receipt_id: sale.meta.receiptId,
              receipt_number: sale.meta.receiptNumber,
            })
            .select("id")
            .single();

          if (error) throw error;
          orderId = data.id;
        }

        await supabase.from("order_items").delete().eq("order_id", orderId);

        await supabase.from("order_items").insert(
          saleItems.map((i) => ({
            order_id: orderId,
            product_id: i.product.id,
            product_name: i.product.name,
            quantity: Number(i.quantity),
            price_at_sale: (i as any).customPrice ?? i.product.price,
            cost_at_sale: (i.product as any).cost_price || 0,
            service_note: (i as any).customDescription || null,
          }))
        );

        await decrementStockForItems(saleItems);
        await queryClient.invalidateQueries({ queryKey: ["products"] });
      } catch (e: any) {
        failed.push({ ...sale, lastError: errorToMessage(e) });
      }
    }

    writeQueue(failed);
    toast.dismiss();

    if (failed.length) {
      setSyncStatus("error");
      toast.error(`${failed.length} sales failed to sync`);
    } else {
      setSyncStatus("online");
      toast.success("All offline sales synced");
    }

    syncingRef.current = false;
  }, [queryClient]);

  /* ---------------------------- ONLINE / OFFLINE ---------------------------- */

  useEffect(() => {
    const update = async () => {
      const online = navigator.onLine;
      setSyncStatus(online ? "online" : "offline");
      if (online) await processOfflineQueue();
    };

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [processOfflineQueue]);

  /* ------------------------------- CART LOGIC ------------------------------- */

  const addToCart = (product: Product, desc?: string, price?: number) => {
    setCart((prev) => {
      const custom = (product as any).type === "service" && (desc || price !== undefined);
      if (custom) {
        return [
          ...prev,
          {
            lineId: newLineId(),
            product,
            quantity: 1,
            discount: 0,
            discountType: "percentage",
            customDescription: desc,
            customPrice: price,
          } as any,
        ];
      }

      const existing = prev.find(
        (i: any) =>
          i.product.id === (product as any).id &&
          !i.customDescription &&
          i.customPrice === undefined
      );

      if (existing) {
        return prev.map((i: any) =>
          i.lineId === (existing as any).lineId ? { ...i, quantity: Number(i.quantity) + 1 } : i
        );
      }

      return [
        ...prev,
        {
          lineId: newLineId(),
          product,
          quantity: 1,
          discount: 0,
          discountType: "percentage",
        } as any,
      ];
    });
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((i: any) => i.lineId !== id));

  const updateCartItemQuantity = (id: string, qty: number) => {
    if (qty <= 0) return removeFromCart(id);
    setCart((prev) => prev.map((i: any) => (i.lineId === id ? { ...i, quantity: qty } : i)));
  };

  const updateCartItemCustom = (id: string, desc?: string, price?: number) => {
    if (!can("allowPriceEdit")) {
      toast.error("Not allowed to edit prices");
      return;
    }
    setCart((prev) =>
      prev.map((i: any) =>
        i.lineId === id ? { ...i, customDescription: desc, customPrice: price } : i
      )
    );
  };

  // ✅ IMPORTANT: this is what POSPage will call — and it WILL work now (cashier has allowDiscount=true)
  const updateCartItemDiscount = (id: string, discount: number, type: "percentage" | "fixed") => {
    if (!can("allowDiscount")) {
      toast.error("Not allowed to apply discounts");
      return;
    }
    setCart((prev) =>
      prev.map((i: any) => (i.lineId === id ? { ...i, discount, discountType: type } : i))
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    setActiveDiscount(null);
  };

  /* ------------------------------ HELD SALES -------------------------------- */

  const holdCurrentSale = () => {
    if (!currentUser || !cart.length) return;

    const subtotal = cart.reduce((s: number, i: any) => {
      const price = i.customPrice ?? i.product.price;
      return s + Number(price) * Number(i.quantity);
    }, 0);

    const held: any = {
      id: `held-${Date.now()}`,
      items: ensureLineIds(cart as any),
      subtotal,
      tax: 0,
      discount: 0,
      total: subtotal,
      payments: [],
      cashier: currentUser,
      cashierId: currentUser.id,
      customerName,
      timestamp: new Date(),
      status: "held",
    };

    setHeldSales((prev) => [...prev, held]);
    clearCart();
  };

  const resumeSale = (saleId: string) => {
    const sale: any = heldSales.find((s: any) => s.id === saleId);
    if (!sale) return;

    setCart(ensureLineIds(sale.items || []) as any);
    setCustomerName(sale.customerName || "");
    setHeldSales((prev) => prev.filter((s: any) => s.id !== saleId));
  };

  /* ------------------------------ DISCOUNTS -------------------------------- */

  const applyDiscountCode = (code: string) => {
    const c = String(code || "").trim().toLowerCase();
    if (!c) return false;

    toast.message("Discount codes not configured yet");
    return false;
  };

  /* ------------------------------ COMPLETE SALE ----------------------------- */

  const completeSale: POSContextType["completeSale"] = async (payments, total, meta) => {
    if (!currentUser || !cart.length) return;

    const saleItems = ensureLineIds(cart as any);

    const saleData: OfflineSale = {
      cashierId: currentUser.id,
      customerName,
      total,
      payments,
      items: saleItems,
      meta,
      synced: false,
    };

    clearCart();

    if (navigator.onLine) {
      try {
        const { data: order, error: orderErr } = await supabase
          .from("orders")
          .insert({
            cashier_id: saleData.cashierId,
            customer_name: saleData.customerName,
            total_amount: saleData.total,
            payment_method: payments[0]?.method || "cash",
            status: "completed",
            created_at: new Date(meta.timestamp),
            receipt_id: meta.receiptId,
            receipt_number: meta.receiptNumber,
          })
          .select("id")
          .single();

        if (orderErr) throw orderErr;

        const { error: itemsErr } = await supabase.from("order_items").insert(
          saleItems.map((i: any) => ({
            order_id: order.id,
            product_id: i.product.id,
            product_name: i.product.name,
            quantity: Number(i.quantity),
            price_at_sale: i.customPrice ?? i.product.price,
            cost_at_sale: i.product.cost_price || 0,
            service_note: i.customDescription || null,
          }))
        );

        if (itemsErr) throw itemsErr;

        await decrementStockForItems(saleItems);
        await queryClient.invalidateQueries({ queryKey: ["products"] });

        toast.success("Sale saved & synced");
        return;
      } catch (e: any) {
        saveToOfflineQueue({ ...saleData, lastError: errorToMessage(e) });
        toast.warning("Online save failed — saved offline");
        return;
      }
    }

    saveToOfflineQueue(saleData);
    toast.success("Saved offline");
  };

  /* --------------------------------- VALUE --------------------------------- */

  const value = useMemo<POSContextType>(
    () => ({
      currentUser,
      setCurrentUser,
      can,
      cart,
      addToCart,
      removeFromCart,
      updateCartItemQuantity,
      updateCartItemCustom,
      updateCartItemDiscount,
      clearCart,
      syncStatus,
      setSyncStatus,
      pendingSyncCount,
      heldSales,
      holdCurrentSale,
      resumeSale,
      selectedCategory,
      setSelectedCategory,
      posMode,
      setPosMode,
      customerName,
      setCustomerName,
      activeDiscount,
      setActiveDiscount,
      applyDiscountCode,
      completeSale,
      getSecureTime: () => new Date(),
    }),
    [
      currentUser,
      cart,
      syncStatus,
      pendingSyncCount,
      heldSales,
      selectedCategory,
      posMode,
      customerName,
      activeDiscount,
    ]
  );

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};