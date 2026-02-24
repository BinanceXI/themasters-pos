import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  requireAuthedSessionOrBlockSync,
  SYNC_PAUSED_AUTH_MESSAGE,
  type SyncBlockedReason,
} from "@/lib/supabaseSession";

export const PRODUCTS_QUEUE_KEY = "themasters_products_mutation_queue_v2";

export type ProductUpsertPayload = {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  stock_quantity: number;
  type: string;
  category: string;
  sku?: string | null;
  shortcut_code?: string | null;
  image_url?: string | null;
  barcode?: string | null;
  low_stock_threshold?: number | null;
  is_variable_price?: boolean | null;
  requires_note?: boolean | null;
  is_archived?: boolean | null;
};

type InventoryMutationMeta = {
  ts: number;
  lastError?: string;
  lastAttemptAt?: string;
};

export type InventoryOfflineMutation =
  | ({ kind: "upsert_product"; payload: ProductUpsertPayload } & InventoryMutationMeta)
  | ({ kind: "archive_product"; id: string } & InventoryMutationMeta)
  | ({ kind: "set_stock"; id: string; stock_quantity: number } & InventoryMutationMeta);

export type InventoryQueueFailure = {
  kind: InventoryOfflineMutation["kind"];
  itemId: string;
  lastError: string;
  lastAttemptAt?: string;
};

type ProcessInventoryQueueResult = {
  processed: number;
  failed: number;
  blockedReason?: SyncBlockedReason;
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function notifyQueueChanged() {
  try {
    window.dispatchEvent(new Event("themasters:queue_changed"));
  } catch {
    // ignore
  }
}

function errorToMessage(e: unknown) {
  const msg = String((e as any)?.message || "").trim();
  if (msg) return msg;
  return String(e || "Request failed");
}

function withErrorMeta(m: InventoryOfflineMutation, message: string): InventoryOfflineMutation {
  return {
    ...m,
    lastError: String(message || "Request failed"),
    lastAttemptAt: new Date().toISOString(),
  } as InventoryOfflineMutation;
}

export function enqueueInventoryMutation(m: InventoryOfflineMutation) {
  const q = safeParse<InventoryOfflineMutation[]>(localStorage.getItem(PRODUCTS_QUEUE_KEY), []);
  q.push({ ...(m as any), lastError: undefined, lastAttemptAt: undefined } as InventoryOfflineMutation);
  localStorage.setItem(PRODUCTS_QUEUE_KEY, JSON.stringify(q));
  notifyQueueChanged();
}

export function readInventoryQueue(): InventoryOfflineMutation[] {
  return safeParse<InventoryOfflineMutation[]>(localStorage.getItem(PRODUCTS_QUEUE_KEY), []);
}

function writeInventoryQueue(next: InventoryOfflineMutation[]) {
  localStorage.setItem(PRODUCTS_QUEUE_KEY, JSON.stringify(next));
  notifyQueueChanged();
}

export function getInventoryQueueCount(): number {
  return readInventoryQueue().length;
}

export function getInventoryQueueFailedCount(): number {
  return readInventoryQueue().filter((m) => !!String((m as any)?.lastError || "").trim()).length;
}

export function listInventoryQueueFailures(): InventoryQueueFailure[] {
  return readInventoryQueue()
    .filter((m) => !!String((m as any)?.lastError || "").trim())
    .map((m) => ({
      kind: m.kind,
      itemId: m.kind === "upsert_product" ? String(m.payload.id) : String(m.id),
      lastError: String(m.lastError || "Request failed"),
      lastAttemptAt: m.lastAttemptAt || undefined,
    }));
}

export function annotateInventoryQueueError(msg: string) {
  const message = String(msg || "").trim();
  if (!message) return;
  const queue = readInventoryQueue();
  if (!queue.length) return;
  writeInventoryQueue(queue.map((m) => withErrorMeta(m, message)));
}

export async function processInventoryQueue(opts?: { silent?: boolean; queryClient?: QueryClient }): Promise<ProcessInventoryQueueResult> {
  const silent = !!opts?.silent;
  const queryClient = opts?.queryClient;

  if (!navigator.onLine) return { processed: 0, failed: 0 };

  const queue = readInventoryQueue();
  if (!queue.length) return { processed: 0, failed: 0 };

  const authGate = await requireAuthedSessionOrBlockSync();
  if (!authGate.ok) {
    annotateInventoryQueueError(authGate.message);
    if (!silent) toast.error(SYNC_PAUSED_AUTH_MESSAGE);
    return { processed: 0, failed: queue.length, blockedReason: authGate.reason };
  }

  const toastId = silent ? null : toast.loading(`Syncing ${queue.length} inventory changes...`);
  const failed: InventoryOfflineMutation[] = [];

  try {
    for (const m of queue) {
      try {
        if (m.kind === "upsert_product") {
          const { error } = await supabase.from("products").upsert(m.payload, { onConflict: "id" });
          if (error) throw error;
        }

        if (m.kind === "archive_product") {
          const { error } = await supabase.from("products").update({ is_archived: true }).eq("id", m.id);
          if (error) throw error;
        }

        if (m.kind === "set_stock") {
          const { error } = await supabase.from("products").update({ stock_quantity: m.stock_quantity }).eq("id", m.id);
          if (error) throw error;
        }
      } catch (e) {
        failed.push(withErrorMeta(m, errorToMessage(e)));
      }
    }

    writeInventoryQueue(failed);

    if (!failed.length) {
      if (!silent) toast.success("Inventory synced");
      if (queryClient) queryClient.invalidateQueries({ queryKey: ["products"] });
    } else {
      if (!silent) toast.error(`${failed.length} inventory changes failed to sync`);
    }

    return { processed: queue.length - failed.length, failed: failed.length };
  } finally {
    if (toastId != null) toast.dismiss(toastId);
  }
}
