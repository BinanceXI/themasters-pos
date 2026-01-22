// File: src/lib/printQueue.ts
export const THERMAL_QUEUE_KEY = "themasters_thermal_print_queue_v1";

export type ThermalJob = {
  receiptNumber: string;
  timestamp: string;
  cashierName: string;
  customerName?: string;
  paymentMethod: string;
  cart: Array<{ product: { name: string; price: number }; quantity: number; customPrice?: number }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

function readQueue(): ThermalJob[] {
  try {
    return JSON.parse(localStorage.getItem(THERMAL_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(q: ThermalJob[]) {
  localStorage.setItem(THERMAL_QUEUE_KEY, JSON.stringify(q || []));
}

export function enqueueThermalJob(job: ThermalJob) {
  const q = readQueue();
  q.push(job);
  writeQueue(q);
}

export function getThermalQueue(): ThermalJob[] {
  return readQueue();
}

export function clearThermalQueue() {
  writeQueue([]);
}

export function removeThermalJob(receiptNumber: string) {
  const q = readQueue().filter((j) => j.receiptNumber !== receiptNumber);
  writeQueue(q);
}