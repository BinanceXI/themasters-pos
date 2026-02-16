import { Capacitor } from "@capacitor/core";

declare global {
  interface Window {
    bluetoothSerial?: any;
  }
}

function isAndroidNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

const BT_LAST_ADDRESS_KEY = "themasters_printer_bt_address";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForBluetoothSerial(timeoutMs = 3500) {
  if (typeof window === "undefined") return null;
  if (window.bluetoothSerial) return window.bluetoothSerial;

  return await new Promise<any>((resolve) => {
    let done = false;
    const finish = (bt: any) => {
      if (done) return;
      done = true;
      try {
        clearTimeout(t);
        clearInterval(poll);
        document.removeEventListener("deviceready", onReady);
      } catch {
        // ignore
      }
      resolve(bt);
    };

    const onReady = () => finish(window.bluetoothSerial || null);
    try {
      document.addEventListener("deviceready", onReady, { once: true });
    } catch {
      // ignore
    }

    const poll = setInterval(() => {
      if (window.bluetoothSerial) finish(window.bluetoothSerial);
    }, 50);

    const t = setTimeout(() => finish(window.bluetoothSerial || null), timeoutMs);
  });
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, msg: string) {
  let t: any;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(msg)), timeoutMs);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function pickPrinter(devices: any[]) {
  const saved = localStorage.getItem(BT_LAST_ADDRESS_KEY) || "";
  const savedMatch = saved ? devices.find((d) => String(d.address || "") === saved) : null;
  if (savedMatch) return savedMatch;

  const byName = (needle: string) =>
    devices.find((d) => String(d.name || "").toLowerCase().includes(needle));

  return (
    byName("pos") ||
    byName("printer") ||
    byName("xp-") ||
    byName("xprinter") ||
    byName("sp") ||
    devices[0]
  );
}

async function btList(bt: any) {
  return await new Promise<any[]>((resolve, reject) => bt.list(resolve, reject));
}

async function btIsEnabled(bt: any) {
  return await new Promise<boolean>((resolve) => bt.isEnabled(() => resolve(true), () => resolve(false)));
}

async function btEnable(bt: any) {
  return await new Promise<void>((resolve, reject) => bt.enable(resolve, reject));
}

async function btDisconnect(bt: any) {
  try {
    await new Promise<void>((resolve) => bt.disconnect(resolve, resolve));
  } catch {
    // ignore
  }
}

async function btConnect(bt: any, address: string) {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      // Some printers need insecure connect. We'll try connect(), then fallback if available.
      let done = false;
      const ok = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const fail = async (e: any) => {
        if (done) return;
        done = true;

        if (typeof bt.connectInsecure === "function") {
          try {
            await new Promise<void>((res, rej) => bt.connectInsecure(address, res, rej));
            resolve();
            return;
          } catch {
            // fall through to reject below
          }
        }

        reject(e);
      };

      bt.connect(address, ok, fail);
    }),
    10_000,
    "Bluetooth connect timed out"
  );
}

async function btWrite(bt: any, data: ArrayBuffer) {
  await withTimeout(
    new Promise<void>((resolve, reject) => bt.write(data, resolve, reject)),
    10_000,
    "Bluetooth write timed out"
  );
}

export type BluetoothPrintOptions = {
  address?: string; // explicit paired printer address
  chunkSize?: number; // bytes (512–1024 recommended)
  chunkDelayMs?: number;
  retries?: number;
};

export async function printToBluetooth58mm(data: Uint8Array, opts: BluetoothPrintOptions = {}) {
  if (!isAndroidNative()) {
    throw new Error("Bluetooth printing only supported on Android app");
  }

  const bt = (await waitForBluetoothSerial()) || (window as any).bluetoothSerial;
  if (!bt) throw new Error("Bluetooth plugin missing (cordova-plugin-bluetooth-serial)");

  const enabled = await btIsEnabled(bt);
  if (!enabled) {
    try {
      await withTimeout(btEnable(bt), 20_000, "Bluetooth enable timed out");
    } catch (e: any) {
      throw new Error(e?.message || "Bluetooth is off. Enable Bluetooth and try again.");
    }
  }

  const chunkSize = Math.max(512, Math.min(1024, Math.trunc(opts.chunkSize ?? 800)));
  const chunkDelayMs = Math.max(5, Math.trunc(opts.chunkDelayMs ?? 35));
  const retries = Math.max(1, Math.trunc(opts.retries ?? 3));

  const requestedAddress = String(opts.address || "").trim();

  let address = requestedAddress;
  let printerName = "";

  if (!address) {
    const devices = await btList(bt);
    if (!devices?.length) {
      throw new Error("No paired Bluetooth devices found. Pair the printer in Android settings first.");
    }
    const printer = pickPrinter(devices);
    address = String(printer?.address || "").trim();
    printerName = String(printer?.name || "").trim();
    if (!address) throw new Error("Printer address not found. Pair the printer again in Android settings.");
  } else {
    // Best-effort: resolve name for error messages
    try {
      const devices = await btList(bt);
      const m = (devices || []).find((d: any) => String(d?.address || "") === address);
      printerName = String(m?.name || "").trim();
    } catch {
      // ignore
    }
  }

  let lastErr: any = null;
  let attemptChunkSize = chunkSize;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Best-effort: clean slate between attempts
      await btDisconnect(bt);
      await btConnect(bt, address);

      for (let i = 0; i < data.length; i += attemptChunkSize) {
        const chunk = data.slice(i, i + attemptChunkSize); // creates a new buffer
        await btWrite(bt, chunk.buffer);
        await sleep(chunkDelayMs);
      }

      // Give the printer a moment to flush before disconnect.
      await sleep(200);
      localStorage.setItem(BT_LAST_ADDRESS_KEY, address);
      await btDisconnect(bt);
      return;
    } catch (e: any) {
      lastErr = e;
      await btDisconnect(bt);
      if (attempt === 1 && attemptChunkSize > 512) {
        attemptChunkSize = 512;
      }
      await sleep(250 * attempt);
    }
  }

  const target = printerName ? `${printerName} (${address})` : address;
  throw new Error(lastErr?.message ? `Bluetooth print failed (${target}): ${lastErr.message}` : `Bluetooth print failed (${target})`);
}
