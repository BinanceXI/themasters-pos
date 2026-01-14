// ✅ REPLACE YOUR ENTIRE FILE WITH THIS
// File: src/contexts/POSContext.tsx

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { User, CartItem, Product, SyncStatus, Sale, POSMode, Discount } from "@/types/pos";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export type SaleMeta = {
  receiptId: string;
  receiptNumber: string;
  timestamp: string; // ISO
};

interface POSContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;

  cart: CartItem[];
  addToCart: (product: Product, customDescription?: string, customPrice?: number) => void;

  removeFromCart: (lineId: string) => void;
  updateCartItemQuantity: (lineId: string, quantity: number) => void;
  updateCartItemCustom: (lineId: string, customDescription?: string, customPrice?: number) => void;
  updateCartItemDiscount: (lineId: string, discount: number, discountType: "percentage" | "fixed") => void;

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

  // ✅ upgraded: meta required for factual receipts + QR
  completeSale: (
    payments: { method: string; amount: number }[],
    total: number,
    meta: SaleMeta
  ) => Promise<void>;

  getSecureTime: () => Date;
}

const POSContext = createContext<POSContextType | undefined>(undefined);

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) throw new Error("usePOS must be used within a POSProvider");
  return context;
};

// ---- helpers ----
const OFFLINE_QUEUE_KEY = "themasters_offline_queue";
const HELD_SALES_KEY = "themasters_held_sales";
const USER_KEY = "themasters_user";

const newLineId = () => `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const ensureLineIds = (items: any[]): CartItem[] => {
  return (items || []).map((it: any) => ({
    ...it,
    lineId: it.lineId || newLineId(),
    discountType: it.discountType || "percentage",
    discount: typeof it.discount === "number" ? it.discount : 0,
  }));
};

const safeJSONParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const POSProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, _setCurrentUser] = useState<User | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("online");

  const [heldSales, setHeldSales] = useState<Sale[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [posMode, setPosMode] = useState<POSMode>("retail");

  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [customerName, setCustomerName] = useState("");
  const [activeDiscount, setActiveDiscount] = useState<Discount | null>(null);

  const syncingRef = useRef(false);

  // --- 1) SESSION PERSISTENCE ---
  useEffect(() => {
    const savedUser = localStorage.getItem(USER_KEY);
    if (!savedUser) return;
    try {
      _setCurrentUser(JSON.parse(savedUser));
    } catch (e) {
      console.error("Failed to parse saved user", e);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  const setCurrentUser = (user: User | null) => {
    _setCurrentUser(user);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  };

  // --- 2) LOAD HELD SALES + QUEUE COUNT ---
  useEffect(() => {
    const savedHeld = safeJSONParse<Sale[]>(localStorage.getItem(HELD_SALES_KEY), []);
    const normalizedHeld = savedHeld.map((s: any) => ({
      ...s,
      items: ensureLineIds(s.items || []),
    }));
    setHeldSales(normalizedHeld);

    const savedQueue = safeJSONParse<any[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
    setPendingSyncCount(savedQueue.length);
  }, []);

  useEffect(() => {
    localStorage.setItem(HELD_SALES_KEY, JSON.stringify(heldSales));
  }, [heldSales]);

  // --- 3) ONLINE/OFFLINE + SYNC ---
  useEffect(() => {
    const updateStatus = async () => {
      const isOnline = navigator.onLine;
      setSyncStatus(isOnline ? "online" : "offline");
      if (isOnline) await processOfflineQueue();
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processOfflineQueue = async () => {
    if (syncingRef.current) return;

    const queue = safeJSONParse<any[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
    if (!queue.length) {
      setPendingSyncCount(0);
      return;
    }

    syncingRef.current = true;
    toast.loading(`Syncing ${queue.length} offline sales...`);
    setSyncStatus("syncing");

    const failed: any[] = [];

    for (const sale of queue) {
      try {
        const saleItems = ensureLineIds(sale.items || []);
        const saleTimestamp = sale.meta?.timestamp ? new Date(sale.meta.timestamp) : new Date();

        // ✅ order header includes receipt fields
        const { data: orderData, error: orderErr } = await supabase
          .from("orders")
          .insert({
            cashier_id: sale.cashierId,
            customer_name: sale.customerName,
            total_amount: sale.total,
            payment_method: sale.payments?.[0]?.method || "cash",
            status: "completed",
            created_at: saleTimestamp,
            receipt_id: sale.meta?.receiptId,
            receipt_number: sale.meta?.receiptNumber,
          })
          .select()
          .single();

        if (orderErr) throw orderErr;

        const itemsPayload = saleItems.map((item: any) => ({
          order_id: orderData.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          price_at_sale: item.customPrice ?? item.product.price,
          cost_at_sale: item.product.cost_price || 0,
          service_note: item.customDescription || null,
        }));

        const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
        if (itemsErr) throw itemsErr;
      } catch (err) {
        console.error("Sync failed for sale", err);
        failed.push(sale);
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failed));
    setPendingSyncCount(failed.length);

    toast.dismiss();
    if (!failed.length) {
      setSyncStatus("online");
      toast.success("All offline sales synced!");
    } else {
      setSyncStatus("error");
      toast.error(`${failed.length} sales failed to sync.`);
    }

    syncingRef.current = false;
  };

  // --- 4) CART (lineId-safe) ---
  const addToCart = (product: Product, desc?: string, price?: number) => {
    setCart((prev) => {
      const isServiceCustom = product.type === "service" && (desc || price !== undefined);

      // Services/custom always new line
      if (isServiceCustom) {
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
          },
        ];
      }

      // Goods stack ONLY if same product and no custom fields
      const existing = prev.find(
        (i) => i.product.id === product.id && !i.customDescription && i.customPrice === undefined
      );

      if (existing) {
        return prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i
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
          customDescription: desc,
          customPrice: price,
        },
      ];
    });
  };

  const removeFromCart = (lineId: string) => setCart((prev) => prev.filter((i) => i.lineId !== lineId));

  const updateCartItemQuantity = (lineId: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(lineId);
      return;
    }
    setCart((prev) => prev.map((i) => (i.lineId === lineId ? { ...i, quantity: qty } : i)));
  };

  const updateCartItemCustom = (lineId: string, desc?: string, price?: number) => {
    setCart((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, customDescription: desc, customPrice: price } : i))
    );
  };

  const updateCartItemDiscount = (lineId: string, discount: number, type: "percentage" | "fixed") => {
    setCart((prev) => prev.map((i) => (i.lineId === lineId ? { ...i, discount, discountType: type } : i)));
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    setActiveDiscount(null);
  };

  // --- 5) HELD SALES ---
  const holdCurrentSale = () => {
    if (!cart.length) return;
    if (!currentUser) return toast.error("No cashier logged in");

    const normalizedItems = ensureLineIds(cart);

    const subtotal = normalizedItems.reduce((sum, i) => {
      const price = i.customPrice ?? i.product.price;
      const itemTotal = price * i.quantity;
      const itemDiscount = i.discountType === "percentage" ? itemTotal * (i.discount / 100) : i.discount;
      return sum + itemTotal - itemDiscount;
    }, 0);

    const held: Sale = {
      id: `held-${Date.now()}`,
      items: normalizedItems,
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
    toast.info("Sale Held (F3)");
  };

  const resumeSale = (id: string) => {
    const sale = heldSales.find((s) => s.id === id);
    if (!sale) return;

    setCart(ensureLineIds(sale.items as any));
    setCustomerName(sale.customerName || "");
    setHeldSales((prev) => prev.filter((s) => s.id !== id));
    toast.success("Sale Resumed");
  };

// --- 6) COMPLETE SALE (offline-first with receipt meta) ---
const saveToOfflineQueue = (sale: any) => {
  const queue = safeJSONParse<any[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
  queue.push(sale);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  setPendingSyncCount(queue.length);
};

const completeSale: POSContextType["completeSale"] = async (payments, total, meta) => {
  if (!currentUser) {
    toast.error("No cashier logged in");
    return;
  }
  if (!cart.length) {
    toast.error("Cart is empty");
    return;
  }

  const saleData = {
    cashierId: currentUser.id,
    customerName,
    total,
    payments,
    items: ensureLineIds(cart),
    meta,
    synced: false,
  };

  // Optimistic clear
  clearCart();

  if (navigator.onLine) {
    try {
      const { data: order, error } = await supabase
        .from("orders")
        .insert({
          cashier_id: saleData.cashierId,
          customer_name: saleData.customerName,
          total_amount: saleData.total,
          payment_method: saleData.payments[0]?.method || "cash",
          status: "completed",
          created_at: new Date(meta.timestamp),
          receipt_id: meta.receiptId,
          receipt_number: meta.receiptNumber,
        })
        .select()
        .single();

      if (error) throw error;

      const itemsPayload = saleData.items.map((item: any) => ({
        order_id: order.id,
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        price_at_sale: item.customPrice ?? item.product.price,
        cost_at_sale: item.product.cost_price || 0,
        service_note: item.customDescription || null,
      }));

      const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      toast.success("Sale Saved & Synced");
      return;
    } catch (err) {
      console.error("Online save failed, queueing offline", err);
      saveToOfflineQueue(saleData);
      toast.warning("Saved Offline (Sync failed)");
      return;
    }
  }

  // Offline
  saveToOfflineQueue(saleData);
  toast.success("Saved Offline");
};


  const applyDiscountCode = (_code: string) => false;

  const value = useMemo<POSContextType>(
    () => ({
      currentUser,
      setCurrentUser,
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