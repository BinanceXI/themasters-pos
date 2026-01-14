import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Plus,
  Minus,
  Trash2,
  User,
  ScanLine,
  ShoppingCart,
  Zap,
  Loader2,
  Box,
  CloudOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePOS } from "@/contexts/POSContext";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { Product, CartItem } from "@/types/pos";
import { cn } from "@/lib/utils";
import { PaymentPanel, PaymentPanelRef } from "@/components/pos/PaymentPanel";
import { BarcodeScanner } from "@/components/pos/BarcodeScanner";
import { PrintableReceipt } from "@/components/pos/PrintableReceipt";
import { useSecureTime } from "@/lib/secureTime";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type FocusArea = "search" | "customer" | "products" | "cart";

function isEditableTarget(el: Element | null) {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName?.toLowerCase();
  const editable = (el as HTMLElement).getAttribute?.("contenteditable");
  return tag === "input" || tag === "textarea" || editable === "true";
}

function makeReceiptId() {
  // Works on modern browsers; fallback for older ones
  // @ts-ignore
  return globalThis.crypto?.randomUUID?.() ?? `rcpt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function makeReceiptNumber() {
  return `TM-${Date.now().toString().slice(-6)}`;
}

export const POSPage = () => {
  // ---- PRINTING STATE ----
  const [lastOrderData, setLastOrderData] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!lastOrderData) return;

    const timer = setTimeout(() => {
      try {
        setIsPrinting(true);
        window.print();
      } finally {
        setTimeout(() => setIsPrinting(false), 700);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [lastOrderData]);

  // ---- UI STATE ----
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode] = useState<"grid" | "list">("grid");
  const [selectedProductIndex, setSelectedProductIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showDiscountDialog, setShowDiscountDialog] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [focusArea, setFocusArea] = useState<FocusArea>("products");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const paymentPanelRef = useRef<PaymentPanelRef>(null);

  const {
    cart,
    addToCart,
    removeFromCart,
    updateCartItemQuantity,
    clearCart,
    selectedCategory,
    setSelectedCategory,
    holdCurrentSale,
    customerName,
    setCustomerName,
    activeDiscount,
    setActiveDiscount,
    posMode,
    setPosMode,
    currentUser,
    completeSale,
    syncStatus,
  } = usePOS();

  const { formatDate } = useSecureTime();

  // ---- PRODUCTS (cached by React Query; offline shows last cached data) ----
  const {
    data: productsRaw = [],
    isLoading: productsLoading,
    isError,
  } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;

      return (data || []).map((p: any) => ({
        ...p,
        shortcutCode: p.shortcut_code,
        lowStockThreshold: p.low_stock_threshold || 5,
        image: p.image_url,
      })) as Product[];
    },
    staleTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const products = productsRaw;

  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.category)))
        .filter(Boolean)
        .map((c) => ({ id: c as string, name: c as string })),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const raw = searchQuery.trim();

    return products.filter((product) => {
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        (!!product.sku && product.sku.toLowerCase().includes(query)) ||
        (!!product.barcode && product.barcode.includes(raw)) ||
        (!!product.shortcutCode && product.shortcutCode.toLowerCase() === query);

      const matchesCategory =
        !selectedCategory || selectedCategory === "all" || product.category === selectedCategory;

      const matchesMode =
        posMode === "retail" ? product.type !== "service" : product.type === "service";

      return matchesSearch && matchesCategory && matchesMode;
    });
  }, [products, searchQuery, selectedCategory, posMode]);

  useEffect(() => {
    if (filteredProducts.length === 0) {
      setSelectedProductIndex(0);
      return;
    }
    setSelectedProductIndex((i) => Math.max(0, Math.min(i, filteredProducts.length - 1)));
  }, [filteredProducts.length]);

  // ---- TOTALS ----
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item: CartItem) => {
      const price = item.customPrice ?? item.product.price;
      const itemTotal = price * item.quantity;

      const itemDiscount =
        item.discountType === "percentage"
          ? itemTotal * (item.discount / 100)
          : item.discount;

      return sum + itemTotal - itemDiscount;
    }, 0);
  }, [cart]);

  const globalDiscount = useMemo(() => {
    if (!activeDiscount) return 0;
    return activeDiscount.type === "percentage"
      ? subtotal * (activeDiscount.value / 100)
      : activeDiscount.value;
  }, [activeDiscount, subtotal]);

  const discountedSubtotal = subtotal - globalDiscount;
  const tax = discountedSubtotal * 0.1;
  const total = discountedSubtotal + tax;

  // ---- QUICK ENTRY ----
  const handleQuickEntry = useCallback(
    (code: string) => {
      const trimmed = (code || "").trim();
      if (!trimmed) return false;

      const product = products.find(
        (p) =>
          p.barcode === trimmed ||
          p.sku === trimmed ||
          (!!p.shortcutCode && p.shortcutCode.toLowerCase() === trimmed.toLowerCase())
      );

      if (!product) return false;

      if (product.type === "good" && (product.stock_quantity ?? 0) <= 0) {
        toast.error("Out of stock");
        return true;
      }

      addToCart(product);
      setSearchQuery("");
      toast.success(`${product.name} added`);
      return true;
    },
    [addToCart, products]
  );

  // ---- PAYMENT COMPLETE (prints factual receipt fields) ----
const handlePaymentComplete = async (method: string) => {
  const receiptId =
    globalThis.crypto?.randomUUID?.() ?? `rcpt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const receiptNumber = `TM-${Date.now().toString().slice(-6)}`;
  const timestamp = new Date().toISOString();

  await completeSale([{ method, amount: total }], total, { receiptId, receiptNumber, timestamp });

  setLastOrderData({
    cart: [...cart],
    total,
    cashierName: currentUser?.name || "Staff",
    customerName: customerName?.trim() || "",
    receiptId,
    receiptNumber,
    paymentMethod: method,
    timestamp,
  });
};

  // ---- DISCOUNT ----
  const handleApplyDiscount = useCallback(() => {
    if (discountCode.trim().toUpperCase() === "VIP10") {
      setActiveDiscount({ id: "VIP10", name: "VIP", type: "percentage", value: 10, active: true });
      setShowDiscountDialog(false);
      setDiscountCode("");
      toast.success("VIP Discount Applied");
      return;
    }
    toast.error("Invalid Discount Code");
  }, [discountCode, setActiveDiscount]);

  // ---- KEYBOARD ----
  const moveSelection = useCallback(
    (delta: number) => {
      if (filteredProducts.length === 0) return;
      setSelectedProductIndex((i) => Math.max(0, Math.min(i + delta, filteredProducts.length - 1)));
    },
    [filteredProducts.length]
  );

  const addSelectedProduct = useCallback(() => {
    if (filteredProducts.length === 0) return;
    const p = filteredProducts[selectedProductIndex];
    if (!p) return;

    if (p.type === "good" && (p.stock_quantity ?? 0) <= 0) {
      toast.error("Out of stock");
      return;
    }

    addToCart(p);
    toast.success(`${p.name} added`);
  }, [filteredProducts, selectedProductIndex, addToCart]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const targetEditable = isEditableTarget(document.activeElement);

      if (e.key === "Escape") {
        if (showScanner) {
          e.preventDefault();
          setShowScanner(false);
          return;
        }
        if (showDiscountDialog) {
          e.preventDefault();
          setShowDiscountDialog(false);
          return;
        }
      }

      if (e.key === "F1") { e.preventDefault(); setShowShortcuts((p) => !p); return; }
      if (e.key === "F2") { e.preventDefault(); searchInputRef.current?.focus(); setFocusArea("search"); return; }
      if (e.key === "F8") { e.preventDefault(); customerInputRef.current?.focus(); setFocusArea("customer"); return; }
      if (e.key === "F9") { e.preventDefault(); setShowScanner(true); return; }
      if (e.key === "F10") { e.preventDefault(); setPosMode(posMode === "retail" ? "service" : "retail"); return; }
      if (e.key === "F3") { e.preventDefault(); if (cart.length > 0) holdCurrentSale(); return; }
      if (e.key === "F12") { e.preventDefault(); if (cart.length > 0) paymentPanelRef.current?.openPayment?.(); return; }
      if (e.key === "F4") { e.preventDefault(); paymentPanelRef.current?.selectPaymentMethod?.(0); return; }

      if (targetEditable) {
        if (document.activeElement === searchInputRef.current && e.key === "Enter") {
          if (!searchQuery.trim()) return;
          e.preventDefault();
          const found = handleQuickEntry(searchQuery);
          if (!found && filteredProducts.length > 0) {
            const first = filteredProducts[0];
            if (first.type === "good" && (first.stock_quantity ?? 0) <= 0) return;
            addToCart(first);
            setSearchQuery("");
          }
        }
        return;
      }

      if (e.key === "ArrowDown") { e.preventDefault(); setFocusArea("products"); moveSelection(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setFocusArea("products"); moveSelection(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); addSelectedProduct(); return; }

      if (e.key === "Delete") {
        if (cart.length > 0) {
          e.preventDefault();
          clearCart();
          toast.info("Cart cleared");
        }
      }
    },
    [
      showScanner,
      showDiscountDialog,
      searchQuery,
      cart.length,
      posMode,
      setPosMode,
      holdCurrentSale,
      handleQuickEntry,
      filteredProducts,
      addToCart,
      moveSelection,
      addSelectedProduct,
      clearCart,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", handleKeyDown as any);
  }, [handleKeyDown]);

  // ---- CART HANDLERS (by productId) ----
const decQty = useCallback(
  (lineId: string, currentQty: number) => updateCartItemQuantity(lineId, currentQty - 1),
  [updateCartItemQuantity]
);

const incQty = useCallback(
  (lineId: string, currentQty: number) => updateCartItemQuantity(lineId, currentQty + 1),
  [updateCartItemQuantity]
);

const removeLine = useCallback(
  (lineId: string) => removeFromCart(lineId),
  [removeFromCart]
);

  return (
    <div className="flex h-full flex-col lg:flex-row bg-background">
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed left-4 top-20 z-50 bg-popover border border-border rounded-xl p-4 shadow-xl w-96 text-popover-foreground"
          >
            <div className="flex justify-between mb-2 font-bold">
              <h3>Shortcuts</h3>
              <X className="cursor-pointer" onClick={() => setShowShortcuts(false)} />
            </div>

            <div className="text-xs grid grid-cols-2 gap-2">
              <div><kbd className="bg-muted px-1 rounded">F2</kbd> Search</div>
              <div><kbd className="bg-muted px-1 rounded">F8</kbd> Customer</div>
              <div><kbd className="bg-muted px-1 rounded">F9</kbd> Scan</div>
              <div><kbd className="bg-muted px-1 rounded">F10</kbd> Retail/Service</div>
              <div><kbd className="bg-muted px-1 rounded">F12</kbd> Pay</div>
              <div><kbd className="bg-muted px-1 rounded">F3</kbd> Hold Sale</div>
              <div><kbd className="bg-muted px-1 rounded">↑ ↓</kbd> Navigate products</div>
              <div><kbd className="bg-muted px-1 rounded">Enter</kbd> Add selected</div>
              <div><kbd className="bg-muted px-1 rounded">Del</kbd> Clear cart</div>
              <div><kbd className="bg-muted px-1 rounded">Esc</kbd> Close panels</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LEFT COLUMN */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 dark:bg-slate-950/50">
        <div className="p-3 bg-card border-b border-border flex justify-between items-center gap-3 shadow-sm z-10">
          <div className="text-xs font-mono bg-muted px-2 py-1 rounded flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                syncStatus === "online" && "bg-green-500 animate-pulse",
                syncStatus === "offline" && "bg-amber-500",
                syncStatus === "syncing" && "bg-blue-500 animate-pulse",
                syncStatus === "error" && "bg-red-500"
              )}
            />
            {formatDate("datetime")}
            {syncStatus === "offline" && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-500">
                <CloudOff className="w-3 h-3" /> Offline
              </span>
            )}
          </div>

          <div className="flex bg-muted p-1 rounded-lg">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPosMode("retail")}
              className={cn("h-7 text-xs rounded-md", posMode === "retail" && "bg-background shadow-sm text-foreground")}
            >
              <Box className="w-3 h-3 mr-1" /> Retail
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPosMode("service")}
              className={cn("h-7 text-xs rounded-md", posMode === "service" && "bg-background shadow-sm text-foreground")}
            >
              <Zap className="w-3 h-3 mr-1" /> Service
            </Button>
          </div>

          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowScanner(true)}>
            <ScanLine className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-3 space-y-3">
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              ref={searchInputRef}
              placeholder="Search Item, SKU, or Scan (F2)..."
              className="pl-9 h-10 font-mono text-sm bg-card shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setFocusArea("search")}
            />
            <div className="absolute right-2 top-2.5 flex gap-1">
              <kbd className="hidden sm:inline-block pointer-events-none h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                F2
              </kbd>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <Button
              size="sm"
              variant={selectedCategory === null ? "default" : "secondary"}
              onClick={() => setSelectedCategory(null)}
              className="h-8 px-4 text-xs rounded-full shrink-0"
            >
              All Items
            </Button>
            {categories.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={selectedCategory === c.id ? "default" : "outline"}
                onClick={() => setSelectedCategory(selectedCategory === c.id ? null : c.id)}
                className="h-8 px-4 text-xs rounded-full shrink-0 bg-card hover:bg-muted"
              >
                {c.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 p-3 overflow-y-auto min-h-0">
          {productsLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">Failed to load products.</p>
              <p className="text-xs opacity-70">
                If offline, cached products will show once you have fetched them at least once.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
              <Search className="w-12 h-12 mb-2" />
              <p>No products found</p>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-3 pb-24",
                viewMode === "grid"
                  ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  : "grid-cols-1"
              )}
              onMouseEnter={() => setFocusArea("products")}
            >
              {filteredProducts.map((product, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={(p) => {
                    addToCart(p);
                    setFocusArea("products");
                  }}
                  isSelected={i === selectedProductIndex && focusArea === "products"}
                  onHover={() => setSelectedProductIndex(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="w-full lg:w-[420px] flex flex-col bg-card border-l border-border h-[calc(100vh-3.5rem)] lg:h-full shadow-2xl z-20">
        <div className="p-4 border-b space-y-3 bg-card">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Current Sale
              <span className="bg-primary/10 text-primary text-xs rounded-full px-2 py-0.5">
                {cart.length}
              </span>
            </h2>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearCart();
                  toast.info("Cart cleared");
                }}
                className="text-destructive h-8 text-xs hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
          </div>

          <div className="relative">
            <User className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              ref={customerInputRef}
              placeholder="Customer Name (Optional) [F8]"
              className="pl-9 h-9 text-sm bg-muted/50 border-transparent focus:bg-background focus:border-input transition-all"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              onFocus={() => setFocusArea("customer")}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/10" onMouseEnter={() => setFocusArea("cart")}>
          <AnimatePresence mode="popLayout">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-40">
                <ShoppingCart className="w-12 h-12 mb-2" />
                <p className="text-sm">Cart is empty</p>
                <p className="text-xs">Scan or click items to add</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <CartItemRow
                  // If you later support duplicate service lines, you’ll need lineId.
                  // For now this matches your current context (stacking by product.id).
                  key={`${item.product.id}-${idx}`}
                  item={item}
                  onDec={() => decQty(item.lineId, item.quantity)}
onInc={() => incQty(item.lineId, item.quantity)}
onRemove={() => removeLine(item.lineId)}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        <PaymentPanel
          ref={paymentPanelRef}
          subtotal={subtotal}
          discount={globalDiscount}
          tax={tax}
          total={total}
          onComplete={handlePaymentComplete}
        />
      </div>

      <BarcodeScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => {
          const ok = handleQuickEntry(code);
          if (!ok) toast.error("Item not found");
          setShowScanner(false);
        }}
      />

      <Dialog open={showDiscountDialog} onOpenChange={setShowDiscountDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Discount Code</DialogTitle>
          </DialogHeader>
          <Input value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} placeholder="Code..." autoFocus />
          <Button onClick={handleApplyDiscount} className="w-full mt-2">
            Apply
          </Button>
        </DialogContent>
      </Dialog>

      {/* ✅ INVISIBLE PRINT CONTAINER */}
      <div id="receipt-print-area" className="fixed top-0 left-[-9999px]">
  {lastOrderData && (
  <PrintableReceipt
    cart={lastOrderData.cart}
    total={lastOrderData.total}
    cashierName={lastOrderData.cashierName}
    customerName={lastOrderData.customerName}
    receiptId={lastOrderData.receiptId}
    receiptNumber={lastOrderData.receiptNumber}
    paymentMethod={lastOrderData.paymentMethod}
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

// ---- SUB COMPONENTS ----

const ProductCard = ({
  product,
  onAdd,
  isSelected,
  onHover,
}: {
  product: Product;
  onAdd: (p: Product) => void;
  isSelected: boolean;
  onHover: () => void;
}) => {
  const isOutOfStock = product.type === "good" && (product.stock_quantity ?? 0) <= 0;

  return (
    <button
      type="button"
      disabled={isOutOfStock}
      onMouseEnter={onHover}
      onClick={() => onAdd(product)}
      className={cn(
        "flex flex-col p-3 rounded-xl border text-left transition-all relative overflow-hidden bg-card hover:shadow-md hover:border-primary/50 group active:scale-[0.98] duration-150",
        isSelected && "ring-2 ring-primary border-primary",
        isOutOfStock && "opacity-50 grayscale cursor-not-allowed bg-muted"
      )}
    >
      {product.type === "good" &&
        !isOutOfStock &&
        (product.stock_quantity ?? 0) <= (product.lowStockThreshold || 5) && (
          <span className="absolute top-2 right-2 bg-amber-500/10 text-amber-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            Low Stock
          </span>
        )}

      <div className="w-full aspect-[4/3] rounded-lg bg-muted mb-3 overflow-hidden flex items-center justify-center">
        {product.image ? (
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
            <span className="font-bold text-sm">{product.name.charAt(0)}</span>
          </div>
        )}
      </div>

      <div className="font-semibold text-sm truncate w-full leading-tight">{product.name}</div>
      <div className="text-[10px] text-muted-foreground mb-3">{product.category || "General"}</div>

      <div className="mt-auto flex justify-between items-end w-full">
        <span className="font-bold text-primary text-base">${product.price}</span>
        {product.type === "good" && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded">
            {product.stock_quantity ?? 0} left
          </span>
        )}
      </div>
    </button>
  );
};

const CartItemRow = ({
  item,
  onDec,
  onInc,
  onRemove,
}: {
  item: CartItem;
  onDec: () => void;
  onInc: () => void;
  onRemove: () => void;
}) => {
  const unitPrice = item.customPrice ?? item.product.price;

  return (
    <motion.div
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      className="bg-card border border-border p-2.5 rounded-lg flex justify-between items-center shadow-sm"
    >
      <div className="overflow-hidden flex-1 mr-2">
        <div className="font-medium text-sm truncate">{item.product.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <span className="font-mono text-primary">${unitPrice}</span>
          <span>x</span>
          <span>{item.quantity}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 hover:bg-background shadow-sm" onClick={onDec}>
          <Minus className="w-3 h-3" />
        </Button>

        <span className="text-xs font-bold w-6 text-center font-mono">{item.quantity}</span>

        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 hover:bg-background shadow-sm" onClick={onInc}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-1"
        onClick={onRemove}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </motion.div>
  );
};


