// File: src/lib/thermalPrint.ts
import { Capacitor } from "@capacitor/core";
import type { ThermalJob } from "@/lib/printQueue";
import { getThermalQueue, removeThermalJob } from "@/lib/printQueue";

// settings keys (used by your Settings UI)
export const PRINTER_MODE_KEY = "themasters_printer_mode"; // "browser" | "tcp"
export const PRINTER_IP_KEY = "themasters_printer_ip"; // e.g. 192.168.1.50
export const PRINTER_PORT_KEY = "themasters_printer_port"; // usually 9100

const encoder = new TextEncoder();
const ESC = 0x1b;
const GS = 0x1d;

function bytes(...arr: number[]) {
  return new Uint8Array(arr);
}
function textLine(s: string) {
  return encoder.encode(s + "\n");
}
function concat(parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export type ThermalReceiptData = {
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

function buildEscPos(d: ThermalReceiptData) {
  const parts: Uint8Array[] = [];

  parts.push(bytes(ESC, 0x40)); // init
  parts.push(bytes(ESC, 0x61, 0x01)); // center
  parts.push(bytes(ESC, 0x45, 0x01)); // bold on
  parts.push(textLine("THEMASTERS POS"));
  parts.push(bytes(ESC, 0x45, 0x00)); // bold off
  parts.push(textLine(`Receipt: ${d.receiptNumber}`));
  parts.push(textLine(d.timestamp));
  parts.push(bytes(ESC, 0x61, 0x00)); // left

  parts.push(textLine("--------------------------------"));

  for (const it of d.cart) {
    const name = String(it.product?.name ?? "Item").slice(0, 32);
    const qty = Number(it.quantity || 0);
    const price = Number(it.customPrice ?? it.product?.price ?? 0);
    const line = qty * price;

    parts.push(textLine(name));
    parts.push(textLine(`  ${qty} x ${price.toFixed(2)} = ${line.toFixed(2)}`));
  }

  parts.push(textLine("--------------------------------"));
  parts.push(textLine(`Subtotal: ${d.subtotal.toFixed(2)}`));
  if (d.discount > 0) parts.push(textLine(`Discount: -${d.discount.toFixed(2)}`));
  if (d.tax > 0) parts.push(textLine(`Tax: ${d.tax.toFixed(2)}`));

  parts.push(bytes(ESC, 0x45, 0x01));
  parts.push(textLine(`TOTAL: ${d.total.toFixed(2)}`));
  parts.push(bytes(ESC, 0x45, 0x00));

  parts.push(textLine("--------------------------------"));
  parts.push(bytes(ESC, 0x61, 0x01));
  parts.push(textLine(`Paid: ${String(d.paymentMethod).toUpperCase()}`));
  parts.push(textLine("Thank you!"));
  parts.push(bytes(ESC, 0x61, 0x00));

  parts.push(bytes(ESC, 0x64, 0x04)); // feed
  parts.push(bytes(GS, 0x56, 0x00)); // cut

  return concat(parts);
}


async function sendTcp(ip: string, port: number, data: Uint8Array) {
  // ❌ NEVER run in web / dev
  if (Capacitor.getPlatform() !== "android") {
    throw new Error("TCP printing only supported on Android");
  }

  // ✅ plugin is injected by Capacitor at runtime
  const TcpSocket = (window as any)?.Capacitor?.Plugins?.TcpSocket;
  if (!TcpSocket) throw new Error("TCP plugin not available");

  const socketId = await TcpSocket.connect({ host: ip, port });

  const bin = Array.from(data).map((b) => String.fromCharCode(b)).join("");
  const b64 = btoa(bin);

  await TcpSocket.write({ socketId, data: b64, encoding: "base64" });
  await TcpSocket.close({ socketId });
}

export async function printReceiptSmart(d: ThermalReceiptData) {
  const mode = (localStorage.getItem(PRINTER_MODE_KEY) || "browser").trim();

  if (mode === "browser") {
    window.print();
    return;
  }

  const ip = (localStorage.getItem(PRINTER_IP_KEY) || "").trim();
  const port = Number(localStorage.getItem(PRINTER_PORT_KEY) || "9100");
  if (!ip) throw new Error("Printer IP not set");

  const data = buildEscPos(d);

  const platform = Capacitor.getPlatform();
  if (platform === "android") {
    await sendTcp(ip, port, data);
    return;
  }

  // desktop dev fallback
  window.print();
}

// --------------------
// QUEUE PROCESSOR
// --------------------
let processing = false;

export async function tryPrintThermalQueue() {
  if (processing) return;
  processing = true;

  try {
    const q = getThermalQueue();
    if (!q.length) return;

    const job: ThermalJob = q[0];

    await printReceiptSmart(job as any);

    removeThermalJob(job.receiptNumber);
  } catch (err) {
    console.warn("Thermal print failed (kept queued):", err);
  } finally {
    processing = false;
  }
}