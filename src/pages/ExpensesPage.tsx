import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePOS } from "@/contexts/POSContext";
import { toast } from "sonner";
import {
  addExpense,
  deleteExpense,
  getExpenseQueueCount,
  listExpenses,
  syncExpenses,
  updateExpense,
  type Expense,
  type ExpenseType,
} from "@/lib/expenses";
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "date-fns";
import {
  Plus,
  RefreshCw,
  WifiOff,
  Pencil,
  Trash2,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type RangeType = "today" | "week" | "month";

function money(n: any) {
  const num = typeof n === "number" ? n : Number(String(n ?? "").trim());
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function newId() {
  // @ts-ignore
  return globalThis.crypto?.randomUUID?.() ?? `exp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatLocal(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export const ExpensesPage = () => {
  const queryClient = useQueryClient();
  const { syncStatus, currentUser } = usePOS();

  const [rangeType, setRangeType] = useState<RangeType>("today");
  const [typeFilter, setTypeFilter] = useState<"all" | ExpenseType>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [queueCount, setQueueCount] = useState<number>(() => getExpenseQueueCount());
  const [syncing, setSyncing] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const [formCategory, setFormCategory] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formType, setFormType] = useState<ExpenseType>("expense");
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("");
  const [formOccurredAt, setFormOccurredAt] = useState<string>(() => toDatetimeLocalValue(new Date()));
  const [formNotes, setFormNotes] = useState<string>("");

  const range = useMemo(() => {
    const now = new Date();
    if (rangeType === "today") {
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    }
    if (rangeType === "week") {
      return { from: startOfDay(subDays(now, 7)).toISOString(), to: endOfDay(now).toISOString() };
    }
    return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() };
  }, [rangeType]);

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", range.from, range.to],
    queryFn: async () => listExpenses(range),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: "always",
  });

  const { data: revenueOrders = [] } = useQuery({
    queryKey: ["expensesRevenue", range.from, range.to],
    enabled: navigator.onLine,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("total_amount, created_at")
        .gte("created_at", range.from)
        .lte("created_at", range.to);
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const revenue = useMemo(
    () => (revenueOrders || []).reduce((sum, o: any) => sum + money(o.total_amount), 0),
    [revenueOrders]
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    (expenses || []).forEach((e) => {
      const c = String((e as any).category || "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [expenses]);

  const filtered = useMemo(() => {
    return (expenses || []).filter((e) => {
      if (typeFilter !== "all" && e.expense_type !== typeFilter) return false;
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      return true;
    });
  }, [expenses, typeFilter, categoryFilter]);

  const totals = useMemo(() => {
    let totalExpenses = 0;
    let totalDrawings = 0;
    for (const e of filtered) {
      const amt = money(e.amount);
      if (e.expense_type === "owner_drawing") totalDrawings += amt;
      else totalExpenses += amt;
    }
    const net = money(revenue - (totalExpenses + totalDrawings));
    return { totalExpenses: money(totalExpenses), totalDrawings: money(totalDrawings), net };
  }, [filtered, revenue]);

  const refreshQueueCount = useCallback(() => setQueueCount(getExpenseQueueCount()), []);

  const openAdd = () => {
    setEditing(null);
    setFormCategory("");
    setFormAmount("");
    setFormType("expense");
    setFormPaymentMethod("");
    setFormOccurredAt(toDatetimeLocalValue(new Date()));
    setFormNotes("");
    setDialogOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setFormCategory(e.category || "");
    setFormAmount(String(money(e.amount)));
    setFormType(e.expense_type);
    setFormPaymentMethod(e.payment_method || "");
    setFormOccurredAt(toDatetimeLocalValue(new Date(e.occurred_at)));
    setFormNotes(e.notes || "");
    setDialogOpen(true);
  };

  const saveForm = async () => {
    const category = formCategory.trim();
    const amount = money(formAmount);
    const occurredAt = new Date(formOccurredAt);
    if (!category) return toast.error("Category is required");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Amount must be greater than 0");
    if (Number.isNaN(occurredAt.getTime())) return toast.error("Invalid date/time");

    const patch = {
      category,
      amount,
      expense_type: formType,
      payment_method: formPaymentMethod.trim() ? formPaymentMethod.trim() : null,
      occurred_at: occurredAt.toISOString(),
      notes: formNotes.trim() ? formNotes.trim() : null,
      source: "pos",
      business_id: null,
      created_by: null,
      synced_at: null,
    } as Partial<Expense>;

    try {
      if (editing) {
        await updateExpense(editing.id, patch);
      } else {
        const nowIso = new Date().toISOString();
        const exp: Expense = {
          id: newId(),
          created_at: nowIso,
          business_id: null,
          created_by: null,
          source: "pos",
          occurred_at: (patch.occurred_at as string) || nowIso,
          category,
          notes: patch.notes ?? null,
          amount,
          payment_method: patch.payment_method ?? null,
          expense_type: formType,
          synced_at: null,
        };
        await addExpense(exp);
      }

      refreshQueueCount();
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "expenses" });
      setDialogOpen(false);

      if (navigator.onLine) {
        try {
          await syncExpenses();
          refreshQueueCount();
        } catch {
          // queued; sync will retry
        }
      }

      toast.success(editing ? "Saved" : "Added");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    }
  };

  const removeExpense = async (id: string) => {
    const ok = confirm("Delete this item?");
    if (!ok) return;
    try {
      await deleteExpense(id);
      refreshQueueCount();
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "expenses" });

      if (navigator.onLine) {
        try {
          await syncExpenses();
          refreshQueueCount();
        } catch {
          // queued; sync will retry
        }
      }

      toast.message("Deleted");
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const doSyncNow = useCallback(async () => {
    if (!navigator.onLine) return toast.error("Offline");
    setSyncing(true);
    try {
      await syncExpenses();
      refreshQueueCount();
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "expenses" });
      toast.success("Synced");
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [queryClient, refreshQueueCount]);

  useEffect(() => {
    const onOnline = () => doSyncNow();
    window.addEventListener("online", onOnline);
    if (navigator.onLine) doSyncNow();
    return () => window.removeEventListener("online", onOnline);
  }, [doSyncNow]);

  return (
    <div className="p-4 md:p-6 space-y-5 pb-24 lg:pb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            {syncStatus === "offline" && (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <WifiOff className="w-4 h-4" /> Offline
              </span>
            )}
            <span>
              Signed in as{" "}
              <b>{currentUser?.name || currentUser?.full_name || currentUser?.username || "User"}</b>
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={openAdd} className="gap-2">
            <Plus className="w-4 h-4" /> Add
          </Button>

          <Button
            variant="outline"
            onClick={doSyncNow}
            disabled={!navigator.onLine || syncing}
            className="gap-2"
            title={!navigator.onLine ? "Offline" : ""}
          >
            <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} /> Sync now
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 bg-card">
          <span className="text-muted-foreground">Offline queued</span>
          <span className={cn("font-semibold", queueCount > 0 ? "text-amber-500" : "text-foreground")}>
            {queueCount}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">${revenue.toFixed(2)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Expenses</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">${totals.totalExpenses.toFixed(2)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Owner Drawings</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">${totals.totalDrawings.toFixed(2)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Net</CardTitle>
          </CardHeader>
          <CardContent className={cn("text-2xl font-bold", totals.net >= 0 ? "text-emerald-500" : "text-red-500")}>
            ${totals.net.toFixed(2)}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Date range</div>
          <Select value={rangeType} onValueChange={(v: any) => setRangeType(v)}>
            <SelectTrigger className="bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Type</div>
          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
              <SelectItem value="owner_drawing">Owner drawings</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Category</div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="bg-card">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-card border rounded-xl p-6 text-center">
            No items for this period.
          </div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className="border border-border rounded-xl p-3 bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border",
                        e.expense_type === "owner_drawing"
                          ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                      )}
                    >
                      {e.expense_type === "owner_drawing" ? (
                        <>
                          <ArrowUpRight className="w-3 h-3" /> Owner drawing
                        </>
                      ) : (
                        <>
                          <ArrowDownRight className="w-3 h-3" /> Expense
                        </>
                      )}
                    </div>

                    <div className="font-semibold truncate">{e.category}</div>
                  </div>

                  <div className="text-xs text-muted-foreground mt-1">
                    {formatLocal(e.occurred_at)}
                    {e.payment_method ? ` • ${e.payment_method}` : ""}
                  </div>

                  {e.notes ? <div className="text-sm mt-2 whitespace-pre-wrap">{e.notes}</div> : null}
                </div>

                <div className="text-right shrink-0">
                  <div className="text-lg font-bold">${money(e.amount).toFixed(2)}</div>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Edit">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeExpense(e.id)}
                      title="Delete"
                      className="text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "Add"} item</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">Amount</div>
              <Input
                type="number"
                inputMode="decimal"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Category</div>
              <Input value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="e.g. Rent" />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Type</div>
              <Select value={formType} onValueChange={(v: any) => setFormType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="owner_drawing">Owner drawing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Payment method (optional)</div>
              <Select value={formPaymentMethod || "none"} onValueChange={(v) => setFormPaymentMethod(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <div className="text-sm font-medium">Date/time</div>
              <Input
                type="datetime-local"
                value={formOccurredAt}
                onChange={(e) => setFormOccurredAt(e.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <div className="text-sm font-medium">Notes (optional)</div>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Details..." />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveForm}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
