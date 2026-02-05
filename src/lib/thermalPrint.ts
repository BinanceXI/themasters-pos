import { Capacitor } from "@capacitor/core";
import type { ThermalJob } from "@/lib/printQueue";
import { getThermalQueue, removeThermalJob } from "@/lib/printQueue";
import { printToBluetooth58mm } from "@/lib/androidBluetoothPrint";

// settings keys (used by your Settings UI)
export const PRINTER_MODE_KEY = "themasters_printer_mode"; // "browser" | "tcp" | "bt"
export const PRINTER_IP_KEY = "themasters_printer_ip"; // e.g. 192.168.1.50
export const PRINTER_PORT_KEY = "themasters_printer_port"; // usually 9100

const encoder = new TextEncoder();
const ESC = 0x1b;
const GS = 0x1d;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isTauriRuntime() {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

function leftRight(left: string, right: string, width = 32) {
  const space = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function money(n: number) {
  return n.toFixed(2);
}

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
  parts.push(textLine(`Staff: ${d.cashierName}`));
  if (d.customerName?.trim()) parts.push(textLine(`Customer: ${d.customerName.trim()}`));
  parts.push(bytes(ESC, 0x61, 0x00)); // left

  parts.push(textLine("--------------------------------"));

  for (const it of d.cart) {
    const name = String(it.product?.name ?? "Item").slice(0, 20);
    const qty = Number(it.quantity || 0);
    const price = Number(it.customPrice ?? it.product?.price ?? 0);
    const total = qty * price;

    parts.push(textLine(name));
    parts.push(textLine(leftRight(`  ${qty} x ${money(price)}`, money(total))));
  }

  parts.push(textLine("--------------------------------"));
  parts.push(textLine(leftRight("Subtotal", money(d.subtotal))));
  if (d.discount > 0) parts.push(textLine(leftRight("Discount", `-${money(d.discount)}`)));
  if (d.tax > 0) parts.push(textLine(leftRight("Tax", money(d.tax))));

  parts.push(bytes(ESC, 0x45, 0x01)); // bold
  parts.push(textLine(leftRight("TOTAL", money(d.total))));
  parts.push(bytes(ESC, 0x45, 0x00));

  parts.push(textLine("--------------------------------"));
  parts.push(bytes(ESC, 0x61, 0x01));
  parts.push(textLine(`Paid: ${String(d.paymentMethod).toUpperCase()}`));
  parts.push(textLine("Thank you!"));
  parts.push(bytes(ESC, 0x61, 0x00));

  // Feed extra lines so the tear/cut doesn't eat the last line.
  parts.push(bytes(ESC, 0x64, 0x05));
  parts.push(bytes(GS, 0x56, 0x00)); // cut (some printers ignore; safe)

  return concat(parts);
}

async function printBrowserReceipt() {
  // We rely on an existing DOM node with this id (POSPage + ReceiptsPage include it).
  const el = document.getElementById("receipt-print-area") as HTMLElement | null;
  if (!el) throw new Error("Receipt print area not found (#receipt-print-area)");

  // Temporarily force it to render (even if Tailwind's `hidden` is applied).
  const prevStyle = el.getAttribute("style");
  el.style.display = "block";
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.width = "58mm";
  el.style.overflow = "visible";

  try {
    // Give React/layout time to flush.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Wait for web fonts (prevents reflow mid-print).
    const anyDoc = document as any;
    if (anyDoc.fonts?.ready) {
      await Promise.race([anyDoc.fonts.ready, sleep(2000)]);
    }

    // Wait for images (logo) to decode/load.
    const imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
    await Promise.race([
      Promise.all(
        imgs.map(async (img) => {
          if (img.complete) return;
          try {
            if (typeof (img as any).decode === "function") {
              await (img as any).decode();
              return;
            }
          } catch {
            // fallback to events below
          }
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          });
        })
      ),
      sleep(2500),
    ]);

    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      // Some runtimes don't reliably fire afterprint.
      const t = setTimeout(finish, 2500);
      window.addEventListener("afterprint", () => {
        clearTimeout(t);
        finish();
      }, { once: true });

      window.print();
    });
  } finally {
    if (prevStyle == null) el.removeAttribute("style");
    else el.setAttribute("style", prevStyle);
  }
}

async function sendTcp(ip: string, port: number, data: Uint8Array) {
  // Only supported if you actually have a TcpSocket plugin installed
  if (Capacitor.getPlatform() !== "android") {
    throw new Error("TCP printing only supported on Android");
  }

  const TcpSocket = (window as any)?.Capacitor?.Plugins?.TcpSocket;
  if (!TcpSocket) throw new Error("TCP plugin not available");

  const socketId = await TcpSocket.connect({ host: ip, port });

  const bin = Array.from(data).map((b) => String.fromCharCode(b)).join("");
  const b64 = btoa(bin);

  await TcpSocket.write({ socketId, data: b64, encoding: "base64" });
  await TcpSocket.close({ socketId });
}

async function sendTcpDesktopViaTauri(ip: string, port: number, data: Uint8Array) {
  if (!isTauriRuntime()) throw new Error("TCP printing requires the Tauri desktop app");

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("tcp_print_escpos", { host: ip, port, data: Array.from(data) });
}

export async function printReceiptSmart(d: ThermalReceiptData) {
  const platform = Capacitor.getPlatform();

  // Default modes:
  // - Android -> bt (no popup)
  // - Desktop -> browser
  let mode =
    (localStorage.getItem(PRINTER_MODE_KEY) || "").trim() ||
    (platform === "android" ? "bt" : "browser");

  const escpos = buildEscPos(d);

  // ✅ ANDROID
  if (platform === "android") {
    // ✅ SAFETY: if mode is wrong (example "browser"), force bluetooth
    if (mode !== "bt" && mode !== "tcp") mode = "bt";

    if (mode === "bt") {
      await printToBluetooth58mm(escpos, { chunkSize: 800, chunkDelayMs: 35, retries: 3 });
      return;
    }

    // tcp mode
    const ip = (localStorage.getItem(PRINTER_IP_KEY) || "").trim();
    const port = Number(localStorage.getItem(PRINTER_PORT_KEY) || "9100");
    if (!ip) throw new Error("Printer IP not set");
    await sendTcp(ip, port, escpos);
    return;
  }

  // ✅ DESKTOP / WINDOWS
  if (mode === "browser") {
    await printBrowserReceipt();
    return;
  }

  if (mode === "tcp") {
    const ip = (localStorage.getItem(PRINTER_IP_KEY) || "").trim();
    const port = Number(localStorage.getItem(PRINTER_PORT_KEY) || "9100");
    if (!ip) throw new Error("Printer IP not set");

    // Silent thermal print (no window.print popups) when running inside Tauri.
    if (isTauriRuntime()) {
      await sendTcpDesktopViaTauri(ip, port, escpos);
      return;
    }

    // Browser fallback (can't open raw TCP sockets)
    await printBrowserReceipt();
    return;
  }

  throw new Error(`Unknown printer mode on Desktop: ${mode}`);
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
    } catch (err: any) {
    console.warn("Thermal print failed (kept queued):", err);

    // ✅ Show error on screen
    const { toast } = await import("sonner");
    toast.error(err?.message || "Printing failed");
  } finally {
    processing = false;
  }
}
