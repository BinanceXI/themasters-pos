import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

declare global {
  interface Window {
    bluetoothSerial?: any;
  }
}

function isAndroidNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function printToBluetooth58mm(rawText: string) {
  if (!isAndroidNative()) return false;

  const bt = window.bluetoothSerial;
  if (!bt) {
    toast.error("Bluetooth plugin missing (cordova-plugin-bluetooth-serial)");
    return false;
  }

  // 1) list paired devices
  const devices: any[] = await new Promise((resolve, reject) => {
    bt.list(resolve, reject);
  });

  if (!devices?.length) {
    toast.error("No paired Bluetooth devices found. Pair the printer in Android settings first.");
    return false;
  }

  // 2) choose printer (tries SP / printer names first)
  const printer =
    devices.find((d) => String(d.name || "").toLowerCase().includes("sp")) ||
    devices.find((d) => String(d.name || "").toLowerCase().includes("printer")) ||
    devices[0];

  if (!printer?.address) {
    toast.error("Printer address not found. Pair the printer again in Android Bluetooth settings.");
    return false;
  }

  // 3) connect
  await new Promise<void>((resolve, reject) => {
    bt.connect(printer.address, resolve, reject);
  });

  // 4) ESC/POS: init + text + feed + cut
  const INIT = "\x1B\x40";
  const FEED = "\n\n\n";
  const CUT = "\x1D\x56\x41\x10";

  const payload = INIT + rawText + FEED + CUT;

  await new Promise<void>((resolve, reject) => {
    bt.write(payload, resolve, reject);
  });

  // 5) disconnect (best effort)
  try {
    bt.disconnect(() => {}, () => {});
  } catch {}

  return true;
}